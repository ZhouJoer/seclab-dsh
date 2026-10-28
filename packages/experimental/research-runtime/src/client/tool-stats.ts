/** Tool counts derived from the loaded conversation, including nested dispatches. @module */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot, ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Counts for one tool; average duration includes only results with a recorded start time. */
export interface ToolStatistics {
  tool: string
  calls: number
  completed: number
  failed: number
  active: number
  averageDuration?: number
}

/** Aggregate each call once, without reading arguments or result contents.
 * @param chat - Framework-assembled, currently loaded conversation records.
 * @returns Rows ordered by call count, then tool name; active includes argument preparation. */
export function toolStatistics(chat: ChatSnapshot | undefined): ToolStatistics[] {
  const calls = new Map<string, ToolCallBlock>()
  const visit = (call: ToolCallBlock) => {
    const previous = calls.get(call.callId)
    if (!previous || !('kind' in previous)) calls.set(call.callId, call)
    for (const child of call.subCalls) visit(child)
  }
  for (const node of chat?.nodes.values() ?? []) {
    if (node.kind === 'tool-call') visit((node as ChatNode<'tool-call'>).data.root)
  }
  const groups = new Map<string, { row: ToolStatistics; duration: number; timed: number }>()
  for (const call of calls.values()) {
    let group = groups.get(call.name)
    if (!group) {
      group = { row: { tool: call.name, calls: 0, completed: 0, failed: 0, active: 0 }, duration: 0, timed: 0 }
      groups.set(call.name, group)
    }
    group.row.calls++
    if ('kind' in call) {
      if (call.isError) group.row.failed++
      else group.row.completed++
      if (call.callTime !== null && call.time >= call.callTime) {
        group.duration += call.time - call.callTime
        group.timed++
      }
    } else group.row.active++
  }
  return [...groups.values()].map(({ row, duration, timed }) => ({ ...row,
    ...(timed ? { averageDuration: Math.round(duration / timed) } : {}),
  })).sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool))
}
