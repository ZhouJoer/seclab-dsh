/** Material browsing preserves project scope and immutable file contents. @module */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { recordSchema } from '../src/workbench/model.ts'
import { saveSourceManifest } from '../src/workbench/source.ts'
import { readProjectMaterial } from '../src/material-browser.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-material-browser-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const store = new ArtifactStore(root, 65536)
  const text = await store.put(Buffer.from('Owned file\n<script>untrusted()</script>'), 'text/plain')
  const binary = await store.put(Buffer.from([0, 1, 2, 255]), 'application/octet-stream')
  const image = await store.put(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=', 'base64'), 'image/png')
  const artifact = await saveSourceManifest(store, { version: 1, excluded: [{ path: 'node_modules', reason: 'Dependencies' }], files: [
    { path: 'src/note.txt', artifact: text, text: true }, { path: 'src/raw.bin', artifact: binary, text: false },
    { path: 'logo.png', artifact: image, text: false },
    ...Array.from({ length: 103 }, (_, i) => ({ path: `batch/${String(i).padStart(3, '0')}.txt`, artifact: text, text: true })),
  ] })
  const records = [recordSchema.parse({ kind: 'asset', value: { id: 'owned', engagementId: 'task', kind: 'source', label: 'Workspace', identity: 'measured', artifact } })]
  const read = (mode: string, path: string, offset = 0, assetId = 'owned', budget = 4096) =>
    readProjectMaterial(records, store, JSON.stringify({ assetId, mode, path, offset }), budget)
  return { read, records, store, text }
}

it('expands immediate folders, paginates without dropping files and hides exclusions', async () => {
  const { read } = await fixture()
  expect(await read('directory', '')).toMatchObject({ kind: 'directory', total: 3,
    entries: [{ kind: 'directory', path: 'batch', fileCount: 103 }, { kind: 'directory', path: 'src', fileCount: 2 }, { kind: 'file', path: 'logo.png' }] })
  const paths: string[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const page = await read('directory', 'batch', offset)
    expect(page.kind).toBe('directory')
    if (page.kind !== 'directory') throw new Error('Expected a directory page')
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(4096)
    paths.push(...page.entries.map(entry => entry.path)); offset = page.next
  }
  expect(new Set(paths).size).toBe(103)
})

it('previews stored text, raster images and binary bytes without reading arbitrary paths', async () => {
  const { read } = await fixture()
  expect(await read('file', 'src/note.txt')).toMatchObject({ kind: 'text', text: 'Owned file\n<script>untrusted()</script>', truncated: false })
  expect(await read('file', 'src/note.txt', 0, 'owned', 8)).toMatchObject({ kind: 'text', text: 'Owned fi', truncated: true })
  const image = await read('file', 'logo.png')
  expect(image.kind).toBe('image')
  if (image.kind === 'image') expect(image.url).toMatch(/^data:image\/png;base64,/)
  expect(await read('file', 'src/raw.bin')).toMatchObject({ kind: 'binary', hex: '000102ff' })
  await expect(read('file', '../outside.txt')).rejects.toThrow('absent')
  await expect(read('file', 'src/note.txt', 0, 'other-project-asset')).rejects.toThrow('scope')
  await expect(read('directory', '../')).rejects.toThrow('absent')
  await expect(read('directory', '', -1)).rejects.toThrow()
})

it('keeps historical bytes readable and previews individually imported files', async () => {
  const { read, store, records, text } = await fixture()
  await store.put(Buffer.from('Replacement bytes'), 'text/plain')
  const original = await read('file', 'src/note.txt')
  expect(original.kind).toBe('text')
  if (original.kind === 'text') expect(original.text).toContain('Owned file')
  const other = recordSchema.parse({ kind: 'asset', value: { id: 'single', engagementId: 'task', label: 'sample.txt',
    artifact: text, format: 'other', identity: 'measured' } })
  expect(await readProjectMaterial([...records, other], store, JSON.stringify({ assetId: 'single', mode: 'file', path: '' }), 4096))
    .toMatchObject({ kind: 'text', path: 'sample.txt' })
  await expect(readProjectMaterial([other], store, JSON.stringify({ assetId: 'single', mode: 'directory', path: '' }), 4096)).rejects.toThrow('not a directory')
})
