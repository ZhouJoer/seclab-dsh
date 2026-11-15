/** Checkpoint adoption through the local plugin's real Loader and tool execution path. */
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { Session, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Llm, { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Fs from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import Subagents from '@deepseek-ai/dsh-subagent'
import Helper from '@deepseek-ai/dsh-helper'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import * as Review from './index.mjs'
import { checkpointAdmission, legacyCheckpoint } from './checkpoint.mjs'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const artifacts = resolve('.dsh/flare-context-study/direction-review/artifacts')
const original = 'coverage=3/5; sampled rows=2,4,6; omitted rows=unknown'
const checkpointSchema = z.object({ phase: z.string(), title: z.string(), summary: z.string(), reason: z.string(), next: z.string(),
  evidenceIds: z.array(z.string()), findingIds: z.array(z.string()) }).strict()
type Checkpoint = z.infer<typeof checkpointSchema>
const preparedSchema = z.object({ status: z.literal('prepared'), checkpoint: checkpointSchema })
const bodySchema = z.object({ status: z.string() }).passthrough()

class AnalysisPhaseFixture extends Service {
  phase: 'exploring' | 'closing' | 'finalizing' = 'exploring'
  persist?: (value: unknown) => Promise<{ committed: boolean; revision: number }>
  sourceRecords: Array<{ kind: 'evidence'; value: { id: string; source: { sessionId: string; callId: string; channel: string } } }> = []
  constructor(ctx: Context) { super(ctx, 'securityWorkbench') }
  view() { return { records: this.sourceRecords } }
  getAnalysisPhase() { return this.phase }
  async saveAnalysisCheckpoint(_agent: Agent, checkpoint: Checkpoint, _callId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    if (!this.persist) throw new Error('Missing fixture persistence owner')
    return this.persist(checkpoint)
  }
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], overrides: Record<string, unknown> = {}) {
  await mkdir(artifacts, { recursive: true })
  const root = await mkdtemp(join(artifacts, 'checkpoint-'))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = { llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, fs: Fs, 'working-directory': WorkingDirectory, subagents: Subagents,
    helper: Helper, 'agent-loop': AgentLoop, direction: Review, 'analysis-phase': AnalysisPhaseFixture }
  for (const [key, module] of Object.entries(modules)) ctx.loader.builtins[key] = module
  const config = { enabled: true, workspace: root, provider: 'mock', model: 'flash-review', checkTools: ['evaluate'],
    minConsultationIntervalMs: 0, recoveryEnabled: false, adoptionReviewEnabled: false, handoffReviewEnabled: false, ...overrides }
  const plain = ['llm', 'sessions', 'projections', 'system-prompt', 'tools', 'agents', 'fs', 'working-directory', 'subagents']
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
  const agent = await ctx.agentLoop.create(SessionId('checkpoint-parent'), { provider: 'mock', model: 'main' }, { cwd: root })
  const hooks = { failSave: false, readFails: false, raw: original, evaluation: 'coverage=5/5; odd rows=1', evaluationExitCode: 0, evaluations: 0, saves: [] as Checkpoint[] }
  const storage = join(root, 'saved-checkpoint.json')
  const persist = async (value: unknown) => {
    const checkpoint = checkpointSchema.parse(value)
    if (hooks.failSave) throw new Error('Fixture persistence failed before commit')
    await writeFile(storage, JSON.stringify(checkpoint))
    hooks.saves.push(checkpoint)
    return { committed: true, revision: hooks.saves.length }
  }
  agent.ctx.tools.register(defineTool({ name: 'read_data', description: 'Read the current sample and coverage.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { if (hooks.readFails) throw new Error('Fixture observation unavailable'); return hooks.raw } }))
  agent.ctx.tools.register(defineTool({ name: 'evaluate', description: 'Execute the full population check.', parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async () => {
      hooks.evaluations++
      return { kind: 'foreground', exitCode: hooks.evaluationExitCode, signal: null, timedOut: false, aborted: false,
        stdout: { text: hooks.evaluation, truncated: false }, stderr: { text: '', truncated: false } }
    } }))
  const string = { type: 'string', required: true } as const
  const list = { type: 'array', items: { type: 'string' }, required: true } as const
  const registerSaveTools = (owner: Agent) => {
    owner.ctx.tools.register(defineTool({ name: 'security_checkpoint', description: 'Save research progress.',
      parameters: { phase: string, title: string, summary: string, reason: string, next: string, evidenceIds: list, findingIds: list },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async args => persist(args) }))
    owner.ctx.tools.register(defineTool({ name: 'security_command', description: 'Apply a research command.', parameters: { command: string },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async args => {
        const command = z.object({ action: z.object({ kind: z.literal('checkpoint') }).passthrough() }).parse(JSON.parse(args.command))
        const { kind: _kind, ...checkpoint } = command.action
        return persist(checkpoint)
      } }))
  }
  registerSaveTools(agent)
  const phase = ctx.get('securityWorkbench')
  if (!(phase instanceof AnalysisPhaseFixture)) throw new Error('Missing fixture phase service')
  phase.persist = persist
  const start = (prompt = 'Investigate the supplied dataset, then save concise progress and the next useful experiment.') => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
  }
  cleanup.push(async () => { await writeFile(join(root, 'events.json'), JSON.stringify(agent.session.snapshotEvents(), null, 2)) })
  return { ctx, agent, adapter, root, hooks, storage, phase, start, registerSaveTools }
}
type Fixture = Awaited<ReturnType<typeof setup>>

function result(f: Fixture, callId: string) {
  const event = f.agent.session.snapshotEvents().find(row => row.type === 'tool/result' && row.data.message.toolCallId === callId)
  if (!event || event.type !== 'tool/result') throw new Error('Missing tool result: ' + callId)
  return event
}
const ref = (f: Fixture, callId: string) => 'r' + result(f, callId).seq
const resultText = (f: Fixture, callId: string) => result(f, callId).data.message.content
  .filter(block => block.type === 'text').map(block => block.text).join('\n')
const response = (f: Fixture, callId: string) => bodySchema.parse(JSON.parse(resultText(f, callId)))
const prepared = (f: Fixture, callId = 'prepare') => preparedSchema.parse(JSON.parse(resultText(f, callId))).checkpoint
const unreviewed = (): Checkpoint => ({ phase: 'assessment', title: 'Dataset coverage', summary: 'Every row is even.',
  reason: 'No odd rows found in the sample.', next: 'Exclude odd records.', evidenceIds: [], findingIds: [] })
function prepare(f: Fixture, overrides: Record<string, unknown> = {}) {
  return { action: 'prepare', phase: 'assessment', title: 'Dataset coverage',
    observations: [{ ref: ref(f, 'raw'), quote: original }], interpretation: 'The sample is even; population coverage is not established.',
    nextCheck: 'Scan all rows and compare the counted population with the source.',
    ifA: 'An odd row retracts the all-even interpretation.', ifB: 'A complete all-even scan supports only this dataset.', ...overrides }
}
function submission(f: Fixture) {
  return { action: 'submit', claim: 'Every row is even.', scope: 'The five source rows.',
    evidenceRefs: [ref(f, 'raw')], checkRefs: [ref(f, 'check')], explanationA: 'All rows are even.', expectedA: 'Full scan finds zero odd rows.',
    explanationB: 'The sample omitted an odd row.', expectedB: 'Full scan finds an odd row.', observed: 'Full coverage reports one odd row.', outcome: 'contradicted' }
}
const helperCalls = (f: Fixture) => f.ctx.sessionProjections.stateOf(f.agent.session, 'helper')!.calls
function contribution(f: Fixture) {
  const entry = [...f.ctx.loader.entries()].find(item => item.options.name === 'cordis:direction')
  if (!entry?.fiber) throw new Error('Missing local direction-review contribution')
  return { fiber: entry.fiber, definition: Review.projection(entry.fiber.config) }
}
const saveCall = (id: string, tool: string, checkpoint: Checkpoint) => toolCallResponse(id, tool,
  tool === 'security_checkpoint' ? checkpoint : { command: JSON.stringify({ operationId: id, expectedRevision: 0, action: { kind: 'checkpoint', ...checkpoint } }) })

describe('prepared research checkpoint adoption', () => {
  it.each(['security_checkpoint', 'security_command'])('preserves owned original references through legacy %s saves', async tool => {
    const f = await setup([toolCallResponse('raw', 'read_data', {}),
      saveCall('save', tool, { ...unreviewed(), evidenceIds: ['project-evidence'] }), textResponse('Saved, still unverified.')])
    f.phase.sourceRecords = [{ kind: 'evidence', value: { id: 'project-evidence',
      source: { sessionId: f.agent.session.id, callId: 'raw', channel: 'tool' } } }]
    f.start(); await f.agent.whenIdle()
    expect(resultText(f, 'save')).not.toMatch(/^Error:/)
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false,
      unavailableSourceRefs: [], bindings: [{ callId: 'raw', inputRef: 'project-evidence', currentRequest: true }] })
    expect(f.hooks.saves[0]?.evidenceIds).toEqual(['project-evidence'])
    expect(helperCalls(f)).toEqual([])
  })

  it('retains unavailable project history as unverified without inventing a same-session original', async () => {
    const f = await setup([toolCallResponse('raw', 'read_data', {}),
      saveCall('save', 'security_checkpoint', { ...unreviewed(), evidenceIds: ['older-project-evidence'] }), textResponse('Source unavailable.')])
    f.phase.sourceRecords = [{ kind: 'evidence', value: { id: 'older-project-evidence',
      source: { sessionId: 'another-session', callId: 'raw', channel: 'tool' } } }]
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [],
      unavailableSourceRefs: [{ inputRef: 'older-project-evidence', issue: 'no-completed-source' }] })
    expect(f.hooks.saves[0]?.evidenceIds).toEqual(['older-project-evidence'])
  })

  it('identifies mixed save/submit fields without requiring another evidence read', async () => {
    const f = await setup([toolCallResponse('raw', 'read_data', {}),
      toolCallResponse('mixed-fields', 'premise_check', { action: 'save', phase: 'assessment', title: 'Measured source coverage',
        claim: 'Only three rows were sampled.', evidenceRefs: ['raw'], nextCheck: 'Read the remaining rows.' }),
      toolCallResponse('correct-fields', 'premise_check', { action: 'save', phase: 'assessment', title: 'Measured source coverage',
        interpretation: 'Only three rows were sampled.', observations: [{ ref: 'raw' }], nextCheck: 'Read the remaining rows.' }),
      textResponse('The existing source is bound and the remaining coverage is unverified.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'mixed-fields')).toMatchObject({ status: 'check-required',
      missingFields: ['observations', 'interpretation'], unexpectedFields: ['claim', 'evidenceRefs'],
      fieldHints: { claim: expect.stringContaining('interpretation'), evidenceRefs: expect.stringContaining('observations:[{ref}]') } })
    expect(response(f, 'correct-fields')).toMatchObject({ status: 'saved', scientificallyVerified: false,
      adoption: { status: 'handoff-only' }, bindings: [{ callId: 'raw' }] })
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'tool/call' && event.data.name === 'read_data')).toHaveLength(1)
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'tool/call' && event.data.name === 'premise_check')).toHaveLength(2)
    expect(helperCalls(f)).toEqual([])
  })

  it('adapts legacy notes into saved unverified history without inventing evidence bindings', async () => {
    const legacy = unreviewed()
    const input = legacyCheckpoint(legacy)
    expect(input).toMatchObject({ action: 'save', observations: [], nextCheck: legacy.next })
    const f = await setup([toolCallResponse('save', 'premise_check', input), textResponse('Legacy analyst notes are saved without certifying them.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves[0]!.summary).toContain('未引用完整原始观察')
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(f.hooks.saves[0]!.reason).toContain(legacy.summary)
    expect(f.hooks.saves[0]!.reason).toContain(legacy.reason)
    expect(helperCalls(f)).toEqual([])
  })

  it('leaves invalid legacy parameters to their owning tool validation', () => {
    expect(legacyCheckpoint({ ...unreviewed(), phase: 'unknown-phase' })).toBeUndefined()
    expect(legacyCheckpoint({ ...unreviewed(), injectedField: 'not part of checkpoint fields' })).toBeUndefined()
  })

  it.each(['security_checkpoint', 'security_command'])('saves unprepared %s notes as unverified without inventing source bindings', async tool => {
    const f = await setup([saveCall('save', tool, unreviewed()), textResponse('Keep the assertion provisional.')])
    f.start(); await f.agent.whenIdle()
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(f.hooks.saves[0]!.summary).toContain('未引用完整原始观察')
    expect(helperCalls(f)).toEqual([])
  })

  it.each(['security_checkpoint', 'security_command'])('persists only the generated unverified fields through %s', async tool => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      () => saveCall('save', tool, prepared(f)), textResponse('Observation saved; interpretation remains tentative.')])
    f.start(); await f.agent.whenIdle()
    const saved = checkpointSchema.parse(JSON.parse(await readFile(f.storage, 'utf8')))
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(saved).toEqual(prepared(f))
    expect(saved.reason).toContain('UNVERIFIED')
    expect(saved.summary).toContain(original)
    expect(saved.next).toContain('odd row')
    expect(f.hooks.saves).toHaveLength(1)
    expect(helperCalls(f)).toEqual([])
  })

  it.each(['summary', 'reason', 'next', 'title'])('saves an altered %s as new unverified notes rather than reusing prepared evidence', async field => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      () => saveCall('save', 'security_checkpoint', { ...prepared(f), [field]: 'Every source row is verified even.' }), textResponse('The changed notes remain unverified.')])
    f.start(); await f.agent.whenIdle()
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(f.hooks.saves[0]!.summary).toContain('未引用完整原始观察')
  })

  it.each(['invented-quote', 'missing-ref', 'same-prediction'])('rejects %s in a proposed checkpoint', async mode => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f,
      mode === 'invented-quote' ? { observations: [{ ref: ref(f, 'raw'), quote: 'coverage=5/5; all rows even' }] }
        : mode === 'missing-ref' ? { observations: [{ ref: 'r999999', quote: original }] }
          : mode === 'same-prediction' ? { ifA: 'The test returns zero.', ifB: 'The test returns zero.' } : {})),
    textResponse('Preserve uncertainty until usable observations are available.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare').status).not.toBe('prepared')
    expect(f.hooks.saves).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })

  it('binds an analyst description without a quotation to an older complete result outside the cache', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}),
      ...Array.from({ length: 3 }, (_, i) => toolCallResponse('later-' + i, 'read_data', {})),
      () => toolCallResponse('prepare', 'premise_check', prepare(f, {
        observations: [{ ref: 'raw', description: 'Only the sampled rows have been counted; this does not cover the source.' }],
      })), () => saveCall('save', 'security_checkpoint', prepared(f)), textResponse('The source remains bound without copying its output.')],
    { maxEvidencePairs: 2, maxResultChars: 100 })
    f.hooks.raw = original + 'x'.repeat(6083 - original.length)
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare')).toMatchObject({ status: 'prepared', scientificallyVerified: false,
      bindings: [{ callId: 'raw', ref: ref(f, 'raw'), resultChars: 6083, recordedPartial: false, observationKind: 'analyst-description' }] })
    expect(prepared(f).summary).toContain('分析者描述')
    expect(prepared(f).reason).toContain('UNVERIFIED')
    expect(f.hooks.saves).toHaveLength(1)
    expect(helperCalls(f)).toEqual([])
  })

  it.each(['exploring', 'closing'] as const)('saves source-bound progress directly in %s without copying fields or consulting', async phase => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => {
      f.phase.phase = phase
      return toolCallResponse('save', 'premise_check', prepare(f, { action: 'save',
        observations: [{ ref: 'raw', description: 'The sample does not cover the full population.' }], ifA: undefined, ifB: undefined }))
    }, textResponse('Progress saved, uncertainty retained.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false,
      receipt: { committed: true, revision: 1 }, bindings: [{ callId: 'raw' }] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(checkpointSchema.parse(JSON.parse(await readFile(f.storage, 'utf8')))).toEqual(f.hooks.saves[0])
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'tool/call'
      && ['security_checkpoint', 'security_command'].includes(event.data.name))).toHaveLength(0)
    expect(helperCalls(f)).toEqual([])
  })

  it('saves more than two observations without discarding their bindings or consulting', async () => {
    let f: Fixture
    const sources = ['raw', 'second', 'third', 'fourth']
    f = await setup([...sources.map(id => toolCallResponse(id, 'read_data', {})),
      () => toolCallResponse('save', 'premise_check', prepare(f, { action: 'save',
        observations: sources.map(id => ({ ref: id, description: 'Observed part ' + id + '; interpretation remains unchecked.' })),
      })), textResponse('All source references are retained in the saved progress.')], { maxEvidencePairs: 2 })
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false,
      bindings: sources.map(callId => ({ callId, observationKind: 'analyst-description' })) })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.summary).toContain('来源绑定（非结论）')
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(helperCalls(f)).toEqual([])
  })

  it('identifies an unresolved reference while retaining usable references for the corrected save', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('other', 'read_data', {}),
      () => toolCallResponse('bad-save', 'premise_check', prepare(f, { action: 'save',
        observations: [{ ref: 'raw', description: 'First source.' }, { ref: 'missing', description: 'Second source.' }],
      })), () => toolCallResponse('save', 'premise_check', prepare(f, { action: 'save',
        observations: [{ ref: 'raw', description: 'First source.' }, { ref: 'other', description: 'Second source.' }],
      })), textResponse('The existing observations are saved without reading them again.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'bad-save')).toMatchObject({ status: 'check-required', unresolvedRefs: ['missing'],
      resolvedRefs: [{ callId: 'raw', ref: ref(f, 'raw') }] })
    expect(response(f, 'save')).toMatchObject({ status: 'saved', bindings: [{ callId: 'raw' }, { callId: 'other' }] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'tool/call' && event.data.name === 'read_data')).toHaveLength(2)
    expect(helperCalls(f)).toEqual([])
  })

  it('identifies the incorrect quotation without invalidating a second observation', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('other', 'read_data', {}),
      () => toolCallResponse('prepare', 'premise_check', prepare(f, {
        observations: [{ ref: 'raw', quote: original }, { ref: 'other', quote: 'Invented population count.' }],
      })), textResponse('Correct only the unsupported quotation, preserving its original reference.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare')).toMatchObject({ status: 'check-required', invalidQuoteRefs: ['other'],
      resolvedRefs: [{ callId: 'raw' }, { callId: 'other' }] })
    expect(f.hooks.saves).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })

  it('bounds saving by configured UTF-8 request bytes while retaining references across a shorter retry', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}),
      () => toolCallResponse('large-save', 'premise_check', prepare(f, { action: 'save', interpretation: '观'.repeat(1000) })),
      () => toolCallResponse('save', 'premise_check', prepare(f, { action: 'save' })),
      textResponse('The shorter description retains the original evidence.')], { maxRequestBytes: 2000 })
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'large-save')).toMatchObject({ status: 'check-required', maxRequestBytes: 2000 })
    expect(response(f, 'large-save').requestBytes).toBeGreaterThan(2000)
    expect(response(f, 'save')).toMatchObject({ status: 'saved', bindings: [{ callId: 'raw' }] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(helperCalls(f)).toEqual([])
  })

  it('saves mixed observations while labeling a nonzero check as unavailable in the handoff', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'evaluate', {}),
      () => toolCallResponse('save', 'premise_check', prepare(f, { action: 'save',
        observations: [{ ref: 'raw', description: 'Partial source.' }, { ref: 'check', description: 'An observation preceded the command failure.' }],
      })), textResponse('Saved partial results do not establish successful verification.')])
    f.hooks.evaluationExitCode = 1
    f.start(); await f.agent.whenIdle()
    expect(result(f, 'check').data.message.isError).not.toBe(true)
    expect(response(f, 'save')).toMatchObject({ status: 'saved', scientificallyVerified: false,
      bindings: [{ callId: 'raw' }, { callId: 'check', execution: { status: 'unavailable', exitCode: 1 } }] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.summary).toContain('执行不可用；分析者描述')
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(helperCalls(f)).toEqual([])
  })

  it('reports a direct save failure without returning a committed receipt', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => {
      f.hooks.failSave = true
      return toolCallResponse('save', 'premise_check', prepare(f, { action: 'save' }))
    }, textResponse('Persistence failed; the checkpoint is not saved.')])
    f.start(); await f.agent.whenIdle()
    expect(result(f, 'save').data.message.isError).toBe(true)
    expect(resultText(f, 'save')).not.toContain('"status":"saved"')
    expect(f.hooks.saves).toHaveLength(0)
    expect(helperCalls(f)).toEqual([])
  })

  it('accepts an exact partial quotation from the durable output despite cache cropping', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}),
      () => toolCallResponse('prepare', 'premise_check', prepare(f)), textResponse('This quotation does not assert complete coverage.')],
    { maxResultChars: 100 })
    f.hooks.raw = 'x'.repeat(3000) + original + 'x'.repeat(3000)
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare')).toMatchObject({ status: 'prepared', bindings: [{ observationKind: 'partial-quote' }] })
    expect(prepared(f).summary).toContain('局部原文摘录')
    expect(prepared(f).summary).toContain(original)
  })

  it('records a failed tool as a failed observation without claiming a completed check', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}),
      () => toolCallResponse('prepare', 'premise_check', prepare(f, { observations: [{ ref: 'raw', description: 'The source could not be read.' }] })),
      textResponse('The failure is retained as an unresolved blocker.')])
    f.hooks.readFails = true
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare')).toMatchObject({ status: 'prepared', bindings: [{ isError: true }] })
    expect(prepared(f).summary).toContain('工具失败')
    expect(prepared(f).reason).toContain('UNVERIFIED')
    expect(helperCalls(f)).toEqual([])
  })

  it('shortens storage summaries with explicit omission markers while retaining the full recorded input', async () => {
    const detail = 'Source coverage is incomplete. '.repeat(30)
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}),
      () => toolCallResponse('prepare', 'premise_check', prepare(f, {
        title: detail, observations: [{ ref: 'raw', description: detail }], interpretation: detail, nextCheck: detail,
      })), () => saveCall('save', 'security_checkpoint', prepared(f)), textResponse('The handoff is saved without a rewriting loop.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare')).toMatchObject({ status: 'prepared', shortenedFields: ['title', 'summary', 'reason', 'next'] })
    for (const key of ['title', 'summary', 'reason', 'next'] as const) {
      expect(prepared(f)[key].length).toBeLessThanOrEqual(key === 'title' ? 100 : 300)
      expect(prepared(f)[key]).toContain('有省略')
    }
    const call = f.agent.session.snapshotEvents().find(row => row.type === 'tool/call' && row.data.callId === 'prepare')
    if (call?.type !== 'tool/call') throw new Error('Missing preparation input')
    expect(JSON.parse(call.data.arguments).interpretation).toBe(detail)
    expect(prepared(f).reason).toContain('UNVERIFIED')
    expect(f.hooks.saves).toHaveLength(1)
  })

  it('saves a stale prepared draft as unbound notes while a fresh exact draft retains its original bindings', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      toolCallResponse('new-observation', 'read_data', {}), () => saveCall('stale-save', 'security_checkpoint', prepared(f)),
      () => toolCallResponse('fresh-prepare', 'premise_check', prepare(f)), () => saveCall('fresh-save', 'security_checkpoint', prepared(f, 'fresh-prepare')),
      textResponse('Saved against the current evidence.')])
    f.start(); await f.agent.whenIdle()
    expect(result(f, 'stale-save').data.message.isError).not.toBe(true)
    expect(response(f, 'stale-save')).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(result(f, 'fresh-save').data.message.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(2)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(f.hooks.saves[1]).toEqual(prepared(f, 'fresh-prepare'))
  })

  it('saves an earlier-request draft as unbound notes without carrying its prepared qualification forward', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      textResponse('Prepared but not saved.'), () => saveCall('stale-save', 'security_checkpoint', prepared(f)), textResponse('Earlier notes remain unverified in this request.')])
    f.start(); await f.agent.whenIdle()
    f.start('Investigate a different population.'); await f.agent.whenIdle()
    expect(result(f, 'stale-save').data.message.isError).not.toBe(true)
    expect(response(f, 'stale-save')).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
  })

  it('retries a failed save without falsely committing or consuming its preparation', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      () => { f.hooks.failSave = true; return saveCall('failed-save', 'security_checkpoint', prepared(f)) },
      () => { f.hooks.failSave = false; return saveCall('retry-save', 'security_checkpoint', prepared(f)) }, textResponse('The retry committed.')])
    f.start(); await f.agent.whenIdle()
    expect(result(f, 'failed-save').data.message.isError).toBe(true)
    expect(result(f, 'retry-save').data.message.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(1)
    expect(checkpointSchema.parse(JSON.parse(await readFile(f.storage, 'utf8')))).toEqual(prepared(f))
  })

  it('permits an explicitly unverified handoff in closing without an experiment or consultation', async () => {
    let f: Fixture
    f = await setup([() => {
      f.phase.phase = 'closing'
      return toolCallResponse('inspect', 'premise_check', { action: 'inspect' })
    }, () => toolCallResponse('prepare', 'premise_check', { action: 'prepare', phase: 'recon', title: 'Pending source access', observations: [],
      interpretation: 'The source has not been read; no exclusion is supported.', nextCheck: 'Read the source and count all records.',
      ifA: 'An unavailable source leaves the claim unresolved.', ifB: 'A complete source permits a coverage check.' }),
    () => saveCall('save', 'security_checkpoint', prepared(f)), textResponse('Unverified work saved for continuation.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'inspect').status).toBe('evidence')
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(f.hooks.evaluations).toBe(0)
    expect(helperCalls(f)).toEqual([])
  })

  it('links a completed contradictory assessment without certifying the interpretation', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'evaluate', {}),
      () => toolCallResponse('assessment', 'premise_check', submission(f)),
      () => toolCallResponse('prepare', 'premise_check', prepare(f, { assessmentRef: ref(f, 'assessment'), interpretation: 'The all-even exclusion is contradicted by the full scan.' })),
      () => saveCall('save', 'security_checkpoint', prepared(f)), textResponse('Retract the exclusion and keep its scope explicit.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'assessment')).toMatchObject({ status: 'contradicted', scientificallyVerified: false })
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).not.toContain('UNVERIFIED')
    expect(f.hooks.saves[0]!.reason.toLowerCase()).toContain('contradicted')
    expect(helperCalls(f)).toEqual([])
  })

  it('does not accept a raw result reference as an assessment', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f, { assessmentRef: ref(f, 'raw') })),
      textResponse('Only a recorded assessment can qualify the draft.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare').status).not.toBe('prepared')
    expect(f.hooks.saves).toEqual([])
  })

  it('marks direct executor saves as unverified without making them supply artificial observations', async () => {
    const f = await setup([textResponse('No research yet.')])
    f.start(); await f.agent.whenIdle()
    const outcome = await f.agent.ctx.tools.execute({ name: 'security_checkpoint', callId: ToolCallId('direct-save'),
      arguments: unreviewed(), agent: f.agent, signal: new AbortController().signal })
    expect(outcome.isError).not.toBe(true)
    if (outcome.isError) throw new Error('Expected an adapted direct save: ' + JSON.stringify(outcome))
    expect(outcome.value).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
  })

  it('identifies an exact prepared checkpoint after durable replay only within its original user request', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      textResponse('Prepared progress remains unsaved.')])
    f.start(); await f.agent.whenIdle()
    const checkpoint = prepared(f)
    const replayFile = join(f.root, 'replay.json')
    await writeFile(replayFile, JSON.stringify({ header: f.agent.session.header, events: f.agent.session.snapshotEvents() }))
    // Session.create validates the decoded header, envelopes, and surface transitions before replay.
    const decoded = JSON.parse(await readFile(replayFile, 'utf8')) as { header: SessionHeader; events: SessionEvent[] }
    const restored = Session.create(f.agent.id, decoded.events, decoded.header)
    const { definition } = contribution(f)
    const fold = () => restored.snapshotEvents().reduce((state, event) => definition.apply(state, event), definition.init())
    expect(checkpointAdmission(checkpoint, restored, fold())).toBeUndefined()
    expect(checkpoint.reason).toContain('UNVERIFIED')
    restored.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Investigate a new population.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(checkpointAdmission(checkpoint, restored, fold())).toContain('Use premise_check save')
    expect(f.hooks.saves).toEqual([])
  })

  it('removes checkpoint adaptation, prompt, and tool when the plugin unloads', async () => {
    const f = await setup([textResponse('Ready for an independent task.')])
    f.start(); await f.agent.whenIdle()
    const before = await f.ctx.systemPrompt.assemble(assembleContextFor(f.agent))
    expect(before.sections.some(section => section.name === 'local:premise-check')).toBe(true)
    expect(f.agent.ctx.tools.get('premise_check', f.agent)).toBeDefined()
    const request = { name: 'security_checkpoint', arguments: unreviewed(), agent: f.agent, signal: new AbortController().signal }
    const adapted = await f.agent.ctx.tools.execute({ ...request, callId: ToolCallId('before-unload') })
    expect(adapted.isError).not.toBe(true)
    if (adapted.isError) throw new Error('Expected an adapted save before unload: ' + JSON.stringify(adapted))
    expect(adapted.value).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    await contribution(f).fiber.dispose()
    const after = await f.ctx.systemPrompt.assemble(assembleContextFor(f.agent))
    expect(after.sections.some(section => section.name === 'local:premise-check')).toBe(false)
    expect(f.agent.ctx.tools.get('premise_check', f.agent)).toBeUndefined()
    const allowed = await f.agent.ctx.tools.execute({ ...request, callId: ToolCallId('after-unload') })
    expect(allowed.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(2)
    expect(f.hooks.saves[1]).toEqual(unreviewed())
  })

  it('treats another session\'s prepared text as unbound analyst notes rather than local evidence', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f)),
      textResponse('Prepared for this session.'), textResponse('A separate session has no prepared checkpoint.')])
    f.start(); await f.agent.whenIdle()
    const other = await f.ctx.agentLoop.create(SessionId('checkpoint-other'), { provider: 'mock', model: 'main' }, { cwd: f.root })
    f.registerSaveTools(other)
    other.followup(createUserMessage({ content: [{ type: 'text', text: 'Investigate the same dataset independently.' }], source: { kind: 'user' } }))
    await other.whenIdle()
    expect(other.ctx.tools.get('premise_check', other)).toBeDefined()
    const saved = await other.ctx.tools.execute({ name: 'security_checkpoint', callId: ToolCallId('cross-session-save'),
      arguments: prepared(f), agent: other, signal: new AbortController().signal })
    expect(saved.isError).not.toBe(true)
    if (saved.isError) throw new Error('Expected unbound notes from another session: ' + JSON.stringify(saved))
    expect(saved.value).toMatchObject({ status: 'saved', scientificallyVerified: false, bindings: [] })
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(helperCalls(f)).toEqual([])
  })

  it('accepts current call IDs for submission, observation, and assessment while saving canonical references', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'evaluate', {}),
      () => toolCallResponse('assessment', 'premise_check', { ...submission(f), evidenceRefs: ['raw'], checkRefs: ['check'] }),
      () => toolCallResponse('prepare', 'premise_check', prepare(f, {
        observations: [{ ref: 'raw', quote: original }], assessmentRef: 'assessment',
        interpretation: 'The all-even exclusion is contradicted by the full scan.',
      })), () => saveCall('save', 'security_checkpoint', prepared(f)), textResponse('Save the checked observation and retract the exclusion.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'assessment')).toMatchObject({ status: 'contradicted', scientificallyVerified: false })
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.summary).toContain(ref(f, 'raw') + ' ' + original)
    expect(f.hooks.saves[0]!.reason.toLowerCase()).toContain('contradicted')
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'tool/call'
      && event.data.name === 'premise_check' && JSON.parse(event.data.arguments).action === 'inspect')).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })

  it('refuses an observation call ID belonging to another session', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), textResponse('The observation belongs to this session.'),
      () => toolCallResponse('foreign-prepare', 'premise_check', prepare(f, { observations: [{ ref: 'raw', quote: original }] })),
      textResponse('Read this session\'s own evidence before preparing progress.')])
    f.start(); await f.agent.whenIdle()
    const other = await f.ctx.agentLoop.create(SessionId('alias-other'), { provider: 'mock', model: 'main' }, { cwd: f.root })
    other.followup(createUserMessage({ content: [{ type: 'text', text: 'Investigate the dataset independently.' }], source: { kind: 'user' } }))
    await other.whenIdle()
    expect(response({ ...f, agent: other }, 'foreign-prepare').status).toBe('check-required')
    expect(f.hooks.saves).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })

  it.each(['duplicate-check', 'overlapping-evidence'])('rejects %s when call ID and rN refer to the same result', async mode => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), toolCallResponse('check', 'evaluate', {}),
      () => toolCallResponse('assessment', 'premise_check', { ...submission(f),
        evidenceRefs: mode === 'overlapping-evidence' ? ['check'] : ['raw'],
        checkRefs: mode === 'duplicate-check' ? ['check', ref(f, 'check')] : [ref(f, 'check')],
      }), textResponse('Use distinct original evidence and executed checks.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'assessment').status).toBe('check-required')
    expect(f.hooks.saves).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })

  it.each(['verbatim', 'altered'])('handles a %s JSON string-leaf excerpt containing quotes and a newline', async mode => {
    const output = 'first="blue"\nsecond="green"'
    let f: Fixture
    f = await setup([toolCallResponse('check', 'evaluate', {}),
      () => toolCallResponse('prepare', 'premise_check', {
        action: 'prepare', phase: 'assessment', title: 'Output fields',
        observations: [{ ref: 'check', quote: mode === 'verbatim' ? output : output.replace('green', 'red') }],
        interpretation: 'These are two observed labels; their meaning remains unchecked.',
        nextCheck: 'Compare labels with the source records.', ifA: 'Matching labels preserve this observation.', ifB: 'A mismatch requires a corrected extraction.',
      }), textResponse('Only exact source text can be quoted.')])
    f.hooks.evaluation = output
    f.start(); await f.agent.whenIdle()
    expect(resultText(f, 'check')).not.toContain(output)
    if (mode === 'verbatim') {
      expect(response(f, 'prepare').status).toBe('prepared')
      expect(prepared(f).summary).toContain(ref(f, 'check') + ' ' + output)
    } else expect(response(f, 'prepare').status).toBe('check-required')
    expect(f.hooks.saves).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })

  it('saves an ordinary follow-up without competing predictions or a claimed discriminating experiment', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f, {
      observations: [{ ref: 'raw', quote: original }], nextCheck: 'Await the remaining source records before extending coverage.', ifA: undefined, ifB: undefined,
    })), () => saveCall('save', 'security_checkpoint', prepared(f)), textResponse('Pending source access is saved without an invented experiment.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare')).toMatchObject({ status: 'prepared', scientificallyVerified: false })
    expect(result(f, 'save').data.message.isError).not.toBe(true)
    expect(f.hooks.saves).toHaveLength(1)
    expect(f.hooks.saves[0]!.next).toContain('非区分性实验')
    expect(f.hooks.saves[0]!.next).not.toContain('A→')
    expect(f.hooks.saves[0]!.reason).toContain('UNVERIFIED')
    expect(helperCalls(f)).toEqual([])
  })

  it('rejects a one-sided prediction instead of inventing its alternative', async () => {
    let f: Fixture
    f = await setup([toolCallResponse('raw', 'read_data', {}), () => toolCallResponse('prepare', 'premise_check', prepare(f, { ifB: undefined })),
      textResponse('Provide both predictions or mark an ordinary follow-up.')])
    f.start(); await f.agent.whenIdle()
    expect(response(f, 'prepare').status).toBe('check-required')
    expect(f.hooks.saves).toEqual([])
    expect(helperCalls(f)).toEqual([])
  })
})
