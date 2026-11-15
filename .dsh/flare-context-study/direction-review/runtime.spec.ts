import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Llm, { createUserMessage, ReasoningEffortId, ToolCallId, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import { ShellExecutor, type ShellExecRequest, type ShellExecSpec, type ShellExecution, type ShellRunResult } from '@deepseek-ai/dsh-shell'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import Fs from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import Subagents from '@deepseek-ai/dsh-subagent'
import Helper from '@deepseek-ai/dsh-helper'
import { MockAdapter, textResponse, toolCallResponse, maxTokensResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import * as Review from './index.mjs'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const artifacts = resolve('.dsh/flare-context-study/direction-review/artifacts')
const raw = 'ORIGINAL_DATA: sample=(2,4,6), excludedRows=unknown'
class AnalysisPhaseFixture extends Service {
  phase: 'exploring' | 'closing' | 'finalizing' = 'exploring'
  saves = 0
  deliveryGrants: UserMessage[] = []
  beforeView = async () => {}
  assets: Array<{ id: string; engagementId: string; format: 'other'; inputSource: { kind: 'path'; path: string } }> = []
  objective = 'Count odd and even values in the complete supplied dataset.'
  constructor(ctx: Context) { super(ctx, 'securityWorkbench') }
  getAnalysisPhase() { return this.phase }
  prepareAnalysisDelivery(_agent: Agent, message: UserMessage) {
    if (this.phase === 'exploring' || this.deliveryGrants.length) return false
    this.deliveryGrants.push(message)
    return true
  }
  async view() {
    await this.beforeView()
    return { records: [{ kind: 'engagement', value: { objective: this.objective } },
      ...this.assets.map(value => ({ kind: 'asset', value }))] }
  }
  async saveAnalysisCheckpoint() { return { committed: true, revision: ++this.saves } }
}
const shellResult = (overrides: Partial<ShellRunResult> = {}): ShellRunResult => ({ exitCode: 0, signal: null,
  timedOut: false, aborted: false, timeoutMs: 1000, stdout: { text: 'measured=3', truncated: false },
  stderr: { text: '', truncated: false }, ...overrides })
/** The real pwsh consumer runs over explicit executor outcomes, without host timing dependencies. */
class ShellFixture extends ShellExecutor {
  outcome = shellResult()
  requests: ShellExecSpec[] = []
  resolve(request: ShellExecRequest): ShellExecSpec {
    return { ...request, workdir: request.workdir ?? process.cwd(), timeoutMs: request.timeoutMs ?? 1000,
      onExpiry: request.onExpiry ?? 'kill', stdoutMaxBytes: request.stdoutMaxBytes ?? 1000, sandboxPolicy: request.sandboxPolicy }
  }
  async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    this.requests.push(spec)
    const result = this.outcome
    return { status: 'completed', exitCode: result.exitCode, signal: result.signal, done: Promise.resolve(),
      result: () => Promise.resolve(result), readOutput: () => ({ delta: '', lossy: false }), kill: () => false,
      observed: { stdout: { readFrom: fromByte => ({ text: result.stdout.text, nextOffset: fromByte, lossy: false }) },
        stderr: { readFrom: fromByte => ({ text: result.stderr.text, nextOffset: fromByte, lossy: false }) } } }
  }
}
async function setup(script: ConstructorParameters<typeof MockAdapter>[0], overrides: Record<string, unknown> = {}) {
  await mkdir(artifacts, { recursive: true })
  const root = await mkdtemp(join(artifacts, 'premise-'))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = { llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, fs: Fs, 'working-directory': WorkingDirectory, subagents: Subagents,
    helper: Helper, 'agent-loop': AgentLoop, direction: Review, 'analysis-phase': AnalysisPhaseFixture,
    shell: ShellFixture, 'shell-env': ShellEnv, pwsh: ToolPwsh }
  for (const [key, module] of Object.entries(modules)) ctx.loader.builtins[key] = module
  const config = { enabled: true, workspace: root, provider: 'mock', model: 'flash-review',
    checkTools: ['evaluate'], adoptionTools: ['evaluate', 'pwsh'], minConsultationIntervalMs: 0, recoveryEnabled: false,
    adoptionReviewEnabled: false, handoffReviewEnabled: false, ...overrides }
  const plain = ['llm', 'sessions', 'projections', 'system-prompt', 'tools', 'agents', 'fs', 'working-directory', 'subagents', 'shell', 'shell-env', 'pwsh']
  const yaml = plain.map(key => '- name: cordis:' + key).join('\n') + '\n'
    + '- name: cordis:helper\n  config: {enabled: true, mode: proactive, backend: api, provider: mock, model: manual-large, reasoningEffort: max}\n'
    + '- name: cordis:agent-loop\n  config: {agents: []}\n'
    + '- name: cordis:analysis-phase\n'
    + '- name: cordis:direction\n  config: ' + JSON.stringify(config) + '\n'
  const file = join(root, 'cordis.yml')
  await writeFile(file, yaml)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  const adapter = new MockAdapter(script, { efforts: ['low', 'high', 'max'].map(id => ({ id: ReasoningEffortId(id), name: id })) })
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('review-parent'), { provider: 'mock', model: 'main' }, { cwd: root })
  const hooks = { evaluation: 'EXECUTED_CHECK: all three sampled rows pass; population coverage unknown', fail: false,
    withMetadata: true, execution: {} as Partial<ShellRunResult>, onCheck: (_attempt?: number): void | Promise<void> => {}, completions: 0 }
  agent.ctx.tools.register(defineContentToolFixture({ name: 'security_complete', description: 'Declare the original objective completed.',
    parameters: { summary: { type: 'string' }, limitations: { type: 'string' }, results: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, result: { type: 'string' }, toolCallIds: { type: 'array', items: { type: 'string' } },
      evidenceIds: { type: 'array', items: { type: 'string' } },
    }, additionalProperties: false } } }, execute: async () => { hooks.completions++; return [{ type: 'text', text: '{"completed":true}' }] } }))
  agent.ctx.tools.register(defineTool({ name: 'evaluate', description: 'Execute a controlled measurement',
    parameters: { attempt: { type: 'number' } }, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async args => {
      await hooks.onCheck(args.attempt); if (hooks.fail) throw new Error('measurement process failed')
      return hooks.withMetadata ? { kind: 'foreground', ...shellResult({ stdout: { text: hooks.evaluation, truncated: false }, ...hooks.execution }) }
        : { output: hooks.evaluation }
    } }))
  agent.ctx.tools.register(defineTool({ name: 'security_checkpoint', description: 'Save an unverified progress handoff.',
    parameters: { phase: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, reason: { type: 'string' },
      next: { type: 'string' }, evidenceIds: { type: 'array', items: { type: 'string' } }, findingIds: { type: 'array', items: { type: 'string' } } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async () => ({ setupOnly: true }) }))
  agent.ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'Write a complete local analysis script.',
    parameters: { file_path: { type: 'string' }, content: { type: 'string' }, attempt: { type: 'number' } },
    execute: async args => {
      if (args.file_path !== undefined && args.content !== undefined) await writeFile(args.file_path, args.content)
      return [{ type: 'text', text: 'WRITE_COMPLETED' }]
    } }))
  agent.ctx.tools.register(defineTool({ name: 'native_observe', description: 'Read original binary field metadata.',
    parameters: { assetId: { type: 'string' } }, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async () => ({ evidenceId: 'fixture-native-fields', operation: 'inspect.fields', incomplete: false,
      items: [{ field: 'entryWidth', value: 24, unit: 'bytes' }, { field: 'observedEntryCount', value: 3 }] }) }))
  for (const name of ['read_data', 'list_directory', 'remember']) {
    agent.ctx.tools.register(defineContentToolFixture({ name, description: name, parameters: { attempt: { type: 'number' } },
      execute: async () => {
        return [{ type: 'text', text: name === 'read_data' ? raw : 'SETUP_ONLY' }]
      } }))
  }
  const start = () => agent.followup(createUserMessage({ content: [{ type: 'text', text: 'USER_TASK_CANARY. Assess the supplied dataset.' }], source: { kind: 'user' } }))
  cleanup.push(async () => {
    await writeFile(join(root, 'requests.json'), JSON.stringify(adapter.requests.map(r => ({ model: r.model, reasoningEffort: r.reasoningEffort,
      maxTokens: r.maxTokens, tools: r.tools, messages: r.messages })), null, 2))
    await writeFile(join(root, 'events.json'), JSON.stringify(agent.session.snapshotEvents(), null, 2))
  })
  const analysisPhase = ctx.get('securityWorkbench')
  if (!(analysisPhase instanceof AnalysisPhaseFixture)) throw new Error('Missing phase fixture')
  const shell = ctx.get('shell')
  if (!(shell instanceof ShellFixture)) throw new Error('Missing shell fixture')
  return { ctx, agent, adapter, root, start, hooks, analysisPhase, shell }
}
type Fixture = Awaited<ReturnType<typeof setup>>
const calls = (f: Fixture) => f.ctx.sessionProjections.stateOf(f.agent.session, 'helper')!.calls
const baseSteps = () => [toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'evaluate', {})]
function resultRef(f: Fixture, callId: string) {
  const event = f.agent.session.snapshotEvents().find(e => e.type === 'tool/result' && e.data.message.toolCallId === callId)
  if (!event) throw new Error('Missing fixture result ' + callId)
  return 'r' + event.seq
}
function submission(f: Fixture, outcome = 'inconclusive', override: Record<string, unknown> = {}) {
  return { action: 'submit', claim: 'Every row in the population is even.', pendingDecision: 'Exclude odd records from follow-up processing.',
    dependentOperation: { name: 'evaluate', arguments: { attempt: 2 } },
    scope: 'The entire input population, beyond the three sampled rows.', evidenceRefs: [resultRef(f, 'raw')], checkRefs: [resultRef(f, 'check')],
    explanationA: 'The population contains only even values.', expectedA: 'A full scan finds zero odd values.',
    explanationB: 'The sample omits odd values.', expectedB: 'A full scan finds at least one odd value.',
    observed: 'Three sampled values are even, but sample coverage is unknown.', outcome, question: 'Does the sample justify excluding all odd values?', ...override }
}
function responses(f: Fixture) {
  const events = f.agent.session.snapshotEvents()
  const ids = new Set(events.flatMap(e => e.type === 'tool/call' && e.data.name === 'premise_check' ? [e.data.callId] : []))
  return events.filter(e => e.type === 'tool/result' && ids.has(e.data.message.toolCallId) && !e.data.message.isError)
    .map(e => {
      if (e.type !== 'tool/result') throw new Error('Unexpected event')
      return JSON.parse(e.data.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n'))
    })
}
const reviewStarted = (f: Fixture) => {
  const ready = Promise.withResolvers<void>()
  f.ctx.on('session/event', (session, event) => {
    if (session.header.parentSession === f.agent.id && event.type === 'request/header') ready.resolve()
  })
  return ready.promise
}
const projectionFor = (f: Fixture) => {
  const entry = [...f.ctx.loader.entries()].find(e => e.options.name === 'cordis:direction')!
  return { entry, definition: Review.projection(entry.fiber!.config), config: entry.fiber!.config }
}

const adoptionConfig = { adoptionReviewEnabled: true, handoffReviewEnabled: false, adoptionTools: ['evaluate'],
  maxTokensPerTurn: 500000, handoffReservedTokens: 80000, minConsultationIntervalMs: 0 }
const savedDecision = (interpretation = 'Every row in the population is even.', attempt = 2) => ({ action: 'save', phase: 'assessment', title: 'Population parity',
  observations: [{ ref: 'raw', description: 'Original sampled rows.' }, { ref: 'check', description: 'Executed sample measurement.' }],
  interpretation, nextCheck: 'Measure population coverage.', pendingDecision: 'Exclude odd records from the batch transformation.',
  dependentOperation: { name: 'evaluate', arguments: { attempt } }, evidenceIds: [], findingIds: [] })
const adoptionVerdict = (decision: 'observe' | 'supported' | 'check-required', evidenceRefs = ['raw', 'check']) => ({ decision,
  rationale: decision === 'check-required' ? 'A sample cannot establish full population coverage.' : 'The original measurement covers this operation.',
  evidenceRefs, nextCheck: decision === 'check-required' ? 'Measure all source rows before excluding any records.' : '',
  ...decision === 'check-required' ? { check: { name: 'evaluate', arguments: { attempt: 1 } } } : {} })
function executedResult(f: Fixture, id: string) {
  const event = f.agent.session.snapshotEvents().find(item => item.type === 'tool/result' && item.data.message.toolCallId === id)
  if (event?.type !== 'tool/result') throw new Error('Missing tool result ' + id)
  return event
}
function toolBatch(items: Array<{ id: string; name: string; arguments: object }>): StreamChunk[] {
  return [...items.flatMap((item, index): StreamChunk[] => [
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(item.id), name: item.name, arguments: JSON.stringify(item.arguments) } },
  ]), { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }, { type: 'finish', reason: { kind: 'tool-calls' } }]
}

const automaticExperimentConfig = { automaticExperimentReviewEnabled: true, automaticExperimentStage: 'before-execution',
  automaticExperimentSourceTools: ['native_observe'], automaticExperimentSourceOperations: ['inspect.fields'],
  checkTools: ['pwsh'], adoptionTools: ['pwsh'], adoptionReviewEnabled: true, handoffReviewEnabled: false,
  minConsultationIntervalMs: 0, maxTokensPerTurn: 500000 }
const analysisCode = (width: number) => `from pathlib import Path\ndata = Path('source.bin').read_bytes()\nwidth = ${width}\nprint(len(data) // width)\n`
const scriptOperation = (f: Fixture, basename = 'analyze.py') => ({ command: `python "${join(f.root, basename)}"`, description: 'Measure original record fields.' })
const writeScript = (f: Fixture, id: string, width: number, basename = 'analyze.py') =>
  toolCallResponse(id, 'write', { file_path: join(f.root, basename), content: analysisCode(width) })
const smallFieldCheck = { command: 'python -c "print(24)"', description: 'Independently measure one source record width.' }
const experimentVerdict = (decision: 'check-required' | 'observe' | 'supported', evidenceRefs = ['native'],
  check = { name: 'pwsh', arguments: smallFieldCheck }) => ({ decision,
  rationale: decision === 'check-required' ? 'The script assumes twenty bytes while the original field record says twenty-four.' : 'The operation is a bounded observation consistent with the supplied raw fields.',
  evidenceRefs, ...decision === 'check-required' ? { nextCheck: 'Measure one original entry before interpreting the full scan.', check } : {} })
const experimentNotices = (f: Fixture) => f.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
  && event.data.source.kind === 'helper-checkpoint' && event.data.source.summary === 'Generated experiment review')
const experimentNoticeValues = (f: Fixture) => experimentNotices(f).map(event => {
  if (event.type !== 'user/message') throw new Error('Missing experiment notice')
  return JSON.parse(event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
})

describe('experiment interpretation through the real loop', () => {
  const config = { ...automaticExperimentConfig, automaticExperimentStage: 'interpretation',
    automaticInterpretationTools: ['write', 'edit', 'pwsh'] }
  const decision = (f: Fixture, id: string, explanation = 'Every decoded row has a zero field, so discard this candidate format.') =>
    toolCallResponse(id, 'write', { file_path: join(f.root, 'next.py'), content: 'discard_candidate = True\n' }, explanation)

  it.each(['说明这个方向有问题，换一个候选布局。', 'The zero fields point towards a different record layout.'])('reviews an adjacent interpretation without requiring fixed words: %s', async explanation => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => decision(f, 'dependent', explanation),
      textResponse(JSON.stringify(experimentVerdict('check-required', ['produce']))),
      textResponse('The candidate layout remains unverified.')], config)
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    expect(executedResult(f, 'dependent').data.message.isError).toBe(true)
  })

  it.each([true, false])('uses earlier native observations only for the file mapped to the current measurement (same asset: %s)', async sameAsset => {
    let f: Fixture
    const steps: ConstructorParameters<typeof MockAdapter>[0] = [toolCallResponse('earlier-native', 'native_observe', { assetId: 'asset-original' }),
      textResponse('Original fields recorded; the measurement is still pending.'),
      () => toolCallResponse('current-code', 'write', { file_path: join(f.root, 'analyze.py'),
        content: `from pathlib import Path\ndata=Path(${JSON.stringify(join(f.root, sameAsset ? 'original.bin' : 'different.bin'))}).read_bytes()\nprint(len(data))\n` }),
      () => toolCallResponse('current-measurement', 'pwsh', scriptOperation(f)),
      () => decision(f, 'dependent', 'The sampled result points towards another layout.')]
    if (sameAsset) steps.push(textResponse(JSON.stringify(experimentVerdict('check-required', ['current-measurement']))))
    steps.push(textResponse('The current result remains scoped to the measured file.'))
    f = await setup(steps, config)
    f.analysisPhase.assets = [{ id: 'asset-original', engagementId: 'project-fixture', format: 'other',
      inputSource: { kind: 'path', path: join(f.root, 'original.bin') } }]
    f.start(); await f.agent.whenIdle()
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(sameAsset ? 1 : 0)
    expect(executedResult(f, 'dependent').data.message.isError).toBe(sameAsset)
    if (sameAsset) expect(JSON.stringify(f.adapter.requests.find(item => item.model === 'flash-review')?.messages)).toContain('earlier-native')
  })

  it('does not execute a dependent operation when the user steers during source lookup', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => {
        f.analysisPhase.beforeView = async () => {
          f.analysisPhase.beforeView = async () => {}
          f.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a different input.' }] }))
        }
        return decision(f, 'stale')
      }, textResponse('The newer instruction takes priority.')], config)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'stale').data.message.isError).toBe(true)
    expect(calls(f)).toEqual([])
  })

  it('does not load asset mappings for the first measurement or an operation without a public interpretation', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)),
      () => toolCallResponse('no-interpretation', 'write', { file_path: join(f.root, 'next.py'), content: 'measure_again = True\n' }),
      toolCallResponse('read-original', 'read_data', {}), textResponse('No conclusion has been adopted.')], config)
    let lookups = 0
    f.analysisPhase.beforeView = async () => { lookups++; throw new Error('Unexpected source lookup') }
    f.start(); await f.agent.whenIdle()
    for (const id of ['native', 'produce-code', 'produce', 'no-interpretation', 'read-original'])
      expect(executedResult(f, id).data.message.isError).toBe(false)
    expect(lookups).toBe(0)
    expect(calls(f)).toEqual([])
  })

  it('runs the initial measurement and reviews its code, actual result and proposed adoption before writing the next experiment', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => decision(f, 'blocked'),
      textResponse(JSON.stringify(experimentVerdict('check-required', ['produce']))),
      () => decision(f, 'blocked-again', 'The same output still means this candidate format should be discarded.'),
      toolCallResponse('read-original', 'read_data', {}), toolCallResponse('independent-check', 'pwsh', smallFieldCheck),
      textResponse('The candidate remains possible; the extraction requires an independent control.')], { ...config, maxPerTurn: 1 })
    f.shell.outcome = shellResult({ stdout: { text: 'count=3; every decoded value has a zero low word', truncated: false } })
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'produce').data.message.isError).toBe(false)
    for (const id of ['blocked', 'blocked-again']) {
      const result = executedResult(f, id)
      expect(result.data.message.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('check-required')
      expect(JSON.stringify(result)).not.toContain('is not a function')
    }
    expect(executedResult(f, 'read-original').data.message.isError).toBe(false)
    expect(executedResult(f, 'independent-check').data.message.isError).toBe(false)
    expect(calls(f)).toHaveLength(1)
    const request = f.adapter.requests.find(item => item.model === 'flash-review')
    expect(request).toMatchObject({ reasoningEffort: 'low', maxTokens: 8192 })
    const input = JSON.stringify(request?.messages)
    expect(input).toContain('experiment-interpretation')
    expect(input).toContain('width = 20')
    expect(input).toContain('every decoded value has a zero low word')
    expect(input).toContain('discard_candidate')
    expect(input).toContain('missingOriginalInputs')
    expect(input).not.toContain('USER_TASK_CANARY')
  })

  it('preserves a correct limited observation and avoids a review before the first experiment', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 24),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => toolCallResponse('observe', 'write',
        { file_path: join(f.root, 'measure-all.py'), content: 'measure_all_rows = True\n' },
        'This measures only the sampled records; now obtain an independent measurement.'),
      textResponse(JSON.stringify(experimentVerdict('observe', ['produce']))), textResponse('The limited observation is retained without claiming complete coverage.')], config)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'produce').data.message.isError).toBe(false)
    expect(executedResult(f, 'observe').data.message.isError).toBe(false)
    expect(calls(f)).toHaveLength(1)
    const events = f.agent.session.snapshotEvents()
    expect(events.find(event => event.type === 'helper/auto-start')!.seq).toBeGreaterThan(executedResult(f, 'produce').seq)
    expect(experimentNoticeValues(f)).toMatchObject([{ status: 'reviewed', decision: 'observe', scientificallyVerified: false, stage: 'interpretation' }])
  })

  it.each(['no-explanation', 'ordinary-read'] as const)('does not turn %s into a paid adoption decision', async mode => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => mode === 'ordinary-read'
        ? toolCallResponse('next', 'read_data', {}, 'Read the original bytes before interpreting the result.')
        : toolCallResponse('next', 'write', { file_path: join(f.root, 'next.py'), content: 'measure_again = True\n' }),
      textResponse('No research conclusion is established.')], config)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'next').data.message.isError).toBe(false)
    expect(calls(f)).toEqual([])
  })

  it('continues an unreviewed experiment when there is no budget without recording it as verified', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => decision(f, 'next'),
      textResponse('No reviewer validated the extraction or the interpretation.')], { ...config, maxTokensPerTurn: 1 })
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'next').data.message.isError).toBe(false)
    expect(calls(f)).toEqual([])
    expect(experimentNoticeValues(f)).toMatchObject([{ status: 'unreviewed', scientificallyVerified: false, stage: 'interpretation' }])
  })

  it('continues twenty later independent operations after its interpretation consultation budget is spent', async () => {
    let f: Fixture
    const steps: ConstructorParameters<typeof MockAdapter>[0] = [toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'producer-code', 24),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => decision(f, 'first', 'Only the sampled rows were measured; obtain more data.'),
      textResponse(JSON.stringify(experimentVerdict('observe', ['produce'])))]
    for (let index = 0; index < 20; index++) {
      steps.push(() => toolCallResponse(`measure-${index}`, 'pwsh', scriptOperation(f)))
      steps.push(() => toolCallResponse(`next-${index}`, 'write', { file_path: join(f.root, `next-${index}.py`),
        content: `measure_range = ${index}\n` }, 'Only this bounded range was observed; measure another range next.'))
    }
    steps.push(textResponse('No later interpretation was reviewed; measurements remain scoped to their records.'))
    f = await setup(steps, { ...config, maxPerTurn: 1 })
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    for (let index = 0; index < 20; index++) expect(executedResult(f, `next-${index}`).data.message.isError).toBe(false)
    const notices = experimentNoticeValues(f)
    expect(notices.filter(value => value.status === 'unreviewed')).toHaveLength(20)
    expect(notices.every(value => value.scientificallyVerified === false)).toBe(true)
  })

  it.each(['steer', 'cancel'] as const)('does not execute a proposed adoption after %s during interpretation review', async mode => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'produce-code', 20),
      () => toolCallResponse('produce', 'pwsh', scriptOperation(f)), () => decision(f, 'never-written'), 'hang-slow',
      textResponse('The newer instruction takes priority.')], config)
    const started = reviewStarted(f)
    f.start(); await started
    if (mode === 'steer') f.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a different input.' }] }))
    else f.agent.cancel({ kind: 'user' })
    await f.agent.whenIdle()
    expect(executedResult(f, 'never-written').data.message.isError).toBe(true)
    expect(experimentNoticeValues(f)).toEqual([])
    expect(calls(f)).toHaveLength(1)
  })
})

describe('automatic generated-script review through the real loop', () => {
  it('blocks a wrong first execution, reuses the rejection, permits a small check, and reviews new evidence', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'script-write', 20),
      () => toolCallResponse('first-blocked', 'pwsh', scriptOperation(f)), textResponse(JSON.stringify(experimentVerdict('check-required'))),
      () => toolCallResponse('same-version-blocked', 'pwsh', scriptOperation(f)),
      toolCallResponse('ordinary-read', 'read_data', {}), toolCallResponse('small-check', 'pwsh', smallFieldCheck),
      () => toolCallResponse('allowed', 'pwsh', scriptOperation(f)), textResponse(JSON.stringify(experimentVerdict('supported', ['native', 'small-check']))),
      () => toolCallResponse('executed-version-again', 'pwsh', scriptOperation(f)), textResponse('The raw field check is retained; broader interpretation remains unverified.')], automaticExperimentConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'first-blocked').data.message.isError).toBe(true)
    expect(executedResult(f, 'same-version-blocked').data.message.isError).toBe(true)
    expect(executedResult(f, 'ordinary-read').data.message.isError).toBe(false)
    expect(executedResult(f, 'small-check').data.message.isError).toBe(false)
    expect(executedResult(f, 'allowed').data.message.isError).toBe(false)
    expect(executedResult(f, 'executed-version-again').data.message.isError).toBe(false)
    expect(f.shell.requests.map(request => request.command)).toEqual([smallFieldCheck.command, scriptOperation(f).command, scriptOperation(f).command])
    expect(calls(f)).toHaveLength(2)
    const reviews = f.adapter.requests.filter(request => request.model === 'flash-review')
    expect(reviews).toHaveLength(2)
    for (const request of reviews) expect(request).toMatchObject({ reasoningEffort: 'low', maxTokens: 8192 })
    expect(reviews.every(request => (request.tools ?? []).length === 0)).toBe(true)
    expect(JSON.stringify(reviews[0]?.messages)).toContain('width = 20')
    expect(JSON.stringify(reviews[0]?.messages)).toContain('entryWidth')
    expect(JSON.stringify(reviews[0]?.messages)).not.toContain('USER_TASK_CANARY')
    expect(JSON.stringify(reviews[1]?.messages)).toContain('small-check')
    expect(experimentNotices(f)).toHaveLength(1)
    const notice = experimentNotices(f)[0]
    if (notice?.type !== 'user/message') throw new Error('Missing experiment notice')
    expect(JSON.parse(notice.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')))
      .toMatchObject({ kind: 'automatic-experiment-review', decision: 'supported', scientificallyVerified: false })
    expect(f.analysisPhase.saves).toBe(0)
  })

  it('reviews a corrected script version without requiring a checkpoint or another sample command', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'bad-write', 20),
      () => toolCallResponse('blocked', 'pwsh', scriptOperation(f)), textResponse(JSON.stringify(experimentVerdict('check-required'))),
      () => writeScript(f, 'corrected-write', 24), () => toolCallResponse('corrected-execution', 'pwsh', scriptOperation(f)),
      textResponse(JSON.stringify(experimentVerdict('observe'))), textResponse('The changed script executed; its interpretation is still scoped to the observation.')], automaticExperimentConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'blocked').data.message.isError).toBe(true)
    expect(executedResult(f, 'corrected-execution').data.message.isError).toBe(false)
    expect(f.shell.requests).toHaveLength(1)
    expect(calls(f)).toHaveLength(2)
    expect(JSON.stringify(f.adapter.requests.filter(request => request.model === 'flash-review')[1]?.messages)).toContain('width = 24')
    expect(f.analysisPhase.saves).toBe(0)
  })

  it.each(['observe', 'supported'] as const)('admits an independent %s result and does not re-review an executed version', async decision => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'script-write', 24),
      () => toolCallResponse('first', 'pwsh', scriptOperation(f)), textResponse(JSON.stringify(experimentVerdict(decision))),
      () => toolCallResponse('second', 'pwsh', scriptOperation(f)), textResponse('Repeated observations do not establish population coverage.')], automaticExperimentConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'first').data.message.isError).toBe(false)
    expect(executedResult(f, 'second').data.message.isError).toBe(false)
    expect(f.shell.requests).toHaveLength(2)
    expect(calls(f)).toHaveLength(1)
  })

  it.each(['no-adapter', 'echo', 'directory'] as const)('does not review %s work as a generated experiment', async mode => {
    let f: Fixture
    f = await setup([...mode === 'no-adapter' ? [] : [toolCallResponse('native', 'native_observe', {})],
      () => writeScript(f, 'script-write', 20), () => toolCallResponse('ordinary', 'pwsh', mode === 'no-adapter' ? scriptOperation(f)
        : { command: mode === 'echo' ? 'Write-Output ready' : 'Get-ChildItem .', description: 'Read local environment state.' }),
      textResponse('No semantic script adoption was reviewed.')], automaticExperimentConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'ordinary').data.message.isError).toBe(false)
    expect(f.shell.requests).toHaveLength(1)
    expect(calls(f)).toEqual([])
  })

  it('executes an oversized unregistered script with a visible coverage gap and without a consultation', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => toolCallResponse('script-write', 'write', {
      file_path: join(f.root, 'analyze.py'), content: analysisCode(20) + '# synthetic source context\n'.repeat(200) }),
      () => toolCallResponse('oversized', 'pwsh', scriptOperation(f)), toolCallResponse('read-after-budget', 'read_data', {}),
      toolCallResponse('small-check', 'pwsh', smallFieldCheck), textResponse('The large script remains unreviewed; the small observation completed.')],
    { ...automaticExperimentConfig, automaticExperimentMaxRequestBytes: 2000 })
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'oversized').data.message.isError).toBe(false)
    expect(experimentNoticeValues(f)).toEqual([expect.objectContaining({ status: 'unreviewed', scientificallyVerified: false,
      issue: 'packet-over-budget' })])
    expect(JSON.stringify(f.adapter.requests.filter(request => request.model === 'main').at(-1)?.messages)).toContain('packet-over-budget')
    expect(executedResult(f, 'read-after-budget').data.message.isError).toBe(false)
    expect(executedResult(f, 'small-check').data.message.isError).toBe(false)
    expect(calls(f)).toEqual([])
    expect(f.shell.requests.map(request => request.command)).toEqual([scriptOperation(f).command, smallFieldCheck.command])
  })

  it('keeps a long task progressing after three reviews while preserving the reserved handoff call', async () => {
    let f: Fixture
    const script: ConstructorParameters<typeof MockAdapter>[0] = [toolCallResponse('native', 'native_observe', {})]
    for (let version = 1; version <= 5; version++) {
      script.push(() => toolCallResponse('write-' + version, 'write', { file_path: join(f.root, 'analyze.py'),
        content: analysisCode(24) + '# observation version ' + version + '\n' }),
      () => toolCallResponse('execute-' + version, 'pwsh', scriptOperation(f)))
      if (version <= 3) script.push(textResponse(JSON.stringify(experimentVerdict('observe'))))
    }
    script.push(textResponse('Some generated observations were not independently reviewed.'))
    f = await setup(script, { ...automaticExperimentConfig, maxPerTurn: 4, handoffReviewEnabled: true })
    f.start(); await f.agent.whenIdle()
    for (let version = 1; version <= 5; version++) expect(executedResult(f, 'execute-' + version).data.message.isError).toBe(false)
    expect(f.shell.requests).toHaveLength(5)
    expect(calls(f)).toHaveLength(3)
    const notices = experimentNoticeValues(f)
    expect(notices).toHaveLength(5)
    expect(notices.slice(3)).toEqual([expect.objectContaining({ status: 'unreviewed', scientificallyVerified: false }),
      expect.objectContaining({ status: 'unreviewed', scientificallyVerified: false })])
    expect(f.adapter.requests.filter(request => request.model === 'main').at(-1)?.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')).toContain('"status":"unreviewed"')
  })

  it.each(['token-budget', 'disabled-policy', 'invalid-json', 'truncated'] as const)(
    'records %s as missing automatic coverage rather than denying an unregistered experiment', async mode => {
      let f: Fixture
      const paid = mode === 'invalid-json' || mode === 'truncated'
      f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'script-write', 24),
        () => toolCallResponse('unreviewed-execution', 'pwsh', scriptOperation(f)),
        ...paid ? [mode === 'truncated' ? maxTokensResponse('{"decision":') : textResponse('invalid-json')] : [],
        () => toolCallResponse('same-version-again', 'pwsh', scriptOperation(f)),
        textResponse('Execution completed, but no independent result supports the interpretation.')],
      { ...automaticExperimentConfig, ...mode === 'token-budget' ? { maxTokensPerTurn: 1 } : {} })
      if (mode === 'disabled-policy') f.agent.session.append('helper/policy', { enabled: false, mode: 'normal' })
      f.start(); await f.agent.whenIdle()
      expect(executedResult(f, 'unreviewed-execution').data.message.isError).toBe(false)
      expect(executedResult(f, 'same-version-again').data.message.isError).toBe(false)
      expect(f.shell.requests).toHaveLength(2)
      expect(calls(f)).toHaveLength(paid ? 1 : 0)
      expect(experimentNoticeValues(f)).toEqual([expect.objectContaining({ status: 'unreviewed', scientificallyVerified: false })])
      expect(f.adapter.requests.filter(request => request.model === 'main').at(-1)?.messages.flatMap(message => message.content)
        .filter(block => block.type === 'text').map(block => block.text).join('\n')).toContain('"status":"unreviewed"')
    })

  it('executes another unregistered script during the shared cooldown and records that it was not reviewed', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'write-a', 24),
      () => toolCallResponse('reviewed-a', 'pwsh', scriptOperation(f)), textResponse(JSON.stringify(experimentVerdict('observe'))),
      () => writeScript(f, 'write-b', 24, 'other.py'), () => toolCallResponse('unreviewed-b', 'pwsh', scriptOperation(f, 'other.py')),
      textResponse('The second observation has no independent review.')],
    { ...automaticExperimentConfig, minConsultationIntervalMs: 86400000 })
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'reviewed-a').data.message.isError).toBe(false)
    expect(executedResult(f, 'unreviewed-b').data.message.isError).toBe(false)
    expect(f.shell.requests).toHaveLength(2)
    expect(calls(f)).toHaveLength(1)
    expect(experimentNoticeValues(f)).toEqual([expect.objectContaining({ status: 'reviewed', decision: 'observe' }),
      expect.objectContaining({ status: 'unreviewed', scientificallyVerified: false })])
  })

  it.each(['check-required', 'insufficient-evidence', 'proposal-only'] as const)(
    'retains an existing %s concern after a new local check exhausts the consultation budget', async decision => {
      let f: Fixture
      const verdict = decision === 'insufficient-evidence'
        ? { decision, rationale: 'The selected original rows do not establish the width for this input.', evidenceRefs: ['native'],
          nextCheck: 'Obtain the complete raw field metadata for this input.' }
        : experimentVerdict('check-required', decision === 'proposal-only' ? ['native', 'missing-source'] : ['native'])
      f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'script-write', 20),
        () => toolCallResponse('first-blocked', 'pwsh', scriptOperation(f)), textResponse(JSON.stringify(verdict)),
        toolCallResponse('new-check', 'pwsh', smallFieldCheck), () => toolCallResponse('still-blocked', 'pwsh', scriptOperation(f)),
        textResponse('The original concern remains unresolved; a new measurement alone is not a review.')],
      { ...automaticExperimentConfig, maxPerTurn: 1 })
      f.start(); await f.agent.whenIdle()
      expect(executedResult(f, 'first-blocked').data.message.isError).toBe(true)
      expect(executedResult(f, 'new-check').data.message.isError).toBe(false)
      expect(executedResult(f, 'still-blocked').data.message.isError).toBe(true)
      for (const callId of ['first-blocked', 'still-blocked']) {
        const rejection = executedResult(f, callId).data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        expect(rejection).toContain(decision)
        expect(rejection).not.toContain('is not a function')
      }
      expect(f.shell.requests.map(request => request.command)).toEqual([smallFieldCheck.command])
      expect(calls(f)).toHaveLength(1)
      expect(experimentNotices(f)).toEqual([])
    })

  it.each(['budget', 'failed-review'] as const)('keeps explicit dependent adoption blocked by %s', async mode => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'write-dependent', 24),
      () => toolCallResponse('register', 'premise_check', { action: 'save', phase: 'assessment', title: 'Dependent population exclusion',
        observations: [{ ref: 'native' }], interpretation: 'The observed field width covers every original record.',
        nextCheck: 'Measure the full input coverage.', pendingDecision: 'Exclude records based on this width.',
        dependentOperation: { name: 'pwsh', arguments: scriptOperation(f) }, evidenceIds: [], findingIds: [] }),
      () => toolCallResponse('dependent-blocked', 'pwsh', scriptOperation(f)),
      ...mode === 'failed-review' ? [maxTokensResponse('{"decision":')] : [],
      textResponse('The registered exclusion was not executed.')],
    { ...automaticExperimentConfig, ...mode === 'budget' ? { maxTokensPerTurn: 1 } : {} })
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'dependent-blocked').data.message.isError).toBe(true)
    const rejection = executedResult(f, 'dependent-blocked').data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(rejection).toContain('本次依赖操作未执行')
    expect(rejection).toContain(mode === 'budget' ? '复核预算不足' : '复核未完整交付')
    expect(rejection).not.toContain('is not a function')
    expect(f.shell.requests).toEqual([])
    expect(calls(f)).toHaveLength(mode === 'failed-review' ? 1 : 0)
    expect(experimentNotices(f)).toEqual([])
  })

  it.each(['steer', 'cancel'] as const)('does not run the proposed script after %s during review', async mode => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'script-write', 20),
      () => toolCallResponse('never-executed', 'pwsh', scriptOperation(f)), 'hang-slow', textResponse('The new user request takes priority.')], automaticExperimentConfig)
    const started = reviewStarted(f)
    f.start(); await started
    if (mode === 'steer') f.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a different input.' }] }))
    else f.agent.cancel({ kind: 'user' })
    await f.agent.whenIdle()
    expect(f.shell.requests).toEqual([])
    expect(calls(f)).toHaveLength(1)
    expect(calls(f)[0]?.status).not.toBe('completed')
    expect(experimentNotices(f)).toEqual([])
    if (mode === 'steer') expect(JSON.stringify(f.adapter.requests.at(-1)?.messages)).toContain('Use a different input.')
  })

  it.each([true, false])('keeps execution ownership when human steering arrives before the tool hook (owned script: %s)', async owned => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'script-write', 20), () => {
      f.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop using this input; inspect the new dataset.' }] }))
      return toolCallResponse('superseded-operation', 'pwsh', owned ? scriptOperation(f)
        : { command: 'Write-Output observation', description: 'Read a local observation.' })
    }, textResponse('The old script was not executed.')], automaticExperimentConfig)
    f.start(); await f.agent.whenIdle()
    expect(f.shell.requests).toHaveLength(owned ? 0 : 1)
    expect(executedResult(f, 'superseded-operation').data.message.isError).toBe(owned)
    expect(calls(f)).toEqual([])
    expect(JSON.stringify(f.adapter.requests.at(-1)?.messages)).toContain('Stop using this input; inspect the new dataset.')
  })

  it('keeps an explicitly registered dependent operation ahead of an automatic suggested check', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('native', 'native_observe', {}), () => writeScript(f, 'write-a', 20),
      () => writeScript(f, 'write-b', 20, 'dependent.py'), () => toolCallResponse('register-b', 'premise_check', {
        action: 'save', phase: 'assessment', title: 'Separate dependent interpretation',
        observations: [{ ref: 'native' }], interpretation: 'The observed fields may apply to all records.',
        nextCheck: 'Check whether the dependent operation covers the full input.',
        pendingDecision: 'Apply this assumption to the dependent transformation.',
        dependentOperation: { name: 'pwsh', arguments: scriptOperation(f, 'dependent.py') }, evidenceIds: [], findingIds: [],
      }), () => toolCallResponse('automatic-a', 'pwsh', scriptOperation(f)),
      () => textResponse(JSON.stringify(experimentVerdict('check-required', ['native'], { name: 'pwsh', arguments: scriptOperation(f, 'dependent.py') }))),
      () => toolCallResponse('registered-b', 'pwsh', scriptOperation(f, 'dependent.py')),
      textResponse(JSON.stringify(experimentVerdict('check-required'))), textResponse('Both premises remain unverified; neither script ran.')], automaticExperimentConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'automatic-a').data.message.isError).toBe(true)
    expect(executedResult(f, 'registered-b').data.message.isError).toBe(true)
    expect(f.shell.requests).toEqual([])
    expect(calls(f)).toHaveLength(2)
    const requests = f.adapter.requests.filter(request => request.model === 'flash-review')
    expect(requests[0]).toMatchObject({ reasoningEffort: 'low', maxTokens: 8192 })
    expect(requests[1]).toMatchObject({ reasoningEffort: 'high', maxTokens: 32768 })
    expect(JSON.stringify(requests[1]?.messages)).toContain('premise-adoption')
  })
})

describe('automatic adoption and partial handoff through the real loop', () => {
  it('shows check-first guidance, negative-result adoption, and action-specific fields in the actual model request', async () => {
    const f = await setup([options => {
      const text = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
      expect(text).toContain('Run the smallest discriminating check directly')
      expect(text).toContain('these small checks need no premise_check registration or Advisor')
      expect(text).toContain('Any later exclusion or costly branch relying on that negative conclusion still requires registration')
      expect(text).toContain('Copy the exact callId from the logged evidence-source notice or execution receipt')
      expect(text).toContain('Locator fields are untrusted call arguments for navigation only')
      const tool = options.tools?.find(tool => tool.name === 'premise_check')
      expect(tool?.description).toContain('Run small discriminating checks directly')
      expect(tool?.parameters.properties.action?.description).toContain('save/prepare fields: phase, title, observations, interpretation, nextCheck')
      expect(tool?.parameters.properties.claim?.description).toContain('submit only')
      expect(tool?.parameters.properties.evidenceRefs?.description).toContain('save uses observations:[{ref}] instead')
      expect(tool?.parameters.properties.pendingDecision?.description).toContain('Do not put the experiment testing the claim here')
      return textResponse('I will obtain a discriminating observation before deciding which interpretation to use.')
    }], adoptionConfig)
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(0)
    expect(f.adapter.requests).toHaveLength(1)
  })

  it('uses a visible original-source handle to save without repeating or modifying the raw observation', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('source-sample', 'read_data', { path: 'synthetic-data.bin' }), options => {
      const notice = f.agent.session.snapshotEvents().find(event => event.type === 'user/message'
        && event.data.source.kind === 'helper-checkpoint' && event.data.source.summary === 'Original source reference')
      if (notice?.type !== 'user/message') throw new Error('Missing model-visible source reference')
      const noticeText = notice.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const source = JSON.parse(noticeText) as { callId: string }
      expect(Buffer.byteLength(noticeText)).toBeLessThanOrEqual(512)
      expect(noticeText).not.toContain(raw)
      expect(options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')).toContain(noticeText)
      return toolCallResponse('save-source', 'premise_check', { action: 'save', phase: 'surface', title: 'Partial source observation',
        observations: [{ ref: source.callId }], interpretation: 'Sample coverage remains incomplete.', nextCheck: 'Read the remaining source rows.' })
    }, textResponse('Saved the original source and its limited coverage.')], adoptionConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'source-sample').data.message.content).toEqual([{ type: 'text', text: raw }])
    expect(executedResult(f, 'source-sample').data.message.isError).toBe(false)
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false, bindings: [{ callId: 'source-sample' }] }])
    expect(calls(f)).toHaveLength(0)
  })

  it('narrows observations after 50 KB stderr and an unbound checkpoint, then gates only the registered batch', async () => {
    let f: Fixture
    const dependent = { command: 'python transform.py --exclude-odd', description: 'Apply the population assumption.' }
    f = await setup([toolCallResponse('archive', 'pwsh', { command: 'tar -tf synthetic.tar', description: 'Inspect the archive.' }),
      toolCallResponse('progress', 'security_checkpoint', { phase: 'surface', title: 'Dataset triage',
        summary: 'Archive listing encountered an error.', reason: 'Population parity remains unknown.',
        next: 'Read a bounded source header.', evidenceIds: [], findingIds: [] }),
      () => {
        f.shell.outcome = shellResult({ stdout: { text: 'HEADER: count=4, representation=u32', truncated: false } })
        return toolCallResponse('narrow-read', 'pwsh', { command: 'python read_header.py --bytes 32', description: 'Read a bounded header.' })
      }, toolCallResponse('register', 'premise_check', { action: 'save', phase: 'assessment', title: 'Parity-dependent transformation',
        observations: [{ ref: 'narrow-read' }], interpretation: 'All four rows might be even.',
        nextCheck: 'Read all four values.', pendingDecision: 'Exclude odd values from the transformation.',
        dependentOperation: { name: 'pwsh', arguments: dependent } }),
      toolCallResponse('batch', 'pwsh', dependent), options => {
        expect(options.model).toBe('flash-review')
        expect(JSON.stringify(options.messages)).toContain('HEADER: count=4')
        expect(JSON.stringify(options.messages)).not.toContain('ARCHIVE_ERROR_CANARY')
        return textResponse(JSON.stringify({ decision: 'check-required', rationale: 'The header does not establish parity.',
          evidenceRefs: ['narrow-read'], nextCheck: 'Read the four actual values.',
          check: { name: 'pwsh', arguments: { command: 'python read_values.py --count 4', description: 'Read four source values.' } } }))
      }, textResponse('The header is observed; parity remains unverified.')],
    { ...adoptionConfig, adoptionTools: ['pwsh'], checkTools: ['pwsh'] })
    f.shell.outcome = shellResult({ exitCode: 1, stderr: { text: 'ARCHIVE_ERROR_CANARY:' + 'x'.repeat(50000), truncated: false } })
    f.start(); await f.agent.whenIdle()
    expect(f.shell.requests.map(request => request.command)).toEqual(['tar -tf synthetic.tar', 'python read_header.py --bytes 32'])
    expect(executedResult(f, 'narrow-read').data.message.isError).toBe(false)
    expect(executedResult(f, 'batch').data.message.isError).toBe(true)
    expect(JSON.stringify(executedResult(f, 'batch'))).toContain('check-required')
    expect(calls(f)).toHaveLength(1)
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false }])
    expect(JSON.stringify(executedResult(f, 'progress'))).toContain('handoff-only')
  })

  it('keeps a source-bound progress save from arming unrelated execution', async () => {
    const { pendingDecision: _decision, dependentOperation: _operation, ...progress } = savedDecision()
    const f = await setup([...baseSteps(), toolBatch([
      { id: 'progress', name: 'premise_check', arguments: progress },
      { id: 'observation', name: 'evaluate', arguments: { attempt: 3 } },
    ]), textResponse('Progress is saved; no adoption was registered.')], adoptionConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'observation').data.message.isError).toBe(false)
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false, adoption: { status: 'handoff-only' } }])
    expect(calls(f)).toHaveLength(0)
  })

  it('records a supported check without arming executions when no dependent operation is registered', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => {
      const { pendingDecision: _decision, dependentOperation: _operation, ...assessment } = submission(f, 'supported')
      return toolCallResponse('submit', 'premise_check', assessment)
    }, toolCallResponse('observation', 'evaluate', { attempt: 3 }), textResponse('The assessment is not an adoption registration.')], adoptionConfig)
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'observation').data.message.isError).toBe(false)
    expect(responses(f)).toMatchObject([{ status: 'supported', scientificallyVerified: false }])
    expect(calls(f)).toHaveLength(0)
  })

  it.each(['save', 'submit'] as const)('rejects an invalid %s registration precisely while a plain progress record remains available', async action => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('missing-operation', 'premise_check', {
      ...(action === 'save' ? savedDecision() : submission(f, 'supported')), dependentOperation: undefined,
    }), () => toolCallResponse('missing-tool', 'premise_check', {
      ...(action === 'save' ? savedDecision() : submission(f, 'supported')),
      dependentOperation: { name: 'unavailable-tool', arguments: {} },
    }), () => toolCallResponse('invalid-arguments', 'premise_check', {
      ...(action === 'save' ? savedDecision() : submission(f, 'supported')),
      dependentOperation: { name: 'evaluate', arguments: { attempt: 'not-a-number' } },
    }), () => {
      const { pendingDecision: _decision, dependentOperation: _operation, ...progress } = savedDecision()
      return toolCallResponse('plain-progress', 'premise_check', progress)
    }, textResponse('The progress handoff is saved; no invalid adoption was registered.')],
    { ...adoptionConfig, adoptionTools: ['evaluate', 'unavailable-tool'] })
    f.start(); await f.agent.whenIdle()
    expect(JSON.stringify(executedResult(f, 'missing-operation'))).toContain('dependentOperation')
    expect(JSON.stringify(executedResult(f, 'missing-tool'))).toContain('当前会话中不可用')
    expect(JSON.stringify(executedResult(f, 'invalid-arguments'))).toContain('dependentOperation.arguments')
    expect(responses(f)).toMatchObject([{ status: 'check-required' }, { status: 'check-required' },
      { status: 'check-required' }, { status: 'saved', scientificallyVerified: false, adoption: { status: 'handoff-only' } }])
    expect(f.analysisPhase.saves).toBe(1)
    expect(calls(f)).toHaveLength(0)
  })

  it.each(['text', 'matching-check-object'] as const)('checks a confidently saved premise before batch execution and admits the exact proposed measurement (nextCheck: %s)', async nextCheckFormat => {
    const order: string[] = []
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      toolCallResponse('batch-blocked', 'evaluate', { attempt: 2 }), options => {
        const started = f.agent.session.snapshotEvents().findLast(event => event.type === 'helper/auto-start')
        if (started?.type !== 'helper/auto-start' || !started.data.question?.context) throw new Error('Missing adoption review context')
        const context = JSON.parse(started.data.question.context)
        expect(context.allowedCheckToolSchemas).toEqual(f.agent.ctx.tools.schemas(f.agent).filter(tool => tool.name === 'evaluate'))
        expect(context.allowedCheckToolSchemas).toMatchObject([{ name: 'evaluate', description: 'Execute a controlled measurement',
          parameters: { type: 'object', properties: { attempt: { type: 'number' } } } }])
        expect(options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n'))
          .toContain(started.data.question.context)
        order.push('review-check-required')
        const verdict = adoptionVerdict('check-required')
        return textResponse(JSON.stringify({ ...verdict, ...nextCheckFormat === 'matching-check-object' ? { nextCheck: verdict.check } : {} }))
      }, toolCallResponse('minimal-check', 'evaluate', { attempt: 1 }),
      toolCallResponse('batch-allowed', 'evaluate', { attempt: 2 }), options => {
        order.push('review-supported')
        expect(options.model).toBe('flash-review')
        expect(JSON.stringify(options.messages)).toContain('FULL_SCAN: 4 rows, all even')
        return textResponse(JSON.stringify(adoptionVerdict('supported', ['raw', 'minimal-check'])))
      }, textResponse('The full scan supports this bounded batch.')], adoptionConfig)
    f.hooks.onCheck = attempt => {
      order.push('execute-' + String(attempt ?? 'sample'))
      if (attempt === 1) f.hooks.evaluation = 'FULL_SCAN: 4 rows, all even'
    }
    f.start(); await f.agent.whenIdle()
    expect(order).toEqual(['execute-sample', 'review-check-required', 'execute-1', 'review-supported', 'execute-2'])
    expect(executedResult(f, 'batch-blocked').data.message.isError).toBe(true)
    expect(JSON.stringify(executedResult(f, 'batch-blocked'))).toContain('check-required')
    expect(JSON.stringify(executedResult(f, 'batch-blocked'))).not.toContain('unreviewed')
    expect(executedResult(f, 'minimal-check').data.message.isError).toBe(false)
    expect(executedResult(f, 'batch-allowed').data.message.isError).toBe(false)
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false }])
    expect(calls(f)).toHaveLength(2)
    expect(f.adapter.requests.filter(request => request.model === 'main')).toHaveLength(7)
    expect(f.adapter.requests.filter(request => request.model === 'flash-review')).toHaveLength(2)
    expect(f.adapter.requests.filter(request => request.model === 'flash-review').every(request => !request.tools?.length)).toBe(true)
  })

  it('preserves a supported correct interpretation without requiring it to be overturned', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision('The three observed sample values are even.')),
      toolCallResponse('sample-batch', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('supported'))),
      textResponse('Only the observed sample is covered.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual([undefined, 2])
    expect(executedResult(f, 'sample-batch').data.message.isError).toBe(false)
    expect(calls(f)).toHaveLength(1)
  })

  it('reviews the registered operation once without claiming to review twenty unregistered later scripts', async () => {
    const later = Array.from({ length: 20 }, (_, i) => ({ id: 'later-' + i, attempt: i + 3 }))
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision('The three observed sample values are even.')),
      toolCallResponse('first-batch', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('supported'))),
      ...later.map(item => toolCallResponse(item.id, 'evaluate', { attempt: item.attempt })),
      textResponse('The recorded sample scope is unchanged; the population remains unverified.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual([undefined, 2, ...later.map(item => item.attempt)])
    expect(['first-batch', ...later.map(item => item.id)].map(id => executedResult(f, id).data.message.isError)).toEqual(Array(21).fill(false))
    expect(calls(f)).toHaveLength(1)
    expect(f.adapter.requests.filter(request => request.model === 'flash-review')).toHaveLength(1)
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('completed')
  })

  it('leaves unregistered later observations available after a reviewed operation and a large result', async () => {
    const maxRequestBytes = 24000
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision('The three observed sample values are even.')),
      toolCallResponse('first-batch', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('supported'))),
      toolCallResponse('large-output', 'evaluate', { attempt: 3 }), toolCallResponse('after-large-output', 'evaluate', { attempt: 4 }),
      textResponse('The recorded decision is unchanged; the additional output remains available in the tool record.')],
    { ...adoptionConfig, maxRequestBytes })
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => {
      executed.push(attempt)
      if (attempt === 3) f.hooks.evaluation = 'ADDITIONAL_OUTPUT: ' + 'x'.repeat(maxRequestBytes + 1)
      if (attempt === 4) f.hooks.evaluation = 'LATER_SCRIPT_COMPLETED'
    }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual([undefined, 2, 3, 4])
    const large = executedResult(f, 'large-output').data.message
    expect(large.isError).toBe(false)
    expect(Buffer.byteLength(large.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))).toBeGreaterThan(maxRequestBytes)
    expect(executedResult(f, 'after-large-output').data.message.isError).toBe(false)
    expect(calls(f)).toHaveLength(1)
    expect(f.adapter.requests.filter(request => request.model === 'flash-review')).toHaveLength(1)
  })

  it('refuses an oversized adoption packet for a decision without a completed supported review', async () => {
    const maxRequestBytes = 24000
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      toolCallResponse('dependent-batch', 'evaluate', { attempt: 2 }), textResponse('Obtain narrower original evidence before adopting the claim.')],
    { ...adoptionConfig, maxRequestBytes })
    f.hooks.evaluation = 'UNREVIEWED_OUTPUT: ' + 'x'.repeat(maxRequestBytes + 1)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false }])
    expect(executed).toEqual([undefined])
    expect(executedResult(f, 'dependent-batch').data.message.isError).toBe(true)
    expect(JSON.stringify(executedResult(f, 'dependent-batch'))).toContain('超过请求预算')
    expect(calls(f)).toEqual([])
  })

  it('reviews a dependent batch again after an observe-only collection succeeds', async () => {
    const order: string[] = []
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision(undefined, 1)),
      toolCallResponse('collect-check', 'evaluate', { attempt: 1 }), () => {
        order.push('review-observe')
        return textResponse(JSON.stringify({ ...adoptionVerdict('observe'),
          rationale: 'Collecting another sample does not depend on the population parity claim.' }))
      }, toolCallResponse('save-batch', 'premise_check', { ...savedDecision(), observations: [{ ref: 'raw' }, { ref: 'collect-check' }] }),
      toolCallResponse('dependent-batch', 'evaluate', { attempt: 2 }), options => {
        order.push('review-check-required')
        expect(options.model).toBe('flash-review')
        expect(JSON.stringify(options.messages)).toContain('ANOTHER_SAMPLE: one even row; full population coverage remains unknown')
        return textResponse(JSON.stringify(adoptionVerdict('check-required', ['raw', 'collect-check'])))
      }, textResponse('The collection succeeded, but excluding odd population rows is still unsupported.')], adoptionConfig)
    f.hooks.onCheck = attempt => {
      order.push('execute-' + String(attempt ?? 'sample'))
      if (attempt === 1) f.hooks.evaluation = 'ANOTHER_SAMPLE: one even row; full population coverage remains unknown'
    }
    f.start(); await f.agent.whenIdle()
    expect(order).toEqual(['execute-sample', 'review-observe', 'execute-1', 'review-check-required'])
    expect(executedResult(f, 'collect-check').data.message.isError).toBe(false)
    expect(executedResult(f, 'dependent-batch').data.message.isError).toBe(true)
    expect(JSON.stringify(executedResult(f, 'dependent-batch'))).toContain('check-required')
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false }, { status: 'saved', scientificallyVerified: false }])
    expect(calls(f)).toHaveLength(2)
    expect(f.adapter.requests.filter(request => request.model === 'flash-review')).toHaveLength(2)
  })

  it('runs an observe review’s next check during cooldown while a registered dependent batch remains blocked', async () => {
    const order: Array<number | undefined> = []
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision(undefined, 1)),
      toolCallResponse('collect-check', 'evaluate', { attempt: 1 }),
      textResponse(JSON.stringify({ ...adoptionVerdict('observe'),
        nextCheck: 'Read the full source header before choosing the data transformation.',
        check: { name: 'evaluate', arguments: { attempt: 3 } } })),
      toolCallResponse('header-check', 'evaluate', { attempt: 3 }),
      toolCallResponse('register-batch', 'premise_check', savedDecision()),
      toolCallResponse('dependent-batch', 'evaluate', { attempt: 2 }),
      textResponse('The original interpretation remains unverified.')],
    { ...adoptionConfig, minConsultationIntervalMs: 3600000 })
    f.hooks.onCheck = attempt => { order.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(order).toEqual([undefined, 1, 3])
    expect(executedResult(f, 'header-check').data.message.isError).toBe(false)
    expect(executedResult(f, 'dependent-batch').data.message.isError).toBe(true)
    expect(JSON.stringify(executedResult(f, 'dependent-batch'))).toContain('共享复核间隔')
    expect(calls(f)).toHaveLength(1)
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false }, { status: 'saved', scientificallyVerified: false }])
  })

  it('reviews registered changed arguments instead of inheriting the preceding operation’s review', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('save-first', 'premise_check', savedDecision()),
      toolCallResponse('first-batch', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('supported'))),
      toolCallResponse('save-changed', 'premise_check', savedDecision(undefined, 3)),
      toolCallResponse('changed-batch', 'evaluate', { attempt: 3 }), textResponse(JSON.stringify(adoptionVerdict('check-required'))),
      textResponse('Only the first registered operation completed.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executedResult(f, 'first-batch').data.message.isError).toBe(false)
    expect(executedResult(f, 'changed-batch').data.message.isError).toBe(true)
    expect(executed).toEqual([undefined, 2])
    expect(calls(f)).toHaveLength(2)
  })

  it('reviews a changed saved claim instead of borrowing the completed decision review', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('save-sample', 'premise_check', savedDecision('The three observed sample values are even.')),
      toolCallResponse('sample-batch', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('supported'))),
      toolCallResponse('save-population', 'premise_check', savedDecision()),
      toolCallResponse('population-batch', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('check-required'))),
      textResponse('The broader population claim still requires a distinguishing measurement.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual([undefined, 2])
    expect(executedResult(f, 'sample-batch').data.message.isError).toBe(false)
    expect(executedResult(f, 'population-batch').data.message.isError).toBe(true)
    expect(calls(f)).toHaveLength(2)
    expect(f.analysisPhase.saves).toBe(2)
  })

  it('reviews each registered operation even when another review proposes it as a check', async () => {
    const f = await setup([...baseSteps(),
      toolCallResponse('register-a', 'premise_check', savedDecision('Assumption A excludes a class of rows.', 2)),
      toolCallResponse('register-b', 'premise_check', savedDecision('Assumption B excludes a different class of rows.', 3)),
      toolCallResponse('execute-a', 'evaluate', { attempt: 2 }),
      textResponse(JSON.stringify({ ...adoptionVerdict('check-required'), check: { name: 'evaluate', arguments: { attempt: 3 } } })),
      toolCallResponse('execute-b', 'evaluate', { attempt: 3 }), textResponse(JSON.stringify(adoptionVerdict('check-required'))),
      textResponse('Both registered operations remain unexecuted pending checks.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual([undefined])
    expect(executedResult(f, 'execute-a').data.message.isError).toBe(true)
    expect(executedResult(f, 'execute-b').data.message.isError).toBe(true)
    expect(responses(f)).toMatchObject([{ status: 'saved', adoption: { status: 'registered' } },
      { status: 'saved', adoption: { status: 'registered' } }])
    expect(calls(f)).toHaveLength(2)
  })

  it('saves more than two original references in one call without consulting a model', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('second-source', 'read_data', {}),
      toolCallResponse('save', 'premise_check', { ...savedDecision(), observations: [
        { ref: 'raw', description: 'First original observation.' }, { ref: 'check', description: 'Sample measurement.' },
        { ref: 'second-source', description: 'Second original observation.' },
      ] }), textResponse('Saved uncertain research notes.')], adoptionConfig)
    f.start(); await f.agent.whenIdle()
    expect(responses(f)).toMatchObject([{ status: 'saved', scientificallyVerified: false,
      bindings: [{ callId: 'raw' }, { callId: 'check' }, { callId: 'second-source' }] }])
    expect(f.analysisPhase.saves).toBe(1)
    expect(calls(f)).toEqual([])
  })

  it('prevents a parallel dependent operation from racing its saved decision', async () => {
    const f = await setup([...baseSteps(), toolBatch([
      { id: 'save', name: 'premise_check', arguments: savedDecision() },
      { id: 'parallel-batch', name: 'evaluate', arguments: { attempt: 2 } },
    ]), textResponse('Save and await the review before batch work.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual([undefined])
    expect(JSON.stringify(executedResult(f, 'parallel-batch'))).toContain('先单独保存')
    expect(calls(f)).toEqual([])
  })

  it('reviews an adopted supported submission instead of trusting the main model label', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f, 'supported')),
      toolCallResponse('batch-blocked', 'evaluate', { attempt: 2 }), textResponse(JSON.stringify(adoptionVerdict('check-required'))),
      textResponse('The population claim still needs a full measurement.')], adoptionConfig)
    let executed = 0
    f.hooks.onCheck = () => { executed++ }
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0]).toMatchObject({ status: 'supported', scientificallyVerified: false })
    expect(executedResult(f, 'batch-blocked').data.message.isError).toBe(true)
    expect(executed).toBe(1)
    expect(calls(f)).toHaveLength(1)
  })

  it('cancels an adoption review on steering before the dependent operation executes', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      toolCallResponse('batch-blocked', 'evaluate', { attempt: 2 }), 'hang-slow', textResponse('Follow the changed objective.')], adoptionConfig)
    const started = reviewStarted(f)
    let executed = 0
    f.hooks.onCheck = () => { executed++ }
    f.start(); await started
    f.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop excluding candidates; report the existing sample only.' }] }))
    await f.agent.whenIdle()
    expect(executed).toBe(1)
    expect(calls(f)).toMatchObject([{ status: 'aborted' }])
    expect(executedResult(f, 'batch-blocked').data.message.isError).toBe(true)
    expect(f.ctx.agents.list()).toHaveLength(1)
  })

  it.each([{ attempt: 2, registered: true }, { attempt: 3, registered: false }])('handles steering before execution without globally blocking observations (registered: $registered)', async ({ attempt, registered }) => {
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()), () => {
      f.agent.steer(createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Do not exclude candidates; continue collecting raw observations.' }] }))
      return toolCallResponse('superseded-operation', 'evaluate', { attempt })
    }, textResponse('The new instruction takes precedence; no dependent operation was executed.')], adoptionConfig)
    const executed: Array<number | undefined> = []
    f.hooks.onCheck = attempt => { executed.push(attempt) }
    f.start(); await f.agent.whenIdle()
    expect(executed).toEqual(registered ? [undefined] : [undefined, attempt])
    expect(executedResult(f, 'superseded-operation').data.message.isError).toBe(registered)
    if (registered) expect(JSON.stringify(executedResult(f, 'superseded-operation'))).toContain('新用户输入或取消')
    expect(calls(f)).toHaveLength(0)
  })

  it.each(['invalid-json', 'empty'])('does not execute a dependent operation after an %s review', async mode => {
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      toolCallResponse('batch-blocked', 'evaluate', { attempt: 2 }), textResponse(mode === 'empty' ? '' : '{"decision":"supported"'),
      textResponse('Keep the premise unverified.')], adoptionConfig)
    let executed = 0
    f.hooks.onCheck = () => { executed++ }
    f.start(); await f.agent.whenIdle()
    expect(executed).toBe(1)
    expect(executedResult(f, 'batch-blocked').data.message.isError).toBe(true)
    expect(JSON.stringify(executedResult(f, 'batch-blocked'))).toContain('unreviewed')
    expect(calls(f)).toHaveLength(1)
  })

  it.each(['exploring', 'finalizing'] as const)('appends source-linked advice without another model delivery during %s', async phase => {
    const original = 'Verified: every row in the population is even. The task remains incomplete.'
    const replacement = 'Observed: the three sampled rows are even; population coverage is unverified.'
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      () => { f.analysisPhase.phase = phase; return textResponse(original) },
      textResponse(JSON.stringify({ decision: 'correct', rationale: 'The raw output covers a sample, not the entire population.', evidenceRefs: ['raw', 'check'],
        corrections: [{ claim: 'Verified: every row in the population is even.', replacement, evidenceRefs: ['raw', 'check'] }] }))],
    { ...adoptionConfig, adoptionReviewEnabled: false, handoffReviewEnabled: true })
    f.start(); await f.agent.whenIdle()
    const requests = f.adapter.requests.filter(request => request.model === 'main')
    expect(requests).toHaveLength(4)
    expect(calls(f)).toHaveLength(1)
    const corrections = f.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'helper-checkpoint' && event.data.source.summary === 'Research handoff correction')
    expect(corrections).toHaveLength(1)
    expect(f.analysisPhase.deliveryGrants).toEqual([])
    expect(JSON.stringify(corrections)).toContain(replacement)
    expect(JSON.stringify(corrections)).toContain('不是新实验结果')
    const answer = f.agent.session.snapshotEvents().findLast(event => event.type === 'assistant/message')!
    const review = f.agent.session.snapshotEvents().findLast(event => event.type === 'helper/auto-end')!
    expect(corrections[0]?.sourceEventSeqs).toEqual(expect.arrayContaining([answer.seq, review.seq]))
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1)?.data.message.content)
      .toEqual([{ type: 'text', text: original }])
    expect(f.hooks.completions).toBe(0)
  })

  it('accepts an accurately qualified partial handoff without adding another main-model request', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      textResponse('The sample contains three even rows; population coverage is unverified.'),
      textResponse(JSON.stringify({ decision: 'allow', rationale: 'The answer preserves sample scope and uncertainty.', evidenceRefs: ['check'], corrections: [] }))],
    { ...adoptionConfig, adoptionReviewEnabled: false, handoffReviewEnabled: true })
    f.start(); await f.agent.whenIdle()
    expect(f.adapter.requests.filter(request => request.model === 'main')).toHaveLength(4)
    expect(calls(f)).toHaveLength(1)
    expect(f.agent.session.snapshotEvents().some(event => event.type === 'user/message'
      && event.data.source.kind === 'helper-checkpoint' && event.data.source.summary === 'Research handoff correction')).toBe(false)
  })

  it.each(['invalid-json', 'empty'])('retains unreviewed status after an %s handoff review', async mode => {
    const f = await setup([...baseSteps(), toolCallResponse('save', 'premise_check', savedDecision()),
      textResponse('Verified: every population row is even.'), textResponse(mode === 'empty' ? '' : 'Not a structured review.')],
    { ...adoptionConfig, adoptionReviewEnabled: false, handoffReviewEnabled: true })
    f.start(); await f.agent.whenIdle()
    const requests = f.adapter.requests.filter(request => request.model === 'main')
    expect(requests).toHaveLength(4)
    const corrections = f.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'helper-checkpoint' && event.data.source.summary === 'Research handoff correction')
    expect(corrections).toHaveLength(1)
    expect(JSON.stringify(corrections)).toContain('关键解释仍未核验')
    expect(f.analysisPhase.deliveryGrants).toEqual([])
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1)?.data.message.content)
      .toEqual([{ type: 'text', text: 'Verified: every population row is even.' }])
    expect(calls(f)).toHaveLength(1)
    expect(f.hooks.completions).toBe(0)
  })
})

describe('explicit premise review through the real Cordis Loader', () => {
  it('does not consult after one hundred setup or directory calls and a progress checkpoint', async () => {
    const setupSteps = Array.from({ length: 100 }, (_, i) => toolCallResponse('setup-' + i, ['list_directory', 'write', 'remember'][i % 3]!, {}))
    const f = await setup([...setupSteps, toolCallResponse('checkpoint', 'security_checkpoint', {}), textResponse('Ready for a real decision.')],
      { ...adoptionConfig, handoffReviewEnabled: true })
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(f.adapter.requests).toHaveLength(102)
    expect(f.adapter.requests.every(r => r.model === 'main')).toBe(true)
  })

  it('lists stable completed references without making a consultation', async () => {
    const f = await setup([...baseSteps(), toolCallResponse('inspect', 'premise_check', { action: 'inspect' }), textResponse('Read references.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0]).toMatchObject({ status: 'evidence', evidence: [
      { ref: resultRef(f, 'check'), checkEligible: true, recordedPartial: false, execution: { status: 'completed' } },
      { ref: resultRef(f, 'raw'), resultChars: raw.length, checkEligible: false, recordedPartial: false },
    ] })
    expect(JSON.stringify(responses(f)[0])).not.toContain(raw)
    expect(JSON.stringify(responses(f)[0])).not.toContain('rawResultText')
    expect(responses(f)[0]).toMatchObject({ assessments: [], assessmentsPartial: false })
  })

  it.each([3000, 24000])('bounds inspect assessments to %i bytes without displacing the evidence page or repeating long submissions', async maxRequestBytes => {
    const body = 'ASSESSMENT_BODY_CANARY: ' + '已测量样本但未覆盖全部数据。'.repeat(220)
    const ids = Array.from({ length: 6 }, (_, i) => 'assessment-' + i + '-' + 'a'.repeat(240))
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('inspect-before', 'premise_check', { action: 'inspect' }),
      ...ids.map(id => () => toolCallResponse(id, 'premise_check', submission(f, 'supported', {
        claim: body, pendingDecision: body, scope: body, observed: body,
      }))), toolCallResponse('inspect-after', 'premise_check', { action: 'inspect' }), textResponse('Use the recorded assessment reference.')],
    { maxRequestBytes })
    f.start(); await f.agent.whenIdle()
    const all = responses(f)
    expect(all.slice(1, -1).map(item => item.status)).toEqual(ids.map(() => 'supported'))
    const inspected = all.at(-1)
    expect(inspected.evidence).toEqual(all[0].evidence)
    expect(inspected.evidence).toHaveLength(2)
    expect(inspected.assessmentsPartial).toBe(maxRequestBytes === 3000)
    expect(inspected.assessments.length).toBeGreaterThan(0)
    if (maxRequestBytes === 3000) expect(inspected.assessments.length).toBeLessThan(ids.length)
    else expect(inspected.assessments.length).toBe(ids.length)
    expect(Buffer.byteLength(JSON.stringify(inspected))).toBeLessThanOrEqual(maxRequestBytes)
    expect(JSON.stringify(inspected)).not.toContain('ASSESSMENT_BODY_CANARY')
    for (const item of inspected.assessments) expect(Object.keys(item).sort()).toEqual(['callId', 'outcome', 'ref'])
    expect(inspected.assessments[0].callId).toBe(ids.at(-1))
    expect(calls(f)).toEqual([])
  })

  it.each(['supported', 'contradicted'])('records %s without asking a model to overturn it', async outcome => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f, outcome)), textResponse('Follow checked evidence.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0]).toMatchObject({ status: outcome, scientificallyVerified: false })
    if (outcome === 'contradicted') expect(responses(f)[0].message).toContain('撤回')
  })

  it('consults once for a concrete unresolved checked premise and delivers complete selected evidence', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Only the sample is established; execute a full scan.'),
      () => toolCallResponse('repeat', 'premise_check', submission(f)), textResponse('Run a bounded independent scan.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toMatchObject([{ status: 'completed', model: 'flash-review' }])
    expect(responses(f).map(r => r.status)).toEqual(['advice', 'duplicate'])
    const child = f.adapter.requests.find(r => r.model === 'flash-review')!
    expect(child).toMatchObject({ maxTokens: 32768, reasoningEffort: 'high' })
    expect(child.tools ?? []).toEqual([])
    expect(JSON.stringify(child.messages)).toContain(raw)
    expect(JSON.stringify(child.messages)).toContain('EXECUTED_CHECK')
    expect(JSON.stringify(child.messages)).not.toContain('USER_TASK_CANARY')
    expect(responses(f)[0].message).toContain('不是独立证据')
    expect(f.ctx.agents.list()).toHaveLength(1)
  })

  it('records a cache-evicted selected check and refuses the same measurement after it is run under a new call ID', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), ...Array.from({ length: 3 }, (_, i) => toolCallResponse('setup-' + i, 'list_directory', {})),
      () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Population coverage remains untested.'),
      toolCallResponse('check-again', 'evaluate', {}),
      () => toolCallResponse('repeat', 'premise_check', submission(f, 'inconclusive', { checkRefs: ['check-again'] })),
      textResponse('Execute a different check that adds information.')], { maxEvidencePairs: 2 })
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toMatchObject([{ status: 'completed' }])
    expect(responses(f).map(response => response.status)).toEqual(['advice', 'duplicate'])
    expect(f.adapter.requests.filter(request => request.model === 'flash-review')).toHaveLength(1)
  })

  it.each(['allow', 'missing-required-check'] as const)('reuses a complete %s scope review without a second model call', async decision => {
    const manifest = { summary: 'Dataset counted.', limitations: 'Static supplied dataset only.',
      results: [{ title: 'Counts', result: 'Three sampled values are even.', toolCallIds: ['raw', 'check'], evidenceIds: [] }] }
    const verdict = { decision, rationale: decision === 'allow' ? 'All required counts are cited.' : 'The remaining source records have not been counted.',
      evidenceRefs: ['check'], nextCheck: decision === 'allow' ? '' : 'Count odd and even records across the full source.' }
    const f = await setup([...baseSteps(), toolCallResponse('complete1', 'security_complete', manifest), textResponse(JSON.stringify(verdict)),
      toolCallResponse('complete2', 'security_complete', manifest), textResponse('Report the actual verified scope.')])
    f.start(); await f.agent.whenIdle()
    expect(f.hooks.completions).toBe(decision === 'allow' ? 2 : 0)
    expect(calls(f)).toHaveLength(1)
    const request = f.adapter.requests.find(item => item.model === 'flash-review')!
    expect(request.tools ?? []).toEqual([])
    expect(JSON.stringify(request.messages)).toContain('Count odd and even values in the complete supplied dataset.')
    const rejected = f.agent.session.snapshotEvents().filter(event => event.type === 'tool/result'
      && ['complete1', 'complete2'].includes(event.data.message.toolCallId) && event.data.message.isError)
    expect(rejected).toHaveLength(decision === 'allow' ? 0 : 2)
    if (decision !== 'allow') {
      expect(JSON.stringify(rejected)).toContain('missing-required-check')
      expect(JSON.stringify(rejected)).toContain('reused')
    }
  })

  it('keeps partial saving available after an incomplete completion review without treating it as success', async () => {
    const manifest = { summary: 'Dataset counted.', limitations: 'Population coverage unknown.',
      results: [{ title: 'Sample', result: 'Three sampled values are even.', toolCallIds: ['check'], evidenceIds: [] }] }
    const f = await setup([...baseSteps(), toolCallResponse('complete', 'security_complete', manifest),
      maxTokensResponse('The remaining source records'),
      toolCallResponse('save', 'premise_check', { action: 'save', phase: 'assessment', title: 'Partial counts',
        observations: [{ ref: 'check', description: 'The sample count completed, but population coverage is unknown.' }],
        interpretation: 'The original objective remains incomplete.', nextCheck: 'Count the remaining source records.', evidenceIds: [], findingIds: [] }),
      toolCallResponse('repeat-complete', 'security_complete', manifest), textResponse('Partial counts saved; full coverage remains unverified.')])
    f.start(); await f.agent.whenIdle()
    expect(f.hooks.completions).toBe(0)
    expect(f.analysisPhase.saves).toBe(1)
    expect(responses(f)[0]).toMatchObject({ status: 'saved', scientificallyVerified: false, receipt: { revision: 1 } })
    expect(calls(f)).toHaveLength(1)
    expect(f.adapter.requests.filter(request => request.model === 'flash-review')).toHaveLength(1)
  })

  it('does not reuse an allowed completion after cancellation while reading its objective', async () => {
    const manifest = { summary: 'Dataset counted.', limitations: 'Static source only.',
      results: [{ title: 'Counts', result: 'Odd and even counts verified.', toolCallIds: ['check'], evidenceIds: [] }] }
    const f = await setup([...baseSteps(), toolCallResponse('complete1', 'security_complete', manifest),
      textResponse(JSON.stringify({ decision: 'allow', rationale: 'Required counts cited.', evidenceRefs: ['check'], nextCheck: '' })),
      textResponse('Completed under the recorded scope.')])
    f.start(); await f.agent.whenIdle()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.analysisPhase.beforeView = async () => { entered.resolve(); await release.promise }
    const controller = new AbortController()
    const pending = f.agent.ctx.tools.execute({ name: 'security_complete', callId: ToolCallId('cancelled-reuse'), arguments: manifest,
      agent: f.agent, signal: controller.signal })
    await entered.promise
    controller.abort()
    release.resolve()
    const outcome = await pending
    expect(outcome.isError).toBe(true)
    expect(f.hooks.completions).toBe(1)
    expect(calls(f)).toHaveLength(1)
  })

  it('does not complete against an objective changed while its scope review was in flight', async () => {
    const manifest = { summary: 'Dataset counted.', limitations: 'Static source only.',
      results: [{ title: 'Counts', result: 'Odd and even counts verified.', toolCallIds: ['check'], evidenceIds: [] }] }
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('complete', 'security_complete', manifest), () => {
      f.analysisPhase.objective = 'Count odd and even values and calculate their sum across the complete source.'
      return textResponse(JSON.stringify({ decision: 'allow', rationale: 'The original counts are cited.', evidenceRefs: ['check'], nextCheck: '' }))
    }, textResponse('The expanded objective needs a new check.')])
    f.start(); await f.agent.whenIdle()
    expect(f.hooks.completions).toBe(0)
    expect(calls(f)).toHaveLength(1)
    const result = f.agent.session.snapshotEvents().find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'complete')
    expect(result?.type === 'tool/result' && result.data.message.isError).toBe(true)
  })

  it('shares completion review admission with the existing consultation budget', async () => {
    const manifest = { summary: 'Dataset counted.', limitations: 'Unknown remaining source.',
      results: [{ title: 'Sample', result: 'Three even rows.', toolCallIds: ['check'], evidenceIds: [] }] }
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Run a full scan.'),
      toolCallResponse('complete', 'security_complete', manifest), textResponse('Budget exhausted; deliver partial work.')], { maxPerTurn: 1 })
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    expect(f.hooks.completions).toBe(0)
    const result = f.agent.session.snapshotEvents().find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'complete')
    expect(JSON.stringify(result)).toContain('预留不足')
  })

  it.each(['policy', 'steering', 'cancel', 'dispose'])('cancels completion review on %s without declaring completion', async mode => {
    const manifest = { summary: 'Dataset counted.', limitations: 'Unknown remaining source.',
      results: [{ title: 'Sample', result: 'Three even rows.', toolCallIds: ['check'], evidenceIds: [] }] }
    const f = await setup([...baseSteps(), toolCallResponse('complete', 'security_complete', manifest), 'hang-slow',
      textResponse('Keep the completion unreviewed.'), textResponse('Follow the new request.')])
    const started = reviewStarted(f)
    f.start(); await started
    if (mode === 'policy') f.agent.session.append('helper/policy', { enabled: false, mode: 'normal' })
    if (mode === 'steering') f.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'Inspect a different source.' }], source: { kind: 'user' } }))
    if (mode === 'cancel') f.agent.cancel({ kind: 'user' })
    if (mode === 'dispose') await projectionFor(f).entry.fiber!.dispose()
    await f.agent.whenIdle()
    expect(calls(f)).toMatchObject([{ status: 'aborted' }])
    expect(f.hooks.completions).toBe(0)
    expect(f.ctx.agents.list()).toHaveLength(1)
  })

  it.each(['missing', 'forged', 'overlap', 'not-executable', 'same-prediction', 'no-question'])('rejects %s check submissions before a paid call', async mode => {
    let f: Fixture
    f = await setup([...baseSteps(), () => {
      const overrides: Record<string, unknown> = mode === 'missing' ? { checkRefs: [] }
        : mode === 'forged' ? { checkRefs: ['r999999'] }
        : mode === 'overlap' ? { checkRefs: [resultRef(f, 'raw')] }
        : mode === 'not-executable' ? { evidenceRefs: [resultRef(f, 'check')], checkRefs: [resultRef(f, 'raw')] }
        : mode === 'same-prediction' ? { expectedB: 'A full scan finds zero odd values.' }
        : { question: '' }
      return toolCallResponse('bad', 'premise_check', submission(f, 'inconclusive', overrides))
    }, textResponse('Repair evidence first.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0].status).toBe('check-required')
  })

  it('does not turn a failed execution into a negative scientific result', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('bad', 'premise_check', submission(f, 'contradicted')), textResponse('Fix measurement.')])
    f.hooks.fail = true
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0]).toMatchObject({ status: 'check-required', issues: [{ issue: 'failed-tool' }] })
  })

  it('uses the complete durable result when only the projection cache was cropped', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f, 'contradicted')),
      textResponse('The executed result is complete; its interpretation remains model-authored.')], { maxResultChars: 100 })
    f.hooks.evaluation = 'start' + 'x'.repeat(6083) + 'end'
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0]).toMatchObject({ status: 'contradicted', scientificallyVerified: false })
    expect(f.ctx.sessionProjections.stateOf(f.agent.session, 'localDirectionReview')!.evidence
      .find(pair => pair.callId === 'check')!.result!.truncated).toBe(true)
  })

  it('paginates source metadata while accepting explicit checks older than the cache', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), ...Array.from({ length: 4 }, (_, i) => toolCallResponse('extra-' + i, 'list_directory', {})),
      toolCallResponse('page1', 'premise_check', { action: 'inspect' }),
      () => toolCallResponse('page2', 'premise_check', { action: 'inspect', beforeSeq: responses(f)[0].nextBeforeSeq }),
      () => toolCallResponse('submit', 'premise_check', submission(f, 'contradicted')),
      textResponse('Use original completed calls without rerunning the measurement.')], { maxEvidencePairs: 2 })
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0].evidence).toHaveLength(2)
    expect(responses(f)[1].evidence).toHaveLength(2)
    expect(responses(f)[0].evidence.map((item: { callId: string }) => item.callId)).toEqual(['extra-3', 'extra-2'])
    expect(responses(f)[1].evidence.map((item: { callId: string }) => item.callId)).toEqual(['extra-1', 'extra-0'])
    expect(responses(f)[2]).toMatchObject({ status: 'contradicted', scientificallyVerified: false })
    expect(calls(f)).toEqual([])
  })

  it.each([
    ['nonzero', { exitCode: 7 }, 'nonzero-or-missing-exit'],
    ['timeout-with-zero-exit', { timedOut: true }, 'timed-out'],
    ['signal', { signal: 'SIGTERM' as const }, 'signalled'],
    ['stdout-truncated', { stdout: { text: 'partial', truncated: true } }, 'executor-truncated'],
    ['stderr-truncated', { stderr: { text: 'partial', truncated: true } }, 'executor-truncated'],
  ] as const)('rejects the real pwsh consumer\'s %s result even though ToolResult is successful', async (_label, failure, issue) => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'pwsh', { command: 'controlled fixture', description: 'Run a controlled measurement' }),
      () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Repair the execution.')], { checkTools: ['pwsh'] })
    f.shell.outcome = shellResult(failure)
    f.start(); await f.agent.whenIdle()
    const result = f.agent.session.snapshotEvents().find(e => e.type === 'tool/result' && e.data.message.toolCallId === 'check')!
    if (result.type !== 'tool/result') throw new Error('Missing shell result')
    expect(result.data.message.isError).toBe(false)
    expect(responses(f)[0]).toMatchObject({ status: 'check-required', issues: [{ issues: [issue] }] })
    expect(calls(f)).toEqual([])
  })

  it('accepts a completed foreground pwsh check with durable execution facts', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'pwsh', { command: 'controlled fixture', description: 'Run a controlled measurement' }),
      () => toolCallResponse('submit', 'premise_check', submission(f, 'supported')), textResponse('Continue within the checked range.')], { checkTools: ['pwsh'] })
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0].status).toBe('supported')
    const events = f.agent.session.snapshotEvents()
    const resultIndex = events.findIndex(e => e.type === 'tool/result' && e.data.message.toolCallId === 'check')
    const receiptIndex = events.findIndex(e => e.type === 'user/message' && e.data.source.kind === 'helper-checkpoint' && e.data.source.summary === 'Premise execution receipt')
    expect(receiptIndex).toBeGreaterThan(resultIndex)
    const { definition } = projectionFor(f)
    const beforeReceipt = events.slice(0, receiptIndex).reduce((state, event) => definition.apply(state, event), definition.init())
    expect(Review.assessSubmission(submission(f, 'supported'), beforeReceipt, projectionFor(f).config).status).toBe('check-required')
    const replay = events.reduce((state, event) => definition.apply(state, event), definition.init())
    expect(Review.assessSubmission(submission(f, 'supported'), replay, projectionFor(f).config).status).toBe('ready')
    expect(replay.evidence.find((pair: { callId: string }) => pair.callId === 'check').execution).toMatchObject({ status: 'completed', exitCode: 0, timedOut: false })
  })

  it.each(['unknown', 'background', 'aborted'])('refuses a %s canonical execution receipt', async mode => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Obtain a confirmed foreground result.')])
    if (mode === 'unknown') f.hooks.withMetadata = false
    if (mode === 'aborted') f.hooks.execution = { aborted: true }
    if (mode === 'background') f.agent.ctx.on('tools/post-execute', async (exec, _result, next) => {
      const decision = await next()
      return exec.name === 'evaluate' && decision.kind === 'accept'
        ? { ...decision, value: { kind: 'background', jobId: 'still-running' } } : decision
    })
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0].status).toBe('check-required')
    expect(calls(f)).toEqual([])
  })

  it('refuses execution receipts when final content changed after post-execute', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Obtain complete output.')])
    const tool = f.agent.ctx.tools.get('evaluate', f.agent)!
    tool.finalizeContent = () => [{ type: 'text', text: 'Later policy clipped the result.' }]
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0]).toMatchObject({ status: 'check-required', issues: [{ issues: ['result-changed-after-receipt'] }] })
    expect(calls(f)).toEqual([])
  })

  it('does not resurrect earlier checks when an old execution receipt is replayed after steering', async () => {
    const f = await setup([...baseSteps(), textResponse('First objective done.')])
    f.start(); await f.agent.whenIdle()
    const events = f.agent.session.snapshotEvents()
    const receipt = events.find(e => e.type === 'user/message' && e.data.source.kind === 'helper-checkpoint' && e.data.source.summary === 'Premise execution receipt')!
    const { definition } = projectionFor(f)
    const prior = events.reduce((state, event) => definition.apply(state, event), definition.init())
    const cleared = definition.apply(prior, { type: 'user/message', seq: 10000, data: { source: { kind: 'user' } } })
    expect(definition.apply(cleared, receipt).evidence).toEqual([])
  })

  it('invalidates older references on human steering without erasing spent budget', async () => {
    let f: Fixture
    let old: ReturnType<typeof submission>
    f = await setup([...baseSteps(), () => {
      old = submission(f)
      f.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'Different user objective.' }], source: { kind: 'user' } }))
      return textResponse('Accept new direction.')
    }, () => toolCallResponse('stale', 'premise_check', old), textResponse('Read new evidence.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0].status).toBe('check-required')
    const { definition } = projectionFor(f)
    const previous = { ...definition.init(), spentTokens: 42, calls: 1 }
    expect(definition.apply(previous, { type: 'user/message', seq: 500, data: { source: { kind: 'user' } } })).toMatchObject({ spentTokens: 42, calls: 1, evidence: [] })
  })

  it('does not consult using evidence already present before a manual Advisor call', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('manual', 'advisor', { reason: 'Unresolved sample coverage', question: 'What is missing?' }),
      textResponse('Measure population coverage.'), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Obtain new evidence.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    expect(calls(f)[0]).toMatchObject({ model: 'manual-large' })
    expect(responses(f)[0].status).toBe('duplicate')
  })

  it('shares the configured interval with manual calls even when a new check exists', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), toolCallResponse('manual', 'advisor', { reason: 'Coverage design', question: 'Which check?' }), textResponse('Measure coverage.'),
      toolCallResponse('new-check', 'evaluate', { attempt: 2 }),
      () => toolCallResponse('submit', 'premise_check', submission(f, 'inconclusive', { checkRefs: [resultRef(f, 'new-check')] })),
      textResponse('Continue local checks.')], { minConsultationIntervalMs: 600000 })
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    expect(responses(f)[0].status).toBe('cooldown')
  })

  it('denies direct manual Advisor calls before a check and after unchanged evidence was already consulted', async () => {
    const f = await setup([toolCallResponse('too-early', 'advisor', { reason: 'Setup', question: 'What now?' }), ...baseSteps(),
      toolCallResponse('allowed', 'advisor', { reason: 'Unresolved sample', question: 'Which check distinguishes coverage?' }),
      textResponse('Measure population coverage.'), toolCallResponse('repeat', 'advisor', { reason: 'Repeat', question: 'Same question.' }), textResponse('Check first.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    const denied = f.agent.session.snapshotEvents().filter(e => e.type === 'tool/result' && e.data.message.isError)
    expect(denied).toHaveLength(2)
    expect(JSON.stringify(denied)).toContain('Advisor prerequisite')
    expect(JSON.stringify(denied)).toContain('premise_check')
  })

  it('retains consultation cost across internal recovery turns and resets only on a new real user request', async () => {
    const f = await setup([textResponse('Done.')])
    const { definition } = projectionFor(f)
    const paid = { ...definition.init(), turn: 1, budgetTurn: 1, calls: 2, spentTokens: 500, unknownUsage: 1 }
    const nextTurn = definition.apply(paid, { type: 'turn/start', seq: 50, data: { turn: 2 } })
    const recovery = definition.apply(nextTurn, { type: 'user/message', seq: 51,
      data: { source: { kind: 'helper-checkpoint', summary: 'Delivery recovery' }, content: [{ type: 'text', text: 'Finish the report.' }] } })
    expect(recovery).toMatchObject({ calls: 2, spentTokens: 500, unknownUsage: 1, budgetTurn: 1 })
    const human = definition.apply(recovery, { type: 'user/message', seq: 52, data: { source: { kind: 'user' } } })
    expect(human).toMatchObject({ calls: 0, spentTokens: 0, unknownUsage: 0, budgetTurn: 2 })
  })

  it('reserves manual dispatch before provider resolution so parallel manual calls cannot both start', async () => {
    const f = await setup([...baseSteps(), textResponse('Ready to ask.'), 'hang-slow'])
    f.start(); await f.agent.whenIdle()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.agent.ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'advisor') { entered.resolve(); await release.promise }
      return next()
    })
    const controller = new AbortController()
    const request = { name: 'advisor', arguments: { reason: 'Measured ambiguity', question: 'What distinguishes the remaining explanations?' }, agent: f.agent, signal: controller.signal }
    const first = f.agent.ctx.tools.execute({ ...request, callId: ToolCallId('manual-parallel-a') })
    const second = f.agent.ctx.tools.execute({ ...request, callId: ToolCallId('manual-parallel-b') })
    await entered.promise
    const started = reviewStarted(f)
    release.resolve()
    await started
    controller.abort()
    const results = await Promise.all([first, second])
    expect(calls(f)).toHaveLength(1)
    expect(results.every(result => result.isError)).toBe(true)
    expect(results.some(result => result.isError && result.error.info?.code === 'PREMISE_CHECK_REQUIRED')).toBe(true)
    expect(f.ctx.agents.list()).toHaveLength(1)
  })

  it('rechecks evidence consumed while an admitted manual call waits for another policy', async () => {
    const f = await setup([...baseSteps(), textResponse('Ready to ask.'), textResponse('Measure population coverage.')])
    f.start(); await f.agent.whenIdle()
    const admitted = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (exec.callId === 'manual-delayed') {
        expect(decision.kind).toBe('allow')
        admitted.resolve()
        await release.promise
      }
      return decision
    }, { prepend: true })
    const request = { name: 'advisor', arguments: { reason: 'Measured ambiguity', question: 'What distinguishes the remaining explanations?' },
      agent: f.agent, signal: new AbortController().signal }
    const delayed = f.agent.ctx.tools.execute({ ...request, callId: ToolCallId('manual-delayed') })
    await admitted.promise
    const first = await f.agent.ctx.tools.execute({ ...request, callId: ToolCallId('manual-first') })
    expect(first.isError).toBe(false)
    release.resolve()
    const stale = await delayed
    expect(stale.isError).toBe(true)
    if (!stale.isError) throw new Error('Expected stale manual admission to fail')
    expect(stale.error.info?.code).toBe('PREMISE_CHECK_REQUIRED')
    expect(JSON.stringify(stale)).toContain('No new completed check')
    expect(calls(f)).toHaveLength(1)
    expect(f.adapter.requests.filter(request => request.model === 'manual-large')).toHaveLength(1)
  })

  it.each(['closing', 'finalizing'] as const)('refuses consultation in the %s phase', async phase => {
    let f: Fixture
    f = await setup([...baseSteps(), () => { f.analysisPhase.phase = phase; return toolCallResponse('submit', 'premise_check', submission(f)) }, textResponse('Finish.')])
    f.start(); await f.agent.whenIdle()
    expect(calls(f)).toEqual([])
    expect(responses(f)[0].status).toBe('inactive')
  })

  it('keeps other workspaces and children free of the checkpoint and its policy', async () => {
    const f = await setup([textResponse('Unrelated task.')], { workspace: resolve('.dsh/unrelated-workspace') })
    f.start(); await f.agent.whenIdle()
    expect(f.agent.ctx.tools.get('premise_check', f.agent)).toBeUndefined()
    expect(JSON.stringify(f.adapter.requests[0]!.messages)).not.toContain('Before adopting a new premise')
  })

  it.each(['policy', 'steering', 'cancel', 'dispose'])('cancels and joins a pending consultation on %s without delivering stale advice', async mode => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), 'hang-slow', textResponse('Continue after cancellation.'), textResponse('New task.')])
    const started = reviewStarted(f)
    f.start(); await started
    if (mode === 'policy') f.agent.session.append('helper/policy', { enabled: false, mode: 'normal' })
    if (mode === 'steering') f.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'New task.' }], source: { kind: 'user' } }))
    if (mode === 'cancel') f.agent.cancel({ kind: 'user' })
    if (mode === 'dispose') await projectionFor(f).entry.fiber!.dispose()
    await f.agent.whenIdle()
    expect(calls(f)).toMatchObject([{ status: 'aborted' }])
    expect(responses(f).some(r => r.status === 'advice')).toBe(false)
    expect(f.ctx.agents.list()).toHaveLength(1)
  })

  it('rejects a concurrent submission while the first owns a pending consultation', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), 'hang-slow', textResponse('Stopped.')])
    const started = reviewStarted(f)
    f.start(); await started
    const duplicate = await f.agent.ctx.tools.execute({ name: 'premise_check', callId: ToolCallId('concurrent-submit'), arguments: submission(f), agent: f.agent, signal: new AbortController().signal })
    expect(JSON.parse(duplicate.content.filter(c => c.type === 'text').map(c => c.text).join('')).status).toBe('busy')
    f.agent.cancel({ kind: 'user' }); await f.agent.whenIdle()
    expect(calls(f)).toHaveLength(1)
    expect(f.ctx.agents.list()).toHaveLength(1)
  })

  it('contains provider failure, accounts unknown usage conservatively, and does not retry unchanged evidence', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), () => { throw new Error('provider unavailable') },
      () => toolCallResponse('repeat', 'premise_check', submission(f)), textResponse('Keep uncertainty.')])
    f.start(); await f.agent.whenIdle()
    expect(responses(f).map(r => r.status)).toEqual(['consultation-failed', 'duplicate'])
    const { definition } = projectionFor(f)
    const replay = f.agent.session.snapshotEvents().reduce((state, event) => definition.apply(state, event), definition.init())
    expect(replay.calls).toBe(1)
    expect(replay.unknownUsage).toBe(1)
    expect(replay.spentTokens).toBeGreaterThan(32768)
    expect(replay.reservations).toEqual({})
    expect(calls(f)).toMatchObject([{ status: 'error' }])
  })

  it('reserves both delivery attempts before starting and refuses insufficient budgets', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('No paid call.')],
      { recoveryEnabled: true, maxTokensPerTurn: 40000 })
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0].status).toBe('budget-exhausted')
    expect(calls(f)).toEqual([])
    const { config } = projectionFor(f)
    expect(Review.reservation('{}', config)).toBeGreaterThan(32768 * 2 + 8192)
  })

  it('retains the reserve when recovery fails without usage after the initial request reported usage', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), maxTokensResponse('Initial fragment'),
      () => { throw new Error('delivery provider connection failed before usage') }, textResponse('Keep uncertainty.')], { recoveryEnabled: true })
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0].status).toBe('consultation-failed')
    expect(f.adapter.requests.filter(r => r.model === 'flash-review')).toHaveLength(2)
    expect(calls(f)).toMatchObject([{ status: 'error', usage: { inputTokens: 10, outputTokens: 'Initial fragment'.length } }])
    const { definition } = projectionFor(f)
    let state = definition.init()
    let reserved = 0
    for (const event of f.agent.session.snapshotEvents()) {
      state = definition.apply(state, event)
      if (event.type === 'helper/auto-start') reserved = Object.values(state.reservations)[0] as number
    }
    expect(reserved).toBeGreaterThan(32768 * 2 + 8192)
    expect(state).toMatchObject({ spentTokens: reserved, unknownUsage: 1, reservations: {} })
  })

  it('refuses an oversized selected packet without dropping evidence', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), textResponse('Read narrower evidence.')], { maxRequestBytes: 2000 })
    f.hooks.evaluation = 'x'.repeat(3000)
    f.start(); await f.agent.whenIdle()
    expect(responses(f)[0].status).toBe('check-required')
    expect(responses(f)[0].message).toContain('超过请求预算')
    expect(calls(f)).toEqual([])
  })

  it('delivers one bounded recovery of a truncated report and preserves the original limit event', async () => {
    let f: Fixture
    f = await setup([...baseSteps(), () => toolCallResponse('submit', 'premise_check', submission(f)), maxTokensResponse('Partial assessment'),
      textResponse('Complete assessment: population coverage is unknown.'), textResponse('Run a full scan.')], { recoveryEnabled: true })
    f.start(); await f.agent.whenIdle()
    const childRequests = f.adapter.requests.filter(r => r.model === 'flash-review')
    expect(childRequests.map(r => [r.reasoningEffort, r.maxTokens])).toEqual([['high', 32768], ['low', 8192]])
    expect(responses(f)[0]).toMatchObject({ status: 'advice', advice: 'Complete assessment: population coverage is unknown.' })
    expect(calls(f)).toMatchObject([{ status: 'completed' }])
    expect(f.ctx.agents.list()).toHaveLength(1)
  })
})
