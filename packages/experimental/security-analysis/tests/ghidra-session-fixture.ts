/** File-protocol JVM substitute with explicit startup, query and shutdown ownership. @module */
import { SubprocessRuntime, type SubprocessHandle, type SubprocessOutcome, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

const configSchema = z.object({ token: z.string(), sessionId: z.string(), inputSha256: z.string() })

/** Protocol fixture; every spawned worker is joined before its process range reports empty. */
export class GhidraFixtureSubprocess extends SubprocessRuntime {
  observed: string[][] = []
  queries: string[] = []
  outputPatch: Record<string, unknown> = {}
  readyPatch: Record<string, unknown> = {}
  version = '12.0.4'
  stdout = ''
  stderr = ''
  failExit: number | undefined
  ignoreClose = false
  beforeQuery: (() => Promise<void>) | undefined
  readonly stopped: Promise<void>[] = []
  readonly shutdowns: boolean[] = []
  private readonly lifetimes: AbortController[] = []

  /** Simulate a managed environment stopping outside the analysis provider. */
  stopEnvironment(): void { for (const lifetime of this.lifetimes) lifetime.abort(new Error('Fixture environment stopped')) }

  async terminalEnvironment() { return { platform: 'posix' as const } }
  async resolveExecutable(command: string) { return command }
  async spawnTerminal(): Promise<never> { throw new Error('Terminal execution is outside this fixture') }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.observed.push([...spec.argv])
    const position = spec.argv.findIndex(value => value.endsWith('DshHeadless.java'))
    const path = spec.argv[position + 1]
    if (position === -1 || !path) throw new Error('Expected resident Ghidra bridge arguments')
    const directory = path.startsWith('/workspace/') ? join(spec.cwd, path.slice('/workspace/'.length)) : path
    const stop = new AbortController()
    this.lifetimes.push(stop)
    const done = Promise.withResolvers<SubprocessOutcome>()
    let settled = false
    const perform = async () => {
      const config = configSchema.parse(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8')))
      if (this.failExit !== undefined) return { exitCode: this.failExit, signal: null }
      await writeFile(join(directory, 'ready.json'), JSON.stringify({ format: 'dsh-ghidra-ready-v1', ...config,
        ghidraVersion: this.version, analysisTimedOut: false, ...this.readyPatch }))
      for (;;) {
        stop.signal.throwIfAborted()
        const close = await optional(join(directory, 'close.json'))
        if (close && !this.ignoreClose) { this.shutdowns.push(true); return { exitCode: 0, signal: null } }
        const text = await optional(join(directory, 'request.json'))
        if (text) {
          const query = z.object({ id: z.string(), operation: z.string(), inputSha256: z.string(), token: z.string() })
            .parse(JSON.parse(text))
          this.queries.push(query.id)
          await unlink(join(directory, 'request.json'))
          if (this.beforeQuery) {
            const pending = this.beforeQuery()
            const abort = Promise.withResolvers<never>()
            const listener = () =>{  abort.reject(stop.signal.reason) }
            stop.signal.addEventListener('abort', listener, { once: true })
            try { await Promise.race([pending, abort.promise]) } finally { stop.signal.removeEventListener('abort', listener) }
          }
          await writeFile(join(directory, 'response.tmp'), JSON.stringify({ format: 'dsh-ghidra-headless-v1', ...query,
            ghidraVersion: this.version, analysisTimedOut: false, incomplete: false,
            items: [{ address: '0x401000', name: 'main' }], nextOffset: null, ...this.outputPatch }))
          await rename(join(directory, 'response.tmp'), join(directory, 'response.json'))
        }
        await delay(1, undefined, { signal: stop.signal })
      }
    }
    const worker = perform().then((value) => { done.resolve(value) }, (error: unknown) => {
      if (!stop.signal.aborted) this.stderr += String(error)
      this.shutdowns.push(false)
      done.resolve({ exitCode: stop.signal.aborted ? null : 1, signal: stop.signal.aborted ? 'SIGTERM' : null })
    }).finally(() => { settled = true })
    this.stopped.push(worker)
    return { stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
      collected: { stdout: { readFrom: from => ({ text: this.stdout.slice(from), nextOffset: this.stdout.length, lossy: false }) },
        stderr: { readFrom: from => ({ text: this.stderr.slice(from), nextOffset: this.stderr.length, lossy: false }) } },
      done: done.promise, terminate: () =>{  stop.abort(new Error('Fixture process terminated')) },
      waitForExit: async (signal) => {
        if (settled) return true
        const aborted = Promise.withResolvers<boolean>()
        const listener = () =>{  aborted.resolve(false) }
        if (signal?.aborted) return false
        signal?.addEventListener('abort', listener, { once: true })
        try { return await Promise.race([worker.then(() => true), aborted.promise]) }
        finally { signal?.removeEventListener('abort', listener) }
      } }
  }
}

async function optional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
