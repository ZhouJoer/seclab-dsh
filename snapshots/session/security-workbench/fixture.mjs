/** Real security workbench with operator-owned scope and logged model tool results. */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { syncBuiltinESMExports } from 'node:module'
import { cp, unlink } from 'node:fs/promises'
import { join, sep } from 'node:path'
export const name = 'security-workbench-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subagents', 'jobs', 'subprocess', 'sessionProjectionCache', 'fs']
export async function apply(ctx) {
  if (process.env.DSH_SECURITY_NATIVE_CITATIONS === '1') {
    const fs = ctx.fs
    const processPath = fs.processPath
    fs.processPath = function(target) { return processPath.call(this, target).split(sep).join('/') }
    ctx.effect(() => () => { fs.processPath = processPath })
  }
  const originalNow = Date.now
  const originalUUID = crypto.randomUUID
  let identifier = 0
  let clock = 1800000000000
  Date.now = () => clock
  // Projection cache writes use temporary UUIDs independently of recorded domain identifiers.
  const cacheIO = new AsyncLocalStorage()
  const commandIO = new AsyncLocalStorage()
  crypto.randomUUID = () => {
    if (cacheIO.getStore()) return originalUUID()
    const command = commandIO.getStore()
    if (command) return '00000000-0000-4000-9000-' + String(++command.identifier).padStart(12, '0')
    return '00000000-0000-4000-8000-' + String(++identifier).padStart(12, '0')
  }
  const cache = ctx.sessionProjectionCache
  const originalWrite = cache.write
  const originalColdSnapshot = cache.coldSnapshot
  cache.write = function(...args) { return cacheIO.run(true, () => originalWrite.apply(this, args)) }
  cache.coldSnapshot = function(...args) { return cacheIO.run(true, () => originalColdSnapshot.apply(this, args)) }
  ctx.effect(() => () => { cache.write = originalWrite; cache.coldSnapshot = originalColdSnapshot })
  syncBuiltinESMExports()
  ctx.effect(() => () => {
    Date.now = originalNow
    crypto.randomUUID = originalUUID
    syncBuiltinESMExports()
  })
  const subprocess = ctx.subprocess
  const originalResolve = subprocess.resolveExecutable
  const originalSpawn = subprocess.spawn
  const radareCommand = join(process.cwd(), 'fixture-radare2')
  const adbCommand = join(process.cwd(), 'fixture-adb')
  const dockerCommand = 'fixture-docker'
  const dockerPrefix = ['--context', 'fixture-remote']
  subprocess.resolveExecutable = async function(command, ...args) {
    return [dockerCommand, radareCommand, adbCommand].includes(command) ? command : originalResolve.call(this, command, ...args)
  }
  subprocess.spawn = function(spec) {
    if (spec.argv[0] === adbCommand) {
      const version = spec.argv[1] === 'version'
      assert.deepEqual(spec.argv.slice(1), version ? ['version'] : ['-s', 'fixture-device', 'shell', 'pm', 'list', 'packages', '-f'])
      return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {
        stdout: { readFrom: () => ({ text: version ? 'Android Debug Bridge fixture\n' : 'package:/data/app/fixture.apk=org.example.fixture\n', lossy: false }) },
        stderr: { readFrom: () => ({ text: '', lossy: false }) },
      }, terminate() {}, waitForExit: async () => true }
    }
    if (spec.argv[0] === radareCommand) {
      const output = spec.argv.includes('-v') ? 'radare2 fixture 1\n' : '[{"offset":4096,"name":"main"}]'
      return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {
        stdout: { readFrom: () => ({ text: output, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', lossy: false }) },
      }, terminate() {}, waitForExit: async () => true }
    }
    if (spec.argv[0] !== dockerCommand) return originalSpawn.call(this, spec)
    spec.signal.throwIfAborted()
    assert.deepEqual(spec.argv.slice(1, 3), dockerPrefix)
    const args = spec.argv.slice(3)
    let stdout
    switch (args[0]) {
      case 'info':
        assert.deepEqual(args, ['info', '--format', '{{.ServerVersion}}'])
        stdout = '27.0\n'
        break
      case 'inspect':
        assert.deepEqual(args, ['inspect', '--format', '{{.State.Running}}', 'fixture-container'])
        stdout = 'true\n'
        break
      default:
        assert.deepEqual(args, ['exec', '-i', '--workdir', '/analysis', 'fixture-container', 'fixture-console', '--version'])
        stdout = 'Fixture Console 1.0\n'
    }
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
      collected: {
        stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', lossy: false }) },
      },
      terminate() {},
      waitForExit: async () => true,
    }
  }
  ctx.effect(() => () => {
    subprocess.resolveExecutable = originalResolve
    subprocess.spawn = originalSpawn
  })
  let modelRequests = 0
  ctx.on('agent/request', async (_request, next) => { modelRequests += 1; return { ...await next(), maxTokens: 4096 } })
  const observationFailure = process.env.DSH_SECURITY_OBSERVATION_FAILURE === '1'
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
  const plugin = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(plugin.default, {
    root: join(process.env.DSH_HOME, 'security'),
    importRoots: [process.cwd()],
    toolCatalogPath: join(process.env.DSH_HOME, 'security-tool-catalog.json'),
    ...observationFailure ? { toolConfiguration: { path: join(process.env.DSH_HOME, 'tools.json'), environmentId: 'fixture-local' },
      toolAdapters: { bindings: { radare2: 'fixture-local' } } } : {},
    environments: [{ id: 'fixture-remote', label: 'Remote toolbox', kind: 'docker', cwd: process.cwd(),
      externalContainer: { name: 'fixture-container', workdir: '/analysis' },
      tools: [{ id: 'docker', command: dockerCommand, prefixArgs: dockerPrefix, versionArgs: ['--version'], source: 'Fixture endpoint' }] },
      ...observationFailure ? [{ id: 'fixture-local', label: 'Local binary observations', kind: 'local', cwd: process.cwd(),
        deviceId: 'fixture-device', tools: [
          { id: 'radare2', command: radareCommand, prefixArgs: [], versionArgs: ['-v'], source: 'Fixture tool' },
          { id: 'adb', command: adbCommand, prefixArgs: [], versionArgs: ['version'], source: 'Fixture device' },
        ] }] : []],
    knowledgeIntervalMs: 0,
    analysisTurnTokens: 1000,
    evolution: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
  })
  const environmentEntry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/environment.js' : 'src/environment-local.ts'
  const environments = await import(new URL(`../../../packages/experimental/security-analysis/${environmentEntry}`, import.meta.url))
  await ctx.plugin(environments, {})
  const nativeEntry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/native.js' : 'src/native-provider.ts'
  const native = await import(new URL(`../../../packages/experimental/security-analysis/${nativeEntry}`, import.meta.url))
  await ctx.plugin(native, {})
  if (observationFailure) {
    const androidEntry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/android.js' : 'src/android-provider.ts'
    const android = await import(new URL(`../../../packages/experimental/security-analysis/${androidEntry}`, import.meta.url))
    await ctx.plugin(android, {})
    const failure = await import('../security-observation-failure/fixture.mjs')
    failure.apply(ctx)
  }
  ctx.inject(['securityWorkbench'], (securityCtx) => {
    const pack = JSON.stringify({ version: 1, id: 'fixture-pack', label: 'Fixture tools', tools: [
      { id: 'fixture-console', label: 'Fixture Console', commands: ['fixture-console'], platforms: ['linux'],
        tags: ['security'], description: 'A separately registered container console.', args: ['--version'] },
    ] })
    const preview = securityCtx.securityWorkbench.previewToolPack(pack)
    assert.deepEqual(preview.conflicts, [])
    securityCtx.securityWorkbench.importToolPack(pack, preview.revision, false)
    securityCtx.on('tools/execute', async (exec, next) => {
      if (exec.callId === 'save-research-progress') return commandIO.run({ identifier: 0 }, next)
      if (exec.callId === 'save-native-progress') return commandIO.run({ identifier: 100 }, next)
      if (process.env.DSH_SECURITY_NATIVE_CITATIONS === '1') {
        const service = securityCtx.securityWorkbench
        if (exec.callId === 'native-source-read') {
          const controller = await service.ready
          await controller.createWorkspaceTask(exec.agent.id, 'fixture-native-workspace', process.cwd().split(sep).join('/'),
            { title: '原生源码引用', environmentIds: ['fixture-remote'] }, async () => ({ maxAttempts: 1 }))
          const result = await next()
          assert.notEqual(result.isError, true)
          await unlink(join(process.cwd(), 'handler.js'))
          return result
        }
        if (exec.callId === 'complete-native-investigation') {
          const requests = modelRequests
          const result = await commandIO.run({ identifier: 0 }, next)
          assert.notEqual(result.isError, true, JSON.stringify(result))
          assert.equal(modelRequests, requests, 'report publication requests no model')
          const submitted = await service.view(exec.agent)
          assert.equal(submitted.records.find(record => record.kind === 'engagement').value.completion.status, 'saved')
          assert.equal(submitted.records.some(record => record.kind === 'report'), false)
          const controller = await service.ready
          await commandIO.run({ identifier: 200 }, () => controller.command(exec.agent.id, {
            operationId: 'operator-report', expectedRevision: submitted.revision, action: { kind: 'report' },
          }, true))
          const view = await service.view(exec.agent)
          const evidence = view.records.filter(record => record.kind === 'evidence')
          assert.equal(evidence.length, 1)
          assert.equal(evidence[0].value.provider, 'session-tool')
          assert.equal(evidence[0].value.source.callId, 'native-source-read')
          assert((await controller.artifacts.read(evidence[0].value.artifact)).toString().includes('export const read = request => request.query;'))
          assert.equal(evidence[0].value.incomplete, true)
          const report = view.records.find(record => record.kind === 'report')
          assert(report)
          assert.equal(report.value.checkpointId, view.records.find(record => record.kind === 'checkpoint').value.id)
          assert.deepEqual(report.value.evidenceIds, [evidence[0].value.id])
          const markdown = await service.report(report.value.engagementId, report.value.id, 'markdown')
          assert(markdown.includes('函数直接返回请求的 query 字段。'))
          const response = await controller.exportReport(report.value.engagementId, report.value.id, 1024 * 1024,
            new Request('http://localhost/report.zip'))
          assert.equal(response.status, 200)
          const zip = Buffer.from(await response.arrayBuffer())
          assert.equal(zip.readUInt32LE(0), 0x04034b50)
          return result
        }
        return next()
      }
      if (exec.name === 'skill' && exec.arguments.name === 'security-native') {
        const result = await next()
        if (result.isError) return result
        const resources = join(process.cwd(), '.dsh', 'security-resources')
        await cp(new URL('../../../packages/experimental/security-analysis/resources/', import.meta.url), resources, { recursive: true })
        return { ...result, value: { ...result.value,
          resourceBase: { kind: 'directory', path: join(resources, 'skills').split(sep).join('/') } } }
      }
      if (exec.name !== 'security_command' || JSON.parse(exec.arguments.command).action.kind !== 'report') return next()
      assert(exec.agent)
      clock = 1800000001000
      const before = await securityCtx.securityWorkbench.view(exec.agent)
      assert.equal(before.revision, 0)
      await securityCtx.securityWorkbench.command(exec.agent, JSON.stringify({ operationId: 'fixture-create-report-project',
        expectedRevision: before.revision, action: { kind: 'create', title: '静态安全简报',
          objective: '仅静态检查提供的源码。没有独立复核时保持待复核状态。', environmentIds: [], maxAttempts: 1,
          taskContext: { background: '仅整理本任务提供的材料，不运行样本。授权声明未填写。' } } }))
      return next()
    })
  })
}
