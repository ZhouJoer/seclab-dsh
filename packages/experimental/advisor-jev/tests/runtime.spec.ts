import { startJevFixture } from './http-fixture.ts'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import Fs from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import Subagents from '@deepseek-ai/dsh-subagent'
import Helper from '@deepseek-ai/dsh-helper'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Jev from '../src/index.ts'
import type { Config } from '../src/config.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

function reply(choice = 'consult_advisor', confidence = 0.99) {
  return { model: 'jev-fixture', answers: { route: { type: 'choice', choice, confidence,
    probabilities: Object.fromEntries(['continue', 'consult_advisor', 'insufficient_evidence', 'external_blocker'].map(key => [key, key === choice ? 1 : 0])),
  } }, usage: { input_tokens: 100, output_tokens: 10 } }
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], response: unknown = reply(), options: Partial<Config> = {}) {
  const { requests, received, release, url: endpoint, close } = await startJevFixture(response)
  cleanup.push(close)
  const root = await mkdtemp(join(tmpdir(), 'dsh-advisor-jev-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = { llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, fs: Fs, 'working-directory': WorkingDirectory, subagents: Subagents,
    helper: Helper, 'agent-loop': AgentLoop, jev: Jev }
  for (const [key, value] of Object.entries(modules)) ctx.loader.builtins[key] = value
  const fixture = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  const config = { enabled: true, endpoint, apiKey: 'fixture-only', minToolSteps: 3, checkEverySteps: 3, ...options }
  const file = join(root, 'cordis.yml')
  await writeFile(file, fixture + `\n- name: cordis:jev\n  config: ${JSON.stringify(config)}\n`)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('jev-parent'), { provider: 'mock', model: 'main' }, { cwd: root })
  agent.ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'Probe the obstacle', parameters: {},
    execute: async () => [{ type: 'text', text: 'Same failure; no new evidence.' }] }))
  const start = () =>{  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Find the cause of the failed probe.' }], source: { kind: 'user' } })) }
  return { ctx, agent, adapter, requests, received, release, start }
}
const attempts = () => [1, 2, 3].map(index => toolCallResponse(`probe-${index}`, 'probe', {}))

describe('automatic Advisor through Loader composition', () => {
  it('records the Jev request, consults once, and admits advice before the next main request', async () => {
    const fixture = await setup([...attempts(), textResponse('Verify the original input bytes.'), textResponse('I will verify the input bytes.')])
    fixture.start()
    await fixture.agent.whenIdle()
    expect(fixture.requests).toHaveLength(1)
    const state = fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')!
    expect(state.calls).toMatchObject([{ status: 'completed', answer: 'Verify the original input bytes.', backend: 'api' }])
    expect(state.calls[0]?.callId).toBeUndefined()
    expect(fixture.adapter.requests.map(request => request.model)).toEqual(['main', 'main', 'main', 'expert', 'main'])
    expect(JSON.stringify(fixture.adapter.requests.at(-1)?.messages)).toContain('Verify the original input bytes.')
    expect(fixture.agent.session.snapshotEvents().filter(event => event.type.startsWith('advisor-jev/')).map(event => event.type)).toEqual(['advisor-jev/start', 'advisor-jev/end'])
    expect(JSON.stringify(fixture.agent.session.snapshotEvents())).not.toContain('fixture-only')
  })

  it.each(['continue', 'insufficient_evidence', 'external_blocker'])('does not consult for %s', async (choice) => {
    const fixture = await setup([...attempts(), textResponse('Continue.')], reply(choice))
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
  })

  it('leaves disabled installations inert', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue.')], reply(), { enabled: false, apiKey: '' })
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.requests).toEqual([])
  })

  it('does not consult on low confidence', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue.')], reply('consult_advisor', 0.2))
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
  })

  it('requires the consultation probability threshold independently of confidence', async () => {
    const response = reply()
    response.answers.route.probabilities = { continue: 0.3, consult_advisor: 0.4, insufficient_evidence: 0.2, external_blocker: 0.1 }
    const fixture = await setup([...attempts(), textResponse('Continue.')], response)
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
  })

  it('rejects invalid probability totals before routing', async () => {
    const response = reply()
    response.answers.route.probabilities.continue = 0.5
    const fixture = await setup([...attempts(), textResponse('Continue.')], response)
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'error', code: 'invalid-response' })
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
  })

  it('bounds the response body before parsing', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue.')], reply(), { maxResponseBytes: 16 })
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'error', code: 'response-too-large' })
  })

  it('logs Advisor failure and continues after child cleanup', async () => {
    const fixture = await setup([...attempts(), () => { throw new Error('Expert unavailable') }, textResponse('Continue manually.')])
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toMatchObject([{ status: 'error' }])
    expect(JSON.stringify(fixture.adapter.requests.at(-1)?.messages)).toContain('Automatic Advisor consultation failed')
    expect(fixture.adapter.requests.at(-1)?.model).toBe('main')
  })

  it('enforces the per-turn automatic consultation limit after further failed steps', async () => {
    const fixture = await setup([...attempts(), textResponse('Check the input.'),
      ...[4, 5, 6].map(index => toolCallResponse(`probe-${index}`, 'probe', {})), textResponse('Continue.')])
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toHaveLength(1)
  })

  it('times out a pending request and reports that the assessment is unavailable', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue manually.')], 'wait', { timeoutMs: 50 })
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'error', code: 'timeout' })
  })

  it('records packing failures and respects the interval before trying again', async () => {
    const fixture = await setup([...attempts(), toolCallResponse('probe-4', 'probe', {}), textResponse('Continue.')], reply(), { maxRequestBytes: 1 })
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.requests).toEqual([])
    expect(fixture.agent.session.snapshotEvents().filter(event => event.type === 'advisor-jev/start')).toHaveLength(1)
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'error', code: 'input-too-large' })
  })

  it('supersedes an outstanding decision when the human steers the task', async () => {
    const fixture = await setup([...attempts(), textResponse('Proceed with the new task.'), textResponse('Done.')], 'wait')
    fixture.start(); await fixture.received.promise
    fixture.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'The failure was expected; stop investigating it.' }], source: { kind: 'user' } }))
    fixture.release.resolve(undefined); await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'superseded' })
  })

  it('cancels assessment when Advisor is disabled without stopping ordinary execution', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue.')], 'wait')
    fixture.start(); await fixture.received.promise
    fixture.agent.session.append('helper/policy', { enabled: false, mode: 'normal' })
    await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'aborted' })
  })

  it('reports malformed decisions without treating them as progress or calling Advisor', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue manually.')], { answers: {} })
    fixture.start(); await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
    expect(JSON.stringify(fixture.adapter.requests.at(-1)?.messages)).toContain('invalid-response')
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'error', code: 'invalid-response' })
  })

  it('cancels an outstanding decision before it can start Advisor', async () => {
    const fixture = await setup(attempts(), 'wait')
    fixture.start(); await fixture.received.promise
    fixture.agent.cancel({ kind: 'user' })
    await fixture.agent.whenIdle()
    fixture.release.resolve(undefined)
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
    expect(fixture.agent.session.snapshotEvents().find(event => event.type === 'advisor-jev/end')?.data).toMatchObject({ status: 'aborted' })
  })

  it('unloads and joins a pending decision without injecting late advice', async () => {
    const fixture = await setup([...attempts(), textResponse('Continue.')], 'wait')
    fixture.start(); await fixture.received.promise
    const entry = [...fixture.ctx.loader.entries()].find(item => item.options.name === 'cordis:jev')!
    await entry.fiber!.dispose()
    fixture.release.resolve(undefined)
    await fixture.agent.whenIdle()
    expect(fixture.ctx.sessionProjections.stateOf(fixture.agent.session, 'helper')?.calls).toEqual([])
    expect(fixture.requests).toHaveLength(1)
  })
})
