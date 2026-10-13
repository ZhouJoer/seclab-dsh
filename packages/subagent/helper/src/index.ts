/** Opt-in, read-only expert consultations using DSH or native Codex. @module */
import { Context, type Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-subagent-codex'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { helperProjection } from './projection.ts'
import type { HelperCall, HelperSettings, HelperState } from './types.ts'
export type { HelperSettings, HelperCall, HelperState } from './types.ts'

const READ_TOOLS = new Set(['read', 'glob', 'grep', 'read_image'])
const PERSONA = 'You are a read-only expert adviser. Diagnose the submitted problem using the supplied evidence and available read-only tools. Explain findings, uncertainty, and concrete next steps. Do not modify files, execute programs, delegate, or claim to have applied changes. The parent agent performs implementation.'
const CODEX_PERSONA = 'You are a read-only expert adviser running in an enforced read-only sandbox with network access and permission elevation disabled. Diagnose the submitted problem and return evidence, uncertainty, and concrete advice. You may inspect local files using native read-only shell commands. Do not modify files, run builds or tests, access the network, delegate, or claim to have applied changes. Native Codex uses shell commands for file reading; DSH read/glob/grep tool names are not required. The parent agent performs implementation.'

/** Live settings; each consultation captures one complete selection. */
export interface Config {
  /** Initial availability for newly created top-level sessions. */
  enabled: Volatile<boolean>
  /** Consultation runtime sampled at the start of each call. */
  backend: Volatile<'api' | 'codex'>
  /** Existing DSH API provider id; credentials remain with that provider. */
  provider: Volatile<string>
  /** API adviser model id. */
  model: Volatile<string>
  /** API effort id, or empty for the provider default. */
  reasoningEffort: Volatile<string>
  /** Model advertised by the native Codex directory. */
  codexModel: Volatile<string>
  /** Codex effort id, or empty for the native default. */
  codexReasoningEffort: Volatile<string>
}

interface LocalMetrics { model?: string; reasoningEffort?: string; usage?: TokenUsage }

/** Helper runtime, authenticated native-account methods and scoped tool ownership. */
export class Helper extends TypertRemoteService {
  static inject = ['agents', 'tools', 'subagents', 'llm', 'systemPrompt', 'sessionProjections']
  static Config = Schema.object({
    enabled: Schema.boolean().default(false).volatile(),
    backend: Schema.union(['api', 'codex']).default('codex').volatile(),
    provider: Schema.string().default('').volatile(), model: Schema.string().default('').volatile(),
    reasoningEffort: Schema.string().default('high').volatile(),
    codexModel: Schema.string().default('gpt-6-astra').volatile(),
    codexReasoningEffort: Schema.string().default('high').volatile(),
  })
  private readonly installations = new Map<Agent, () => void>()
  private readonly metrics = new WeakMap<Agent, LocalMetrics>()

  /**
   * @param ctx Host services.
   * @param config User-owned consultation preferences.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'helper', { namespace: 'helper' })
    ctx.sessionProjections.register(helperProjection)
    ctx.effect(() => ctx.subagents.registerProvider({
      name: 'helper-api', inheritsParentContext: false,
      capabilities: { agentOptions: true, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
      start: request => startInProcessRun(request, { setup: (childCtx, child) => {
        const metrics: LocalMetrics = {}
        this.metrics.set(child, metrics)
        childCtx.on('session/event', (session, event) => {
          if (session === child.session) this.observeMetrics(metrics, event)
        })
        if (request.agentOptions?.reasoningEffort === undefined) delete child.options.reasoningEffort
        childCtx.tools.presentAs('native')
        childCtx.tools.guard(exec => READ_TOOLS.has(exec.name) ? undefined : 'The helper is a read-only adviser')
      } }),
    }), 'helper API provider')
    ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.origin === 'subagent') return
      const state = this.state(agent)
      if (state.enabled === null) agent.session.append('helper/policy', {
        enabled: agent.session.firstLiveSeq === 0 && this.config.enabled.get(),
      })
      this.reconcile(agent)
    })
    ctx.on('agent/disposed', ({ agent }) =>{  this.remove(agent) })
    ctx.effect(() => () => { for (const agent of this.installations.keys()) this.remove(agent) }, 'helper tool lifetime')
    ctx.inject(['commands'], commands => commands.commands.register({
      definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-helper'), name: 'helper',
      description: 'Enable or disable read-only expert consultations', input: { hint: 'on|off' },
      handler: ({ agent, rawInput }) => {
        const selection = rawInput.trim()
        if (agent.session.header.origin === 'subagent') return { kind: 'error', text: 'Helpers cannot delegate.' }
        if (selection !== 'on' && selection !== 'off') return { kind: 'error', text: 'Use /helper on or /helper off.' }
        agent.session.append('helper/policy', { enabled: selection === 'on' })
        this.reconcile(agent)
        return { kind: 'success', text: selection === 'on' ? 'Helper enabled.' : 'Helper disabled.' }
      },
    }))
    for (const agent of ctx.agents.list()) this.reconcile(agent)
  }

  private state(agent: Agent): HelperState {
    const state = this.ctx.sessionProjections.stateOf(agent.session, 'helper')
    if (!state) throw new Error('Helper requires its session projection')
    return state
  }

  private remove(agent: Agent): void {
    this.installations.get(agent)?.()
    this.installations.delete(agent)
  }

  private reconcile(agent: Agent): void {
    if (agent.session.header.origin === 'subagent' || !this.state(agent).enabled) { this.remove(agent); return }
    if (this.installations.has(agent)) return
    const tool = agent.ctx.tools.register(defineTool({
      name: 'helper',
      description: 'Consult the configured advanced model when you are stuck or need expert diagnosis. Supply the concrete problem, evidence, and attempted approaches. The adviser can read files but cannot modify them. Wait for its advice, then continue the task yourself. Do not repeat an unchanged question.',
      parameters: {
        reason: { type: 'string', required: true, description: 'Why expert help is needed.' },
        question: { type: 'string', required: true, description: 'A self-contained question for the adviser.' },
        context: { type: 'string', description: 'Relevant evidence, file paths, constraints, and excerpts; the adviser does not see this conversation.' },
        attempts: { type: 'string', description: 'Approaches already tried and their observed results.' },
      },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: (args, exec) => this.consult(args, exec),
    }))
    this.installations.set(agent, tool)
  }

  /**
   * Read the currently configured helper selection.
   * @returns Detached settings without credentials.
   */
  @Remote
  settings(): HelperSettings {
    return { enabled: this.config.enabled.get(), backend: this.config.backend.get(),
      provider: this.config.provider.get(), model: this.config.model.get(), reasoningEffort: this.config.reasoningEffort.get(),
      codexModel: this.config.codexModel.get(), codexReasoningEffort: this.config.codexReasoningEffort.get() }
  }

  private codex() {
    const provider = this.ctx.get('codexConsultation')
    if (!provider) throw new Error('Install and enable the Codex consultation plugin for this profile')
    return provider
  }

  /**
   * Read native ChatGPT login state.
   * @returns Public account fields.
   */
  @Remote
  account(): Promise<{ loggedIn: boolean; email?: string; planType?: string; login?: { loginId: string; status: 'pending' | 'completed' | 'failed'; error?: string } }> { return this.codex().account() }
  /**
   * Read native model choices.
   * @returns Model ids and supported reasoning efforts.
   */
  @Remote
  codexModels(): Promise<Array<{ id: string; name: string; efforts: string[] }>> { return this.codex().models() }
  /**
   * Begin official browser login.
   * @returns Login link and cancellation id.
   */
  @Remote
  login(): Promise<{ authUrl: string; loginId: string }> { return this.codex().login() }
  /**
   * Cancel pending login.
   * @param loginId Id from login.
   */
  @Remote
  cancelLogin(loginId: string): Promise<void> { return this.codex().cancelLogin(loginId) }

  private async consult(
    args: { reason: string; question: string; context?: string; attempts?: string }, exec: ToolRunContext,
  ): Promise<string> {
    const agent = exec.agent
    if (agent === undefined) throw new Error('Helper requires a session')
    if (agent.session.header.origin === 'subagent' || !this.state(agent).enabled) {
      throw new Error('Helper is disabled for this session')
    }
    const settings = this.settings()
    const api = settings.backend === 'api'
    const model = api ? settings.model : settings.codexModel
    const effort = api ? settings.reasoningEffort : settings.codexReasoningEffort
    const record: HelperCall = { callId: exec.callId, backend: settings.backend, model,
      rootCallId: exec.rootCallId,
      ...effort === '' ? {} : { reasoningEffort: effort }, startedAt: Date.now(), status: 'running' }
    agent.session.append('helper/start', record)
    let run: SubagentRun | undefined
    let result: SubagentResult | undefined
    let failure: unknown
    try {
      if (!model || (api && !settings.provider)) throw new Error('Configure the helper model before using it')
      const options = { model, ...effort === '' ? {} : { reasoningEffort: ReasoningEffortId(effort) },
        ...api ? { provider: settings.provider } : {} }
      if (api) await this.ctx.llm.resolveCallConfig({ ...options, provider: settings.provider }, exec.signal)
      const allow = [...READ_TOOLS].filter(name => agent.ctx.tools.get(name, agent) !== undefined)
      run = await this.ctx.subagents.start(api ? 'helper-api' : 'helper-codex', {
        parent: agent, signal: exec.signal, label: args.reason, agentOptions: options,
        prompt: [{ type: 'text', text: `${api ? PERSONA : CODEX_PERSONA}\n\nReason: ${args.reason}\nQuestion: ${args.question}\nAttempts: ${args.attempts ?? ''}\nContext: ${args.context ?? ''}` }],
        ...api ? { persona: PERSONA, toolFilter: { allow }, maxDepth: 1 } : {},
      })
      result = await run.result
      if (result.stopReason !== 'completed') throw new Error(result.diagnostic ?? `Helper ended: ${result.stopReason}`)
      return result.output.filter(block => block.type === 'text').map(block => block.text).join('\n')
    } catch (error) { failure = error; throw error }
    finally {
      try { await run?.dispose() }
      catch (error) {
        if (failure !== undefined) throw new AggregateError([failure, error], 'Helper failed and could not release its child')
        failure = error
        throw error
      }
      finally {
        const metrics = run?.localAgent ? this.metrics.get(run.localAgent) : result
        agent.session.append('helper/end', {
          ...record, status: exec.signal.aborted ? 'aborted' : failure ? 'error' : 'completed',
          elapsedMs: Math.max(0, Date.now() - record.startedAt),
          ...run?.localAgent ? { childSessionId: run.localAgent.session.id } : {},
          ...metrics?.model === undefined ? {} : { model: metrics.model },
          ...metrics?.reasoningEffort === undefined ? {} : { reasoningEffort: metrics.reasoningEffort },
          ...metrics?.usage === undefined ? {} : { usage: metrics.usage },
        })
      }
    }
  }

  private observeMetrics(metrics: LocalMetrics, event: SessionEvent): void {
    if (event.type === 'request/header') {
      metrics.model = event.data.header.config.model
      const effort = event.data.header.config.reasoningEffort
      if (effort === undefined) delete metrics.reasoningEffort
      else metrics.reasoningEffort = effort
    }
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const next = event.type === 'assistant/message' && event.data.usage !== undefined
        ? event.data.usage : lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
      if (next) {
        const usage = metrics.usage ??= { inputTokens: 0, outputTokens: 0 }
        usage.inputTokens += next.inputTokens; usage.outputTokens += next.outputTokens
        for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'] as const) {
          if (next[key] !== undefined) usage[key] = (usage[key] ?? 0) + next[key]
        }
      }
    }
  }
}

export default Helper
