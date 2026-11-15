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
import Llm, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, maxTokensResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import * as Delivery from './delivery.mjs'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], otherWorkspace = false) {
  const artifacts = resolve('.dsh/flare-context-study/direction-review/artifacts')
  await mkdir(artifacts, { recursive: true })
  const root = await mkdtemp(join(artifacts, 'delivery-'))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = { llm: Llm, sessions: Sessions, projections: Projections, prompt: SystemPrompt,
    tools: Tools, agents: Agents, loop: AgentLoop, delivery: Delivery }
  for (const [key, module] of Object.entries(modules)) ctx.loader.builtins[key] = module
  const config = Object.keys(modules).map(name => ({ id: name, name: 'cordis:' + name,
    config: name === 'loop' ? { agents: [] } : name === 'delivery'
      ? { enabled: true, workspace: root, primaryMaxTokens: 32768, recoveryReasoningEffort: 'low', recoveryMaxTokens: 8192 } : {} }))
  const file = join(root, 'cordis.yml')
  await writeFile(file, JSON.stringify(config))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  const adapter = new MockAdapter(script, { efforts: ['high', 'low'].map(id => ({ id: ReasoningEffortId(id), name: id })) })
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('delivery-main'), {
    provider: 'mock', model: 'main', reasoningEffort: ReasoningEffortId('high'), maxTokens: 131072,
  }, { cwd: otherWorkspace ? join(root, 'other') : root })
  agent.ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'Read a control', parameters: {},
    execute: async () => [{ type: 'text', text: 'control' }] }))
  const save = async () => {
    await writeFile(join(root, 'events.json'), JSON.stringify(agent.session.snapshotEvents(), null, 2))
    await writeFile(join(root, 'requests.json'), JSON.stringify(adapter.requests, (_key, value) => value instanceof AbortSignal ? undefined : value, 2))
  }
  cleanup.push(save)
  return { ctx, agent, adapter }
}
const ends = (f: Awaited<ReturnType<typeof setup>>) => f.agent.session.snapshotEvents()
  .filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)

describe('main-agent bounded output delivery through Loader', () => {
  it('retains the truncated turn and restores ordinary limits for the next human task', async () => {
    const f = await setup([maxTokensResponse('Unfinished analysis'), textResponse('Verified: one control. Remaining: one measurement.'), textResponse('New task complete.')])
    f.agent.followup(user('Inspect the fixture.')); await f.agent.whenIdle()
    expect(ends(f)).toEqual(['max-tokens', 'completed'])
    expect(f.adapter.requests.map(r => [r.reasoningEffort, r.maxTokens])).toEqual([['high', 32768], ['low', 8192]])
    expect(f.adapter.requests[1]!.tools ?? []).toEqual([])
    expect(f.adapter.requests[1]!.messages.some(message => message.source.kind === 'helper-output-recovery')).toBe(true)
    f.agent.followup(user('Start a new task.')); await f.agent.whenIdle()
    expect(f.adapter.requests[2]).toMatchObject({ reasoningEffort: 'high', maxTokens: 32768 })
    expect(f.adapter.requests[2]!.tools?.some(tool => tool.name === 'probe')).toBe(true)
  })

  it.each([['length-empty', maxTokensResponse('')], ['completed-empty', textResponse('')]] as const)('recovers %s only once', async (_name, first) => {
    const f = await setup([[...first], textResponse('No conclusion is established; run the discriminating check.')])
    f.agent.followup(user('Report observations.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(2)
    expect(f.adapter.requests[1]).toMatchObject({ reasoningEffort: 'low', maxTokens: 8192 })
    expect(ends(f).at(-1)).toBe('completed')
  })

  it('stops after a second truncated delivery', async () => {
    const f = await setup([maxTokensResponse('Old partial'), maxTokensResponse('Still partial')])
    f.agent.followup(user('Report observations.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(2)
    expect(ends(f)).toEqual(['max-tokens', 'max-tokens'])
  })

  it('uses finish reason instead of equating usage with the output limit', async () => {
    const answer = textResponse('The measurement is complete.').map(chunk => chunk.type === 'usage'
      ? { ...chunk, usage: { inputTokens: 10, outputTokens: 32768 } } : chunk)
    const f = await setup([answer])
    f.agent.followup(user('Report observations.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(1)
    expect(ends(f)).toEqual(['completed'])
  })

  it('gives already queued human input priority over recovery', async () => {
    const f = await setup([() => {
      f.agent.followup(user('Replace the task with this request.'))
      return maxTokensResponse('Superseded partial')
    }, textResponse('The replacement task is complete.')])
    f.agent.followup(user('Original task.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(2)
    expect(f.adapter.requests[1]).toMatchObject({ reasoningEffort: 'high', maxTokens: 32768 })
    expect(f.adapter.requests[1]!.messages.some(message => message.source.kind === 'helper-output-recovery')).toBe(false)
  })

  it('leaves other workspaces outside the configured cap and recovery', async () => {
    const f = await setup([maxTokensResponse('Outside workspace')], true)
    f.agent.followup(user('Report observations.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(1)
    expect(f.adapter.requests[0]!.maxTokens).toBe(131072)
  })

  it.each(['normal', 'recovered'] as const)('restores the pre-cap limit after unloading following a %s response', async mode => {
    const script = mode === 'recovered'
      ? [maxTokensResponse('Partial findings'), textResponse('Available findings delivered.')]
      : [textResponse('Initial task completed.')]
    const f = await setup([...script, textResponse('New task completed.')])
    f.agent.followup(user('Inspect the fixture.')); await f.agent.whenIdle()
    expect(f.adapter.requests[0]).toMatchObject({ reasoningEffort: 'high', maxTokens: 32768 })
    const delivery = [...f.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:delivery')
    if (!delivery?.fiber) throw new Error('Missing delivery plugin fixture')
    await delivery.fiber.dispose()
    f.agent.followup(user('Continue after removing the delivery policy.')); await f.agent.whenIdle()
    expect(f.adapter.requests).toHaveLength(script.length + 1)
    expect(f.adapter.requests.at(-1)).toMatchObject({ reasoningEffort: 'high', maxTokens: 131072 })
    expect(f.adapter.requests.at(-1)?.tools?.some(tool => tool.name === 'probe')).toBe(true)
  })

  it('does not install restoration hooks after the main agent scope has been disposed', async () => {
    const f = await setup([textResponse('Initial task completed.')])
    f.agent.followup(user('Inspect the fixture.')); await f.agent.whenIdle()
    const warn = vi.spyOn(f.ctx.logger, 'warn').mockImplementation(() => undefined)
    const register = vi.spyOn(f.agent.ctx, 'on')
    cleanup.push(async () => { register.mockRestore(); warn.mockRestore() })
    const loop = [...f.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:loop')
    if (!loop?.fiber) throw new Error('Missing agent loop fixture')
    await loop.fiber.dispose()
    expect(f.agent.ctx.fiber.uid).toBeNull()
    expect(f.ctx.agents.get(f.agent.id)).toBeUndefined()
    expect(register).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
