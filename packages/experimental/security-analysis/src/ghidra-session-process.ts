/** Owned Ghidra process and bounded private-file request transport. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { randomBytes, randomUUID } from 'node:crypto'
import { link, lstat, open, rename, unlink, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { runProcess, toolInvocation, type ProcessResult } from './workbench/process.ts'
import type { SecurityEnvironment, ToolInstallation } from './workbench/providers.ts'

const readySchema = z.object({ format: z.literal('dsh-ghidra-ready-v1'), token: z.string(), sessionId: z.string(),
  inputSha256: z.string(), ghidraVersion: z.string(), analysisTimedOut: z.boolean() }).strict()

/** Process launch coordinates already resolved by the analysis owner. */
export interface GhidraSessionLaunch {
  environment: SecurityEnvironment
  tool: ToolInstallation
  argv: string[]
  directory: string
  inputSha256: string
  ghidraVersion: string
  maxOutputBytes: number
  pollIntervalMs: number
  graceMs: number
}

/** Read a single regular protocol file within its byte allowance.
 * @param path - owned protocol path.
 * @param maximum - maximum UTF-8 file size.
 * @returns parsed JSON, or undefined when publication has not occurred.
 */
export async function readGhidraProtocol(path: string, maximum: number): Promise<unknown> {
  let info
  try { info = await lstat(path) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Ghidra protocol path must be a regular file')
  if (info.size > maximum) throw new Error('Ghidra protocol output exceeds its byte allowance')
  const file = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(maximum + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length)
      if (result.bytesRead === 0) break
      length += result.bytesRead
    }
    if (length > maximum) throw new Error('Ghidra protocol output exceeds its byte allowance')
    return JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally { await file.close() }
}

/** One headless JVM, with shutdown that retains its ownership until process exit. */
export class GhidraSessionProcess {
  /** Random identity included in authenticated protocol messages and retained query evidence. */
  readonly id = randomUUID()
  private readonly token = randomBytes(32).toString('hex')
  private handle: SubprocessHandle | undefined
  private outcome: SubprocessOutcome | undefined
  private processFailure: unknown
  private settled = false
  private stopping: Promise<boolean> | undefined
  private stdoutOffset = 0
  private stderrOffset = 0
  private sequence = 0

  constructor(private readonly ctx: Context, private readonly launch: GhidraSessionLaunch) {}

  /** Start the selected JVM and require its authenticated completed-analysis handshake.
   * @param signal - startup cancellation and deadline.
   * @returns completion after the imported program is ready.
   */
  async start(signal: AbortSignal): Promise<void> {
    const launch = this.launch
    await writeFile(join(launch.directory, 'config.json'), JSON.stringify({ format: 'dsh-ghidra-session-v1', token: this.token,
      sessionId: this.id, inputSha256: launch.inputSha256, maxRequestBytes: launch.maxOutputBytes,
      pollIntervalMs: launch.pollIntervalMs }), { flag: 'wx', mode: 0o600 })
    const invocation = toolInvocation(launch.environment, { ...launch.tool, prefixArgs: launch.argv })
    const command = await this.ctx.subprocess.resolveExecutable(invocation.command, {}, signal)
    signal.throwIfAborted()
    this.handle = this.ctx.subprocess.spawn({ argv: [command, ...invocation.prefixArgs], cwd: launch.environment.cwd,
      env: { ...(launch.environment.kind === 'docker' ? { PATH: dirname(command) + delimiter + (process.env.PATH ?? '') } : {}),
        ...(launch.tool.temporaryDirectory ? { TMP: launch.tool.temporaryDirectory, TEMP: launch.tool.temporaryDirectory } : {}) },
      graceMs: launch.graceMs, stdio: { stdin: 'ignore', stdout: { maxBytes: launch.maxOutputBytes }, stderr: { maxBytes: launch.maxOutputBytes } } })
    void this.handle.done.then((outcome) => { this.outcome = outcome; this.settled = true },
      (error: unknown) => { this.processFailure = error; this.settled = true })
    const ready = readySchema.parse(await this.waitForFile('ready.json', launch.maxOutputBytes, signal))
    if (ready.token !== this.token || ready.sessionId !== this.id || ready.inputSha256 !== launch.inputSha256
      || ready.ghidraVersion !== launch.ghidraVersion) throw new Error('Ghidra startup identity does not match the selected session, sample or distribution')
    if (ready.analysisTimedOut) throw new Error('Ghidra auto-analysis reached its deadline; the session cannot be reused')
  }

  private requireRunning(): void {
    if (this.processFailure) throw new Error('Ghidra process failed: ' +
      (this.processFailure instanceof Error ? this.processFailure.message : JSON.stringify(this.processFailure)))
    if (this.settled) throw new Error('Ghidra process exited before completing the request: ' + JSON.stringify(this.outcome))
    if (!this.handle) throw new Error('Ghidra process has not started')
  }

  private async waitForFile(name: string, maximum: number, signal: AbortSignal): Promise<unknown> {
    for (;;) {
      signal.throwIfAborted()
      this.requireRunning()
      const value = await readGhidraProtocol(join(this.launch.directory, name), maximum)
      if (value !== undefined) return value
      await delay(this.launch.pollIntervalMs, undefined, { signal })
    }
  }

  /** Submit one query; the owner serializes callers and closes the session after a transport failure.
   * @param query - fixed semantic query without credentials.
   * @param maximum - maximum response bytes for this operation.
   * @param signal - operation cancellation and deadline.
   * @returns authenticated semantic response without transport credentials.
   */
  async query(query: Record<string, unknown>, maximum: number, signal: AbortSignal): Promise<Record<string, unknown>> {
    this.requireRunning()
    if (this.stopping) throw new Error('Ghidra session is closing')
    const id = String(++this.sequence)
    const bytes = JSON.stringify({ ...query, id, token: this.token })
    if (Buffer.byteLength(bytes) > this.launch.maxOutputBytes) throw new Error('Ghidra request exceeds its byte allowance')
    const temporary = join(this.launch.directory, 'request.tmp')
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    signal.throwIfAborted()
    await rename(temporary, join(this.launch.directory, 'request.json'))
    const reply = z.record(z.string(), z.unknown()).parse(await this.waitForFile('response.json', maximum, signal))
    if (reply.token !== this.token || reply.id !== id) throw new Error('Ghidra response belongs to another request or session')
    await unlink(join(this.launch.directory, 'response.json'))
    const { token: _token, id: _id, ...output } = reply
    return output
  }

  /** Capture bounded diagnostic output since the previous query.
   * @param timedOut - independently observed request deadline.
   * @param cancelled - independently observed caller cancellation.
   * @returns process observations; null exitCode identifies a still-running JVM.
   */
  output(timedOut: boolean, cancelled: boolean): ProcessResult {
    const stdout = this.handle?.collected.stdout?.readFrom(this.stdoutOffset)
    const stderr = this.handle?.collected.stderr?.readFrom(this.stderrOffset)
    this.stdoutOffset = stdout?.nextOffset ?? this.stdoutOffset
    this.stderrOffset = stderr?.nextOffset ?? this.stderrOffset
    return { stdout: stdout?.text ?? '', stderr: stderr?.text ?? '', exitCode: this.outcome?.exitCode ?? null,
      signal: this.outcome?.signal ?? null, timedOut, cancelled, truncated: !!stdout?.lossy || !!stderr?.lossy }
  }

  /** Close the bridge, await project saving and stop the owned range if graceful exit fails.
   * @param force - skip saving after cancellation or invalid results.
   * @returns true only after a requested graceful close exited successfully.
   */
  close(force: boolean): Promise<boolean> {
    this.stopping ??= this.stop(force).catch((error: unknown) => { this.stopping = undefined; throw error })
    return this.stopping
  }

  private async stop(force: boolean): Promise<boolean> {
    const handle = this.handle
    if (!handle) return false
    let graceful = false
    let gracefulFailure: unknown
    let containerFailure: unknown
    if (!force && !this.settled) {
      const deadline = new AbortController()
      const timer = setTimeout(() =>{  deadline.abort() }, this.launch.graceMs)
      try {
        const temporary = join(this.launch.directory, 'close.tmp')
        await writeFile(temporary, JSON.stringify({ token: this.token }), { flag: 'wx', mode: 0o600 })
        await link(temporary, join(this.launch.directory, 'close.json'))
        await unlink(temporary)
        graceful = await handle.waitForExit(deadline.signal)
      } catch (error) { gracefulFailure = error } finally { clearTimeout(timer) }
    }
    if (!graceful) {
      handle.terminate()
      if (this.launch.environment.kind === 'docker' && this.launch.environment.containerId) {
        try { await this.stopContainer(this.launch.environment.containerId) } catch (error) { containerFailure = error }
      }
    }
    let failure: unknown
    try { this.outcome = await handle.done } catch (error) { failure = error }
    const deadline = new AbortController()
    const timer = setTimeout(() =>{  deadline.abort() }, this.launch.graceMs)
    let exited: boolean
    try { exited = await handle.waitForExit(deadline.signal) } finally { clearTimeout(timer) }
    if (!exited) throw new Error('Ghidra process did not reach quiescence; its project lease is retained')
    if (containerFailure) throw containerFailure instanceof Error ? containerFailure : new Error(JSON.stringify(containerFailure))
    if (failure) throw new Error('Ghidra process cleanup failed: ' + (failure instanceof Error ? failure.message : JSON.stringify(failure)))
    if (gracefulFailure) throw new Error('Ghidra graceful shutdown failed after its process stopped: ' +
      (gracefulFailure instanceof Error ? gracefulFailure.message : JSON.stringify(gracefulFailure)))
    return graceful && this.outcome?.exitCode === 0 && this.outcome.signal === null
  }

  private async stopContainer(containerId: string): Promise<void> {
    const limits = { signal: new AbortController().signal, durationMs: this.launch.graceMs, maxOutputBytes: this.launch.maxOutputBytes,
      graceMs: this.launch.graceMs, stopContainerOnAbort: false }
    const state = await runProcess(this.ctx, this.launch.environment, 'docker',
      ['inspect', '--type', 'container', '--format', '{{json .State.Running}}', containerId], limits)
    if (state.exitCode !== 0 || state.signal || state.cancelled || state.timedOut || state.truncated
      || !['true', 'false'].includes(state.stdout.trim()))
      throw new Error('Ghidra container state could not be confirmed: ' + JSON.stringify(state))
    if (state.stdout.trim() === 'false') return
    const stopped = await runProcess(this.ctx, this.launch.environment, 'docker', ['kill', containerId], limits)
    if (stopped.exitCode !== 0 || stopped.signal || stopped.cancelled || stopped.timedOut)
      throw new Error('Ghidra container shutdown could not be confirmed: ' + JSON.stringify(stopped))
  }
}
