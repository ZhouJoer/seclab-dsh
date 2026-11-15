/** Review logged analysis-script versions against complete native observations before their first execution. */
import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { commandFingerprint, parseAdoptionReview } from './adoption.mjs'
import { durableEvidence, evidenceBinding } from './evidence.mjs'
import { referenceAliases } from './references.mjs'

export const AUTOMATIC_EXPERIMENT_REASON = 'Generated experiment v1: '

const hash = value => createHash('sha256').update(value).digest('hex')
const text = content => (content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const parse = value => {
  if (object(value)) return value
  try { const result = JSON.parse(value); return object(result) ? result : undefined }
  catch (_error) { return undefined /* Only structured tool arguments and results establish candidates. */ }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const stable = value => JSON.stringify(canonical(value))
const pathOf = (value, cwd) => {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) return undefined
  const windows = /^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:[\\/]/.test(cwd ?? '')
  const paths = windows ? win32 : posix
  if (!paths.isAbsolute(value) && !cwd) return undefined
  const resolved = paths.resolve(cwd ?? '/', value).replaceAll('\\', '/')
  return { path: resolved, key: windows ? resolved.toLowerCase() : resolved }
}

/** Tokenize a single direct invocation; substitutions and shell control flow remain uncovered. */
function tokensOf(line) {
  const tokens = []
  let offset = 0
  while (offset < line.length) {
    if (/\s/.test(line[offset])) { offset++; continue }
    const quote = ['"', "'"].includes(line[offset]) ? line[offset++] : undefined
    let value = ''
    if (quote) {
      while (offset < line.length && line[offset] !== quote) value += line[offset++]
      if (offset === line.length) return undefined
      offset++
      if (offset < line.length && !/\s/.test(line[offset])) return undefined
    } else {
      while (offset < line.length && !/\s/.test(line[offset])) value += line[offset++]
    }
    if (value.includes('`') || value.includes('$(') || /[;|<>]/.test(value) && value !== '2>&1') return undefined
    tokens.push({ value, quote })
  }
  return tokens
}

/** Recognize direct interpreter/script commands, including literal PowerShell variable prefixes.
 * @param operation Exact shell tool name and JSON arguments; no command is executed.
 * @param cwd Absolute working directory used for relative script paths.
 * @returns A resolved invocation, a non-script command, or an explicit unsupported syntax report.
 */
export function identifyScriptExecution(operation, cwd) {
  const command = operation.arguments?.command
  if (typeof command !== 'string' || !command.trim()) return { status: 'not-script', reason: 'no-command' }
  const lines = command.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const variables = new Map()
  while (lines.length > 1 && operation.name === 'pwsh') {
    const assignment = /^\$([A-Za-z_]\w*)\s*=\s*(['"])([^'"`$]*)\2$/.exec(lines[0])
    if (!assignment) break
    variables.set(assignment[1].toLowerCase(), assignment[3])
    lines.shift()
  }
  if (lines.length !== 1) return { status: 'uncovered', reason: 'compound-command' }
  const tokens = tokensOf(lines[0])
  if (!tokens?.length) return { status: 'uncovered', reason: 'unsupported-shell-syntax' }
  for (const token of tokens) {
    if (token.quote !== "'" && token.value.includes('$')) {
      if (operation.name !== 'pwsh') return { status: 'uncovered', reason: 'shell-expansion' }
      let unresolved = false
      token.value = token.value.replace(/\$([A-Za-z_]\w*)/g, (_match, key) => {
        const replacement = variables.get(key.toLowerCase())
        if (replacement === undefined) unresolved = true
        return replacement ?? ''
      })
      if (unresolved || token.value.includes('$')) return { status: 'uncovered', reason: 'nonliteral-variable' }
    }
  }
  if (tokens.at(-1).value === '2>&1') tokens.pop()
  if (tokens.some(token => token.value === '2>&1')) return { status: 'uncovered', reason: 'nonterminal-redirection' }
  if (operation.name === 'pwsh' && tokens[0]?.value === '&') tokens.shift()
  if (!tokens.length || tokens.some(token => token.value.includes('&'))) return { status: 'uncovered', reason: 'shell-operator' }
  const executable = tokens.shift().value
  const name = executable.replaceAll('\\', '/').split('/').at(-1).toLowerCase().replace(/\.exe$/, '')
  let script
  if (/^(?:python(?:\d+(?:\.\d+)*)?|py)$/.test(name)) {
    while (tokens.length && /^(?:-u|-B|-I|-3(?:\.\d+)?)$/.test(tokens[0].value)) tokens.shift()
    if (tokens[0]?.value.startsWith('-')) return { status: 'uncovered', reason: 'interpreter-inline-or-option' }
    script = tokens.shift()?.value
  } else if (name === 'node') {
    while (tokens.length && ['--no-warnings', '--enable-source-maps'].includes(tokens[0].value)) tokens.shift()
    if (tokens[0]?.value.startsWith('-')) return { status: 'uncovered', reason: 'interpreter-inline-or-option' }
    script = tokens.shift()?.value
  } else if (['pwsh', 'powershell'].includes(name)) {
    while (tokens.length && ['-noprofile', '-noninteractive', '-nologo'].includes(tokens[0].value.toLowerCase())) tokens.shift()
    if (tokens.shift()?.value.toLowerCase() !== '-file') return { status: 'uncovered', reason: 'powershell-requires-file' }
    script = tokens.shift()?.value
  } else if (['bash', 'sh'].includes(name)) {
    if (tokens[0]?.value === '--') tokens.shift()
    if (tokens[0]?.value.startsWith('-')) return { status: 'uncovered', reason: 'shell-interpreter-option' }
    script = tokens.shift()?.value
  } else if (operation.name === 'pwsh' && /\.ps1$/i.test(executable)) script = executable
  else return { status: 'not-script', reason: 'not-a-direct-script-invocation' }
  const resolved = pathOf(script, operation.arguments.cwd ?? cwd)
  if (!resolved) return { status: 'uncovered', reason: 'unresolved-script-path' }
  return { status: 'identified', ...resolved, interpreter: name, arguments: tokens.map(token => token.value),
    coverage: 'Direct interpreter/file invocation only; aliases, pipelines, inline code, and general shell programs are not interpreted.' }
}

function userBoundary(events, state) {
  const sinceSeq = Math.max(state.sinceSeq, ...events.filter(event => event.type === 'user/message'
    && event.data.source.kind === 'user').map(event => event.seq))
  const pendingSteering = events.some(event => event.seq > sinceSeq && event.type === 'agent/inbox/spliced'
    && event.data.inserted.some(message => message.source.kind === 'user'))
  return { sinceSeq, pendingSteering }
}

function scriptsAndExecutions(events, boundary, options, sourcePairs, initialCwd) {
  const scripts = new Map(), pending = new Map(), executions = []
  const wantedExtension = path => options.scriptExtensions.includes(posix.extname(path).toLowerCase())
  let cwd = initialCwd
  for (const event of events) {
    if (event.type === 'working-directory/change') cwd = event.data.cwd
    if (event.seq <= boundary) continue
    if (event.type === 'tool/call') {
      const args = parse(event.data.arguments)
      if (!args) continue
      pending.set(event.data.callId, { event, args, cwd })
      if (options.executionTools.includes(event.data.name)) {
        const invocation = identifyScriptExecution({ name: event.data.name, arguments: args }, cwd)
        const script = invocation.status === 'identified' ? scripts.get(invocation.key) : undefined
        if (script?.code !== undefined) executions.push({ callId: event.data.callId, script,
          toolFingerprint: commandFingerprint(event.data.name, args), sources: selectSources(sourcePairs, event.seq, options) })
      }
      continue
    }
    if (event.type !== 'tool/result') continue
    const call = pending.get(event.data.message.toolCallId)
    if (!call || !['write', 'edit'].includes(call.event.data.name)) continue
    const path = pathOf(call.args.file_path ?? call.args.path, call.cwd)
    if (!path || !wantedExtension(path.path)) continue
    if (event.data.message.isError || /^Error:/i.test(text(event.data.message.content))) continue
    const version = { ...path, callId: call.event.data.callId, callSeq: call.event.seq, resultSeq: event.seq }
    if (call.event.data.name === 'write' && typeof call.args.content === 'string') {
      scripts.set(path.key, { ...version, code: call.args.content, codeSha256: hash(call.args.content) })
      continue
    }
    const previous = scripts.get(path.key)
    const { old_string: before, new_string: after, replace_all: all } = call.args
    if (call.event.data.name !== 'edit' || previous?.code === undefined || typeof before !== 'string'
      || !before || typeof after !== 'string') {
      scripts.set(path.key, { ...version, issue: 'complete-script-not-reconstructable' })
      continue
    }
    const occurrences = previous.code.split(before).length - 1
    if (occurrences === 0 || !all && occurrences !== 1) {
      scripts.set(path.key, { ...version, issue: 'logged-edit-does-not-match-script' })
      continue
    }
    const code = all ? previous.code.replaceAll(before, after) : previous.code.replace(before, after)
    scripts.set(path.key, { ...version, code, codeSha256: hash(code) })
  }
  return { scripts, executions }
}

const selectSources = (pairs, beforeSeq, options) => pairs.filter(pair => pair.resultSeq < beforeSeq).slice(-options.maxSourcePairs)
const basis = (script, operationFingerprint, sources, userSeq, schemaKey) => hash(stable({ userSeq,
  path: script.key, codeSha256: script.codeSha256, toolFingerprint: operationFingerprint, schemaKey,
  inputs: sources.map(pair => [pair.name, pair.arguments.sha256, pair.result.sha256]) }))

function experimentInputs(session, state, options, operation, events) {
  if (!options.executionTools.includes(operation.name)) return { status: 'no-candidate', reason: 'not-an-execution-tool' }
  const boundary = userBoundary(events, state)
  const invocation = identifyScriptExecution(operation, options.cwd)
  if (invocation.status === 'uncovered') return invocation
  if (invocation.status !== 'identified') return { status: 'no-candidate', reason: invocation.reason }
  const allPairs = durableEvidence(session, { sinceSeq: boundary.sinceSeq }, options)
  const sourcePairs = allPairs.filter(pair => {
    if (!options.sourceTools.includes(pair.name) || pair.isError || pair.recordedPartial || pair.nonTextBlocks) return false
    const output = parse(pair.result.text)
    return typeof output?.evidenceId === 'string' && output.evidenceId.length > 0 && options.sourceOperations.includes(output.operation)
      && output.incomplete === false && Array.isArray(output.items) && output.items.length > 0
  }).sort((left, right) => left.resultSeq - right.resultSeq)
  const history = scriptsAndExecutions(events, boundary.sinceSeq, options, sourcePairs,
    session.header?.cwd ?? events.find(event => event.type === 'session')?.cwd ?? options.cwd)
  const script = history.scripts.get(invocation.key)
  if (!script) return { status: 'no-candidate', reason: 'no-current-request-script-write' }
  if (!sourcePairs.some(pair => pair.resultSeq < script.callSeq))
    return { status: 'no-candidate', reason: 'no-prior-complete-adapter-observation' }
  return { status: 'identified', boundary, allPairs, sourcePairs, history, script }
}

/** Identify operations owned by this review even when cancellation prevents a review packet.
 * @param session Durable Session accessor.
 * @param state Current human-request boundary.
 * @param options The same explicit source and script settings used for candidate construction.
 * @param operation Exact upcoming operation, including its current working directory.
 * @returns Owned script identity or not-owned; this result never authorizes execution or review.
 */
export function automaticExperimentOwnership(session, state, options, operation) {
  const input = experimentInputs(session, state, options, operation, session.snapshotEvents())
  if (input.status !== 'identified') return { status: 'not-owned', reason: input.reason }
  return { status: 'owned', userSeq: input.boundary.sinceSeq, scriptPath: input.script.path,
    scriptCallSeq: input.script.callSeq, scriptResultSeq: input.script.resultSeq,
    ...input.script.codeSha256 === undefined ? {} : { scriptCodeSha256: input.script.codeSha256 } }
}

/** Construct a complete candidate without executing, trimming, or authorizing its proposed operation.
 * @param session Durable Session accessor; only public tool arguments and results are included.
 * @param state Current human-request boundary.
 * @param options Explicit cwd, scriptExtensions, executionTools, sourceTools, sourceOperations, maxSourcePairs, maxRequestBytes, checkTools, and excludedTools.
 * @param operation Exact upcoming tool name, arguments, and optional callId/signal.
 * @param checkToolSchemas Schemas available to the reviewer for an independent check.
 * @returns A ready packet, no-candidate, uncovered syntax/version, or an unreviewed oversized packet.
 */
export function automaticExperimentPacket(session, state, options, operation, checkToolSchemas = []) {
  const events = session.snapshotEvents(), boundary = userBoundary(events, state)
  if (operation.signal?.aborted || boundary.pendingSteering) return { status: 'no-candidate', reason: 'cancelled-or-pending-user' }
  const input = experimentInputs(session, state, options, operation, events)
  if (input.status !== 'identified') return input
  const { allPairs, sourcePairs, history, script } = input
  if (script.code === undefined) return { status: 'uncovered', reason: script.issue, scriptPath: script.path }
  const sources = sourcePairs.slice(-options.maxSourcePairs)
  const toolFingerprint = commandFingerprint(operation.name, operation.arguments)
  const checkToolSchemaKey = hash(stable(checkToolSchemas))
  const basisKey = basis(script, toolFingerprint, sources, boundary.sinceSeq, checkToolSchemaKey)
  const previousExecution = history.executions.find(item => item.callId !== operation.callId
    && basis(item.script, item.toolFingerprint, item.sources, boundary.sinceSeq, checkToolSchemaKey) === basisKey
    && allPairs.some(pair => pair.callId === item.callId && pair.execution?.status === 'completed'
      && !pair.isError && !pair.recordedPartial && !pair.nonTextBlocks))
  if (previousExecution) return { status: 'no-candidate', reason: 'version-already-executed',
    basisKey, executionCallId: previousExecution.callId, scientificallyVerified: false }
  const subsequentCheck = allPairs.filter(pair => pair.resultSeq > script.resultSeq && pair.callId !== operation.callId
    && options.checkTools.includes(pair.name) && pair.execution?.status === 'completed'
    && !pair.isError && !pair.recordedPartial && !pair.nonTextBlocks
    && commandFingerprint(pair.name, parse(pair.arguments.text)) !== toolFingerprint)
    .sort((left, right) => left.resultSeq - right.resultSeq).at(-1)
  const selected = subsequentCheck ? [...sources, subsequentCheck] : sources
  const observations = selected.map(pair => ({ ...evidenceBinding(session, pair, options),
    arguments: pair.arguments.text, output: pair.result.text }))
  const refs = selected.map(pair => pair.callId)
  const aliases = referenceAliases(selected)
  const plannedRefs = operation.callId ? [operation.callId, 'operation:' + operation.callId] : []
  const subsequentEvidence = subsequentCheck ? { resultSeq: subsequentCheck.resultSeq,
    argumentsSha256: subsequentCheck.arguments.sha256, resultSha256: subsequentCheck.result.sha256,
    contentSha256: subsequentCheck.contentSha256 } : null
  const reason = AUTOMATIC_EXPERIMENT_REASON + hash(stable({ basisKey, subsequentEvidence }))
  const context = JSON.stringify({ kind: 'automatic-experiment', version: 1, basisKey,
    userSeq: boundary.sinceSeq, decisionSeq: script.resultSeq, toolFingerprint, checkToolSchemaKey,
    subsequentEvidence,
    script: { path: script.path, code: script.code, codeSha256: script.codeSha256,
      callId: script.callId, callSeq: script.callSeq, resultSeq: script.resultSeq,
      coverage: 'Successful logged write/edit reconstruction; unlogged or external filesystem changes are not detected.' },
    sourceSelection: { strategy: 'nearest-complete-adapter-results-before-execution', maximumPairs: options.maxSourcePairs,
      priorObservationRequiredBeforeScriptVersion: true, omittedEarlierPairs: sourcePairs.length - sources.length,
      relevance: 'Temporal selection is not proof of semantic relevance; report missing context instead of assuming it.' },
    observations, proposedOperation: { status: 'planned', name: operation.name, arguments: operation.arguments,
      ...operation.callId ? { callId: operation.callId } : {} },
    allowedCheckTools: options.checkTools, allowedCheckToolSchemas: checkToolSchemas,
    refs, referenceAliases: aliases, plannedRefs })
  const requestBytes = Buffer.byteLength(context)
  const packet = { basisKey, userSeq: boundary.sinceSeq, decisionSeq: script.resultSeq, toolFingerprint,
    checkToolSchemaKey, refs, rawUsableRefs: refs, referenceAliases: aliases, plannedRefs,
    scriptPath: script.path, scriptCodeSha256: script.codeSha256, requestBytes,
    reason }
  if (requestBytes > options.maxRequestBytes) return { ...packet, status: 'unreviewed', issue: 'packet-over-budget',
    maxRequestBytes: options.maxRequestBytes, sourceResultSeqs: sources.map(pair => pair.resultSeq),
    message: '完整脚本和原始观察超过自动实验复核预算；未裁剪后认证，也未声称已复核。' }
  return { ...packet, status: 'ready', context }
}

function settledExperimentReviews(session, packet, options) {
  const events = session.snapshotEvents()
  const boundary = userBoundary(events, { sinceSeq: packet.userSeq })
  if (boundary.sinceSeq !== packet.userSeq || boundary.pendingSteering) return []
  const starts = new Map()
  const reviews = []
  for (const event of events) {
    if (event.seq <= packet.userSeq) continue
    const id = event.data?.consultationId ?? event.data?.callId
    if (event.type === 'helper/auto-start' && event.data.question?.reason?.startsWith(AUTOMATIC_EXPERIMENT_REASON)) {
      const context = parse(event.data.question.context)
      if (context?.kind === 'automatic-experiment' && context.basisKey === packet.basisKey && context.userSeq === packet.userSeq)
        starts.set(id, { ...context, reason: event.data.question.reason })
    }
    if (event.type !== 'helper/auto-end' || !starts.has(id)) continue
    const original = starts.get(id)
    const reviewPacket = { ...original, status: 'ready', rawUsableRefs: original.refs }
    const review = event.data.status === 'completed' ? parseAdoptionReview(event.data.answer, reviewPacket, options)
      : { status: 'unreviewed', message: '自动实验复核未正常交付；未将结束或取消当作通过。' }
    reviews.push({ reason: original.reason, reviewSeq: event.seq, status: event.data.status, review })
  }
  return reviews
}

const acceptedReview = review => review.status === 'reviewed' && ['observe', 'supported'].includes(review.decision)
const settledResult = ({ reviewSeq, status, review }) => ({ reviewSeq, status, review })

/** Retrieve the latest finished review for this exact code, inputs, command, and human request.
 * @param session Durable Session accessor.
 * @param packet Current candidate identity.
 * @param options Allowed independent check tools.
 * @returns A settled attempt with a parsed review, including explicit unreviewed failures, or undefined.
 */
export function automaticExperimentReviewFromSession(session, packet, options) {
  const latest = settledExperimentReviews(session, packet, options)
    .findLast(item => acceptedReview(item.review) || item.reason === packet.reason)
  return latest === undefined ? undefined : settledResult(latest)
}

/** Preserve a concrete unresolved concern when a newer check or unavailable review changes packet coverage.
 * @param session Durable Session accessor.
 * @param packet Current code, original-input, command, and human-request identity.
 * @param options Allowed independent check tools used when validating recorded reviews.
 * @returns The latest valid adverse review until a later complete observe/supported review clears it; unknown or failed reviews never create or clear concerns.
 */
export function automaticExperimentConcernFromSession(session, packet, options) {
  let concern
  for (const item of settledExperimentReviews(session, packet, options)) {
    if (acceptedReview(item.review)) concern = undefined
    else if (item.review.status === 'proposal-only' || item.review.status === 'reviewed'
      && ['check-required', 'insufficient-evidence'].includes(item.review.decision)) concern = settledResult(item)
  }
  return concern
}

/** Recognize an advisor's exact independent check without recursively reviewing that check.
 * @param session Durable Session accessor.
 * @param state Current human-request boundary.
 * @param options Allowed independent check tools.
 * @param operation Exact operation being considered; its normal permissions and other registrations still apply.
 * @returns Whether a valid current-request review proposed this exact operation.
 */
export function automaticExperimentCheckFromSession(session, state, options, operation) {
  const events = session.snapshotEvents(), boundary = userBoundary(events, state)
  if (boundary.pendingSteering || operation.signal?.aborted) return false
  const fingerprint = commandFingerprint(operation.name, operation.arguments)
  const starts = new Map()
  for (const event of events) {
    if (event.seq <= boundary.sinceSeq) continue
    const id = event.data?.consultationId ?? event.data?.callId
    if (event.type === 'helper/auto-start' && event.data.question?.reason?.startsWith(AUTOMATIC_EXPERIMENT_REASON)) {
      const context = parse(event.data.question.context)
      if (context?.kind === 'automatic-experiment' && context.userSeq === boundary.sinceSeq) starts.set(id, { context, seq: event.seq })
    }
    if (event.type !== 'helper/auto-end' || event.data.status !== 'completed' || !starts.has(id)) continue
    const { context, seq: reviewStartSeq } = starts.get(id)
    const review = parseAdoptionReview(event.data.answer, { ...context, status: 'ready', rawUsableRefs: context.refs }, options)
    if (['reviewed', 'proposal-only'].includes(review.status) && review.check
      && commandFingerprint(review.check.name, review.check.arguments) === fingerprint) {
      const invocation = identifyScriptExecution(operation, options.cwd)
      if (invocation.status !== 'identified') return true
      const initialCwd = session.header?.cwd ?? events.find(event => event.type === 'session')?.cwd ?? options.cwd
      const earlier = scriptsAndExecutions(events.filter(item => item.seq < reviewStartSeq), boundary.sinceSeq, options, [], initialCwd)
      const current = scriptsAndExecutions(events, boundary.sinceSeq, options, [], initialCwd)
      const before = earlier.scripts.get(invocation.key), after = current.scripts.get(invocation.key)
      if (before?.codeSha256 !== undefined && before.codeSha256 === after?.codeSha256) return true
    }
  }
  return false
}
