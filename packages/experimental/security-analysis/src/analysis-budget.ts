/** Per-turn investigation reviews and budget wrap-up for bound security Sessions. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkbenchConfig } from './index.ts'
import type { SecurityRole } from './workbench/roles.ts'
import type { WorkbenchView } from './workbench/model.ts'

type BudgetConfig = Pick<WorkbenchConfig, 'analysisTurnTokens' | 'analysisCountCacheReads' | 'analysisReviewSteps' | 'analysisWrapUpSteps'>
interface TurnBudget {
  used: number
  last: number
  closing: boolean
  steps: number
  saved?: boolean
  finalizing?: boolean
  stepsSinceReview: number
  previousBatchFailed: boolean
  failedShellExecutions: number
  review: 'initial' | 'requested' | 'checkpoint'
  baseline?: ReturnType<typeof investigationProgress>
  /** Undefined until the current step returns its first tool result. */
  batchFailed?: boolean
}

/** Read the analyst's saved direction and observations explicitly used to finish project checks.
 * @param view - records visible to the coordinator at one committed revision.
 * @returns handoff data and evidence identities for comparison between reviews.
 */
function investigationProgress(view: WorkbenchView) {
  const current = view.records.filter(item => item.kind === 'checkpoint').at(-1)?.value
  const decision = current?.summary.trim() && current.reason.trim() && current.next.trim()
    ? { summary: current.summary, reason: current.reason, next: current.next } : undefined
  const checks = view.records.filter(item => item.kind === 'check').map(item => item.value)
  const cited = new Map(checks.filter(check => check.status === 'completed')
    .flatMap(check => check.evidenceIds.map(id => [id, check.id] as const)))
  const supported = new Set(view.records.flatMap(item => item.kind === 'evidence' && cited.has(item.value.id)
    && !item.value.incomplete && !item.value.failure ? [item.value.id] : []))
  const evidenceId = supported.values().next().value
  return { decision, checkpointId: current?.id, supported,
    resolvedExample: evidenceId ? { checkId: cited.get(evidenceId), evidenceId } : undefined,
    openCheckId: checks.find(check => check.status === 'planned')?.id }
}

type InvestigationProgress = ReturnType<typeof investigationProgress>

function hasProgress(current: InvestigationProgress, baseline: InvestigationProgress | undefined): boolean {
  return (current.decision !== undefined && JSON.stringify(current.decision) !== JSON.stringify(baseline?.decision))
    || [...current.supported].some(id => !baseline?.supported.has(id))
}

const closingTools = new Set(['structured_output', 'security_scope', 'security_evidence', 'security_help', 'security_command', 'security_checkpoint', 'security_complete'])
const closingCommand = z.object({ action: z.object({ kind: z.enum(['checkpoint', 'complete-task', 'report']) }) })
const foregroundShell = z.object({ kind: z.literal('foreground'), exitCode: z.number().nullable(),
  signal: z.string().nullable(), timedOut: z.boolean(), aborted: z.boolean() })

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
 * @param roleOf - active task role for the Session.
 * @param viewOf - committed project records visible to the bound coordinator.
 */
export function installAnalysisBudget(ctx: Context, config: BudgetConfig, roleOf: (id: SessionId) => SecurityRole | undefined,
  viewOf: (id: SessionId) => WorkbenchView): void {
  const turns = new Map<SessionId, TurnBudget>()
  const progress = (id: SessionId) => investigationProgress(viewOf(id))
  const reviewTools = new Set(['security_scope', 'security_help', 'security_capabilities', 'security_environment', 'skill', 'security_evidence', 'security_capture_analysis',
    'security_command', 'security_checkpoint', 'security_complete', 'read', 'read_image', 'grep', 'glob', 'job_list', 'job_output', 'job_kill', 'advisor', 'structured_output', 'run_code'])
  const checkpointInstruction = 'No new complete observation has been linked to a finished check since the last scheduled review. If existing evidence resolves a planned criterion, finish that check with its evidence. Otherwise save a security_command checkpoint: cite the last observation or failed control in summary, distinguish the remaining explanations in reason, and give a test with different predicted outcomes in next. Treat advice as a hypothesis until verified. If the objective is met, submit the result; if the required observation is unavailable, report that limit. Use security_scope for the current revision and security_help for action fields. Capability discovery, environment inspection and skill loading remain available; selecting a module alone does not establish investigation progress.'
  function needsCheckpoint(agent: Agent, predictNext = false): boolean {
    const state = turns.get(agent.id)
    if (!state || state.review === 'initial' || roleOf(agent.id) !== 'coordinator') return false
    if (state.review !== 'checkpoint' && !(predictNext && state.batchFailed !== undefined
      && state.stepsSinceReview + 1 >= config.analysisReviewSteps)) return false
    return !hasProgress(progress(agent.id), state.baseline)
  }
  function stateFor(id: SessionId): TurnBudget {
    let state = turns.get(id)
    if (!state) {
      state = { used: 0, last: 0, closing: false, steps: 0, stepsSinceReview: 0, previousBatchFailed: false, failedShellExecutions: 0, review: 'initial' }
      turns.set(id, state)
    }
    return state
  }
  const closingState = (agent: Agent): TurnBudget | undefined => {
    const state = turns.get(agent.id)
    return config.analysisTurnTokens > 0 && roleOf(agent.id) !== undefined && state !== undefined
      && (state.closing || state.used + state.last >= config.analysisTurnTokens) ? state : undefined
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      turns.delete(session.id)
    } else if (event.type === 'tool/result' && roleOf(session.id) !== undefined) {
      const state = stateFor(session.id)
      state.batchFailed = (state.batchFailed ?? true) && event.data.message.isError === true
    } else if (event.type === 'assistant/message' && event.data.usage) {
      const usage = event.data.usage
      const total = usage.totalTokens ?? usage.inputTokens + usage.outputTokens
        + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      const counted = config.analysisCountCacheReads ? total : total - (usage.cacheReadTokens ?? 0)
      const state = stateFor(session.id)
      state.used += counted
      state.last = counted
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent.id) })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (context.agent && closingState(context.agent)) {
      const state = turns.get(context.agent.id)
      return { ...assembly, tools: assembly.tools.filter(tool => state?.saved || state?.finalizing
        || (state?.closing && state.steps >= config.analysisWrapUpSteps)
        ? tool.name === 'structured_output' : closingTools.has(tool.name)) }
    }
    if (context.agent && needsCheckpoint(context.agent, true))
      return { ...assembly, tools: assembly.tools.filter(tool => reviewTools.has(tool.name)) }
    return assembly
  }, { prepend: true })
  ctx.tools.guard((exec) => {
    const state = exec.agent && turns.get(exec.agent.id)
    if (!state?.closing) {
      if (exec.agent && needsCheckpoint(exec.agent) && !reviewTools.has(exec.name)) return checkpointInstruction
      return undefined
    }
    if (state.saved || state.finalizing ? exec.name !== 'structured_output' : !allowsClosingCall(exec.name, exec.arguments))
      return 'Analysis budget wrap-up allows only the final response or bounded saved-evidence reads and checkpoint, complete-task or report actions; continue exploration in a follow-up turn.'
    return undefined
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.agent && roleOf(exec.agent.id) !== undefined && ['bash', 'pwsh'].includes(exec.name) && !result.isError) {
      const shell = foregroundShell.safeParse(result.value)
      if (shell.success) {
        const state = stateFor(exec.agent.id)
        const failed = shell.data.exitCode !== 0 || shell.data.signal !== null || shell.data.timedOut || shell.data.aborted
        state.failedShellExecutions = failed ? state.failedShellExecutions + 1 : 0
      }
    }
    const state = exec.agent && turns.get(exec.agent.id)
    if (state?.closing && (exec.name === 'security_command' || exec.name === 'security_checkpoint' || exec.name === 'security_complete') && !result.isError
      && allowsClosingCall(exec.name, exec.arguments)) state.saved = true
  })
  ctx.on('agent/pre-step', async ({ agent, signal, turn, step }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = closingState(agent)
    if (!state) {
      if (turn > 1 && step === 1 && roleOf(agent.id) === 'coordinator') {
        const prior = progress(agent.id)
        if (prior.decision || prior.openCheckId || prior.resolvedExample) {
          const handoff = createUserMessage({
            source: { kind: 'plugin:security-analysis-budget' },
            content: [{ type: 'text', text: 'Saved project data from earlier work. Follow the current objective. Check the cited observation before reusing the analyst interpretation; inspect open criteria with security_scope. '
              + JSON.stringify({ checkpointId: prior.checkpointId, checkpoint: prior.decision,
                evidenceForFinishedCheck: prior.resolvedExample, openCheckId: prior.openCheckId }) }],
          })
          return { ...decision, messages: [...decision.messages, handoff] }
        }
      }
      const review = turns.get(agent.id)
      if (!review || review.batchFailed === undefined || !roleOf(agent.id) || needsCheckpoint(agent)) return decision
      if (review.review === 'checkpoint') review.review = 'initial'
      const repeatedFailure = (review.previousBatchFailed && review.batchFailed) || review.failedShellExecutions >= 2
      review.previousBatchFailed = review.batchFailed
      delete review.batchFailed
      const scheduled = ++review.stepsSinceReview >= config.analysisReviewSteps
      if (!scheduled && !repeatedFailure) return decision
      if (scheduled && roleOf(agent.id) === 'coordinator') {
        const current = progress(agent.id)
        review.review = review.review === 'requested' && !hasProgress(current, review.baseline) ? 'checkpoint' : 'requested'
        review.baseline = current
      }
      if (scheduled) review.stepsSinceReview = 0
      review.previousBatchFailed = false
      review.failedShellExecutions = 0
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          source: { kind: 'plugin:security-analysis-budget' },
          content: [{ type: 'text', text: review.review === 'checkpoint' ? checkpointInstruction : (repeatedFailure ? 'Repeated tool or foreground shell failures require a method review. ' : 'Review the investigation direction. ')
            + 'Compare the last planned experiment with its actual result; an unperformed experiment or a rewritten summary is not evidence for its prediction. '
            + 'Before repairing another custom parser or expanding a search, inspect relevant security_capabilities and load its skill. Use security_environment for the selected dependency when needed. These discovery tools remain available during a direction review. '
            + 'Identify the observation supporting the current assumption and one alternative that predicts a different result. '
            + 'Test a different mechanism, not just another parameter value. State a prediction for each mechanism and compare both with the original data before expanding this branch. '
            + 'For a custom extractor, compare source positions, order and lengths with the original artifact. '
            + 'For a candidate filter, pass a known valid input and reject a known invalid input before using zero matches to exclude candidates. '
            + 'If a control fails, fix the measurement and revisit earlier exclusions. If no distinguishing check is available, save the uncertainty and seek a focused independent review or change direction.' }],
        })],
      }
    }
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
          + 'Write three concise lines in Simplified Chinese for the next turn. Cite the last independently verified observation and its evidence or file location. '
          + 'Identify the unverified assumption or failed control and any conclusions that depend on it. Give the smallest next check and the outcome that would change direction. '
          + 'Explain that analysis can continue from these results in a follow-up; do not claim the investigation is complete. '
          + 'You have at most ' + String(config.analysisWrapUpSteps) + ' tool-bearing steps for security_scope, security_evidence or security_help reads, security_checkpoint, security_complete, and security_command report actions. If the objective is already verified, use security_complete to save results; otherwise use security_checkpoint for unfinished progress. Generate a report only on explicit user request; the Host supplies its revision and operation identity. For security_command, read the latest revision if needed and use a fresh operationId for changed input. A failed save is not a saved checkpoint. After a successful save or exhaustion of these steps, give the final response without further tool calls or tool-call markup. Only complete a task when its objective is already verified. Do not call exploration tools. If structured_output is available, return the assigned report with uncertainty and nextSteps.' }],
      })],
    }
  })
  ctx.effect(() => () => { turns.clear() })
}
