/** Fixed Ghidra headless queries with selected Java, leased projects and bounded evidence. @module */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { adapterProcessFailure, adapterResultSchema, retainAdapterResult } from './tool-adapter-results.ts'
import { fileAsset } from './workbench/assessment.ts'
import { environmentPath, installation, runProcess, type ProcessResult } from './workbench/process.ts'
import type { AnalysisContext, AnalysisResult, SecurityEnvironment, ToolInstallation } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'
import { GhidraSessionProcess } from './ghidra-session-process.ts'
import { ghidraImportArguments, prepareGhidraAnalysisProfile, resolveGhidraAnalysisProfile, type GhidraAnalysisProfile } from './ghidra-analysis-profile.ts'

/** Deployment-owned resource budgets; a relative cacheDirectory resolves beneath the selected environment workspace. */
export interface GhidraHeadlessOptions {
  /** Host project-cache directory; relative paths resolve below the selected workspace and cannot contain hidden components. */
  cacheDirectory: string
  /** Maximum Java heap in mebibytes for each headless process. */
  maxHeapMb: number
  /** Maximum Ghidra analysis workers and collector threads; JVM compilation uses at least two threads. */
  maxCpu: number
  /** Ghidra automatic-analysis deadline in seconds; expiry marks the output incomplete. */
  analysisTimeoutSeconds: number
  /** Per-function decompiler deadline in seconds. */
  decompileTimeoutSeconds: number
  /** Idle time before a resident JVM is closed and its complete analysis is saved. */
  sessionIdleTimeoutMs: number
  /** Maximum resident analysis JVMs owned by this provider. */
  maxSessions: number
  /** Delay between reads of atomically published protocol files. */
  protocolPollIntervalMs: number
}
const optionsSchema = z.object({ cacheDirectory: z.string().min(1), maxHeapMb: z.number().int().positive(),
  maxCpu: z.number().int().positive(), analysisTimeoutSeconds: z.number().int().positive(),
  decompileTimeoutSeconds: z.number().int().positive(), sessionIdleTimeoutMs: z.number().int().positive(),
  maxSessions: z.number().int().positive(), protocolPollIntervalMs: z.number().int().positive() }).strict()
const installationSchema = z.object({ version: z.string().min(1), location: z.string().min(1), javaVersion: z.string().min(1),
  javaHome: z.string().min(1), architecture: z.string().min(1) }).strict()
/** Verified Ghidra distribution and the JDK selected in its installation pin. */
export type GhidraHeadlessInstallation = z.infer<typeof installationSchema>
type ProcessLimits = Pick<Parameters<typeof runProcess>[4], 'durationMs' | 'maxOutputBytes' | 'graceMs'>
const outputSchema = z.object({ format: z.literal('dsh-ghidra-headless-v1'), operation: z.string(), inputSha256: z.string(),
  ghidraVersion: z.string(), analysisTimedOut: z.boolean(), incomplete: z.boolean(), items: z.array(z.json()),
  nextOffset: z.number().int().nonnegative().nullable(), failure: z.string().optional() }).strict()
const cacheSchema = z.object({ format: z.literal('dsh-ghidra-cache-v1'), key: z.string(), program: z.literal('input') }).strict()
const keySchema = z.string().regex(/^[a-f0-9]{64}$/u)
const ownerSchema = z.object({ format: z.literal('dsh-ghidra-owner-v1'), key: keySchema,
  inputSha256: keySchema, scriptSha256: keySchema, ghidraVersion: z.string().min(1) }).strict()
/** Operator-visible state of one provider-owned analysis project. */
export interface GhidraHeadlessCache { key: string; complete: boolean; inUse: boolean }

function ghidraRoot(environment: SecurityEnvironment, tool: ToolInstallation): { directory: string; prefixArgs: string[] } {
  const args = tool.prefixArgs ?? []
  const utility = args[2]
  const suffix = '/Ghidra/Framework/Utility/lib/Utility.jar'
  const absolute = (path: string) => environment.kind === 'docker' ? posix.isAbsolute(path) : isAbsolute(path)
  if (!absolute(tool.command) || !/(?:^|[/\\])java(?:\.exe)?$/u.test(tool.command)
    || args.length !== 5 || args[0] !== '-Djava.system.class.loader=ghidra.GhidraClassLoader'
    || args[1] !== '-cp' || !utility || !absolute(utility) || !utility.replaceAll('\\', '/').endsWith(suffix)
    || args[3] !== 'ghidra.Ghidra' || args[4] !== 'ghidra.app.util.headless.AnalyzeHeadless')
    throw new Error('Ghidra headless requires an absolute selected Java executable and the fixed Ghidra Utility.jar launcher prefix')
  return { directory: utility.slice(0, -suffix.length), prefixArgs: args }
}

function javaProcess(ctx: Context, environment: SecurityEnvironment, tool: ToolInstallation, argv: string[],
  limits: ProcessLimits, signal: AbortSignal, stopContainerOnAbort = true): Promise<ProcessResult> {
  const selected = { ...tool, prefixArgs: argv }
  return runProcess(ctx, { ...environment, tools: environment.tools.map(item => item.id === tool.id ? selected : item) }, tool.id, [],
    { ...limits, signal, stopContainerOnAbort })
}

function processError(process: ProcessResult, subject: string): string | undefined {
  const failure = adapterProcessFailure(process)
  return failure ? subject + ': ' + failure + (process.stderr || process.stdout ? '\n' + (process.stderr || process.stdout) : '')
    : process.truncated ? subject + ' exceeded the output byte limit' : undefined
}

/** Inspect the selected JDK and distribution without starting analysis or changing saved Java preferences.
 * @param ctx - subprocess owner.
 * @param environment - local or running managed Docker environment.
 * @param tool - fixed Ghidra launcher pin; its command selects Java literally.
 * @param limits - process deadline, output and termination budgets.
 * @param signal - caller cancellation.
 * @returns actual Ghidra version and compatible selected JDK metadata; incompatible or incomplete installations reject.
 */
export async function inspectGhidraHeadlessInstallation(ctx: Context, environment: SecurityEnvironment, tool: ToolInstallation,
  limits: ProcessLimits, signal: AbortSignal): Promise<GhidraHeadlessInstallation> {
  if (environment.externalContainer || environment.kind === 'android') throw new Error('Ghidra headless inspection requires local or managed Docker execution')
  const root = ghidraRoot(environment, tool).directory
  const directory = await mkdtemp(join(environment.cwd, '.dsh-ghidra-probe-'))
  try {
    const path = join(directory, 'DshGhidraProbe.java')
    await writeFile(path, await readFile(new URL('../resources/ghidra/DshGhidraProbe.java', import.meta.url)), { flag: 'wx', mode: 0o600 })
    const process = await javaProcess(ctx, environment, tool, [environmentPath(environment, path), root], limits, signal, false)
    const failure = processError(process, 'Ghidra installation inspection')
    if (failure) throw new Error(failure)
    return installationSchema.parse(JSON.parse(process.stdout))
  } finally { await rm(directory, { recursive: true, force: true }) }
}

async function cacheRoot(environment: SecurityEnvironment, directory: string, create: true): Promise<string>
async function cacheRoot(environment: SecurityEnvironment, directory: string, create: false): Promise<string | undefined>
async function cacheRoot(environment: SecurityEnvironment, directory: string, create: boolean): Promise<string | undefined> {
  const path = resolve(environment.cwd, directory)
  const tail = relative(environment.cwd, path)
  if (!tail || (!isAbsolute(directory) && (tail === '..' || tail.startsWith('..' + sep))))
    throw new Error('Ghidra cacheDirectory must name an absolute cache directory or a child of the environment workspace')
  const projectPath = environmentPath(environment, path)
  if (projectPath.split(/[/\\]/u).some(part => part.startsWith('.')))
    throw new Error('Ghidra project paths cannot contain a directory starting with a dot; select a non-hidden cacheDirectory or workspace')
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  else {
    try { await lstat(path) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Ghidra cache root must not be a symbolic link')
  const canonical = await realpath(path)
  const canonicalTail = relative(await realpath(environment.cwd), canonical)
  if (!isAbsolute(directory) && (!canonicalTail || isAbsolute(canonicalTail) || canonicalTail === '..' || canonicalTail.startsWith('..' + sep)))
    throw new Error('Ghidra cache directory resolves outside the environment workspace')
  if (environmentPath(environment, canonical).split(/[/\\]/u).some(part => part.startsWith('.')))
    throw new Error('Ghidra project paths cannot contain a directory starting with a dot; select a non-hidden cacheDirectory or workspace')
  return canonical
}

async function ownsCache(entry: string, key: string): Promise<void> {
  const directory = await lstat(entry), marker = await lstat(join(entry, 'owner.json'))
  if (!directory.isDirectory() || directory.isSymbolicLink() || !marker.isFile() || marker.isSymbolicLink())
    throw new Error('Ghidra cache entry and owner marker must be regular owned paths')
  const owner = ownerSchema.parse(JSON.parse(await readFile(join(entry, 'owner.json'), 'utf8')))
  if (owner.key !== key) throw new Error('Ghidra cache owner identity mismatch')
}

async function leased(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** List owned project caches without creating directories or running tools.
 * @param environment - selected execution environment and Host workspace.
 * @param options - configured project-cache location and analysis bounds.
 * @returns verified cache identities; a missing cache directory returns an empty list.
 */
export async function listGhidraHeadlessCaches(environment: SecurityEnvironment,
  options: GhidraHeadlessOptions): Promise<GhidraHeadlessCache[]> {
  const root = await cacheRoot(environment, optionsSchema.parse(options).cacheDirectory, false)
  if (!root) return []
  const entries: GhidraHeadlessCache[] = []
  for (const key of (await readdir(root)).filter(name => keySchema.safeParse(name).success).sort()) {
    const entry = join(root, key)
    await ownsCache(entry, key)
    entries.push({ key, complete: await cached(entry, key), inUse: await leased(join(root, key + '.lease')) })
  }
  return entries
}

/** Remove one owned project after exclusively acquiring its analysis lease; selected programs and evidence are unchanged.
 * @param environment - selected execution environment and Host workspace.
 * @param options - configured project-cache location and analysis bounds.
 * @param key - exact SHA-256 identity returned by cache listing.
 * @returns completion after the owned directory and removal lease are released; active leases and unowned paths reject.
 */
export async function removeGhidraHeadlessCache(environment: SecurityEnvironment,
  options: GhidraHeadlessOptions, key: string): Promise<void> {
  keySchema.parse(key)
  const root = await cacheRoot(environment, optionsSchema.parse(options).cacheDirectory, false)
  if (!root) throw new Error('Ghidra cache directory does not exist')
  const lease = join(root, key + '.lease')
  try { await mkdir(lease, { mode: 0o700 }) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('Ghidra cache is leased; stop its analysis before removal')
    throw error
  }
  try {
    const entry = join(root, key)
    await ownsCache(entry, key)
    await removeEntry(entry)
  } finally { await rmdir(lease) }
}

async function removeEntry(path: string): Promise<void> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  if (!entry) return
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Ghidra cache entry must be an owned directory')
  await rm(path, { recursive: true, force: true })
}

async function cached(entry: string, key: string): Promise<boolean> {
  try {
    const info = await lstat(entry)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Ghidra cache entry must be an owned directory')
    const marker = cacheSchema.parse(JSON.parse(await readFile(join(entry, 'ready.json'), 'utf8')))
    if (marker.key !== key) throw new Error('Ghidra cache identity mismatch')
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

interface ResidentProject {
  key: string
  projectId: string
  environmentId: string
  entry: string
  lease: string
  selected: GhidraHeadlessInstallation
  scriptSha256: string
  process: GhidraSessionProcess
  directory: string
  cacheReused: boolean
  complete: boolean
  closing: Promise<void> | undefined
  failure: unknown
  pending: number
  tail: Promise<void>
  idleTimer: ReturnType<typeof setTimeout> | undefined
  input: string
  artifacts: AnalysisContext['artifacts']
  saved: boolean | undefined
  inputReleased: boolean
  directoryReleased: boolean
  cacheReleased: boolean
  leaseReleased: boolean
}

interface PreparedSession {
  profile: GhidraAnalysisProfile
  key: string
  root: string
  selected: GhidraHeadlessInstallation
  scriptSha256: string
  scripts: { name: string; bytes: Buffer }[]
  vmargs: string[]
  distribution: string
  launcher: string[]
  tool: ToolInstallation
}

async function waitForTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const gate = Promise.withResolvers<never>()
  const abort = () =>{  gate.reject(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  try { await Promise.race([previous, gate.promise]) } finally { signal.removeEventListener('abort', abort) }
}

/** Provider-owned resident programs; project leases span the complete JVM lifetime. */
export class GhidraHeadlessSessions {
  private readonly projects = new Map<string, ResidentProject>()
  private admission: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<AnalysisResult>>()
  private readonly options: GhidraHeadlessOptions

  constructor(private readonly ctx: Context, settings: GhidraHeadlessOptions, private readonly graceMs: number) {
    this.options = optionsSchema.parse(settings)
  }

  /** Execute a serialized query against one selected analysis identity.
   * @param request - approved semantic operation.
   * @param context - immutable sample and selected environment.
   * @param maxItems - maximum retained observations.
   * @returns bounded evidence and the resident-session identity.
   */
  run(request: AnalysisOperation, context: AnalysisContext, maxItems: number): Promise<AnalysisResult> {
    this.lifetime.signal.throwIfAborted()
    const operation = this.execute(request, context, maxItems)
    this.operations.add(operation)
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation))
    return operation
  }

  /** Release programs before their environment is stopped, repaired or updated.
   * @param environmentId - exact environment selection.
   * @returns completion after all selected JVMs and leases are released.
   */
  async closeEnvironment(environmentId: string): Promise<void> {
    await this.admission
    const selected = [...this.projects.values()].filter(project => project.environmentId === environmentId)
    await Promise.all(selected.map(async (project) => { await project.tail; await this.close(project, false) }))
  }

  /** Release resident programs after the owning security project stops its operations.
   * @param projectId - exact engagement identity.
   * @returns completion after its programs and project leases are released.
   */
  async closeProject(projectId: string): Promise<void> {
    await this.admission
    const selected = [...this.projects.values()].filter(project => project.projectId === projectId)
    await Promise.all(selected.map(async (project) => { await project.tail; await this.close(project, false) }))
  }

  /** Stop admission, cancel outstanding operations and await all owned processes and leases. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('Ghidra provider is stopping'))
    await Promise.allSettled([...this.operations])
    await this.admission
    const results = await Promise.allSettled([...this.projects.values()].map(project => this.close(project, false)))
    const failures: unknown[] = []
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
    if (failures.length) throw new AggregateError(failures, 'Ghidra provider cleanup remains incomplete')
  }

  private async prepare(request: AnalysisOperation, context: AnalysisContext): Promise<PreparedSession> {
    const { environment, signal } = context
    if (environment.externalContainer || environment.kind === 'android') throw new Error('Ghidra headless requires local or managed Docker execution')
    const tool = installation(environment, 'ghidra-headless')
    const { directory: distribution, prefixArgs: launcher } = ghidraRoot(environment, tool)
    const limits = { durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.graceMs }
    const selected = await inspectGhidraHeadlessInstallation(this.ctx, environment, tool, limits, signal)
    const supportJar = environment.kind === 'docker' ? posix.join(distribution, 'support', 'LaunchSupport.jar')
      : join(distribution, 'support', 'LaunchSupport.jar')
    const launch = await javaProcess(this.ctx, environment, tool, ['-cp', supportJar, 'LaunchSupport', distribution, '-vmargs'], limits, signal)
    const launchFailure = processError(launch, 'Ghidra launch settings')
    if (launchFailure) throw new Error(launchFailure)
    const vmargs = launch.stdout.split(/\r?\n/u).filter(Boolean)
    if (vmargs.some(arg => !arg.startsWith('-') || arg.includes('\0')) || !vmargs.includes('-Djava.system.class.loader=ghidra.GhidraClassLoader'))
      throw new Error('Ghidra LaunchSupport returned invalid JVM arguments')
    const scripts = await Promise.all(['DshHeadless.java', 'DshGhidraPrepare.java', 'DshGhidraRepair.java',
      'DshGhidraMipsSoftFloat.java', 'DshGhidraRiscvCallingConvention.java'].map(async name => ({
      name, bytes: await readFile(new URL('../resources/ghidra/' + name, import.meta.url)) })))
    const hash = createHash('sha256')
    for (const script of scripts) hash.update(script.name).update(script.bytes)
    const scriptSha256 = hash.digest('hex')
    const asset = fileAsset(context.asset)
    const profile = resolveGhidraAnalysisProfile(request.parameters.analysis)
    const key = createHash('sha256').update(JSON.stringify({ format: 'dsh-ghidra-session-v1', projectId: asset.engagementId, input: asset.artifact.sha256,
      environment: { id: environment.id, kind: environment.kind, image: environment.resolvedImageId,
        container: environment.containerId, cwd: environment.cwd },
      tool: { command: tool.command, prefixArgs: tool.prefixArgs, ...selected }, scriptSha256, vmargs, options: this.options, profile })).digest('hex')
    return { key, root: await cacheRoot(environment, this.options.cacheDirectory, true), selected, scriptSha256,
      scripts, vmargs, distribution, launcher, tool, profile }
  }

  private async acquire(prepared: PreparedSession, context: AnalysisContext): Promise<{ project: ResidentProject; reused: boolean }> {
    const previous = this.admission
    const gate = Promise.withResolvers<void>()
    this.admission = previous.then(() => gate.promise)
    await previous
    try {
      context.signal.throwIfAborted()
      const existing = this.projects.get(prepared.key)
      if (existing) {
        if (existing.failure) throw new Error('Ghidra session cleanup must complete before reuse: ' +
          (existing.failure instanceof Error ? existing.failure.message : JSON.stringify(existing.failure)))
        if (existing.closing) await existing.closing
        else {
          clearTimeout(existing.idleTimer)
          existing.pending++
          return { project: existing, reused: true }
        }
      }
      if (this.projects.size >= this.options.maxSessions) {
        const idle = [...this.projects.values()].find(project => project.pending === 0 && !project.closing)
        if (!idle) throw new Error('All Ghidra resident sessions are busy; wait for a query to finish')
        await this.close(idle, false)
      }
      return { project: await this.start(prepared, context), reused: false }
    } finally { gate.resolve() }
  }

  private async start(prepared: PreparedSession, context: AnalysisContext): Promise<ResidentProject> {
    const { key, root, selected, scriptSha256, scripts, vmargs, launcher, tool } = prepared
    const { environment } = context
    const entry = join(root, key), lease = join(root, key + '.lease')
    try { await mkdir(lease, { mode: 0o700 }) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new Error('Ghidra project is already leased; stop its owning session before reuse: ' + lease)
      throw error
    }
    let project: ResidentProject | undefined
    let input: string | undefined
    let owned = false
    try {
      if (await leased(entry)) { await ownsCache(entry, key); owned = true }
      const cacheReused = await cached(entry, key)
      if (!cacheReused) {
        if (owned) await removeEntry(entry)
        await mkdir(entry, { mode: 0o700 })
        owned = true
        await writeFile(join(entry, 'owner.json'), JSON.stringify({ format: 'dsh-ghidra-owner-v1', key,
          inputSha256: fileAsset(context.asset).artifact.sha256, scriptSha256, ghidraVersion: selected.version }), { flag: 'wx', mode: 0o600 })
      }
      const scriptDirectory = join(entry, 'scripts')
      if (!cacheReused) await mkdir(scriptDirectory, { mode: 0o700 })
      for (const script of scripts) {
        const path = join(scriptDirectory, script.name)
        if (!cacheReused) await writeFile(path, script.bytes, { flag: 'wx', mode: 0o600 })
        else if (!(await readFile(path)).equals(script.bytes)) throw new Error('Ghidra cached script identity changed; remove this cache after its session stops')
      }
      input = await context.artifacts.materialize(fileAsset(context.asset).artifact)
      const directory = await mkdtemp(join(entry, 'session-'))
      const profile = await prepareGhidraAnalysisProfile(prepared.profile, input)
      const analysisPath = join(directory, 'analysis.json')
      await writeFile(analysisPath, JSON.stringify(profile), { flag: 'wx', mode: 0o600 })
      const mapped = (path: string) => environmentPath(environment, path)
      const settingsDirectory = join(entry, 'settings'), temporaryDirectory = join(entry, 'temporary')
      await mkdir(settingsDirectory, { recursive: true, mode: 0o700 })
      await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
      const argv = [...vmargs, '-Xmx' + String(this.options.maxHeapMb) + 'm', '-XX:ParallelGCThreads=' + String(this.options.maxCpu),
        '-XX:CICompilerCount=' + String(Math.max(2, this.options.maxCpu)), '-Djava.awt.headless=true',
        '-Dapplication.settingsdir=' + mapped(settingsDirectory), '-Dapplication.cachedir=' + mapped(settingsDirectory),
        '-Dapplication.tempdir=' + mapped(temporaryDirectory), '-Djava.io.tmpdir=' + mapped(temporaryDirectory),
        ...launcher.slice(1), mapped(entry), 'analysis',
        ...(cacheReused ? ['-process', 'input', '-noanalysis', '-readOnly'] : ['-import', mapped(input), ...ghidraImportArguments(prepared.profile)]),
        '-analysisTimeoutPerFile', String(this.options.analysisTimeoutSeconds), '-max-cpu', String(this.options.maxCpu),
        '-scriptPath', mapped(scriptDirectory),
        ...(!cacheReused ? ['-preScript', mapped(join(scriptDirectory, 'DshGhidraPrepare.java')), mapped(analysisPath),
          '-postScript', mapped(join(scriptDirectory, 'DshGhidraRepair.java')), mapped(analysisPath)] : []),
        '-postScript', mapped(join(scriptDirectory, 'DshHeadless.java')), mapped(directory),
        '-log', mapped(join(directory, 'application.log')), '-scriptlog', mapped(join(directory, 'script.log'))]
      const process = new GhidraSessionProcess(this.ctx, { environment, tool, argv, directory,
        inputSha256: fileAsset(context.asset).artifact.sha256, ghidraVersion: selected.version,
        maxOutputBytes: context.maxOutputBytes, pollIntervalMs: this.options.protocolPollIntervalMs, graceMs: this.graceMs })
      project = { key, projectId: fileAsset(context.asset).engagementId, environmentId: environment.id,
        entry, lease, selected, scriptSha256, process, directory,
        cacheReused, complete: false, closing: undefined, failure: undefined, pending: 1, tail: Promise.resolve(), idleTimer: undefined,
        input, artifacts: context.artifacts, saved: undefined, inputReleased: false, directoryReleased: false,
        cacheReleased: false, leaseReleased: false }
      this.projects.set(key, project)
      await process.start(context.signal)
      project.complete = true
      return project
    } catch (error) {
      if (project) {
        const diagnostics = project.process.output(false, context.signal.aborted)
        await this.close(project, true)
        throw new Error(String(error) + '\n' + diagnostics.stderr + '\n' + diagnostics.stdout)
      }
      else {
        if (input) await context.artifacts.release(input)
        if (owned && !(await cached(entry, key))) await removeEntry(entry)
        await rmdir(lease)
      }
      throw error
    }
  }

  private async close(project: ResidentProject, force: boolean): Promise<void> {
    clearTimeout(project.idleTimer)
    project.closing ??= this.release(project, force)
    try { await project.closing } catch (error) { project.failure = error; project.closing = undefined; throw error }
  }

  private async release(project: ResidentProject, force: boolean): Promise<void> {
    project.saved ??= await project.process.close(force)
    if (!project.cacheReused && project.saved && project.complete && !(await cached(project.entry, project.key)))
      await writeFile(join(project.entry, 'ready.json'), JSON.stringify({ format: 'dsh-ghidra-cache-v1', key: project.key, program: 'input' }), { flag: 'wx', mode: 0o600 })
    if (!project.inputReleased) { await project.artifacts.release(project.input); project.inputReleased = true }
    if (!project.directoryReleased) { await rm(project.directory, { recursive: true, force: true }); project.directoryReleased = true }
    if (!project.cacheReleased) {
      if (!project.cacheReused && !(project.saved && project.complete)) await removeEntry(project.entry)
      project.cacheReleased = true
    }
    if (!project.leaseReleased) { await rmdir(project.lease); project.leaseReleased = true }
    this.projects.delete(project.key)
  }

  private async execute(request: AnalysisOperation, original: AnalysisContext, maxItems: number): Promise<AnalysisResult> {
    const deadline = new AbortController()
    const timer = setTimeout(() =>{  deadline.abort(new Error('Ghidra operation deadline exceeded')) }, original.durationMs)
    const context = { ...original, signal: AbortSignal.any([original.signal, this.lifetime.signal, deadline.signal]) }
    let project: ResidentProject | undefined, reused = false, entered = false, release: (() => void) | undefined
    let output: z.infer<typeof outputSchema> | undefined, process: ProcessResult | undefined
    let failure: string | undefined, cleanup: string | undefined
    let prepared: PreparedSession
    try { prepared = await this.prepare(request, context) } catch (error) { clearTimeout(timer); throw error }
    try {
      const acquired = await this.acquire(prepared, context)
      project = acquired.project; reused = acquired.reused
      const previous = project.tail, gate = Promise.withResolvers<void>()
      project.tail = previous.then(() => gate.promise)
      release = () =>{  gate.resolve() }
      await waitForTurn(previous, context.signal)
      context.signal.throwIfAborted()
      entered = true
      if (project.failure || project.closing) throw new Error('Ghidra session is unavailable after an earlier failure')
      const { analysis: _analysis, ...parameters } = request.parameters
      const candidate = outputSchema.parse(await project.process.query({ operation: request.operation.slice('ghidra-headless.'.length),
        inputSha256: fileAsset(context.asset).artifact.sha256, parameters, maxItems,
        maxBytes: Math.floor(context.maxOutputBytes / 2), decompileTimeoutSeconds: this.options.decompileTimeoutSeconds },
      context.maxOutputBytes, context.signal))
      if (candidate.operation !== request.operation.slice('ghidra-headless.'.length) || candidate.inputSha256 !== fileAsset(context.asset).artifact.sha256
        || candidate.ghidraVersion !== prepared.selected.version) throw new Error('Ghidra response does not match the selected sample, operation or version')
      if (candidate.items.length > maxItems) throw new Error('Ghidra response exceeds the semantic item limit')
      output = candidate
      failure = output.failure ?? (output.analysisTimedOut ? 'Ghidra auto-analysis reached its deadline; observations are incomplete' : undefined)
      process = project.process.output(deadline.signal.aborted, original.signal.aborted)
      if (output.analysisTimedOut) await this.close(project, true)
    } catch (error) {
      const cause: unknown = context.signal.aborted ? context.signal.reason : error
      failure = cause instanceof Error ? cause.message : String(cause)
      if (project && entered) {
        try { await this.close(project, true) } catch (error) { cleanup = String(error) }
        process = project.process.output(deadline.signal.aborted, original.signal.aborted)
      }
    } finally {
      clearTimeout(timer)
      release?.()
      if (project) {
        project.pending--
        if (project.pending === 0 && !project.closing && !project.failure) {
          const idle = project
          project.idleTimer = setTimeout(() => {
            void this.close(idle, false).catch((error: unknown) => { idle.failure = error })
          }, this.options.sessionIdleTimeoutMs)
          project.idleTimer.unref()
        }
      }
    }
    return retainGhidraResult(request, original, maxItems, prepared, project, reused, output, process, failure, cleanup)
  }
}

function retainGhidraResult(request: AnalysisOperation, context: AnalysisContext, _maxItems: number, prepared: PreparedSession,
  project: ResidentProject | undefined, reused: boolean, output: z.infer<typeof outputSchema> | undefined,
  process: ProcessResult | undefined, failure: string | undefined, cleanup: string | undefined): AnalysisResult {
  let retained = retainAdapterResult({ format: 'security-tool-result-v1', tool: 'ghidra-headless', operation: request.operation,
    environmentId: context.environment.id, toolVersion: prepared.selected.version, inputSha256: fileAsset(context.asset).artifact.sha256,
    items: output?.items ?? [], incomplete: !!failure || !!cleanup || !output || output.incomplete || !!process?.truncated,
    diagnostics: [process?.stderr, failure, cleanup].filter(Boolean).join('\n'),
    raw: { process: process ? { ...process } : null, scriptSha256: prepared.scriptSha256, cacheKey: prepared.key, reused,
      selected: prepared.selected, analysis: z.json().parse(prepared.profile),
      sessionId: project?.process.id ?? null, sessionReused: reused,
      cacheReused: project?.cacheReused ?? false, running: !!project && !project.closing && !project.failure && project.saved === undefined,
      analysisTimedOut: output?.analysisTimedOut ?? null, nextOffset: output?.nextOffset ?? null } }, context.maxOutputBytes)
  let page = adapterResultSchema.parse(JSON.parse(retained.bytes.toString('utf8')))
  const offset = request.parameters.offset
  while (typeof offset === 'number' && page.items.length < (output?.items.length ?? 0)) {
    const raw = page.raw && typeof page.raw === 'object' && !Array.isArray(page.raw) ? page.raw : {}
    const nextOffset = offset + page.items.length
    if (raw.nextOffset === nextOffset) break
    page.raw = raw.truncated ? { truncated: true, nextOffset } : { ...raw, nextOffset }
    retained = retainAdapterResult(page, context.maxOutputBytes)
    page = adapterResultSchema.parse(JSON.parse(retained.bytes.toString('utf8')))
  }
  return { ...retained, mediaType: 'application/json', toolVersion: prepared.selected.version,
    summary: 'Ghidra headless: ' + String(page.items.length) + ' retained observations', method: 'static',
    observationKind: ['decompile', 'disassemble', 'xrefs-to', 'xrefs-from'].some(action => request.operation.endsWith('.' + action)) ? 'implementation' : 'inventory',
    ...(failure ? { failure } : {}), ...(cleanup ? { cleanup } : {}) }
}
