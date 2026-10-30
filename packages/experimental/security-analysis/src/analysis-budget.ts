/** Per-turn exploration accounting and a single logged budget wrap-up. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkbenchConfig } from './index.ts'

type BudgetConfig = Pick<WorkbenchConfig, 'analysisTurnTokens' | 'analysisCountCacheReads' | 'analysisWrapUpSteps'>
interface TurnBudget {
  used: number
  last: number
  closing: boolean
  steps: number
  saved?: boolean
  finalizing?: boolean
}

const closingTools = new Set(['structured_output', 'security_scope', 'security_evidence', 'security_help', 'security_command', 'security_checkpoint', 'security_complete'])
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
  if (config.analysisTurnTokens === 0) return
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
      const state = turns.get(session.id) ?? { used: 0, last: 0, closing: false, steps: 0 }
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
      || (state?.closing && state.steps >= config.analysisWrapUpSteps)
      ? tool.name === 'structured_output' : closingTools.has(tool.name)) }
  }, { prepend: true })
  ctx.tools.guard((exec) => {
    const state = exec.agent && turns.get(exec.agent.id)
    if (!state?.closing) return undefined
    if (state.finalizing ? exec.name !== 'structured_output' : !allowsClosingCall(exec.name, exec.arguments))
      return 'Analysis budget wrap-up allows only the final response or bounded saved-evidence reads and checkpoint, complete-task or report actions; continue exploration in a follow-up turn.'
    return undefined
  })
  ctx.on('tools/result', (exec, result) => {
    const state = exec.agent && turns.get(exec.agent.id)
    if (state?.closing && (exec.name === 'security_command' || exec.name === 'security_checkpoint' || exec.name === 'security_complete') && !result.isError
      && allowsClosingCall(exec.name, exec.arguments)) state.saved = true
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
      if (state.finalizing) return { kind: 'reject' }
      if (state.saved || state.steps >= config.analysisWrapUpSteps) {
        state.finalizing = true
        return { ...decision, messages: [...decision.messages.filter(message => message.source.kind !== 'user'),
          createUserMessage({ source: { kind: 'plugin:security-analysis-budget' }, content: [{ type: 'text',
            text: 'The analysis wrap-up tool allowance has ended. Give the final response now in Simplified Chinese: current conclusion, limitation, and next action. '
              + (state.saved ? 'A permitted save action succeeded; describe only what its receipt confirms. '
                : 'No successful checkpoint or report save was observed during wrap-up. State that progress was not saved by those actions and include the last error or remaining blocker. ')
              + 'Do not retry any tool or print tool-call markup such as DSML. Removed tools are unavailable, not text commands. Do not claim the investigation is complete unless the objective was already verified.' }] })] }
      }
      state.steps++
      return { ...decision, messages: decision.messages.filter(message => message.source.kind !== 'user') }
    }
    state.closing = true
    state.steps = 1
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
          + 'You have at most ' + String(config.analysisWrapUpSteps) + ' tool-bearing steps for security_scope, security_evidence or security_help reads, security_checkpoint, security_complete, and security_command report actions. If the objective is already verified, use security_complete to save results; otherwise use security_checkpoint for unfinished progress. Generate a report only on explicit user request; the Host supplies its revision and operation identity. For security_command, read the latest revision if needed and use a fresh operationId for changed input. A failed save is not a saved checkpoint. After a successful save or exhaustion of these steps, give the final response without further tool calls or tool-call markup. Only complete a task when its objective is already verified. Do not call exploration tools. If structured_output is available, return the assigned report with uncertainty and nextSteps.' }],
      })],
    }
  })
  ctx.effect(() => () => { turns.clear() })
}
