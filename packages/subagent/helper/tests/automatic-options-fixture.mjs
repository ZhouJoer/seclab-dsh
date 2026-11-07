import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'helper-automatic-options-fixture'
export const inject = ['helper', 'sessionProjections']

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || agent.session.header.origin === 'subagent') return decision
    const calls = ctx.sessionProjections.stateOf(agent.session, 'helper').calls
    if (!calls.some(call => call.status === 'completed') || calls.some(call => 'consultationId' in call)) return decision
    const consultationId = randomUUID()
    const advice = await ctx.helper.consultAutomatically({
      reason: 'Independent verification',
      question: 'Reply AUTO_CHECKED after checking that read access is unavailable.',
      context: 'The supplied observation is complete. No additional files are needed.',
    }, agent, signal, consultationId, {
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high',
      maxTokens: 64, toolAccess: 'none',
      recovery: { reasoningEffort: 'high', maxTokens: 128 },
    })
    signal.throwIfAborted()
    return { ...decision, messages: [...decision.messages, createUserMessage({
      content: [{ type: 'text', text: advice }],
      source: { kind: 'helper-automatic', consultationId, form: 'notice', summary: 'Independent verification' },
    })] }
  })
}
