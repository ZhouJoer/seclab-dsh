/** Snapshot document reads never resolve a live workspace path. @module */
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { OfficeToPdf, OfficeToPdfKey, OfficeToPdfGeneration } from '@deepseek-ai/dsh-office-to-pdf'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { recordSchema } from '../src/workbench/model.ts'
import { saveSourceManifest } from '../src/workbench/source.ts'
import { readMaterialDocument } from '../src/material-document.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-material-document-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const store = new ArtifactStore(root, 65536)
  const text = await store.put(Buffer.from('Snapshot 中文\r\n'), 'text/plain')
  const office = await store.put(Buffer.from('office snapshot bytes'), 'application/octet-stream')
  const pdf = await store.put(Buffer.from('%PDF-1.7\nfixture'), 'application/pdf')
  const image = await store.put(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')
  const artifact = await saveSourceManifest(store, { version: 1, excluded: [], files: [
    { path: 'note.txt', artifact: text, text: true }, { path: '中文.docx', artifact: office, text: false },
    { path: 'read.pdf', artifact: pdf, text: false }, { path: 'image.png', artifact: image, text: false },
  ] })
  const records = [recordSchema.parse({ kind: 'asset', value: { id: 'owned', engagementId: 'task', kind: 'source', label: 'Workspace', identity: 'measured', artifact } })]
  const signal = new AbortController().signal
  const read = (path: string, converter?: Pick<OfficeToPdf, 'convert'>, budget = 4096) =>
    readMaterialDocument(records, store, JSON.stringify({ assetId: 'owned', path }), budget, converter, signal)
  return { root, store, records, read, text, office, signal }
}

it('reads an immutable version after live modification and deletion, with explicit truncation', async () => {
  const { root, read, text } = await fixture()
  const live = join(root, 'note.txt')
  await writeFile(live, 'Different bytes')
  await unlink(live)
  expect(await read('note.txt')).toEqual({ kind: 'text', name: 'note.txt', version: text.sha256, size: text.size, text: 'Snapshot 中文\r\n', truncated: false })
  expect(await read('note.txt', undefined, 10)).toMatchObject({ text: 'Snapshot ', truncated: true })
})

it('rejects unowned assets and non-member paths before conversion', async () => {
  const { records, store, read, signal } = await fixture()
  await expect(read('../note.txt')).rejects.toThrow('absent')
  await expect(readMaterialDocument([], store, JSON.stringify({ assetId: 'owned', path: 'note.txt' }), 4096, undefined, signal)).rejects.toThrow('scope')
  await expect(readMaterialDocument(records, store, JSON.stringify({ assetId: 'other', path: 'note.txt' }), 4096, undefined, signal)).rejects.toThrow('scope')
  await expect(read('中文.docx')).rejects.toThrow('unavailable')
})

it('defers Office bytes to the bounded converter and preserves the source digest', async () => {
  const { read, store, office, signal } = await fixture()
  const readBytes = vi.spyOn(store, 'read')
  const converter: Pick<OfficeToPdf, 'convert'> = { convert: async (request, cancellation) => {
    expect(cancellation).toBe(signal)
    expect(request.extension).toBe('docx')
    expect(request.source.version).toBe(office.sha256)
    expect(readBytes.mock.calls.some(([artifact]) => artifact.sha256 === office.sha256)).toBe(false)
    await expect(request.source.read(signal, 1)).rejects.toThrow('limit')
    const source = await request.source.read(signal, 4096)
    expect(Buffer.from(source.bytes).toString()).toBe('office snapshot bytes')
    return { pdf: new Uint8Array([37, 80, 68, 70]), missingFonts: ['Missing font'], cacheKey: brandString<OfficeToPdfKey>('fixture'), generation: brandString<OfficeToPdfGeneration>('fixture') }
  } }
  expect(await read('中文.docx', converter)).toMatchObject({ kind: 'pdf', version: office.sha256, missingFonts: ['Missing font'] })
  expect(await store.read(office)).toEqual(Buffer.from('office snapshot bytes'))
})

it('returns complete PDF and raster bytes and rejects an aborted request', async () => {
  const { read, records, store } = await fixture()
  expect(await read('read.pdf')).toMatchObject({ kind: 'pdf', missingFonts: [] })
  expect(await read('image.png')).toMatchObject({ kind: 'image', mediaType: 'image/png' })
  await expect(readMaterialDocument(records, store, JSON.stringify({ assetId: 'owned', path: 'read.pdf' }), 4096, undefined, AbortSignal.abort())).rejects.toThrow()
})
