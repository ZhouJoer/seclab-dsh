/** Investigation reviews and budget wrap-up across internal continuations of a user's analysis request. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import { createUserMessage, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkbenchConfig } from './index.ts'
import type { SecurityRole } from './workbench/roles.ts'
import type { WorkbenchView } from './workbench/model.ts'
import { JobId } from '@deepseek-ai/dsh-jobs'

/** Current exploration permission for a user-requested analysis and its internal continuations. */
export type AnalysisPhase = 'exploring' | 'closing' | 'finalizing'

type BudgetConfig = Pick<WorkbenchConfig, 'analysisTurnTokens' | 'analysisCountCacheReads' | 'analysisReviewSteps' | 'analysisWrapUpSteps'>
interface AnalysisBudget {
  phase: (agent: Agent) => AnalysisPhase
  prepareDelivery: (agent: Agent, message: UserMessage) => boolean
}
interface TurnBudget {
  used: number
  closing: boolean
  steps: number
  saved?: boolean
  finalizing?: boolean
  deliveryOnly?: boolean
  requestId?: MessageId
  delivery?: { messageId: MessageId; requestId: MessageId }
  deliveryPrepared?: boolean
  deliveryConsumed?: boolean
  cleanupAdvanced?: boolean
  jobsListed?: boolean
  collectedJobs: Set<JobId>
  cleanupReads: Set<JobId>
  cleanupKills: Set<JobId>
  stepsSinceReview: number
  previousBatchFailed: boolean
  failedShellExecutions: number
  review: 'initial' | 'requested'
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
  return [...current.supported].some(id => !baseline?.supported.has(id))
}

const cleanupTools = new Set(['job_list', 'job_output', 'job_kill'])
const cleanupArguments = z.object({ job_id: z.string() })
const collectedJob = z.object({ job: z.object({ status: z.enum(['completed', 'killed', 'failed']) }) })
const closingTools = new Set(['structured_output', 'security_scope', 'security_evidence', 'security_help', 'security_command', 'security_checkpoint', 'security_complete', 'premise_check'])
const closingCommand = z.object({ action: z.object({ kind: z.enum(['checkpoint', 'complete-task', 'report']) }) })
const closingPremise = z.object({ action: z.enum(['inspect', 'prepare', 'save']) })
const savedPremise = z.object({ status: z.literal('saved') })
const foregroundShell = z.object({ kind: z.literal('foreground'), exitCode: z.number().nullable(),
  signal: z.string().nullable(), timedOut: z.boolean(), aborted: z.boolean() })

function allowsClosingCall(name: string, args: unknown): boolean {
  if (!closingTools.has(name)) return false
  if (name === 'premise_check') return closingPremise.safeParse(args).success
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
 * @returns Phase reader and one-shot delivery preparation; neither resets accrued usage.
 */
export function installAnalysisBudget(ctx: Context, config: BudgetConfig, roleOf: (id: SessionId) => SecurityRole | undefined,
  viewOf: (id: SessionId) => WorkbenchView): AnalysisBudget {
  const turns = new Map<SessionId, TurnBudget>()
  const progress = (id: SessionId) => investigationProgress(viewOf(id))
  const noProgressInstruction = 'No new complete observation has been linked to a finished check since the last scheduled review. A saved or rewritten checkpoint does not establish that a premise was tested. If existing evidence resolves a planned criterion, finish that check with its evidence. Otherwise execute the smallest check that distinguishes the remaining explanations before using a premise to exclude candidates or expand a search. Keep unresolved claims and failed or incomplete checks explicit. Save a checkpoint when handing off unfinished work, using the available checkpoint tool; saving is not a prerequisite for an informative experiment. If the required observation is unavailable, report that limit and the next check. Treat advice as a hypothesis until verified.'
  function stateFor(id: SessionId): TurnBudget {
    let state = turns.get(id)
    if (!state) {
      state = { used: 0, closing: false, steps: 0, stepsSinceReview: 0, previousBatchFailed: false, failedShellExecutions: 0, review: 'initial', collectedJobs: new Set(), cleanupReads: new Set(), cleanupKills: new Set() }
      turns.set(id, state)
    }
    return state
  }
  const closingState = (agent: Agent): TurnBudget | undefined => {
    const state = turns.get(agent.id)
    return config.analysisTurnTokens > 0 && roleOf(agent.id) !== undefined && state !== undefined
      && (state.closing || state.used >= config.analysisTurnTokens) ? state : undefined
  }
  const pendingJobs = (agent: Agent, state: TurnBudget) => ctx.jobs.list(agent.id)
    .filter(job => job.owner === agent.id && (job.status === 'running' || job.status === 'stopping' || !state.collectedJobs.has(job.id)))
  function allowsCleanup(agent: Agent, state: TurnBudget, name: string, args: unknown): boolean {
    const jobs = pendingJobs(agent, state)
    if (name === 'job_list') return !state.jobsListed && jobs.length > 0
    const parsed = cleanupArguments.safeParse(args)
    if (!parsed.success) return false
    return jobs.some(job => job.id === parsed.data.job_id && (name === 'job_output'
      ? !state.cleanupReads.has(job.id) : job.status === 'running' && !state.cleanupKills.has(job.id)))
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') {
      const state = turns.get(session.id)
      if (state && config.analysisTurnTokens > 0 && roleOf(session.id) !== undefined
        && (state.closing || state.used >= config.analysisTurnTokens)) {
        state.closing = true
        state.finalizing = true
        state.cleanupAdvanced = false
      }
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
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent.id) })
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const boundary = ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')
    // Inbox claims reset the allowance before the new user's first request.
    if (boundary?.openTurnStartSeq !== null && boundary !== undefined
      && (boundary.lastStepStartSeq === null || boundary.lastStepStartSeq < boundary.openTurnStartSeq)) turns.delete(agent.id)
    const state = stateFor(agent.id)
    state.requestId = message.id
    delete state.delivery
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const state = context.agent && turns.get(context.agent.id)
    // Only the final delivery fallback changes tool definitions; normal wrap-up preserves the cached prefix.
    return state?.finalizing && !state.cleanupAdvanced ? { ...assembled, tools: [] } : assembled
  })
  // Schema omission never authorizes execution, including a provider's tool calls during text-only delivery.
  ctx.tools.guard((exec) => {
    const state = exec.agent && turns.get(exec.agent.id)
    if (!state?.closing) return undefined
    if (state.deliveryOnly) return 'Analysis final delivery cannot execute tools. Return the conclusion, limitations and next action from existing observations.'
    if (exec.agent && cleanupTools.has(exec.name) && allowsCleanup(exec.agent, state, exec.name, exec.arguments)) return undefined
    if (state.saved || state.finalizing ? exec.name !== 'structured_output' : !allowsClosingCall(exec.name, exec.arguments))
      return 'Analysis budget wrap-up allows only the final response, existing-job cleanup, or bounded saved-evidence reads and checkpoint, complete-task or report actions; continue exploration after a new user request.'
    return undefined
  })
  ctx.on('tools/execute', async (exec, next) => {
    const state = exec.agent && turns.get(exec.agent.id)
    if (state?.closing && cleanupTools.has(exec.name)) {
      if (exec.name === 'job_list') state.jobsListed = true
      else {
        const args = cleanupArguments.parse(exec.arguments)
        const attempts = exec.name === 'job_output' ? state.cleanupReads : state.cleanupKills
        attempts.add(JobId(args.job_id))
      }
      state.cleanupAdvanced = true
    }
    return next()
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
    if (state && cleanupTools.has(exec.name) && !result.isError) {
      if (exec.name !== 'job_list') {
        const args = cleanupArguments.safeParse(exec.arguments)
        if (args.success) {
          const id = JobId(args.data.job_id)
          if (exec.name === 'job_kill' || collectedJob.safeParse(result.value).success) state.collectedJobs.add(id)
        }
      }
    }
    if (state?.closing && (exec.name === 'security_command' || exec.name === 'security_checkpoint' || exec.name === 'security_complete') && !result.isError
      && allowsClosingCall(exec.name, exec.arguments)) state.saved = true
    if (state?.closing && exec.name === 'premise_check' && !result.isError
      && closingPremise.safeParse(exec.arguments).data?.action === 'save' && savedPremise.safeParse(result.value).success) state.saved = true
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
            content: [{ type: 'text', text: 'Saved project data from earlier work. Follow the current objective. Saved summaries and checkpoints are analyst interpretations, not independently certified facts. Preserve their uncertainty labels. Check the raw cited observation before reusing an interpretation or excluding candidates; uncited and unverified claims remain hypotheses. Explicitly retract earlier exclusions when new evidence contradicts their premises. Inspect open criteria with security_scope. '
              + JSON.stringify({ checkpointId: prior.checkpointId, checkpoint: prior.decision,
                evidenceForFinishedCheck: prior.resolvedExample, openCheckId: prior.openCheckId }) }],
          })
          return { ...decision, messages: [...decision.messages, handoff] }
        }
      }
      const review = turns.get(agent.id)
      if (!review || review.batchFailed === undefined || !roleOf(agent.id)) return decision
      const repeatedFailure = (review.previousBatchFailed && review.batchFailed) || review.failedShellExecutions >= 2
      review.previousBatchFailed = review.batchFailed
      delete review.batchFailed
      const scheduled = ++review.stepsSinceReview >= config.analysisReviewSteps
      if (!scheduled && !repeatedFailure) return decision
      let noProgress = false
      if (scheduled && roleOf(agent.id) === 'coordinator') {
        const current = progress(agent.id)
        noProgress = review.review === 'requested' && !hasProgress(current, review.baseline)
        review.review = 'requested'
        review.baseline = current
      }
      if (scheduled) review.stepsSinceReview = 0
      review.previousBatchFailed = false
      review.failedShellExecutions = 0
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          source: { kind: 'plugin:security-analysis-budget' },
          content: [{ type: 'text', text: noProgress ? noProgressInstruction : (repeatedFailure ? 'Repeated tool or foreground shell failures require a method review. ' : 'Review the investigation direction. ')
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
      if (step === 1 && state.delivery && state.delivery.requestId === state.requestId
        && decision.messages.some(message => message.id === state.delivery?.messageId)) {
        delete state.delivery
        state.deliveryConsumed = true
        state.deliveryOnly = true
        state.finalizing = true
        state.cleanupAdvanced = false
        return decision
      }
      if (step === 1 && !state.deliveryConsumed
        && decision.messages.some(message => message.source.kind === 'helper-output-recovery')) return decision
      for (const message of decision.messages) {
        if (message.source.kind === 'user') agent.send(message, 'next-turn', false)
      }
      if (state.finalizing) {
        if (!state.cleanupAdvanced) {
          if (step === 1) return { ...decision, messages: [] }
          if (state.deliveryOnly) return { kind: 'reject' }
          state.deliveryOnly = true
          return { ...decision, messages: [...decision.messages.filter(message => message.source.kind !== 'user'),
            createUserMessage({ source: { kind: 'plugin:security-analysis-budget' }, content: [{ type: 'text',
              text: 'No permitted cleanup advanced. Deliver the final response now from existing observations in Simplified Chinese: current conclusion, limitations, and the next action. No tools are available for this final delivery. Do not retry the denied action, begin new analysis, or claim unverified completion. State whether the earlier save succeeded and retain any pending job IDs or cleanup failure.' }] })] }
        }
        state.cleanupAdvanced = false
        return { ...decision, messages: decision.messages.filter(message => message.source.kind !== 'user') }
      }
      if (state.saved || state.steps >= config.analysisWrapUpSteps) {
        state.finalizing = true
        state.cleanupAdvanced = false
        return { ...decision, messages: [...decision.messages.filter(message => message.source.kind !== 'user'),
          createUserMessage({ source: { kind: 'plugin:security-analysis-budget' }, content: [{ type: 'text',
            text: 'The analysis wrap-up save and evidence-read allowance has ended. Collect relevant existing jobs or cancel obsolete ones, then give the final response in Simplified Chinese: current conclusion, limitation, and next action. '
              + (state.saved ? 'A permitted save action succeeded; describe only what its receipt confirms. '
                : 'No successful checkpoint or report save was observed during wrap-up. State that progress was not saved by those actions and include the last error or remaining blocker. ')
              + 'Only existing-job cleanup calls are permitted. Tool definitions remain visible, but execution restrictions still apply. Do not retry denied tools or print tool-call markup such as DSML. Do not claim the investigation is complete unless the objective was already verified.' }] })] }
      }
      if (state.cleanupAdvanced) {
        state.cleanupAdvanced = false
        return { ...decision, messages: decision.messages.filter(message => message.source.kind !== 'user') }
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
          + 'Accrued usage has reached the exploration allowance. '
          + 'Write three concise lines in Simplified Chinese for the next turn. Cite the last independently verified observation and its evidence or file location. '
          + 'Identify the unverified assumption or failed control and any conclusions that depend on it. Give the smallest next check and the outcome that would change direction. '
          + 'Explain that analysis can continue from these results in a follow-up; do not claim the investigation is complete. '
          + 'You have at most ' + String(config.analysisWrapUpSteps) + ' tool-bearing steps for security_scope, security_evidence or security_help reads, premise_check inspect/prepare/save, security_checkpoint, security_complete, and security_command report actions. Premise preparation records existing evidence and uncertainty; it does not authorize experiments or consultations and does not save a checkpoint. A premise_check save succeeds only when its receipt says saved. Existing-job cleanup remains available after saving and does not consume these save steps: job_list once, job_output once per owned job, and job_kill for obsolete running jobs. If a job is still relevant and cannot finish within that read, report its id and pending status for handoff. If the objective is already verified, use security_complete to save results; otherwise use premise_check save or security_checkpoint for unfinished progress. Generate a report only on explicit user request; the Host supplies its revision and operation identity. For security_command, read the latest revision if needed and use a fresh operationId for changed input. A failed save is not a saved checkpoint. After a successful save or exhaustion of these steps, finish existing-job cleanup and give the final response without further exploration. Only complete a task when its objective is already verified. Tool definitions remain visible, but exploration calls are denied. If structured_output is available, return the assigned report with uncertainty and nextSteps.' }],
      })],
    }
  })
  ctx.effect(() => () => { turns.clear() })
  return {
    phase(agent: Agent): AnalysisPhase {
      const state = closingState(agent)
      return state?.saved || state?.finalizing ? 'finalizing' : state ? 'closing' : 'exploring'
    },
    prepareDelivery(agent: Agent, message: UserMessage): boolean {
      const state = closingState(agent)
      if (!state?.requestId || state.deliveryPrepared || message.source.kind === 'user') return false
      state.delivery = { messageId: message.id, requestId: state.requestId }
      state.deliveryPrepared = true
      return true
    },
  }
}
