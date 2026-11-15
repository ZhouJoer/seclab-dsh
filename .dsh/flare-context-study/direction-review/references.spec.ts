/** Synthetic citations exercise source identity without copying investigation records. */
import { describe, expect, it } from 'vitest'
import { durableEvidence, inspectEvidence, needsEvidenceView } from './evidence.mjs'
import { referenceAliases, resolveEvidenceReference, resolveReviewReferences } from './references.mjs'
import { prepareCheckpoint } from './checkpoint.mjs'

const config = { excludedTools: [], checkTools: ['evaluate'], adoptionTools: ['evaluate'], maxEvidencePairs: 16, maxRequestBytes: 24000 }
const state = { sinceSeq: 0, evidence: [] }
const session = { id: 'session-a', snapshotEvents: () => [
  { type: 'tool/call', seq: 1, data: { callId: 'source-call', name: 'read_data', arguments: '{}' } },
  { type: 'tool/result', seq: 2, data: { message: { toolCallId: 'source-call', content: [{ type: 'text', text: '{"evidenceId":"spoofed","rows":3}' }] } } },
  { type: 'tool/call', seq: 3, data: { callId: 'not-executed', name: 'evaluate', arguments: '{}' } },
  { type: 'tool/call', seq: 4, data: { callId: 'other-call', name: 'read_data', arguments: '{}' } },
  { type: 'tool/result', seq: 5, data: { message: { toolCallId: 'other-call', content: [{ type: 'text', text: 'rows=5' }] } } },
] }
const record = (id: string, callId: string, sessionId = session.id) => ({ kind: 'evidence', value: { id, source: { callId, sessionId } } })
const view = { records: [record('stored-observation', 'source-call'), record('foreign-observation', 'source-call', 'session-b'),
  record('pending-observation', 'not-executed')] }

describe('source reference identity', () => {
  it('uses workbench source bindings and preserves all three citation forms', () => {
    expect(needsEvidenceView(session, state, config, ['source-call', 'r2'])).toBe(false)
    expect(needsEvidenceView(session, state, config, ['stored-observation'])).toBe(true)
    const pairs = durableEvidence(session, state, config, undefined, view)
    for (const ref of ['source-call', 'r2', 'stored-observation'])
      expect(resolveEvidenceReference(pairs, ref)).toMatchObject({ status: 'resolved', binding: { inputRef: ref, callId: 'source-call', resultSeq: 2 } })
    const inspected = inspectEvidence(session, state, config, { action: 'inspect', refs: ['stored-observation'] }, view)
    expect(inspected).toMatchObject({ status: 'evidence', unresolvedRefs: [], referenceBindings: [{ inputRef: 'stored-observation', evidenceId: 'stored-observation', callId: 'source-call' }] })
    expect(durableEvidence(session, state, config, ['stored-observation'], view).map(pair => pair.callId)).toEqual(['source-call'])
  })

  it('never derives saved evidence identity from output text, another session or an uncompleted call', () => {
    const pairs = durableEvidence(session, state, config, undefined, view)
    for (const ref of ['spoofed', 'foreign-observation', 'pending-observation', 'not-executed'])
      expect(resolveEvidenceReference(pairs, ref)).toMatchObject({ status: 'unresolved', inputRef: ref })
    expect(durableEvidence(session, { sinceSeq: 2 }, config, ['stored-observation'], view)).toEqual([])
  })

  it('rejects an ambiguous evidence ID even when its text is also a canonical call ID', () => {
    const pairs = durableEvidence(session, state, config, undefined, { records: [record('other-call', 'source-call')] })
    expect(resolveEvidenceReference(pairs, 'other-call')).toMatchObject({ status: 'ambiguous' })
    const packet = { refs: pairs.map(pair => pair.callId), referenceAliases: referenceAliases(pairs) }
    expect(resolveReviewReferences(packet, ['other-call'])).toMatchObject({ evidenceRefs: [], referenceStatus: 'partial',
      referenceIssues: [{ inputRef: 'other-call', issue: 'not-in-review-packet' }] })
  })

  it('preserves the submitted reference next to its original source in saved notes', () => {
    const args = { action: 'save', phase: 'assessment', title: 'Coverage', observations: [{ ref: 'stored-observation', description: 'A bounded sample.' }],
      interpretation: 'The sample does not establish the whole population.', nextCheck: 'Inspect an omitted row.' }
    const prepared = prepareCheckpoint(args, session, state, config, () => undefined, undefined, view)
    expect(prepared).toMatchObject({ status: 'prepared', scientificallyVerified: false, adoption: { status: 'handoff-only' },
      bindings: [{ inputRef: 'stored-observation', callId: 'source-call', ref: 'r2', evidenceIds: ['stored-observation'] }] })
    const invalid = prepareCheckpoint({ ...args, observations: [...args.observations, { ref: 'not-executed' }] }, session, state, config, () => undefined, undefined, view)
    expect(invalid).toMatchObject({ status: 'check-required', unresolvedRefs: ['not-executed'],
      resolvedRefs: [{ inputRef: 'stored-observation', callId: 'source-call' }] })
  })

  it('requires the concrete decision and controlled operation together without inferring them from nextCheck', () => {
    const args = { action: 'save', phase: 'assessment', title: 'Coverage', observations: [], interpretation: 'Population remains unknown.', nextCheck: 'Read another row.' }
    const operation = { name: 'evaluate', arguments: { mode: 'discard' } }
    expect(prepareCheckpoint(args, session, state, config, () => undefined).adoption).toEqual({ status: 'handoff-only' })
    expect(prepareCheckpoint({ ...args, pendingDecision: 'Discard missing rows.' }, session, state, config, () => undefined)).toMatchObject({ status: 'check-required', missingFields: ['dependentOperation'] })
    expect(prepareCheckpoint({ ...args, dependentOperation: operation }, session, state, config, () => undefined)).toMatchObject({ status: 'check-required', missingFields: ['pendingDecision'] })
    expect(prepareCheckpoint({ ...args, pendingDecision: 'Discard missing rows.', dependentOperation: operation }, session, state, config, () => undefined))
      .toMatchObject({ status: 'prepared', adoption: { status: 'prepared', dependentOperation: operation } })
    expect(prepareCheckpoint({ ...args, pendingDecision: 'Discard missing rows.', dependentOperation: { ...operation, name: 'uncontrolled' } }, session, state, config, () => undefined))
      .toMatchObject({ status: 'check-required', operationName: 'uncontrolled', allowedTools: ['evaluate'] })
  })
})
