import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AUTOMATIC_EXPERIMENT_REASON, automaticExperimentCheckFromSession, automaticExperimentConcernFromSession, automaticExperimentOwnership, automaticExperimentPacket, automaticExperimentReviewFromSession, identifyScriptExecution } from './automatic-experiment.mjs'

const options = { cwd: 'D:/analysis', scriptExtensions: ['.py', '.js', '.ps1', '.sh'],
  executionTools: ['pwsh', 'bash'], sourceTools: ['security_native'], sourceOperations: ['native.disassemble'], maxSourcePairs: 2,
  maxRequestBytes: 24000, checkTools: ['pwsh', 'bash'], excludedTools: [] }
const operation = { name: 'pwsh', arguments: { command: 'python "D:/analysis/check.py" "D:/analysis/input.bin"' }, callId: 'planned' }
const state = { sinceSeq: 0 }

function fixture() {
  const rows: Array<{ seq: number; time: number; type: string; data: any }> = [] // Synthetic durable JSON crosses the Session parser in this pure-module fixture.
  const event = (type: string, data: object) => {
    const row = { seq: rows.length + 1, time: rows.length + 1, type, data }
    rows.push(row)
    return row
  }
  const call = (name: string, id: string, args: object) => event('tool/call', { name, callId: id, arguments: JSON.stringify(args) })
  const result = (id: string, output = 'ok', isError = false) => event('tool/result', {
    message: { toolCallId: id, isError, content: [{ type: 'text', text: output }] },
  })
  const source = (id = 'source', overrides: object = {}, tool = 'security_native') => {
    call(tool, id, { operation: 'disassemble', assetId: 'input' })
    return result(id, JSON.stringify({ evidenceId: id + '-evidence', operation: 'native.disassemble', incomplete: false, items: [{ address: 16, bytes: 'abcd' }], ...overrides }))
  }
  const write = (code = 'print(16)', id = 'write', path = 'D:/analysis/check.py', isError = false) => {
    call('write', id, { file_path: path, content: code })
    return result(id, 'Created file', isError)
  }
  const edit = (before: string, after: string, id = 'edit', all = false) => {
    call('edit', id, { file_path: 'D:/analysis/check.py', old_string: before, new_string: after, replace_all: all })
    return result(id, 'Updated file')
  }
  const review = (packet: { reason: string; context: string }, answer: object, status = 'completed') => {
    event('helper/auto-start', { consultationId: 'consult', question: { reason: packet.reason, context: packet.context } })
    return event('helper/auto-end', { consultationId: 'consult', status, answer: JSON.stringify(answer) })
  }
  const execute = (id = 'executed', executedOperation = operation, completed = true) => {
    call(executedOperation.name, id, executedOperation.arguments)
    result(id)
    event('user/message', { source: { kind: 'helper-checkpoint', summary: 'Premise execution receipt' },
      content: [{ type: 'text', text: JSON.stringify({ kind: 'premise-execution', version: 1, callId: id, toolName: executedOperation.name,
        contentSha256: createHash('sha256').update(JSON.stringify([{ type: 'text', text: 'ok' }])).digest('hex'),
        execution: { status: completed ? 'completed' : 'unavailable', issues: completed ? [] : ['nonzero-exit'], exitCode: completed ? 0 : 1 } }) }] })
  }
  const session = { id: 'synthetic', header: { cwd: options.cwd }, snapshotEvents: () => rows }
  return { rows, event, call, result, source, write, edit, review, execute, session }
}
const readyFixture = () => { const f = fixture(); f.source(); f.write(); return f }
const packetOf = (f: ReturnType<typeof fixture>, op = operation, config = options) => automaticExperimentPacket(f.session, state, config, op)

describe('direct generated-script invocation recognition', () => {
  it.each([
    ['python "D:/analysis/check.py" input.bin', 'D:/analysis/check.py'],
    ['py -3 -u "D:/analysis/check.py"', 'D:/analysis/check.py'],
    ['node check.js', 'D:/analysis/check.js'],
    ['pwsh -NoProfile -File "D:/analysis/check.ps1"', 'D:/analysis/check.ps1'],
    ['bash -- "D:/analysis/check.sh"', 'D:/analysis/check.sh'],
    ['& "D:/analysis/check.ps1" -Input input.bin', 'D:/analysis/check.ps1'],
    ['$dir = "D:/analysis"\npython "$dir\\check.py" "$dir\\input.bin"', 'D:/analysis/check.py'],
  ])('resolves the actual script operand in %s', (command, path) => {
    expect(identifyScriptExecution({ name: 'pwsh', arguments: { command } }, options.cwd)).toMatchObject({ status: 'identified', path })
  })

  it.each(['echo "D:/analysis/check.py"', 'Get-Content "D:/analysis/check.py"', 'tar -tf archive.tar',
    'Get-ChildItem D:/analysis', 'echo python check.py', 'printf check.py'])('ignores observation/setup command %s', command => {
    expect(identifyScriptExecution({ name: 'pwsh', arguments: { command } }, options.cwd).status).toBe('not-script')
  })

  it.each(['python -c "print(1)"', 'node -e "1"', 'python $(get-file)', 'python check.py | tee output',
    'echo ok; python check.py', '$dir = Get-Location\npython "$dir/check.py"', 'python "$unknown/check.py"',
    'python check.py\npython other.py', 'pwsh -Command "./check.ps1"'])('reports unsupported execution syntax %s', command => {
    expect(identifyScriptExecution({ name: 'pwsh', arguments: { command } }, options.cwd).status).toBe('uncovered')
  })

  it('does not expand variables inside PowerShell single quotes or conflate basenames', () => {
    expect(identifyScriptExecution({ name: 'pwsh', arguments: { command: "$dir = 'D:/analysis'\npython '$dir/check.py'" } }, options.cwd))
      .toMatchObject({ status: 'identified', path: 'D:/analysis/$dir/check.py' })
    const f = readyFixture()
    expect(packetOf(f, { ...operation, arguments: { command: 'python D:/elsewhere/check.py' } }).status).toBe('no-candidate')
  })
})

describe('automatic generated experiment packets', () => {
  it('includes complete logged code, exact operation, and original structured observations', () => {
    const f = readyFixture(), packet = packetOf(f)
    expect(packet.status).toBe('ready')
    expect(packet.reason).toContain(AUTOMATIC_EXPERIMENT_REASON)
    const body = JSON.parse(packet.context)
    expect(body).toMatchObject({ kind: 'automatic-experiment', script: { code: 'print(16)', callSeq: 3, resultSeq: 4 },
      observations: [{ callId: 'source', resultSeq: 2 }], proposedOperation: { status: 'planned', callId: 'planned', ...operation } })
    expect(JSON.parse(body.observations[0].output).items).toEqual([{ address: 16, bytes: 'abcd' }])
    expect(packet.rawUsableRefs).toEqual(['source'])
    expect(packet.referenceAliases.r2).toBe('source')
  })

  it('does not trigger for reads, archive listings, unrelated shell commands, or untracked files', () => {
    const f = readyFixture()
    for (const op of [
      { name: 'read', arguments: { path: 'D:/analysis/check.py' } },
      { name: 'glob', arguments: { pattern: '*.py' } },
      { name: 'pwsh', arguments: { command: 'tar -tf archive.tar' } },
      { name: 'pwsh', arguments: { command: 'echo D:/analysis/check.py' } },
      { name: 'pwsh', arguments: { command: 'python D:/analysis/other.py' } },
    ]) expect(automaticExperimentPacket(f.session, state, options, op).status).toBe('no-candidate')
  })

  it.each([{ items: [] }, { incomplete: true }, { evidenceId: '' }, { operation: 'native.imports' }, { operation: 'disassemble' }])('requires a complete nonempty structured source of the configured operation: %j', source => {
    const f = fixture(); f.source('source', source); f.write()
    expect(packetOf(f)).toMatchObject({ status: 'no-candidate', reason: 'no-prior-complete-adapter-observation' })
  })

  it('rejects spoofed shell observations, failed sources, sources after code creation, and failed writes', () => {
    const spoofed = fixture(); spoofed.source('source', {}, 'pwsh'); spoofed.write()
    expect(packetOf(spoofed).status).toBe('no-candidate')
    const failed = fixture(); failed.source(); failed.rows[1].data.message.isError = true; failed.write()
    expect(packetOf(failed).status).toBe('no-candidate')
    const later = fixture(); later.write(); later.source()
    expect(packetOf(later).status).toBe('no-candidate')
    const rejectedWrite = fixture(); rejectedWrite.source(); rejectedWrite.write('print(16)', 'write', 'D:/analysis/check.py', true)
    expect(packetOf(rejectedWrite).status).toBe('no-candidate')
  })

  it('keeps exact path matching while honoring explicitly configured script extensions', () => {
    const f = fixture(); f.source(); f.write('code', 'write', 'D:/analysis/check.txt')
    const op = { ...operation, arguments: { command: 'python D:/analysis/check.txt' } }
    expect(packetOf(f, op).status).toBe('no-candidate')
    expect(packetOf(f, op, { ...options, scriptExtensions: ['.txt'] }).status).toBe('ready')
  })

  it('resolves relative writes at their historical working directory, not the current directory', () => {
    const f = fixture(); f.source(); f.write('code', 'write', 'check.py')
    f.event('working-directory/change', { cwd: 'D:/other' })
    const currentOptions = { ...options, cwd: 'D:/other' }
    expect(packetOf(f, { ...operation, arguments: { command: 'python check.py' } }, currentOptions).status).toBe('no-candidate')
    expect(packetOf(f, operation, currentOptions).status).toBe('ready')
    f.write('newcode', 'write-new', 'check.py')
    expect(packetOf(f, { ...operation, arguments: { command: 'python check.py' } }, currentOptions).status).toBe('ready')
  })

  it('reconstructs successful literal edits and distinguishes changed code from the same code', () => {
    const f = readyFixture(), initial = packetOf(f)
    f.edit('16', '32')
    const modified = packetOf(f)
    expect(modified.status).toBe('ready')
    expect(JSON.parse(modified.context).script.code).toBe('print(32)')
    expect(modified.basisKey).not.toBe(initial.basisKey)
    f.write('print(32)', 'rewrite')
    expect(packetOf(f).basisKey).toBe(modified.basisKey)
  })

  it('reports unavailable script contents after an unresolvable edit', () => {
    const missing = fixture(); missing.source(); missing.edit('16', '32')
    expect(packetOf(missing)).toMatchObject({ status: 'uncovered', reason: 'complete-script-not-reconstructable' })
    const mismatch = readyFixture(); mismatch.edit('unknown', 'new')
    expect(packetOf(mismatch)).toMatchObject({ status: 'uncovered', reason: 'logged-edit-does-not-match-script' })
  })

  it('requires unique edits unless replace_all is explicit', () => {
    const f = fixture(); f.source(); f.write('x x'); f.edit('x', 'y')
    expect(packetOf(f).status).toBe('uncovered')
    const all = fixture(); all.source(); all.write('x x'); all.edit('x', 'y', 'edit', true)
    expect(JSON.parse(packetOf(all).context).script.code).toBe('y y')
  })

  it('separates command arguments and observed inputs in candidate identity', () => {
    const f = readyFixture(), initial = packetOf(f)
    expect(packetOf(f, { ...operation, arguments: { command: 'python D:/analysis/check.py second.bin' } }).basisKey).not.toBe(initial.basisKey)
    f.source('new-input', { items: [{ address: 99 }] }); f.write('print(16)', 'new-write')
    expect(packetOf(f).basisKey).not.toBe(initial.basisKey)
  })

  it('does not silently crop code or selected observations to fit the review budget', () => {
    const f = fixture(); f.source('large', { items: [{ bytes: 'a'.repeat(50000) }] }); f.write()
    expect(packetOf(f)).toMatchObject({ status: 'unreviewed', issue: 'packet-over-budget', sourceResultSeqs: [2] })
    expect(packetOf(f).context).toBeUndefined()
  })

  it('isolates the current user and pending steering, and honors cancellation', () => {
    const f = readyFixture()
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(packetOf(f)).toMatchObject({ status: 'no-candidate', reason: 'cancelled-or-pending-user' })
    f.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'new request' }] })
    expect(packetOf(f)).toMatchObject({ status: 'no-candidate', reason: 'no-current-request-script-write' })
    const cancelled = readyFixture()
    expect(automaticExperimentPacket(cancelled.session, state, options, { ...operation, signal: { aborted: true } })).toMatchObject({ reason: 'cancelled-or-pending-user' })
  })

  it('retains ownership during pending steering without creating an executable review packet', () => {
    const f = readyFixture()
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    const ownership = automaticExperimentOwnership(f.session, state, options, operation)
    expect(ownership).toMatchObject({ status: 'owned', scriptPath: 'D:/analysis/check.py', scriptCallSeq: 3 })
    expect(ownership.context).toBeUndefined()
    expect(packetOf(f)).toMatchObject({ status: 'no-candidate', reason: 'cancelled-or-pending-user' })
    expect(automaticExperimentOwnership(f.session, state, options, { ...operation, signal: { aborted: true } }).status).toBe('owned')
    expect(automaticExperimentOwnership(f.session, state, options, { ...operation, arguments: { command: 'Write-Output observation' } }).status).toBe('not-owned')
    expect(automaticExperimentOwnership(f.session, state, options, { ...operation, arguments: { command: 'python D:/elsewhere/check.py' } }).status).toBe('not-owned')
    f.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'new request' }] })
    expect(automaticExperimentOwnership(f.session, state, options, operation).status).toBe('not-owned')
  })

  it('does not claim ownership of generated setup scripts without a qualifying original observation', () => {
    const f = fixture(); f.write()
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(automaticExperimentOwnership(f.session, state, options, operation).status).toBe('not-owned')
  })

  it('does not review an already executed identical version, but reviews a changed version', () => {
    const f = readyFixture(); f.execute()
    expect(packetOf(f)).toMatchObject({ status: 'no-candidate', reason: 'version-already-executed', scientificallyVerified: false })
    f.write('print(16)', 'identical-rewrite')
    expect(packetOf(f).reason).toBe('version-already-executed')
    f.edit('16', '32')
    expect(packetOf(f).status).toBe('ready')
  })

  it('reviews changed observed inputs even when the script and command were already executed', () => {
    const f = readyFixture(); f.execute()
    expect(packetOf(f).reason).toBe('version-already-executed')
    f.source('changed-input', { items: [{ address: 99 }] })
    expect(packetOf(f).status).toBe('ready')
  })

  it('does not count a blocked operation result without executor receipt as execution', () => {
    const f = readyFixture(); f.call(operation.name, 'blocked', operation.arguments)
    f.result('blocked', JSON.stringify({ status: 'check-required' }))
    expect(packetOf(f).status).toBe('ready')
  })

  it('does not skip a failed execution of the same version', () => {
    const f = readyFixture(); f.execute('failed', operation, false)
    expect(packetOf(f).status).toBe('ready')
  })

  it('adds completed independent checks and permits a new review after a prior rejection', () => {
    const f = readyFixture(), before = packetOf(f)
    f.review(before, { decision: 'check-required', rationale: 'Compare the original width.', evidenceRefs: ['source'],
      nextCheck: 'Run the independent control.', check: { name: 'pwsh', arguments: { command: 'python control.py' } } })
    expect(automaticExperimentReviewFromSession(f.session, before, options).review.decision).toBe('check-required')
    f.execute('control', { ...operation, arguments: { command: 'python control.py' } })
    const after = packetOf(f)
    expect(after.basisKey).toBe(before.basisKey)
    expect(after.reason).not.toBe(before.reason)
    expect(JSON.parse(after.context).observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'control', output: 'ok', execution: { status: 'completed', issues: [], exitCode: 0 } }),
    ]))
    expect(automaticExperimentReviewFromSession(f.session, after, options)).toBeUndefined()
  })

  it('does not reopen a review for a failed check, but can reuse an accepted review for the same basis', () => {
    const f = readyFixture(), before = packetOf(f)
    f.review(before, { decision: 'observe', rationale: 'This measures the input.', evidenceRefs: ['source'] })
    f.execute('failed-control', { ...operation, arguments: { command: 'python control.py' } }, false)
    expect(packetOf(f).reason).toBe(before.reason)
    f.execute('control', { ...operation, arguments: { command: 'python control.py' } })
    expect(packetOf(f).reason).not.toBe(before.reason)
    expect(automaticExperimentReviewFromSession(f.session, packetOf(f), options).review.decision).toBe('observe')
  })

  it('reuses only matching completed review attempts and preserves explicit failures', () => {
    const f = readyFixture(), packet = packetOf(f)
    f.review(packet, { decision: 'observe', rationale: 'This reads the complete sample.', evidenceRefs: ['r2'] })
    expect(automaticExperimentReviewFromSession(f.session, packet, options)).toMatchObject({ status: 'completed',
      review: { status: 'reviewed', decision: 'observe', scientificallyVerified: false, evidenceRefs: ['source'] } })
    expect(automaticExperimentReviewFromSession(f.session, { ...packet, basisKey: 'different' }, options)).toBeUndefined()
    f.review(packet, {}, 'cancelled')
    expect(automaticExperimentReviewFromSession(f.session, packet, options)).toMatchObject({ status: 'cancelled', review: { status: 'unreviewed' } })
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(automaticExperimentReviewFromSession(f.session, packet, options)).toBeUndefined()
  })

  it('rejects review citations to the planned command and same-command verification proposals', () => {
    const f = readyFixture(), packet = packetOf(f)
    f.review(packet, { decision: 'supported', rationale: 'The planned command is not executed evidence.', evidenceRefs: ['planned'] })
    expect(automaticExperimentReviewFromSession(f.session, packet, options).review.status).toBe('unreviewed')
    f.review(packet, { decision: 'check-required', rationale: 'Needs verification.', evidenceRefs: ['source'], nextCheck: 'Repeat.',
      check: { name: operation.name, arguments: operation.arguments } })
    expect(automaticExperimentReviewFromSession(f.session, packet, options).review.status).toBe('unreviewed')
  })

  it('recognizes an exact independent check without treating it as an authorized dependent operation', () => {
    const f = readyFixture(); f.write('control', 'control-write', 'D:/analysis/control.py')
    const packet = packetOf(f)
    const check = { name: 'pwsh', arguments: { command: 'python control.py' } }
    f.review(packet, { decision: 'check-required', rationale: 'Run a width control.', evidenceRefs: ['source'], nextCheck: 'Check width.', check })
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(true)
    expect(automaticExperimentCheckFromSession(f.session, state, options, operation)).toBe(false)
    expect(automaticExperimentCheckFromSession(f.session, state, options, { ...check, arguments: { command: 'python control.py other.bin' } })).toBe(false)
    f.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Different task' }] })
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(false)
  })

  it('requires valid current-request check proposals and invalidates them on queued steering', () => {
    const f = readyFixture(); f.write('control', 'control-write', 'D:/analysis/control.py')
    const packet = packetOf(f)
    const check = { name: 'pwsh', arguments: { command: 'python control.py' } }
    f.review(packet, { decision: 'check-required', rationale: 'Run a control.', evidenceRefs: ['unknown'], nextCheck: 'Check.', check })
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(false)
    f.review(packet, { decision: 'check-required', rationale: 'Run a control.', evidenceRefs: ['source', 'unknown'], nextCheck: 'Check.', check })
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(true)
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(false)
  })

  it('invalidates a proposed file check when its code changes, while retaining identical rewrites', () => {
    const f = readyFixture(); f.write('control', 'control-write', 'D:/analysis/control.py')
    const packet = packetOf(f), check = { name: 'pwsh', arguments: { command: 'python control.py' } }
    f.review(packet, { decision: 'check-required', rationale: 'Read the original data.', evidenceRefs: ['source'], nextCheck: 'Run control.', check })
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(true)
    f.write('control', 'same-write', 'D:/analysis/control.py')
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(true)
    f.write('different experiment', 'changed-write', 'D:/analysis/control.py')
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(false)
    expect(automaticExperimentPacket(f.session, state, options, check).status).toBe('ready')
  })

  it('does not preapprove file contents created only after the check was proposed', () => {
    const f = readyFixture(), packet = packetOf(f), check = { name: 'pwsh', arguments: { command: 'python control.py' } }
    f.review(packet, { decision: 'check-required', rationale: 'Read the original data.', evidenceRefs: ['source'], nextCheck: 'Run control.', check })
    f.write('unreviewed new code', 'control-write', 'D:/analysis/control.py')
    expect(automaticExperimentCheckFromSession(f.session, state, options, check)).toBe(false)
  })

  it('retains a concrete concern after a new check changes the reason and a later review is unavailable', () => {
    const f = readyFixture(), before = packetOf(f)
    const verdict = { decision: 'check-required', rationale: 'The width disagrees with original bytes.', evidenceRefs: ['source'],
      nextCheck: 'Read the original width.', check: { name: 'pwsh', arguments: { command: 'Get-Content width.txt' } } }
    const originalReview = f.review(before, verdict)
    f.execute('new-control', { ...operation, arguments: { command: 'Get-Content width.txt' } })
    const after = packetOf(f)
    expect(after.basisKey).toBe(before.basisKey)
    expect(after.reason).not.toBe(before.reason)
    expect(automaticExperimentReviewFromSession(f.session, after, options)).toBeUndefined()
    expect(automaticExperimentConcernFromSession(f.session, after, options)).toMatchObject({ reviewSeq: originalReview.seq,
      review: { decision: 'check-required', check: verdict.check } })
    f.review(after, {}, 'cancelled')
    f.review(after, { decision: 'unknown-schema' })
    expect(automaticExperimentConcernFromSession(f.session, after, options)?.reviewSeq).toBe(originalReview.seq)
  })

  it.each(['observe', 'supported'])('clears a concern only after a complete valid %s result', decision => {
    const f = readyFixture(), packet = packetOf(f)
    f.review(packet, { decision: 'insufficient-evidence', rationale: 'The range is not covered.', evidenceRefs: ['source'], nextCheck: 'Read the full range.' })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)?.review.decision).toBe('insufficient-evidence')
    f.review(packet, { decision, rationale: 'This follows the supplied range.', evidenceRefs: ['missing-source'] })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)?.review.decision).toBe('insufficient-evidence')
    f.review(packet, { decision, rationale: 'This follows the supplied range.', evidenceRefs: ['source'] })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)).toBeUndefined()
    f.review(packet, {}, 'cancelled')
    expect(automaticExperimentConcernFromSession(f.session, packet, options)).toBeUndefined()
  })

  it('keeps the newest valid partial proposal without treating invalid replies as concerns', () => {
    const f = readyFixture(), packet = packetOf(f)
    f.review(packet, { decision: 'check-required', rationale: 'Invalid citation.', evidenceRefs: ['missing-source'],
      nextCheck: 'Read a control.', check: { name: 'pwsh', arguments: { command: 'Get-Content control.txt' } } })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)).toBeUndefined()
    f.review(packet, { decision: 'insufficient-evidence', rationale: 'Missing scope.', evidenceRefs: ['source'], nextCheck: 'Read the scope.' })
    const newest = f.review(packet, { decision: 'observe', rationale: 'Useful independent control with one unresolved citation.', evidenceRefs: ['source', 'unknown'],
      nextCheck: 'Run the control.', check: { name: 'pwsh', arguments: { command: 'Get-Content control.txt' } } })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)).toMatchObject({ reviewSeq: newest.seq, review: { status: 'proposal-only' } })
  })

  it('does not inherit concerns across code/input identities or user requests', () => {
    const f = readyFixture(), packet = packetOf(f)
    f.review(packet, { decision: 'insufficient-evidence', rationale: 'Missing scope.', evidenceRefs: ['source'], nextCheck: 'Read the scope.' })
    expect(automaticExperimentConcernFromSession(f.session, { ...packet, basisKey: 'new-code-or-input' }, options)).toBeUndefined()
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)).toBeUndefined()
    f.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Different task' }] })
    expect(automaticExperimentConcernFromSession(f.session, packet, options)).toBeUndefined()
  })
})
