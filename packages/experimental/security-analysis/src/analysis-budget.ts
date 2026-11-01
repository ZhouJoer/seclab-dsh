/** Per-turn investigation reviews and budget wrap-up for bound security Sessions. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkbenchConfig } from './index.ts'
import type { SecurityRole } from './workbench/roles.ts'
import type { WorkbenchView } from './workbench/model.ts'

type BudgetConfig = Pick<WorkbenchConfig, 'analysisTurnTokens' | 'analysisCountCacheReads' | 'analysisReviewSteps'>
interface TurnBudget {
  used: number
  last: number
  closing: boolean
  stepsSinceReview: number
  previousBatchFailed: boolean
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
  const reviewTools = new Set(['security_scope', 'security_help', 'security_evidence', 'security_capture_analysis',
    'security_command', 'read', 'read_image', 'grep', 'glob', 'job_list', 'job_output', 'job_kill', 'advisor', 'structured_output', 'run_code'])
  const checkpointInstruction = 'No new complete observation has been linked to a finished check since the last scheduled review. If existing evidence resolves a planned criterion, finish that check with its evidence. Otherwise save a security_command checkpoint: cite the last observation or failed control in summary, distinguish the remaining explanations in reason, and give a test with different predicted outcomes in next. Treat advice as a hypothesis until verified. If the objective is met, submit the result; if the required observation is unavailable, report that limit. Use security_scope for the current revision and security_help for action fields.'
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
      state = { used: 0, last: 0, closing: false, stepsSinceReview: 0, previousBatchFailed: false, review: 'initial' }
      turns.set(id, state)
    }
    return state
  }
  const closingState = (agent: Agent): TurnBudget | undefined => {
    const state = turns.get(agent.id)
    return roleOf(agent.id) !== undefined && state !== undefined
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
    if (context.agent && closingState(context.agent)) return { ...assembly, tools: assembly.tools.filter(tool => tool.name === 'structured_output') }
    if (context.agent && needsCheckpoint(context.agent, true))
      return { ...assembly, tools: assembly.tools.filter(tool => reviewTools.has(tool.name)) }
    return assembly
  }, { prepend: true })
  ctx.tools.guard((exec) => {
    if (!exec.agent) return
    if (turns.get(exec.agent.id)?.closing && exec.name !== 'structured_output')
      return 'Analysis budget wrap-up allows only the final response; continue exploration in a follow-up turn.'
    if (needsCheckpoint(exec.agent) && !reviewTools.has(exec.name)) return checkpointInstruction
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
      const repeatedFailure = review.previousBatchFailed && review.batchFailed
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
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          source: { kind: 'plugin:security-analysis-budget' },
          content: [{ type: 'text', text: review.review === 'checkpoint' ? checkpointInstruction : (repeatedFailure ? 'Two consecutive tool steps returned only errors. ' : 'Review the investigation direction. ')
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
          + 'Write three concise lines in Simplified Chinese for the next turn. Cite the last independently verified observation and its evidence or file location. '
          + 'Identify the unverified assumption or failed control and any conclusions that depend on it. Give the smallest next check and the outcome that would change direction. '
          + 'Explain that analysis can continue from these results in a follow-up; do not claim the investigation is complete. '
          + 'Do not call exploration tools. If structured_output is available, return the assigned report with uncertainty and nextSteps.' }],
      })],
    }
  })
  ctx.effect(() => () => { turns.clear() })
}
