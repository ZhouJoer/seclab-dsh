/** Real fixed-script acceptance for explicitly selected Ghidra import formats and analysis settings. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { ToolAdapterProvider } from '../src/tool-adapter-provider.ts'
import { adapterResultSchema } from '../src/tool-adapter-results.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'
import type { GhidraAnalysisInput } from '../src/ghidra-analysis-profile.ts'
import { peImageBytes } from './pe-fixture.ts'

const real = it.skipIf(!process.env.DSH_GHIDRA_HEADLESS_DIR || !process.env.DSH_GHIDRA_HEADLESS_JAVA)

async function fixture(signal: AbortSignal, bytes: Uint8Array, analysis: GhidraAnalysisInput) {
  const distribution = process.env.DSH_GHIDRA_HEADLESS_DIR, java = process.env.DSH_GHIDRA_HEADLESS_JAVA
  if (!distribution || !java) throw new Error('Select a Ghidra distribution and Java executable')
  const root = await mkdtemp(join(process.env.DSH_GHIDRA_HEADLESS_TEST_ROOT ?? tmpdir(), 'dsh-ghidra-format-'))
  const ctx = new Context()
  const owner: { provider?: ToolAdapterProvider } = {}
  onTestFinished(async () => {
    await owner.provider?.dispose()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(LocalSubprocess)
  const tool = { id: 'ghidra-headless', command: java,
    prefixArgs: ['-Djava.system.class.loader=ghidra.GhidraClassLoader', '-cp', join(distribution, 'Ghidra', 'Framework', 'Utility', 'lib', 'Utility.jar'),
      'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless'], versionArgs: ['-help'], source: 'Selected real Ghidra' }
  const artifacts = new ArtifactStore(root, 1048576)
  const artifact = await artifacts.put(bytes, 'application/octet-stream')
  const context: AnalysisContext = { artifacts, signal, durationMs: 90000, maxOutputBytes: 65536,
    environment: { id: 'format-ghidra', kind: 'local', label: 'Real Ghidra', cwd: root, tools: [tool] },
    asset: fileAssetSchema.parse({ id: 'sample', engagementId: 'test', label: 'Static format fixture', format: 'other', identity: 'measured', artifact }) }
  const provider = new ToolAdapterProvider(ctx, { maxItems: 20, maxInstructions: 4, maxPackets: 10, graceMs: 3000,
    ghidraHeadless: { cacheDirectory: 'ghidra-cache', maxHeapMb: 1024, maxCpu: 2, analysisTimeoutSeconds: 30,
      decompileTimeoutSeconds: 10, sessionIdleTimeoutMs: 30000, maxSessions: 2, protocolPollIntervalMs: 25 } }, 10)
  owner.provider = provider
  const selected = provider
  return { root, artifact, provider: selected,
    async query(operation: string, parameters: Record<string, string | number> = {}) {
      const request = operationSchema.parse({ provider: 'tool-adapter', operation: 'ghidra-headless.' + operation,
        environmentId: context.environment.id, assetId: 'sample', impact: 'observe', parameters: { ...parameters, analysis } })
      return selected.run(selected.resolve(request, context), context)
    },
  }
}

function decode(result: Awaited<ReturnType<ToolAdapterProvider['run']>>) {
  expect(result.failure, Buffer.from(result.bytes).toString()).toBeUndefined()
  expect(result.cleanup).toBeUndefined()
  const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
  expect(saved.incomplete).toBe(false)
  return saved
}

real('imports raw x86, applies function and label seeds and reuses the resident program', { retry: 0 }, async ({ signal }) => {
  const f = await fixture(signal, Buffer.from([0xb8, 42, 0, 0, 0, 0xc3]), {
    import: { format: 'raw', languageId: 'x86:LE:32:default', compilerSpecId: 'gcc', baseAddress: '0x400000', entryAddress: '0x400000' },
    seeds: [{ kind: 'function', address: '0x400000', name: 'answer42' }, { kind: 'label', address: '0x400005', name: 'return_site' }],
  })
  const identity = decode(await f.query('identity'))
  expect(identity.inputSha256).toBe(f.artifact.sha256)
  expect(identity.items[0]).toMatchObject({ language: 'x86:LE:32:default', preparation: { importFormat: 'raw', appliedSeeds: 2 } })
  const functions = decode(await f.query('functions'))
  const named = z.array(z.object({ name: z.string(), address: z.string() })).parse(functions.items).find(item => item.name === 'answer42')
  expect(BigInt(named?.address ?? '-1')).toBe(0x400000n)
  const decompile = decode(await f.query('decompile', { address: '0x400000' }))
  expect(z.array(z.object({ code: z.string() })).parse(decompile.items)[0]?.code).toMatch(/return (?:0x2a|42);/u)
  expect(decompile.raw).toMatchObject({ sessionReused: true })
  await f.provider.dispose()
  expect((await readdir(join(f.root, 'ghidra-cache'))).some(name => name.endsWith('.lease'))).toBe(false)
})

real('imports DOS COM and round-trips its returned function address into disassembly', { retry: 0 }, async ({ signal }) => {
  const f = await fixture(signal, Buffer.from([0xb8, 42, 0, 0xc3]), { import: { format: 'dos-com' } })
  const identity = decode(await f.query('identity'))
  expect(identity.items[0]).toMatchObject({ language: 'x86:LE:16:Real Mode', preparation: { importFormat: 'dos-com' } })
  const functions = z.array(z.object({ address: z.string(), name: z.string() })).parse(decode(await f.query('functions')).items)
  expect(functions.length).toBeGreaterThan(0)
  const entry = functions[0]
  if (!entry) throw new Error('DOS COM entry function is absent')
  const disassembly = decode(await f.query('disassemble', { address: entry.address, count: 2 }))
  expect(z.array(z.object({ instruction: z.string() })).parse(disassembly.items).map(item => item.instruction).join('\n')).toMatch(/MOV|mov/u)
})

real('maps a GameCube DOL text section and decompiles its PowerPC entry', { retry: 0 }, async ({ signal }) => {
  const bytes = Buffer.alloc(0x108)
  bytes.writeUInt32BE(0x100, 0)
  bytes.writeUInt32BE(0x80003100, 0x48)
  bytes.writeUInt32BE(8, 0x90)
  bytes.writeUInt32BE(0x80003100, 0xe0)
  bytes.set([0x38, 0x60, 0, 42, 0x4e, 0x80, 0, 0x20], 0x100)
  const f = await fixture(signal, bytes, { import: { format: 'gamecube-dol' } })
  expect(decode(await f.query('identity')).items[0]).toMatchObject({ language: 'PowerPC:BE:32:default', preparation: { importFormat: 'gamecube-dol' } })
  const decompile = decode(await f.query('decompile', { address: '0x80003100' }))
  expect(z.array(z.object({ code: z.string() })).parse(decompile.items)[0]?.code).toMatch(/return (?:0x2a|42);/u)
})

function returningPe(): Buffer {
  const bytes = peImageBytes()
  bytes.writeUInt16LE(0x22, 0x96)
  bytes.writeUInt32LE(0x200, 0x98 + 4)
  bytes.writeUInt32LE(0x1000, 0x98 + 16)
  bytes.writeUInt32LE(0x200, 0x98 + 36)
  bytes.writeUInt16LE(3, 0x98 + 68)
  bytes.writeUInt32LE(16, 0x98 + 108)
  bytes.writeUInt32LE(0x60000020, 0x188 + 36)
  bytes.set([0xb8, 42, 0, 0, 0, 0xc3], 0x200)
  return bytes
}

real('refuses an unknown analyzer without publishing completed analysis', { retry: 0 }, async ({ signal }) => {
  const f = await fixture(signal, returningPe(), { disabledAnalyzers: ['DSH nonexistent analyzer acceptance fixture'] })
  const result = await f.query('identity')
  expect(result.failure).toBeTruthy()
  const retained = Buffer.from(result.bytes).toString()
  expect(retained).toContain('Unknown Ghidra analyzer: DSH nonexistent analyzer acceptance fixture')
  await f.provider.dispose()
  expect((await readdir(join(f.root, 'ghidra-cache'))).filter(name => /^[a-f0-9]{64}$/u.test(name))).toEqual([])
})

real('refuses MIPS repair on an x86 PE before exposing a resident query session', { retry: 0 }, async ({ signal }) => {
  const f = await fixture(signal, returningPe(), { corrections: { mipsSoftFloat: true } })
  const result = await f.query('identity')
  expect(result.failure).toBeTruthy()
  expect(Buffer.from(result.bytes).toString()).toContain('DSH soft-float storage requires a 32-bit MIPS program, not x86')
  await f.provider.dispose()
  expect((await readdir(join(f.root, 'ghidra-cache'))).filter(name => /^[a-f0-9]{64}$/u.test(name))).toEqual([])
})
