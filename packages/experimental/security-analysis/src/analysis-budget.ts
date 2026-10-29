/** Per-turn exploration accounting and a single logged budget wrap-up. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkbenchConfig } from './index.ts'

type BudgetConfig = Pick<WorkbenchConfig, 'analysisTurnTokens' | 'analysisCountCacheReads'>
interface TurnBudget {
  used: number
  last: number
  closing: boolean
  saved?: boolean
  finalizing?: boolean
}

const closingTools = new Set(['structured_output', 'security_scope', 'security_evidence', 'security_help', 'security_command'])
const closingCommand = z.object({ action: z.object({ kind: z.enum(['checkpoint', 'complete-task', 'report']) }) })

function allowsClosingCall(name: string, args: unknown): boolean {
  if (!closingTools.has(name)) return false
  if (name !== 'security_command') return true
  const envelope = z.object({ command: z.string() }).safeParse(args)
  if (!envelope.success) return false
  let command: unknown
  try { command = JSON.parse(envelope.data.command) }
  catch (_error) { return false /* Malformed commands cannot authorize a closing action. */ }
  return closingCommand.safeParse(command).success
}

/** Install per-Session accounting without changing provider usage or billing totals.
 * @param ctx - security plugin context owning the listeners and tool guard.
 * @param config - resolved exploration limit and cache accounting policy.
 * @param hasTask - whether the Session currently belongs to an analysis task.
 */
export function installAnalysisBudget(ctx: Context, config: BudgetConfig, hasTask: (id: SessionId) => boolean): void {
  const turns = new Map<SessionId, TurnBudget>()
  const closingState = (agent: Agent): TurnBudget | undefined => {
    const state = turns.get(agent.id)
    return hasTask(agent.id) && state !== undefined
      && (state.closing || state.used + state.last >= config.analysisTurnTokens) ? state : undefined
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      turns.delete(session.id)
    } else if (event.type === 'assistant/message' && event.data.usage) {
      const usage = event.data.usage
      const total = usage.totalTokens ?? usage.inputTokens + usage.outputTokens
        + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      const counted = config.analysisCountCacheReads ? total : total - (usage.cacheReadTokens ?? 0)
      const state = turns.get(session.id) ?? { used: 0, last: 0, closing: false }
      state.used += counted
      state.last = counted
      turns.set(session.id, state)
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent.id) })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (!context.agent || !closingState(context.agent)) return assembly
    const state = turns.get(context.agent.id)
    return { ...assembly, tools: assembly.tools.filter(tool => state?.saved || state?.finalizing
      ? tool.name === 'structured_output' : closingTools.has(tool.name)) }
  }, { prepend: true })
  ctx.tools.guard((exec) => {
    const state = exec.agent && turns.get(exec.agent.id)
    if (!state?.closing) return undefined
    if (state.finalizing ? exec.name !== 'structured_output' : !allowsClosingCall(exec.name, exec.arguments))
      return 'Analysis budget wrap-up allows only the final response or one batch of saved-evidence reads and checkpoint, complete-task or report actions; continue exploration in a follow-up turn.'
    if (exec.name !== 'structured_output') state.saved = true
    return undefined
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = closingState(agent)
    if (!state) return decision
    if (state.closing) {
      for (const message of decision.messages) {
        if (message.source.kind === 'user') agent.send(message, 'next-turn', false)
      }
      if (state.saved && !state.finalizing) {
        state.finalizing = true
        return { ...decision, messages: decision.messages.filter(message => message.source.kind !== 'user') }
      }
      return { kind: 'reject' }
    }
    state.closing = true
    const accounting = config.analysisCountCacheReads ? 'including cache reads' : 'excluding cache reads'
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        source: { kind: 'plugin:security-analysis-budget' },
        content: [{ type: 'text', text: 'Analysis exploration is ending for this turn. Counted usage: '
          + String(state.used) + ' / ' + String(config.analysisTurnTokens) + ' tokens (' + accounting + '). '
          + 'Another request comparable to the last would reach the allowance. '
          + 'Continue the current research direction without creating a new stage. Write three concise lines in Simplified Chinese: current conclusion, key impact or limitation, and next action or blocker. Preserve code identifiers and paths. Include tools only when essential. Use only existing results: what is established, '
          + 'saved evidence or file locations, uncertainty and unfinished checks, and the next focused action. '
          + 'Explain that analysis can continue from these results in a follow-up; do not claim the investigation is complete. '
          + 'You may use one batch of security_scope, security_evidence or security_help reads and security_command checkpoint, complete-task or report actions to preserve existing results. Only complete a task when its objective is already verified. After that batch, give the final response without further collection. Do not call exploration tools. If structured_output is available, return the assigned report with uncertainty and nextSteps.' }],
      })],
    }
  })
  ctx.effect(() => () => { turns.clear() })
}
