import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Llm, { createUserMessage, HarnessError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { installOutputRecovery } from '@deepseek-ai/dsh-helper'
import { MockAdapter, textResponse, maxTokensResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { HANDOFF_CORRECTION_SUMMARY, installHandoffDelivery } from './handoff-runtime.mjs'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const user = (body: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: body }] })
const claim = 'Verified: every row is even.'
const replacement = 'Only the three sampled rows are even; population coverage remains unverified.'
const verdict = { status: 'reviewed', decision: 'correct', rationale: 'The measurement covers a sample.',
  evidenceRefs: ['source-result'], corrections: [{ claim, replacement, evidenceRefs: ['source-result'] }] }

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], recovery = false) {
  const artifacts = resolve('.dsh/flare-context-study/direction-review/artifacts')
  await mkdir(artifacts, { recursive: true })
  const root = await mkdtemp(join(artifacts, 'handoff-runtime-'))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  let controller: ReturnType<typeof installHandoffDelivery> | undefined
  const hooks = { enabled: true, autoQueue: true, executed: 0,
    beforeQueue: undefined as undefined | (() => Promise<void>) }
  const owner = { name: 'handoff-fixture', inject: ['agents'], apply(scope: Context) {
    scope.on('agent/created', ({ agent }) => {
      controller = installHandoffDelivery(agent, { canDeliver: () => hooks.enabled })
      if (recovery) {
        const output = installOutputRecovery(agent, { reasoningEffort: 'low', maxTokens: 8192, resetOnUserInput: true })
        scope.effect(() => () => output.dispose())
      }
    })
    scope.on('agent/turn-stopping', async ({ agent, signal }) => {
      if (!hooks.autoQueue || !controller || controller.hasAttempt) return
      const events = agent.session.snapshotEvents()
      const latest = events.findLast(event => event.type === 'assistant/message')
      const latestUser = events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
      await hooks.beforeQueue?.()
      if (latest && latestUser) await controller.queue({ answerSeq: latest.seq, userSeq: latestUser.seq }, verdict, signal)
    })
    scope.effect(() => () => controller?.dispose())
  } }
  const modules = { llm: Llm, sessions: Sessions, projections: Projections, prompt: SystemPrompt,
    tools: Tools, agents: Agents, loop: AgentLoop, correction: owner }
  for (const [key, module] of Object.entries(modules)) ctx.loader.builtins[key] = module
  const config = Object.keys(modules).map(name => ({ id: name, name: 'cordis:' + name, config: name === 'loop' ? { agents: [] } : {} }))
  const file = join(root, 'cordis.yml')
  await writeFile(file, JSON.stringify(config))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  const adapter = new MockAdapter(script, { efforts: ['high', 'low'].map(id => ({ id: ReasoningEffortId(id), name: id })) })
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('handoff-main'), { provider: 'mock', model: 'main',
    reasoningEffort: ReasoningEffortId('high'), maxTokens: 32768 }, { cwd: root })
  const errors: Array<{ code?: string; message: string }> = []
  agent.ctx.on('agent/error', ({ error }) => errors.push({ code: error instanceof HarnessError ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error) }))
  agent.ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'Read the next record.', parameters: {},
    execute: async () => { hooks.executed++; return [{ type: 'text', text: 'row=7' }] } }))
  const entry = [...ctx.loader.entries()].find(item => item.options.name === 'cordis:correction')
  if (!entry?.fiber || !controller) throw new Error('Missing handoff fixture')
  return { ctx, agent, adapter, controller, hooks, errors, fiber: entry.fiber,
    start: () => agent.followup(user('Inspect the catalog.')) }
}
type Fixture = Awaited<ReturnType<typeof setup>>
const ends = (f: Fixture) => f.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)
const notices = (f: Fixture) => f.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
  && event.data.source.kind === 'helper-checkpoint' && event.data.source.summary === HANDOFF_CORRECTION_SUMMARY)
const packet = (f: Fixture) => {
  const events = f.agent.session.snapshotEvents()
  return { answerSeq: events.findLast(event => event.type === 'assistant/message')!.seq,
    userSeq: events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')!.seq }
}
const noticeText = (f: Fixture) => notices(f).map(event => event.type === 'user/message'
  ? event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '').join('\n')

describe('host research handoff appendix through Loader', () => {
  it('logs source-linked advice once, preserves the answer and makes no correction request', async () => {
    const f = await setup([textResponse(claim), textResponse('New task accepted.')], true)
    f.start(); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(1)
    expect(ends(f)).toEqual(['completed'])
    expect(f.errors).toEqual([])
    expect(f.hooks.executed).toBe(0)
    expect(f.controller.hasAttempt).toBe(true)
    expect(f.controller.isActive).toBe(false)
    expect(notices(f)).toHaveLength(1)
    expect(notices(f)[0]).toMatchObject({ surfaceOp: 'append', sourceEventSeqs: [packet(f).userSeq, packet(f).answerSeq] })
    expect(noticeText(f)).toContain(replacement)
    expect(noticeText(f)).toContain('依据引用：["source-result"]')
    expect(noticeText(f)).toContain('不是新实验结果')
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1)?.data.message.content)
      .toEqual([{ type: 'text', text: claim }])
    f.hooks.autoQueue = false
    f.agent.followup(user('Continue from the source.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(2)
    expect(f.adapter.requests[1]).toMatchObject({ reasoningEffort: 'high', maxTokens: 32768 })
    expect(f.adapter.requests[1]!.tools?.some(tool => tool.name === 'probe')).toBe(true)
    expect(JSON.stringify(f.adapter.requests[1]!.messages)).toContain(replacement)
    expect(f.controller.hasAttempt).toBe(false)
  })

  it('retains punctuation and quoted text as review data without requiring a model to repeat it', async () => {
    const f = await setup([textResponse(claim)])
    f.hooks.autoQueue = false
    f.start(); await f.agent.whenIdle()
    const qualified = 'Measured "3" rows；the remaining rows are UNVERIFIED—not a failed measurement.'
    await f.controller.queue(packet(f), { ...verdict, corrections: [{ claim, replacement: qualified, evidenceRefs: ['source-result'] }] })
    expect(noticeText(f)).toContain(JSON.stringify(qualified))
    expect(f.adapter.requests).toHaveLength(1)
    expect(f.errors).toEqual([])
    expect(ends(f)).toEqual(['completed'])
  })

  it.each(['invalid-json', 'empty', 'truncated'] as const)('keeps an %s review explicitly unreviewed without generating a replacement answer', async mode => {
    const f = await setup([textResponse(claim)])
    f.hooks.autoQueue = false
    f.start(); await f.agent.whenIdle()
    await f.controller.queue(packet(f), { status: 'unreviewed', message: mode })
    expect(noticeText(f)).toContain('关键解释仍未核验')
    expect(noticeText(f)).toContain(mode)
    expect(noticeText(f)).not.toContain('复核建议：')
    expect(f.adapter.requests).toHaveLength(1)
    expect(ends(f)).toEqual(['completed'])
  })

  it('rejects stale answers, canceled signals, disabled delivery and allow verdicts', async () => {
    const f = await setup([textResponse(claim)])
    f.hooks.autoQueue = false
    f.start(); await f.agent.whenIdle()
    expect(await f.controller.queue({ ...packet(f), answerSeq: -1 }, verdict)).toBe(false)
    expect(await f.controller.queue({ ...packet(f), userSeq: -1 }, verdict)).toBe(false)
    expect(await f.controller.queue(packet(f), verdict, AbortSignal.abort())).toBe(false)
    f.hooks.enabled = false
    expect(await f.controller.queue(packet(f), verdict)).toBe(false)
    f.hooks.enabled = true
    expect(await f.controller.queue(packet(f), { ...verdict, decision: 'allow', corrections: [] })).toBe(false)
    expect(notices(f)).toEqual([])
    expect(f.controller.hasAttempt).toBe(false)
  })

  it('does not use a truncated original answer as an appendix target', async () => {
    const f = await setup([maxTokensResponse(claim)])
    f.hooks.autoQueue = false
    f.start(); await f.agent.whenIdle()
    expect(await f.controller.queue(packet(f), verdict)).toBe(false)
    expect(notices(f)).toEqual([])
  })

  it('reconstructs delivery after reinstall and suppresses concurrent duplicate calls', async () => {
    const f = await setup([textResponse(claim)])
    f.hooks.autoQueue = false
    f.start(); await f.agent.whenIdle()
    expect(await Promise.all([f.controller.queue(packet(f), verdict), f.controller.queue(packet(f), verdict)])).toEqual([true, false])
    await f.controller.dispose()
    const replacementController = installHandoffDelivery(f.agent, { canDeliver: () => true })
    cleanup.push(() => replacementController.dispose())
    expect(replacementController.hasAttempt).toBe(true)
    expect(await replacementController.queue(packet(f), verdict)).toBe(false)
    expect(notices(f)).toHaveLength(1)
    expect(f.adapter.requests).toHaveLength(1)
  })

  it('removes only its legacy pending model-delivery request on reinstall', async () => {
    const f = await setup([textResponse(claim), textResponse('Continued with the new request.')])
    f.hooks.autoQueue = false
    f.start(); await f.agent.whenIdle()
    await f.controller.dispose()
    f.agent.inject(createUserMessage({ source: { kind: 'helper-checkpoint', form: 'notice', summary: HANDOFF_CORRECTION_SUMMARY },
      content: [{ type: 'text', text: JSON.stringify({ kind: 'handoff-correction', version: 1, ...packet(f),
        instruction: 'LEGACY_MODEL_REWRITE', corrections: [{ claim, replacement }], anchors: [replacement], appendix: replacement,
        originalConfig: { provider: 'mock', model: 'main', reasoningEffort: 'high', maxTokens: 32768 } }) }] }))
    const other = createUserMessage({ source: { kind: 'helper-checkpoint', form: 'notice', summary: 'Other owner context' },
      content: [{ type: 'text', text: 'Retain this unrelated context.' }] })
    f.agent.inject(other)
    const replacementController = installHandoffDelivery(f.agent, { canDeliver: () => true })
    cleanup.push(() => replacementController.dispose())
    expect(f.agent.inbox.nextStep.map(message => message.id)).toEqual([other.id])
    expect(f.adapter.requests).toHaveLength(1)
    f.agent.followup(user('Continue.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(2)
    expect(JSON.stringify(f.adapter.requests[1]!.messages)).not.toContain('LEGACY_MODEL_REWRITE')
    expect(JSON.stringify(f.adapter.requests[1]!.messages)).toContain('Retain this unrelated context.')
  })

  it.each(['steer', 'cancel', 'unload'] as const)('does not publish stale advice after %s while review is pending', async action => {
    const f = await setup([textResponse(claim), textResponse('New task accepted.')])
    const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
    f.hooks.beforeQueue = async () => { entered.resolve(); await released.promise }
    f.start(); await entered.promise
    f.hooks.autoQueue = false
    if (action === 'steer') f.agent.steer(user('Use the new dataset.'))
    else if (action === 'cancel') f.agent.cancel({ kind: 'user' })
    else await f.fiber.dispose()
    released.resolve(); await f.agent.whenIdle()
    expect(notices(f)).toEqual([])
    expect(f.adapter.requests).toHaveLength(action === 'steer' ? 2 : 1)
    expect(f.agent.inbox.nextStep).toEqual([])
    expect(f.agent.inbox.nextTurn).toEqual([])
    if (action !== 'steer') {
      f.agent.followup(user('New task after stopping.')); await f.agent.whenIdle()
      expect(f.adapter.requests).toHaveLength(2)
    }
    expect(f.adapter.requests.at(-1)).toMatchObject({ reasoningEffort: 'high', maxTokens: 32768 })
    expect(f.adapter.requests.at(-1)!.tools?.some(tool => tool.name === 'probe')).toBe(true)
  })

  it('preserves human steering arriving after the appendix commits at the stop boundary', async () => {
    const f = await setup([textResponse(claim), textResponse('The new request is retained.')])
    f.agent.ctx.on('agent/turn-stopping', () => {
      if (!f.hooks.autoQueue || notices(f).length === 0) return
      f.hooks.autoQueue = false
      f.agent.steer(user('Inspect a different input.'))
    })
    f.start(); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(2)
    expect(JSON.stringify(f.adapter.requests[1]!.messages)).toContain('Inspect a different input.')
    expect(notices(f)).toHaveLength(1)
    expect(f.errors).toEqual([])
  })

  it('reports persistence failure without claiming delivery or requesting a retry from the model', async () => {
    const f = await setup([textResponse(claim)])
    const append = f.agent.session.append.bind(f.agent.session)
    vi.spyOn(f.agent.session, 'append').mockImplementation((...args) => {
      if (args[0] === 'user/message' && args[1].source.kind === 'helper-checkpoint') throw new Error('Synthetic append failure')
      return append(...args)
    })
    f.start(); await f.agent.whenIdle()
    expect(ends(f)).toEqual(['error'])
    expect(f.errors).toMatchObject([{ message: 'Synthetic append failure' }])
    expect(f.controller.hasAttempt).toBe(false)
    expect(notices(f)).toEqual([])
    expect(f.adapter.requests).toHaveLength(1)
  })
})
