/** Native account/model access and read-only Codex consultations. @module */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { NO_START_CAPABILITIES, type SubagentRun, type ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { codexAppServerArgv, DEFAULT_DISPOSE_GRACE_MS, disposeCodexChild, startCodexRun } from './run.ts'
import { CodexAppServerWire } from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional native Codex account and consultation provider. */
    codexConsultation: CodexConsultation
  }
}

/** Safe native metadata; authentication secrets remain owned by Codex. */
export class CodexConsultation extends Service {
  static inject = ['subprocess', 'subagents']
  private connection: Promise<{ wire: CodexAppServerWire; child: SubprocessHandle }> | undefined
  private readonly lifetime = new AbortController()

  /**
   * @param ctx Host subprocess and subagent services.
   */
  constructor(ctx: Context) {
    super(ctx, 'codexConsultation')
    ctx.effect(() => ctx.subagents.registerProvider({
      name: 'helper-codex', inheritsParentContext: false,
      capabilities: { ...NO_START_CAPABILITIES, agentOptions: true },
      start: request => this.start(request),
    }), 'codex consultation provider')
    ctx.effect(() => async () => {
      this.lifetime.abort()
      const connection = await this.connection?.catch(() => undefined)
      if (connection) await disposeCodexChild(connection.wire, connection.child)
    }, 'codex consultation lifetime')
  }

  private connect(): Promise<{ wire: CodexAppServerWire; child: SubprocessHandle }> {
    this.lifetime.signal.throwIfAborted()
    return this.connection ??= this.open().catch((error: unknown) => { this.connection = undefined; throw error })
  }

  private async open(): Promise<{ wire: CodexAppServerWire; child: SubprocessHandle }> {
    const child = this.ctx.subprocess.spawn({ argv: codexAppServerArgv(true), cwd: process.cwd(),
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: DEFAULT_DISPOSE_GRACE_MS })
    if (!child.stdout || !child.stdin) { child.terminate(); await child.waitForExit(); throw new Error('Codex requires piped stdio') }
    const wire = new CodexAppServerWire(child.stdout, child.stdin, 'read-only')
    // Drain diagnostics without forwarding account details into Host logs.
    child.stderr?.resume()
    void child.done.finally(() => { this.connection = undefined }).catch((error: unknown) => {
      // The wire reports process failures to callers; this observer only releases the cached connection.
      void error
    })
    try {
      wire.start()
      await wire.initialize(this.lifetime.signal)
      return { child, wire }
    } catch (error) {
      await disposeCodexChild(wire, child)
      throw error
    }
  }

  /**
   * Read current ChatGPT account state.
   * @returns Public account fields.
   */
  async account(): Promise<{
    loggedIn: boolean
    email?: string
    planType?: string
    login?: { loginId: string; status: 'pending' | 'completed' | 'failed'; error?: string }
  }> {
    return (await this.connect()).wire.readAccount(this.lifetime.signal)
  }

  /**
   * Read model choices from this installed Codex version.
   * @returns Model ids and supported efforts.
   */
  async models(): Promise<Array<{ id: string; name: string; efforts: string[] }>> {
    return (await this.connect()).wire.models(this.lifetime.signal)
  }

  /**
   * Begin official browser authentication.
   * @returns Login URL and cancellation identity.
   */
  async login(): Promise<{ authUrl: string; loginId: string }> {
    return (await this.connect()).wire.login(this.lifetime.signal)
  }

  /**
   * Cancel pending authentication.
   * @param loginId Identity returned by login.
   */
  async cancelLogin(loginId: string): Promise<void> {
    await (await this.connect()).wire.cancelLogin(loginId, this.lifetime.signal)
  }

  private async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const options = request.agentOptions
    if (options?.provider !== undefined || options?.maxTokens !== undefined) {
      throw new Error('Codex consultations accept model and reasoning effort; provider and output limits belong to native Codex configuration')
    }
    const cwd = request.parent.session.header.cwd
    if (!cwd) throw new Error('Codex consultation requires a workspace')
    const model = options?.model
    if (!model) throw new Error('Select a Codex helper model before consulting it')
    const connection = await this.connect()
    const entry = (await connection.wire.models(AbortSignal.any([request.signal, this.lifetime.signal]))).find(entry => entry.id === model)
    if (!entry) throw new Error(`Codex model ${model} is not available in the current account's model directory`)
    const effort = options.reasoningEffort
    if (effort !== undefined && !entry.efforts.includes(effort)) {
      throw new Error(`Codex model ${model} does not support reasoning effort ${effort}`)
    }
    request.signal.throwIfAborted()
    return startCodexRun(request, {
      cwd, model, ...effort === undefined ? {} : { reasoningEffort: effort },
      permissionMode: 'read-only', env: {}, disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      spawn: spec => this.ctx.subprocess.spawn(spec),
    })
  }
}
