/** Recorded calls aggregate without counting nested occurrences twice or inventing durations. @module */
import { expect, it } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ChatSnapshotBuilder } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { toolStatistics } from '../src/client/tool-stats.ts'

function result(callId: string, name: string, overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return { kind: 'tool-result', callId, name, call: { name, argsRaw: '{}' }, callTime: 1000, time: 1120,
    isError: false, subCalls: [], seq: 2, args: PartialArguments.EMPTY, content: [], ...overrides }
}
function snapshot(...calls: ToolCallBlock[]) {
  const nodes: ChatNode<'tool-call'>[] = calls.map((root, index) => ({ key: `node-${index}`, id: `node-${index}`,
    kind: 'tool-call', target: 'chat', anchorSeq: index, visibility: 'visible', location: { kind: 'session' }, data: { root } }))
  return new ChatSnapshotBuilder().replace({ nodes, timeline: { turnOrder: [], turns: new Map() } })
}

it('summarizes repeated, nested, failed and active calls from a recorded conversation', () => {
  const failed = result('nested', 'read_file', { isError: true, time: 1180 })
  const running: ToolCallBlock = { callId: 'active', name: 'shell', phase: 'start', argsRaw: '{}',
    args: PartialArguments.EMPTY, time: 2000, turn: 0, step: 1, subCalls: [] }
  expect(toolStatistics(snapshot(result('root', 'ptc', { subCalls: [failed] }), failed,
    result('read', 'read_file'), running))).toMatchInlineSnapshot(`
      [
        {
          "active": 0,
          "averageDuration": 150,
          "calls": 2,
          "completed": 1,
          "failed": 1,
          "tool": "read_file",
        },
        {
          "active": 0,
          "averageDuration": 120,
          "calls": 1,
          "completed": 1,
          "failed": 0,
          "tool": "ptc",
        },
        {
          "active": 1,
          "calls": 1,
          "completed": 0,
          "failed": 0,
          "tool": "shell",
        },
      ]
    `)
})

it('excludes missing or reversed timestamps from averages and preserves unknown tool names', () => {
  const rows = toolStatistics(snapshot(result('partial', '', { call: null, callTime: null }),
    result('reversed', 'read_file', { time: 800 }), result('timed', 'read_file')))
  expect(rows[0]).toEqual({ tool: 'read_file', calls: 2, completed: 2, failed: 0, active: 0, averageDuration: 120 })
  expect(rows[1]).toEqual({ tool: '', calls: 1, completed: 1, failed: 0, active: 0 })
  expect(toolStatistics(undefined)).toEqual([])
})

it('replaces an active occurrence with its result and counts argument preparation as active', () => {
  const preparing: ToolCallBlock = { callId: 'pending', name: 'shell', phase: 'preparing',
    args: PartialArguments.EMPTY, time: 2000, turn: 0, step: 1, subCalls: [] }
  expect(toolStatistics(snapshot(preparing))[0]?.active).toBe(1)
  expect(toolStatistics(snapshot(result('pending', 'shell'), preparing))[0])
    .toEqual({ tool: 'shell', calls: 1, completed: 1, failed: 0, active: 0, averageDuration: 120 })
})
