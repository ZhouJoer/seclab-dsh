/** Fixed debugger programs reject command injection and preserve failed observations. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi, onTestFinished } from 'vitest'
import { DebuggerProvider, debuggerInvocation } from '../src/debugger-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async original => ({
  ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
async function fixture(maxOutputBytes = 65536) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-debug-unit-'))
  onTestFinished(async () => { vi.resetAllMocks(); await rm(root, { recursive: true, force: true }) })
  const artifacts = new ArtifactStore(root, 65536)
  const artifact = await artifacts.put(Buffer.from('fixture'), 'application/octet-stream')
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 1000, maxOutputBytes,
    asset: fileAssetSchema.parse({ id: 'sample', engagementId: 'test', format: 'elf', artifact, label: 'Fixture', identity: 'measured' }),
    environment: { id: 'docker', kind: 'docker', label: 'Fixture', cwd: root,
      tools: [{ id: 'gdb', command: 'gdb', versionArgs: ['--version'], source: 'test' }] } }
  const request = operationSchema.parse({ provider: 'debugger', operation: 'run', assetId: 'sample', environmentId: 'docker',
    impact: 'observe', parameters: { engine: 'gdb', breakpoint: 'entry', memory: [{ address: '0x1000', length: 4 }] } })
  return { root, context, artifact, request, provider: new DebuggerProvider(new Context(), { graceMs: 100 }) }
}
it('uses synchronous MI commands and rejects command-language values before launch', () => {
  const input = { engine: 'gdb', breakpoint: '0x401005', memory: [{ address: '$rax', length: 4 }] }
  expect(debuggerInvocation(input, '/sample').input).toContain('4-gdb-set detach-on-fork off\n5-gdb-set schedule-multiple on\n6-break-insert "*0x401005"\n7-exec-run')
  expect(debuggerInvocation(input, '/sample').input).toContain('10-data-read-memory-bytes "$rax" 4')
  expect(() => debuggerInvocation({ ...input, breakpoint: 'main; shell id' }, '/sample')).toThrow()
  expect(() => debuggerInvocation({ ...input, memory: [{ address: 'x\n-gdb-exit', length: 4 }] }, '/sample')).toThrow()
  expect(debuggerInvocation({ ...input, engine: 'cdb', memory: [{ address: '0x401000', length: 16 }] }, 'sample.exe').args)
    .toContain('bu 0x401005 ".echo DSH_DEBUG_STOP; |; r; db 0x401000 L10; .echo DSH_DEBUG_END; q"; g')
})
it.each([
  ['7^running\n*stopped,reason="breakpoint-hit"\n10^done,memory=[{contents="41004200"}]\n', undefined],
  ['7^running\n*stopped,reason="exited-normally"\n10^error,msg="no process"\n', 'breakpoint'],
  ['*stopped,reason="breakpoint-hit"\n10^error,msg="unmapped"\n', 'observations failed'],
])('retains raw MI and releases materialized inputs: %s', async (stdout, failure) => {
  const { root, context, artifact, request: operation, provider } = await fixture()
  const success = { stdout: 'GNU gdb', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
  vi.mocked(runProcess).mockResolvedValueOnce(success).mockResolvedValueOnce({ ...success, stdout })
  expect(provider.resolve(operation, context).impact).toBe('target-write')
  const result = await provider.run(operation, context)
  if (failure) expect(result.failure).toContain(failure)
  else expect(result.failure).toBeUndefined()
  expect(JSON.parse(Buffer.from(result.bytes).toString())).toMatchObject({ stdout, sampleSha256: artifact.sha256 })
  expect(await readdir(join(root, 'runs'))).toEqual([])
})

it('rejects unowned targets, incompatible formats and excessive memory before spawning', async () => {
  const { context, request, provider } = await fixture(4096)
  expect(() => provider.resolve({ ...request, operation: 'attach' }, context)).toThrow('fixed run')
  expect(() => provider.resolve(request, { ...context, environment: { ...context.environment, externalContainer: { name: 'unowned', workdir: '/workspace' } } })).toThrow('owned environment')
  expect(() => provider.resolve(request, { ...context, environment: { ...context.environment, kind: 'local' } })).toThrow('managed Linux')
  expect(() => provider.resolve(request, { ...context, asset: { ...fileAssetSchema.parse(context.asset), format: 'pe' } })).toThrow('ELF')
  expect(() => provider.resolve({ ...request, parameters: { engine: 'cdb', breakpoint: 'entry', memory: [] } }, context)).toThrow('local Windows')
  expect(() => provider.resolve({ ...request, parameters: { ...request.parameters, memory: [{ address: 'entry', length: 257 }] } }, context)).toThrow('byte budget')
  expect(runProcess).not.toHaveBeenCalled()
})

it('does not launch a sample when debugger preflight fails or is incomplete', async () => {
  const { root, context, request, provider } = await fixture()
  const processResult = { stdout: 'partial version', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: true }
  vi.mocked(runProcess).mockResolvedValueOnce(processResult)
  await expect(provider.run(request, context)).rejects.toThrow('truncated')
  expect(runProcess).toHaveBeenCalledOnce()
  vi.mocked(runProcess).mockClear().mockResolvedValueOnce({ ...processResult, truncated: false, exitCode: 1, stderr: 'dependency unavailable' })
  await expect(provider.run(request, context)).rejects.toThrow('dependency unavailable')
  expect(runProcess).toHaveBeenCalledOnce()
  expect(await readdir(root)).not.toContain('runs')
})
