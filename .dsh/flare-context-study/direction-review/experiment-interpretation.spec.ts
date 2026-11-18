import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { INTERPRETATION_REASON, identifyInterpretationProducer, interpretationCheckFromSession,
  interpretationConcernFromSession, interpretationOwnership, interpretationPacket,
  interpretationReviewFromSession, loggedExperimentProducers, loggedProducerForCall } from './experiment-interpretation.mjs'

const options = { cwd: 'D:/analysis', scriptExtensions: ['.py', '.js', '.ps1', '.sh'],
  executionTools: ['pwsh', 'bash'], consumptionTools: ['write', 'edit', 'pwsh', 'bash', 'native'], interpretationSignals: [],
  sourceTools: ['native'], sourceOperations: ['native.disassemble', 'native.packets'],
  maxSourcePairs: 2, maxRequestBytes: 24000, checkTools: ['pwsh', 'bash'], excludedTools: [] }
const state = { sinceSeq: 0 }
const operation = { name: 'write', arguments: { file_path: 'D:/analysis/next.py', content: 'exclude_candidates()' }, callId: 'next' }
const scan = { name: 'pwsh', arguments: { command: 'python "D:/analysis/scan.py"' } }
const smallCheck = { name: 'pwsh', arguments: { command: 'python -c "print(1)"' } }

function fixture() {
  const rows: Array<{ seq: number; time: number; type: string; data: any }> = [] // Durable model/tool JSON is validated by the module under test.
  const event = (type: string, data: object) => {
    const value = { seq: rows.length + 1, time: rows.length + 1, type, data }
    rows.push(value)
    return value
  }
  const call = (name: string, id: string, args: object) => event('tool/call', { name, callId: id, arguments: JSON.stringify(args) })
  const result = (id: string, output: string, isError = false) => event('tool/result', {
    message: { toolCallId: id, isError, content: [{ type: 'text', text: output }] },
  })
  const source = (id = 'source', args: object = { operation: 'disassemble', path: 'D:/analysis/input.bin' }, overrides: object = {}) => {
    call('native', id, args)
    return result(id, JSON.stringify({ evidenceId: `${id}-evidence`, operation: 'native.disassemble', incomplete: false,
      items: [{ address: 16, bytes: '1234' }], ...overrides }))
  }
  const write = (code = "data = open('D:/analysis/input.bin','rb').read(); print(data[12:60])", id = 'write', path = 'D:/analysis/scan.py', error = false) => {
    call('write', id, { file_path: path, content: code })
    return result(id, 'Created file', error)
  }
  const edit = (before: string, after: string, path = 'D:/analysis/scan.py', all = false) => {
    call('edit', `edit-${rows.length}`, { file_path: path, old_string: before, new_string: after, replace_all: all })
    return result(`edit-${rows.length - 1}`, 'Updated file')
  }
  const execute = (id = 'run', output = 'values: [4294967296, 8589934592]; all composite', op = scan, status = 'completed') => {
    call(op.name, id, op.arguments)
    const done = result(id, output)
    event('user/message', { source: { kind: 'helper-checkpoint', summary: 'Premise execution receipt' }, content: [{ type: 'text',
      text: JSON.stringify({ kind: 'premise-execution', version: 1, callId: id, toolName: op.name,
        contentSha256: createHash('sha256').update(JSON.stringify([{ type: 'text', text: output }])).digest('hex'),
        execution: { status, issues: status === 'completed' ? [] : ['failed'], exitCode: status === 'completed' ? 0 : 1 } }) }] })
    return done
  }
  const explain = (value = 'All parsed values have zero low words; I will exclude this width and scan another layout.') =>
    event('assistant/message', { message: { content: [{ type: 'text', text: value }] } })
  const review = (packet: { reason: string; context: string }, answer: object, id = 'consult', status = 'completed') => {
    event('helper/auto-start', { consultationId: id, question: { reason: packet.reason, context: packet.context } })
    return event('helper/auto-end', { consultationId: id, status, answer: JSON.stringify(answer) })
  }
  const session = { id: 'synthetic', header: { cwd: options.cwd }, snapshotEvents: () => rows }
  return { rows, event, call, result, source, write, edit, execute, explain, review, session }
}
const ready = () => { const f = fixture(); f.source(); f.write(); f.execute(); f.explain(); return f }
const packet = (f: ReturnType<typeof fixture>, op = operation, config = options) => interpretationPacket(f.session, state, config, op)
const adverse = { decision: 'check-required', rationale: 'The decoder may include padding; this result cannot exclude another width.',
  evidenceRefs: ['run'], nextCheck: 'Check one known object against raw fields.', check: smallCheck }

describe('bounded experiment producer recognition', () => {
  it.each([
    ['python "D:/analysis/scan.py"', 'file'],
    ["$ad='D:/analysis'; python \"$ad/scan.py\"", 'file'],
    ["$ad='D:/analysis'; python -c \"print(r'$ad/input.bin')\"", 'inline'],
    ['python -c "print(1); print(2)"', 'inline'],
    ["python -c 'print(\"$literal\")'", 'inline'],
    ['py -3 -u "D:/analysis/scan.py" 2>&1 | Select-Object -First 60', 'file'],
    ['python -c "print(1)" 2>&1 | Select-Object -First 2', 'inline'],
  ])('recognizes complete literal code or file invocation: %s', (command, kind) => {
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: { command } }, options.cwd)).toMatchObject({ status: 'identified', kind })
  })

  it.each([
    ['python -B -X utf8 "scan.py" 12 2>&1', { kind: 'file', path: 'D:/actual/scan.py', arguments: ['12'], interpreterOptions: ['-B', '-X', 'utf8'] }],
    ['python -X utf8 -c "print(1)"', { kind: 'inline', code: 'print(1)', interpreterOptions: ['-X', 'utf8'] }],
  ] as const)('recovers a completed Python UTF-8 measurement with its recorded options: %s', (command, expected) => {
    const op = { name: 'pwsh', arguments: { command, workdir: 'D:/actual' } }
    expect(identifyInterpretationProducer(op, options.cwd)).toMatchObject({ status: 'identified', cwd: 'D:/actual', ...expected })
    expect(identifyInterpretationProducer(op, options.cwd, 'proposed-check').status).toBe('uncovered')
  })

  it.each(['-X', '-X other', '-X $mode', '-X utf8 -m other', '-X utf8; echo done'])('rejects unsupported Python options: %s', prefix => {
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: { command: 'python ' + prefix + ' scan.py' } }, options.cwd).status)
      .toBe('uncovered')
  })

  it('expands only literal PowerShell variables in double-quoted inline code', () => {
    const command = "$ad='D:/analysis'; python -c \"print(r'$ad/input.bin')\""
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: { command } }, options.cwd)).toMatchObject({ code: "print(r'D:/analysis/input.bin')" })
  })

  it.each(['echo ok; python scan.py', 'python scan.py | tee output', 'python -c "print($unknown)"',
    '$ad=Get-Location; python "$ad/scan.py"', 'python -c "print($(Get-Location))"',
    'python scan.py && echo ok', 'python -c "print(1)" arg', 'python scan.py | Select-Object -Last 20',
    'python scan.py | Select-Object -First 2; Remove-Item anything'])('reports unsupported shell syntax: %s', command => {
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: { command } }, options.cwd).status).toBe('uncovered')
  })

  it.each(['echo scan.py', 'Get-Content scan.py', 'tar -tf source.tar'])('does not mistake an observed path for execution: %s', command => {
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: { command } }, options.cwd).status).toBe('not-script')
  })

  it('marks an explicit output slice without claiming complete output', () => {
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: {
      command: 'python scan.py 2>&1 | Select-Object -First 60',
    } }, options.cwd)).toMatchObject({ outputSelection: { kind: 'first-lines', count: 60, completeProducerOutput: false } })
  })

  it.each([
    'python scan.py 2>&1 | Out-String -Width 200',
    'python -c "print(1)" | out-string -width 160',
    "$ad='D:/analysis'; python \"$ad/scan.py\" 2>&1 | Out-String -Width 220",
  ])('associates a producer through explicit text formatting: %s', command => {
    const identified = identifyInterpretationProducer({ name: 'pwsh', arguments: { command } }, options.cwd)
    expect(identified.status).toBe('identified')
    expect(identified.formatting).toMatchObject({ kind: 'powershell-out-string', width: expect.any(Number),
      limitation: expect.stringContaining('does not establish complete') })
    expect(identified.outputSelection).toBeUndefined()
  })

  it.each(['Out-String', 'Out-String -Width 0', 'Out-String -Width -1', 'Out-String -Width 1.5',
    'Out-String -Width 9007199254740992', 'Out-String -Width $width', 'Out-String -Width 80 -Stream',
    'Out-String -Width 80 | Select-Object -First 1', 'Format-Table -Width 80'])('keeps unsupported formatting outside coverage: %s', suffix => {
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: {
      command: 'python scan.py 2>&1 | ' + suffix,
    } }, options.cwd)).toMatchObject({ status: 'uncovered', reason: 'unsupported-output-pipeline' })
  })

  it('does not apply the PowerShell formatter rule to another shell', () => {
    expect(identifyInterpretationProducer({ name: 'bash', arguments: {
      command: 'python scan.py | Out-String -Width 80',
    } }, options.cwd).status).toBe('uncovered')
  })
})

describe('producer versions and interpretation evidence', () => {
  it('retains code and formatting metadata for a completed experiment result', () => {
    const f = fixture(); f.source(); f.write('print("count=3")')
    f.execute('run', 'count=3', { name: 'pwsh', arguments: { command: 'python D:/analysis/scan.py 2>&1 | Out-String -Width 200' } })
    f.explain('The result contains three rows, so I will exclude other layouts.')
    const result = packet(f)
    expect(result.status).toBe('ready')
    expect(JSON.parse(result.context).producer).toMatchObject({ script: { code: 'print("count=3")' },
      invocation: { formatting: { kind: 'powershell-out-string', width: 200 } } })
  })
  it('uses configured public markers to select decisions, including native analysis operations', () => {
    const f = ready(), config = { ...options, interpretationSignals: ['exclude', '属于'] }
    const native = { name: 'native', arguments: { address: 64 }, callId: 'native-next' }
    expect(packet(f, native, config).status).toBe('ready')
    f.explain('The dump completed. Read its strings next.')
    expect(packet(f, native, config).reason).toBe('no-public-commitment-marker')
    f.explain('扫描结果表明目标属于该函数，继续反汇编。')
    expect(packet(f, native, config).status).toBe('ready')
  })
  it('joins complete producer code, actual output, public interpretation, and exact next operation', () => {
    const f = ready(), p = packet(f), body = JSON.parse(p.context)
    expect(p.status).toBe('ready')
    expect(p.reason).toContain(INTERPRETATION_REASON)
    expect(body).toMatchObject({ kind: 'experiment-interpretation', producer: { callId: 'run', script: { code: expect.stringContaining('data[12:60]') } },
      interpretation: { status: 'analyst-interpretation', text: expect.stringContaining('exclude this width') },
      observations: [{ callId: 'run', output: expect.stringContaining('4294967296') }, { callId: 'source' }],
      proposedOperation: { status: 'planned', ...operation } })
    expect(body.sourceSelection.missingOriginalInputs).toBe(false)
    expect(p.rawUsableRefs).toEqual(['run', 'source'])
  })

  it('reviews a script derived from a cited measurement without representing it as an independent input', () => {
    const f = fixture()
    f.write(); f.execute('run', 'sample marker = aa bb cc dd, three rows')
    f.explain('The prefix `aa bb cc dd...` identifies the complete record. Generate the transformation.')
    const p = packet(f)
    expect(p.status).toBe('ready')
    const body = JSON.parse(p.context)
    expect(body.observations.map((item: { callId: string }) => item.callId)).toEqual(['run'])
    expect(body.sourceSelection).toMatchObject({ missingOriginalInputs: true, analysisEligibilityCount: 0 })
    f.review(p, adverse)
    f.explain('I still want to write the same transformation.')
    expect(interpretationConcernFromSession(f.session, packet(f), options)?.review.decision).toBe('check-required')
  })

  it('keeps a script-only review tied to the adjacent output and a proposed analysis script', () => {
    const f = fixture()
    f.write(); const measured = f.execute('run', 'source records: aa bb cc dd')
    for (const explanation of ['Create the next script.', 'The value was `aa bb cc ee`.', 'A total of `10000000`.', 'Read r' + measured.seq + '0 next.']) {
      f.explain(explanation)
      expect(packet(f).status).toBe('no-candidate')
    }
    f.explain('Use r' + measured.seq + ' for the next transformation.')
    expect(packet(f).status).toBe('ready')
    expect(packet(f, { ...operation, arguments: { ...operation.arguments, file_path: 'notes.txt' } }).status).toBe('no-candidate')
    expect(interpretationPacket(f.session, state, options, scan).status).toBe('no-candidate')
  })

  it('keeps code from execution time after the file is rewritten', () => {
    const f = ready(); f.write('replacement()', 'new-write')
    expect(loggedProducerForCall(f.session, 'run', options).script.code).toContain('data[12:60]')
    expect(loggedProducerForCall(f.session, 'run', options).script.callId).toBe('write')
  })

  it('reconstructs edits at their historical cwd', () => {
    const f = fixture(); f.source(); f.write('print(1)', 'write', 'scan.py'); f.edit('1', '2', 'scan.py')
    f.event('working-directory/change', { cwd: 'D:/other' })
    f.execute(); f.explain()
    expect(packet(f).status).toBe('ready')
    expect(loggedProducerForCall(f.session, 'run', options).script.code).toBe('print(2)')
  })

  it('does not substitute another directory with the same basename', () => {
    const f = fixture(); f.source(); f.write(); f.execute('run', 'result', { name: 'pwsh', arguments: { command: 'python D:/other/scan.py' } }); f.explain()
    expect(packet(f).status).toBe('no-candidate')
  })

  it('uses the tool workdir for relative execution', () => {
    const f = fixture(); f.source(); f.write('print(9)', 'write', 'D:/other/scan.py')
    f.execute('run', '9', { name: 'pwsh', arguments: { command: 'python scan.py', workdir: 'D:/other' } }); f.explain()
    expect(JSON.parse(packet(f).context).producer.script.path).toBe('D:/other/scan.py')
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: {
      command: 'python scan.py', workdir: 'D:/other', cwd: 'D:/wrong' } }, options.cwd).path).toBe('D:/other/scan.py')
    expect(identifyInterpretationProducer({ name: 'pwsh', arguments: {
      command: 'python scan.py', workdir: 'child' } }, options.cwd).path).toBe('D:/analysis/child/scan.py')
  })

  it('keeps later selected check output out of complete raw evidence', () => {
    const f = ready(), p = packet(f); f.review(p, adverse)
    f.execute('selected-check', 'first row only', { name: 'pwsh', arguments: { command: 'python -c "print(1)" | Select-Object -First 1' } })
    const later = packet(f)
    expect(later.rawUsableRefs).not.toContain('selected-check')
    expect(JSON.parse(later.context).observations.find((item: { callId: string }) => item.callId === 'selected-check').outputSelection.completeProducerOutput).toBe(false)
    f.execute('untracked-check', 'selected row', { name: 'pwsh', arguments: { command: 'python external.py | Select-Object -First 1' } })
    expect(packet(f).rawUsableRefs).not.toContain('untracked-check')
  })

  it('includes literal inline source, without requiring a file write', () => {
    const f = fixture(); f.source(); f.execute('inline', '0', smallCheck); f.explain('The check returned zero. I will now test the alternative.')
    expect(JSON.parse(packet(f).context).producer.script).toMatchObject({ kind: 'inline', code: 'print(1)' })
  })

  it('accepts relevant retained packet observations and preserves their incomplete marker', () => {
    const f = fixture(); f.source('packet', { operation: 'packets', path: 'D:/analysis/input.bin' }, { incomplete: true, operation: 'native.packets' })
    f.write(); f.execute(); f.explain()
    const body = JSON.parse(packet(f).context)
    expect(JSON.parse(body.observations[1].output).incomplete).toBe(true)
    expect(packet(f).rawUsableRefs).toEqual(['run'])
  })

  it('does not certify selected producer output as complete raw evidence', () => {
    const f = fixture(); f.source(); f.write()
    f.execute('run', 'first line', { name: 'pwsh', arguments: { command: 'python D:/analysis/scan.py | Select-Object -First 1' } }); f.explain()
    expect(packet(f).rawUsableRefs).toEqual(['source'])
    expect(JSON.parse(packet(f).context).producer.invocation.outputSelection.completeProducerOutput).toBe(false)
  })

  it('omits unrelated native outputs instead of filling the packet by recency', () => {
    const f = fixture(); f.source('unrelated', { operation: 'disassemble', path: 'D:/other/file.bin' }); f.write(); f.execute(); f.explain()
    const body = JSON.parse(packet(f).context)
    expect(body.observations.map((value: { callId: string }) => value.callId)).toEqual(['run'])
    expect(body.sourceSelection.missingOriginalInputs).toBe(true)
  })

  it('does not match prefix-colliding paths or result references', () => {
    const f = fixture(); f.source(); f.write("print('D:/analysis/input.bin.bak r200')"); f.execute(); f.explain('Use the observation.')
    expect(JSON.parse(packet(f).context).observations.map((value: { callId: string }) => value.callId)).toEqual(['run'])
  })

  it('requires a configured analysis observation before the execution, not before the write', () => {
    const f = fixture(); f.write(); f.source(); f.execute(); f.explain()
    expect(packet(f).status).toBe('ready')
    expect(packet(f, operation, { ...options, sourceOperations: ['native.other'] }).status).toBe('no-candidate')
  })

  it('requires a complete completed execution receipt but retains failed producers for explicit handoff reads', () => {
    const f = fixture(); f.source(); f.write(); f.execute('run', 'partial correct observation', scan, 'unavailable'); f.explain()
    expect(packet(f).status).toBe('no-candidate')
    expect(loggedProducerForCall(f.session, 'run', options).pair.execution.status).toBe('unavailable')
    const noReceipt = ready(); noReceipt.rows.splice(noReceipt.rows.findIndex(row => row.type === 'user/message'), 1)
    expect(packet(noReceipt).status).toBe('no-candidate')
  })

  it('rejects failed writes and edits without a reconstructable full version', () => {
    const f = fixture(); f.source(); f.write('a', 'failed', 'D:/analysis/scan.py', true); f.execute(); f.explain()
    expect(packet(f).status).toBe('no-candidate')
    const missing = fixture(); missing.source(); missing.edit('unknown', 'new'); missing.execute(); missing.explain()
    expect(packet(missing).status).toBe('no-candidate')
  })

  it('requires adjacent public interpretation and ignores ordinary reads', () => {
    const f = ready()
    expect(packet(f, { name: 'read', arguments: { path: 'data' }, callId: 'read' }).status).toBe('no-candidate')
    f.call('read', 'read', { path: 'other' }); f.result('read', 'another observation'); f.explain()
    expect(packet(f).reason).toBe('interpretation-follows-another-observation')
    const hidden = ready(); hidden.rows.at(-1)!.data.message.content = [{ type: 'reasoning', text: 'private' }]
    expect(packet(hidden).status).toBe('no-candidate')
  })

  it('isolates user requests and recognizes owned cancellation without authorizing it', () => {
    const f = ready(); f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(packet(f).status).toBe('no-candidate')
    expect(interpretationOwnership(f.session, state, options, operation).status).toBe('owned')
    const next = ready(); next.event('user/message', { source: { kind: 'user' }, content: [] }); next.explain()
    expect(packet(next).status).toBe('no-candidate')
    expect(loggedProducerForCall(next.session, 'run', options)).toBeDefined()
  })

  it('does not crop production code or raw output to fit the packet', () => {
    const f = fixture(); f.source(); f.write(); f.execute('run', 'x'.repeat(50000)); f.explain()
    expect(packet(f)).toMatchObject({ status: 'unreviewed', issue: 'packet-over-budget', producerCallId: 'run' })
    expect(packet(f).context).toBeUndefined()
  })

  it('keeps signature-scan count and filter code together for scope review', () => {
    const f = fixture(); f.source(); f.write("hits = [x for x in records if x.signature == 'A']; print(len(hits))")
    f.execute('run', '0'); f.explain('No type A signatures occurred, so I will exclude every record format.')
    const body = JSON.parse(packet(f).context)
    expect(body.producer.script.code).toContain("signature == 'A'")
    expect(body.interpretation.text).toContain('every record format')
    expect(body.observations[0].output).toBe('0')
  })
})

describe('asset-bound analysis across user requests', () => {
  const asset = { id: 'asset-original', path: 'D:/analysis/input.bin', engagementId: 'engagement-original' }
  const config = { ...options, analysisAssets: [asset] }
  const previous = (code?: string, sourceAsset = asset.id, overrides: object = {}) => {
    const f = fixture()
    f.source('prior-source', { operation: 'disassemble', assetId: sourceAsset }, overrides)
    f.write(code)
    f.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] })
    return f
  }

  it('joins a prior native asset observation to a current execution of a logged script', () => {
    const f = previous(); f.execute(); f.explain()
    const p = packet(f, operation, config), body = JSON.parse(p.context)
    expect(p.status).toBe('ready')
    expect(body.sourceSelection.previousRequestCount).toBe(1)
    expect(body.observations.find((item: { callId: string }) => item.callId === 'prior-source'))
      .toMatchObject({ requestScope: 'previous-request', assetBinding: { assetId: asset.id, path: asset.path, engagementId: asset.engagementId } })
    expect(body.producer.script.callId).toBe('write')
    expect(body.producer.coverage).toContain('unlogged external changes are unknown')
    expect(p.rawUsableRefs).toEqual(['run', 'prior-source'])
  })

  it('reconstructs earlier writes and current edits without reinterpreting their cwd', () => {
    const f = fixture(); f.source('prior-source', { assetId: asset.id })
    f.write("print('D:/analysis/input.bin', 1)", 'write', 'scan.py')
    f.event('user/message', { source: { kind: 'user' }, content: [] })
    f.edit('1)', '2)', 'scan.py'); f.event('working-directory/change', { cwd: 'D:/other' })
    f.execute(); f.explain()
    expect(JSON.parse(packet(f, operation, config).context).producer.script.code).toBe("print('D:/analysis/input.bin', 2)")
  })

  it.each([
    "print('asset-original')",
    "print(r'd:\\ANALYSIS\\input.bin')",
  ])('accepts a direct ID or normalized absolute Windows path: %s', code => {
    const f = previous(code); f.execute(); f.explain()
    expect(packet(f, operation, config).status).toBe('ready')
  })

  it.each([
    "print('input.bin')",
    "print('D:/analysis/input.bin.bak')",
    "print('D:/analysis/other.bin')",
    "print('asset-original-extra')",
    "print('ASSET-ORIGINAL')",
  ])('does not infer target identity from a relative, different or partial reference: %s', code => {
    const f = previous(code); f.execute(); f.explain()
    expect(packet(f, operation, config).reason).toBe('no-prior-analysis-observation')
  })

  it('does not use the next operation or its explanation to claim the producer read an asset', () => {
    const f = previous('print(1)'); f.execute(); f.explain('D:/analysis/input.bin proves the next step.')
    expect(packet(f, { ...operation, arguments: { file_path: 'D:/analysis/input.bin', content: asset.id } }, config).reason)
      .toBe('no-prior-analysis-observation')
  })

  it('requires a trusted matching asset mapping and native assetId', () => {
    const f = previous(); f.execute(); f.explain()
    expect(packet(f).reason).toBe('no-prior-analysis-observation')
    expect(packet(f, operation, { ...config, analysisAssets: [{ ...asset, path: 'relative/input.bin' }] }).reason)
      .toBe('no-prior-analysis-observation')
    const other = previous(undefined, 'asset-other'); other.execute(); other.explain()
    expect(packet(other, operation, config).reason).toBe('no-prior-analysis-observation')
    const pathOnly = fixture(); pathOnly.source(); pathOnly.write()
    pathOnly.event('user/message', { source: { kind: 'user' }, content: [] }); pathOnly.execute(); pathOnly.explain()
    expect(packet(pathOnly, operation, config).reason).toBe('no-prior-analysis-observation')
  })

  it('does not resolve an ambiguous shared path without a direct asset ID', () => {
    const shared = { ...config, analysisAssets: [asset, { ...asset, id: 'asset-other', engagementId: 'engagement-other' }] }
    const f = previous(); f.execute(); f.explain()
    expect(packet(f, operation, shared).reason).toBe('no-prior-analysis-observation')
    const explicit = previous("print('asset-original')"); explicit.execute(); explicit.explain()
    expect(packet(explicit, operation, shared).status).toBe('ready')
  })

  it('preserves case for POSIX asset paths', () => {
    const posix = { ...config, analysisAssets: [{ ...asset, path: '/analysis/Input.bin' }] }
    const f = previous("print('/analysis/input.bin')"); f.execute(); f.explain()
    expect(packet(f, operation, posix).reason).toBe('no-prior-analysis-observation')
    const exact = previous("print('/analysis/Input.bin')"); exact.execute(); exact.explain()
    expect(packet(exact, operation, posix).status).toBe('ready')
  })

  it('does not inherit an old execution, an unknown file, or a failed latest write', () => {
    const old = ready(); old.event('user/message', { source: { kind: 'user' }, content: [] }); old.explain()
    expect(packet(old, operation, config).reason).toBe('no-complete-current-request-producer')
    const unknown = previous(); unknown.execute('run', 'value', { name: 'pwsh', arguments: { command: 'python D:/analysis/unknown.py' } }); unknown.explain()
    expect(packet(unknown, operation, config).reason).toBe('no-complete-current-request-producer')
    const failed = previous(); failed.write('unrecorded', 'failed', 'D:/analysis/scan.py', true); failed.execute(); failed.explain()
    expect(packet(failed, operation, config).reason).toBe('no-complete-current-request-producer')
  })

  it('keeps partial historical observations partial and requires the configured source operation', () => {
    const f = previous(undefined, asset.id, { incomplete: true }); f.execute(); f.explain()
    const p = packet(f, operation, config)
    expect(p.status).toBe('ready')
    expect(p.rawUsableRefs).toEqual(['run'])
    expect(JSON.parse(p.context).observations[1].output).toContain('"incomplete":true')
    expect(packet(f, operation, { ...config, sourceOperations: ['native.other'] }).reason).toBe('no-prior-analysis-observation')
  })

  it.each(['observe', 'check-required'])('does not carry a previous %s review or suggested check into the continuation', decision => {
    const f = fixture(); f.source('prior-source', { assetId: asset.id }); f.write(); f.execute(); f.explain()
    const prior = packet(f, operation, config); f.review(prior, { ...adverse, decision })
    f.event('user/message', { source: { kind: 'user' }, content: [] }); f.execute('current-run'); f.explain()
    const current = packet(f, operation, config)
    expect(current.status).toBe('ready')
    expect(current.userSeq).not.toBe(prior.userSeq)
    expect(interpretationReviewFromSession(f.session, current, config)).toBeUndefined()
    expect(interpretationConcernFromSession(f.session, current, config)).toBeUndefined()
    expect(interpretationCheckFromSession(f.session, state, config, smallCheck)).toBe(false)
  })

  it('reuses only the same selected source and asset mapping after a workbench view refresh', () => {
    const f = fixture()
    f.source('source-a', { assetId: asset.id }); f.source('source-b', { assetId: 'asset-other' }); f.write()
    f.event('user/message', { source: { kind: 'user' }, content: [] }); f.execute(); f.explain()
    const first = packet(f, operation, config)
    f.review(first, { decision: 'supported', rationale: 'This bounded step uses the supplied original record.', evidenceRefs: ['source-a'] })
    expect(packet(f, operation, config).reason).toBe(first.reason)
    expect(interpretationReviewFromSession(f.session, packet(f, operation, config), config)).toBeDefined()
    const remapped = packet(f, operation, { ...config, analysisAssets: [{ ...asset, id: 'asset-other' }] })
    expect(remapped.status).toBe('ready')
    expect(remapped.basisKey).toBe(first.basisKey)
    expect(remapped.reason).not.toBe(first.reason)
    expect(remapped.refs).toContain('source-b')
    expect(interpretationReviewFromSession(f.session, remapped, config)).toBeUndefined()
    const otherEngagement = packet(f, operation, { ...config, analysisAssets: [{ ...asset, engagementId: 'engagement-other' }] })
    expect(otherEngagement.reason).not.toBe(first.reason)
  })

  it('changes review identity when a selected source output or argument changes', () => {
    const f = previous(); f.execute(); f.explain()
    const first = packet(f, operation, config)
    f.review(first, { decision: 'observe', rationale: 'Read the selected field.', evidenceRefs: ['prior-source'] })
    const call = f.rows.find(row => row.type === 'tool/call' && row.data.callId === 'prior-source')!
    call.data.arguments = JSON.stringify({ assetId: asset.id, offset: 64 })
    const changedArguments = packet(f, operation, config)
    expect(changedArguments.reason).not.toBe(first.reason)
    expect(interpretationReviewFromSession(f.session, changedArguments, config)).toBeUndefined()
    const result = f.rows.find(row => row.type === 'tool/result' && row.data.message.toolCallId === 'prior-source')!
    result.data.message.content[0].text = result.data.message.content[0].text.replace('1234', '5678')
    expect(packet(f, operation, config).reason).not.toBe(changedArguments.reason)
  })
})

describe('interpretation review reuse and unresolved concerns', () => {
  it('does not reuse an accepted verdict for a changed interpretation', () => {
    const f = ready(), p = packet(f)
    f.review(p, { decision: 'observe', rationale: 'Limited observation.', evidenceRefs: ['run'] })
    f.explain('These measurements prove every layout impossible.')
    const later = packet(f)
    expect(later.basisKey).toBe(p.basisKey)
    expect(later.reason).not.toBe(p.reason)
    expect(interpretationReviewFromSession(f.session, later, options)).toBeUndefined()
  })

  it('does not reuse an accepted next operation in a different effective working directory', () => {
    const f = ready(), p = packet(f)
    f.review(p, { decision: 'observe', rationale: 'Bounded operation.', evidenceRefs: ['run'] })
    f.event('working-directory/change', { cwd: 'D:/other' })
    expect(packet(f).basisKey).not.toBe(p.basisKey)
    expect(interpretationReviewFromSession(f.session, packet(f), options)).toBeUndefined()
  })

  it('preserves a known concern across rejected attempts, reads and changed wording', () => {
    const f = ready(), p = packet(f); f.review(p, adverse)
    f.call(operation.name, 'denied', operation.arguments); f.result('denied', 'check required', true)
    f.call('read', 'intervening-read', { path: 'notes' }); f.result('intervening-read', 'notes')
    f.explain('Proceed anyway with a different description.')
    const later = packet(f)
    expect(later.status).toBe('ready')
    expect(later.producerCallId).toBe('run')
    expect(interpretationConcernFromSession(f.session, later, options).review.decision).toBe('check-required')
    expect(packet(f, { ...operation, arguments: { file_path: 'other.py', content: 'measure()' } }).status).toBe('no-candidate')
    f.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] })
    expect(interpretationOwnership(f.session, state, options, operation).status).toBe('owned')
    expect(packet(f).status).toBe('no-candidate')
  })
  it('reuses a supported correct result without requiring it to be contradicted', () => {
    const f = ready(), p = packet(f)
    f.review(p, { decision: 'supported', rationale: 'The proposed action stays within the measured range.', evidenceRefs: ['run'] })
    expect(interpretationReviewFromSession(f.session, p, options).review).toMatchObject({ status: 'reviewed', decision: 'supported', scientificallyVerified: false })
    expect(interpretationConcernFromSession(f.session, p, options)).toBeUndefined()
  })

  it('reuses exact result, interpretation and operation but rechecks new results or arguments', () => {
    const f = ready(), p = packet(f); f.review(p, { decision: 'observe', rationale: 'This is a direct check.', evidenceRefs: ['run'] })
    expect(packet(f).basisKey).toBe(p.basisKey)
    expect(interpretationReviewFromSession(f.session, packet(f), options)).toBeDefined()
    const changed = packet(f, { ...operation, arguments: { ...operation.arguments, content: 'different()' } })
    expect(interpretationReviewFromSession(f.session, changed, options)).toBeUndefined()
    f.execute('new-result', 'different observation'); f.explain()
    expect(interpretationReviewFromSession(f.session, packet(f), options)).toBeUndefined()
  })

  it('retains a concrete concern when new evidence changes the same pending operation and review becomes unavailable', () => {
    const f = ready(), p = packet(f); f.review(p, adverse)
    f.execute('check', 'more observations', smallCheck); f.explain()
    const later = packet(f)
    expect(later.basisKey).not.toBe(p.basisKey)
    expect(interpretationReviewFromSession(f.session, later, options)).toBeUndefined()
    expect(interpretationConcernFromSession(f.session, later, options).review.decision).toBe('check-required')
    expect(interpretationConcernFromSession(f.session, { ...later, status: 'unreviewed', context: undefined }, options)).toBeDefined()
    f.review(later, { invalid: true }, 'invalid')
    expect(interpretationConcernFromSession(f.session, later, options)).toBeDefined()
    f.review(later, { decision: 'observe', rationale: 'This exact action only measures the disputed input.', evidenceRefs: ['check'] }, 'resolved')
    expect(interpretationConcernFromSession(f.session, later, options)).toBeUndefined()
  })

  it('does not transfer concern to a different operation or user', () => {
    const f = ready(), p = packet(f); f.review(p, adverse)
    const other = packet(f, { ...operation, arguments: { file_path: 'D:/analysis/other.py', content: 'check()' } })
    expect(interpretationConcernFromSession(f.session, other, options)).toBeUndefined()
    f.event('user/message', { source: { kind: 'user' }, content: [] })
    expect(interpretationConcernFromSession(f.session, p, options)).toBeUndefined()
  })

  it('recognizes an exact proposed inline check without recursively reviewing it', () => {
    const f = ready(), p = packet(f); f.review(p, adverse)
    expect(interpretationCheckFromSession(f.session, state, options, smallCheck)).toBe(true)
    expect(interpretationCheckFromSession(f.session, state, options, { ...smallCheck, arguments: { command: 'python -c "print(2)"' } })).toBe(false)
  })

  it('keeps a suggested UTF-8 invocation outside automatic check exemptions', () => {
    const f = ready(), check = { name: 'pwsh', arguments: { command: 'python -X utf8 -c "print(1)"' } }
    f.review(packet(f), { ...adverse, check })
    expect(interpretationCheckFromSession(f.session, state, options, check)).toBe(false)
  })

  it('requires the same known file check version, rejecting later writes and unknown files', () => {
    const f = ready(); f.write('print(1)', 'check-write', 'D:/analysis/check.py')
    const check = { name: 'pwsh', arguments: { command: 'python D:/analysis/check.py' } }, p = packet(f)
    f.review(p, { ...adverse, check })
    expect(interpretationCheckFromSession(f.session, state, options, check)).toBe(true)
    f.write('print(2)', 'changed-check', 'D:/analysis/check.py')
    expect(interpretationCheckFromSession(f.session, state, options, check)).toBe(false)
    const unknown = ready(); unknown.review(packet(unknown), { ...adverse, check })
    expect(interpretationCheckFromSession(unknown.session, state, options, check)).toBe(false)
    const compound = { name: 'pwsh', arguments: { command: 'python D:/analysis/check.py | Tee-Object output.txt' } }
    unknown.review(packet(unknown), { ...adverse, check: compound }, 'compound')
    expect(interpretationCheckFromSession(unknown.session, state, options, compound)).toBe(false)
  })

  it.each(['file', 'inline'])('binds a suggested %s check to its effective working directory', kind => {
    const f = ready(); f.write('print(1)', 'check-a', 'D:/analysis/check.py'); f.write('print(1)', 'check-b', 'D:/other/check.py')
    const check = { name: 'pwsh', arguments: { command: kind === 'file' ? 'python check.py' : 'python -c "print(1)"' } }
    f.review(packet(f), { ...adverse, check })
    expect(interpretationCheckFromSession(f.session, state, options, check)).toBe(true)
    f.event('working-directory/change', { cwd: 'D:/other' })
    expect(interpretationCheckFromSession(f.session, state, options, check)).toBe(false)
  })
})
