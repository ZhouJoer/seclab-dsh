/** Evidence-qualified checkpoint preparation and exact-argument admission. */
import { z } from 'zod'
import { hasExactOutputQuote } from './output-quote.mjs'
import { durableEvidence, evidenceBinding, resolveEvidenceReference } from './evidence.mjs'
import { dependentOperationSchema, pairedOperation } from './operation.mjs'

const short = z.string().trim().min(1)
const ids = z.array(short).max(20).default([])
const fields = {
  phase: z.enum(['recon', 'surface', 'assessment', 'validation']), title: short.max(100),
  summary: z.string().max(300), reason: z.string().max(300), next: z.string().max(300),
  evidenceIds: ids, findingIds: ids,
}
const checkpointSchema = z.object(fields).strict()
const prepareSchema = z.object({ action: z.enum(['prepare', 'save']), phase: fields.phase, title: short,
  observations: z.array(z.object({ ref: short, description: short.optional(), quote: short.optional() }).strict()),
  interpretation: short, assessmentRef: short.optional(),
  nextCheck: short, ifA: short.optional(), ifB: short.optional(),
  pendingDecision: short.optional(), dependentOperation: dependentOperationSchema.optional(),
  evidenceIds: ids, findingIds: ids,
}).strict().superRefine(pairedOperation)
const text = content => content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const failure = (message, details = {}) => ({ status: 'check-required', ...details, message })
const epoch = state => Math.max(state.sinceSeq, ...state.evidence.map(pair => pair.resultSeq ?? pair.callSeq))

/** Read only results produced by this tool after the current user request. */
function results(session, sinceSeq) {
  const calls = new Set()
  const records = []
  for (const event of session.snapshotEvents()) {
    if (event.seq <= sinceSeq) continue
    if (event.type === 'tool/call' && event.data.name === 'premise_check') calls.add(event.data.callId)
    if (event.type !== 'tool/result' || !calls.has(event.data.message.toolCallId) || event.data.message.isError) continue
    let value
    try { value = JSON.parse(text(event.data.message.content)) }
    catch (_error) { continue /* Non-JSON results cannot authorize a saved interpretation. */ }
    if (value !== null && typeof value === 'object') records.push({ ref: 'r' + event.seq, callId: event.data.message.toolCallId, value })
  }
  return records
}

/** Expose completed assessment references for later checkpoint preparation. */
export function assessmentReferences(session, sinceSeq) {
  return results(session, sinceSeq).filter(item => ['supported', 'contradicted', 'advice'].includes(item.value.status))
    .map(item => ({ ref: item.ref, callId: item.callId, assessment: item.value.assessment }))
}

/** Prepare bounded analyst notes with host-bound source references; saving remains the caller's operation. */
export function prepareCheckpoint(args, session, state, config, assessSubmission, _issues, view) {
  const parsed = prepareSchema.safeParse(args)
  if (!parsed.success) {
    const input = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {}
    const unexpectedFields = parsed.error.issues.flatMap(issue => issue.code === 'unrecognized_keys' ? issue.keys : [])
    const missingFields = parsed.error.issues.filter(issue => issue.path.length === 1 && input[issue.path[0]] === undefined)
      .map(issue => String(issue.path[0]))
    const fieldHints = {}
    if (unexpectedFields.includes('claim')) fieldHints.claim = input.interpretation === undefined
      ? 'save 使用 interpretation 记录解释；claim 仅用于 submit。' : '保留已有 interpretation，删除 submit 专用的 claim。'
    if (unexpectedFields.includes('evidenceRefs')) fieldHints.evidenceRefs = input.observations === undefined
      ? 'save 使用 observations:[{ref}] 绑定已有来源；evidenceRefs 仅用于 submit，无需重读原始数据。'
      : '保留已有 observations，删除 submit 专用的 evidenceRefs。'
    if (parsed.error.issues.some(issue => ['pendingDecision', 'dependentOperation'].includes(String(issue.path[0]))))
      fieldHints.adoption = '普通观察、检查或结果记录同时省略 pendingDecision 和 dependentOperation；后续排除候选或依赖结论的昂贵操作才填写二者。'
    return failure('仅修正 missingFields、unexpectedFields 和 issues；保留其它字段及原始引用，无需重新 inspect 或复制正文。',
      { missingFields: [...new Set(missingFields)], unexpectedFields, fieldHints,
        issues: parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) })
  }
  const input = parsed.data
  if (input.dependentOperation && !config.adoptionTools?.includes(input.dependentOperation.name)) return failure('dependentOperation.name 必须是 adoptionTools 中受采用复核的执行工具。',
    { operationName: input.dependentOperation.name, allowedTools: config.adoptionTools ?? [] })
  const requestBytes = Buffer.byteLength(JSON.stringify(input))
  if (requestBytes > config.maxRequestBytes) return failure('保存请求超出字节预算；保留所有原始引用，缩短 description、interpretation 或 nextCheck。原始结果无需复制，quote 可省略。',
    { requestBytes, maxRequestBytes: config.maxRequestBytes })
  if ((input.ifA === undefined) !== (input.ifB === undefined) || input.ifA !== undefined && input.ifA === input.ifB)
    return failure('提出区分性实验时必须同时提供两种不同预期；没有未决问题时省略 ifA/ifB，nextCheck 写明后续交接、阻碍或无需继续检查。')
  const evidence = durableEvidence(session, { ...state, sinceSeq: -1 }, config, undefined, view)
  const resolutions = input.observations.map(item => resolveEvidenceReference(evidence, item.ref))
  const observationPairs = resolutions.map(resolution => resolution.pair)
  const unresolvedRefs = input.observations.filter((_item, i) => !observationPairs[i]).map(item => item.ref)
  const resolvedRefs = resolutions.filter(resolution => resolution.status === 'resolved').map(resolution => resolution.binding)
  if (unresolvedRefs.length) return failure('仅修正 unresolvedRefs：使用同一观察已完成的 callId、r<resultSeq> 或工作台来源绑定的 evidenceId，不要改为内容无关的调用。resolvedRefs 保留输入引用与原始调用的对应关系，无需重读或复制正文；未执行建议不能绑定为已完成观察。',
    { unresolvedRefs, resolvedRefs, referenceIssues: resolutions.filter(resolution => resolution.status !== 'resolved') })
  const invalidQuoteRefs = input.observations.filter((item, i) => item.quote !== undefined && !hasExactOutputQuote(observationPairs[i].result.text, item.quote)).map(item => item.ref)
  if (invalidQuoteRefs.length) return failure('仅修正 invalidQuoteRefs 的 quote：原文必须逐字存在于引用结果或 JSON 解码字符串；转述改用 description 并省略 quote。保留对应原始引用和其余观察。',
    { invalidQuoteRefs, resolvedRefs })
  let assessment
  if (input.assessmentRef) {
    const record = results(session, state.sinceSeq).find(item => item.ref === input.assessmentRef || item.callId === input.assessmentRef)
    if (!record || !['supported', 'contradicted', 'advice'].includes(record.value.status)) return failure('assessmentRef 必须引用本轮已完成的 submit 结果；未执行检查或咨询失败不算完成。')
    const checked = assessSubmission(record.value.assessment, state, config, session, view)
    if (checked.status !== 'ready') return failure('检查引用已失效或不完整，请重新检查；也可省略 assessmentRef 保存明确未验证的交接。')
    assessment = checked.submission
  }
  const bindings = observationPairs.map((pair, i) => ({ ...evidenceBinding(session, pair, config),
    inputRef: input.observations[i].ref,
    currentRequest: pair.callSeq > state.sinceSeq,
    observationKind: input.observations[i].quote === undefined ? 'analyst-description' : 'partial-quote' }))
  const summary = input.observations.length
    ? '来源绑定（非结论）：' + input.observations.map((item, i) => {
      const pair = observationPairs[i]
      const qualified = pair.isError ? '工具失败；' : pair.recordedPartial || pair.nonTextBlocks ? '记录不完整；'
        : config.checkTools.includes(pair.name) && pair.execution?.status !== 'completed' ? '执行不可用；' : ''
      return qualified + (item.quote === undefined ? '分析者描述 ' : '局部原文摘录 ') + 'r' + pair.resultSeq + ' '
        + (item.quote ?? item.description ?? '引用已绑定，未提供解释') + (item.quote && item.description ? '；分析者描述：' + item.description : '')
    }).join(' | ')
    : '未引用完整原始观察；本记录仅为待验证交接。'
  const reason = assessment
    ? '模型检查判断（非独立认证）' + assessment.outcome + '：' + assessment.claim + '；范围：' + assessment.scope
    : 'UNVERIFIED 待验证解释：' + input.interpretation
  const draft = { phase: input.phase, title: input.title, summary, reason,
    next: input.ifA === undefined ? '后续/阻碍（非区分性实验）：' + input.nextCheck
      : input.nextCheck + '；A→' + input.ifA + '；B→' + input.ifB, evidenceIds: input.evidenceIds, findingIds: input.findingIds }
  const shortenedFields = []
  for (const [key, limit] of [['title', 100], ['summary', 300], ['reason', 300], ['next', 300]]) {
    if (draft[key].length <= limit) continue
    const marker = '…（有省略；完整内容见本次工具调用）'
    draft[key] = draft[key].slice(0, limit - marker.length) + marker
    shortenedFields.push(key)
  }
  const checkpoint = checkpointSchema.parse(draft)
  return { status: 'prepared', scientificallyVerified: false, checkpoint, bindings, shortenedFields,
    adoption: input.dependentOperation ? { status: 'prepared', pendingDecision: input.pendingDecision,
      dependentOperation: input.dependentOperation } : { status: 'handoff-only' },
    userSeq: state.sinceSeq, evidenceEpoch: epoch(state), ...input.assessmentRef ? { assessmentRef: input.assessmentRef } : {},
    message: 'prepare 仅预览检查点及采用绑定；只有 action: save 成功保存才正式登记 dependentOperation，交给旧 checkpoint 入口不会激活绑定。完整描述保留在本次工具调用参数；摘要省略不扩大检查范围。保存不表示科学结论成立；检查反驳时撤回依赖它的排除。' }
}

/** Identify both model-facing checkpoint entry paths without rewriting frozen tool arguments. */
export function checkpointArguments(name, args) {
  if (name === 'security_checkpoint') return { candidate: args }
  if (name !== 'security_command' || typeof args?.command !== 'string') return undefined
  let command
  try { command = JSON.parse(args.command) }
  catch (_error) { return undefined /* The owning command parser reports malformed JSON. */ }
  if (command?.action?.kind !== 'checkpoint') return undefined
  const { kind: _kind, id: _id, ...candidate } = command.action
  return { candidate }
}

/** Adapt valid legacy notes without inventing original observations or verified claims. */
export function legacyCheckpoint(candidate) {
  const parsed = checkpointSchema.safeParse(candidate)
  if (!parsed.success) return undefined
  const input = parsed.data
  return { action: 'save', phase: input.phase, title: input.title, observations: [],
    interpretation: '分析者摘要：' + input.summary + '\n分析者解释：' + input.reason,
    nextCheck: input.next || '未提供下一检查；继续采用这些解释前先核对原始证据。',
    evidenceIds: input.evidenceIds, findingIds: input.findingIds }
}

/** Retain readable original sources behind legacy project IDs, keeping unavailable history explicit. */
export function legacySourceReferences(input, session, state, config, view) {
  const pairs = durableEvidence(session, { ...state, sinceSeq: -1 }, config, undefined, view)
  const resolutions = input.evidenceIds.map(ref => resolveEvidenceReference(pairs, ref))
  return {
    input: { ...input, observations: resolutions.filter(result => result.status === 'resolved')
      .map(result => ({ ref: result.binding.inputRef })) },
    unavailableSourceRefs: resolutions.filter(result => result.status !== 'resolved')
      .map(({ inputRef, issue }) => ({ inputRef, issue })),
  }
}

/** Admit an exact prepared checkpoint only while its user request and observed evidence remain current. */
export function checkpointAdmission(candidate, session, state) {
  const parsed = checkpointSchema.safeParse(candidate)
  const prepared = results(session, state.sinceSeq).filter(item => item.value.status === 'prepared').at(-1)?.value
  const expected = checkpointSchema.safeParse(prepared?.checkpoint)
  if (!parsed.success || !expected.success || prepared.userSeq !== state.sinceSeq || prepared.evidenceEpoch !== epoch(state)
    || JSON.stringify(parsed.data) !== JSON.stringify(expected.data))
    return 'Use premise_check save with phase/title, observations:[{ref,description?}], interpretation and nextCheck; completed call IDs bind existing evidence without copying output. Quotes are optional and must be exact when supplied. Include ifA/ifB only for an unresolved discriminating experiment. prepare followed by an exact security_checkpoint save also remains supported. Without a completed submit assessment, interpretation remains UNVERIFIED; no Advisor is required. During wrap-up save existing evidence and uncertainty without starting a new experiment.'
}
