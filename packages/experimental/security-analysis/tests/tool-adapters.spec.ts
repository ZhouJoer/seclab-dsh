/** Semantic adapter requests, process failures and retained evidence pagination. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi, onTestFinished } from 'vitest'
import { ToolAdapterProvider, adapterArguments, decodeAdapterOutput } from '../src/tool-adapter-provider.ts'
import { adapterResultPage, adapterResultSchema, retainAdapterResult } from '../src/tool-adapter-results.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { evidenceSchema, fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'
import { canObserve } from '../src/workbench/roles.ts'
import { LocalEnvironmentManager } from '../src/environment-local.ts'
import { inspectToolbox } from '../src/toolbox.ts'
import { runProcess } from '../src/workbench/process.ts'

vi.mock('../src/toolbox.ts', async original => ({ ...await original<typeof import('../src/toolbox.ts')>(), inspectToolbox: vi.fn() }))
vi.mock('../src/workbench/process.ts', async original => ({ ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const success = { stdout: '[]', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
async function fixture(tool = 'radare2', action = 'functions') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-adapters-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const artifacts = new ArtifactStore(root, 100000)
  const artifact = await artifacts.put(Buffer.from('d4c3b2a1020004000000000000000000ffff000069000000', 'hex'), 'application/octet-stream')
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 10000, maxOutputBytes: 16000,
    asset: fileAssetSchema.parse({ id: 'file', engagementId: 'project', label: 'Input', artifact, format: 'other', identity: 'measured' }),
    environment: { id: 'host', kind: 'local', cwd: root, label: 'Host', tools: [
      { id: tool === 'r2ghidra' ? 'radare2' : tool, command: join(root, tool), prefixArgs: [], versionArgs: ['--version'], source: 'Fixture' },
    ] } }
  const request = operationSchema.parse({ provider: 'tool-adapter', operation: tool + '.' + action,
    assetId: 'file', environmentId: 'host', impact: 'observe', parameters: {} })
  const provider = new ToolAdapterProvider(new Context(), { maxPackets: 10, maxItems: 5, maxInstructions: 10, graceMs: 100 }, 20)
  vi.mocked(inspectToolbox).mockResolvedValue({ environmentId: 'host', kind: 'local', runtime: 'ready', detail: '', checkedAt: 1, workdir: root,
    tools: [{ id: tool, category: 'utility', status: 'available', command: join(root, tool), version: '1', location: '', source: 'Fixture', detail: '', installUrl: '', invocation: 'shell' }] })
  vi.mocked(runProcess).mockResolvedValue(success)
  return { root, provider, context, request, artifact }
}
it('keeps values out of Shell and radare2 command syntax and retains exact input paths', () => {
  expect(adapterArguments('radare2.symbols', {}, 'input.elf'))
    .toEqual(['-N', '-q', '-e', 'scr.color=0', '-c', 'isj', 'input.elf'])
  expect(decodeAdapterOutput('radare2.symbols', '[{"name":"sample_symbol","vaddr":4096}]'))
    .toEqual([{ name: 'sample_symbol', vaddr: 4096 }])
  const path = 'C:\\input dir\\-样本.dll'
  expect(adapterArguments('radare2.disassemble', { address: '0x4010', count: 5 }, path))
    .toEqual(['-N', '-q', '-e', 'scr.color=0', '-c', 'pdj 5 @ 0x4010', path])
  expect(() => adapterArguments('r2ghidra.decompile', { address: '0x1;!whoami' }, path)).toThrow()
  expect(() => adapterArguments('objdump.disassemble', { startAddress: '0x20', endAddress: '0x10' }, path)).toThrow('range')
  expect(adapterArguments('tshark.packets', { filter: 'tcp.port == 443', fields: ['frame.number'], count: 3 }, path))
    .toEqual(['-n', '-r', path, '-c', '3', '-Y', 'tcp.port == 443', '-T', 'json', '-e', 'frame.number'])
})
it('enforces role and fixed-operation admission, including calls bypassing discovery', async () => {
  const { provider, request, context } = await fixture()
  expect(() => provider.resolve({ ...request, parameters: { command: '!whoami' } }, context)).toThrow()
  expect(() => provider.resolve({ ...request, parameters: { count: 5 } }, context)).toThrow('Unsupported parameter')
  expect(() => provider.resolve({ ...request, operation: 'radare2.run' }, context)).toThrow('Unknown')
  expect(() => provider.resolve(request, { ...context, environment: { ...context.environment, externalContainer: { name: 'other', workdir: '/tmp' } } })).toThrow('managed Docker')
  expect(canObserve('reviewer', 'tool-adapter', 'radare2.functions')).toBe(false)
  expect(canObserve('reconnaissance', 'tool-adapter', 'r2ghidra.decompile')).toBe(false)
  expect(canObserve('web-analyst', 'tool-adapter', 'tshark.packets')).toBe(true)
})
it('requires an explicit installation without discovering another executable on PATH', async () => {
  const { provider, request, context } = await fixture()
  context.environment.tools = []
  await expect(provider.run(provider.resolve(request, context), context)).rejects.toThrow('Configure an installation')
  expect(inspectToolbox).not.toHaveBeenCalled()
  expect(runProcess).not.toHaveBeenCalled()
})
it('saves semantic records, input identity and raw output then reads pages without rerunning', async () => {
  const { provider, request, context, root, artifact } = await fixture()
  vi.mocked(runProcess).mockResolvedValue({ ...success, stdout: '[{"offset":4096,"name":"main"},{"offset":8192,"name":"entry"}]' })
  const result = await provider.run(provider.resolve(request, context), context)
  const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
  expect(saved).toMatchObject({ tool: 'radare2', environmentId: 'host', inputSha256: artifact.sha256, incomplete: false })
  expect(adapterResultPage(result.bytes, 'evidence', 0, 1, 1000)).toMatchObject({ items: [{ name: 'main', offset: 4096 }], nextItemOffset: 1 })
  expect(adapterResultPage(result.bytes, 'evidence', 1, 1, 1000)).toMatchObject({ items: [{ name: 'entry', offset: 8192 }], nextItemOffset: null })
  expect(runProcess).toHaveBeenCalledTimes(1)
  expect(await readdir(join(root, 'runs'))).toEqual([])
})
it.each([
  { patch: { stdout: '{broken' }, failure: 'Cannot decode' },
  { patch: { exitCode: 1, stderr: 'unsupported query' }, failure: 'exitCode' },
  { patch: { truncated: true }, failure: 'collection limit' },
  { patch: { timedOut: true }, failure: 'timedOut' },
  { patch: { cancelled: true }, failure: 'cancelled' },
  { patch: { exitCode: -1073741515, stdout: '', stderr: '' }, failure: 'STATUS_DLL_NOT_FOUND' },
])('retains diagnostics and cleans run directories for $failure', async ({ patch, failure }) => {
  const { provider, request, context, root } = await fixture()
  vi.mocked(runProcess).mockResolvedValue({ ...success, ...patch })
  const result = await provider.run(provider.resolve(request, context), context)
  expect(result.failure).toContain(failure)
  expect(adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString())).diagnostics).toContain(failure)
  expect(result.incomplete).toBe(true)
  expect(await readdir(join(root, 'runs'))).toEqual([])
})
it('reports unavailable plugins and treats empty native arrays as successful empty queries', async () => {
  const { provider, request, context } = await fixture()
  expect((await provider.run(provider.resolve(request, context), context)).incomplete).toBe(false)
  vi.mocked(inspectToolbox).mockResolvedValue({ environmentId: 'host', kind: 'local', runtime: 'ready', detail: '', checkedAt: 1, workdir: '', tools: [] })
  await expect(provider.run(request, context)).rejects.toThrow('unavailable')
  expect(decodeAdapterOutput('strings.strings', '  0040 hello\n')).toEqual([{ offset: '0x0040', text: 'hello', sourceLine: 1 }])
  expect(decodeAdapterOutput('nm.symbols', 'main T 0040 10\n')).toEqual([{ name: 'main', type: 'T', address: '0x0040', size: '0x10', sourceLine: 1 }])
})
it('bounds complete UTF-8 artifacts and reports oversized evidence items without skipping them', () => {
  const result = { format: 'security-tool-result-v1' as const, tool: 'jadx', operation: 'jadx.decompile', environmentId: 'local',
    toolVersion: '1', inputSha256: 'a'.repeat(64), items: [{ text: '汉字'.repeat(4000) }], raw: '汉字'.repeat(8000), diagnostics: '', incomplete: false }
  const retained = retainAdapterResult(result, 4096)
  expect(retained.bytes.length).toBeLessThanOrEqual(4096)
  expect(retained.incomplete).toBe(true)
  expect(adapterResultPage(Buffer.from(JSON.stringify(result)), 'evidence', 0, 1, 1024))
    .toMatchObject({ items: [], nextItemOffset: 0 })
})

it('marks capped and filtered packet collections incomplete and preserves selected frame identities', async () => {
  const { provider, request, context } = await fixture('tshark', 'packets')
  vi.mocked(runProcess).mockResolvedValue({ ...success, stdout: '[{"_source":{"layers":{"frame.number":["7"],"frame.protocols":["eth:ip:tcp"]}}}]' })
  const result = await provider.run(provider.resolve({ ...request, parameters: { count: 1 } }, context), context)
  expect(result.incomplete).toBe(true)
  expect(adapterResultPage(result.bytes, 'evidence', 0, 1, 2000)).toMatchObject({ items: [{ frameNumber: ['7'] }] })
  const filtered = await provider.run(provider.resolve({ ...request, parameters: { filter: 'tcp' } }, context), context)
  expect(filtered.incomplete).toBe(true)
  expect(decodeAdapterOutput('tshark.summary', '[{"_source":{"layers":{"frame.protocols":["eth:ip:tcp"]}}}]'))
    .toEqual([{ protocols: 'eth:ip:tcp', packets: 1 }])
  expect(() => decodeAdapterOutput('tshark.packets', '[{"error":"unsupported"}]')).toThrow()
  expect(() => decodeAdapterOutput('r2ghidra.decompile', '{"error":"missing plugin"}')).toThrow()
})

it('retains partial JADX sources and failure diagnostics while removing private output files', async () => {
  const { provider, request, context, root } = await fixture('jadx', 'decompile')
  context.asset = fileAssetSchema.parse({ ...context.asset, format: 'apk' })
  vi.mocked(runProcess).mockImplementation(async (_ctx, _env, _tool, args) => {
    if (args[0] !== '--output-dir') return { ...success, stdout: '1.5.6' }
    const directory = args[1]
    if (!directory) throw new Error('Missing output directory')
    await writeFile(join(directory, 'Example.java'), 'class Example { /* incomplete method */ }')
    return { ...success, exitCode: 1, stderr: 'One method could not be decoded' }
  })
  const result = await provider.run(provider.resolve(request, context), context)
  expect(result.incomplete).toBe(true)
  expect(result.failure).toContain('exitCode')
  expect(adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString())).items)
    .toEqual([{ path: 'Example.java', text: 'class Example { /* incomplete method */ }' }])
  expect(await readdir(join(root, 'runs'))).toEqual([])
})

it('starts one managed container from a local image and mounts the shared run directory', async () => {
  const { context } = await fixture()
  const environment = { ...context.environment, kind: 'docker' as const, image: 'owned-image', exchangeRoot: join(context.environment.cwd, 'runs') }
  const image = Promise.withResolvers<typeof success>()
  const manager = new LocalEnvironmentManager(new Context(), { timeoutMs: 1000, maxOutputBytes: 8192, graceMs: 100,
    memoryMb: 256, cpus: 1, pids: 64, temporaryMb: 32 })
  vi.mocked(runProcess).mockImplementation(async (_ctx, _env, _tool, args) => args[0] === 'image' ? image.promise
    : { ...success, stdout: args[0] === 'inspect' ? 'true' : '' })
  const starting = manager.start(environment, context.signal)
  try {
    await expect(manager.start(environment, context.signal)).rejects.toThrow('starting')
  } finally { image.resolve({ ...success, stdout: 'sha256:' + 'a'.repeat(64) }) }
  await starting
  try {
    const command = vi.mocked(runProcess).mock.calls.find(call => call[3][0] === 'run')?.[3]
    expect(command).toContain('--pull=never')
    expect(command).toContain('type=bind,source=' + environment.exchangeRoot + ',target=/dsh-inputs')
    await expect(manager.start(environment, context.signal)).rejects.toThrow('already owns')
  } finally { await manager.stop(environment, context.signal) }
})

it('gives JADX a private JAR suffix and rejects APK-only manifest requests for a JAR', async () => {
  const { provider, context, request, root } = await fixture('jadx', 'decompile')
  context.asset = fileAssetSchema.parse({ ...context.asset, format: 'jar' })
  vi.mocked(runProcess).mockImplementation(async (_ctx, _env, _tool, args) => {
    if (args[0] !== '--output-dir') return { ...success, stdout: '1.5.6' }
    expect(args.at(-1)).toMatch(/input\.jar$/u)
    await writeFile(join(args[1]!, 'JarClass.java'), 'class JarClass {}')
    return success
  })
  expect((await provider.run(provider.resolve(request, context), context)).incomplete).toBe(false)
  expect(() => provider.resolve({ ...request, operation: 'jadx.manifest' }, context)).toThrow('APK')
  expect(await readdir(join(root, 'runs'))).toEqual([])
})

it('reads complete structured evidence and propagates its incompleteness into derived candidates', async () => {
  const { provider, context, request, artifact } = await fixture('analysis', 'android-api')
  context.asset = fileAssetSchema.parse({ ...context.asset, format: 'jar' })
  const input = retainAdapterResult({ format: 'security-tool-result-v1', tool: 'jadx', operation: 'jadx.decompile',
    environmentId: 'host', toolVersion: '1', inputSha256: artifact.sha256, items: [{ path: 'A.java', text: 'https://sample.invalid' }],
    raw: null, diagnostics: 'Limited source', incomplete: true }, 16000)
  const evidence = evidenceSchema.parse({ id: 'input', engagementId: 'project', assetId: 'file', title: 'JADX', summary: '',
    artifact: await context.artifacts.put(input.bytes, 'application/json'), provider: 'tool-adapter', operation: 'jadx.decompile',
    toolVersion: '1', request: {}, source: { sessionId: 'session', callId: 'call' }, incomplete: true, createdAt: 0 })
  context.inputEvidence = [evidence]
  const operation = { ...request, parameters: { evidenceIds: ['input'] } }
  vi.mocked(runProcess).mockResolvedValue({ ...success, stdout: JSON.stringify({ items: [], incomplete: false, diagnostics: 'No candidates' }) })
  const result = await provider.run(provider.resolve(operation, context), context)
  expect(result.incomplete).toBe(true)
  const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
  expect(saved.raw).toMatchObject({ inputEvidenceIds: ['input'] })
  expect(saved.raw).toHaveProperty('scriptSha256', expect.stringMatching(/^[a-f0-9]{64}$/u))
  expect(inspectToolbox).not.toHaveBeenCalled()
  expect(runProcess).toHaveBeenCalledOnce()
  context.inputEvidence = [{ ...evidence, provider: 'session-tool' }]
  await expect(provider.run(provider.resolve(operation, context), context)).rejects.toThrow('structured adapter')
  context.inputEvidence = [{ ...evidence, operation: 'jadx.manifest' }]
  await expect(provider.run(provider.resolve(operation, context), context)).rejects.toThrow('does not match')
  expect(runProcess).toHaveBeenCalledOnce()
})
