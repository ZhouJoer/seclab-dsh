/** Durable Helper history shared by native and PTC presentations. @module */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { HelperCall } from './types.ts'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { HelperState } from './types.ts'

const usage = z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative().optional(), cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(), reasoningTokens: z.number().nonnegative().optional() }).strict()
const call = z.object({
  callId: z.string().transform(brandString<ToolCallId>), rootCallId: z.string().transform(brandString<ToolCallId>).optional(),
  backend: z.enum(['api', 'codex']), model: z.string(), reasoningEffort: z.string().optional(),
  startedAt: z.number(), status: z.enum(['running', 'completed', 'error', 'aborted', 'interrupted']),
  elapsedMs: z.number().nonnegative().optional(),
  childSessionId: z.string().transform(brandString<SessionId>).optional(), usage: usage.optional(),
}).strict() as z.ZodType<HelperCall>
const stateSchema = z.object({ enabled: z.boolean().nullable(), calls: z.array(call) }).strict()

/** Helper selections and idempotent settlements; a closed parent turn ends orphaned runs. */
export const helperProjection = {
  key: 'helper', stateVersion: 1, stateSchema,
  init: () => ({ enabled: null, calls: [] }),
  apply: (state, event) => {
    if (event.type === 'session/end-seed' && event.data.inherited) return { ...state, calls: [] }
    if (event.type === 'helper/policy') return { ...state, enabled: event.data.enabled }
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
