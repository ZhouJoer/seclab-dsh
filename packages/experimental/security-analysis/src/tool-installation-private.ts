/** Execution and verification of reviewed Windows private installations. @module */
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { SecurityToolPin } from './local-tools.ts'
import { privateToolRecipeDataSchema, privateInstallationCommands } from './tool-installation-recipes.ts'
import { downloadToolArtifact, extractToolZip, toolExecutableSha256, type ToolInstallationExecutorBounds } from './tool-installation-artifacts.ts'
import { provisionSecurityPython, inspectSecurityPython, securityPythonRequirements, verifySecurityPythonModules } from './security-python-install.ts'
import { ToolInstallationError, type ToolInstallationPlan, type ToolInstallationExecutionContext, type ToolInstallationExecutionResult } from './tool-installation-types.ts'

/** An owned shell-free invocation; arguments and working directory are recipe resolved. */
export type InstallationCommandRunner = (command: string, args: string[], cwd: string, signal: AbortSignal,
  log?: ToolInstallationExecutionContext['log'], temporaryDirectory?: string) => Promise<string>

async function oneRoot(directory: string, required: string): Promise<string> {
  const roots = await readdir(directory, { withFileTypes: true })
  const candidates: string[] = []
  for (const root of roots) {
    if (!root.isDirectory() || root.isSymbolicLink()) continue
    try { if ((await stat(join(directory, root.name, required))).isFile()) candidates.push(join(directory, root.name)) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  }
  const [found] = candidates
  if (candidates.length !== 1 || !found) throw new Error('The official archive does not contain one expected installation root')
  return found
}

/** Install into a fresh generation and return only measured selections.
 * @param plan - reviewed private recipe with immutable acquisition hashes.
 * @param context - owned cancellation and persisted progress.
 * @param bounds - configured resource budgets.
 * @param run - shell-free command executor.
 * @returns verified pins; existing selections are untouched on failure.
 */
export async function executePrivateToolRecipe(plan: ToolInstallationPlan, context: ToolInstallationExecutionContext,
  bounds: ToolInstallationExecutorBounds, run: InstallationCommandRunner): Promise<ToolInstallationExecutionResult> {
  const data = privateToolRecipeDataSchema.parse(plan.data)
  const log: ToolInstallationExecutionContext['log'] = (channel, text) => context.log(channel, text)
  if (process.platform !== data.platform || process.arch !== data.architecture) throw new ToolInstallationError('unsupported', 'The reviewed host platform changed.')
  if (plan.recipeId === 'python-analysis' && createHash('sha256').update(await readFile(securityPythonRequirements)).digest('hex') !== data.pythonLockSha256)
    throw new ToolInstallationError('stale-plan', 'The packaged Python dependency lock changed after preview.')
  if (plan.recipeId === 'python-analysis') {
    const expected = data.pythonIdentity
    if (!expected) throw new ToolInstallationError('stale-plan', 'The Python plan does not include a measured interpreter identity.')
    const identity = await inspectSecurityPython(data.python, data.pythonArgs,
      (command, args) => run(command, args, plan.environment.cwd, context.signal, log))
    if (identity.executable !== expected.executable || identity.base !== expected.base || identity.bits !== expected.bits
      || identity.version.join('.') !== expected.version.join('.')
      || await toolExecutableSha256(identity.executable, bounds.maxDownloadBytes, context.signal) !== expected.sha256)
      throw new ToolInstallationError('stale-plan', 'The selected Python interpreter changed after preview.')
  }
  await context.phase('preparing')
  await mkdir(join(plan.toolRoot, 'generations'), { recursive: true })
  await mkdir(plan.destination)
  for (const artifact of data.artifacts) {
    await context.log('manager', `Downloading ${artifact.id} ${artifact.version}`)
    const path = join(plan.destination, artifact.id + '.' + artifact.format)
    await downloadToolArtifact(artifact, path, bounds, context.signal)
    if (artifact.format === 'zip') await extractToolZip(path, join(plan.destination, artifact.id), bounds, context.signal)
  }
  await context.phase('installing')
  const pins: Record<string, SecurityToolPin> = {}
  let javaHome = ''
  let java = ''
  if (data.artifacts.some(artifact => artifact.id === 'java')) {
    javaHome = await oneRoot(join(plan.destination, 'java'), 'bin/java.exe')
    java = join(javaHome, 'bin/java.exe')
    await run(java, ['-version'], plan.destination, context.signal, log)
    pins.java = { command: java, prefixArgs: [], versionArgs: ['-version'] }
  }
  const privateTemporaryDirectory = ['mitmproxy', 'python-analysis', 'ghidra-headless'].includes(plan.recipeId)
    ? join(plan.destination, 'runtime-tmp') : undefined
  if (privateTemporaryDirectory) await mkdir(privateTemporaryDirectory)
  if (pins.java && privateTemporaryDirectory) pins.java.temporaryDirectory = privateTemporaryDirectory
  const invoke = (command: string, args: string[]): Promise<string> =>
    run(command, args, plan.destination, context.signal, log, privateTemporaryDirectory)
  let ghidraDir = ''
  if (plan.recipeId === 'java') pins.java = { command: java, prefixArgs: [], versionArgs: ['-version'] }
  else if (plan.recipeId === 'ghidra-headless') {
    ghidraDir = await oneRoot(join(plan.destination, 'ghidra'), 'Ghidra/application.properties')
    const properties = await readFile(join(ghidraDir, 'Ghidra/application.properties'), 'utf8')
    const version = /^application\.version=(.+)$/mu.exec(properties)?.[1]?.trim()
    if (version !== plan.version) throw new Error('Installed Ghidra version differs from the reviewed release')
    pins['ghidra-headless'] = { command: java, prefixArgs: ['-Djava.system.class.loader=ghidra.GhidraClassLoader', '-cp',
      join(ghidraDir, 'Ghidra/Framework/Utility/lib/Utility.jar'), 'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless'],
    versionArgs: ['-help'], temporaryDirectory: join(plan.destination, 'runtime-tmp') }
  } else if (plan.recipeId === 'jadx') pins.jadx = { command: java, prefixArgs: ['-cp', join(plan.destination, 'jadx/lib/*'), 'jadx.cli.JadxCLI'], versionArgs: ['--version'] }
  else if (plan.recipeId === 'apktool') pins.apktool = { command: java, prefixArgs: ['-jar', join(plan.destination, 'apktool.jar')], versionArgs: ['--version'] }
  else if (plan.recipeId === 'android-platform-tools') {
    for (const id of ['adb', 'fastboot']) pins[id] = { command: join(plan.destination, 'platform-tools/platform-tools', id + '.exe'), prefixArgs: [], versionArgs: id === 'adb' ? ['version'] : ['--version'] }
  } else if (plan.recipeId === 'python-runtime') {
    const directory = join(plan.destination, 'runtime')
    for (const command of privateInstallationCommands(plan.recipeId, plan.destination, data.python, data.pythonArgs))
      await invoke(command.command, command.args)
    await inspectSecurityPython(join(directory, 'python.exe'), [], invoke)
    pins.python = { command: join(directory, 'python.exe'), prefixArgs: [], versionArgs: ['--version'] }
  } else if (plan.recipeId === 'python-analysis') {
    const directory = join(plan.destination, 'venv')
    await mkdir(directory)
    const python = await provisionSecurityPython({ python: data.python, pythonArgs: data.pythonArgs,
      directory, platform: data.platform }, invoke)
    pins.python = { command: python, prefixArgs: [], versionArgs: ['--version'], temporaryDirectory: join(plan.destination, 'runtime-tmp') }
  } else if (plan.recipeId === 'mitmproxy') {
    pins.mitmdump = { command: join(plan.destination, 'mitmproxy/mitmdump.exe'), prefixArgs: [], versionArgs: ['--version'], temporaryDirectory: join(plan.destination, 'runtime-tmp') }
  } else if (plan.recipeId === 'wireshark' || plan.recipeId === 'nmap') {
    const directory = join(plan.destination, 'runtime')
    for (const command of privateInstallationCommands(plan.recipeId, plan.destination, data.python, data.pythonArgs))
      await invoke(command.command, command.args)
    for (const tool of plan.toolIds) pins[tool] = { command: join(directory, tool + '.exe'), prefixArgs: [], versionArgs: ['--version'] }
  } else throw new ToolInstallationError('unsupported', 'Private recipe has no executor.')
  return verifyPrivateToolInstallation(plan, { pins, checks: [], installations: Object.keys(pins).map((toolId) => {
    const version = toolId === 'java' ? data.artifacts.find(artifact => artifact.id === 'java')?.version : plan.version
    if (!version) throw new Error('Missing selected runtime release identity')
    return { toolId, version, location: plan.destination, ownership: 'managed',
      metadata: { ...(javaHome ? { javaHome, javaCommand: java } : {}), ...(ghidraDir ? { ghidraDir } : {}) } }
  }) }, context, run)
}

/** Revalidate a recorded private installation without downloading, extracting or invoking its installer.
 * @param plan - original reviewed installation plan.
 * @param observed - previously measured selections retained by the manager.
 * @param context - owned verification operation.
 * @param run - shell-free version and module probes.
 * @returns refreshed verification facts for the same retained installation.
 */
export async function verifyPrivateToolInstallation(plan: ToolInstallationPlan, observed: ToolInstallationExecutionResult,
  context: ToolInstallationExecutionContext, run: InstallationCommandRunner): Promise<ToolInstallationExecutionResult> {
  await context.phase('verifying')
  const checks: ToolInstallationExecutionResult['checks'] = []
  const log: ToolInstallationExecutionContext['log'] = (channel, text) => context.log(channel, text)
  for (const [toolId, pin] of Object.entries(observed.pins)) {
    const invoke = (command: string, args: string[]): Promise<string> =>
      run(command, args, plan.destination, context.signal, log, pin.temporaryDirectory)
    let versionArgs = [...pin.prefixArgs, ...pin.versionArgs]
    if (toolId === 'ghidra-headless') {
      const ghidraDir = observed.installations.find(receipt => receipt.toolId === toolId)?.metadata?.ghidraDir
      if (!ghidraDir || /^application\.version=(.+)$/mu.exec(await readFile(join(ghidraDir, 'Ghidra/application.properties'), 'utf8'))?.[1]?.trim() !== plan.version)
        throw new Error('The installed Ghidra version differs from the reviewed release')
      versionArgs = [fileURLToPath(new URL('../resources/ghidra/DshGhidraProbe.java', import.meta.url)), ghidraDir]
    }
    if (plan.recipeId === 'python-analysis') {
      const data = privateToolRecipeDataSchema.parse(plan.data)
      const requirements = await readFile(join(plan.destination, 'venv/requirements.txt'), 'utf8')
      if (createHash('sha256').update(requirements).digest('hex') !== data.pythonLockSha256) throw new Error('The installed Python dependency lock changed')
      await verifySecurityPythonModules(pin.command, requirements, invoke)
    }
    const output = await invoke(pin.command, versionArgs)
    if (!output.trim()) throw new Error(`No executable identity was returned by ${toolId}`)
    if (toolId === 'ghidra-headless' && z.object({ version: z.string() }).parse(JSON.parse(output)).version !== plan.version)
      throw new Error('The Ghidra runtime probe reported a different release')
    const receipt = observed.installations.find(receipt => receipt.toolId === toolId)
    if (!receipt) throw new Error('The recorded executable has no installation receipt')
    const expectedVersion = toolId === 'java' ? receipt.version.replace(/\+.*$/u, '') : plan.version
    if (toolId !== 'ghidra-headless' && plan.recipeId !== 'python-analysis' && !output.includes(expectedVersion))
      throw new Error(`The installed ${toolId} version differs from the reviewed release`)
    checks.push({ id: toolId, status: 'passed', detail: output.trim() })
  }
  return { ...structuredClone(observed), checks }
}
