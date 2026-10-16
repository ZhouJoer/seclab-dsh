/** Logged snapshots survive projection reloads, expiry and surface replacement. @module */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it, onTestFinished, vi } from 'vitest'
import { installTaskContext } from '../src/task-context-projection.ts'
import type { TaskContext } from '../src/task-context.ts'
import type { EngagementId } from '../src/workbench/model.ts'

it('replays committed state after remount, restores compacted context, and records expiry and clearing once', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('context-projection'))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10)
  onTestFinished(() => { clock.mockRestore() })
  let current: { projectId: EngagementId | null; context: TaskContext | undefined } = {
    projectId: brandString<EngagementId>('project'),
    context: { authorization: { basis: 'Owner', scope: 'Sample', allowedActions: 'Read', restrictions: 'No execution', expiresAt: 100 }, background: 'Background' },
  }
  let candidate: (agent: Agent) => UserMessage | undefined = () => undefined
  const mount = () => ctx.plugin({ inject: ['sessionProjections'], apply(scoped: Context) { candidate = installTaskContext(scoped, () => current, 4096) } })
  let fiber = await mount()
  expect(ctx.sessionProjections.stateOf(agent.session, 'securityTaskContext')?.latest).toBeNull()
  const first = candidate(agent)!
  expect(first).toBeDefined()
  expect(candidate(agent)).toBeDefined()
  const saved = agent.session.append('user/message', first, { surfaceOp: 'append' })
  expect(candidate(agent)).toBeUndefined()
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Progress' }] }), { surfaceOp: 'append' })
  expect(candidate(agent)).toBeUndefined()
  await fiber.dispose()
  expect(ctx.sessionProjections.stateOf(agent.session, 'securityTaskContext')).toBeUndefined()
  fiber = await mount()
  expect(candidate(agent)).toBeUndefined()
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Summary' }] }), {
    surfaceOp: { op: 'replace', startSeq: saved.seq, endSeq: saved.seq }, sourceEventSeqs: [saved.seq],
  })
  const restored = candidate(agent)!
  expect(restored.content).toEqual(first.content)
  agent.session.append('user/message', restored, { surfaceOp: 'append' })
  expect(candidate(agent)).toBeUndefined()
  clock.mockReturnValue(100)
  const expired = candidate(agent)!
  expect(JSON.stringify(expired.content)).toContain('expired')
  agent.session.append('user/message', expired, { surfaceOp: 'append' })
  clock.mockReturnValue(200)
  expect(candidate(agent)).toBeUndefined()
  current = { projectId: null, context: undefined }
  const cleared = candidate(agent)!
  expect(cleared.source).toMatchObject({ context: null, projectId: null })
  agent.session.append('user/message', cleared, { surfaceOp: 'append' })
  expect(candidate(agent)).toBeUndefined()
  await fiber.dispose()
})

it('does not manufacture an empty context for a new conversation', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('empty-context'))
  const project = installTaskContext(ctx, () => ({ projectId: null, context: undefined }), 4096)
  expect(project(agent)).toBeUndefined()
})
