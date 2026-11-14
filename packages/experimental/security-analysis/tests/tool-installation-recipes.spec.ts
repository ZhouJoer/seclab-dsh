/** Installation previews and cancellation retain exact target identity and private-file safety. @module */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { expect, it, onTestFinished } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { extractToolZip, type ToolInstallationExecutorBounds } from '../src/tool-installation-artifacts.ts'
import { previewContainerToolRecipe, executeContainerToolRecipe, reconcileContainerToolRecipe } from '../src/tool-installation-container.ts'
import { toolInstallationRecipes } from '../src/tool-installation-recipes.ts'
import type { InstallationCommandRunner } from '../src/tool-installation-private.ts'
import type { ToolInstallationPlan, ToolInstallationPlanId, ToolInstallationExecutionContext } from '../src/tool-installation-types.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'

const bounds: ToolInstallationExecutorBounds = { downloadTimeoutMs: 1000, maxDownloadBytes: 1024, maxExtractedBytes: 1024,
  maxArchiveEntries: 20, processTimeoutMs: 1000, maxOutputBytes: 1024, graceMs: 100, metadataTimeoutMs: 1000, maxMetadataBytes: 1024 }
const signal = new AbortController().signal
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-installer-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}
const environment: SecurityEnvironment = { id: 'kali', label: 'Kali', kind: 'docker', cwd: process.cwd(),
  externalContainer: { name: 'mutable-name', workdir: '/tmp' }, tools: [{ id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'test' }] }
const container = 'a'.repeat(64)
const image = 'sha256:' + 'b'.repeat(64)
const request = { recipeId: 'kali-network', environmentId: 'kali', action: 'install' as const, options: {} }
const context: ToolInstallationExecutionContext = { signal, log: async () => {}, phase: async () => {} }
const fake: InstallationCommandRunner = async (_command, args) => {
  if (args.includes('show')) return 'desktop-linux'
  if (args.includes('context')) return JSON.stringify([{ Endpoints: { docker: { Host: 'npipe:////./pipe/dockerDesktopLinuxEngine' } }, Storage: { TLSPath: '' } }])
  if (args.includes('info')) return JSON.stringify({ ID: 'engine-1', OSType: 'linux' })
  if (args.includes('inspect') && args.includes('{{.Id}}')) return container
  if (args.includes('inspect') && args.includes('container')) return JSON.stringify({ Id: container, State: { Running: true } })
  if (args.includes('/etc/os-release')) return 'ID=kali\n'
  if (args.includes('imagetools')) return JSON.stringify({ digest: image })
  const script = args.at(-1) ?? ''
  if (script.includes('dpkg --audit')) return 'c'.repeat(64) + '\n' + 'd'.repeat(64)
  if (script.includes('--simulate')) return 'Inst nmap (1.0 Kali [amd64])\n'
  if (script.includes('DSH-PACKAGE')) return "DSH-PACKAGE nmap 1.0\n'https://kali.example/nmap_1.0_amd64.deb' nmap_1.0_amd64.deb 20 SHA256:" + 'e'.repeat(64) + '\nDSH-SHA256 ' + 'e'.repeat(64) + '\n'
  if (args.includes('create')) return container
  return 'tool version 1.0'
}
async function externalPlan(root: string): Promise<ToolInstallationPlan> {
  return { ...await previewContainerToolRecipe(request, { toolRoot: root, environment, signal }, fake, bounds),
    id: brandString<ToolInstallationPlanId>('plan-1'), digest: 'digest', createdAt: 1, toolRoot: root, rootRevision: 1,
    configurationRevision: 'config-1', request, environment }
}

it('keeps commercial registrations out of automated recipes and covers the supported installation groups', () => {
  const ids = toolInstallationRecipes().map(recipe => recipe.id)
  expect(ids).toEqual(expect.arrayContaining(['python-runtime', 'python-analysis', 'java', 'ghidra-headless', 'jadx', 'apktool',
    'android-platform-tools', 'wireshark', 'nmap', 'mitmproxy', 'kali-reverse', 'kali-firmware', 'kali-web', 'kali-network']))
  expect(ids.some(id => /ida|hopper|kuna|jeb/u.test(id))).toBe(false)
})

it('pins the external daemon endpoint and immutable container id before approval', async () => {
  const plan = await externalPlan(await directory())
  expect(plan.confirmations.map(item => item.id)).toContain('external-container')
  expect(plan.data).toMatchObject({ endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine', engineId: 'engine-1', containerId: container })
  expect(plan.steps.find(step => step.id === 'packages')?.args).toContain(container)
  expect(plan.steps.find(step => step.id === 'packages')?.args).not.toContain('mutable-name')
})

it.each(['install', 'repair', 'upgrade'] as const)('freezes the container %s action before execution', async (action) => {
  const commands: string[][] = []
  const plan = await previewContainerToolRecipe({ ...request, action }, { toolRoot: await directory(), environment, signal },
    async (command, args, cwd, cancellation) => { commands.push(args); return fake(command, args, cwd, cancellation) }, bounds)
  const simulation = commands.find(args => args.at(-1)?.includes('--simulate'))?.at(-1)
  expect(simulation?.includes('--reinstall')).toBe(action === 'repair')
  expect(plan.steps.find(step => step.id === 'packages')?.description.includes('--reinstall')).toBe(action === 'repair')
  expect(plan.steps.filter(step => step.kind === 'download')).toMatchObject([{ url: 'https://kali.example/nmap_1.0_amd64.deb', sha256: 'e'.repeat(64) }])
})

it('refuses a changed daemon before starting the package transaction', async () => {
  const plan = await externalPlan(await directory())
  const invoked: string[][] = []
  const run: InstallationCommandRunner = async (command, args, cwd, cancellation) => {
    invoked.push(args)
    return args.includes('info') ? JSON.stringify({ ID: 'other-engine', OSType: 'linux' }) : fake(command, args, cwd, cancellation)
  }
  await expect(executeContainerToolRecipe(plan, context, run, bounds)).rejects.toThrow('daemon identity changed')
  expect(invoked.some(args => args.includes('exec'))).toBe(false)
})

it('rejects external package state changes before invoking the installation transaction', async () => {
  const plan = await externalPlan(await directory()), commands: string[][] = []
  const run: InstallationCommandRunner = async (command, args, cwd, cancellation) => {
    commands.push(args)
    if (args.at(-1)?.includes('dpkg --audit')) return 'f'.repeat(64) + '\n' + 'd'.repeat(64)
    return fake(command, args, cwd, cancellation)
  }
  await expect(executeContainerToolRecipe(plan, context, run, bounds)).rejects.toMatchObject({ code: 'stale-plan' })
  expect(commands.some(args => args.at(-1)?.includes('dsh-tool-install.lock'))).toBe(false)
})

it('resolves managed-image metadata in a temporary owned container and removes it after failure', async () => {
  const commands: string[][] = [], root = await directory()
  const managed: SecurityEnvironment = { id: 'kali', label: 'Kali', kind: 'docker', cwd: root, tools: environment.tools }
  const run: InstallationCommandRunner = async (command, args, cwd, cancellation) => {
    commands.push(args)
    if (args.at(-1)?.includes('--simulate')) throw new Error('Fixture repository unavailable')
    return fake(command, args, cwd, cancellation)
  }
  await expect(previewContainerToolRecipe(request, { toolRoot: root, environment: managed, signal }, run, bounds)).rejects.toThrow('Fixture repository unavailable')
  const create = commands.find(args => args.includes('create'))!, name = create[create.indexOf('--name') + 1]!
  expect(name).toMatch(/^dsh-install-preview-/u)
  expect(commands.at(-1)?.slice(-4)).toEqual(['rm', '--force', '--volumes', name])
  expect(commands.some(args => args.at(-1) === 'apt-get update')).toBe(true)
  expect(commands.some(args => args.includes('build'))).toBe(false)
})

it('inspects reverse-package artifacts only in a temporary resolver while external APT simulation stays read-only', async () => {
  const commands: string[][] = [], resolverId = 'f'.repeat(64), root = await directory()
  const run: InstallationCommandRunner = async (command, args, cwd, cancellation) => {
    commands.push(args)
    const script = args.at(-1) ?? ''
    if (args.includes('create')) return resolverId
    if (script.includes('download-file')) {
      const name = script.includes('r2ghidra_6.2.6') ? 'r2ghidra' : 'radare2'
      return `Package: ${name}\nVersion: 6.2.6\nDepends: ${name === 'r2ghidra' ? 'radare2 (>= 6.2.6), ' : ''}nmap\nDSH-SIZE 20\n`
    }
    if (script.includes('if dpkg-query')) return 'missing'
    return fake(command, args, cwd, cancellation)
  }
  const plan = await previewContainerToolRecipe({ ...request, recipeId: 'kali-reverse' }, { toolRoot: root, environment, signal }, run, bounds)
  expect(plan.toolIds).toContain('ghidra-headless')
  expect(plan.steps.filter(step => step.kind === 'download')).toHaveLength(3)
  const downloads = commands.filter(args => args.at(-1)?.includes('download-file'))
  expect(downloads).toHaveLength(2)
  expect(downloads.every(args => args.includes(resolverId) && !args.includes(container))).toBe(true)
  const simulations = commands.filter(args => args.at(-1)?.includes('--simulate'))
  expect(simulations.every(args => args.includes(container))).toBe(true)
  expect(simulations.some(args => args.at(-1)?.includes('satisfy'))).toBe(true)
  expect(commands.filter(args => args.includes(container)).some(args => args.at(-1)?.includes('apt-get update'))).toBe(false)
  expect(commands.at(-1)).toContain('rm')
})

it('keeps an uncertain external operation reconcilable without stopping or rerunning the container', async () => {
  const plan = await externalPlan(await directory())
  const commands: string[][] = []
  const run: InstallationCommandRunner = async (command, args, cwd, cancellation) => {
    commands.push(args)
    if (args.at(-1)?.includes('dsh-tool-install.lock')) throw new Error('client transport lost')
    return fake(command, args, cwd, cancellation)
  }
  await expect(executeContainerToolRecipe(plan, context, run, bounds)).rejects.toMatchObject({ code: 'outcome-unknown' })
  expect(commands.some(args => args.includes('kill') || args.includes('stop'))).toBe(false)
  const result = await reconcileContainerToolRecipe(plan, context, async (command, args, cwd, cancellation) => args.includes('sh') ? 'running' : fake(command, args, cwd, cancellation))
  expect(result).toBeNull()
})

it('records a completed external installation without rebinding the environment', async () => {
  const plan = await externalPlan(await directory())
  const result = await reconcileContainerToolRecipe(plan, context, async (command, args, cwd, cancellation) => args.includes('sh') ? '0' : fake(command, args, cwd, cancellation))
  expect(result?.environment).toBeUndefined()
  expect(result?.pins).toEqual({})
  expect(result?.installations).toHaveLength(4)
  expect(result?.installations.every(receipt => receipt.ownership === 'external' && receipt.location === container)).toBe(true)
})

it('records a managed Kali headless launcher using measured Java and Ghidra paths', async () => {
  const base = await externalPlan(await directory())
  const plan: ToolInstallationPlan = { ...base, recipeId: 'kali-reverse', mode: 'managed-container',
    environment: { id: 'kali', kind: 'docker', label: 'Kali', cwd: base.environment.cwd, tools: environment.tools },
    data: { ...base.data, containerId: '', base: image } }
  await mkdir(plan.destination, { recursive: true }); await writeFile(join(plan.destination, 'image-id'), image)
  const result = await reconcileContainerToolRecipe(plan, context, async (command, args, cwd, cancellation) => {
    if (args.at(-1)?.includes('application.properties')) return '/usr/lib/jvm/java-25/bin/java\n/usr/share/ghidra/Ghidra/Framework/Utility/lib/Utility.jar\n12.2\n'
    if (args.includes('-XshowSettings:properties')) return 'sun.arch.data.model = 64\njava.version = 25.0.1\n'
    if (args.includes('-L')) return 'r2ghidra 6.2.6 ghidra'
    return fake(command, args, cwd, cancellation)
  })
  expect(result?.environment?.tools.find(tool => tool.id === 'ghidra-headless')).toMatchObject({
    command: '/usr/lib/jvm/java-25/bin/java', prefixArgs: ['-Djava.system.class.loader=ghidra.GhidraClassLoader', '-cp',
      '/usr/share/ghidra/Ghidra/Framework/Utility/lib/Utility.jar', 'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless'],
  })
  expect(result?.installations.find(receipt => receipt.toolId === 'ghidra-headless')?.version).toBe('12.2')
})

it('extracts complete ZIP members into a fresh private directory', async () => {
  const root = await directory()
  const archive = join(root, 'release.zip')
  await writeFile(archive, zipSync({ 'jdk/bin/java.exe': strToU8('fixture') }))
  await extractToolZip(archive, join(root, 'output'), bounds, signal)
  expect(await readFile(join(root, 'output/jdk/bin/java.exe'), 'utf8')).toBe('fixture')
})

it.each(['../escape', 'bin/con.exe', 'bin/file.', 'bin/unsafe:name', '/absolute'])('rejects unsafe ZIP path %s', async (name) => {
  const root = await directory()
  const archive = join(root, 'release.zip')
  await writeFile(archive, zipSync({ [name]: strToU8('fixture') }))
  await expect(extractToolZip(archive, join(root, 'output'), bounds, signal)).rejects.toThrow()
})

it('rejects expansion and Windows case aliases before selecting an installation', async () => {
  const root = await directory()
  const archive = join(root, 'release.zip')
  await writeFile(archive, zipSync({ 'a.txt': new Uint8Array(1025) }))
  await expect(extractToolZip(archive, join(root, 'large'), bounds, signal)).rejects.toThrow('byte limit')
  await writeFile(archive, zipSync({ 'Tool.exe': strToU8('a'), 'tool.exe': strToU8('b') }))
  await expect(extractToolZip(archive, join(root, 'aliases'), bounds, signal)).rejects.toThrow('repeats a path')
})
