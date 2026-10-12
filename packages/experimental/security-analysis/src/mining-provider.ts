/** Approved sanitizer builds and PoC executions in a managed mining container. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import { runProcess, environmentPath, type ProcessResult } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult, SecurityEnvironment } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'

/** Mining subprocess cleanup policy. */
export interface Config {
  graceMs: number
  /** Maximum PoC standard-input bytes supplied through a plan. */
  maxInputBytes: number
}
/** Plugin identity. */
export const name = 'experimental-security-mining'
/** Project approval and owned mining execution. */
export const inject = ['securityWorkbench', 'subprocess']
/** Cleanup grace and PoC input bounds. */
export const Config: Schema<Config> = Schema.object({
  graceMs: Schema.number().step(1).min(1).default(3000),
  maxInputBytes: Schema.number().step(1).min(1).default(262144),
})

const buildTag = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)
const stepSchema = z.object({ tool: z.string().min(1).max(64), args: z.array(z.string().max(1024)).min(1).max(32) }).strict()
const buildShape = { sourceDir: z.string().min(1), buildTag, steps: z.array(stepSchema).min(1).max(8) }
const buildProposal = z.object(buildShape).strict()
const buildInput = z.object({ ...buildShape, buildRoot: z.string().min(1).optional() }).strict()
const buildParameters = buildInput.required({ buildRoot: true })
const memberPath = z.string().min(1).refine(value =>
  !value.includes('\\') && !value.includes(':') && !value.includes('\0') &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Expected a relative build path')
const runShape = { buildTag, program: memberPath, args: z.array(z.string().max(1024)).max(32).default([]),
  input: z.string().max(262144).optional() }
const runProposal = z.object(runShape).strict()
const runInput = z.object({ ...runShape, buildRoot: z.string().min(1).optional() }).strict()
const runParameters = runInput.required({ buildRoot: true })

function requireManagedContainer(environment: SecurityEnvironment): string {
  if (environment.kind !== 'docker' || environment.externalContainer || !environment.exchangeRoot)
    throw new Error('Mining requires a managed Docker environment with a writable exchange mount')
  return environment.exchangeRoot
}

/**
 * Replace declared path tokens with resolved Host paths mapped into the container mounts.
 * @param args - approved argv entries.
 * @param paths - exact token replacements.
 * @returns argv with every token occurrence substituted.
 */
function substituteTokens(args: readonly string[], paths: { sourceDir: string; buildRoot: string }): string[] {
  return args.map(arg => arg
    .replaceAll('{sourceDir}', paths.sourceDir)
    .replaceAll('{buildRoot}', paths.buildRoot))
}

/**
 * Verify one directory stays inside the selected workspace root.
 * @param path - candidate directory.
 * @param root - enclosing workspace root.
 */
function requireInside(path: string, root: string): void {
  const tail = relative(root, path)
  if (!isAbsolute(path) || tail === '..' || tail.startsWith('..' + sep) || isAbsolute(tail))
    throw new Error('Mining path is outside the selected environment workspace')
}

/**
 * Bound a JSON evidence payload by shrinking its largest stream.
 * @param raw - collected process facts.
 * @param maxOutputBytes - complete result budget.
 * @returns bytes that fit the evidence budget.
 */
function boundedJson(raw: ProcessResult & { steps?: unknown[] }, maxOutputBytes: number): Buffer {
  let bytes = Buffer.from(JSON.stringify(raw))
  while (bytes.length > maxOutputBytes && (raw.stdout.length || raw.stderr.length)) {
    const field = raw.stdout.length >= raw.stderr.length ? 'stdout' : 'stderr'
    raw[field] = raw[field].slice(0, Math.floor(raw[field].length / 2))
    bytes = Buffer.from(JSON.stringify(raw))
  }
  return bytes
}

/** Builds and executes reproduction programs inside the managed mining container. */
export class MiningProvider implements AnalysisProvider {
  readonly id = 'mining'
  readonly operations = ['build', 'run']
  readonly inputGuide = 'Vulnerability reproduction in a managed Docker mining environment: propose one build or one run. build parameters: sourceDir (absolute Host directory inside the environment workspace), buildTag (unique short identity for this build tree) and steps, an ordered argv list. Each step selects a tool registered in that environment (cmake, make, gcc, python) with literal arguments; {sourceDir} and {buildRoot} tokens are replaced by the resolved Host paths, which map to the container mounts. Add sanitizers explicitly, for example -DCMAKE_C_FLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1" and -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address". run parameters: buildTag, program (path relative to that build root), args and optional input text supplied on stdin within the configured byte limit. Preparation measures the source directory, creates an isolated build root and verifies the program exists. A crashing or sanitizer-terminating run is recorded as an observation, not a provider failure; keep the complete stderr including sanitizer reports. Validate a hypothesis by running the same PoC against vulnerable and fixed builds and recording both evidence records. Autotools sources run through sh configure; source trees stay read-only and all outputs belong to the build root.'
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  resourceKey(request: AnalysisOperation): string | null {
    const tag = z.looseObject({ buildTag: z.string().min(1) }).safeParse(request.parameters)
    return 'mining:' + (tag.success ? tag.data.buildTag : 'unresolved')
  }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    const exchangeRoot = requireManagedContainer(context.environment)
    if (request.script) throw new Error('Mining executes structured steps; supply parameters, not a script')
    if (request.operation === 'build') {
      const args = buildInput.parse(request.parameters)
      const buildRoot = join(exchangeRoot, 'mining', args.buildTag)
      if (args.buildRoot !== undefined && args.buildRoot !== buildRoot) throw new Error('Mining build root disagrees with the environment exchange mount')
      const known = new Set(context.environment.tools.map(tool => tool.id))
      for (const step of args.steps)
        if (!known.has(step.tool)) throw new Error('Build step selects an unregistered tool: ' + step.tool)
      const parameters = buildParameters.parse({ ...args, buildRoot,
        steps: args.steps.map(step => ({ ...step, args: substituteTokens(step.args, { sourceDir: args.sourceDir, buildRoot }) })) })
      return { ...request, parameters, impact: 'analysis-write' }
    }
    if (request.operation === 'run') {
      const { input, ...args } = runInput.parse(request.parameters)
      if (input !== undefined && Buffer.byteLength(input) > this.config.maxInputBytes)
        throw new Error('Mining input exceeds the configured byte limit')
      const buildRoot = join(exchangeRoot, 'mining', args.buildTag)
      if (args.buildRoot !== undefined && args.buildRoot !== buildRoot) throw new Error('Mining build root disagrees with the environment exchange mount')
      return { ...request, parameters: { buildTag: args.buildTag, program: args.program, args: args.args, buildRoot,
        ...(input === undefined ? {} : { input }) }, impact: 'analysis-write' }
    }
    throw new Error('Unsupported mining operation')
  }
  async prepare(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation> {
    if (request.operation === 'build') {
      const args = buildProposal.parse(request.parameters)
      const sourceDir = await realpath(args.sourceDir)
      requireInside(sourceDir, await realpath(context.environment.cwd))
      const buildRoot = join(requireManagedContainer(context.environment), 'mining', args.buildTag)
      await mkdir(buildRoot, { recursive: true, mode: 0o700 })
      return this.resolve({ ...request, parameters: { ...args, sourceDir, buildRoot,
        steps: args.steps.map(step => ({ ...step, args: substituteTokens(step.args, { sourceDir, buildRoot }) })) } }, context)
    }
    if (request.operation === 'run') {
      const { input, ...args } = runProposal.parse(request.parameters)
      const buildRoot = join(requireManagedContainer(context.environment), 'mining', args.buildTag)
      try { await realpath(buildRoot) }
      catch (_error) { throw new Error('Mining build root is absent; run its build plan first') }
      const program = join(buildRoot, args.program)
      requireInside(program, buildRoot)
      if (!(await stat(program)).isFile()) throw new Error('Mining program is absent from the selected build root')
      return this.resolve({ ...request, parameters: { ...args, buildRoot,
        ...(input === undefined ? {} : { input }) } }, context)
    }
    throw new Error('Unsupported mining operation')
  }
  private async verify(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation> {
    const resolved = this.resolve(request, context)
    if (request.operation === 'build') {
      const args = buildParameters.parse(resolved.parameters)
      const sourceDir = await realpath(args.sourceDir)
      requireInside(sourceDir, await realpath(context.environment.cwd))
      if (sourceDir !== args.sourceDir) throw new Error('Mining source directory changed; prepare a new plan')
      await mkdir(args.buildRoot, { recursive: true, mode: 0o700 })
      return resolved
    }
    const args = runParameters.parse(resolved.parameters)
    try { await realpath(args.buildRoot) }
    catch (_error) { throw new Error('Mining build root is absent; run its build plan first') }
    const program = join(args.buildRoot, args.program)
    requireInside(program, args.buildRoot)
    if (!(await stat(program)).isFile()) throw new Error('Mining program is absent from the selected build root')
    return resolved
  }
  private programEnvironment(context: AnalysisContext, program: string): SecurityEnvironment {
    const container = context.environment.containerId
    if (!container) throw new Error('Start the configured Docker environment before running mining programs')
    return { ...context.environment, tools: [...context.environment.tools,
      { id: 'mining-program', command: environmentPath(context.environment, program), versionArgs: [], source: 'approved mining plan' }] }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const resolved = await this.verify(request, context)
    const deadline = Date.now() + context.durationMs
    const limits = { maxOutputBytes: Math.max(1, Math.floor((context.maxOutputBytes - 1024) / 2)), graceMs: this.config.graceMs }
    const toolVersion = 'mining container ' + (context.environment.resolvedImageId ?? (context.environment.image ?? context.environment.id))
    if (request.operation === 'build') {
      const args = buildParameters.parse(resolved.parameters)
      const steps: { tool: string; exitCode: number | null; signal: string | null; timedOut: boolean; truncated: boolean }[] = []
      let streams: ProcessResult = { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
      let failure: string | undefined
      for (const step of args.steps) {
        context.signal.throwIfAborted()
        const remaining = deadline - Date.now()
        if (remaining <= 0) { failure = 'Mining build deadline exceeded'; break }
        const result = await runProcess(this.ctx, context.environment, step.tool, step.args,
          { signal: context.signal, durationMs: remaining, ...limits })
        steps.push({ tool: step.tool, exitCode: result.exitCode, signal: result.signal,
          timedOut: result.timedOut, truncated: result.truncated })
        streams = result
        if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.cancelled || result.truncated) {
          failure = 'Build step failed: ' + step.tool + ' ' + JSON.stringify({ exitCode: result.exitCode, signal: result.signal,
            timedOut: result.timedOut, cancelled: result.cancelled, truncated: result.truncated })
          break
        }
      }
      const raw: ProcessResult & { steps?: unknown[] } = { ...streams, steps }
      const bytes = boundedJson(raw, context.maxOutputBytes)
      return { bytes, mediaType: 'application/json',
        summary: (failure ?? (streams.stderr || streams.stdout || 'Mining build steps completed')).slice(0, 4096),
        incomplete: streams.truncated || context.signal.aborted || !!failure, toolVersion,
        cleanup: 'Owned mining container settled; build outputs remain in the isolated build root', ...(failure ? { failure } : {}),
        observationKind: 'implementation' }
    }
    const args = runParameters.parse(resolved.parameters)
    const program = join(args.buildRoot, args.program)
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(context.durationMs)])
    const result = await runProcess(this.ctx, this.programEnvironment(context, program), 'mining-program', args.args,
      { signal, durationMs: context.durationMs, ...limits }, args.input)
    const raw: ProcessResult = { ...result,
      timedOut: result.timedOut || signal.aborted && !context.signal.aborted,
      cancelled: context.signal.aborted }
    const bytes = boundedJson(raw, context.maxOutputBytes)
    const failure = raw.cancelled || raw.timedOut ? raw.stderr || 'Mining run did not complete' : undefined
    return { bytes, mediaType: 'application/json',
      summary: (failure ?? (raw.stderr || raw.stdout || 'Mining program settled')).slice(0, 4096),
      incomplete: raw.truncated || !!failure, toolVersion,
      cleanup: 'Owned mining container settled; the program wrote only to its build root and stdout',
      ...(failure ? { failure } : {}), observationKind: 'implementation' }
  }
}
/** Register approved mining execution.
 * @param ctx - project and subprocess services.
 * @param config - subprocess cleanup and input policy. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new MiningProvider(ctx, config)))
}
