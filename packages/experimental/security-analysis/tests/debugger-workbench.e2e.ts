/** Opt-in single-stop observations and timeout cleanup against inert looping fixtures. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DebuggerProvider } from '../src/debugger-provider.ts'
import { LocalEnvironmentManager } from '../src/environment-local.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'
import { runProcess } from '../src/workbench/process.ts'

function fixture(pe: boolean): Buffer {
  if (!pe) {
    const bytes = Buffer.alloc(256)
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
    bytes.writeUInt16LE(2, 16); bytes.writeUInt16LE(62, 18); bytes.writeUInt32LE(1, 20)
    bytes.writeBigUInt64LE(0x400078n, 24); bytes.writeBigUInt64LE(64n, 32)
    bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(1, 56)
    bytes.writeUInt32LE(1, 64); bytes.writeUInt32LE(5, 68); bytes.writeBigUInt64LE(0x400000n, 80)
    bytes.writeBigUInt64LE(256n, 96); bytes.writeBigUInt64LE(256n, 104); bytes.writeBigUInt64LE(4096n, 112)
    bytes.set([0xb8, 0x41, 0, 0x42, 0, 0xeb, 0xfe], 120)
    return bytes
  }
  const bytes = Buffer.alloc(1024)
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128)
  bytes.writeUInt16LE(0x14c, 132); bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(224, 148); bytes.writeUInt16LE(0x102, 150)
  const opt = 152
  bytes.writeUInt16LE(0x10b, opt); bytes.writeUInt32LE(512, opt + 4); bytes.writeUInt32LE(0x1000, opt + 16)
  bytes.writeUInt32LE(0x1000, opt + 20); bytes.writeUInt32LE(0x400000, opt + 28)
  bytes.writeUInt32LE(4096, opt + 32); bytes.writeUInt32LE(512, opt + 36)
  bytes.writeUInt16LE(4, opt + 40); bytes.writeUInt16LE(4, opt + 48)
  bytes.writeUInt32LE(8192, opt + 56); bytes.writeUInt32LE(512, opt + 60); bytes.writeUInt16LE(3, opt + 68)
  bytes.writeUInt32LE(1048576, opt + 72); bytes.writeUInt32LE(4096, opt + 76)
  bytes.writeUInt32LE(1048576, opt + 80); bytes.writeUInt32LE(4096, opt + 84); bytes.writeUInt32LE(16, opt + 92)
  const section = opt + 224
  bytes.write('.text', section); bytes.writeUInt32LE(512, section + 8); bytes.writeUInt32LE(4096, section + 12)
  bytes.writeUInt32LE(512, section + 16); bytes.writeUInt32LE(512, section + 20); bytes.writeUInt32LE(0x60000020, section + 36)
  bytes.set([0xb8, 0x41, 0, 0x42, 0, 0xeb, 0xfe], 512)
  return bytes
}

it.skipIf(!process.env.DSH_SECURITY_DEBUG_IMAGE && !process.env.DSH_SECURITY_CDB).each(['stop', 'timeout', ...(!process.env.DSH_SECURITY_CDB ? ['fork'] : [])])(
  'observes inert binary memory and settles owned processes: %s', async (mode) => {
    const cdb = process.env.DSH_SECURITY_CDB
    const image = process.env.DSH_SECURITY_DEBUG_IMAGE
    if (!cdb && !image) throw new Error('Select an installed debugger or image')
    const root = await mkdtemp(join(tmpdir(), 'dsh-debug-real-'))
    const ctx = new Context()
    const environment: SecurityEnvironment = { id: 'debug-smoke', kind: cdb ? 'local' : 'docker', label: 'Owned debugger fixture',
      cwd: root, ...(image ? { image, exchangeRoot: join(root, 'runs') } : {}),
      tools: cdb ? [{ id: 'cdb', command: cdb, versionArgs: ['-version'], source: 'Selected installed debugger' }]
        : ['docker', 'gdb', 'python3'].map(id => ({ id, command: id, versionArgs: ['--version'], source: 'Pinned image' })) }
    const manager = new LocalEnvironmentManager(ctx, { timeoutMs: 30000, maxOutputBytes: 65536, graceMs: 5000,
      memoryMb: 1024, cpus: 1, pids: 64, temporaryMb: 64 })
    try {
      await ctx.plugin(LocalSubprocess)
      await mkdir(join(root, 'runs'))
      if (!cdb) await manager.start(environment, new AbortController().signal)
      const artifacts = new ArtifactStore(root, 1048576)
      const sample = fixture(!!cdb)
      if (mode === 'fork') sample.set([0xb8, 57, 0, 0, 0, 0x0f, 0x05, 0x85, 0xc0, 0x74, 2, 0xeb, 2, 0xeb, 0xfe, 0xeb, 0xfe], 120)
      const artifact = await artifacts.put(sample, 'application/octet-stream')
      const context = { environment, artifacts, signal: new AbortController().signal, durationMs: mode === 'timeout' ? 1500 : 15000,
        maxOutputBytes: 262144, asset: fileAssetSchema.parse({ id: 'fixture', engagementId: 'smoke', artifact,
          format: cdb ? 'pe' : 'elf', label: 'Inert loop', identity: 'measured' }) }
      const request = operationSchema.parse({ provider: 'debugger', operation: 'run', assetId: 'fixture', environmentId: environment.id,
        impact: 'target-write', parameters: { engine: cdb ? 'cdb' : 'gdb',
          breakpoint: mode === 'timeout' ? '0x400090' : mode === 'fork' ? '0x400087' : cdb ? '0x401005' : '0x40007d',
          memory: [{ address: cdb ? '0x401000' : '0x400078', length: 7 }] } })
      const provider = new DebuggerProvider(ctx, { graceMs: 5000 })
      const result = await provider.run(provider.resolve(request, context), context)
      const raw = Buffer.from(result.bytes).toString()
      if (mode !== 'timeout') {
        expect(result.failure, raw).toBeUndefined()
        expect(raw).toMatch(cdb ? /b8 41 00 42 00 eb fe/u : mode === 'fork' ? /b8390000000f05/u : /b841004200ebfe/u)
      } else {
        expect(result.incomplete).toBe(true)
        expect(result.failure, raw).toContain('timedOut')
      }
      if (!cdb && mode === 'stop') {
        const pid = /thread-group-started[^\n]*?pid=\\"(\d+)\\"/u.exec(raw)?.[1]
        expect(pid).toBeDefined()
        const probe = await runProcess(ctx, environment, 'python3', ['-I', '-c', 'import os,sys; print(os.path.exists("/proc/"+sys.argv[1]))', String(pid)], {
          signal: context.signal, durationMs: 5000, maxOutputBytes: 8192, graceMs: 3000 })
        expect(probe.exitCode).toBe(0)
        expect(probe.stdout.trim()).toBe('False')
      }
      if (mode === 'fork') {
        expect([...raw.matchAll(/=thread-group-started/gu)]).toHaveLength(2)
        expect(raw).not.toContain('Detaching after fork')
        const probe = await runProcess(ctx, environment, 'python3', ['-I', '-c',
          'import glob,os\nremaining=[]\nfor path in glob.glob("/proc/[0-9]*/exe"):\n try: target=os.readlink(path)\n except FileNotFoundError: continue\n if target.startswith("/dsh-inputs/"): remaining.append(path)\nprint(remaining)'], {
          signal: context.signal, durationMs: 5000, maxOutputBytes: 8192, graceMs: 3000 })
        expect(probe.exitCode, probe.stderr).toBe(0)
        expect(probe.stdout.trim(), raw).toBe('[]')
      }
    } finally {
      if (environment.containerId) await manager.stop(environment, new AbortController().signal)
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  }, 60000,
)
