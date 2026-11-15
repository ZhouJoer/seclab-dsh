/** Associate a completed generated experiment with the public interpretation preceding a proposed operation. */
import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { commandFingerprint, parseAdoptionReview } from './adoption.mjs'
import { durableEvidence, evidenceBinding } from './evidence.mjs'
import { referenceAliases } from './references.mjs'
import { identifyScriptExecution } from './automatic-experiment.mjs'

export const INTERPRETATION_REASON = 'Experiment interpretation v1: '
const hash = value => createHash('sha256').update(value).digest('hex')
const text = content => (content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const parse = value => {
  if (object(value)) return value
  try { const parsed = JSON.parse(value); return object(parsed) ? parsed : undefined }
  catch (_error) { return undefined /* Non-JSON output remains evidence text, not structural metadata. */ }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const stable = value => JSON.stringify(canonical(value))
const resolvePath = (value, cwd) => {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) return undefined
  const windows = /^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:[\\/]/.test(cwd ?? '')
  const paths = windows ? win32 : posix
  if (!paths.isAbsolute(value) && !cwd) return undefined
  const path = paths.resolve(cwd ?? '/', value).replaceAll('\\', '/')
  return { path, key: windows ? path.toLowerCase() : path }
}
const boundaryOf = (events, state) => {
  const sinceSeq = Math.max(state.sinceSeq, ...events.filter(event => event.type === 'user/message'
    && event.data.source.kind === 'user').map(event => event.seq))
  return { sinceSeq, pending: events.some(event => event.seq > sinceSeq && event.type === 'agent/inbox/spliced'
    && event.data.inserted.some(message => message.source.kind === 'user')) }
}
const cwdAt = (session, seq, options) => session.snapshotEvents().findLast(event => event.seq < seq
  && event.type === 'working-directory/change')?.data.cwd ?? session.header?.cwd ?? options.cwd
const operationCwd = (operation, cwd) => resolvePath(operation.arguments?.workdir ?? operation.arguments?.cwd ?? cwd, cwd)

/** Split only unquoted statement separators; interpolation and arbitrary shell programs remain unsupported. */
function statements(command) {
  let quote, part = '', parts = []
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote) {
      if (char === quote) quote = undefined
      part += char
    } else if (char === '"' || char === "'") { quote = char; part += char }
    else if (char === ';' || char === '\n' || char === '\r') {
      if (part.trim()) parts.push(part.trim())
      part = ''
    } else part += char
  }
  if (quote) return undefined
  if (part.trim()) parts.push(part.trim())
  return parts
}

function literalTokens(line) {
  const tokens = []
  let index = 0
  while (index < line.length) {
    if (/\s/.test(line[index])) { index++; continue }
    const quote = ['"', "'"].includes(line[index]) ? line[index++] : undefined
    let value = ''
    if (quote) {
      while (index < line.length && line[index] !== quote) value += line[index++]
      if (index === line.length) return undefined
      index++
      if (index < line.length && !/\s/.test(line[index])) return undefined
    } else while (index < line.length && !/\s/.test(line[index])) value += line[index++]
    tokens.push({ value, quote })
  }
  return tokens
}

/** Identify supported file or literal Python inline producers without executing shell text.
 * @param operation Exact shell tool name and arguments.
 * @param cwd Working directory at the recorded execution.
 * @returns Identified code/file with explicit selection and formatting limits, not-script, or uncovered syntax; formatting never certifies output completeness.
 */
export function identifyInterpretationProducer(operation, cwd) {
  const command = operation.arguments?.command
  if (typeof command !== 'string' || !command.trim()) return { status: 'not-script', reason: 'no-command' }
  const effectiveCwd = operationCwd(operation, cwd)
  if ((operation.arguments?.workdir !== undefined || operation.arguments?.cwd !== undefined) && !effectiveCwd)
    return { status: 'uncovered', reason: 'unresolved-working-directory' }
  const parts = statements(command)
  if (!parts?.length) return { status: 'uncovered', reason: 'unbalanced-shell-quotes' }
  const prelude = []
  while (parts.length > 1 && operation.name === 'pwsh'
    && /^\$[A-Za-z_]\w*\s*=\s*(['"])[^'"`$]*\1$/.test(parts[0])) prelude.push(parts.shift())
  if (parts.length !== 1) return { status: 'uncovered', reason: 'compound-command' }
  const tokens = literalTokens(parts[0])
  if (!tokens?.length) return { status: 'uncovered', reason: 'unsupported-shell-syntax' }
  let outputSelection, formatting
  const pipe = tokens.findIndex(token => !token.quote && token.value === '|')
  if (pipe >= 0) {
    const suffix = tokens.slice(pipe + 1)
    if (operation.name !== 'pwsh' || suffix.length !== 3 || suffix.some(token => token.quote)
      || !/^[1-9]\d*$/.test(suffix[2].value) || !Number.isSafeInteger(Number(suffix[2].value)))
      return { status: 'uncovered', reason: 'unsupported-output-pipeline' }
    if (suffix[0].value.toLowerCase() === 'select-object' && suffix[1].value.toLowerCase() === '-first')
      outputSelection = { kind: 'first-lines', count: Number(suffix[2].value), completeProducerOutput: false }
    else if (suffix[0].value.toLowerCase() === 'out-string' && suffix[1].value.toLowerCase() === '-width')
      formatting = { kind: 'powershell-out-string', width: Number(suffix[2].value),
        limitation: 'Text formatting preserves producer association; it does not establish complete or byte-identical output.' }
    else return { status: 'uncovered', reason: 'unsupported-output-pipeline' }
    tokens.splice(pipe)
  }
  if (!tokens.at(-1)?.quote && tokens.at(-1)?.value === '2>&1') tokens.pop()
  if (!tokens.length) return { status: 'not-script', reason: 'empty-command' }
  const executable = tokens[0].value.replaceAll('\\', '/').split('/').at(-1).toLowerCase().replace(/\.exe$/, '')
  const python = /^(?:python(?:\d+(?:\.\d+)*)?|py)$/.test(executable)
  let position = 1
  if (python) while (/^(?:-u|-B|-I|-3(?:\.\d+)?)$/.test(tokens[position]?.value ?? '')) position++
  if (python && tokens[position]?.value === '-c') {
    const code = tokens[position + 1]
    if (!code?.quote || tokens.length !== position + 2
      || code.value.includes('`')
      || operation.name !== 'pwsh' && code.quote === '"' && /\\["$`\\]/.test(code.value))
      return { status: 'uncovered', reason: 'nonliteral-inline-code' }
    let expanded = code.value
    if (code.quote !== "'" && expanded.includes('$')) {
      if (operation.name !== 'pwsh') return { status: 'uncovered', reason: 'nonliteral-inline-code' }
      const variables = new Map(prelude.map(line => {
        const match = /^\$([A-Za-z_]\w*)\s*=\s*(['"])([^'"`$]*)\2$/.exec(line)
        return [match[1].toLowerCase(), match[3]]
      }))
      let unknown = false
      expanded = expanded.replace(/\$([A-Za-z_]\w*)/g, (_match, name) => {
        const value = variables.get(name.toLowerCase())
        if (value === undefined) unknown = true
        return value ?? ''
      })
      if (unknown || expanded.includes('$')) return { status: 'uncovered', reason: 'nonliteral-inline-code' }
    }
    return { status: 'identified', kind: 'inline', interpreter: executable, code: expanded, cwd: effectiveCwd?.path,
      codeSha256: hash(expanded), outputSelection, ...formatting ? { formatting } : {},
      coverage: 'Literal Python -c only; output selection, when present, is not complete producer output.' }
  }
  const direct = tokens.map(token => token.quote ? `${token.quote}${token.value}${token.quote}` : token.value).join(' ')
  const normalized = [...prelude, direct].join('\n')
  const result = identifyScriptExecution({ ...operation, arguments: { ...operation.arguments, command: normalized,
    cwd: effectiveCwd?.path } }, effectiveCwd?.path)
  return result.status === 'identified' ? { ...result, kind: 'file', cwd: effectiveCwd?.path, outputSelection,
    ...formatting ? { formatting } : {} } : result
}

function producers(session, state, options, requireCurrentWrite) {
  const events = session.snapshotEvents(), pending = new Map(), scripts = new Map(), results = []
  const pairs = new Map(durableEvidence(session, state, options).map(pair => [pair.callId, pair]))
  let cwd = session.header?.cwd ?? events.find(event => event.type === 'session')?.cwd ?? options.cwd
  for (const event of events) {
    if (event.type === 'working-directory/change') cwd = event.data.cwd
    if (event.type === 'tool/call') {
      const args = parse(event.data.arguments)
      if (!args) continue
      pending.set(event.data.callId, { event, args, cwd })
      if (event.seq <= state.sinceSeq || !options.executionTools.includes(event.data.name)) continue
      const invocation = identifyInterpretationProducer({ name: event.data.name, arguments: args }, cwd)
      if (invocation.status !== 'identified') continue
      const script = invocation.kind === 'inline'
        ? { kind: 'inline', code: invocation.code, codeSha256: invocation.codeSha256, callSeq: event.seq }
        : scripts.get(invocation.key)
      if (script?.code === undefined || requireCurrentWrite && script.callSeq <= state.sinceSeq) continue
      const pair = pairs.get(event.data.callId)
      if (pair) results.push({ callId: pair.callId, callSeq: pair.callSeq, resultSeq: pair.resultSeq,
        pair, script: { ...script }, invocation })
      continue
    }
    if (event.type !== 'tool/result') continue
    const call = pending.get(event.data.message.toolCallId)
    if (!call || !['write', 'edit'].includes(call.event.data.name)) continue
    const resolved = resolvePath(call.args.file_path ?? call.args.path, call.cwd)
    if (!resolved || !options.scriptExtensions.includes(posix.extname(resolved.path).toLowerCase())) continue
    const version = { ...resolved, kind: 'file', callId: call.event.data.callId, callSeq: call.event.seq, resultSeq: event.seq }
    if (event.data.message.isError || /^Error:/i.test(text(event.data.message.content))) {
      scripts.set(resolved.key, { ...version, issue: 'failed-write-state-unknown' }); continue
    }
    if (call.event.data.name === 'write' && typeof call.args.content === 'string') {
      scripts.set(resolved.key, { ...version, code: call.args.content, codeSha256: hash(call.args.content) }); continue
    }
    const prior = scripts.get(resolved.key), before = call.args.old_string, after = call.args.new_string
    const count = typeof before === 'string' && before && prior?.code !== undefined ? prior.code.split(before).length - 1 : 0
    if (!count || typeof after !== 'string' || !call.args.replace_all && count !== 1) {
      scripts.set(resolved.key, { ...version, issue: 'complete-script-not-reconstructable' }); continue
    }
    const code = call.args.replace_all ? prior.code.replaceAll(before, after) : prior.code.replace(before, after)
    scripts.set(resolved.key, { ...version, code, codeSha256: hash(code) })
  }
  return results.sort((left, right) => left.resultSeq - right.resultSeq)
}

/** Reconstruct the logged code version at one execution, retaining failed and partial result status.
 * @param session Durable Session accessor.
 * @param callId Recorded execution call, including an explicitly referenced older turn.
 * @param options Explicit script extensions, execution/check/excluded tools, and fallback cwd.
 * @returns Producer and original pair, or undefined for unsupported or unreconstructable code; never an execution approval.
 */
export function loggedProducerForCall(session, callId, options) {
  return producers(session, { sinceSeq: -1 }, options, false).find(item => item.callId === callId)
}

/** Find current-request generated experiments with complete recorded execution results.
 * @param session Durable Session accessor.
 * @param state Current human-request boundary.
 * @param options Explicit script, tool and cwd settings.
 * @returns Current executions with logged code versions, including earlier writes; unlogged file changes and selected output remain explicitly limited.
 */
export function loggedExperimentProducers(session, state, options) {
  const boundary = boundaryOf(session.snapshotEvents(), state)
  return producers(session, { sinceSeq: boundary.sinceSeq }, options, false).filter(item =>
    item.pair.execution?.status === 'completed' && !item.pair.isError && !item.pair.recordedPartial && !item.pair.nonTextBlocks)
}

const identifiers = pair => {
  const args = parse(pair.arguments.text), output = parse(pair.result.text)
  return [pair.callId, `r${pair.resultSeq}`, output?.evidenceId,
    ...Object.entries(args ?? {}).filter(([key]) => /^(?:path|file_path|inputPath|outputPath|assetId|evidenceId)$/.test(key)).map(([, value]) => value)]
    .filter(value => typeof value === 'string' && value.length > 1)
}
const normalizedReferenceText = value => value.replaceAll('\\\\', '/').replaceAll('\\', '/').toLowerCase()
const containsReference = (content, value) => new RegExp(`(^|[^a-z0-9_./:-])${normalizedReferenceText(value)
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_./:-])`).test(content)

const analysisObservation = (pair, options) => {
  if (!options.sourceTools.includes(pair.name) || pair.isError || pair.recordedPartial || pair.nonTextBlocks) return false
  const result = parse(pair.result.text)
  return typeof result?.evidenceId === 'string' && result.evidenceId.length > 0
    && options.sourceOperations.includes(result.operation) && Array.isArray(result.items) && result.items.length > 0
}

function historicalAnalysisSources(session, boundary, producer, options) {
  const content = [producer.script.code, producer.pair.arguments.text].join('\n').replaceAll('\\\\', '/').replaceAll('\\', '/')
  const assets = (options.analysisAssets ?? []).flatMap(asset => {
    const resolved = resolvePath(asset.path)
    return resolved && typeof asset.id === 'string' && asset.id.length > 0 ? [{ ...asset, ...resolved }] : []
  })
  const matches = (value, insensitive = false) => new RegExp(`(^|[^A-Za-z0-9_./:-])${value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_./:-])`, insensitive ? 'i' : '').test(content)
  const referenced = new Map(assets.filter(asset => matches(asset.id)
    || new Set(assets.filter(other => other.key === asset.key).map(other => other.id)).size === 1
      && matches(asset.path, /^[A-Za-z]:\//.test(asset.path))).map(asset => [asset.id, asset]))
  if (!referenced.size) return { pairs: [], bindings: new Map() }
  const calls = session.snapshotEvents().filter(event => event.seq <= boundary.sinceSeq && event.type === 'tool/call'
    && options.sourceTools.includes(event.data.name) && referenced.has(parse(event.data.arguments)?.assetId))
  const pairs = durableEvidence(session, { sinceSeq: -1 }, options, calls.map(call => call.data.callId))
    .filter(pair => pair.resultSeq <= boundary.sinceSeq && analysisObservation(pair, options))
  return { pairs, bindings: new Map(pairs.map(pair => {
    const asset = referenced.get(parse(pair.arguments.text).assetId)
    return [pair.callId, { assetId: asset.id, path: asset.path,
      ...(asset.engagementId ? { engagementId: asset.engagementId } : {}) }]
  })) }
}
function candidate(session, state, options, operation, ownershipOnly = false) {
  if (!options.consumptionTools.includes(operation.name)) return { status: 'no-candidate', reason: 'not-a-consumption-tool' }
  const events = session.snapshotEvents(), boundary = boundaryOf(events, state)
  const pendingReviews = reviews(session, { userSeq: boundary.sinceSeq,
    toolFingerprint: commandFingerprint(operation.name, operation.arguments),
    operationCwdKey: operationCwd(operation, cwdAt(session, Infinity, options))?.key }, options, true, ownershipOnly)
  let concern
  for (const item of pendingReviews) {
    if (accepted(item.review)) concern = undefined
    else if (item.review.status === 'proposal-only' || item.review.status === 'reviewed'
      && ['check-required', 'insufficient-evidence'].includes(item.review.decision)) concern = item
  }
  const interpretation = events.findLast(event => event.seq > boundary.sinceSeq && event.type === 'assistant/message')
  const explanation = text(interpretation?.data.message.content).trim() || concern?.context.interpretation.text
  if (!explanation) return { status: 'no-candidate', reason: 'no-adjacent-public-interpretation' }
  if (!concern && options.interpretationSignals.length
    && !options.interpretationSignals.some(signal => explanation.toLowerCase().includes(signal.toLowerCase())))
    return { status: 'no-candidate', reason: 'no-public-commitment-marker' }
  const allPairs = durableEvidence(session, { sinceSeq: boundary.sinceSeq }, options)
  const knownProducers = loggedExperimentProducers(session, state, options)
  let producer = knownProducers.filter(item => item.resultSeq < interpretation.seq).at(-1)
  if (!producer) return { status: 'no-candidate', reason: 'no-complete-current-request-producer' }
  if (allPairs.some(pair => pair.resultSeq > producer.resultSeq && pair.resultSeq < interpretation.seq && !pair.isError)) {
    const disputed = concern && knownProducers.find(item => item.callId === concern.context.producer.callId)
    if (!disputed) return { status: 'no-candidate', reason: 'interpretation-follows-another-observation' }
    producer = disputed
  }
  const historical = historicalAnalysisSources(session, boundary, producer, options)
  const eligible = [...historical.pairs, ...allPairs.filter(pair => pair.resultSeq < producer.callSeq && analysisObservation(pair, options))]
  if (!eligible.length) return { status: 'no-candidate', reason: 'no-prior-analysis-observation' }
  return { status: 'candidate', boundary, producer, interpretation, explanation, eligible, allPairs,
    historicalBindings: historical.bindings }
}

/** Identify a pending interpretation-owned operation even when steering prevents review.
 * @param session Durable Session accessor.
 * @param state Current request boundary.
 * @param options Explicit producer/source/consumption settings.
 * @param operation Exact next operation.
 * @returns Owned producer identity or not-owned; ownership never authorizes execution.
 */
export function interpretationOwnership(session, state, options, operation) {
  const input = candidate(session, state, options, operation, true)
  return input.status === 'candidate' ? { status: 'owned', userSeq: input.boundary.sinceSeq,
    producerCallId: input.producer.callId, resultSeq: input.producer.resultSeq,
    scriptPath: input.producer.script.path, scriptCodeSha256: input.producer.script.codeSha256 }
    : { status: 'not-owned', reason: input.reason }
}

/** Construct an interpretation packet from complete logged code and its actual output, without trimming.
 * @param session Durable Session accessor.
 * @param state Current request boundary.
 * @param options Explicit tools, source count, cwd, byte budget and trusted analysisAssets mappings for previous-request source identity.
 * @param operation Exact proposed tool call, not a completed observation.
 * @param checkToolSchemas Schemas available for independent checks.
 * @returns Ready, no-candidate, or oversized unreviewed packet; missing independent inputs are explicit.
 */
export function interpretationPacket(session, state, options, operation, checkToolSchemas = []) {
  const boundary = boundaryOf(session.snapshotEvents(), state)
  if (boundary.pending || operation.signal?.aborted) return { status: 'no-candidate', reason: 'cancelled-or-pending-user' }
  const input = candidate(session, state, options, operation)
  if (input.status !== 'candidate') return input
  const { producer, interpretation, explanation, eligible, allPairs, historicalBindings } = input
  const referenceText = normalizedReferenceText([producer.script.code, producer.pair.arguments.text, explanation, stable(operation.arguments)].join('\n'))
  const related = eligible.filter(pair => historicalBindings.has(pair.callId) || identifiers(pair).some(id => containsReference(referenceText, id)))
  const sources = related.slice(-options.maxSourcePairs)
  const selected = [producer.pair, ...sources]
  const refs = selected.map(pair => pair.callId), aliases = referenceAliases(selected)
  const plannedRefs = operation.callId ? [operation.callId, `operation:${operation.callId}`] : []
  const toolFingerprint = commandFingerprint(operation.name, operation.arguments)
  const operationCwdKey = operationCwd(operation, cwdAt(session, Infinity, options))?.key
  const checkToolSchemaKey = hash(stable(checkToolSchemas))
  const basisKey = hash(stable({ userSeq: boundary.sinceSeq, producerCallId: producer.callId,
    producerResultSha256: producer.pair.result.sha256, codeSha256: producer.script.codeSha256,
    toolFingerprint, operationCwdKey, checkToolSchemaKey }))
  const subsequent = allPairs.filter(pair => pair.resultSeq > producer.resultSeq && pair.callId !== operation.callId
    && options.checkTools.includes(pair.name) && pair.execution?.status === 'completed'
    && !pair.isError && !pair.recordedPartial && !pair.nonTextBlocks).at(-1)
  const subsequentEvidence = subsequent ? { resultSeq: subsequent.resultSeq, contentSha256: subsequent.contentSha256 } : null
  if (subsequent && !refs.includes(subsequent.callId)) { selected.push(subsequent); refs.push(subsequent.callId); Object.assign(aliases, referenceAliases([subsequent])) }
  const selectedInvocations = new Map(selected.filter(pair => options.executionTools.includes(pair.name)).map(pair => [pair.callId,
    identifyInterpretationProducer({ name: pair.name, arguments: parse(pair.arguments.text) }, cwdAt(session, pair.callSeq, options))]))
  const rawUsableRefs = selected.filter(pair => !pair.isError && !pair.recordedPartial && !pair.nonTextBlocks
    && parse(pair.result.text)?.incomplete !== true
    && !selectedInvocations.get(pair.callId)?.outputSelection).map(pair => pair.callId)
  const sourceIdentity = selected.map(pair => ({ callId: pair.callId, argumentsSha256: pair.arguments.sha256,
    resultSha256: pair.result.sha256, assetBinding: historicalBindings.get(pair.callId) }))
  const reason = INTERPRETATION_REASON + hash(stable({ basisKey, interpretation: explanation, subsequentEvidence, sourceIdentity }))
  const context = JSON.stringify({ kind: 'experiment-interpretation', version: 1, basisKey, userSeq: boundary.sinceSeq,
    decisionSeq: interpretation.seq, toolFingerprint, operationCwdKey, checkToolSchemaKey, subsequentEvidence,
    producer: { callId: producer.callId, callSeq: producer.callSeq, resultSeq: producer.resultSeq,
      script: producer.script, invocation: producer.invocation,
      coverage: 'Code is reconstructed at execution time from logged writes/edits or a literal inline argument; unlogged external changes are unknown.' },
    interpretation: { seq: interpretation.seq, text: explanation, status: 'analyst-interpretation' },
    sourceSelection: { strategy: 'explicit-reference-path-or-proposed-asset', analysisEligibilityCount: eligible.length,
      previousRequestCount: eligible.filter(pair => historicalBindings.has(pair.callId)).length,
      relatedCount: related.length, omittedRelatedCount: related.length - sources.length,
      missingOriginalInputs: !sources.length,
      limitation: 'The producer code/result supports checking its measurement and interpretation. Earlier asset observations identify the target, not unchanged current input bytes or prior authorization. Missing original inputs cannot be certified; unrelated recent analysis outputs are excluded.' },
    observations: selected.map(pair => ({ ...evidenceBinding(session, pair, options), arguments: pair.arguments.text, output: pair.result.text,
      ...(historicalBindings.has(pair.callId) ? { requestScope: 'previous-request', assetBinding: historicalBindings.get(pair.callId) } : {}),
      ...selectedInvocations.get(pair.callId)?.outputSelection ? { outputSelection: selectedInvocations.get(pair.callId).outputSelection } : {} })),
    proposedOperation: { status: 'planned', name: operation.name, arguments: operation.arguments,
      workingDirectory: operationCwdKey, ...operation.callId ? { callId: operation.callId } : {} },
    allowedCheckTools: options.checkTools, allowedCheckToolSchemas: checkToolSchemas,
    refs, rawUsableRefs, referenceAliases: aliases, plannedRefs })
  const packet = { basisKey, reason, userSeq: boundary.sinceSeq, decisionSeq: interpretation.seq, toolFingerprint,
    checkToolSchemaKey, operationCwdKey, producerCallId: producer.callId, resultSeq: producer.resultSeq,
    scriptPath: producer.script.path, scriptCodeSha256: producer.script.codeSha256,
    refs, rawUsableRefs, referenceAliases: aliases, plannedRefs, requestBytes: Buffer.byteLength(context) }
  return packet.requestBytes > options.maxRequestBytes
    ? { ...packet, status: 'unreviewed', issue: 'packet-over-budget', maxRequestBytes: options.maxRequestBytes,
      message: '完整生产代码、实际结果与待采用解释超过复核预算；未裁剪后认证。' }
    : { ...packet, status: 'ready', context }
}

function reviews(session, packet, options, sameOperation = false, ownershipOnly = false) {
  const events = session.snapshotEvents(), boundary = boundaryOf(events, { sinceSeq: packet.userSeq })
  if (boundary.sinceSeq !== packet.userSeq || boundary.pending && !ownershipOnly) return []
  const starts = new Map(), result = []
  for (const event of events) {
    if (event.seq <= packet.userSeq) continue
    const id = event.data?.consultationId ?? event.data?.callId
    if (event.type === 'helper/auto-start' && event.data.question?.reason?.startsWith(INTERPRETATION_REASON)) {
      const context = parse(event.data.question.context)
      if (context?.kind === 'experiment-interpretation' && context.userSeq === packet.userSeq
        && (sameOperation ? context.toolFingerprint === packet.toolFingerprint && context.operationCwdKey === packet.operationCwdKey
          : context.basisKey === packet.basisKey))
        starts.set(id, { ...context, reason: event.data.question.reason })
    }
    if (event.type !== 'helper/auto-end' || !starts.has(id)) continue
    const original = starts.get(id)
    const review = event.data.status === 'completed'
      ? parseAdoptionReview(event.data.answer, { ...original, status: 'ready' }, options)
      : { status: 'unreviewed', message: '解释复核未正常交付；结束或取消不表示通过。' }
    result.push({ reason: original.reason, context: original, reviewSeq: event.seq, status: event.data.status, review })
  }
  return result
}
const accepted = review => review.status === 'reviewed' && ['observe', 'supported'].includes(review.decision)
const settled = item => item ? { reviewSeq: item.reviewSeq, status: item.status, review: item.review } : undefined

/** Read an existing review of the same producer result, interpretation and exact next operation.
 * @param session Durable Session accessor.
 * @param packet Current candidate identity.
 * @param options Allowed independent checks.
 * @returns Latest reusable attempt, including explicit delivery failures, or undefined.
 */
export function interpretationReviewFromSession(session, packet, options) {
  return settled(reviews(session, packet, options).findLast(item => item.reason === packet.reason))
}

/** Preserve a concrete same-decision concern until a complete later review clears it.
 * @param session Durable Session accessor.
 * @param packet Current identity, including oversized packets without context.
 * @param options Allowed checks used to parse recorded reviews.
 * @returns Latest valid adverse review, or undefined; unknown delivery cannot create or clear a concern.
 */
export function interpretationConcernFromSession(session, packet, options) {
  let concern
  for (const item of reviews(session, packet, options, true)) {
    if (accepted(item.review)) concern = undefined
    else if (item.review.status === 'proposal-only' || item.review.status === 'reviewed'
      && ['check-required', 'insufficient-evidence'].includes(item.review.decision)) concern = settled(item)
  }
  return concern
}

/** Recognize an exact proposed check without bypassing ordinary permissions or explicit adoption checks.
 * @param session Durable Session accessor.
 * @param state Current request boundary.
 * @param options Allowed checks and script reconstruction settings.
 * @param operation Exact proposed operation.
 * @returns Whether a valid same-request review proposed it; file checks require the same logged code version.
 */
export function interpretationCheckFromSession(session, state, options, operation) {
  const events = session.snapshotEvents(), boundary = boundaryOf(events, state)
  if (boundary.pending || operation.signal?.aborted) return false
  const fingerprint = commandFingerprint(operation.name, operation.arguments), starts = new Map()
  for (const event of events) {
    if (event.seq <= boundary.sinceSeq) continue
    const id = event.data?.consultationId ?? event.data?.callId
    if (event.type === 'helper/auto-start' && event.data.question?.reason?.startsWith(INTERPRETATION_REASON)) {
      const context = parse(event.data.question.context)
      if (context?.kind === 'experiment-interpretation' && context.userSeq === boundary.sinceSeq) starts.set(id, { context, seq: event.seq })
    }
    if (event.type !== 'helper/auto-end' || event.data.status !== 'completed' || !starts.has(id)) continue
    const { context, seq } = starts.get(id)
    const review = parseAdoptionReview(event.data.answer, { ...context, status: 'ready' }, options)
    if (!['reviewed', 'proposal-only'].includes(review.status) || !review.check
      || commandFingerprint(review.check.name, review.check.arguments) !== fingerprint) continue
    const earlierCwd = operationCwd(operation, cwdAt(session, seq, options))
    const currentCwd = operationCwd(operation, cwdAt(session, Infinity, options))
    if (!earlierCwd || earlierCwd.key !== currentCwd?.key) continue
    const invocation = identifyInterpretationProducer(operation, cwdAt(session, Infinity, options))
    if (invocation.status === 'uncovered') continue
    if (invocation.status === 'not-script' || invocation.kind === 'inline') return true
    const syntheticCallId = 'interpretation-check-version'
    const versionAt = limit => {
      const before = events.filter(item => item.seq < limit)
      const callSeq = (before.at(-1)?.seq ?? boundary.sinceSeq) + 1
      const extra = [
        { seq: callSeq, time: callSeq, type: 'tool/call', data: { name: operation.name, callId: syntheticCallId, arguments: JSON.stringify(operation.arguments) } },
        { seq: callSeq + 1, time: callSeq + 1, type: 'tool/result', data: { message: { toolCallId: syntheticCallId, content: [] } } },
      ]
      const projected = { id: session.id, header: session.header, snapshotEvents: () => [...before, ...extra] }
      const script = producers(projected, { sinceSeq: boundary.sinceSeq }, options, true)
        .find(item => item.callId === syntheticCallId)?.script
      return script?.codeSha256 && stable({ key: script.key, codeSha256: script.codeSha256 })
    }
    const earlierHash = versionAt(seq)
    if (earlierHash !== undefined && earlierHash === versionAt(Infinity)) return true
  }
  return false
}
