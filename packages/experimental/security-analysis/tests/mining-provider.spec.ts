/** Mining validation preserves approved steps, build isolation and crash observations. @module */
import { Context } from '@deepseek-ai/cordis'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi, onTestFinished } from 'vitest'
import { MiningProvider } from '../src/mining-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { operationSchema, sourceAssetSchema } from '../src/workbench/model.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async original => ({
  ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
const completed = { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
async function fixture() {
  vi.mocked(runProcess).mockReset().mockResolvedValue(completed)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-mining-')))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const exchange = join(root, 'runs')
  const workspace = join(root, 'workspace')
  await mkdir(exchange, { recursive: true })
  await mkdir(workspace, { recursive: true })
  const artifacts = new ArtifactStore(join(root, 'store'), 65536)
  const manifest = await artifacts.put(Buffer.from('{}'), 'application/vnd.dsh.source-tree+json')
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 10000, maxOutputBytes: 4096,
    asset: sourceAssetSchema.parse({ id: 'asset', engagementId: 'project', kind: 'source', label: 'Source', identity: 'measured', artifact: manifest }),
    environment: { id: 'mining', kind: 'docker', label: 'Mining', cwd: workspace, image: 'dsh-toolbox:test',
      containerId: 'container-1', exchangeRoot: exchange,
      tools: [
        { id: 'cmake', command: 'cmake', versionArgs: ['--version'], source: 'image' },
        { id: 'make', command: 'make', versionArgs: ['--version'], source: 'image' },
      ] } }
  const provider = new MiningProvider(ctx, { graceMs: 100, maxInputBytes: 4096 })
  const source = join(workspace, 'json-c')
  await mkdir(source, { recursive: true })
  return { provider, context, root, exchange, workspace, source }
}
const buildRequest = (source: string) => operationSchema.parse({ provider: 'mining', operation: 'build', environmentId: 'mining', assetId: 'asset',
  parameters: { sourceDir: source, buildTag: 'cve-asan', steps: [
    { tool: 'cmake', args: ['-S', '{sourceDir}', '-B', '{buildRoot}', '-DCMAKE_C_FLAGS=-fsanitize=address'] },
    { tool: 'make', args: ['-C', '{buildRoot}', '-j2'] },
  ] }, impact: 'observe' })
it('resolves build tokens to the isolated exchange build root and stays idempotent', async () => {
  const { provider, context, source, exchange } = await fixture()
  const request = buildRequest(source)
  const resolved = await provider.prepare(request, context)
  const buildRoot = join(exchange, 'mining', 'cve-asan')
  expect(resolved).toMatchObject({ impact: 'analysis-write', parameters: { buildRoot, sourceDir: source, steps: [
    { tool: 'cmake', args: ['-S', source, '-B', buildRoot, '-DCMAKE_C_FLAGS=-fsanitize=address'] },
    { tool: 'make', args: ['-C', buildRoot, '-j2'] },
  ] } })
  expect(provider.resolve(resolved, context)).toEqual(resolved)
})
it('rejects unmanaged environments, scripts, unknown tools and misplaced sources before approval', async () => {
  const { provider, context, source } = await fixture()
  const build = buildRequest(source)
  await expect(provider.prepare(build, { ...context, environment: { ...context.environment, kind: 'local' as const } })).rejects.toThrow('managed Docker environment')
  await expect(provider.prepare(build, { ...context, environment: { ...context.environment, externalContainer: { name: 'kali', workdir: '/workspace' } } })).rejects.toThrow('managed Docker environment')
  await expect(provider.prepare({ ...build, script: { sha256: 'a'.repeat(64), size: 1, mediaType: 'text/javascript' } }, context)).rejects.toThrow('not a script')
  await expect(provider.prepare({ ...build, parameters: { ...build.parameters, steps: [{ tool: 'ninja', args: ['all'] }] } }, context)).rejects.toThrow('unregistered tool')
  await expect(provider.prepare({ ...build, parameters: { ...build.parameters, sourceDir: tmpdir() } }, context)).rejects.toThrow('outside the selected environment workspace')
})
it('runs each approved step through its registered container tool and records per-step outcomes', async () => {
  const { provider, context, source } = await fixture()
  const resolved = await provider.prepare(buildRequest(source), context)
  vi.mocked(runProcess).mockResolvedValue(completed)
  const result = await provider.run(resolved, context)
  expect(result.incomplete).toBe(false)
  expect(result.failure).toBeUndefined()
  const payload = JSON.parse(Buffer.from(result.bytes).toString()) as { steps: unknown[] }
  expect(payload.steps).toEqual([
    { tool: 'cmake', exitCode: 0, signal: null, timedOut: false, truncated: false },
    { tool: 'make', exitCode: 0, signal: null, timedOut: false, truncated: false },
  ])
  expect(runProcess).toHaveBeenCalledTimes(2)
  const [ctx2, environment, toolId, args] = vi.mocked(runProcess).mock.calls.at(-1)!
  expect(toolId).toBe('make')
  expect(args).toEqual(['-C', join(context.environment.exchangeRoot ?? '', 'mining', 'cve-asan'), '-j2'])
  expect(environment.tools.find(tool => tool.id === 'make')?.command).toBe('make')
  void ctx2
})
it('marks a failed build step as provider failure while retaining collected output', async () => {
  const { provider, context, source } = await fixture()
  const resolved = await provider.prepare(buildRequest(source), context)
  vi.mocked(runProcess).mockResolvedValueOnce(completed)
    .mockResolvedValueOnce({ ...completed, exitCode: 2, stderr: 'undefined reference to `sink\'' })
  const result = await provider.run(resolved, context)
  expect(result.incomplete).toBe(true)
  expect(result.failure).toContain('Build step failed: make')
  const payload = JSON.parse(Buffer.from(result.bytes).toString()) as { stderr: string }
  expect(payload.stderr).toContain('undefined reference')
})
it('executes the pinned program from the build root and records sanitizer crashes as observations', async () => {
  const { provider, context, exchange } = await fixture()
  const program = join(exchange, 'mining', 'cve-asan', 'tests', 'app')
  await mkdir(dirname(program), { recursive: true })
  await writeFile(program, '#!/bin/sh\nexit 0\n')
  await chmod(program, 0o755)
  const request = operationSchema.parse({ provider: 'mining', operation: 'run', environmentId: 'mining', assetId: 'asset',
    parameters: { buildTag: 'cve-asan', program: 'tests/app', args: ['-', 'x'], input: '{"a":1' }, impact: 'observe' })
  const resolved = await provider.prepare(request, context)
  expect(resolved.parameters).toMatchObject({ buildRoot: join(exchange, 'mining', 'cve-asan'), program: 'tests/app' })
  vi.mocked(runProcess).mockResolvedValueOnce({ ...completed, exitCode: 1, signal: null,
    stderr: '==1==ERROR: AddressSanitizer: heap-buffer-overflow' })
  const result = await provider.run(resolved, context)
  expect(result.failure).toBeUndefined()
  expect(result.incomplete).toBe(false)
  expect(result.summary).toContain('AddressSanitizer')
  const [, environment, toolId, args, , stdin] = vi.mocked(runProcess).mock.calls.at(-1)!
  expect(toolId).toBe('mining-program')
  expect(environment.tools.at(-1)?.command).toBe('/dsh-inputs/mining/cve-asan/tests/app')
  expect(args).toEqual(['-', 'x'])
  expect(stdin).toBe('{"a":1')
})
it('treats timeouts and cancellations as failures, not crash evidence', async () => {
  const { provider, context, exchange } = await fixture()
  const program = join(exchange, 'mining', 'cve-asan', 'app')
  await mkdir(dirname(program), { recursive: true })
  await writeFile(program, '#!/bin/sh\nexit 0\n')
  await chmod(program, 0o755)
  const request = operationSchema.parse({ provider: 'mining', operation: 'run', environmentId: 'mining', assetId: 'asset',
    parameters: { buildTag: 'cve-asan', program: 'app' }, impact: 'observe' })
  const resolved = await provider.prepare(request, context)
  vi.mocked(runProcess).mockResolvedValueOnce({ ...completed, timedOut: true, stderr: 'still running' })
  const result = await provider.run(resolved, context)
  expect(result.failure).toBeTruthy()
  expect(result.incomplete).toBe(true)
})
it('rejects missing programs, oversized input and path escapes before execution', async () => {
  const { provider, context, exchange } = await fixture()
  const request = operationSchema.parse({ provider: 'mining', operation: 'run', environmentId: 'mining', assetId: 'asset',
    parameters: { buildTag: 'missing', program: 'app' }, impact: 'observe' })
  await expect(provider.prepare(request, context)).rejects.toThrow('build root is absent')
  const program = join(exchange, 'mining', 'escape', 'app')
  await mkdir(dirname(program), { recursive: true })
  await writeFile(program, 'binary')
  await expect(provider.prepare(operationSchema.parse({ ...request, parameters: { buildTag: 'escape', program: '../other/app' } }), context)).rejects.toThrow()
  await expect(provider.prepare(operationSchema.parse({ ...request, parameters: { buildTag: 'escape', program: 'app', input: 'x'.repeat(4097) } }), context)).rejects.toThrow('byte limit')
})
it('derives an exclusive resource key per build tag', async () => {
  const { provider } = await fixture()
  expect(provider.resourceKey(operationSchema.parse({ provider: 'mining', operation: 'build', environmentId: 'mining', assetId: 'asset',
    parameters: { sourceDir: '/x', buildTag: 'a', steps: [{ tool: 'make', args: ['all'] }] }, impact: 'observe' }))).toBe('mining:a')
})
