/** Evidence selection and source-linked corrections for public research handoffs. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { handoffPacket, parseHandoffReview } from './handoff.mjs'
import { answerLiterals } from './handoff-selection.mjs'

type Event = { seq: number; time: number; type: string; data: Record<string, unknown> }
const config = { excludedTools: [], checkTools: ['pwsh'], maxEvidencePairs: 16, handoffMaxRecentEvidencePairs: 2,
  handoffMaxMatchedEvidencePairs: 6, handoffMaxMatchLiterals: 32, completionMaxRequestBytes: 64000 }
const state = { sinceSeq: 1, evidence: [] }
const event = (seq: number, type: string, data: Record<string, unknown>): Event => ({ seq, time: seq * 1000, type, data })
const user = (seq: number) => event(seq, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Investigate the supplied dataset.' }] })
const tool = (seq: number, callId: string, output: string, name = 'read_data', isError = false) => [
  event(seq, 'tool/call', { name, callId, arguments: '{"path":"dataset"}' }),
  event(seq + 1, 'tool/result', { message: { toolCallId: callId, isError, content: [{ type: 'text', text: output }] } }),
]
const final = (seq: number, output: string, finish = 'stop') => event(seq, 'assistant/message', {
  message: { content: [{ type: 'text', text: output }, { type: 'reasoning', text: 'Private text must not enter the handoff packet.' }] },
  stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [output] },
    { type: 'chunk', chunk: { type: 'finish', reason: { kind: finish } } }],
})
const saved = (seq: number, sourceRefs: string[] = ['call_raw'], reason = 'UNVERIFIED: All source rows may be even.') => {
  const value = { status: 'saved', scientificallyVerified: false,
    checkpoint: { phase: 'assessment', title: 'Population parity', summary: 'Analyst description: sample contains even rows.', reason,
      next: 'Scan all rows before excluding odd records.' }, bindings: sourceRefs.map((callId, i) => ({ ref: 'r' + (3 + 2 * i), callId })) }
  return [event(seq, 'tool/call', { name: 'premise_check', callId: 'call_save_' + seq,
    arguments: JSON.stringify({ action: 'save', observations: sourceRefs.map(ref => ({ ref, description: 'Sample observation.' })), interpretation: reason }) }),
  event(seq + 1, 'tool/result', { message: { toolCallId: 'call_save_' + seq, content: [{ type: 'text', text: JSON.stringify(value) }] } })]
}
const session = (events: Event[]) => ({ id: 'handoff-session', header: { cwd: '/workspace' }, snapshotEvents: () => events })
const fixture = (answer = 'Verified: all rows are even. The task remains incomplete.') => session([
  user(1), ...tool(2, 'call_raw', 'sample=2,4,6; coverage=3/5'), ...saved(4), final(6, answer),
])

describe('research handoff evidence', () => {
  it('reviews complete relevant sources when a saved note references more original output than fits', () => {
    const raw = Array.from({ length: 9 }, (_, index) => tool(2 + index * 2, 'call_source_' + index,
      JSON.stringify({ source: index, measurements: 'x'.repeat(9000) }))).flat()
    const source = session([user(1), ...raw, ...saved(20, Array.from({ length: 9 }, (_, index) => 'call_source_' + index)),
      final(22, 'r3 measures the first source; the remaining interpretation is provisional.')])
    const packet = handoffPacket(source, state, config)
    expect(packet.status).toBe('ready')
    expect(Buffer.byteLength(packet.context)).toBeLessThanOrEqual(config.completionMaxRequestBytes)
    const body = JSON.parse(packet.context)
    expect(body.observations.some((item: { ref: string }) => item.ref === 'r3')).toBe(true)
    expect(body.observations.length).toBeGreaterThan(1)
    expect(body.observations.length).toBeLessThan(9)
    for (const observation of body.observations) expect(JSON.parse(observation.output).measurements).toHaveLength(9000)
    expect(body.coverage.completeForSelectedRecords).toBe(true)
    expect(body.coverage.completeForCandidateRecords).toBe(false)
    expect(body.coverage.omitted).toEqual(expect.arrayContaining([expect.objectContaining({
      ref: expect.stringMatching(/^r\d+$/), callId: expect.stringMatching(/^call_/),
      resultSha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: expect.any(Number), reason: 'byte-budget',
    })]))
    const omitted = body.coverage.omitted.find((item: { callId: string }) => item.callId.startsWith('call_source_'))
    expect(packet.refs).not.toContain(omitted.callId)
    expect(body.coverage.unresolvedRefs).toEqual([])
    expect(parseHandoffReview(JSON.stringify({ decision: 'allow', rationale: 'Only included observations were reviewed.',
      evidenceRefs: ['r3'], corrections: [] }), packet)).toMatchObject({ status: 'reviewed', coverage: { completeForCandidateRecords: false } })
    expect(parseHandoffReview(JSON.stringify({ decision: 'allow', rationale: 'Missing body cannot support the claim.',
      evidenceRefs: [omitted.callId], corrections: [] }), packet).status).toBe('unreviewed')
  })

  it('retains a logged producer version with its output even when the execution failed', () => {
    const code = 'import struct\nprint(struct.unpack("<H", b"\\x01\\x00")[0])\nraise ValueError("partial")\n'
    const writes = [event(2, 'tool/call', { name: 'write', callId: 'call_write',
      arguments: JSON.stringify({ file_path: '/workspace/parse.py', content: code }) }),
    event(3, 'tool/result', { message: { toolCallId: 'call_write', isError: false, content: [{ type: 'text', text: 'written' }] } })]
    const execution = tool(4, 'call_raw', '1\nValueError: partial\n[exit code: 1]', 'pwsh', true)
    execution[0]!.data.arguments = JSON.stringify({ command: 'python /workspace/parse.py' })
    const packet = handoffPacket(session([user(1), ...writes, ...execution, ...saved(6),
      final(8, 'r5 observed 1 before the parser failed; a complete parse remains unverified.')]), state, config)
    expect(packet.status).toBe('ready')
    const observation = JSON.parse(packet.context).observations.find((item: { callId: string }) => item.callId === 'call_raw')
    expect(observation).toMatchObject({ isError: true, producer: { status: 'available', kind: 'file', code,
      callId: 'call_write', callSeq: 2, resultSeq: 3, codeSha256: createHash('sha256').update(code).digest('hex') } })
    expect(packet.refs).toContain('r3')
  })

  it('retains the old producer and marks an explicitly reused old observation as old', () => {
    const code = 'print("older observation")'
    const execution = tool(4, 'call_old', 'older observation', 'pwsh')
    execution[0]!.data.arguments = JSON.stringify({ command: 'python /workspace/old.py' })
    const packet = handoffPacket(session([user(1), event(2, 'tool/call', { name: 'write', callId: 'call_write',
      arguments: JSON.stringify({ file_path: '/workspace/old.py', content: code }) }),
    event(3, 'tool/result', { message: { toolCallId: 'call_write', content: [{ type: 'text', text: 'written' }] } }),
    ...execution, user(6), ...tool(7, 'call_current', 'fresh result'), ...saved(9, ['call_current']),
    final(11, 'r5 is the earlier observation; r8 is the current result, despite the provisional saved interpretation.')]),
    { ...state, sinceSeq: 6 }, config)
    const observations = JSON.parse(packet.context).observations
    expect(observations.find((item: { callId: string }) => item.callId === 'call_old')).toMatchObject({
      currentRequest: false, producer: { code } })
    expect(observations.find((item: { callId: string }) => item.callId === 'call_current')).toMatchObject({ currentRequest: true })
  })

  it('keeps inline code in complete command arguments and exposes unavailable file producers', () => {
    const inline = tool(2, 'call_inline', 'selected=0', 'pwsh')
    inline[0]!.data.arguments = JSON.stringify({ command: 'python -c "print(0)"' })
    const unknown = tool(4, 'call_unknown', 'count=3', 'pwsh')
    unknown[0]!.data.arguments = JSON.stringify({ command: 'python /workspace/unlogged.py' })
    const packet = handoffPacket(session([user(1), ...inline, ...unknown, ...saved(6, ['call_inline', 'call_unknown']),
      final(8, 'r3 returned zero; r5 returned three; neither establishes that the parsers are correct.')]), state, config)
    const observations = JSON.parse(packet.context).observations
    expect(observations[0]).toMatchObject({ arguments: inline[0]!.data.arguments,
      producer: { status: 'available', kind: 'inline', codeLocation: 'arguments' } })
    expect(observations[0].producer.code).toBeUndefined()
    expect(observations[1]).toMatchObject({ producer: { status: 'not-reconstructed' } })
  })

  it('budgets the complete producer and result together and never implies that an oversized answer was reviewed', () => {
    const code = '# parser\n' + 'x'.repeat(65000)
    const execution = tool(4, 'call_raw', 'count=3', 'pwsh')
    execution[0]!.data.arguments = JSON.stringify({ command: 'python /workspace/parse.py' })
    const source = session([user(1), event(2, 'tool/call', { name: 'write', callId: 'call_write',
      arguments: JSON.stringify({ file_path: '/workspace/parse.py', content: code }) }),
    event(3, 'tool/result', { message: { toolCallId: 'call_write', content: [{ type: 'text', text: 'written' }] } }),
    ...execution, ...saved(6), final(8, 'r5 reports three records.')])
    const packet = handoffPacket(source, state, config)
    expect(packet).toMatchObject({ status: 'unreviewed', omitted: [expect.objectContaining({ ref: 'r5', reason: 'byte-budget' })] })
    expect(packet.context).toBeUndefined()
    const hugeAnswer = handoffPacket(fixture('r3 ' + 'x'.repeat(65000)), state, config)
    expect(hugeAnswer).toMatchObject({ status: 'unreviewed', maxRequestBytes: 64000 })
    expect(hugeAnswer.requestBytes).toBeGreaterThan(64000)
  })

  it('locates named versions with whitespace without matching an unrelated bare count', () => {
    const source = session([user(1), ...tool(2, 'call_version', 'detected runtime .NET   8.0'),
      ...tool(4, 'call_noise', 'offset=40 unrelated rows'), ...tool(6, 'call_current', 'current measurement'),
      ...saved(8, ['call_current']), final(10, 'The `.NET 8` classification and 40 packets need verification.')])
    const packet = handoffPacket(source, state, { ...config, handoffMaxRecentEvidencePairs: 0 })
    const body = JSON.parse(packet.context)
    expect(body.observations.map((item: { callId: string }) => item.callId)).toContain('call_version')
    expect(body.observations.map((item: { callId: string }) => item.callId)).not.toContain('call_noise')
    expect(body.coverage.literalLookup.literals.some((literal: { value: string }) => literal.value === '40')).toBe(false)
  })

  it('retrieves an earlier named numeric observation instead of treating another filename number as a contradiction', () => {
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_identity', 'PRSTATUS pid=731; ppid=8'),
      ...tool(4, 'call_filename', 'dump.991.core'), ...tool(6, 'call_latest', 'current state'),
      ...saved(8, ['call_latest']), final(10, 'Observed PID 731, ppid 8; the dump filename contains 991.')]), state,
    { ...config, handoffMaxMatchedEvidencePairs: 1, handoffMaxRecentEvidencePairs: 0 })
    const body = JSON.parse(packet.context)
    expect(body.observations).toEqual(expect.arrayContaining([expect.objectContaining({ callId: 'call_identity', currentRequest: true,
      output: 'PRSTATUS pid=731; ppid=8' })]))
    expect(body.observations.some((item: { callId: string }) => item.callId === 'call_filename')).toBe(false)
    expect(body.coverage.literalLookup.literals).toContainEqual(expect.objectContaining({ kind: 'named-number', label: 'PID', number: '731' }))
  })

  it('matches numeric JSON fields by label and value while rejecting an unrelated bare number', () => {
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_identity', '{"tid":73,"port":8087}'),
      ...tool(4, 'call_other', 'offset=73; value=8087'), ...tool(6, 'call_latest', 'done'), ...saved(8, ['call_latest']),
      final(10, 'TID=73 used port 8087; the process-level explanation remains provisional.')]), state,
    { ...config, handoffMaxRecentEvidencePairs: 0 })
    const body = JSON.parse(packet.context)
    expect(body.observations.map((item: { callId: string }) => item.callId)).toContain('call_identity')
    expect(body.observations.map((item: { callId: string }) => item.callId)).not.toContain('call_other')
  })

  it('does not turn a version prefix into a numeric identifier', () => {
    expect(answerLiterals('Engine 12.3preview and PID 73', 32)).toEqual([
      expect.objectContaining({ kind: 'named-number', label: 'PID', number: '73' }),
    ])
  })

  const digest = 'a1b2c3d4'.repeat(4)
  it.each([digest.toUpperCase(), 'a1b2c3d4…', '`a1b2c3d4...`'])(
    'retrieves both complete digest records under a bounded extra-source quota for %s', spelling => {
      const source = session([user(1), ...tool(2, 'call_manifest', 'archive index: ' + digest),
        ...tool(4, 'call_observed', 'measured bytes: ' + digest, 'pwsh'),
        ...tool(6, 'call_partial', 'a1b2c3d4xyz-tool ' + digest + 'zz'),
        ...tool(8, 'call_kind', 'named release stable'), ...tool(10, 'call_recent', 'status ready'),
        final(12, 'Inspect r9, `release stable` and digest ' + spelling + '. The measured association remains provisional.')])
      const packet = handoffPacket(source, state, { ...config, handoffMaxMatchedEvidencePairs: 2,
        handoffMaxRecentEvidencePairs: 1 })
      expect(packet.status).toBe('ready')
      expect(JSON.parse(packet.context).observations.map((item: { callId: string }) => item.callId))
        .toEqual(['call_manifest', 'call_observed', 'call_kind', 'call_recent'])
    })

  it('requires an explicit abbreviation for a short unquoted digest and never promotes bare counts', () => {
    expect(answerLiterals('a1b2c3d4 ff12… 12345678… xyz' + digest, 32)).toEqual([])
  })

  it('keeps explicitly cited observations ahead of an incidental digest match', () => {
    const source = session([user(1), ...tool(2, 'call_digest', digest), ...tool(4, 'call_cited', 'original observation'),
      final(6, 'Keep r5; the unrelated digest is ' + digest + '.')])
    const packet = handoffPacket(source, state, { ...config, maxEvidencePairs: 1, handoffMaxRecentEvidencePairs: 0 })
    expect(JSON.parse(packet.context).observations.map((item: { callId: string }) => item.callId)).toEqual(['call_cited'])
  })

  it('preserves the named measurement when digest matches compete for the remaining bytes', () => {
    const source = session([user(1), ...tool(2, 'call_named', 'process_id=731'),
      ...tool(4, 'call_hash', digest + ' release stable'), ...saved(6, []),
      final(8, 'Observed process_id=731 and `release stable` with digest ' + digest + '.')])
    const packet = handoffPacket(source, state, { ...config, maxEvidencePairs: 1, handoffMaxRecentEvidencePairs: 0 })
    expect(JSON.parse(packet.context).observations.map((item: { callId: string }) => item.callId)).toEqual(['call_named'])
  })

  it('keeps the recent failed check and its formatted producer when an older numeric match is too large', () => {
    const code = 'print("malformed length=90000")'
    const execution = tool(6, 'call_check', 'malformed length=90000', 'pwsh')
    execution[0]!.data.arguments = JSON.stringify({ command: 'python /workspace/check.py 2>&1 | Out-String -Width 200' })
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_old', 'pid=731 ' + 'x'.repeat(12000)),
      event(4, 'tool/call', { name: 'write', callId: 'call_write', arguments: JSON.stringify({ file_path: '/workspace/check.py', content: code }) }),
      event(5, 'tool/result', { message: { toolCallId: 'call_write', content: [{ type: 'text', text: 'written' }] } }),
      ...execution, ...saved(8, ['call_check']), final(10, 'PID 731 was observed earlier; the latest extraction failed validation.')]), state,
    { ...config, completionMaxRequestBytes: 6500 })
    const body = JSON.parse(packet.context)
    expect(body.observations).toMatchObject([{ callId: 'call_check', producer: { code,
      invocation: { formatting: { kind: 'powershell-out-string', width: 200 } } } }])
    expect(body.coverage.omitted).toContainEqual(expect.objectContaining({ callId: 'call_old', reason: 'byte-budget' }))
  })

  it('prefers a complete direct observation over a larger derived result when both are explicitly cited', () => {
    const derived = tool(2, 'call_derived', 'derived_value=7; ' + 'x'.repeat(6000), 'pwsh')
    derived[0]!.data.arguments = JSON.stringify({ command: 'python -c "print(7)"' })
    const packet = handoffPacket(session([user(1), ...derived, ...tool(4, 'call_raw', 'original_value=9'),
      final(6, 'r3 and r5 disagree; the derivation remains unverified.')]), state,
    { ...config, handoffMaxRecentEvidencePairs: 0, completionMaxRequestBytes: 6500 })
    expect(packet.status).toBe('ready')
    const body = JSON.parse(packet.context)
    expect(body.observations).toMatchObject([{ callId: 'call_raw', output: 'original_value=9' }])
    expect(body.coverage.omitted).toContainEqual(expect.objectContaining({ callId: 'call_derived', reason: 'byte-budget' }))
  })

  it('recovers old original values reused in the final answer without calling literal matches proof', () => {
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_identity', 'image id=ab12cd34ef56; compared id=ab12cd34ef56'),
      ...tool(4, 'call_stack', 'return=0x45ab; observed earlier'), user(6), ...tool(7, 'call_recent', 'current status'),
      ...saved(9, ['call_recent']), final(11, 'Previously matched `ab12cd34…`; return 0x45AB, as summarized in r10.')]),
    { ...state, sinceSeq: 6 }, config)
    expect(packet.status).toBe('ready')
    const body = JSON.parse(packet.context)
    expect(body.coverage.literalLookup.addedRefs).toEqual(expect.arrayContaining(['r3', 'r5']))
    expect(body.coverage.literalLookup.policy).toContain('do not support a claim')
    expect(body.observations.find((item: { callId: string }) => item.callId === 'call_identity')).toMatchObject({ currentRequest: false })
    expect(body.observations.find((item: { callId: string }) => item.callId === 'call_stack').output).toBe('return=0x45ab; observed earlier')
  })

  it('limits old-source retrieval without trimming any included original record', () => {
    const raw = 'identifier=feed1234; ' + 'x'.repeat(10000)
    const source = session([user(1), ...tool(2, 'call_large', raw), ...tool(4, 'call_small', 'token=beef5678'),
      ...tool(6, 'call_latest', 'status pending'), ...saved(8, ['call_latest']),
      final(10, 'r9 retains `feed1234` and `beef5678`; both require their original sources.')])
    const packet = handoffPacket(source, state, { ...config, handoffMaxRecentEvidencePairs: 0, completionMaxRequestBytes: 6000 })
    expect(packet.status).toBe('ready')
    const body = JSON.parse(packet.context)
    expect(body.observations.map((item: { callId: string }) => item.callId)).toEqual(['call_small', 'call_latest'])
    expect(body.coverage.literalLookup.omitted).toContainEqual({ ref: 'r3', reason: 'byte-budget' })
    expect(body.observations.find((item: { callId: string }) => item.callId === 'call_small').output).toBe('token=beef5678')
    expect(packet.context).not.toContain('[... truncated ...]')
  })

  it('does not use a literal match to introduce a review for setup-only work or certify a fabricated claim', () => {
    const setup = session([user(1), ...tool(2, 'call_setup', 'installed version 0x1234'), final(4, 'Installed version 0x1234.')])
    expect(handoffPacket(setup, state, config).status).toBe('no-decision')
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_raw', 'failed input abcdef12; result not verified'),
      ...saved(4), final(6, 'Verified result `abcdef12`.')]), state, config)
    expect(JSON.parse(packet.context).observations[0].output).toContain('not verified')
    expect(packet.scientificallyVerified).toBeUndefined()
  })

  it('retains a completed assessment without requiring an adopted-operation registration', () => {
    const assessment = { status: 'contradicted', assessment: { claim: 'Every row is even.', scope: 'The measured rows.',
      evidenceRefs: ['call_raw'], checkRefs: ['call_check'], outcome: 'contradicted' } }
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_raw', 'sample=2,4,6; coverage=3/5'),
      ...tool(4, 'call_check', 'rows=2,4,6,7,8; coverage=5/5'), ...tool(6, 'call_assessment', JSON.stringify(assessment), 'premise_check'),
      final(8, 'The full scan includes an odd row; the universal claim was contradicted.')]), state, config)
    expect(packet.status).toBe('ready')
    expect(JSON.parse(packet.context).decisions).toMatchObject([{ kind: 'model-assessment', record: assessment }])
  })

  it('includes the partial final answer, saved uncertainty, and actual output behind its description', () => {
    const packet = handoffPacket(fixture(), state, config)
    expect(packet).toMatchObject({ status: 'ready', answerSeq: 6, userSeq: 1 })
    expect(packet.refs).toEqual(expect.arrayContaining(['call_raw', 'r3', 'call_save_4', 'r5']))
    const body = JSON.parse(packet.context)
    expect(body.answer.text).toContain('task remains incomplete')
    expect(body.decisions[0].record.checkpoint.reason).toContain('UNVERIFIED')
    expect(body.observations[0]).toMatchObject({ callId: 'call_raw', output: 'sample=2,4,6; coverage=3/5', currentRequest: true })
    expect(packet.context).not.toContain('Private text')
  })

  it('keeps a mismatched description separate from the original output instead of certifying the citation', () => {
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_raw', 'extracted:'),
      ...saved(4, ['call_raw'], 'UNVERIFIED: Source layouts match byte for byte.'), final(6, 'Verified: source layouts match byte for byte.')]), state, config)
    expect(packet.status).toBe('ready')
    const body = JSON.parse(packet.context)
    expect(body.decisions[0].record.checkpoint.reason).toContain('layouts match')
    expect(body.observations[0].output).toBe('extracted:')
    expect(body.coverage.warning).toContain('not independent evidence')
  })

  it('retains partial observations and failed execution status for a bounded correction', () => {
    const output = 'count=3\nValueError after counting the first segment'
    const source = tool(2, 'call_raw', output, 'pwsh')
    const receipt = event(4, 'user/message', { source: { kind: 'helper-checkpoint', summary: 'Premise execution receipt' },
      content: [{ type: 'text', text: JSON.stringify({ kind: 'premise-execution', version: 1, callId: 'call_raw', toolName: 'pwsh',
        contentSha256: createHash('sha256').update(JSON.stringify([{ type: 'text', text: output }])).digest('hex'),
        execution: { status: 'unavailable', issues: ['nonzero-or-missing-exit'], exitCode: 1 } }) }] })
    const packet = handoffPacket(session([user(1), ...source, receipt, ...saved(5), final(7, 'The first segment has three records; the full scan failed.')]), state, config)
    expect(packet.status).toBe('ready')
    expect(JSON.parse(packet.context).observations[0]).toMatchObject({ output, isError: false,
      execution: { status: 'unavailable', exitCode: 1 } })
  })

  it('does not start a review for setup-only work without a recorded decision or explicit source citation', () => {
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_install', 'installed dependency', 'pwsh'), final(4, 'The environment is ready.')]), state, config)
    expect(packet.status).toBe('no-decision')
  })

  it('keeps explicit old evidence labeled as old and does not revive old unreferenced decisions', () => {
    const events = [...fixture().snapshotEvents(), user(10), ...tool(11, 'call_current', 'current measurement unavailable'),
      final(13, 'The earlier r3 observation sampled three rows. No new complete scan was executed.')]
    const packet = handoffPacket(session(events), { ...state, sinceSeq: 10 }, config)
    expect(packet.status).toBe('ready')
    const body = JSON.parse(packet.context)
    expect(body.decisions).toEqual([])
    expect(body.observations.find((item: { callId: string }) => item.callId === 'call_raw')).toMatchObject({ currentRequest: false })
    expect(body.observations.find((item: { callId: string }) => item.callId === 'call_current')).toMatchObject({ currentRequest: true })
    expect(handoffPacket(session([...fixture().snapshotEvents(), user(10), final(11, 'Ready for the next dataset.')]), state, config).status).toBe('no-decision')
  })

  it('reports missing references and does not silently trim oversized original output', () => {
    const missing = handoffPacket(session([user(1), final(2, 'Verified by r9999 and call_missing.')]), state, config)
    expect(missing).toMatchObject({ status: 'unreviewed', unresolvedRefs: ['r9999', 'call_missing'] })
    const large = handoffPacket(session([user(1), ...tool(2, 'call_raw', 'x'.repeat(65000)), ...saved(4), final(6, 'Observed a large source.')]), state, config)
    expect(large).toMatchObject({ status: 'unreviewed', maxRequestBytes: 64000 })
    expect(large.requestBytes).toBeGreaterThan(64000)
    expect(large.context).toBeUndefined()
  })

  it('includes cited evidence outside the recent window and identifies unselected older observations', () => {
    const packet = handoffPacket(session([user(1), ...tool(2, 'call_raw', 'old cited raw output'),
      ...tool(4, 'call_uncited', 'uncited source'), ...tool(6, 'call_recent_a', 'recent A'), ...tool(8, 'call_recent_b', 'recent B'),
      final(10, 'r3 records the source; the final interpretation is provisional.')]), state, config)
    expect(packet.status).toBe('ready')
    const body = JSON.parse(packet.context)
    expect(body.observations.map((item: { callId: string }) => item.callId)).toEqual(['call_raw', 'call_recent_a', 'call_recent_b'])
    expect(body.coverage.omittedOlderUncitedObservations).toBe(1)
    const citedOnly = handoffPacket(session([user(1), ...tool(2, 'call_raw', 'old cited raw output'),
      ...tool(4, 'call_uncited', 'uncited source'), final(6, 'Only r3 supports this partial observation.')]), state,
    { ...config, handoffMaxRecentEvidencePairs: 0 })
    expect(JSON.parse(citedOnly.context).observations.map((item: { callId: string }) => item.callId)).toEqual(['call_raw'])
  })

  it.each(['max-tokens', 'error', 'aborted'])('leaves a %s final answer unreviewed', finish => {
    const events = fixture().snapshotEvents()
    events[events.length - 1] = final(6, 'Verified: all rows', finish)
    expect(handoffPacket(session(events), state, config).status).toBe('unreviewed')
  })

  it('does not reuse an earlier stop message after the latest response requested a tool', () => {
    const ongoing = event(7, 'assistant/message', { message: { content: [{ type: 'tool-call', name: 'read_data', callId: 'pending', arguments: '{}' }] },
      stream: [{ chunk: { type: 'finish', reason: { kind: 'tool-calls' } } }] })
    expect(handoffPacket(session([...fixture().snapshotEvents(), ongoing]), state, config).status).toBe('no-decision')
  })

  it('changes review identity with answer, original output, saved status, and user request', () => {
    const packet = handoffPacket(fixture(), state, config)
    expect(handoffPacket(fixture(), state, config).reason).toBe(packet.reason)
    expect(handoffPacket(fixture('Only the sample is even.'), state, config).reason).not.toBe(packet.reason)
    const changed = session([user(1), ...tool(2, 'call_raw', 'coverage=5/5; even=4 odd=1'), ...saved(4), final(6, packet.answerText)])
    expect(handoffPacket(changed, state, config).reason).not.toBe(packet.reason)
    expect(handoffPacket(session([...fixture().snapshotEvents(), user(7)]), state, config).status).toBe('no-decision')
  })
})

describe('source-linked handoff verdicts', () => {
  const allow = { decision: 'allow', rationale: 'The handoff accurately limits the observation to the sample.', evidenceRefs: ['call_raw'], corrections: [] }
  const correction = { decision: 'correct', rationale: 'The saved interpretation remains unverified and the raw output covers only a sample.', evidenceRefs: ['call_raw', 'r5'],
    corrections: [{ claim: 'Verified: all rows are even.', replacement: 'Only the sampled rows are even; population parity remains unverified.', evidenceRefs: ['call_raw', 'r5'] }] }

  it('accepts an accurate handoff without forcing a correction', () => {
    const packet = handoffPacket(fixture('Only the sampled rows are even; the full population has not been checked.'), state, config)
    expect(parseHandoffReview(JSON.stringify(allow), packet)).toMatchObject({ status: 'reviewed', decision: 'allow', scientificallyVerified: false, corrections: [] })
  })

  it('accepts a concrete correction of an unverified interpretation promoted into a verified claim', () => {
    const packet = handoffPacket(fixture(), state, config)
    expect(parseHandoffReview(JSON.stringify(correction), packet)).toMatchObject({ status: 'reviewed', decision: 'correct', scientificallyVerified: false,
      corrections: [{ claim: correction.corrections[0]!.claim, replacement: correction.corrections[0]!.replacement }] })
  })

  it('rejects empty, truncated, unlinked, unrelated, and no-op corrections', () => {
    const packet = handoffPacket(fixture(), state, config)
    for (const value of ['', '{"decision":', JSON.stringify({ ...allow, evidenceRefs: ['invented'] }),
      JSON.stringify({ ...correction, corrections: [] }), JSON.stringify({ ...allow, corrections: correction.corrections }),
      JSON.stringify({ ...correction, corrections: [{ ...correction.corrections[0], evidenceRefs: ['invented'] }] }),
      JSON.stringify({ ...correction, corrections: [{ ...correction.corrections[0], claim: 'An unrelated conclusion.' }] }),
      JSON.stringify({ ...correction, corrections: [{ ...correction.corrections[0], replacement: correction.corrections[0]!.claim }] })])
      expect(parseHandoffReview(value, packet).status).toBe('unreviewed')
  })
})
