/** Opt-in real Frida validation against a process created only for this test. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { it, expect, vi } from 'vitest'
import { FridaProvider } from '../src/frida-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { assetSchema, operationSchema } from '../src/workbench/model.ts'

it.skipIf(!process.env.DSH_SECURITY_FRIDA_PYTHON || !process.env.DSH_SECURITY_FRIDA_TARGET).each(['duration', 'cancel', ...(process.platform === 'win32' ? ['capture'] : [])])(
  'runs and cleans up an owned executable after %s through real Frida Python bindings',
  async (mode) => {
    const python = process.env.DSH_SECURITY_FRIDA_PYTHON!
    const target = process.env.DSH_SECURITY_FRIDA_TARGET!
    const root = await mkdtemp(join(tmpdir(), 'dsh-frida-观察-'))
    // Frida File uses the Windows ANSI file API; the runner's UTF-8 paths remain under root.
    const markerRoot = await mkdtemp(join(tmpdir(), 'dsh-frida-marker-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocess)
      const artifacts = new ArtifactStore(root, 16777216)
      const measured = await artifacts.import(target, [dirname(target)])
      const asset = assetSchema.parse({
        id: 'sample',
        engagementId: 'owned-test',
        label: 'Owned Python process',
        ...measured,
        identity: 'measured',
      })
      const marker = join(markerRoot, 'ready')
      const abort = new AbortController()
      const script = await artifacts.put(
        Buffer.from(`const file = new File(${JSON.stringify(marker)}, 'w'); file.write('ready'); file.close(); send({marker:'owned-fixture',platform:Process.platform});`),
        'text/javascript',
      )
      const context = {
        environment: {
          id: 'local',
          kind: 'local' as const,
          label: 'Owned test',
          cwd: dirname(target),
          tools: [{ id: 'python', command: python, versionArgs: ['--version'], source: 'isolated test installation' }],
        },
        asset,
        artifacts,
        signal: abort.signal,
        durationMs: mode === 'cancel' ? 15000 : mode === 'capture' ? 2000 : 250,
        maxOutputBytes: 65536,
      }
      const provider = new FridaProvider(ctx, 5000)
      const request = provider.resolve(
        operationSchema.parse({
          provider: 'frida',
          operation: mode === 'capture' ? 'trace' : 'script',
          assetId: asset.id,
          environmentId: 'local',
          parameters: { target: { mode: 'spawn', argv: [target, '-c', mode === 'capture'
            ? 'import ctypes,time; b=ctypes.create_string_buffer(bytes([65,0,66,67,0])); ctypes.windll.kernel32.OutputDebugStringA(b); time.sleep(60)'
            : 'import time; time.sleep(60)'] }, ...(mode === 'capture' ? { module: 'kernel32.dll', symbol: 'OutputDebugStringA',
            capture: { arguments: [0], returnValue: true, memory: [{ argument: 0, length: 5, when: 'enter' }], maxCalls: 4 } } : {}) },
          ...(mode === 'capture' ? {} : { script }),
          impact: 'target-write',
        }),
        context,
      )
      const pending = provider.run(request, context)
      if (mode === 'cancel') {
        try {
          await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('ready') }, { timeout: 15000 })
        } finally {
          abort.abort(new Error('Operator stopped the owned test'))
        }
      }
      const result = await pending
      expect(result.toolVersion).toMatch(/^\d+\.\d+\.\d+$/u)
      expect(result.incomplete, Buffer.from(result.bytes).toString()).toBe(mode === 'cancel')
      expect(Buffer.from(result.bytes).toString()).toContain(mode === 'capture' ? '4100424300' : 'owned-fixture')
      expect(Buffer.from(result.bytes).toString()).toContain('owned-process-stopped')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(markerRoot, { recursive: true, force: true })
    }
  },
  30000,
)
