/** Exact retained-item copies preserve source identity, number literals and collection limits. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prepareEvidenceExport } from '../src/evidence-export.ts'
import { evidenceSchema } from '../src/workbench/model.ts'

const artifact = (items: string, incomplete = false) => Buffer.from(JSON.stringify({
  format: 'security-tool-result-v1', tool: 'fixture', operation: 'fixture.inspect', environmentId: 'local',
  toolVersion: 'fixture-1', inputSha256: 'a'.repeat(64), incomplete, diagnostics: '', raw: null,
}).slice(0, -1) + ',"items":' + items + '}')
const evidence = (bytes: Buffer) => evidenceSchema.parse({ id: 'evidence', engagementId: 'project', assetId: 'asset',
  title: 'Saved fields', summary: '', provider: 'tool-adapter', operation: 'fixture.inspect', toolVersion: 'fixture-1',
  request: {}, source: { sessionId: 'session', callId: 'call' }, incomplete: false, createdAt: 0,
  artifact: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mediaType: 'application/json' } })
const limits = { maxItems: 10, maxBytes: 4096 }

describe('retained evidence item export', () => {
  it('copies integer literals above the safe Number range and preserves native JSON types', () => {
    const bytes = artifact('[{"address":18446744073709551613,"text":"雪","enabled":true,"missing":null},{"offset":17}]')
    const saved = evidence(bytes)
    const exported = prepareEvidenceExport(bytes, saved, { offset: 0, limit: 1 }, limits)
    expect(exported.content).toContain('"address":18446744073709551613')
    expect(exported.content).toContain('"enabled":true,"missing":null')
    expect(exported.source).toMatchObject({ evidenceId: saved.id, assetId: saved.assetId,
      artifactSha256: saved.artifact.sha256, inputSha256: 'a'.repeat(64), incomplete: false, failure: null })
    expect(exported.range).toEqual({ itemOffset: 0, itemCount: 1, totalRetainedItems: 2, nextItemOffset: 1, allRetainedItems: false })
    const exact = { ...limits, maxBytes: Buffer.byteLength(exported.content) }
    expect(prepareEvidenceExport(bytes, saved, { offset: 0, limit: 1 }, exact)).toEqual(exported)
    expect(() => prepareEvidenceExport(bytes, saved, { offset: 0, limit: 1 }, { ...exact, maxBytes: exact.maxBytes - 1 }))
      .toThrow('Complete item export exceeds')
  })

  it('keeps partial collection and failed execution distinct from selecting all retained items', () => {
    const bytes = artifact('[1,2]', true)
    const saved = { ...evidence(bytes), failure: 'Collection timed out' }
    const exported = prepareEvidenceExport(bytes, saved, { offset: 0, limit: 10 }, limits)
    expect(exported.source).toMatchObject({ incomplete: true, failure: 'Collection timed out' })
    expect(exported.range).toEqual({ itemOffset: 0, itemCount: 2, totalRetainedItems: 2, nextItemOffset: null, allRetainedItems: true })
    expect(prepareEvidenceExport(bytes, { ...saved, incomplete: true }, { offset: 2, limit: 1 }, limits).range)
      .toMatchObject({ itemCount: 0, allRetainedItems: false })
    const empty = artifact('[]')
    expect(prepareEvidenceExport(empty, evidence(empty), { offset: 0, limit: 1 }, limits).range)
      .toMatchObject({ totalRetainedItems: 0, allRetainedItems: true })
  })

  it('rejects source changes, unsupported evidence, invalid JSON, missing items and invalid ranges', () => {
    const bytes = artifact('[1]'), saved = evidence(bytes)
    expect(() => prepareEvidenceExport(artifact('[2]'), saved, { offset: 0, limit: 1 }, limits)).toThrow('artifact hash')
    expect(() => prepareEvidenceExport(bytes, { ...saved, provider: 'binary' }, { offset: 0, limit: 1 }, limits)).toThrow('adapter evidence')
    expect(() => prepareEvidenceExport(bytes, saved, { offset: 2, limit: 1 }, limits)).toThrow('offset exceeds')
    expect(() => prepareEvidenceExport(bytes, saved, { offset: 0, limit: 11 }, limits)).toThrow('maxItems')
    expect(() => prepareEvidenceExport(bytes, saved, { offset: -1, limit: 1 }, limits)).toThrow()
    expect(() => prepareEvidenceExport(bytes, saved, { offset: 0, limit: 0 }, limits)).toThrow()
    for (const malformed of ['[1,]', '[/*comment*/1]', '[1']) {
      const invalid = artifact(malformed)
      expect(() => prepareEvidenceExport(invalid, evidence(invalid), { offset: 0, limit: 1 }, limits)).toThrow('valid JSON')
    }
    const invalidItems = artifact('{}')
    expect(() => prepareEvidenceExport(invalidItems, evidence(invalidItems), { offset: 0, limit: 1 }, limits)).toThrow('items array')
  })
})
