/** Skill attribution follows task snapshots and committed outcomes, not execution order guesses. @module */
import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { EngagementId } from '../src/workbench/model.ts'
import { projectSkillUsage } from '../src/skill-usage.ts'

function call(seq: number, id: string): SessionEvent<'tool/call'> {
  return { type: 'tool/call', seq: SessionSeq(seq), time: 0,
    data: { turn: 0, step: 0, callId: ToolCallId(id), name: 'skill', arguments: '{"name":"security-native"}' } }
}
function result(seq: number, id: string, failed = false): SessionEvent<'tool/result'> {
  return { type: 'tool/result', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: { turn: 0, step: 0, message: createToolResultMessage({ callId: ToolCallId(id),
      content: [{ type: 'text', text: 'Native instructions' }], isError: failed }) } }
}
function task(seq: number, id: string | null): SessionEvent<'user/message'> {
  return { type: 'user/message', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: createUserMessage({ source: { kind: 'security-task-context', form: 'snapshot', sections: [],
      projectId: id === null ? null : brandString<EngagementId>(id), context: null }, content: [{ type: 'text', text: 'Task' }] }) }
}
it('excludes fork prefixes, pairs results to the task at call admission and distinguishes failed reads', () => {
  const events: SessionEvent[] = [task(0, 'old'), call(1, 'parent'), result(2, 'parent'), task(3, 'new'), call(4, 'own'),
    task(5, 'other'), result(6, 'own'), call(7, 'other'), result(8, 'other', true)]
  const first = projectSkillUsage(events, 3, 'child', 'new')
  expect(first.items).toHaveLength(1)
  expect(first.items[0]).toMatchObject({ name: 'security-native', modelReads: 1, failedReads: 0, sequences: [4] })
  expect(first.items[0]?.contentSha256).toMatch(/^[a-f0-9]{64}$/u)
  expect(projectSkillUsage(events, 3, 'child', 'old').items).toEqual([])
  expect(projectSkillUsage(events, 3, 'child', 'other').items[0]?.failedReads).toBe(1)
  expect(projectSkillUsage(events, 3, 'child', 'new')).toEqual(first)
})
it('reports unknown historical attribution and counts explicit injection without a model tool call', () => {
  expect(projectSkillUsage([call(0, 'x'), result(1, 'x')], 0, 's', 'p').unattributedReads).toBe(1)
  const event: SessionEvent<'user/message'> = { type: 'user/message', seq: SessionSeq(0), time: 0, surfaceOp: 'append',
    data: createUserMessage({ source: { kind: 'skill-invocation', form: 'instructions', name: 'security-native' },
      content: [{ type: 'text', text: 'Native instructions' }] }) }
  expect(projectSkillUsage([event], 0, 's', 'p', 'p').items[0]).toMatchObject({ explicitReads: 1, modelReads: 0 })
  expect(projectSkillUsage([call(0, 'pending')], 0, 's', 'p', 'p').items).toEqual([])
})
