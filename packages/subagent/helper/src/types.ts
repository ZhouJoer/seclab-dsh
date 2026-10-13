/** Persisted Helper selections and display-safe consultation facts. @module */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/** User-owned route sampled at each consultation. */
export interface HelperSettings {
  enabled: boolean
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

/** Session-owned Helper controls and complete consultation history. */
export interface HelperState {
  enabled: boolean | null
  calls: HelperCall[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** User-selected availability; log-only, applied before tool assembly. */
    'helper/policy': { enabled: boolean }
    /** Accepted consultation, including its exact selected route. */
    'helper/start': HelperCall
    /** Settled consultation, including provider-reported usage when available. */
    'helper/end': HelperCall
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { helper: HelperState }
  interface SessionProjectionMap { helper: HelperState }
}
