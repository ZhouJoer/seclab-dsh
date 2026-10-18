/** Persisted Helper selections and display-safe consultation facts. @module */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of a consultation initiated by a Host plugin. */
export type ConsultationId = Branded<'Helper.ConsultationId'>

/** Evidence supplied to either consultation entry point. */
export interface ConsultationQuestion {
  reason: string
  question: string
  context?: string
  attempts?: string
}

/** How actively the main model is prompted to seek advice. */
export type HelperMode = 'normal' | 'proactive'

/** User-owned route sampled at each consultation. */
export interface HelperSettings {
  enabled: boolean
  mode: HelperMode
  backend: 'api' | 'codex'
  provider: string
  model: string
  reasoningEffort: string
  codexModel: string
  codexReasoningEffort: string
}

/** One consultation, retained independently of visible transcript pagination. */
export interface HelperCall {
  callId: ToolCallId
  rootCallId?: ToolCallId
  backend: 'api' | 'codex'
  model: string
  reasoningEffort?: string
  startedAt: number
  status: 'running' | 'completed' | 'error' | 'aborted' | 'interrupted'
  elapsedMs?: number
  childSessionId?: SessionId
  usage?: TokenUsage
}

/** Automatic consultation, independent of model-authored tool calls. */
export interface AutomaticHelperCall extends Omit<HelperCall, 'callId' | 'rootCallId'> {
  consultationId: ConsultationId
  callId?: never
  rootCallId?: never
  question: ConsultationQuestion
  answer?: string
}

/** Session-owned Helper controls and complete consultation history. */
export interface HelperState {
  enabled: boolean | null
  mode: HelperMode
  calls: (HelperCall | AutomaticHelperCall)[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Progress assessment reminder after a main-agent tool result.
     * @persistenceAttribution
     */
    'helper-checkpoint': { kind: 'helper-checkpoint' } & Extract<ContextFormed, { form: 'notice' }>
    /** Advice or failure delivered by an automatic consultation.
     * @persistenceAttribution
     */
    'helper-automatic': { kind: 'helper-automatic'; consultationId: ConsultationId } & Extract<ContextFormed, { form: 'notice' }>
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** User-selected availability; log-only, applied before tool assembly. */
    'helper/policy': { enabled: boolean; mode?: HelperMode }
    /** Accepted consultation, including its exact selected route. */
    'helper/start': HelperCall
    /** Settled consultation, including provider-reported usage when available. */
    'helper/end': HelperCall
    /** Automatic consultation accepted by the Helper service. */
    'helper/auto-start': AutomaticHelperCall
    /** Settled automatic consultation; answers remain available after cancellation. */
    'helper/auto-end': AutomaticHelperCall
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { helper: HelperState }
  interface SessionProjectionMap { helper: HelperState }
}
