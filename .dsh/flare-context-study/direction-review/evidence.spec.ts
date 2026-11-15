/** Durable evidence selection and bounded metadata pages use synthetic, non-task data. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { durableEvidence, evidenceBinding, inspectEvidence } from './evidence.mjs'

const config = { excludedTools: [], checkTools: ['execute'], maxEvidencePairs: 16, maxRequestBytes: 24000 }
const state = { sinceSeq: 1 }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function fixture(count = 24, raw = 'x'.repeat(6083)) {
  const events = Array.from({ length: count }, (_, i) => [
    { type: 'tool/call', seq: 2 + i * 2, time: i * 10, data: { callId: 'call-' + i, name: 'execute', arguments: '{"command":"inspect sample"}' } },
    { type: 'tool/result', seq: 3 + i * 2, time: i * 10 + 5, data: { message: {
      toolCallId: 'call-' + i, content: [{ type: 'text', text: raw }], isError: false,
    } } },
  ]).flat()
  return { id: 'synthetic-session', snapshotEvents: () => events }
}

describe('durable evidence references', () => {
  it('resolves an old explicit call ID and exact result reference without the cache or its text limit', () => {
    const session = fixture()
    const evidence = durableEvidence(session, state, config, ['call-0', 'r49'])
    expect(evidence).toHaveLength(2)
    expect(evidence[0]).toMatchObject({ callId: 'call-0', resultSeq: 3, result: { chars: 6083, truncated: false, text: 'x'.repeat(6083) } })
    expect(evidenceBinding(session, evidence[0], config)).toMatchObject({ sessionId: 'synthetic-session', callId: 'call-0',
      callTime: 0, resultTime: 5, resultSha256: hash('x'.repeat(6083)), resultChars: 6083 })
    expect(durableEvidence(session, { sinceSeq: 4 }, config, ['call-0'])).toEqual([])
  })

  it('paginates compact metadata without copying large original results or losing older calls', () => {
    const session = fixture(24, 'x'.repeat(50000))
    const first = inspectEvidence(session, state, config, { action: 'inspect' })
    expect(first.status).toBe('evidence')
    expect(first.evidence).toHaveLength(16)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(12000)
    expect(JSON.stringify(first)).not.toContain('xxxxx')
    const second = inspectEvidence(session, state, config, { action: 'inspect', beforeSeq: first.nextBeforeSeq })
    expect(second.evidence).toHaveLength(8)
    expect(second.nextBeforeSeq).toBeUndefined()
    expect(new Set([...first.evidence, ...second.evidence].map(item => item.callId)).size).toBe(24)
    expect(inspectEvidence(session, state, config, { action: 'inspect', refs: ['call-0', 'absent'] })).toMatchObject({
      status: 'evidence', evidence: [{ callId: 'call-0' }], unresolvedRefs: ['absent'],
    })
  })

  it.each(['completed', 'unavailable'] as const)('restores a hash-bound %s execution receipt after cache eviction', status => {
    const source = fixture()
    const events = [...source.snapshotEvents(), { type: 'user/message', seq: 51, time: 260, data: {
      source: { kind: 'helper-checkpoint', summary: 'Premise execution receipt' },
      content: [{ type: 'text', text: JSON.stringify({ kind: 'premise-execution', version: 1, callId: 'call-0', toolName: 'execute',
        contentSha256: hash(JSON.stringify([{ type: 'text', text: 'x'.repeat(6083) }])),
        execution: { status, issues: status === 'completed' ? [] : ['executor-truncated'] } }) }],
    } }]
    const session = { id: source.id, snapshotEvents: () => events }
    expect(durableEvidence(session, state, config, ['call-0'])[0].execution).toEqual({ status,
      issues: status === 'completed' ? [] : ['executor-truncated'] })
  })

  it('rejects a changed result as an executed check and labels actual spilled output partial', () => {
    const raw = 'head\n\n(Omitted 12 bytes. Full formatted result stored at: spill:sample. Read the saved text.)'
    const source = fixture(1, raw)
    const session = { id: source.id, snapshotEvents: () => [...source.snapshotEvents(), {
      type: 'user/message', seq: 4, time: 10, data: { source: { kind: 'helper-checkpoint', summary: 'Premise execution receipt' },
        content: [{ type: 'text', text: JSON.stringify({ kind: 'premise-execution', version: 1, callId: 'call-0', toolName: 'execute',
          contentSha256: hash('original value before spill'), execution: { status: 'completed', issues: [] } }) }] },
    }] }
    const pair = durableEvidence(session, state, config, ['call-0'])[0]
    expect(pair.recordedPartial).toBe(true)
    expect(pair.execution).toEqual({ status: 'unavailable', issues: ['result-changed-after-receipt'] })
  })
})
