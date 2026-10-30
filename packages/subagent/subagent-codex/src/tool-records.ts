/** Durable, bounded native tool observations outside the parent model context. @module */
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/** One native tool item observed in the selected Codex thread and turn. */
export interface CodexToolObservation {
  threadId: string
  phase: 'started' | 'completed'
  item: Record<string, unknown>
}

/** Persisted native item text; truncated text is not necessarily valid JSON. */
export interface CodexToolRecord {
  childSessionId: SessionId
  itemId: ToolCallId
  name: string
  phase: 'started' | 'completed'
  record: string
  originalBytes: number
  truncated: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Native advisor tool input and terminal output, never a parent tool execution. */
    'subagent-codex/tool': CodexToolRecord
  }
}

/** Persist an observed item with explicit output completeness.
 * @param session - parent Session owning the consultation.
 * @param observation - wire-validated native tool identity and item.
 * @param maxBytes - maximum UTF-8 item text retained per observation.
 */
export function recordCodexTool(session: Session, observation: CodexToolObservation, maxBytes: number): void {
  const { item } = observation
  if (typeof item.id !== 'string' || typeof item.type !== 'string') throw new Error('Codex tool item requires id and type')
  const bytes = Buffer.from(JSON.stringify(item))
  let end = Math.min(bytes.length, maxBytes)
  while (end > 0 && end < bytes.length && (bytes.readUInt8(end) & 0xc0) === 0x80) end--
  session.append('subagent-codex/tool', {
    childSessionId: SessionId(observation.threadId), itemId: ToolCallId(item.id), name: item.type,
    phase: observation.phase, record: bytes.subarray(0, end).toString('utf8'),
    originalBytes: bytes.length, truncated: end < bytes.length,
  })
}
