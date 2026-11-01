import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { defineContentToolFixture, type PostToolDecision } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Helper from '../src/index.ts'
import { helperProjection } from '../src/projection.ts'
import type { ConsultationId, HelperState } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], enabled = true, effort = 'high', backend: 'api' | 'codex' = 'api') {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SubagentRuntime)
  const adapter = new MockAdapter(script, { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] })
  ctx.llm.registerAdapter(['mock'], adapter)
  const helper = await ctx.plugin(Helper, { enabled, backend, provider: 'mock', model: 'expert', reasoningEffort: effort })
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'flash' }, { cwd: process.cwd() })
  const invoke = (signal = new AbortController().signal, callId = ToolCallId('helper-1')) => parent.ctx.tools.execute({ name: 'advisor',
    callId, arguments: { reason: 'uncertain', question: 'Inspect evidence', attempts: 'read logs', context: 'README.md' }, agent: parent, signal })
  return { ctx, parent, adapter, invoke, helper }
}

describe('Helper consultations', () => {
  it('preserves manual concurrency while refusing an overlapping automatic consultation', async () => {
    const { ctx, parent, invoke } = await setup(['hang', textResponse('second advice')])
    await ctx.commands.execute(parent, '/advisor proactive', [], new AbortController().signal)
    const started = Promise.withResolvers<undefined>()
    ctx.on('session/event', (session, event) => {
      if (session.header.parentSession === parent.id && event.type === 'request/header') started.resolve(undefined)
    })
    const abort = new AbortController()
    const pending = invoke(abort.signal)
    try {
      await started.promise
      await expect(ctx.helper.consultAutomatically({ reason: 'stalled', question: 'Inspect.' }, parent,
        abort.signal, brandString<ConsultationId>('automatic-overlap'))).rejects.toThrow('already running')
      const second = await invoke(new AbortController().signal, ToolCallId('helper-2'))
      expect(second.isError).not.toBe(true)
      expect(second.content).toEqual([{ type: 'text', text: 'second advice' }])
      expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.calls.map(call => call.status)).toEqual(['running', 'completed'])
    } finally {
      abort.abort()
      await pending
    }
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it('starts disabled and persists session overrides independently of model defaults', async () => {
    const { ctx, parent, helper } = await setup([], false)
    parent.ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'probe', parameters: {},
      execute: async () => [{ type: 'text', text: 'NO_PROGRESS' }] }))
    const probe = () => parent.ctx.tools.execute({ name: 'probe', callId: ToolCallId('probe'),
      arguments: {}, agent: parent, signal: new AbortController().signal })
    expect(parent.ctx.tools.get('advisor', parent)).toBeUndefined()
    expect((await probe()).content).toEqual([{ type: 'text', text: 'NO_PROGRESS' }])
    await ctx.commands.execute(parent, '/helper on', [], new AbortController().signal)
    expect(parent.ctx.tools.get('advisor', parent)).toBeDefined()
    expect((await probe()).additionalContexts).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.mode).toBe('normal')
    const normalDescription = parent.ctx.tools.get('advisor', parent)?.description
    await ctx.commands.execute(parent, '/advisor proactive', [], new AbortController().signal)
    expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.mode).toBe('proactive')
    expect(parent.ctx.tools.get('advisor', parent)?.description).not.toBe(normalDescription)
    const reminded = await probe()
    expect(reminded.content).toEqual([{ type: 'text', text: 'NO_PROGRESS' }])
    expect(reminded.additionalContexts).toMatchObject([
      { source: { kind: 'helper-checkpoint' } },
    ])
    expect((await probe()).additionalContexts).toBeUndefined()
    await ctx.commands.execute(parent, '/advisor normal', [], new AbortController().signal)
    expect((await probe()).additionalContexts).toBeUndefined()
    expect(parent.ctx.tools.get('advisor', parent)?.description).toBe(normalDescription)
    await ctx.commands.execute(parent, '/advisor off', [], new AbortController().signal)
    expect(parent.ctx.tools.get('advisor', parent)).toBeUndefined()
    expect((await probe()).additionalContexts).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.enabled).toBe(false)
    await ctx.commands.execute(parent, '/advisor proactive', [], new AbortController().signal)
    expect((await probe()).additionalContexts).toHaveLength(1)
    await helper.dispose()
    expect(parent.ctx.tools.get('advisor', parent)).toBeUndefined()
    expect((await probe()).additionalContexts).toBeUndefined()
  })

  it('logs one reminder per turn across repeated tool calls', async () => {
    const { ctx, parent } = await setup([
      toolCallResponse('read-one', 'probe', {}), toolCallResponse('read-two', 'probe', {}), textResponse('Partial observation'),
      toolCallResponse('read-three', 'probe', {}), textResponse('Next observation'),
    ])
    await ctx.commands.execute(parent, '/advisor proactive', [], new AbortController().signal)
    parent.ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'Read one observation', parameters: {},
      execute: async () => [{ type: 'text', text: 'Observation' }] }))
    const ask = () => { parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect another observation' }], source: { kind: 'user' } })) }
    const reminders = () => parent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'helper-checkpoint')
    ask()
    await parent.whenIdle()
    expect(reminders()).toHaveLength(1)
    ask()
    await parent.whenIdle()
    expect(reminders()).toHaveLength(2)
  })

  it('uses a fresh high-effort expert, records usage and disposes the child', async () => {
    const { ctx, parent, adapter, invoke } = await setup([textResponse('expert advice')])
    const result = await invoke()
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'expert advice' }])
    expect(result.additionalContexts).toBeUndefined()
    expect(adapter.requests[0]).toMatchObject({ model: 'expert', reasoningEffort: 'high' })
    expect(ctx.agents.list()).toHaveLength(1)
    expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.calls).toEqual([
      expect.objectContaining({ status: 'completed', model: 'expert', reasoningEffort: 'high', backend: 'api',
        usage: { inputTokens: 10, outputTokens: 13 } }),
    ])
  })

  it('preserves downstream feedback and context when adding a progress reminder', async () => {
    const { ctx, parent } = await setup([])
    await ctx.commands.execute(parent, '/advisor proactive', [], new AbortController().signal)
    parent.ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'probe', parameters: {},
      execute: async () => [{ type: 'text', text: 'raw result' }] }))
    const context = createUserMessage({ content: [{ type: 'text', text: 'additional evidence' }], source: { kind: 'user' } })
    ctx.on('tools/post-execute', async (_exec, _result, next): Promise<PostToolDecision> => {
      const decision = await next()
      return { ...decision, kind: 'block', feedback: [{ type: 'text', text: 'needs correction' }],
        additionalContexts: [...decision.additionalContexts ?? [], context] }
    })
    const result = await parent.ctx.tools.execute({ name: 'probe', callId: ToolCallId('probe'),
      arguments: {}, agent: parent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'needs correction' }])
    expect(result.additionalContexts).toHaveLength(2)
    expect(result.additionalContexts).toContainEqual(context)
    expect(result.additionalContexts?.filter(message => message.source.kind === 'helper-checkpoint')).toHaveLength(1)
  })

  it('denies writes and recursive delegation even when the adviser requests hidden tools', async () => {
    const { ctx, parent, adapter, invoke } = await setup([
      toolCallResponse('write-1', 'write', { path: 'file', content: 'bad' }),
      toolCallResponse('recursive-1', 'advisor', { reason: 'recursive', question: 'more' }),
      textResponse('read only advice'),
    ])
    await ctx.commands.execute(parent, '/advisor proactive', [], new AbortController().signal)
    let writes = 0
    parent.ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'write', parameters: {},
      execute: async () => { writes++; return [] } }))
    await invoke()
    expect(writes).toBe(0)
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests.flatMap(request => request.messages)
      .some(message => message.source?.kind === 'helper-checkpoint')).toBe(false)
    expect(adapter.requests[0]?.tools?.some(tool => tool.name === 'write' || tool.name === 'advisor' || tool.name === 'run_code')).not.toBe(true)
  })

  it('reports unsupported effort without issuing inference', async () => {
    const { ctx, parent, adapter, invoke } = await setup([], true, 'ultra')
    const result = await invoke()
    expect(result.isError).toBe(true)
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.calls[0]?.status).toBe('error')
  })

  it('cancels an active consultation and releases its local agent', async () => {
    const { ctx, parent, invoke } = await setup(['hang'])
    const started = Promise.withResolvers<undefined>()
    ctx.on('session/event', (session, event) => {
      if (session.header.parentSession === parent.id && event.type === 'request/header') started.resolve(undefined)
    })
    const abort = new AbortController()
    const pending = invoke(abort.signal)
    await started.promise
    abort.abort()
    await pending
    expect(ctx.agents.list()).toHaveLength(1)
    expect(ctx.sessionProjections.stateOf(parent.session, 'helper')?.calls[0]?.status).toBe('aborted')
  })

  it('keeps statistics idempotent and marks an unfinished restored consultation interrupted', () => {
    const state: HelperState = { enabled: true, mode: 'normal', calls: [] }
    const data = { callId: ToolCallId('call'), backend: 'codex' as const, model: 'expert', startedAt: 10, status: 'running' as const }
    const session = Session.create(SessionId('projection'))
    session.append('helper/start', data)
    session.append('helper/start', data)
    session.append('session/end-seed', {})
    let value = state
    for (const entry of session.snapshotEvents()) value = helperProjection.apply(value, entry)
    expect(value.calls).toHaveLength(1)
    expect(value.calls[0]?.status).toBe('interrupted')
  })

  it('restores the selected mode and reads earlier policies as normal mode', () => {
    const session = Session.create(SessionId('restored-mode'))
    session.append('helper/policy', { enabled: true, mode: 'proactive' })
    let state: HelperState = helperProjection.init()
    for (const event of session.snapshotEvents()) state = helperProjection.apply(state, event)
    expect(state).toMatchObject({ enabled: true, mode: 'proactive' })
    session.append('helper/policy', { enabled: true })
    for (const event of session.snapshotEvents()) state = helperProjection.apply(state, event)
    expect(state).toMatchObject({ enabled: true, mode: 'normal' })
  })
})


it('links the native advisor thread to its parent call without adding model messages', async () => {
  const { ctx, parent, invoke } = await setup([], true, 'high', 'codex')
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'helper-codex', inheritsParentContext: false,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: false },
    start: async () => ({ id: SessionId('native-thread'),
      result: Promise.resolve({ output: [{ type: 'text', text: 'Inspect the observed input.' }], structured: undefined, stopReason: 'completed' }),
      dispose: async () => {},
    }),
  }))
  const before = parent.session.deriveMessages()
  expect((await invoke()).isError).not.toBe(true)
  const records = parent.session.snapshotEvents().filter(record => record?.type === 'helper/codex-trace')
  expect(records).toHaveLength(1)
  expect(records[0]?.data).toMatchObject({ callId: 'helper-1', childSessionId: 'native-thread' })
  expect(parent.session.deriveMessages()).toEqual(before)
})
