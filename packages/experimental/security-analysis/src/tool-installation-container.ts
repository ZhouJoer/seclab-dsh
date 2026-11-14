/** Immutable-target Kali image builds and explicitly approved external-container transactions. @module */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { kaliToolGroups } from './tool-installation-recipes.ts'
import type { InstallationCommandRunner } from './tool-installation-private.ts'
import type { ToolInstallationExecutorBounds } from './tool-installation-artifacts.ts'
import { frozenKaliInstallScript, kaliDebResolutionSchema, readKaliPackageState, resolveKaliDebs,
  type KaliDebResolution } from './tool-installation-debs.ts'
import type { ToolInstallationExecutionContext, ToolInstallationExecutionResult, ToolInstallationPlan, ToolInstallationPreviewContext, ToolInstallationRecipePlan, ToolInstallationRequest } from './tool-installation-types.ts'
import { ToolInstallationError, ToolInstallationOutcomeUnknownError } from './tool-installation-types.ts'

const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
const dataSchema = z.object({ kind: z.literal('container-v2'), command: z.string(), prefixArgs: z.array(z.string()),
  engineId: z.string().min(1), endpoint: z.string().min(1), containerId: z.string(), base: z.string(), script: z.string(),
  marker: z.string().regex(/^\/var\/tmp\/dsh-install-[a-f0-9-]+$/u), preserveTools: z.boolean(),
  resolution: kaliDebResolutionSchema }).strict()

function externalTransactionScript(script: string, marker: string): string {
  return `set -eu\nmkdir /var/tmp/dsh-tool-install.lock\ntrap 'rmdir /var/tmp/dsh-tool-install.lock' EXIT\nmkdir ${marker}\nprintf running > ${marker}/state\nset +e\n(\n${script})\nresult=$?\nprintf '%s' "$result" > ${marker}/exit\nexit "$result"\n`
}

async function dockerTarget(environment: ToolInstallationPreviewContext['environment'], run: InstallationCommandRunner, signal: AbortSignal): Promise<{
  command: string
  prefixArgs: string[]
  endpoint: string
  engineId: string
}> {
  const docker = environment.tools.find(tool => tool.id === 'docker')
  if (!docker) throw new ToolInstallationError('invalid-request', 'Select a Docker executable before planning container installation.')
  const args = [...docker.prefixArgs ?? []]
  const hostIndex = args.findIndex(arg => arg === '--host' || arg === '-H')
  let endpoint = hostIndex >= 0 ? args[hostIndex + 1] : args.find(arg => arg.startsWith('--host='))?.slice(7)
  let prefixArgs = args
  if (!endpoint) {
    const current = (await run(docker.command, [...args, 'context', 'show'], environment.cwd, signal)).trim()
    const contexts = z.array(z.object({
      Endpoints: z.object({ docker: z.object({ Host: z.string(), SkipTLSVerify: z.boolean().optional() }) }),
      Storage: z.object({ TLSPath: z.string() }), TLSMaterial: z.record(z.string(), z.array(z.string())).optional() })).parse(JSON.parse(
      await run(docker.command, [...args, 'context', 'inspect', current], environment.cwd, signal)))
    const context = contexts[0]
    if (!context) throw new Error('Docker context inspection returned no endpoint')
    endpoint = context.Endpoints.docker.Host
    prefixArgs = ['--host', endpoint]
    if (context.TLSMaterial?.docker?.length) {
      prefixArgs.push(context.Endpoints.docker.SkipTLSVerify ? '--tls' : '--tlsverify')
      for (const [flag, name] of [['--tlscacert', 'ca.pem'], ['--tlscert', 'cert.pem'], ['--tlskey', 'key.pem']] as const)
        prefixArgs.push(flag, join(context.Storage.TLSPath, 'docker', name))
    }
  }
  const info = z.object({ ID: z.string().min(1), OSType: z.literal('linux') }).parse(JSON.parse(await run(docker.command,
    [...prefixArgs, 'info', '--format', '{{json .}}'], environment.cwd, signal)))
  return { command: docker.command, prefixArgs, endpoint, engineId: info.ID }
}

/** Resolve fixed packages without changing the selected environment; isolated resolver containers are removed after preview.
 * @param request - selected finite Kali group.
 * @param context - root and Docker environment.
 * @param run - bounded metadata and temporary resolver executor.
 * @param bounds - total package download budget.
 * @returns an explicit image-build or external package transaction plan.
 */
export async function previewContainerToolRecipe(request: ToolInstallationRequest, context: ToolInstallationPreviewContext,
  run: InstallationCommandRunner, bounds: ToolInstallationExecutorBounds): Promise<ToolInstallationRecipePlan> {
  const group = kaliToolGroups[request.recipeId]
  if (!group || context.environment.kind !== 'docker') throw new ToolInstallationError('unsupported', 'Select a Docker environment for this Kali recipe.')
  const options = z.object({ base: z.string()
    .regex(/^kalilinux\/kali-last-release(?::[a-zA-Z0-9_.-]+|@sha256:[a-f0-9]{64})?$/u).optional() }).strict().parse(request.options)
  const target = await dockerTarget(context.environment, run, context.signal)
  const invoke = (args: string[]): Promise<string> =>
    run(target.command, [...target.prefixArgs, ...args], context.environment.cwd, context.signal)
  let containerId = ''
  let base = ''
  let preserveTools = false
  const external = context.environment.externalContainer
  if (external) {
    const container = z.object({ Id: z.string().regex(/^[a-f0-9]{64}$/u), State: z.object({ Running: z.literal(true) }) }).parse(JSON.parse(await invoke(['inspect', '--type', 'container', '--format', '{{json .}}', external.name])))
    containerId = container.Id
    const os = await invoke(['exec', containerId, 'cat', '/etc/os-release'])
    if (!/^ID=(?:"kali"|kali)$/mu.test(os)) throw new ToolInstallationError('unsupported', 'This package recipe requires an existing Kali Linux container.')
  } else {
    const selectedImage = context.environment.resolvedImageId ?? context.environment.image
    if (!options.base && selectedImage?.startsWith('sha256:')) {
      const previous = z.object({ Id: imageId,
        Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }) }).parse(JSON.parse(
        await invoke(['image', 'inspect', '--format', '{{json .}}', selectedImage])))
      if (previous.Config.Labels?.['dsh.security.managed-kali'] === '1' && previous.Config.Labels['dsh.security.distribution'] === 'kali') { base = previous.Id; preserveTools = true }
    }
    if (!base) {
      const source = options.base ?? 'kalilinux/kali-last-release'
      if (source.includes('@sha256:')) base = source
      else {
        const manifest = z.object({ digest: imageId }).parse(JSON.parse(await invoke(['buildx', 'imagetools', 'inspect', source, '--format', '{{json .Manifest}}'])))
        base = source.replace(/:.*$/u, '') + '@' + manifest.digest
      }
    }
  }
  const destination = join(context.toolRoot, 'generations', request.recipeId + '-' + randomUUID())
  const marker = '/var/tmp/dsh-install-' + randomUUID()
  const previewName = 'dsh-install-preview-' + randomUUID()
  const needsResolver = !external || request.recipeId === 'kali-reverse'
  let resolverBase = base
  if (external && needsResolver) {
    const manifest = z.object({ digest: imageId }).parse(JSON.parse(await invoke(['buildx', 'imagetools', 'inspect', 'kalilinux/kali-last-release', '--format', '{{json .Manifest}}'])))
    resolverBase = 'kalilinux/kali-last-release@' + manifest.digest
  }
  let previewTarget = containerId, resolution: KaliDebResolution
  try {
    if (needsResolver) {
      previewTarget = z.string().regex(/^[a-f0-9]{64}$/u).parse((await invoke(['create', '--pull=missing', '--name', previewName,
        '--label', 'dsh.security.install-preview=1', '--platform=linux/amd64', '--entrypoint', 'sleep', resolverBase, 'infinity'])).trim())
      await invoke(['start', previewTarget])
    }
    resolution = await resolveKaliDebs(group.packages,
      script => invoke(['exec', '--user', '0', '--workdir', '/', external ? containerId : previewTarget, 'sh', '-c', script]),
      { external: !!external, reverse: request.recipeId === 'kali-reverse', repair: request.action === 'repair', marker, maxDownloadBytes: bounds.maxDownloadBytes,
        ...(needsResolver ? { artifactExecutor: (script: string) => invoke(['exec', '--user', '0', '--workdir', '/', previewTarget, 'sh', '-c', script]) } : {}) })
  } finally {
    if (needsResolver) await run(target.command, [...target.prefixArgs, 'rm', '--force', '--volumes', previewName], context.environment.cwd, new AbortController().signal)
  }
  const script = frozenKaliInstallScript(resolution, marker, !!external, request.action === 'repair')
  return { recipeId: request.recipeId, recipeVersion: '2', toolIds: [...Object.keys(group.tools), ...(request.recipeId === 'kali-reverse' ? ['ghidra-headless'] : [])], mode: external ? 'external-container' : 'managed-container',
    version: base || 'kali-packages', destination, confirmations: external ? [{ id: 'external-container', description: `Install packages as root in existing container ${containerId} on ${target.endpoint}. Package changes persist in that container.` }] : [],
    warnings: [...(external ? ['Cancellation stops the Docker client. Remote package work may continue until reconciliation confirms its result.'] : !preserveTools ? ['This fresh Kali image replaces the previous managed image selection and its tool list.'] : [])],
    steps: [...resolution.artifacts.map(item => ({ id: 'download-' + item.name, kind: 'download' as const,
      description: `${item.name}: ${item.previousVersion || 'absent'} → ${item.version}; ${item.size} bytes`,
      url: item.url, sha256: item.sha256, destination: marker + '/archives/' + item.filename })),
    { id: 'packages', kind: 'process', description: script, command: target.command,
      args: [...target.prefixArgs, ...(external ? ['exec', '--user', '0', containerId, 'sh', '-c', externalTransactionScript(script, marker)] : ['build', '--pull=false', '--platform=linux/amd64', '--iidfile', join(destination, 'image-id'), destination])], cwd: context.environment.cwd },
    { id: 'verify', kind: 'verify', description: 'Measure every tool in the completed image or exact existing container.' },
    { id: 'publish', kind: 'publish', description: external ? 'Record the external installation result.' : 'Select the verified immutable image after project configuration comparison.' }],
    data: { kind: 'container-v2', ...target, containerId, base, script, marker, preserveTools, resolution } }
}

async function verifyTarget(plan: ToolInstallationPlan, run: InstallationCommandRunner, signal: AbortSignal,
  checkPackages = false): Promise<void> {
  const data = dataSchema.parse(plan.data)
  const info = z.object({ ID: z.string(), OSType: z.literal('linux') }).parse(JSON.parse(await run(data.command,
    [...data.prefixArgs, 'info', '--format', '{{json .}}'], plan.environment.cwd, signal)))
  if (info.ID !== data.engineId) throw new ToolInstallationError('stale-plan', 'The Docker daemon identity changed after preview.')
  if (data.containerId) {
    const id = (await run(data.command, [...data.prefixArgs, 'inspect', '--type', 'container', '--format', '{{.Id}}', data.containerId], plan.environment.cwd, signal)).trim()
    if (id !== data.containerId) throw new ToolInstallationError('stale-plan', 'The reviewed external container no longer exists.')
    if (checkPackages) {
      const state = await readKaliPackageState(script => run(data.command,
        [...data.prefixArgs, 'exec', data.containerId, 'sh', '-c', script], plan.environment.cwd, signal))
      if (JSON.stringify(state) !== JSON.stringify(data.resolution.state)) throw new ToolInstallationError('stale-plan', 'The external container package state or repository metadata changed after preview.')
    }
  }
}

async function measureContainer(plan: ToolInstallationPlan, immutableImage: string, run: InstallationCommandRunner,
  context: ToolInstallationExecutionContext): Promise<ToolInstallationExecutionResult> {
  const data = dataSchema.parse(plan.data)
  const group = kaliToolGroups[plan.recipeId]
  if (!group) throw new ToolInstallationError('unsupported', 'The recorded Kali recipe is unavailable')
  const log: ToolInstallationExecutionContext['log'] = (channel, text) => context.log(channel, text)
  const checks: ToolInstallationExecutionResult['checks'] = []
  const installations: ToolInstallationExecutionResult['installations'] = []
  const tools = plan.environment.tools.filter(tool => tool.id === 'docker' || data.preserveTools && !Object.hasOwn(group.tools, tool.id)
    && !(plan.recipeId === 'kali-reverse' && tool.id === 'ghidra-headless'))
  const inspect = ([command, ...args]: [string, ...string[]]) => run(data.command,
    [...data.prefixArgs, ...(data.containerId ? ['exec', data.containerId, command, ...args]
      : ['run', '--rm', '--pull=never', '--network=none', '--entrypoint', command, immutableImage, ...args])],
    plan.environment.cwd, context.signal, log)
  for (const [toolId, invocation] of Object.entries(group.tools)) {
    const version = (await inspect(invocation)).trim()
    if (!version || (toolId === 'r2ghidra' && !/ghidra/iu.test(version))) throw new Error('Required tool verification failed: ' + toolId)
    checks.push({ id: toolId, status: 'passed', detail: version })
    installations.push({ toolId, version, location: data.containerId ? data.containerId : plan.destination,
      ownership: data.containerId ? 'external' : 'managed', metadata: { endpoint: data.endpoint, engineId: data.engineId, imageId: immutableImage, containerId: data.containerId } })
    tools.push({ id: toolId, command: invocation[0], prefixArgs: [], versionArgs: invocation.slice(1), source: plan.recipeId })
  }
  if (plan.recipeId === 'kali-reverse') {
    const measured = (await inspect(['sh', '-c', "set -eu\nreadlink -f \"$(command -v java)\"\ndpkg-query -L ghidra | sed -n '/\\/Ghidra\\/Framework\\/Utility\\/lib\\/Utility.jar$/p'\ndpkg-query -L ghidra | sed -n '/\\/Ghidra\\/application.properties$/p' | xargs -r sed -n 's/^application.version=//p'\n"])).trim().split(/\r?\n/u)
    const [java, utility, version] = measured
    if (measured.length !== 3 || !java?.startsWith('/') || !utility?.endsWith('/Ghidra/Framework/Utility/lib/Utility.jar') || !version)
      throw new Error('Ghidra did not report one Java executable, Utility.jar and application version')
    const javaVersion = await inspect([java, '-XshowSettings:properties', '-version'])
    if (!/sun\.arch\.data\.model\s*=\s*64/u.test(javaVersion)) throw new Error('Ghidra headless requires a verified 64-bit Java runtime')
    const ghidraRoot = utility.slice(0, -'/Ghidra/Framework/Utility/lib/Utility.jar'.length)
    await inspect(['test', '-f', ghidraRoot + '/support/LaunchSupport.jar'])
    checks.push({ id: 'ghidra-headless', status: 'passed', detail: version })
    installations.push({ toolId: 'ghidra-headless', version, location: data.containerId || plan.destination,
      ownership: data.containerId ? 'external' : 'managed',
      metadata: { endpoint: data.endpoint, engineId: data.engineId, imageId: immutableImage,
        containerId: data.containerId, ghidraDir: ghidraRoot, java } })
    tools.push({ id: 'ghidra-headless', command: java,
      prefixArgs: ['-Djava.system.class.loader=ghidra.GhidraClassLoader', '-cp', utility, 'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless'],
      versionArgs: ['-version'], source: plan.recipeId })
  }
  const nextEnvironment = { ...plan.environment, tools, image: immutableImage, resolvedImageId: immutableImage }
  delete nextEnvironment.containerId
  const headless = tools.find(tool => tool.id === 'ghidra-headless')
  return { pins: data.containerId && headless ? { 'ghidra-headless': { command: headless.command, prefixArgs: headless.prefixArgs ?? [], versionArgs: headless.versionArgs } } : {},
    checks, installations, ...(!data.containerId ? { environment: nextEnvironment } : {}) }
}

/** Execute the reviewed container transaction without mutating an active managed container.
 * @param plan - immutable daemon/container or base-image plan.
 * @param context - cancellation and durable progress.
 * @param run - owned Docker client executor.
 * @param bounds - total package download budget.
 * @returns measured external receipts or a new immutable managed image selection.
 */
export async function executeContainerToolRecipe(plan: ToolInstallationPlan, context: ToolInstallationExecutionContext,
  run: InstallationCommandRunner, bounds: ToolInstallationExecutorBounds): Promise<ToolInstallationExecutionResult> {
  const data = dataSchema.parse(plan.data)
  if (data.resolution.artifacts.reduce((total, item) => total + item.size, 0) > bounds.maxDownloadBytes)
    throw new ToolInstallationError('stale-plan', 'Package downloads exceed the current configured byte limit.')
  await context.phase('preparing')
  await verifyTarget(plan, run, context.signal, true)
  await mkdir(join(plan.toolRoot, 'generations'), { recursive: true })
  await mkdir(plan.destination)
  await writeFile(join(plan.destination, 'install.sh'), data.script, { flag: 'wx' })
  await context.phase('installing')
  let immutableImage = ''
  const log: ToolInstallationExecutionContext['log'] = (channel, text) => context.log(channel, text)
  try {
    if (data.containerId) {
      const wrapper = externalTransactionScript(data.script, data.marker)
      await run(data.command, [...data.prefixArgs, 'exec', '--user', '0', data.containerId, 'sh', '-c', wrapper], plan.environment.cwd, context.signal, log)
    } else {
      await writeFile(join(plan.destination, 'Dockerfile'), `FROM ${data.base}\nLABEL dsh.security.managed-kali="1" dsh.security.distribution="kali"\nCOPY install.sh /opt/dsh-install.sh\nRUN sh /opt/dsh-install.sh\nWORKDIR /workspace\nENTRYPOINT ["sleep", "infinity"]\n`, { flag: 'wx' })
      await run(data.command, [...data.prefixArgs, 'build', '--pull=false', '--platform=linux/amd64', '--iidfile', join(plan.destination, 'image-id'), plan.destination], plan.environment.cwd, context.signal, log)
      immutableImage = imageId.parse((await readFile(join(plan.destination, 'image-id'), 'utf8')).trim())
    }
  } catch (error) {
    throw new ToolInstallationOutcomeUnknownError('Docker installation did not produce a confirmed result. Reconcile the exact recorded target before retrying.', { cause: error })
  }
  await context.phase('verifying')
  await verifyTarget(plan, run, context.signal)
  return measureContainer(plan, immutableImage, run, context)
}

/** Inspect a prior transaction marker or image identifier without rerunning installation.
 * @param plan - original immutable target.
 * @param context - owned verification operation.
 * @param run - bounded read-only Docker executor.
 * @returns verified result, or null while the transaction outcome is still unknown.
 */
export async function reconcileContainerToolRecipe(plan: ToolInstallationPlan, context: ToolInstallationExecutionContext,
  run: InstallationCommandRunner): Promise<ToolInstallationExecutionResult | null> {
  const data = dataSchema.parse(plan.data)
  await verifyTarget(plan, run, context.signal)
  if (data.containerId) {
    const exit = (await run(data.command, [...data.prefixArgs, 'exec', data.containerId, 'sh', '-c', `if test -f ${data.marker}/exit; then cat ${data.marker}/exit; else printf running; fi`], plan.environment.cwd, context.signal)).trim()
    if (exit === 'running') return null
    if (exit !== '0') throw new ToolInstallationError('execution-failed', 'The external package transaction completed unsuccessfully. Inspect the retained logs and container package state.')
    return measureContainer(plan, '', run, context)
  }
  let stored: string
  try { stored = await readFile(join(plan.destination, 'image-id'), 'utf8') }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  return measureContainer(plan, imageId.parse(stored.trim()), run, context)
}
