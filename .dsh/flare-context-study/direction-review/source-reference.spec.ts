/** Source handles expose exact synthetic call identities without copying observations or scripts. */
import { describe, expect, it } from 'vitest'
import { SOURCE_REFERENCE_SUMMARY, hasSourceReference, sourceReference, withSourceLocator } from './source-reference.mjs'
import { receiptSchema } from './evidence.mjs'

const call = { callId: 'actual-call-17', name: 'read', arguments: { file_path: '/work/data/records.bin', offset: 16, length: 32 } }
const notice = (text: string, summary = SOURCE_REFERENCE_SUMMARY) => ({ source: { kind: 'helper-checkpoint', summary },
  content: [{ type: 'text', text }] })

describe('host source reference notices', () => {
  it('exposes the real read handle and exact location without inventing a path-shaped alias or success', () => {
    const source = sourceReference(call, 512)
    expect(source).toEqual({ kind: 'evidence-source', version: 1, callId: call.callId, toolName: 'read',
      locator: { file_path: '/work/data/records.bin', offset: 16, length: 32 } })
    expect(source).not.toHaveProperty('resultSeq')
    expect(source).not.toHaveProperty('execution')
    expect(source).not.toHaveProperty('scientificallyVerified')
  })

  it('locates native operations and omits scripts, descriptions, credentials and arbitrary argument objects', () => {
    const args = { assetId: 'asset-1', operation: 'headers', description: 'PRIVATE DESCRIPTION', command: 'PRIVATE SCRIPT',
      code: 'PRIVATE CODE', script: 'PRIVATE FILE BODY', password: 'PRIVATE SECRET', extra: { path: 'untrusted-nested-path' } }
    const original = JSON.stringify(args)
    const source = sourceReference({ callId: 'native-1', name: 'security_inspect', arguments: args }, 512)
    expect(source.locator).toEqual({ assetId: 'asset-1', operation: 'headers' })
    expect(JSON.stringify(source)).not.toContain('PRIVATE')
    expect(JSON.stringify(args)).toBe(original)
  })

  it('bounds Unicode locator display while keeping call identity exact', () => {
    const source = sourceReference({ ...call, arguments: { path: '/work/' + '路径🧪'.repeat(300), offset: 12 } }, 256)
    expect(Buffer.byteLength(JSON.stringify(source))).toBeLessThanOrEqual(256)
    expect(source).toMatchObject({ callId: call.callId, toolName: call.name, locatorTruncated: true })
    expect(source.locator.path).toContain('…')
    expect(source.locator.path).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
    expect(sourceReference({ ...call, callId: 'x'.repeat(600) }, 128)).toBeUndefined()
  })

  it('adds location to the existing execution receipt without dropping unavailable execution facts', () => {
    const receipt = { kind: 'premise-execution', version: 1, callId: call.callId, toolName: 'evaluate', contentSha256: 'a'.repeat(64),
      execution: { status: 'unavailable', issues: ['nonzero-or-missing-exit'], exitCode: 2, stderrTruncated: true } }
    const extended = withSourceLocator(receipt, { path: '/work/input.bin', command: 'DO NOT COPY' }, 512)
    expect(extended).toMatchObject({ ...receipt, locator: { path: '/work/input.bin' } })
    expect(receiptSchema.safeParse(extended).success).toBe(true)
    expect(withSourceLocator(receipt, { path: '/work/input.bin' }, 128)).toEqual(receipt)
  })

  it('deduplicates only this call and tool in an owned source or execution notice', () => {
    const source = sourceReference(call, 512)
    expect(hasSourceReference([notice(JSON.stringify(source))], call.callId, call.name)).toBe(true)
    expect(hasSourceReference([notice(JSON.stringify({ ...source, kind: 'premise-execution' }), 'Premise execution receipt')], call.callId, call.name)).toBe(true)
    for (const messages of [[notice('{')], [notice(JSON.stringify(source), 'Unrelated context')],
      [notice(JSON.stringify({ ...source, toolName: 'another-tool' }))], [notice(JSON.stringify({ ...source, callId: 'another-call' }))]])
      expect(hasSourceReference(messages, call.callId, call.name)).toBe(false)
  })
})
