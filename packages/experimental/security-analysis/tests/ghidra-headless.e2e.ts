/** Opt-in fixed Ghidra script acceptance against a selected distribution and JDK. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { ToolAdapterProvider } from '../src/tool-adapter-provider.ts'
import { adapterResultSchema } from '../src/tool-adapter-results.ts'
import { inspectGhidraHeadlessInstallation } from '../src/ghidra-headless.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'
import { peImageBytes } from './pe-fixture.ts'

it.skipIf(!process.env.DSH_GHIDRA_HEADLESS_DIR || !process.env.DSH_GHIDRA_HEADLESS_JAVA)(
  'queries one resident PE program and reopens its saved project after closing the JVM', { retry: 0 }, async ({ signal }) => {
    const distribution = process.env.DSH_GHIDRA_HEADLESS_DIR, java = process.env.DSH_GHIDRA_HEADLESS_JAVA
    if (!distribution || !java) throw new Error('Select a Ghidra distribution and Java executable')
    const root = await mkdtemp(join(process.env.DSH_GHIDRA_HEADLESS_TEST_ROOT ?? tmpdir(), 'dsh-ghidra-real-'))
    const ctx = new Context()
    const owner: { provider?: ToolAdapterProvider } = {}
    onTestFinished(async () => {
      await owner.provider?.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
    })
    await ctx.plugin(LocalSubprocess)
    const tool = { id: 'ghidra-headless', command: java,
      prefixArgs: ['-Djava.system.class.loader=ghidra.GhidraClassLoader', '-cp', join(distribution, 'Ghidra', 'Framework', 'Utility', 'lib', 'Utility.jar'),
        'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless'], versionArgs: ['-help'], source: 'Selected real Ghidra' }
    const bytes = peImageBytes()
    bytes.writeUInt16LE(0x22, 0x96)
    bytes.writeUInt32LE(0x200, 0x98 + 4)
    bytes.writeUInt32LE(0x1000, 0x98 + 16)
    bytes.writeUInt32LE(0x200, 0x98 + 36)
    bytes.writeUInt16LE(3, 0x98 + 68)
    bytes.writeUInt32LE(16, 0x98 + 108)
    bytes.writeUInt32LE(0x60000020, 0x188 + 36)
    bytes.set([0xff, 0x15, 0xca, 0, 0, 0, 0xb8, 42, 0, 0, 0, 0xc3], 0x200)
    bytes.writeUInt32LE(0x1080, 0x98 + 120)
    bytes.writeUInt32LE(40, 0x98 + 124)
    bytes.writeUInt32LE(0x10d0, 0x98 + 208)
    bytes.writeUInt32LE(16, 0x98 + 212)
    bytes.writeUInt32LE(0x10c0, 0x280)
    bytes.writeUInt32LE(0x10e0, 0x28c)
    bytes.writeUInt32LE(0x10d0, 0x290)
    bytes.writeBigUInt64LE(0x10f0n, 0x2c0)
    bytes.writeBigUInt64LE(0x10f0n, 0x2d0)
    bytes.write('KERNEL32.dll\0', 0x2e0)
    bytes.write('GetCurrentProcessId\0', 0x2f2)
    const artifacts = new ArtifactStore(root, 1048576)
    const artifact = await artifacts.put(bytes, 'application/octet-stream')
    const context: AnalysisContext = { artifacts, signal, durationMs: 60000, maxOutputBytes: 65536,
      environment: { id: 'real-ghidra', kind: 'local', label: 'Real Ghidra', cwd: root, tools: [tool] },
      asset: fileAssetSchema.parse({ id: 'pe', engagementId: 'test', label: 'Tiny PE', format: 'pe', identity: 'measured', artifact }) }
    const selected = await inspectGhidraHeadlessInstallation(ctx, context.environment, tool,
      { durationMs: 30000, maxOutputBytes: 4096, graceMs: 3000 }, signal)
    expect(selected.version).toMatch(/^\d+\./u)
    const provider = new ToolAdapterProvider(ctx, { maxItems: 20, maxInstructions: 2, maxPackets: 10, graceMs: 3000,
      ghidraHeadless: { cacheDirectory: 'ghidra-cache', maxHeapMb: 1024, maxCpu: 2, analysisTimeoutSeconds: 30, decompileTimeoutSeconds: 10,
        maxSessions: 2, sessionIdleTimeoutMs: 60000, protocolPollIntervalMs: 50 } }, 10)
    owner.provider = provider
    let importedAddress: string | undefined
    let sessionId: string | undefined
    for (const operation of ['identity', 'functions', 'imports', 'exports', 'strings', 'decompile', 'disassemble', 'xrefs-to', 'xrefs-from']) {
      const request = operationSchema.parse({ provider: 'tool-adapter', operation: 'ghidra-headless.' + operation,
        environmentId: context.environment.id, assetId: 'pe', impact: 'observe',
        parameters: ['decompile', 'disassemble', 'xrefs-to', 'xrefs-from'].includes(operation)
          ? { address: operation === 'xrefs-to' ? importedAddress : '0x180001000' } : {} })
      const result = await provider.run(provider.resolve(request, context), context)
      expect(result.failure, operation + ': ' + Buffer.from(result.bytes).toString()).toBeUndefined()
      expect(result.cleanup).toBeUndefined()
      const saved = adapterResultSchema.parse(JSON.parse(Buffer.from(result.bytes).toString()))
      expect(saved.inputSha256).toBe(artifact.sha256)
      expect(saved.toolVersion).toBe(selected.version)
      expect(saved.raw).toMatchObject({ reused: operation !== 'identity', analysisTimedOut: false })
      const resident = z.object({ sessionId: z.string(), running: z.literal(true) }).parse(saved.raw)
      sessionId ??= resident.sessionId
      expect(resident.sessionId).toBe(sessionId)
      if (['identity', 'functions', 'decompile', 'disassemble'].includes(operation)) expect(saved.items.length).toBeGreaterThan(0)
      if (operation === 'decompile') expect(z.array(z.object({ code: z.string() })).parse(saved.items)[0]?.code).toContain('return')
      if (operation === 'imports') {
        importedAddress = z.array(z.object({ address: z.string(), name: z.string() })).parse(saved.items)
          .find(item => item.name === 'GetCurrentProcessId')?.address
        expect(importedAddress).toMatch(/^EXTERNAL:[0-9a-fA-F]+$/u)
      }
      if (operation === 'xrefs-to') {
        expect(saved.incomplete).toBe(false)
        expect(saved.items.length).toBeGreaterThan(0)
        expect(z.array(z.object({ to: z.string() })).parse(saved.items).every(item => item.to === importedAddress)).toBe(true)
      }
    }
    await provider.closeEnvironment(context.environment.id)
    const identity = operationSchema.parse({ provider: 'tool-adapter', operation: 'ghidra-headless.identity',
      environmentId: context.environment.id, assetId: 'pe', impact: 'observe', parameters: {} })
    const reopened = await provider.run(provider.resolve(identity, context), context)
    expect(reopened.failure).toBeUndefined()
    const reopenedRaw = z.object({ cacheReused: z.boolean(), sessionReused: z.boolean(), sessionId: z.string() })
      .parse(adapterResultSchema.parse(JSON.parse(Buffer.from(reopened.bytes).toString())).raw)
    expect(reopenedRaw).toMatchObject({ cacheReused: true, sessionReused: false })
    expect(reopenedRaw.sessionId).not.toBe(sessionId)
    await provider.dispose()
    expect(await readdir(join(root, 'runs'))).toEqual([])
    expect((await readdir(join(root, 'ghidra-cache'))).filter(entry => entry.endsWith('.lease'))).toEqual([])
  })
