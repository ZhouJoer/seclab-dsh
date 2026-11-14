/** Selected Java execution, semantic evidence and isolated Ghidra project lifetime. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { inspectGhidraHeadlessInstallation, listGhidraHeadlessCaches, removeGhidraHeadlessCache,
  GhidraHeadlessSessions, type GhidraHeadlessOptions } from '../src/ghidra-headless.ts'
import { ToolAdapterProvider, parseAdapterParameters } from '../src/tool-adapter-provider.ts'
import { adapterResultSchema } from '../src/tool-adapter-results.ts'
import { toolAdapters } from '../src/tool-adapter-catalog.ts'
import { moduleAllowsTool } from '../src/analysis-modules.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext, AnalysisResult } from '../src/workbench/providers.ts'
import { runProcess, type ProcessResult } from '../src/workbench/process.ts'
import { GhidraFixtureSubprocess } from './ghidra-session-fixture.ts'

vi.mock('../src/workbench/process.ts', async original => ({ ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const complete: ProcessResult = { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
const settings: GhidraHeadlessOptions = { cacheDirectory: 'ghidra-cache', maxHeapMb: 1024, maxCpu: 2, analysisTimeoutSeconds: 30, decompileTimeoutSeconds: 5,
  maxSessions: 4, sessionIdleTimeoutMs: 60000, protocolPollIntervalMs: 1 }
const decode = (result: AnalysisResult) => adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ghidra-headless-'))
  const artifacts = new ArtifactStore(root, 100000)
  const artifact = await artifacts.put(Buffer.from('immutable binary input'), 'application/octet-stream')
  const tool = { id: 'ghidra-headless', command: join(root, 'selected jdk', 'bin', 'java.exe'),
    prefixArgs: ['-Djava.system.class.loader=ghidra.GhidraClassLoader', '-cp', join(root, 'selected ghidra', 'Ghidra', 'Framework', 'Utility', 'lib', 'Utility.jar'),
      'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless'], versionArgs: ['-help'], source: 'Operator selection' }
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 10000, maxOutputBytes: 16000,
    asset: fileAssetSchema.parse({ id: 'sample', engagementId: 'project', label: 'Binary', format: 'pe', identity: 'measured', artifact }),
    environment: { id: 'host', kind: 'local', label: 'Host', cwd: root, tools: [tool,
      { id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'Fixture Docker' }] } }
  const request = operationSchema.parse({ provider: 'tool-adapter', operation: 'ghidra-headless.functions',
    assetId: 'sample', environmentId: 'host', impact: 'observe', parameters: {} })
  const ctx = new Context()
  const runtime = new GhidraFixtureSubprocess(ctx)
  const provider = new ToolAdapterProvider(ctx,
    { maxItems: 10, maxInstructions: 5, maxPackets: 10, graceMs: 100, ghidraHeadless: settings }, 10)
  onTestFinished(async () => {
    await provider.dispose(); await Promise.all(runtime.stopped); await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const metadata = { version: '12.0.4', location: join(root, 'selected ghidra'), javaVersion: '21.0.5', javaHome: join(root, 'selected jdk'), architecture: 'amd64' }
  const container: { running: boolean; calls: string[][] } = { running: true, calls: [] }
  vi.mocked(runProcess).mockImplementation(async (_ctx, environment, id, args) => {
    if (id === 'docker') {
      container.calls.push(args)
      return { ...complete, stdout: args[0] === 'inspect' ? JSON.stringify(container.running) : '' }
    }
    expect(args).toEqual([])
    const selected = environment.tools.find(tool => tool.id === id)
    expect(selected?.command).toBe(context.environment.tools[0]?.command)
    const argv = selected?.prefixArgs ?? []
    const hostPath = (path: string) => path.startsWith('/workspace/') ? join(root, path.slice('/workspace/'.length)) : path
    if (argv[0]?.endsWith('DshGhidraProbe.java')) {
      expect(await readFile(hostPath(argv[0]), 'utf8')).toContain('ToolProvider.getSystemJavaCompiler()')
      return { ...complete, stdout: JSON.stringify(metadata) }
    }
    if (argv.includes('-vmargs')) return { ...complete, stdout: '-Djava.system.class.loader=ghidra.GhidraClassLoader\n-Dfile.encoding=UTF8\n' }
    throw new Error('Resident analysis must use the subprocess service directly')
  })
  return { root, tool, metadata, context, request, provider, runtime, ctx, container, observed: runtime.observed,
    output: (patch: Record<string, unknown>) => { runtime.outputPatch = patch },
    process: (patch: Partial<ProcessResult>) => { runtime.stdout = patch.stdout ?? ''; runtime.failExit = patch.exitCode ?? undefined },
    beforeAnalysis: (action: () => Promise<void>) => { runtime.beforeQuery = action },
    run: () => provider.run(provider.resolve(request, context), context) }
}

it('publishes only the nine headless Ghidra queries and restricts semantic inputs', async () => {
  const { provider, request, context } = await fixture()
  expect(toolAdapters.map(tool => tool.id)).not.toContain('ghidra')
  expect(toolAdapters.find(tool => tool.id === 'ghidra-headless')).toMatchObject({ toolName: 'security_ghidra_headless', provider: 'tool-adapter' })
  expect(toolAdapters.find(tool => tool.id === 'ghidra-headless')?.operations).toHaveLength(9)
  expect(moduleAllowsTool('security_ghidra_headless', { mode: 'manual', modules: [], reason: '' })).toBe(false)
  expect(moduleAllowsTool('security_ghidra_headless', { mode: 'manual', modules: ['reverse.native'], reason: '' })).toBe(true)
  expect(() => parseAdapterParameters('ghidra-headless.decompile', { address: '0x1000;runScript()' })).toThrow()
  expect(() => parseAdapterParameters('ghidra-headless.functions', { script: 'other.java' })).toThrow()
  expect(() => parseAdapterParameters('ghidra-headless.decompile', {})).toThrow('requires an address returned by Ghidra')
  expect(parseAdapterParameters('ghidra-headless.xrefs-to', { address: 'EXTERNAL:1' })).toEqual({ address: 'EXTERNAL:1' })
  expect(() => parseAdapterParameters('radare2.xrefs-to', { address: 'EXTERNAL:1' })).toThrow()
  expect(() => parseAdapterParameters('r2ghidra.decompile', { address: 'EXTERNAL:1' })).toThrow()
  expect(() => parseAdapterParameters('ghidra-headless.xrefs-to', { address: 'EXTERNAL:1;runScript()' })).toThrow()
  expect(() => parseAdapterParameters('ghidra-headless.xrefs-to', { address: 'a'.repeat(129) + ':1' })).toThrow()
  expect(provider.resolve({ ...request, operation: 'ghidra-headless.disassemble', parameters: { address: '0x401000', count: 99 } }, context).parameters)
    .toMatchObject({ address: '0x401000', count: 5 })
})

it('reuses one selected JVM and reopens only a normally saved project read-only', async () => {
  const f = await fixture()
  const first = await f.run()
  const second = await f.run()
  expect(first.failure).toBeUndefined()
  expect(second.failure).toBeUndefined()
  expect(first.cleanup).toBeUndefined()
  expect(decode(first)).toMatchObject({ toolVersion: '12.0.4', items: [{ address: '0x401000', name: 'main' }], raw: { reused: false } })
  expect(decode(second)).toMatchObject({ raw: { reused: true } })
  expect(f.observed[0]).toEqual(expect.arrayContaining(['-import', '-Xmx1024m', '-XX:ParallelGCThreads=2', '-Djava.awt.headless=true']))
  expect(f.observed).toHaveLength(1)
  const firstSession = z.object({ sessionId: z.string() }).parse(decode(first).raw)
  expect(decode(first).raw).toMatchObject({ running: true, sessionReused: false })
  expect(decode(second).raw).toMatchObject({ sessionId: firstSession.sessionId, sessionReused: true })
  expect(await listGhidraHeadlessCaches(f.context.environment, settings))
    .toEqual([expect.objectContaining({ complete: false, inUse: true })])
  await f.provider.closeEnvironment('host')
  expect(decode(await f.run()).raw).toMatchObject({ cacheReused: true, sessionReused: false })
  expect(f.observed[1]).toEqual(expect.arrayContaining(['-process', 'input', '-noanalysis', '-readOnly']))
  expect(f.observed.flat()).not.toEqual(expect.arrayContaining(['-ask', '-save', 'cmd.exe', 'analyzeHeadless.bat']))
  await f.provider.closeEnvironment('host')
  expect(await readdir(join(f.root, 'runs'))).toEqual([])
  expect((await readdir(join(f.root, settings.cacheDirectory))).filter(path => path.endsWith('.lease'))).toEqual([])
})

it('isolates cache entries by sample, environment, selected tool version and analysis settings', async () => {
  const f = await fixture()
  await f.run()
  f.metadata.version = '12.0.5'
  f.runtime.version = '12.0.5'
  await f.run()
  f.context.environment.id = 'another-host'
  await f.run()
  f.context.asset = fileAssetSchema.parse({ ...f.context.asset, artifact: await f.context.artifacts.put(Buffer.from('second sample'), 'application/octet-stream') })
  await f.run()
  const provider = new ToolAdapterProvider(f.ctx, { maxItems: 10, maxInstructions: 5, maxPackets: 10, graceMs: 100,
    ghidraHeadless: { ...settings, maxCpu: 3 } }, 10)
  try { await provider.run(provider.resolve(f.request, f.context), f.context) } finally { await provider.dispose() }
  expect(f.observed).toHaveLength(5)
  expect(f.observed.every(argv => argv.includes('-import'))).toBe(true)
  await f.provider.dispose()
  expect(await readdir(join(f.root, settings.cacheDirectory))).toHaveLength(5)
})

it('continues from the observations retained after the complete evidence byte limit is applied', async () => {
  const f = await fixture()
  f.context.maxOutputBytes = 4096
  f.request.parameters.offset = 100
  f.output({ items: Array.from({ length: 10 }, (_, index) => ({ index, name: 'x'.repeat(200) })), nextOffset: 110 })
  f.process({ stdout: 'log '.repeat(500) })
  const result = await f.run(), page = decode(result)
  expect(result.failure).toBeUndefined()
  expect(page.items.length).toBeGreaterThan(0)
  expect(page.items.length).toBeLessThan(10)
  expect(page.raw).toMatchObject({ nextOffset: 100 + page.items.length })
  expect(result.summary).toBe('Ghidra headless: ' + String(page.items.length) + ' retained observations')
  expect(page.incomplete).toBe(true)
  expect(result.bytes.length).toBeLessThanOrEqual(4096)
})

it('reports an omitted oversized decompilation without inventing a paged-query cursor', async () => {
  const f = await fixture()
  f.context.maxOutputBytes = 4096
  f.request.operation = 'ghidra-headless.decompile'
  f.request.parameters.address = '0x401000'
  f.output({ items: [{ code: 'x'.repeat(2500) }] })
  f.process({ stdout: 'log '.repeat(500) })
  const result = await f.run(), page = decode(result)
  expect(result.failure).toBeUndefined()
  expect(page.items).toEqual([])
  expect(page.raw).toMatchObject({ nextOffset: null })
  expect(result.summary).toBe('Ghidra headless: 0 retained observations')
  expect(page.incomplete).toBe(true)
})

it('serializes simultaneous queries on the same program and keeps the project leased until close', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  f.beforeAnalysis(async () => { entered.resolve(undefined); await release.promise })
  const running = f.run()
  await entered.promise
  const queued = f.run()
  expect(f.runtime.queries).toEqual(['1'])
  release.resolve(undefined)
  await running
  expect(decode(await queued)).toMatchObject({ raw: { reused: true } })
  expect(f.runtime.queries).toEqual(['1', '2'])
  expect((await readdir(join(f.root, settings.cacheDirectory))).filter(path => path.endsWith('.lease'))).toHaveLength(1)
  await f.provider.closeEnvironment('host')
  expect((await readdir(join(f.root, settings.cacheDirectory))).filter(path => path.endsWith('.lease'))).toEqual([])
})

it('rejects a changed cached script and a hidden project directory before analysis executes', async () => {
  const f = await fixture()
  await f.run()
  await f.provider.closeEnvironment('host')
  const [entry] = await readdir(join(f.root, settings.cacheDirectory))
  if (!entry) throw new Error('Expected a completed Ghidra cache entry')
  await writeFile(join(f.root, settings.cacheDirectory, entry, 'scripts', 'DshHeadless.java'), 'changed script')
  expect((await f.run()).failure).toContain('cached script identity changed')
  expect(f.observed).toHaveLength(1)
  const provider = new ToolAdapterProvider(new Context(), { maxItems: 10, maxInstructions: 5, maxPackets: 10, graceMs: 100,
    ghidraHeadless: { ...settings, cacheDirectory: '.hidden' } }, 10)
  await expect(provider.run(provider.resolve(f.request, f.context), f.context)).rejects.toThrow('starting with a dot')
  expect(f.observed).toHaveLength(1)
})

it('lists caches without creating them and removes only an owned, unleased project', async () => {
  const f = await fixture()
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([])
  expect(await readdir(f.root)).toEqual(['artifacts'])
  await f.run()
  await f.provider.closeEnvironment('host')
  const [cache] = await listGhidraHeadlessCaches(f.context.environment, settings)
  expect(cache).toMatchObject({ complete: true, inUse: false })
  if (!cache) throw new Error('Missing owned cache')
  const lease = join(f.root, settings.cacheDirectory, cache.key + '.lease')
  await mkdir(lease)
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([{ ...cache, inUse: true }])
  await expect(removeGhidraHeadlessCache(f.context.environment, settings, cache.key)).rejects.toThrow('leased')
  await rm(lease, { recursive: true })
  await expect(removeGhidraHeadlessCache(f.context.environment, settings, '../outside')).rejects.toThrow()
  await writeFile(join(f.root, settings.cacheDirectory, cache.key, 'owner.json'), '{}')
  await expect(removeGhidraHeadlessCache(f.context.environment, settings, cache.key)).rejects.toThrow()
  expect(await readdir(join(f.root, settings.cacheDirectory))).toEqual([cache.key])
})

it('removes a completed owned cache and leaves saved artifacts available', async () => {
  const f = await fixture()
  const result = await f.run()
  await f.provider.closeEnvironment('host')
  const [cache] = await listGhidraHeadlessCaches(f.context.environment, settings)
  if (!cache) throw new Error('Missing owned cache')
  await removeGhidraHeadlessCache(f.context.environment, settings, cache.key)
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([])
  expect(decode(result).items).toHaveLength(1)
  expect(await readdir(join(f.root, 'artifacts'))).toHaveLength(1)
})

it('refuses a linked cache entry without deleting the linked directory', async () => {
  const f = await fixture(), key = 'a'.repeat(64)
  const foreign = join(f.root, 'foreign'), root = join(f.root, settings.cacheDirectory), link = join(root, key)
  await mkdir(foreign); await mkdir(root)
  await writeFile(join(foreign, 'owner.json'), JSON.stringify({ format: 'dsh-ghidra-owner-v1', key,
    inputSha256: 'b'.repeat(64), scriptSha256: 'c'.repeat(64), ghidraVersion: '12.2' }))
  await symlink(foreign, link, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    await expect(removeGhidraHeadlessCache(f.context.environment, settings, key)).rejects.toThrow('regular owned paths')
    expect(await readdir(foreign)).toEqual(['owner.json'])
  } finally { await unlink(link) }
})

it.each([
  { process: { exitCode: 1 }, output: {} },
  { process: {}, output: { analysisTimedOut: true } },
  { process: {}, output: { inputSha256: 'b'.repeat(64) } },
  { process: {}, output: { ghidraVersion: 'wrong distribution' } },
])('retains failures and discards incomplete imports: %j', async ({ process, output }) => {
  const f = await fixture()
  f.process(process)
  f.output(output)
  const result = await f.run()
  expect(result.incomplete).toBe(true)
  expect(result.failure).toBeTruthy()
  expect(await readdir(join(f.root, settings.cacheDirectory))).toEqual([])
  expect(await readdir(join(f.root, 'runs'))).toEqual([])
  if ('inputSha256' in output || 'ghidraVersion' in output) expect(decode(result).items).toEqual([])
})

it('maps owned project and script files into managed Docker while retaining selected container Java paths', async () => {
  const f = await fixture()
  f.context.environment.kind = 'docker'
  f.context.environment.containerId = 'owned-container'
  f.tool.command = '/opt/selected-java/bin/java'
  f.tool.prefixArgs[2] = '/opt/selected-ghidra/Ghidra/Framework/Utility/lib/Utility.jar'
  expect((await f.run()).failure).toBeUndefined()
  expect(f.observed[0]).toEqual(expect.arrayContaining(['/opt/selected-ghidra/Ghidra/Framework/Utility/lib/Utility.jar']))
  expect(f.observed[0]?.some(arg => arg.startsWith('/workspace/') && arg.includes('session-'))).toBe(true)
})

it('releases a resident Docker lease when another owner already stopped the selected container', async () => {
  const f = await fixture()
  f.context.environment.kind = 'docker'
  f.context.environment.containerId = 'owned-container'
  f.tool.command = '/opt/selected-java/bin/java'
  f.tool.prefixArgs[2] = '/opt/selected-ghidra/Ghidra/Framework/Utility/lib/Utility.jar'
  expect((await f.run()).failure).toBeUndefined()
  f.container.running = false
  f.runtime.stopEnvironment()
  await Promise.all(f.runtime.stopped)
  expect((await f.run()).failure).toContain('process exited')
  expect(f.container.calls).toEqual([['inspect', '--type', 'container', '--format', '{{json .State.Running}}', 'owned-container']])
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([])
  f.container.running = true
  expect((await f.run()).failure).toBeUndefined()
  expect(f.observed).toHaveLength(2)
})

it('rejects arbitrary launchers and incompatible Java diagnostics before acquiring a project', async () => {
  const f = await fixture()
  const limits = { durationMs: 1000, maxOutputBytes: 1000, graceMs: 100 }
  await expect(inspectGhidraHeadlessInstallation(new Context(), f.context.environment, { ...f.tool, command: 'java' }, limits, f.context.signal))
    .rejects.toThrow('absolute selected Java')
  await expect(inspectGhidraHeadlessInstallation(new Context(), f.context.environment, { ...f.tool, prefixArgs: ['-jar', 'arbitrary.jar'] }, limits, f.context.signal))
    .rejects.toThrow('fixed Ghidra Utility.jar')
  vi.mocked(runProcess).mockResolvedValue({ ...complete, exitCode: 1, stderr: 'Ghidra requires JDK 21; selected Java is 17' })
  await expect(f.run()).rejects.toThrow('Ghidra requires JDK 21')
  expect((await readdir(f.root)).some(path => path.startsWith('.dsh-ghidra-probe-'))).toBe(false)
})

it('cancels an active query, joins the owned JVM and imports a fresh program on the next call', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<undefined>(), held = Promise.withResolvers<undefined>()
  f.runtime.beforeQuery = async () => { entered.resolve(undefined); await held.promise }
  const cancellation = new AbortController()
  f.context.signal = cancellation.signal
  const first = f.run()
  await entered.promise
  cancellation.abort(new Error('Operator stopped Ghidra'))
  const result = await first
  expect(result.failure).toContain('Operator stopped Ghidra')
  expect(decode(result).raw).toMatchObject({ process: { cancelled: true }, running: false })
  expect(await readdir(join(f.root, settings.cacheDirectory))).toEqual([])
  expect(f.runtime.shutdowns).toEqual([false])
  held.resolve(undefined)
  f.runtime.beforeQuery = undefined
  f.context.signal = new AbortController().signal
  expect((await f.run()).failure).toBeUndefined()
  expect(f.runtime.observed).toHaveLength(2)
})

it('rejects unauthenticated replies and never publishes their project as complete', async () => {
  const f = await fixture()
  f.output({ token: 'wrong-session-token' })
  const result = await f.run()
  expect(result.failure).toContain('another request or session')
  expect(decode(result).items).toEqual([])
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([])
})

it('closes idle sessions and retains only a normally saved project', async () => {
  const f = await fixture()
  const provider = new ToolAdapterProvider(f.ctx, { maxItems: 10, maxInstructions: 5, maxPackets: 10, graceMs: 100,
    ghidraHeadless: { ...settings, sessionIdleTimeoutMs: 10 } }, 10)
  try {
    expect((await provider.run(provider.resolve(f.request, f.context), f.context)).failure).toBeUndefined()
    await vi.waitFor(async () =>{  expect(await listGhidraHeadlessCaches(f.context.environment, settings))
      .toEqual([expect.objectContaining({ complete: true, inUse: false })]) })
    expect(f.runtime.shutdowns).toEqual([true])
  } finally { await provider.dispose() }
})

it('forcibly stops an unresponsive close and discards its unsaved project', async () => {
  const f = await fixture()
  expect((await f.run()).failure).toBeUndefined()
  f.runtime.ignoreClose = true
  await f.provider.closeEnvironment('host')
  expect(f.runtime.shutdowns).toEqual([false])
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([])
})

it('cancels a queued query without stopping the active query or releasing its project', async () => {
  const f = await fixture(), pool = new GhidraHeadlessSessions(f.ctx, settings, 100)
  const entered = Promise.withResolvers<undefined>(), held = Promise.withResolvers<undefined>()
  f.runtime.beforeQuery = async () => { entered.resolve(undefined); await held.promise }
  const cancellation = new AbortController()
  try {
    const active = pool.run(f.provider.resolve(f.request, f.context), f.context, 10)
    await entered.promise
    const queued = pool.run(f.provider.resolve(f.request, f.context), { ...f.context, signal: cancellation.signal }, 10)
    await vi.waitFor(() => { expect(pendingQueries(pool)).toBe(2) })
    cancellation.abort(new Error('Queued request cancelled'))
    expect((await queued).failure).toBe('Queued request cancelled')
    expect(f.runtime.shutdowns).toEqual([])
    expect(pendingQueries(pool)).toBe(1)
    held.resolve(undefined)
    expect((await active).failure).toBeUndefined()
    expect((await pool.run(f.provider.resolve(f.request, f.context), f.context, 10)).failure).toBeUndefined()
    expect(f.runtime.observed).toHaveLength(1)
    expect(f.runtime.queries).toEqual(['1', '2'])
  } finally { held.resolve(undefined); await pool.dispose() }
})

it('refuses to evict busy programs when the configured resident limit is reached', async () => {
  const f = await fixture(), pool = new GhidraHeadlessSessions(f.ctx, { ...settings, maxSessions: 1 }, 100)
  const entered = Promise.withResolvers<undefined>(), held = Promise.withResolvers<undefined>()
  f.runtime.beforeQuery = async () => { entered.resolve(undefined); await held.promise }
  try {
    const active = pool.run(f.provider.resolve(f.request, f.context), f.context, 10)
    await entered.promise
    const other = { ...f.context, asset: fileAssetSchema.parse({ ...f.context.asset,
      artifact: await f.context.artifacts.put(Buffer.from('different binary'), 'application/octet-stream') }) }
    expect((await pool.run(f.provider.resolve(f.request, other), other, 10)).failure).toContain('resident sessions are busy')
    expect(f.runtime.observed).toHaveLength(1)
    held.resolve(undefined)
    expect((await active).failure).toBeUndefined()
  } finally { held.resolve(undefined); await pool.dispose() }
})

it('retries known stopped-process cleanup without publishing an uncertain cache', async () => {
  const f = await fixture()
  expect((await f.run()).failure).toBeUndefined()
  const [cache] = await listGhidraHeadlessCaches(f.context.environment, settings)
  if (!cache) throw new Error('Expected owned project')
  const entry = join(f.root, settings.cacheDirectory, cache.key)
  const session = (await readdir(entry)).find(path => path.startsWith('session-'))
  if (!session) throw new Error('Expected resident transport')
  await writeFile(join(entry, session, 'close.json'), '{}')
  await expect(f.provider.closeEnvironment('host')).rejects.toThrow('graceful shutdown failed')
  expect(f.runtime.shutdowns).toHaveLength(1)
  expect(await listGhidraHeadlessCaches(f.context.environment, settings))
    .toEqual([expect.objectContaining({ complete: false, inUse: true })])
  await f.provider.closeEnvironment('host')
  expect(await listGhidraHeadlessCaches(f.context.environment, settings)).toEqual([])
})

function pendingQueries(pool: GhidraHeadlessSessions): number {
  // Place cancellation after queue admission; observable assertions use process lifetime and evidence.
  const projects: unknown = Reflect.get(pool, 'projects')
  return [...z.map(z.string(), z.object({ pending: z.number() })).parse(projects).values()]
    .reduce((sum, project) => sum + project.pending, 0)
}
