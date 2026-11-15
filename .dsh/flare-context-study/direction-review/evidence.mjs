/** Resolve recorded evidence independently of the bounded projection cache. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { hasSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'
import { bindWorkbenchReferences, pairReferences, resolveEvidenceReference } from './references.mjs'
export { pairReferences, resolveEvidenceReference } from './references.mjs'

export const defaultExcluded = ['write', 'edit', 'apply_patch', 'remember', 'advisor', 'premise_check', 'security_checkpoint', 'security_command', 'security_scope', 'security_complete']
export const RECEIPT_SUMMARY = 'Premise execution receipt'
export const executionSchema = z.object({ status: z.enum(['completed', 'unavailable']), issues: z.array(z.string()),
  exitCode: z.number().int().nullable().optional(), signal: z.string().nullable().optional(),
  timedOut: z.boolean().optional(), aborted: z.boolean().optional(), stdoutTruncated: z.boolean().optional(),
  stderrTruncated: z.boolean().optional() })
export const receiptSchema = z.object({ kind: z.literal('premise-execution'), version: z.literal(1),
  callId: z.string(), toolName: z.string(), contentSha256: z.string(), execution: executionSchema,
  locator: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), locatorTruncated: z.boolean().optional() }).strict()
const text = content => content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const hash = value => createHash('sha256').update(value).digest('hex')
const field = value => ({ chars: value.length, sha256: hash(value), truncated: false, text: value })

/** Read current-request calls and results; explicit references survive cache eviction and display cropping. */
export function durableEvidence(session, state, config, refs, view) {
  const excluded = new Set([...defaultExcluded, ...config.excludedTools])
  const wanted = refs === undefined ? undefined : new Set(refs)
  const requestedCalls = wanted === undefined ? undefined : new Set([...wanted,
    ...view?.records.filter(record => record.kind === 'evidence' && wanted.has(record.value.id)
      && record.value.source?.sessionId === session.id && record.value.source.channel !== 'operator')
      .map(record => record.value.source.callId) ?? []])
  const calls = new Map()
  const receipts = new Map()
  for (const event of session.snapshotEvents()) {
    if (event.seq <= state.sinceSeq) continue
    if (event.type === 'tool/call' && !excluded.has(event.data.name)) calls.set(event.data.callId, {
      callId: event.data.callId, callSeq: event.seq, callTime: event.time, name: event.data.name,
      rawArguments: event.data.arguments,
    })
    if (event.type === 'tool/result') {
      const pair = calls.get(event.data.message.toolCallId)
      if (!pair || requestedCalls && !requestedCalls.has(pair.callId) && !wanted.has('r' + event.seq)) continue
      const content = event.data.message.content
      pair.resultSeq = event.seq
      pair.resultTime = event.time
      pair.result = field(text(content))
      pair.arguments = field(pair.rawArguments)
      pair.contentSha256 = hash(JSON.stringify(content))
      pair.nonTextBlocks = content.filter(block => block.type !== 'text').length
      pair.isError = event.data.message.isError === true
      pair.recordedPartial = hasSpillNotice(pair.result.text)
    }
    if (event.type !== 'user/message' || event.data.source.kind !== 'helper-checkpoint'
      || event.data.source.summary !== RECEIPT_SUMMARY) continue
    let payload
    try { payload = JSON.parse(text(event.data.content)) }
    catch (_error) { continue /* Ordinary helper notices do not establish execution facts. */ }
    const receipt = receiptSchema.safeParse(payload)
    if (receipt.success) receipts.set(receipt.data.callId, receipt.data)
  }
  const pairs = []
  for (const pair of calls.values()) {
    if (pair.result === undefined) continue
    const receipt = receipts.get(pair.callId)
    if (receipt && receipt.toolName === pair.name) pair.execution = receipt.contentSha256 === pair.contentSha256
      ? receipt.execution : { status: 'unavailable', issues: ['result-changed-after-receipt'] }
    delete pair.rawArguments
    pairs.push(pair)
  }
  const bound = bindWorkbenchReferences(pairs, session.id, view)
  if (wanted === undefined) return bound
  const selected = new Set([...wanted].flatMap(ref => {
    const resolved = resolveEvidenceReference(bound, ref)
    return resolved.status === 'resolved' ? [resolved.pair.callId] : []
  }))
  return bound.filter(pair => selected.has(pair.callId))
}

/** Request the workbench view only when a reference is not already a completed call or result sequence. */
export function needsEvidenceView(session, state, config, refs) {
  const pairs = durableEvidence(session, state, config, refs)
  return refs.some(ref => resolveEvidenceReference(pairs, ref).status !== 'resolved')
}

/** Identify recorded source, execution availability and display coverage without certifying its interpretation. */
export function evidenceBinding(session, pair, config) {
  return { sessionId: session.id, ref: 'r' + pair.resultSeq, callId: pair.callId, toolName: pair.name,
    callSeq: pair.callSeq, resultSeq: pair.resultSeq, callTime: pair.callTime, resultTime: pair.resultTime,
    argumentsSha256: pair.arguments.sha256, resultSha256: pair.result.sha256, contentSha256: pair.contentSha256,
    resultChars: pair.result.chars, isError: pair.isError, recordedPartial: pair.recordedPartial,
    ...pair.evidenceIds?.length ? { evidenceIds: pair.evidenceIds } : {},
    nonTextBlocks: pair.nonTextBlocks, checkEligible: config.checkTools.includes(pair.name),
    ...config.checkTools.includes(pair.name) ? { execution: pair.execution ?? { status: 'unavailable', issues: ['execution-receipt-missing'] } } : {} }
}

const inspectSchema = z.object({ action: z.literal('inspect'), beforeSeq: z.number().int().nonnegative().optional(),
  refs: z.array(z.string().min(1)).min(1).optional() }).strict()

/** Return bounded metadata pages; original output remains in its existing tool result. */
export function inspectEvidence(session, state, config, args, view) {
  const parsed = inspectSchema.safeParse(args)
  if (!parsed.success) return { status: 'check-required', message: 'inspect 接受可选 beforeSeq（上一页 nextBeforeSeq）或 refs，不返回重复的原始正文。' }
  const input = parsed.data
  const excluded = new Set([...defaultExcluded, ...config.excludedTools])
  const calls = new Set()
  const results = new Map()
  for (const event of session.snapshotEvents()) {
    if (event.seq <= state.sinceSeq) continue
    if (event.type === 'tool/call' && !excluded.has(event.data.name)) calls.add(event.data.callId)
    if (event.type === 'tool/result' && calls.has(event.data.message.toolCallId))
      results.set(event.data.message.toolCallId, { callId: event.data.message.toolCallId, resultSeq: event.seq })
  }
  const all = bindWorkbenchReferences([...results.values()], session.id, view)
  const candidates = all.filter(pair => (input.beforeSeq === undefined || pair.resultSeq < input.beforeSeq)
    && (input.refs === undefined || input.refs.some(ref => resolveEvidenceReference(all, ref).pair === pair)))
    .sort((left, right) => right.resultSeq - left.resultSeq)
  const pairs = bindWorkbenchReferences(durableEvidence(session, state, config,
    candidates.slice(0, config.maxEvidencePairs).map(pair => pair.callId)), session.id, view)
    .sort((left, right) => right.resultSeq - left.resultSeq)
  const evidence = []
  let consumed = 0
  for (const pair of pairs) {
    if (evidence.length >= config.maxEvidencePairs) break
    const binding = evidenceBinding(session, pair, config)
    const bytes = Buffer.byteLength(JSON.stringify(binding))
    if (consumed + bytes > config.maxRequestBytes / 2) break
    evidence.push(binding)
    consumed += bytes
  }
  if (candidates.length && !evidence.length) return { status: 'check-required', message: '所选证据元数据无法在 inspect 预算内返回，或引用不唯一；使用明确的原始调用并核对来源绑定。' }
  return { status: 'evidence', evidence, total: candidates.length,
    ...evidence.length < candidates.length ? { nextBeforeSeq: evidence.at(-1).resultSeq } : {},
    ...(input.refs ? { unresolvedRefs: input.refs.filter(key => !candidates.some(pair => pairReferences(pair).includes(key))),
      referenceBindings: input.refs.map(ref => resolveEvidenceReference(all, ref)).map(result => result.status === 'resolved'
        ? result.binding : { inputRef: result.inputRef, issue: result.issue }) } : {}),
    message: '仅列出原始调用的元数据，不重复正文。已完成 callId、r<resultSeq> 与工作台来源绑定的 evidenceId 归一到同一调用；保存记录不代表重新执行或验证解释。' }
}
