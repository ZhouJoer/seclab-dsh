/** Opt-in adapter execution against operator-configured local installations. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { expect, it, onTestFinished } from 'vitest'
import { readSecurityTools } from '../src/local-tools.ts'
import { LocalEnvironmentManager } from '../src/environment-local.ts'
import { ToolAdapterProvider } from '../src/tool-adapter-provider.ts'
import { adapterResultSchema } from '../src/tool-adapter-results.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext, SecurityEnvironment } from '../src/workbench/providers.ts'

function emptyApk(): Buffer {
  const dex = Buffer.alloc(140)
  dex.write('dex\n035\0', 0, 'ascii')
  for (const [offset, value] of [[32, 140], [36, 112], [40, 0x12345678], [52, 112], [104, 28], [108, 112],
    [112, 2], [120, 1], [128, 0x1000], [132, 1], [136, 112]] as const) dex.writeUInt32LE(value, offset)
  createHash('sha1').update(dex.subarray(32)).digest().copy(dex, 12)
  let a = 1, b = 0
  for (const byte of dex.subarray(12)) { a = (a + byte) % 65521; b = (b + a) % 65521 }
  dex.writeUInt32LE(((b << 16) | a) >>> 0, 8)
  return Buffer.from(zipSync({ 'classes.dex': dex }))
}
function elf(): Buffer {
  const bytes = Buffer.alloc(128)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  bytes.writeUInt16LE(2, 16); bytes.writeUInt16LE(62, 18); bytes.writeUInt32LE(1, 20)
  bytes.writeBigUInt64LE(0x400078n, 24); bytes.writeBigUInt64LE(64n, 32)
  bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(1, 56)
  bytes.writeUInt32LE(1, 64); bytes.writeUInt32LE(5, 68); bytes.writeBigUInt64LE(0x400000n, 80)
  bytes.writeBigUInt64LE(128n, 96); bytes.writeBigUInt64LE(128n, 104); bytes.writeBigUInt64LE(4096n, 112)
  bytes.set([0x31, 0xc0, 0xc3], 120)
  return bytes
}

it.skipIf(!process.env.DSH_SECURITY_ADAPTER_TOOLS)('runs local ELF, empty APK and PCAP through real adapters', async ({ signal }) => {
  const file = process.env.DSH_SECURITY_ADAPTER_TOOLS
  if (!file) throw new Error('Select an installation file')
  const root = await mkdtemp(join(tmpdir(), 'dsh-adapters-real-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(LocalSubprocess)
  const tools = Object.entries(readSecurityTools(file)).map(([id, pin]) => ({ id, ...pin, source: 'Selected installation' }))
  const artifacts = new ArtifactStore(root, 1048576)
  const provider = new ToolAdapterProvider(ctx, { maxItems: 100, maxInstructions: 10, maxPackets: 10, graceMs: 3000 }, 100)
  for (const [tool, action, format, bytes, parameters] of [
    ['radare2', 'identity', 'elf', elf(), {}],
    ['radare2', 'disassemble', 'elf', elf(), { address: '0x400078', count: 3 }],
    ['radare2', 'batch', 'elf', elf(), { queries: [{ operation: 'identity' },
      { operation: 'disassemble', address: '0x400078', count: 3, limit: 1 }] }],
    ['r2ghidra', 'decompile', 'elf', elf(), { address: '0x400078' }],
    ['jadx', 'decompile', 'apk', emptyApk(), {}],
    ['tshark', 'summary', 'other', Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000', 'hex'), {}],
  ] as const) {
    const artifact = await artifacts.put(bytes, 'application/octet-stream')
    const context: AnalysisContext = { artifacts, signal, durationMs: 30000, maxOutputBytes: 65536,
      environment: { id: 'local', kind: 'local', label: 'Local', cwd: root, tools },
      asset: fileAssetSchema.parse({ id: tool, engagementId: 'test', label: tool, format, artifact, identity: 'measured' }) }
    const operation = operationSchema.parse({ provider: 'tool-adapter', operation: tool + '.' + action,
      assetId: tool, environmentId: 'local', impact: 'observe', parameters })
    const result = await provider.run(provider.resolve(operation, context), context)
    expect(result.failure, tool + ': ' + Buffer.from(result.bytes).toString()).toBeUndefined()
    const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
    expect(saved.incomplete, tool + ': ' + saved.diagnostics).toBe(action === 'batch')
    if (action === 'batch') {
      expect(saved.items).toMatchObject([{ operation: 'identity', incomplete: false },
        { operation: 'disassemble', offset: 0, nextOffset: 1, incomplete: true }])
      const continuation = operationSchema.parse({ ...operation, parameters: { queries: [
        { operation: 'disassemble', address: '0x400078', count: 3, offset: 1, limit: 2 },
      ] } })
      const page = await provider.run(provider.resolve(continuation, context), context)
      expect(page.failure, Buffer.from(page.bytes).toString()).toBeUndefined()
      expect(adapterResultSchema.parse(JSON.parse(Buffer.from(page.bytes).toString())).items)
        .toMatchObject([{ offset: 1, nextOffset: null, incomplete: false }])
    }
    if (tool === 'radare2' || tool === 'r2ghidra') expect(saved.items.length).toBeGreaterThan(0)
    expect(await readdir(join(root, 'runs'))).toEqual([])
  }
}, 180000)

it.skipIf(!process.env.DSH_SECURITY_DOCKER_IMAGE)('queries ELF in a managed Docker image and releases staged files', async ({ signal }) => {
  const image = process.env.DSH_SECURITY_DOCKER_IMAGE
  if (!image) throw new Error('Select an existing Docker image')
  const root = await mkdtemp(join(tmpdir(), 'dsh-adapters-docker-'))
  const exchangeRoot = join(root, 'runs')
  await mkdir(exchangeRoot)
  const ctx = new Context()
  const environment: SecurityEnvironment = {
    id: 'adapter-docker', kind: 'docker', label: 'Adapter Docker', cwd: root, image, exchangeRoot,
    tools: ['docker', 'strings', 'readelf', 'objdump', 'nm'].map(id => ({
      id, command: id, versionArgs: ['--version'], source: 'Selected existing image',
    })),
  }
  const manager = new LocalEnvironmentManager(ctx, {
    timeoutMs: 30000, maxOutputBytes: 65536, graceMs: 5000, memoryMb: 256, cpus: 1, pids: 64, temporaryMb: 32,
  })
  onTestFinished(async () => {
    try {
      if (environment.containerId) await manager.stop(environment, new AbortController().signal)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
  await ctx.plugin(LocalSubprocess)
  await manager.start(environment, signal)
  const artifacts = new ArtifactStore(root, 1048576)
  const artifact = await artifacts.put(elf(), 'application/octet-stream')
  const context: AnalysisContext = { artifacts, signal, durationMs: 30000, maxOutputBytes: 65536, environment,
    asset: fileAssetSchema.parse({ id: 'elf', engagementId: 'test', label: 'ELF', format: 'elf', artifact, identity: 'measured' }) }
  const provider = new ToolAdapterProvider(ctx, { maxItems: 100, maxInstructions: 10, maxPackets: 10, graceMs: 3000 }, 100)
  for (const [tool, action] of [['strings', 'strings'], ['readelf', 'headers'], ['objdump', 'headers'], ['nm', 'symbols']] as const) {
    const operation = operationSchema.parse({ provider: 'tool-adapter', operation: tool + '.' + action,
      assetId: 'elf', environmentId: environment.id, impact: 'observe', parameters: {} })
    const result = await provider.run(provider.resolve(operation, context), context)
    expect(result.failure, tool + ': ' + Buffer.from(result.bytes).toString()).toBeUndefined()
    const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
    expect(saved.environmentId).toBe(environment.id)
    expect(saved.incomplete).toBe(false)
    if (tool === 'readelf') expect(saved.items.length).toBeGreaterThan(0)
    expect(await readdir(exchangeRoot)).toEqual([])
  }
}, 120000)
