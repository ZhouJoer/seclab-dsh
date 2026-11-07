/** Bounded, logged delivery after a known incomplete model response. @module */
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, lastAssistantStreamChunk, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ApiConsultationRecovery } from './types.ts'

const PROMPT = 'Your preceding response ended before a usable answer was delivered. The original task may remain incomplete. Return exactly three short paragraphs labeled Verified observations, Remaining gaps, and Next discriminating check. Under Verified observations, report only existing raw observations or results of checks already executed in this conversation, and identify that evidence. If no independent check was executed, say so explicitly; internal derivation is not an independent check. State unresolved work and uncertainty under Remaining gaps. Propose the next smallest check that can distinguish competing explanations without claiming it was executed. Do not complete missing deliverables, generate missing results, begin new calculations, expand the analysis, perform research, or use tools. Deliver this brief report now.'

/** A committed assistant response, excluding private reasoning from its delivery text. */
export interface DeliveryResponse {
  readonly seq: SessionSeq
  readonly turn: number
  readonly finish: 'stop' | 'max-tokens' | 'other'
  readonly text: string
  readonly hasToolCalls: boolean
}

/** Durable identity and outcome of one delivery attempt. */
export interface OutputRecoveryAttempt {
  readonly messageId: MessageId
  readonly failedMessageSeq: SessionSeq
  readonly originalConfig: Pick<LlmCallConfig, 'provider' | 'model' | 'reasoningEffort' | 'maxTokens'>
  readonly turn?: number
  readonly response?: DeliveryResponse
  readonly endReason?: string
  readonly superseded?: true
}

/** Session-derived delivery state, retained across reloads. */
export interface OutputRecoveryState {
  readonly turn: number
  readonly usedSinceUser: boolean
  readonly everUsed: boolean
  readonly config?: Pick<LlmCallConfig, 'provider' | 'model' | 'reasoningEffort' | 'maxTokens'>
  readonly latest?: DeliveryResponse
  readonly attempt?: OutputRecoveryAttempt
}

const configSchema = z.object({ provider: z.string(), model: z.string(),
  reasoningEffort: z.string().transform(ReasoningEffortId).optional(), maxTokens: z.number().optional() })
const responseSchema = z.object({ seq: z.number().transform(SessionSeq), turn: z.number(),
  finish: z.enum(['stop', 'max-tokens', 'other']), text: z.string(), hasToolCalls: z.boolean() })
const stateSchema = z.object({ turn: z.number(), usedSinceUser: z.boolean(), everUsed: z.boolean(),
  config: configSchema.optional(), latest: responseSchema.optional(), attempt: z.object({
    messageId: z.string().transform(brandString<MessageId>), failedMessageSeq: z.number().transform(SessionSeq),
    originalConfig: configSchema, turn: z.number().optional(), response: responseSchema.optional(),
    endReason: z.string().optional(), superseded: z.literal(true).optional(),
  }).optional() }) as z.ZodType<OutputRecoveryState>

/** Projection of attempts and responses; an enqueued attempt consumes its allowance even if canceled. */
export const outputRecoveryProjection = {
  key: 'helperOutputRecovery', stateVersion: 1, stateSchema,
  init: () => ({ turn: 0, usedSinceUser: false, everUsed: false }),
  apply: (state, event) => {
    if (event.type === 'turn/start') return { ...state, turn: event.data.turn }
    if (event.type === 'request/header') return { ...state, config: event.data.header.config }
    if (event.type === 'agent/inbox/spliced') {
      const message = event.data.inserted.find(item => item.source.kind === 'helper-output-recovery')
      if (message?.source.kind !== 'helper-output-recovery' || state.config === undefined) return state
      return { ...state, usedSinceUser: true, everUsed: true, attempt: { messageId: message.id,
        failedMessageSeq: message.source.failedMessageSeq, originalConfig: state.config } }
    }
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'user') return { ...state, usedSinceUser: false,
        ...state.attempt?.turn === state.turn ? { attempt: { ...state.attempt, superseded: true as const, endReason: 'superseded' } } : {} }
      if (event.data.source.kind === 'helper-output-recovery' && state.attempt?.messageId === event.data.id) {
        return { ...state, attempt: { ...state.attempt, turn: state.turn } }
      }
    }
    if (event.type === 'assistant/message') {
      const finish = lastAssistantStreamChunk(event.data.stream, 'finish')?.reason.kind
      const response: DeliveryResponse = { seq: event.seq, turn: event.data.turn,
        finish: finish === 'stop' || finish === 'max-tokens' ? finish : 'other',
        text: event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        hasToolCalls: event.data.message.content.some(block => block.type === 'tool-call') }
      return { ...state, latest: response, ...state.attempt?.turn === response.turn && !state.attempt.superseded
        ? { attempt: { ...state.attempt, response } } : {} }
    }
    if (event.type === 'turn/end' && state.attempt?.turn === event.data.turn && !state.attempt.superseded) {
      return { ...state, attempt: { ...state.attempt, endReason: event.data.reason.kind } }
    }
    return state
  },
} satisfies ProjectionDefinition<'helperOutputRecovery', OutputRecoveryState>

/** Controls one response-delivery allowance per consultation or admitted human input. */
export interface OutputRecoveryOptions extends ApiConsultationRecovery {
  /** False permits one attempt over this session; true permits another after a new human message is admitted. */
  readonly resetOnUserInput: boolean
  /** Additional caller-owned admission check; omission permits recovery while the agent is active. */
  readonly canRecover?: () => boolean
}

/** Agent-scoped observation and disposal of response-delivery recovery. */
export interface OutputRecoveryController {
  /** Latest committed response and attempt, including failed or canceled attempts. */
  readonly state: OutputRecoveryState
  /** Whether the currently claimed input requests the delivery-only turn. */
  readonly isRecovering: boolean
  /**
   * Cancel and drain an active delivery turn before releasing its guards; preserve unrelated queued input.
   * The Agent retains a one-request config restoration until its next normal header commits.
   * @returns Completion of owned delivery work and release of recovery admission.
   */
  dispose(): Promise<void>
}

/**
 * Install one bounded delivery turn using the existing Agent lifecycle. A known output limit or
 * completed empty text can qualify; errors, refusals, cancellation and pending tool calls cannot.
 * Human input supersedes an unclaimed recovery and is never rewritten as delivery-only work.
 * The same session retains both turns and usage. Delivery disables tools and requires one request.
 * Callers must validate the attempt's own response, never an earlier non-empty output fallback.
 * @param agent Agent whose context owns all callbacks and guards.
 * @param options Explicit recovery controls and allowance scope.
 * @returns Observation of the logged attempt and an idempotent disposer.
 */
export function installOutputRecovery(agent: Agent, options: OutputRecoveryOptions): OutputRecoveryController {
  const ctx = agent.ctx
  const releaseProjection = ctx.sessionProjections.register(outputRecoveryProjection)
  const read = (): OutputRecoveryState => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'helperOutputRecovery')
    if (state === undefined) throw new Error('Output recovery requires its projection')
    return state
  }
  let active = false
  let claimedTurn: number | undefined
  let disposed = false
  let finalState: OutputRecoveryState | undefined
  let disposal: Promise<void> | undefined
  let drainingTurn: number | undefined
  let drained: PromiseWithResolvers<void> | undefined
  const humanPending = (): boolean => [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')
  const canRecover = (): boolean => !disposed && (options.canRecover?.() ?? true)
  const dropPending = (): void => {
    for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
      if (message.source.kind === 'helper-output-recovery') agent.inbox.remove(message.id)
    }
  }
  let restoreTried = false
  const offRequest = ctx.on('agent/request', async ({ agent: current }, next) => {
    const config = await next()
    if (current !== agent) return config
    if (active) return { ...config, reasoningEffort: ReasoningEffortId(options.reasoningEffort), maxTokens: options.maxTokens }
    restoreTried = true
    const original = (finalState ?? read()).attempt?.originalConfig
    if (original === undefined || original.provider !== config.provider || original.model !== config.model) return config
    const { reasoningEffort, maxTokens, ...rest } = config
    const effort = reasoningEffort === options.reasoningEffort ? original.reasoningEffort : reasoningEffort
    const limit = maxTokens === options.maxTokens ? original.maxTokens : maxTokens
    return { ...rest, ...effort === undefined ? {} : { reasoningEffort: effort }, ...limit === undefined ? {} : { maxTokens: limit } }
  }, { prepend: true })
  const offRestoredHeader = ctx.on('session/event', (session, event) => {
    if (session === agent.session && disposed && !active && restoreTried && event.type === 'request/header') detachRestoration()
  })
  const detachRestoration = (): void => { offRequest(); offRestoredHeader() }
  const detach = [
    ctx.on('agent/inbox/claimed', ({ agent: current, message, turn }) => {
      if (current !== agent) return
      if (message.source.kind === 'user') { active = false; claimedTurn = undefined }
      else if (message.source.kind === 'helper-output-recovery' && !humanPending() && canRecover()) {
        active = true; claimedTurn = turn
      }
    }),
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'turn/end' && event.data.turn === claimedTurn) { active = false; claimedTurn = undefined }
      if (event.type === 'turn/end' && event.data.turn === drainingTurn) drained?.resolve()
    }),
    ctx.on('agent/inbox/inserted', ({ agent: current, message }) => {
      if (current === agent && message.source.kind === 'user') dropPending()
    }),
    ctx.on('agent/pre-step', async ({ agent: current, turn, messages }, next) => {
      const decision = await next()
      if (current !== agent || decision.kind === 'reject') return decision
      if (messages.some(message => message.source.kind === 'user') || decision.messages.some(message => message.source.kind === 'user')) {
        active = false; claimedTurn = undefined
        return { ...decision, messages: decision.messages.filter(message => message.source.kind !== 'helper-output-recovery') }
      }
      if (active && read().latest?.turn === turn) return { kind: 'reject' }
      return decision
    }, { prepend: true }),
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembled = await next()
      return context.agent === agent && active ? { ...assembled, tools: [] } : assembled
    }, { prepend: true }),
    ctx.tools.guard(exec => exec.agent === agent && active ? 'Response delivery cannot execute tools. Return the final report from the available evidence.' : undefined),
    ctx.on('agent/turn-stopping', ({ agent: current, turn, signal }) => {
      if (current !== agent) return
      const state = read()
      const response = state.latest
      if (signal.aborted || !canRecover() || humanPending() || response?.turn !== turn || response.hasToolCalls
        || (options.resetOnUserInput ? state.usedSinceUser : state.everUsed)
        || state.config === undefined) return
      if (response.finish !== 'max-tokens' && !(response.finish === 'stop' && !response.text.trim())) return
      agent.followup(createUserMessage({ content: [{ type: 'text', text: PROMPT }],
        source: { kind: 'helper-output-recovery', failedMessageSeq: response.seq, form: 'notice', summary: 'Deliver the available findings after an incomplete response' } }))
    }),
  ]
  const release = ctx.effect(function* () {
    yield releaseProjection
    for (const off of detach) yield off
    yield async () => {
      disposed = true
      dropPending()
      if (active && claimedTurn !== undefined) {
        drainingTurn = claimedTurn
        drained = Promise.withResolvers<void>()
        agent.cancel({ kind: 'hook', reason: 'Output delivery recovery was disabled' }, { keepInbox: true })
        await drained.promise
      }
      finalState = read()
      active = false; claimedTurn = undefined
      const original = finalState.attempt?.originalConfig
      const current = finalState.config
      if (original === undefined || current === undefined || current.provider !== original.provider || current.model !== original.model
        || (current.reasoningEffort !== options.reasoningEffort || current.reasoningEffort === original.reasoningEffort)
        && (current.maxTokens !== options.maxTokens || current.maxTokens === original.maxTokens)) detachRestoration()
    }
  }, 'helper response delivery')
  const dispose = (): Promise<void> => disposal ??= Promise.resolve(release())
  return { get state() { return finalState ?? read() }, get isRecovering() { return active }, dispose }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { helperOutputRecovery: OutputRecoveryState }
}
