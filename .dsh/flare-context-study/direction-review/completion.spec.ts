import { describe, expect, it } from 'vitest'
import { completionArguments, completionPacket, parseCompletionReview } from './completion.mjs'

const config = { excludedTools: [], checkTools: ['pwsh'], completionMaxRequestBytes: 64000 }
const manifest = { summary: 'Recovered report', limitations: 'Live changes are outside the static backup objective.',
  results: [{ title: 'Totals', result: 'A=9 B=12', toolCallIds: ['verify'], evidenceIds: [] }] }
const view = { records: [{ kind: 'engagement', value: { objective: 'Recover both catalog and depot totals from the supplied static backup.' } }] }
function fixture(output = 'verified all rows; A=9 B=12', isError = false) {
  return { id: 'session', snapshotEvents: () => [
    { seq: 1, type: 'tool/call', data: { name: 'read_data', callId: 'verify', arguments: '{"path":"report"}' } },
    { seq: 2, type: 'tool/result', data: { message: { toolCallId: 'verify', isError, content: [{ type: 'text', text: output }] } } },
  ] }
}

describe('completion scope evidence', () => {
  it('resolves a saved evidence ID through its original completed call rather than trusting the saved summary', () => {
    const selected = { ...manifest, results: [{ ...manifest.results[0], toolCallIds: [], evidenceIds: ['saved-total'] }] }
    const records = [...view.records, { kind: 'evidence', value: { id: 'saved-total', source: { sessionId: 'session', callId: 'verify' }, summary: 'Reported totals.' } }]
    const packet = completionPacket(selected, fixture(), {}, config, { records })
    expect(packet.status).toBe('ready')
    const answer = { decision: 'allow', rationale: 'The original result reports both totals.', evidenceRefs: ['saved-total', 'r2'], nextCheck: '' }
    expect(parseCompletionReview(JSON.stringify(answer), packet)).toMatchObject({ status: 'reviewed', evidenceRefs: ['verify'],
      referenceBindings: [{ inputRef: 'saved-total', ref: 'verify' }, { inputRef: 'r2', ref: 'verify' }] })
    expect(completionPacket(selected, fixture(), {}, config, { records: [...view.records,
      { kind: 'evidence', value: { id: 'saved-total', source: { sessionId: 'other-session', callId: 'verify' } } }] }))
      .toMatchObject({ status: 'unreviewed', missing: ['saved-total'] })
  })

  it('retains local citation diagnostics and next-check advice without accepting a completion claim', () => {
    const packet = completionPacket(manifest, fixture(), {}, config, view)
    expect(parseCompletionReview(JSON.stringify({ decision: 'missing-required-check', rationale: 'The sample is incomplete.',
      evidenceRefs: ['verify', 'planned-call'], nextCheck: 'Count all rows.' }), packet)).toMatchObject({ status: 'unreviewed',
      evidenceRefs: ['verify'], submittedEvidenceRefs: ['verify', 'planned-call'], nextCheck: 'Count all rows.',
      referenceIssues: [{ inputRef: 'planned-call', issue: 'not-in-review-packet' }] })
  })

  it('resolves full older evidence without treating a later continue as the objective', () => {
    const output = 'x'.repeat(6100) + '\nverified A=9 B=12\n' + 'y'.repeat(6100)
    const packet = completionPacket(manifest, fixture(output), { sinceSeq: 100, evidence: [] }, config, view)
    expect(packet.status).toBe('ready')
    expect(JSON.parse(packet.context).observations[0].output).toBe(output)
    expect(JSON.parse(packet.context).objective).toBe(view.records[0].value.objective)
    expect(JSON.parse(packet.context).manifest.limitations).toContain('outside')
  })
  it('does not review a missing objective, missing source, failed tool, or oversized packet', () => {
    expect(completionPacket(manifest, fixture(), {}, config, { records: [] }).status).toBe('unreviewed')
    expect(completionPacket({ ...manifest, results: [{ ...manifest.results[0], toolCallIds: ['missing'] }] }, fixture(), {}, config, view).missing).toEqual(['missing'])
    expect(completionPacket(manifest, fixture('error', true), {}, config, view).status).toBe('unreviewed')
    expect(completionPacket(manifest, fixture('x'.repeat(65000)), {}, config, view).status).toBe('unreviewed')
  })
  it('retains partial saved evidence as an explicit completion gap', () => {
    const selected = { ...manifest, results: [{ ...manifest.results[0], evidenceIds: ['e1'] }] }
    expect(completionPacket(selected, fixture(), {}, config, { records: [...view.records,
      { kind: 'evidence', value: { id: 'e1', incomplete: true } }] }).status).toBe('unreviewed')
  })
  it('uses the same manifest for both completion entry paths', () => {
    const command = { ...manifest, results: [{ ...manifest.results[0], toolCallIds: undefined, citations: [{ kind: 'tool', callId: 'verify' }] }] }
    expect(completionArguments('security_complete', manifest)).toEqual(manifest)
    expect(completionArguments('security_command', { command: JSON.stringify({ action: { kind: 'complete-task', ...command } }) })).toEqual(command)
    expect(completionArguments('security_command', { command: '{' })).toBeUndefined()
    expect(completionArguments('security_checkpoint', {})).toBeUndefined()
  })
  it('changes its review identity when the objective, evidence, or submitted decision changes', () => {
    const packet = completionPacket(manifest, fixture(), {}, config, view)
    expect(completionPacket(manifest, fixture(), {}, config, view).reason).toBe(packet.reason)
    expect(completionPacket({ ...manifest, summary: 'Catalog only' }, fixture(), {}, config, view).reason).not.toBe(packet.reason)
    expect(completionPacket(manifest, fixture('different measurement'), {}, config, view).reason).not.toBe(packet.reason)
    expect(completionPacket(manifest, fixture(), {}, config, { records: [{ kind: 'engagement', value: { objective: 'Catalog only' } }] }).reason).not.toBe(packet.reason)
  })
  it('accepts source-linked reviews but rejects incomplete or invented references', () => {
    const packet = completionPacket(manifest, fixture(), {}, config, view)
    const allowed = { decision: 'allow', rationale: 'All requested static totals verified.', evidenceRefs: ['verify'], nextCheck: '' }
    expect(parseCompletionReview(JSON.stringify(allowed), packet)).toMatchObject({ status: 'reviewed', decision: 'allow', scientificallyVerified: false })
    expect(parseCompletionReview(JSON.stringify({ ...allowed, decision: 'missing-required-check', nextCheck: 'Decode and aggregate the second member.' }), packet).decision).toBe('missing-required-check')
    for (const invalid of ['', '{"decision":', JSON.stringify({ ...allowed, evidenceRefs: ['invented'] }), JSON.stringify({ ...allowed, decision: 'missing-required-check' })])
      expect(parseCompletionReview(invalid, packet).status).toBe('unreviewed')
  })
})
