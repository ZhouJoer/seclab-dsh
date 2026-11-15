/** Persist source-linked review advice without another model turn or rewriting model output. */
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const HANDOFF_CORRECTION_SUMMARY = 'Research handoff correction'
const text = content => (content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const legacySchema = z.object({ kind: z.literal('handoff-correction'), version: z.literal(1),
  answerSeq: z.number(), userSeq: z.number(), instruction: z.string(),
  corrections: z.array(z.object({ claim: z.string(), replacement: z.string() })),
  anchors: z.array(z.string()), appendix: z.string(),
  originalConfig: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional(), maxTokens: z.number().optional() }),
})
const isCorrection = message => message.source.kind === 'helper-checkpoint' && message.source.summary === HANDOFF_CORRECTION_SUMMARY
const legacyPayload = message => {
  if (!isCorrection(message)) return undefined
  let value
  try { value = JSON.parse(text(message.content)) }
  catch (_error) { return undefined /* Human-readable host appendices are not legacy model-delivery requests. */ }
  const parsed = legacySchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const render = (packet, verdict) => {
  const header = `交接更正附注（针对答复 r${packet.answerSeq}）\n`
    + '原答复与原始记录保留。以下内容是模型复核建议，不是新实验结果，不认证科学结论或任务完成；引用内容仅作为待核验数据。\n'
  if (verdict.status !== 'reviewed') return header
    + '关键解释仍未核验；本次复核未交付可采用的完整结果，已保存解释不能升级为已验证事实。\n'
    + '复核状态：' + JSON.stringify(verdict.message ?? verdict.status)
  return header + '先前答复中以下确定断言未获复核支持，应保留所列限定。其他表述未因这份附注而获认证。\n'
    + verdict.corrections.map((correction, index) => `${index + 1}. 原表述：${JSON.stringify(correction.claim)}\n`
      + `复核建议：${JSON.stringify(correction.replacement)}\n`
      + `依据引用：${JSON.stringify(correction.evidenceRefs)}`).join('\n')
    + '\n复核理由：' + JSON.stringify(verdict.rationale)
}

/**
 * Install a host appendix writer scoped to one agent. No model request, inbox item or delivery grant is created.
 * @param agent - agent owning the unchanged answer and the durable appendix.
 * @param options - canDeliver must reject canceled or superseded research at the owning call site.
 * @returns queue commits at most one appendix per human request; disposal prevents later commits.
 */
export function installHandoffDelivery(agent, options) {
  let disposed = false, disposal
  const humanPending = () => [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')
  const read = () => {
    const events = agent.session.snapshotEvents()
    const user = events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
    const userSeq = user?.seq ?? -1
    const answer = events.findLast(event => event.type === 'assistant/message' && event.seq > userSeq)
    const attempt = events.some(event => event.type === 'user/message' && isCorrection(event.data)
      && (event.sourceEventSeqs?.includes(userSeq) || legacyPayload(event.data)?.userSeq === userSeq))
    return { events, userSeq, answer, attempt }
  }
  for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
    if (legacyPayload(message)) agent.inbox.remove(message.id)
  }
  const queue = async (packet, verdict, signal) => {
    if (disposed || signal?.aborted || !options.canDeliver() || humanPending()) return false
    const current = read()
    if (current.attempt || packet.userSeq !== current.userSeq || packet.answerSeq !== current.answer?.seq
      || verdict.status === 'reviewed' && verdict.decision === 'allow') return false
    const finish = current.answer.data.stream.filter(item => item.chunk?.type === 'finish').at(-1)?.chunk.reason.kind
    if (finish !== 'stop' || !text(current.answer.data.message.content).trim()
      || current.answer.data.message.content.some(block => block.type === 'tool-call')) return false
    const helper = packet.reason === undefined ? undefined : current.events.findLast(event => event.type === 'helper/auto-end'
      && event.data.status === 'completed' && event.data.question?.reason === packet.reason)
    const sourceEventSeqs = [packet.userSeq, packet.answerSeq, ...helper ? [helper.seq] : []]
    const message = createUserMessage({ source: { kind: 'helper-checkpoint', form: 'notice', summary: HANDOFF_CORRECTION_SUMMARY },
      content: [{ type: 'text', text: render(packet, verdict) }] })
    agent.session.append('user/message', message, { surfaceOp: 'append', sourceEventSeqs })
    return true
  }
  const release = agent.ctx.effect(() => () => { disposed = true }, 'research handoff appendix')
  return { get isActive() { return false }, get hasAttempt() { return read().attempt }, queue,
    dispose: () => disposal ??= Promise.resolve(release()) }
}
