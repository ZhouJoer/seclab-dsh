/** Durable Helper history shared by native and PTC presentations. @module */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { AutomaticHelperCall, ConsultationId, HelperCall } from './types.ts'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { HelperState } from './types.ts'

const usage = z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative().optional(), cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(), reasoningTokens: z.number().nonnegative().optional() }).strict()
const metrics = {
  backend: z.enum(['api', 'codex']), model: z.string(), reasoningEffort: z.string().optional(),
  startedAt: z.number(), status: z.enum(['running', 'completed', 'error', 'aborted', 'interrupted']),
  elapsedMs: z.number().nonnegative().optional(),
  childSessionId: z.string().transform(brandString<SessionId>).optional(), usage: usage.optional(),
}
const call = z.object({ ...metrics,
  callId: z.string().transform(brandString<ToolCallId>), rootCallId: z.string().transform(brandString<ToolCallId>).optional(),
}).strict() as z.ZodType<HelperCall>
const automatic = z.object({ ...metrics,
  consultationId: z.string().transform(brandString<ConsultationId>),
  question: z.object({ reason: z.string(), question: z.string(),
    context: z.string().optional(), attempts: z.string().optional() }).strict(),
  answer: z.string().optional(),
}).strict() as z.ZodType<AutomaticHelperCall>
const stateSchema = z.object({ enabled: z.boolean().nullable(), mode: z.enum(['normal', 'proactive']), calls: z.array(z.union([call, automatic])) }).strict()

/** Helper selections and idempotent settlements; a closed parent turn ends orphaned runs. */
export const helperProjection = {
  key: 'helper', stateVersion: 3, stateSchema,
  init: () => ({ enabled: null, mode: 'normal', calls: [] }),
  apply: (state, event) => {
    if (event.type === 'session/end-seed' && event.data.inherited) return { ...state, calls: [] }
    if (event.type === 'helper/policy') return { ...state, enabled: event.data.enabled, mode: event.data.mode ?? 'normal' }
    if (event.type === 'helper/auto-start') {
      if (state.calls.some(item => 'consultationId' in item && item.consultationId === event.data.consultationId)) return state
      return { ...state, calls: [...state.calls, automatic.parse(event.data)] }
    }
    if (event.type === 'helper/auto-end') {
      const settled = automatic.parse(event.data)
      return { ...state, calls: state.calls.map(item => 'consultationId' in item && item.consultationId === settled.consultationId ? settled : item) }
    }
    if (event.type === 'helper/start') {
      if (state.calls.some(item => item.callId === event.data.callId)) return state
      return { ...state, calls: [...state.calls, call.parse(event.data)] }
    }
    if (event.type === 'helper/end') {
      const settled = call.parse(event.data)
      return { ...state, calls: state.calls.map(item => item.callId === settled.callId ? settled : item) }
    }
    if (event.type === 'turn/end' || event.type === 'session/end-seed') return { ...state, calls: state.calls.map(item => item.status === 'running'
      ? { ...item, status: 'interrupted' as const } : item) }
    return state
  },
  wire: { viewSchema: stateSchema, view: state => state },
} satisfies ProjectionDefinition<'helper', HelperState>
