/** Single-stop debugger observations through the existing validation owner. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { chmod } from 'node:fs/promises'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import { fileAsset } from './workbench/assessment.ts'
import { installation, runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult } from './workbench/providers.ts'
import { operationSchema, type AnalysisOperation } from './workbench/model.ts'
import { adapterProcessFailure } from './tool-adapter-results.ts'

/** Debugger process teardown policy. */
export interface Config { graceMs: number }
/** Plugin identity. */
export const name = 'experimental-security-debugger'
/** Execution and approval ownership. */
export const inject = ['securityWorkbench', 'subprocess']
/** Deployment-owned cleanup grace. */
export const Config: Schema<Config> = Schema.object({ graceMs: Schema.number().step(1).min(1).default(3000) })
const location = z.string().regex(/^(?:0x[0-9a-fA-F]+|[a-zA-Z_$@][a-zA-Z0-9_!.$@]*)(?:\+0x[0-9a-fA-F]+)?$/u)
const parameters = z.object({ engine: z.enum(['gdb', 'cdb']), breakpoint: location,
  argv: z.array(z.string().max(4096)).optional(),
  memory: z.array(z.object({ address: location, length: z.number().int().positive() }).strict()),
}).strict()

/** Construct a fixed single-stop request; expressions cannot introduce debugger commands.
 * @param input - Proposed observation parameters.
 * @param path - Immutable sample path mapped by the environment owner.
 * @returns debugger argv and optional MI input.
 */
export function debuggerInvocation(input: unknown, path: string): { args: string[]; input?: string } {
  const spec = parameters.parse(input)
  if (spec.engine === 'cdb') {
    const observations = ['.echo DSH_DEBUG_STOP', '|', 'r', ...spec.memory.map(region => 'db ' + region.address + ' L' + region.length.toString(16)), '.echo DSH_DEBUG_END', 'q']
    return { args: ['-o', '-c', 'bu ' + spec.breakpoint + ' "' + observations.join('; ') + '"; g', path, ...spec.argv ?? []] }
  }
  const commands = ['-gdb-set pagination off', '-gdb-set confirm off', '-gdb-set mi-async off', '-gdb-set detach-on-fork off', '-gdb-set schedule-multiple on',
    '-break-insert ' + JSON.stringify(spec.breakpoint.startsWith('0x') ? '*' + spec.breakpoint : spec.breakpoint), '-exec-run', '-data-list-register-names', '-data-list-register-values x',
    ...spec.memory.map(region => '-data-read-memory-bytes ' + JSON.stringify(region.address) + ' ' + String(region.length)), '-gdb-exit']
  return { args: ['--nx', '--quiet', '--interpreter=mi2', '--args', path, ...spec.argv ?? []],
    input: commands.map((command, index) => String(index + 1) + command).join('\n') + '\n' }
}

/** Starts only the imported sample, captures one breakpoint and terminates its owned debuggee. */
export class DebuggerProvider implements AnalysisProvider {
  readonly id = 'debugger'
  readonly operations = ['run']
  readonly inputGuide = 'debugger/run requires a validation plan and reverse.native. First establish file architecture, dependencies and a specific missing runtime observation. Parameters: {engine: gdb|cdb, breakpoint: symbol or 0x address, argv?: string[], memory: [{address: symbol/register/hex address, length: bytes}]}. GDB uses MI on managed Linux Docker; CDB uses the Windows Host. One stop collects registers and fixed-length bytes, then kills the owned debuggee. No attach, arbitrary commands or inferred string lengths. Match debugger architecture to sample; address expressions permit only names and optional +0x offsets. Host execution has Host user permissions. Inspect raw stop reason, all command errors, incomplete and cleanup before drawing conclusions.'
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    const spec = parameters.parse(request.parameters)
    if (request.operation !== 'run' || request.script) throw new Error('Debugger supports fixed run observations only')
    const asset = fileAsset(context.asset)
    if (context.environment.externalContainer) throw new Error('Debugger requires an owned environment for process cleanup')
    if (spec.engine === 'gdb' && (context.environment.kind !== 'docker' || asset.format !== 'elf'))
      throw new Error('GDB requires an ELF sample and managed Linux Docker')
    if (spec.engine === 'cdb' && (context.environment.kind !== 'local' || process.platform !== 'win32' || asset.format !== 'pe'))
      throw new Error('CDB requires a PE sample and local Windows')
    if (spec.memory.reduce((sum, region) => sum + region.length, 0) > context.maxOutputBytes / 16)
      throw new Error('Requested memory exceeds the observation byte budget')
    installation(context.environment, spec.engine)
    debuggerInvocation(spec, 'sample')
    return { ...request, parameters: operationSchema.shape.parameters.parse(spec), impact: 'target-write' }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const resolved = this.resolve(request, context)
    const spec = parameters.parse(resolved.parameters)
    const limits = { signal: context.signal, durationMs: context.durationMs,
      maxOutputBytes: Math.floor(context.maxOutputBytes / 4), graceMs: this.config.graceMs }
    const tool = installation(context.environment, spec.engine)
    const version = await runProcess(this.ctx, context.environment, spec.engine, tool.versionArgs, limits)
    requireProcessSuccess(version)
    if (version.truncated) throw new Error('Debugger version inspection was truncated')
    const path = await context.artifacts.materialize(fileAsset(context.asset).artifact)
    try {
      if (spec.engine === 'gdb') await chmod(path, 0o700)
      const command = debuggerInvocation(spec, path)
      const result = await runProcess(this.ctx, context.environment, spec.engine, command.args, limits, command.input)
      const stopped = spec.engine === 'gdb' ? result.stdout.includes('*stopped,reason="breakpoint-hit"')
        : result.stdout.includes('DSH_DEBUG_STOP\r\n') || result.stdout.includes('DSH_DEBUG_STOP\n')
      const observed = spec.engine === 'gdb'
        ? spec.memory.every((_region, index) => new RegExp('(?:^|\\n)' + String(index + 10) + '\\^done,memory=', 'u').test(result.stdout))
        : result.stdout.includes('DSH_DEBUG_END') && !/\?\?|Memory access error|Unable to resolve|Syntax error/iu.test(result.stdout)
      const commandFailed = spec.engine === 'gdb' && /\d+\^error,/u.test(result.stdout)
      const failure = adapterProcessFailure(result) ?? (!stopped ? 'Requested breakpoint was not observed'
        : !observed || commandFailed ? 'One or more debugger observations failed; inspect raw output' : undefined)
      const raw = { engine: spec.engine, sampleSha256: fileAsset(context.asset).artifact.sha256, parameters: spec,
        ...result, stopped, observed, failure: failure ?? null,
        cleanup: 'Debugger subprocess settled; debuggee termination requested by debugger exit' }
      let bytes = Buffer.from(JSON.stringify(raw))
      while (bytes.length > context.maxOutputBytes && (raw.stdout.length || raw.stderr.length)) {
        const field = raw.stdout.length >= raw.stderr.length ? 'stdout' : 'stderr'
        raw[field] = raw[field].slice(0, Math.floor(raw[field].length / 2))
        raw.truncated = true
        bytes = Buffer.from(JSON.stringify(raw))
      }
      if (bytes.length > context.maxOutputBytes) throw new Error('Debugger metadata exceeds observation budget')
      return { bytes, mediaType: 'application/json',
        summary: failure ?? 'Observed breakpoint and requested registers/memory',
        incomplete: raw.truncated || failure !== undefined, toolVersion: (version.stdout || version.stderr).trim(),
        cleanup: raw.cleanup, ...(failure ? { failure } : {}) }
    } finally { await context.artifacts.release(path) }
  }
}

/** Register fixed debugger observations inside the existing approval and evidence workflow.
 * @param ctx - Security and subprocess services.
 * @param config - Cleanup policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new DebuggerProvider(ctx, config)))
}
