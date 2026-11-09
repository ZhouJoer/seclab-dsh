/** Static PE range rejection preserves valid queries and unknown input handling. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { peAddressError, readPeImageRange } from '../src/pe-address-range.ts'
import { ToolAdapterProvider } from '../src/tool-adapter-provider.ts'
import { adapterResultSchema } from '../src/tool-adapter-results.ts'
import { inspectToolbox } from '../src/toolbox.ts'
import { runProcess } from '../src/workbench/process.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisOperation } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'
import { peImageBytes as pe } from './pe-fixture.ts'

vi.mock('../src/toolbox.ts', async original => ({ ...await original<typeof import('../src/toolbox.ts')>(), inspectToolbox: vi.fn() }))
vi.mock('../src/workbench/process.ts', async original => ({ ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn() }))
afterEach(() => vi.resetAllMocks())

async function fixture(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pe-range-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'sample')
  await writeFile(path, bytes)
  return { root, path }
}

it.each([32, 64] as const)('checks the half-open PE%s image interval without requiring a function', async (bits) => {
  const { path } = await fixture(pe(bits))
  const base = bits === 64 ? 0x180000000n : 0x400000n
  const range = await readPeImageRange(path)
  expect(range).toEqual({ base, end: base + 0x2000n })
  for (const value of [base, base + 0x1fffn]) expect(peAddressError(range, '0x' + value.toString(16))).toBeUndefined()
  for (const value of [base - 1n, base + 0x2000n])
    expect(peAddressError(range, '0x' + value.toString(16))).toMatchObject({ code: 'PE_ADDRESS_OUTSIDE_IMAGE' })
})

it('compares 64-bit addresses exactly beyond the Number integer range', async () => {
  const base = 0x20000000000000n
  const { path } = await fixture(pe(64, base))
  const range = await readPeImageRange(path)
  expect(peAddressError(range, '0x20000000001fff')).toBeUndefined()
  expect(peAddressError(range, '0x20000000002000')).toMatchObject({ code: 'PE_ADDRESS_OUTSIDE_IMAGE' })
})

it('leaves unknown, truncated and inconsistent images to the underlying tool', async () => {
  const mutations: ((bytes: Buffer) => Buffer)[] = [
    bytes => bytes.subarray(0, 20),
    bytes => bytes.subarray(0, 0xa0),
    (bytes) => { bytes.writeUInt32LE(0xffffffff, 60); return bytes },
    (bytes) => { bytes.writeUInt32LE(0, 0x80); return bytes },
    (bytes) => { bytes.writeUInt16LE(0, 0x86); return bytes },
    (bytes) => { bytes.writeUInt16LE(32, 0x94); return bytes },
    (bytes) => { bytes.writeUInt16LE(96, 0x94); return bytes },
    (bytes) => { bytes.writeUInt16LE(0, 0x98); return bytes },
    (bytes) => { bytes.writeUInt32LE(0, 0x98 + 32); return bytes },
    (bytes) => { bytes.writeUInt32LE(0, 0x98 + 56); return bytes },
    (bytes) => { bytes.writeUInt32LE(0x2001, 0x98 + 56); return bytes },
    (bytes) => { bytes.writeUInt32LE(0x80, 0x98 + 60); return bytes },
    (bytes) => { bytes.writeUInt32LE(0x800, 0x98 + 60); return bytes },
    (bytes) => { bytes.writeUInt32LE(0x3000, 0x188 + 8); return bytes },
    (bytes) => { bytes.writeUInt32LE(0x400, 0x188 + 20); return bytes },
    (bytes) => { bytes.writeBigUInt64LE(0xfffffffffffff000n, 0x98 + 24); return bytes },
  ]
  for (const bytes of [Buffer.from('not PE'), Buffer.from('7f454c460201', 'hex'), ...mutations.map(mutate => mutate(pe()))]) {
    const { path } = await fixture(bytes)
    const range = await readPeImageRange(path)
    expect(range).toBeUndefined()
    expect(peAddressError(range, '0x1')).toBeUndefined()
  }
})

async function providerFixture() {
  const { root } = await fixture(pe())
  const artifacts = new ArtifactStore(root, 4096)
  const artifact = await artifacts.put(pe(), 'application/octet-stream')
  const context: AnalysisContext = {
    artifacts, signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 16000,
    asset: fileAssetSchema.parse({ id: 'file', engagementId: 'project', label: 'Input', artifact, format: 'pe', identity: 'measured' }),
    environment: { id: 'host', kind: 'local', cwd: root, label: 'Host', tools: [
      { id: 'radare2', command: 'r2', prefixArgs: [], versionArgs: ['--version'], source: 'Fixture' },
    ] },
  }
  const provider = new ToolAdapterProvider(new Context(), { maxPackets: 10, maxItems: 5, maxInstructions: 10, graceMs: 100 }, 20)
  vi.mocked(inspectToolbox).mockImplementation(async (_ctx, _environment, _limits, _signal, ids) => ({
    environmentId: 'host', kind: 'local', runtime: 'ready', detail: '', checkedAt: 1, workdir: root,
    tools: [{ id: ids?.[0] ?? 'radare2', category: 'utility', status: 'available', command: 'r2', version: '1',
      location: '', source: 'Fixture', detail: '', installUrl: '', invocation: 'shell',
      installation: { command: 'r2', prefixArgs: context.environment.tools[0]?.prefixArgs ?? [] } }],
  }))
  vi.mocked(runProcess).mockResolvedValue({ stdout: '{"code":"return;"}', stderr: '', exitCode: 0,
    signal: null, timedOut: false, cancelled: false, truncated: false })
  const run = (operation: string, parameters: AnalysisOperation['parameters']) => {
    const request = operationSchema.parse({ provider: 'tool-adapter', operation, assetId: 'file', environmentId: 'host', impact: 'observe', parameters })
    return provider.run(provider.resolve(request, context), context)
  }
  return { root, context, run }
}

it.each(['r2ghidra.decompile', 'radare2.disassemble', 'radare2.xrefs-from'])
('rejects an outside address before %s runs and releases its input', async (operation) => {
  const { root, run } = await providerFixture()
  await expect(run(operation, { address: '0x18001000' })).rejects.toThrow(
    'Virtual address 0x18001000 is outside the PE image range [0x180000000, 0x180002000). ImageBase is 0x180000000. Check the virtual address against this imported binary; no address was substituted.')
  expect(runProcess).not.toHaveBeenCalled()
  expect(await readdir(join(root, 'runs'))).toEqual([])
})

it('passes an in-range entry unchanged and leaves custom launchers responsible for their address space', async () => {
  const { context, run } = await providerFixture()
  await run('r2ghidra.decompile', { address: '0x180001000' })
  expect(vi.mocked(runProcess).mock.calls[0]?.[3]).toContain('aa;s 0x180001000;af;pdgj')
  const installation = context.environment.tools[0]
  expect(installation).toBeDefined()
  if (installation) installation.prefixArgs = ['-B', '0x18000000']
  await run('r2ghidra.decompile', { address: '0x18001000' })
  expect(vi.mocked(runProcess).mock.calls[1]?.[3]).toContain('aa;s 0x18001000;af;pdgj')
})

it('allows references to an external target without requiring the target to be mapped', async () => {
  const { run } = await providerFixture()
  vi.mocked(runProcess).mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0,
    signal: null, timedOut: false, cancelled: false, truncated: false })
  await run('radare2.xrefs-to', { address: '0x18001000' })
  expect(vi.mocked(runProcess).mock.calls[0]?.[3]).toContain('aa;axtj @ 0x18001000')
})

it('returns results around an out-of-range PE query in their original batch positions', async () => {
  const { root, run } = await providerFixture()
  vi.mocked(runProcess).mockResolvedValue({ stdout: '[[{"name":"ReadFile"}],[{"offset":6442455040,"opcode":"ret"}]]',
    stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false })
  const result = await run('radare2.batch', { queries: [
    { operation: 'imports' },
    { operation: 'xrefs-from', address: '0x18001000' },
    { operation: 'disassemble', address: '0x180001000', count: 1 },
  ] })
  expect(runProcess).toHaveBeenCalledOnce()
  expect(vi.mocked(runProcess).mock.calls[0]?.[3][5]).toBe('?e [;iij;?e ,;pdj 1 @ 0x180001000;?e ]')
  expect(result.failure).toBeUndefined()
  expect(result.incomplete).toBe(true)
  const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
  expect(saved.items).toMatchObject([
    { queryIndex: 0, operation: 'imports', items: [{ name: 'ReadFile' }], incomplete: false },
    { queryIndex: 1, operation: 'xrefs-from', items: [], incomplete: true },
    { queryIndex: 2, operation: 'disassemble', items: [{ offset: 6442455040, opcode: 'ret' }], incomplete: false },
  ])
  expect(saved.items[1]).toHaveProperty('failure', expect.stringContaining('Virtual address 0x18001000 is outside the PE image range'))
  expect(await readdir(join(root, 'runs'))).toEqual([])
})

it('returns query errors without launching r2 when every batch address is outside the PE image', async () => {
  const { root, run } = await providerFixture()
  const result = await run('radare2.batch', { queries: [{ operation: 'xrefs-from', address: '0x18001000' }] })
  expect(runProcess).not.toHaveBeenCalled()
  expect(result.failure).toBeUndefined()
  const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
  expect(saved).toMatchObject({ raw: null, incomplete: true, items: [{
    queryIndex: 0, operation: 'xrefs-from', incomplete: true, items: [],
  }] })
  expect(saved.items[0]).toHaveProperty('failure', expect.stringContaining('ImageBase is 0x180000000'))
  expect(await readdir(join(root, 'runs'))).toEqual([])
})
