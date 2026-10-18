/** Bounded progress fold; one increment per completed tool-bearing step. @module */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Config } from './config.ts'
import type { ProgressState } from './types.ts'

const stateSchema = z.object({
  turn: z.number(), completedSteps: z.number(), lastCheck: z.number(), consultations: z.number(),
  task: z.string(), previousAdvice: z.string(), hasTools: z.boolean(),
  tools: z.array(z.object({ id: z.string().transform(ToolCallId), seq: z.number(), step: z.number(),
    name: z.string(), arguments: z.string(), result: z.string().optional() })),
}) as z.ZodType<ProgressState>

/**
 * Bound a text field while explicitly marking missing evidence.
 * @param text Original text.
 * @param limit Maximum UTF-16 code units, including the omission marker.
 * @returns Bounded text without an unpaired trailing surrogate.
 */
export function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '[truncated]'.slice(0, limit)
  let head = text.slice(0, limit - marker.length)
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1)
  return head + marker
}

/**
 * Build a host-only projection whose work and retained evidence are bounded.
 * @param config Evidence retention limits.
 * @returns Registered fold, replayable without network or consultation effects.
 */
export function progressProjection(config: Config): ProjectionDefinition<'advisorJev'> {
  const clip = (value: string) => excerpt(value, config.maxFieldChars)
  return {
    key: 'advisorJev', stateVersion: 1, stateSchema,
    init: () => ({ turn: 0, completedSteps: 0, lastCheck: 0, consultations: 0, task: '', previousAdvice: '', tools: [], hasTools: false }),
    apply: (state, event) => {
      switch (event.type) {
        case 'turn/start':
          return { ...state, turn: event.data.turn, completedSteps: 0, lastCheck: 0, consultations: 0, tools: [], hasTools: false }
        case 'user/message':
          return event.data.source.kind === 'user' ? { ...state, task: clip(event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')) } : state
        case 'tool/call':
          if (event.data.name === 'advisor') return state
          return { ...state, hasTools: true, tools: [...state.tools, {
            id: event.data.callId, seq: event.seq, step: event.data.step,
            name: clip(event.data.name), arguments: clip(event.data.arguments),
          }].slice(-config.maxEvidenceCalls) }
        case 'tool/result': {
          const id = event.data.message.toolCallId
          if (!state.tools.some(tool => tool.id === id)) return state
          const result = clip(event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
          return { ...state, tools: state.tools.map(tool => tool.id === id ? { ...tool, result } : tool) }
        }
        case 'step/end':
          return state.hasTools ? { ...state, hasTools: false, completedSteps: state.completedSteps + 1 } : state
        case 'advisor-jev/start':
          return { ...state, lastCheck: event.data.completedSteps }
        case 'helper/start':
          return { ...state, lastCheck: state.completedSteps }
        case 'helper/end':
          return { ...state, lastCheck: state.completedSteps, tools: [] }
        case 'helper/auto-start':
          return { ...state, consultations: state.consultations + 1 }
        case 'helper/auto-end':
          return { ...state, lastCheck: state.completedSteps, tools: [], previousAdvice: clip(event.data.answer ?? '') }
        default:
          // Other plugins' events do not change progress evidence.
          return state
      }
    },
  }
}
