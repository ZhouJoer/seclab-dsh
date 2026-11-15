import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ADOPTION_REASON, acceptedDecisionFromSession, adoptionPacket, commandFingerprint, completedDecisionReviewFromSession, decisionCandidate, parseAdoptionReview } from './adoption.mjs'

const config = { excludedTools: ['install'], checkTools: ['evaluate'], adoptionTools: ['evaluate'], maxEvidencePairs: 16, maxRequestBytes: 24000 }
const state = { sinceSeq: 0 }
const operation = { name: 'evaluate', arguments: { mode: 'drop-odd-candidates', path: 'catalog' } }
const minimalCheck = { name: 'evaluate', arguments: { mode: 'sample-omitted', path: 'catalog' } }
const decision = { action: 'save', phase: 'assessment', title: 'Parity filter',
  observations: [{ ref: 'source', description: 'The first three rows are even.' }],
  interpretation: 'Every row is even.', nextCheck: 'Read an omitted row.',
  pendingDecision: 'Drop every odd candidate from the search.', dependentOperation: operation }

function fixture() {
  const rows: Array<{ seq: number; time: number; type: string; data: object }> = []
  const event = (type: string, data: object) => {
    const row = { seq: rows.length + 1, time: rows.length + 1, type, data }
    rows.push(row)
    return row
  }
  const call = (name: string, id: string, args: object) => event('tool/call', { name, callId: id, arguments: JSON.stringify(args) })
  const result = (id: string, output: string, isError = false) => event('tool/result', {
    message: { toolCallId: id, isError, content: [{ type: 'text', text: output }] },
  })
  const settle = (name: string, id: string, output: string, exitCode = 0) => {
    const row = result(id, output)
    if (config.checkTools.includes(name)) event('user/message', { source: { kind: 'helper-checkpoint', summary: 'Premise execution receipt' },
      content: [{ type: 'text', text: JSON.stringify({ kind: 'premise-execution', version: 1, callId: id, toolName: name,
        contentSha256: createHash('sha256').update(JSON.stringify([{ type: 'text', text: output }])).digest('hex'),
        execution: { status: exitCode === 0 ? 'completed' : 'unavailable', issues: exitCode === 0 ? [] : ['nonzero-or-missing-exit'], exitCode } }) }] })
    return row
  }
  const evidence = (name: string, id: string, args: object, output: string, exitCode = 0) => {
    call(name, id, args)
    return settle(name, id, output, exitCode)
  }
  const save = (args: object = decision, status = 'saved') => {
    call('premise_check', 'save-' + rows.length, args)
    return result('save-' + (rows.length - 1), JSON.stringify({ status, scientificallyVerified: false }))
  }
  const assistant = (body: string, reasoning = '') => event('assistant/message', { message: { content: [
    { type: 'reasoning', text: reasoning }, { type: 'text', text: body },
  ] } })
  const session = { id: 'study', snapshotEvents: () => rows }
  return { rows, event, call, result, settle, evidence, save, assistant, session }
}

function withDecision() {
  const f = fixture()
  f.evidence('read_data', 'source', { path: 'catalog', selection: [0, 1, 2] }, 'rows=2,4,6; sampled=3; total=5')
  f.save()
  f.assistant('All rows are even, so discard the odd candidates.', 'SECRET reasoning is not review input')
  return f
}

const review = (overrides: object = {}) => ({ decision: 'check-required', rationale: 'Three sampled rows do not establish the parity of all five rows.',
  evidenceRefs: ['source'], nextCheck: 'Read an omitted row before discarding odd candidates.', check: minimalCheck, ...overrides })

describe('research-operation adoption packets', () => {
  it('keeps independent operation registrations and replaces only the same operation decision', () => {
    const f = withDecision()
    const original = adoptionPacket(operation, f.session, state, config)
    expect(adoptionPacket(minimalCheck, f.session, state, config)).toEqual({ status: 'no-decision' })
    f.save({ ...decision, dependentOperation: minimalCheck })
    expect(adoptionPacket(operation, f.session, state, config).basisKey).toBe(original.basisKey)
    expect(adoptionPacket(minimalCheck, f.session, state, config).basisKey).not.toBe(original.basisKey)
    f.save({ ...decision, interpretation: 'The original measurement does not cover the whole population.' })
    expect(adoptionPacket(operation, f.session, state, config).basisKey).not.toBe(original.basisKey)
    expect(adoptionPacket(minimalCheck, f.session, state, config).status).toBe('ready')
  })

  it('resolves native evidence IDs to original calls and labels the proposed operation as planned', () => {
    const f = withDecision()
    f.save({ ...decision, observations: [{ ref: 'native-evidence' }] })
    const view = { records: [{ kind: 'evidence', value: { id: 'native-evidence', source: { sessionId: f.session.id, callId: 'source' } } }] }
    const packet = adoptionPacket({ ...operation, callId: 'future-call' }, f.session, state, config, [], view)
    expect(packet.status).toBe('ready')
    expect(JSON.parse(packet.context)).toMatchObject({ proposedOperation: { status: 'planned', callId: 'future-call' },
      observations: [{ callId: 'source', evidenceIds: ['native-evidence'] }] })
    expect(parseAdoptionReview(JSON.stringify(review({ evidenceRefs: ['native-evidence'] })), packet, config))
      .toMatchObject({ status: 'reviewed', evidenceRefs: ['source'], referenceBindings: [{ inputRef: 'native-evidence', ref: 'source' }] })
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'supported', evidenceRefs: ['future-call'], check: undefined, nextCheck: '' })), packet, config).status).toBe('unreviewed')
  })

  it('automatically derives a confident saved decision without an unresolved submit', () => {
    const f = withDecision()
    expect(decisionCandidate(f.session, state)).toMatchObject({ source: 'saved-interpretation', claim: 'Every row is even.', pendingDecision: decision.pendingDecision })
    const packet = adoptionPacket(operation, f.session, state, config)
    expect(packet).toMatchObject({ status: 'ready', rawUsableRefs: ['source'] })
    expect(packet.reason).toContain(ADOPTION_REASON)
    const body = JSON.parse(packet.context)
    expect(body.observations[0].output).toBe('rows=2,4,6; sampled=3; total=5')
    expect(body.publicText).toContain('discard')
    expect(body).toMatchObject({ basisKey: packet.basisKey, toolFingerprint: packet.toolFingerprint,
      decisionSeq: packet.decisionSeq, userSeq: state.sinceSeq, allowedCheckTools: ['evaluate'] })
    expect(packet.context).not.toContain('SECRET')
    expect(body.proposedOperation.arguments).toEqual(operation.arguments)
  })

  it('does not turn setup, rejected saves, or a prior user request into a decision', () => {
    const f = fixture()
    f.evidence('install', 'setup', { package: 'parser' }, 'installed')
    f.save(decision, 'check-required')
    expect(adoptionPacket(operation, f.session, state, config).status).toBe('no-decision')
    f.save()
    const sinceSeq = f.rows.length
    f.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a different catalog.' }] })
    expect(decisionCandidate(f.session, { sinceSeq })).toBeUndefined()
  })

  it('records current tool schemas and invalidates an action review when parameters change without changing the decision', () => {
    const f = withDecision()
    const schema = { name: 'evaluate', description: 'Read a bounded catalog sample.',
      parameters: { type: 'object', properties: { mode: { type: 'string' }, path: { type: 'string' } }, required: ['mode', 'path'] } }
    const first = adoptionPacket(operation, f.session, state, config, [schema])
    expect(JSON.parse(first.context).allowedCheckToolSchemas).toEqual([schema])
    f.event('helper/auto-start', { consultationId: 'supported', question: { reason: first.reason, context: first.context } })
    f.event('helper/auto-end', { consultationId: 'supported', status: 'completed', answer: JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })) })
    expect(acceptedDecisionFromSession(f.session, state, config, first)).toMatchObject({ decision: 'supported' })
    const changed = adoptionPacket(operation, f.session, state, config, [{ ...schema,
      parameters: { ...schema.parameters, properties: { ...schema.parameters.properties, mode: { type: 'string', enum: ['inspect-only'] } } } }])
    expect(changed.basisKey).toBe(first.basisKey)
    expect(changed.reason).not.toBe(first.reason)
    expect(changed.checkToolSchemaKey).not.toBe(first.checkToolSchemaKey)
    expect(acceptedDecisionFromSession(f.session, state, config, changed)).toBeUndefined()
  })

  it('reads explicit supported decisions while keeping later legacy checkpoints as handoffs', () => {
    const f = withDecision()
    const assessment = { claim: 'All five rows were sampled.', pendingDecision: 'Use the bounded count.', scope: 'This five-row catalog',
      outcome: 'supported', dependentOperation: operation, evidenceRefs: ['source'], checkRefs: ['source'] }
    f.call('premise_check', 'submit', { action: 'submit', ...assessment })
    f.result('submit', JSON.stringify({ status: 'supported', assessment }))
    expect(decisionCandidate(f.session, state)).toMatchObject({ source: 'submitted-assessment', outcome: 'supported', refs: ['source'] })
    f.call('security_command', 'legacy', { command: JSON.stringify({ action: { kind: 'checkpoint', summary: 'Observation r2',
      reason: 'The finite sample bounds this estimate.', next: 'Measure the remaining rows.' } }) })
    f.result('legacy', JSON.stringify({ status: 'saved', bindings: [{ callId: 'source' }], receipt: { committed: true } }))
    expect(decisionCandidate(f.session, state).source).toBe('submitted-assessment')
    expect(adoptionPacket(operation, f.session, state, config)).toMatchObject({ status: 'ready', rawUsableRefs: ['source'] })
  })

  it('retains complete output and normalizes aliases and JSON argument order', () => {
    const f = withDecision()
    const first = adoptionPacket(operation, f.session, state, config)
    f.save({ ...decision, observations: [{ ref: 'r2' }, { ref: 'source' }] })
    const aliases = adoptionPacket({ name: operation.name, arguments: { path: 'catalog', mode: 'drop-odd-candidates' } }, f.session, state, config)
    expect(aliases.basisKey).toBe(first.basisKey)
    expect(aliases.toolFingerprint).toBe(first.toolFingerprint)
    expect(aliases.reason).toBe(first.reason)
    expect(JSON.parse(aliases.context).observations).toHaveLength(1)
    expect(commandFingerprint('evaluate', { a: [1, 2], b: { x: 1, y: 2 } }))
      .toBe(commandFingerprint('evaluate', { b: { y: 2, x: 1 }, a: [1, 2] }))
  })

  it('keeps evidence-list order from creating another paid review identity', () => {
    const f = withDecision()
    const second = f.evidence('read_data', 'second', { path: 'catalog-header' }, 'row count=5')
    f.save({ ...decision, observations: [{ ref: 'source' }, { ref: 'second' }] })
    const first = adoptionPacket(operation, f.session, state, config)
    f.save({ ...decision, observations: [{ ref: 'r' + second.seq }, { ref: 'r2' }] })
    expect(adoptionPacket(operation, f.session, state, config).reason).toBe(first.reason)
  })

  it('changes the review when new actual checks arrive while keeping the same decision basis', () => {
    const f = withDecision()
    const first = adoptionPacket(operation, f.session, state, config)
    f.evidence('evaluate', 'check', minimalCheck.arguments, 'omitted row=7')
    const changed = adoptionPacket(operation, f.session, state, config)
    expect(changed.basisKey).toBe(first.basisKey)
    expect(changed.reason).not.toBe(first.reason)
    expect(changed.rawUsableRefs).toEqual(['source', 'check'])
    expect(JSON.parse(changed.context).observations.at(-1)).toMatchObject({ relation: 'subsequent-check', output: 'omitted row=7' })
    f.evidence('install', 'setup2', { package: 'view' }, 'installed')
    expect(adoptionPacket(operation, f.session, state, config).reason).toBe(changed.reason)
  })

  it('does not turn its own denied operation into new evidence for another paid review', () => {
    const f = withDecision()
    const first = adoptionPacket(operation, f.session, state, config)
    f.call('evaluate', 'denied', operation.arguments)
    f.result('denied', 'ADOPTION_CHECK_REQUIRED: execute the proposed measurement first', true)
    const repeated = adoptionPacket(operation, f.session, state, config)
    expect(repeated.reason).toBe(first.reason)
    expect(repeated.evidenceEpoch).toBe(first.evidenceEpoch)
    expect(JSON.parse(repeated.context).observations).toHaveLength(1)
  })

  it('does not silently discard missing references, unavailable original execution or oversized data', () => {
    const f = withDecision()
    f.save({ ...decision, observations: [{ ref: 'wrong-id' }, { ref: 'source' }] })
    expect(adoptionPacket(operation, f.session, state, config)).toMatchObject({ status: 'unreviewed', missing: ['wrong-id'] })
    f.evidence('evaluate', 'failed', {}, 'Traceback: parse failed', 1)
    f.save({ ...decision, observations: [{ ref: 'failed' }] })
    const failed = adoptionPacket(operation, f.session, state, config)
    expect(failed).toMatchObject({ status: 'ready', rawUsableRefs: [] })
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'supported', evidenceRefs: ['failed'], check: undefined, nextCheck: '' })), failed, config).status).toBe('unreviewed')
    f.evidence('read_data', 'large', {}, '数据'.repeat(10000))
    f.save({ ...decision, observations: [{ ref: 'large' }] })
    expect(adoptionPacket(operation, f.session, state, config).status).toBe('unreviewed')
    expect(adoptionPacket(operation, f.session, state, { ...config, maxRequestBytes: 100000 }).context).toContain('数据'.repeat(10000))
  })

  it('preserves failed subsequent checks for interpretation without turning them into successful verification', () => {
    const f = withDecision()
    f.evidence('evaluate', 'check', minimalCheck.arguments, 'row unavailable: parser failed', 1)
    const packet = adoptionPacket(operation, f.session, state, config)
    expect(packet.status).toBe('ready')
    expect(JSON.parse(packet.context).observations.at(-1)).toMatchObject({ execution: { status: 'unavailable', exitCode: 1 } })
  })

  it('does not turn a legacy progress note or ordinary save into an adoption decision', () => {
    const f = fixture()
    f.evidence('read_data', 'source', {}, 'sample count=3')
    f.call('security_checkpoint', 'legacy', { summary: 'Three sampled rows', reason: 'Every row is even.', next: 'Read the omitted rows.' })
    f.result('legacy', JSON.stringify({ status: 'saved', receipt: { committed: true } }))
    f.save({ ...decision, pendingDecision: undefined, dependentOperation: undefined })
    expect(adoptionPacket(operation, f.session, state, config)).toEqual({ status: 'no-decision' })
    expect(decisionCandidate(f.session, state)).toBeUndefined()
  })

  it('allows raw observation or a suggested check without data, but cannot certify support from a decision reference alone', () => {
    const f = fixture()
    f.save({ ...decision, observations: [] })
    const packet = adoptionPacket(operation, f.session, state, config)
    expect(packet).toMatchObject({ status: 'ready', rawUsableRefs: [] })
    const evidenceRefs = [JSON.parse(packet.context).decision.ref]
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'observe', evidenceRefs, check: undefined, nextCheck: '' })), packet, config).decision).toBe('observe')
    expect(parseAdoptionReview(JSON.stringify(review({ evidenceRefs })), packet, config).decision).toBe('check-required')
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'supported', evidenceRefs, check: undefined, nextCheck: '' })), packet, config).status).toBe('unreviewed')
  })
})

describe('adoption review interpretation and proposed checks', () => {
  it.each(['supported', 'observe'])('accepts complete %s delivery when there is no experiment and nextCheck is omitted', decision => {
    const packet = adoptionPacket(operation, withDecision().session, state, config)
    const answer = JSON.stringify({ decision, rationale: 'The recorded observation supports this bounded operation.', evidenceRefs: ['source'] })
    expect(parseAdoptionReview(answer, packet, config)).toMatchObject({ status: 'reviewed', decision, nextCheck: '',
      scientificallyVerified: false, referenceStatus: 'complete', evidenceRefs: ['source'] })
    expect(parseAdoptionReview(JSON.stringify({ decision, rationale: 'Use the observation.', evidenceRefs: ['source'], nextCheck: null }), packet, config).status).toBe('unreviewed')
    expect(parseAdoptionReview(JSON.stringify({ decision, rationale: 'Use the observation.', evidenceRefs: ['invented'] }), packet, config))
      .toMatchObject({ status: 'unreviewed', referenceIssues: [{ inputRef: 'invented', issue: 'not-in-review-packet' }] })
  })

  it.each([
    { decision: 'check-required', check: minimalCheck },
    { decision: 'insufficient-evidence' },
    { decision: 'observe', check: minimalCheck },
  ])('rejects missing, empty or null experiment descriptions for $decision', extra => {
    const packet = adoptionPacket(operation, withDecision().session, state, config)
    for (const nextCheck of [undefined, '', '   ', null]) {
      const answer = JSON.stringify({ ...extra, rationale: 'The evidence leaves a concrete gap.', evidenceRefs: ['source'], nextCheck })
      expect(parseAdoptionReview(answer, packet, config).status).toBe('unreviewed')
    }
  })

  it.each(['check-required', 'observe'])('retains a %s check with explicit citation defects without accepting the original operation', decision => {
    const f = withDecision()
    const packet = adoptionPacket({ ...operation, callId: 'future-call' }, f.session, state, config)
    const answer = JSON.stringify(review({ decision, evidenceRefs: ['source', 'future-call', 'invented'] }))
    const parsed = parseAdoptionReview(answer, packet, config)
    expect(parsed).toMatchObject({ status: 'proposal-only', scientificallyVerified: false, check: minimalCheck,
      referenceStatus: 'partial', submittedEvidenceRefs: ['source', 'future-call', 'invented'], evidenceRefs: ['source'],
      referenceIssues: [{ inputRef: 'future-call', issue: 'planned-not-completed' }, { inputRef: 'invented', issue: 'not-in-review-packet' }] })
    f.event('helper/auto-start', { consultationId: 'partial-review', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'partial-review', status: 'completed', answer })
    expect(acceptedDecisionFromSession(f.session, state, config, packet)).toBeUndefined()
    f.evidence('evaluate', 'checked', minimalCheck.arguments, 'omitted row=7')
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
  })

  it('keeps observe with an independent next check usable without certifying either operation', () => {
    const f = withDecision()
    const packet = adoptionPacket(operation, f.session, state, config)
    const answer = JSON.stringify(review({ decision: 'observe' }))
    expect(parseAdoptionReview(answer, packet, config)).toMatchObject({ status: 'reviewed', decision: 'observe', check: minimalCheck })
    f.event('helper/auto-start', { consultationId: 'observation-review', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'observation-review', status: 'completed', answer })
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'observe', check: operation })), packet, config).status).toBe('unreviewed')
  })

  it('normalizes a nextCheck object only when it exactly repeats the required check', () => {
    const f = withDecision()
    const packet = adoptionPacket(operation, f.session, state, config)
    const answer = JSON.stringify(review({ nextCheck: { arguments: { path: 'catalog', mode: 'sample-omitted' }, name: 'evaluate' } }))
    const parsed = parseAdoptionReview(answer, packet, config)
    expect(parsed).toMatchObject({ status: 'reviewed', decision: 'check-required', check: minimalCheck })
    expect(JSON.parse(parsed.nextCheck)).toEqual(minimalCheck)
    f.event('helper/auto-start', { consultationId: 'review', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'review', status: 'completed', answer })
    expect(acceptedDecisionFromSession(f.session, state, config, packet)).toBeUndefined()
  })

  it.each([
    ['different experiment', { nextCheck: operation }],
    ['missing check', { nextCheck: minimalCheck, check: undefined }],
    ['supported decision', { decision: 'supported', nextCheck: minimalCheck }],
  ] as const)('rejects an object nextCheck with a %s', (_label, overrides) => {
    const packet = adoptionPacket(operation, withDecision().session, state, config)
    expect(parseAdoptionReview(JSON.stringify(review(overrides)), packet, config).status).toBe('unreviewed')
  })

  it('requires source-linked complete verdicts and a permissible proposed check', () => {
    const packet = adoptionPacket(operation, withDecision().session, state, config)
    expect(parseAdoptionReview(JSON.stringify(review({ evidenceRefs: ['r2'] })), packet, config))
      .toMatchObject({ status: 'reviewed', decision: 'check-required', scientificallyVerified: false, evidenceRefs: ['source'] })
    for (const verdict of [review({ evidenceRefs: ['invented'] }), review({ check: undefined }), review({ nextCheck: '' }),
      review({ decision: 'observe', evidenceRefs: ['toString'], check: undefined, nextCheck: '' }),
      review({ decision: 'observe', evidenceRefs: ['constructor'], check: undefined, nextCheck: '' }),
      review({ decision: 'observe', evidenceRefs: ['__proto__'], check: undefined, nextCheck: '' }),
      review({ check: { name: 'write', arguments: { text: 'assertion=true' } } }), review({ check: operation }),
      review({ check: { name: 'evaluate', arguments: 'bad' } })])
      expect(parseAdoptionReview(JSON.stringify(verdict), packet, config).status).toBe('unreviewed')
    for (const answer of ['', '{"decision":', '{}']) expect(parseAdoptionReview(answer, packet, config).status).toBe('unreviewed')
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })), packet, config))
      .toMatchObject({ status: 'reviewed', decision: 'supported', scientificallyVerified: false })
    expect(parseAdoptionReview(JSON.stringify(review({ decision: 'observe', check: undefined, nextCheck: '' })), packet, config).decision).toBe('observe')
  })

  it('keeps both support and observation permissions limited to the reviewed operation', () => {
    const f = withDecision()
    const packet = adoptionPacket(operation, f.session, state, config)
    f.event('helper/auto-start', { consultationId: 'observing', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'observing', status: 'completed', answer: JSON.stringify(review({ decision: 'observe', check: undefined, nextCheck: '' })) })
    expect(acceptedDecisionFromSession(f.session, state, config, packet)).toMatchObject({ decision: 'observe', scientificallyVerified: false })
    const other = adoptionPacket(minimalCheck, f.session, state, config)
    expect(acceptedDecisionFromSession(f.session, state, config, other)).toBeUndefined()
    f.event('helper/auto-start', { consultationId: 'supported', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'supported', status: 'completed', answer: JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })) })
    expect(acceptedDecisionFromSession(f.session, state, config, packet)).toMatchObject({ decision: 'supported' })
    expect(acceptedDecisionFromSession(f.session, state, config, other)).toBeUndefined()
    f.save({ ...decision, interpretation: 'Only half the rows are even.' })
    expect(acceptedDecisionFromSession(f.session, state, config, adoptionPacket(operation, f.session, state, config))).toBeUndefined()
  })

  it('invalidates a prior support permission after a newer required check or failed review', () => {
    const f = withDecision()
    const packet = adoptionPacket(operation, f.session, state, config)
    f.event('helper/auto-start', { consultationId: 'supported', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'supported', status: 'completed', answer: JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })) })
    f.event('helper/auto-start', { consultationId: 'later', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'later', status: 'completed', answer: JSON.stringify(review()) })
    expect(acceptedDecisionFromSession(f.session, state, config, packet)).toBeUndefined()
    f.event('helper/auto-start', { consultationId: 'failed', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'failed', status: 'failed', answer: '' })
    expect(acceptedDecisionFromSession(f.session, state, config, packet)).toBeUndefined()
  })

  it('invalidates support after a new original result even without a new saved decision', () => {
    const f = withDecision()
    const packet = adoptionPacket(operation, f.session, state, config)
    f.event('helper/auto-start', { consultationId: 'supported', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'supported', status: 'completed', answer: JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })) })
    f.evidence('read_data', 'unexpected', { path: 'catalog', selection: [4] }, 'row=7')
    const changed = adoptionPacket(operation, f.session, state, config)
    expect(changed.basisKey).toBe(packet.basisKey)
    expect(changed.reason).not.toBe(packet.reason)
    expect(JSON.parse(changed.context).observations.at(-1).output).toBe('row=7')
    expect(acceptedDecisionFromSession(f.session, state, config, changed)).toBeUndefined()
  })

  it('records the reviewed operation after execution without authorizing unrelated later scripts', () => {
    const f = withDecision()
    f.call('evaluate', 'first-reviewed', operation.arguments)
    const packet = adoptionPacket({ ...operation, callId: 'first-reviewed' }, f.session, state, config)
    f.event('helper/auto-start', { consultationId: 'review', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'review', status: 'completed', answer: JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })) })
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
    f.settle('evaluate', 'first-reviewed', 'bounded operation completed')
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toMatchObject({
      status: 'decision-reviewed', reviewDecision: 'supported', operationCallId: 'first-reviewed', scientificallyVerified: false,
    })
    for (let i = 0; i < 20; i++) {
      const next = { name: 'evaluate', arguments: { mode: 'continue-inspection', segment: i } }
      const nextPacket = adoptionPacket(next, f.session, state, config)
      expect(nextPacket).toEqual({ status: 'no-decision' })
      expect(completedDecisionReviewFromSession(f.session, state, config, nextPacket)).toBeUndefined()
      f.evidence('evaluate', 'continuation-' + i, next.arguments, 'segment ' + i + ' inspected')
    }
    expect(f.rows.filter(row => row.type === 'helper/auto-start')).toHaveLength(1)
    f.save({ ...decision, observations: [{ ref: 'r2' }] })
    expect(completedDecisionReviewFromSession(f.session, state, config, adoptionPacket(operation, f.session, state, config))).toMatchObject({ status: 'decision-reviewed' })
    f.save({ ...decision, interpretation: 'Every value in every file is even.' })
    expect(completedDecisionReviewFromSession(f.session, state, config, adoptionPacket(operation, f.session, state, config))).toBeUndefined()
  })

  it('does not turn a successfully executed observation into support for later dependent work', () => {
    const f = withDecision()
    f.call('evaluate', 'collect-only', minimalCheck.arguments)
    const packet = adoptionPacket({ ...minimalCheck, callId: 'collect-only' }, f.session, state, config)
    f.event('helper/auto-start', { consultationId: 'observe', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'observe', status: 'completed', answer: JSON.stringify(review({ decision: 'observe', check: undefined, nextCheck: '' })) })
    f.settle('evaluate', 'collect-only', 'collected an unclassified sample')
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
    const dependent = adoptionPacket(operation, f.session, state, config)
    expect(completedDecisionReviewFromSession(f.session, state, config, dependent)).toBeUndefined()
    expect(acceptedDecisionFromSession(f.session, state, config, dependent)).toBeUndefined()
  })

  it('does not close the first-adoption review with a different action, failed execution or an unresolved later review', () => {
    const f = withDecision()
    f.call('evaluate', 'first-reviewed', operation.arguments)
    const packet = adoptionPacket({ ...operation, callId: 'first-reviewed' }, f.session, state, config)
    f.event('helper/auto-start', { consultationId: 'review', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'review', status: 'completed', answer: JSON.stringify(review({ decision: 'supported', check: undefined, nextCheck: '' })) })
    f.evidence('evaluate', 'different', { mode: 'unrelated' }, 'completed')
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
    f.settle('evaluate', 'first-reviewed', 'failed to read file', 1)
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
    f.evidence('evaluate', 'retry-reviewed', operation.arguments, 'bounded operation completed')
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toMatchObject({ operationCallId: 'retry-reviewed' })
    f.event('helper/auto-start', { consultationId: 'later', question: { reason: packet.reason, context: packet.context } })
    f.event('helper/auto-end', { consultationId: 'later', status: 'completed', answer: JSON.stringify(review()) })
    expect(completedDecisionReviewFromSession(f.session, state, config, packet)).toBeUndefined()
    expect(completedDecisionReviewFromSession(f.session, { sinceSeq: f.rows.length }, config, packet)).toBeUndefined()
  })
})
