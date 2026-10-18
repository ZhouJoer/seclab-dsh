/** Recorded Jev evaluations and bounded progress evidence. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContextFormed, ToolCallId } from '@deepseek-ai/dsh-llm'

/** Identity shared by a decision's request and terminal record. */
export type DecisionId = Branded<'AdvisorJev.DecisionId'>
/** Closed routing choices; only consult_advisor can initiate a consultation. */
export type Route = 'continue' | 'consult_advisor' | 'insufficient_evidence' | 'external_blocker'
/** Validated provider response retained for evaluation and accounting. */
export interface JevAnswer {
  model: string
  choice: Route
  probabilities: Record<Route, number>
  confidence: number
  usage: { input_tokens: number; output_tokens: number }
}
/** Paired tool evidence; result is absent while the call is running. */
export interface ToolEvidence {
  id: ToolCallId
  seq: number
  step: number
  name: string
  arguments: string
  result?: string
}
/** Host-only incremental fold; historical events never execute a request. */
export interface ProgressState {
  turn: number
  completedSteps: number
  lastCheck: number
  consultations: number
  task: string
  previousAdvice: string
  tools: ToolEvidence[]
  hasTools: boolean
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact bounded JSON request, without credentials, before the HTTP operation. */
    'advisor-jev/start': { id: DecisionId; turn: number; completedSteps: number; request: string | null }
    /** Decision outcome; failure never means absence of stagnation. */
    'advisor-jev/end': { id: DecisionId; elapsedMs: number } & (
      | { status: 'completed'; answer: JevAnswer; triggered: boolean }
      | { status: 'error' | 'aborted' | 'superseded'; code: string }
    )
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { advisorJev: ProgressState }
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Automatic judgement failure; the main agent can continue or consult manually.
     * @persistenceAttribution
     */
    'advisor-jev-notice': { kind: 'advisor-jev-notice'; decisionId: DecisionId } & Extract<ContextFormed, { form: 'notice' }>
  }
}
