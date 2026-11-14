/** Reviewed acquisition identities and finite installation groups for operator use. @module */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ToolInstallationPreviewContext, ToolInstallationRecipePlan, ToolInstallationRequest } from './tool-installation-types.ts'
import { ToolInstallationError } from './tool-installation-types.ts'
import { securityPythonInstallArguments, securityPythonRequirements } from './security-python-install.ts'

const artifactSchema = z.object({ id: z.string(), version: z.string(), url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  format: z.enum(['zip', 'jar', 'exe']) }).strict()
/** Durable private recipe payload; apply callers cannot replace acquisition identities. */
export const privateToolRecipeDataSchema = z.object({ kind: z.literal('private-v1'), artifacts: z.array(artifactSchema),
  python: z.string(), pythonArgs: z.array(z.string()), pythonLockSha256: z.string(),
  pythonIdentity: z.object({ executable: z.string(), base: z.string(), bits: z.literal(64),
    version: z.tuple([z.number(), z.number(), z.number()]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().nullable(), platform: z.literal('win32'), architecture: z.literal('x64') }).strict()
/** One pinned upstream release asset. */
export type ToolReleaseArtifact = z.infer<typeof artifactSchema>

const java: ToolReleaseArtifact = { id: 'java', version: '25.0.5+8', format: 'zip',
  url: 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jdk_x64_windows_hotspot_25.0.5_8.zip',
  sha256: '636bdc13dc649ddc7d5921c5c7d23cca6e44fd19d662b45cc9c02135a6c96c42' }
const artifacts: Record<string, ToolReleaseArtifact> = {
  java,
  'ghidra-headless': { id: 'ghidra', version: '12.2', format: 'zip',
    url: 'https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.2_build/ghidra_12.2_PUBLIC_20261016.zip',
    sha256: '2c2cd776db3c1f6a097ba418922378ac3649cadd5e844a6f5f088ae628a7be67' },
  jadx: { id: 'jadx', version: '1.5.6', format: 'zip', url: 'https://github.com/skylot/jadx/releases/download/v1.5.6/jadx-1.5.6.zip',
    sha256: '545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974' },
  apktool: { id: 'apktool', version: '3.0.3', format: 'jar', url: 'https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar',
    sha256: 'dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423' },
  'android-platform-tools': { id: 'platform-tools', version: '37.0.1', format: 'zip', url: 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip',
    sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99' },
  'python-runtime': { id: 'python', version: '3.14.0', format: 'exe', url: 'https://www.python.org/ftp/python/3.14.0/python-3.14.0-amd64.exe',
    sha256: '52ceb249f65009d936e6504f97cce42870c11358cb6e48825e893f54e11620aa' },
  wireshark: { id: 'wireshark', version: '4.6.9', format: 'exe', url: 'https://2.na.dl.wireshark.org/win64/all-versions/Wireshark-4.6.9-x64.exe',
    sha256: 'bf9b5ce8a89f244c376a9b1a946276eaa06463dde3e33069a34d7f102f5878cf' },
  nmap: { id: 'nmap', version: '7.993', format: 'exe', url: 'https://nmap.org/dist/nmap-7.993-setup.exe',
    sha256: '22e5928d1738a1b94ffd3643014f52cb87d467dbec4cff9e5f721fe0b3782f1b' },
  mitmproxy: { id: 'mitmproxy', version: '12.3.1', format: 'zip', url: 'https://downloads.mitmproxy.org/12.3.1/mitmproxy-12.3.1-windows-x86_64.zip',
    sha256: '336c03e7215876af329f57c44b1b738cfb22cd29dc7cd4c0714f15c7648af829' },
}

/** Fixed Kali packages; repositories resolve their dependencies during the approved transaction. */
export const kaliToolGroups: Record<string, { tools: Record<string, [string, ...string[]]>; packages: string[] }> = {
  'kali-reverse': { packages: ['python3', 'python3-pip', 'python3-venv', 'radare2', 'rizin', 'gdb', 'default-jdk', 'ghidra', 'jadx', 'apktool', 'adb', 'fastboot', 'r2ghidra'],
    tools: { python: ['python3', '--version'], radare2: ['r2', '-v'], r2ghidra: ['r2', '-L'], rizin: ['rizin', '-v'], gdb: ['gdb', '--version'], java: ['java', '-version'], jadx: ['jadx', '--version'], apktool: ['apktool', '--version'], adb: ['adb', 'version'], fastboot: ['fastboot', '--version'] } },
  'kali-firmware': { packages: ['binwalk', 'unblob', 'ubi-reader', 'squashfs-tools'], tools: { binwalk: ['binwalk', '--help'], unblob: ['unblob', '--version'], 'ubi-reader': ['ubireader_display_info', '--help'], unsquashfs: ['unsquashfs', '-version'] } },
  'kali-web': { packages: ['nuclei', 'metasploit-framework', 'sqlmap', 'nikto', 'ffuf', 'gobuster', 'whatweb', 'john', 'curl'],
    tools: { nuclei: ['nuclei', '-version'], metasploit: ['msfconsole', '--version'], sqlmap: ['sqlmap', '--version'], nikto: ['nikto', '-Version'], ffuf: ['ffuf', '-V'], gobuster: ['gobuster', 'version'], whatweb: ['whatweb', '--version'], john: ['john', '--list=build-info'], curl: ['curl', '--version'] } },
  'kali-network': { packages: ['tshark', 'wireshark-common', 'mitmproxy', 'nmap'], tools: { tshark: ['tshark', '--version'], capinfos: ['capinfos', '--version'], mitmdump: ['mitmdump', '--version'], nmap: ['nmap', '--version'] } },
}

/** Catalog entry for one executable recipe, with platforms made explicit. */
export interface ToolInstallationRecipeSummary { id: string; toolIds: string[]; environments: ('local' | 'docker')[]; platform: 'win32-x64' | 'linux-container'; version: string }

/** List only implemented installation recipes; commercial/manual tools remain catalog guidance.
 * @returns finite operator-selectable recipes.
 */
export function toolInstallationRecipes(): ToolInstallationRecipeSummary[] {
  return [
    ...Object.entries(artifacts).map(([id, artifact]) => ({ id, toolIds: privateToolIds(id), environments: ['local'] as 'local'[], platform: 'win32-x64' as const, version: artifact.version })),
    { id: 'python-analysis', toolIds: ['python'], environments: ['local'], platform: 'win32-x64', version: 'requirements-2026-11' },
    ...Object.entries(kaliToolGroups).map(([id, group]) => ({ id, toolIds: Object.keys(group.tools), environments: ['docker'] as 'docker'[], platform: 'linux-container' as const, version: 'kali-last-release' })),
  ]
}

function privateToolIds(id: string): string[] {
  if (['ghidra-headless', 'jadx', 'apktool'].includes(id)) return ['java', id]
  if (id === 'android-platform-tools') return ['adb', 'fastboot']
  if (id === 'python-runtime' || id === 'python-analysis') return ['python']
  if (id === 'wireshark') return ['tshark', 'capinfos']
  if (id === 'mitmproxy') return ['mitmdump']
  return [id]
}

/** Resolve a private Windows installation into a fresh immutable generation.
 * @param request - selected reviewed recipe and supported interpreter option.
 * @param context - current shared root and execution environment.
 * @returns an acquisition plan without filesystem mutations.
 */
export function previewPrivateToolRecipe(request: ToolInstallationRequest,
  context: ToolInstallationPreviewContext): ToolInstallationRecipePlan {
  if (context.environment.kind !== 'local' || process.platform !== 'win32' || process.arch !== 'x64')
    throw new ToolInstallationError('unsupported', 'Private installation recipes currently support Windows x64 local environments.')
  const summary = toolInstallationRecipes().find(item => item.id === request.recipeId && item.platform === 'win32-x64')
  if (!summary) throw new ToolInstallationError('unsupported', 'No reviewed installer is registered for this recipe.')
  const options = z.object({ python: z.string().min(1).optional(), pythonArgs: z.string().optional() }).strict().parse(request.options)
  const selectedPython = context.environment.tools.find(tool => tool.id === 'python')
  const python = options.python ?? selectedPython?.command ?? ''
  const pythonArgs = options.pythonArgs ? z.array(z.string()).parse(JSON.parse(options.pythonArgs))
    : options.python ? [] : selectedPython?.prefixArgs ?? []
  if (request.recipeId === 'python-analysis' && !python)
    throw new ToolInstallationError('invalid-request', 'Select a standalone Python interpreter before creating the private Python environment.')
  const destination = join(context.toolRoot, 'generations', request.recipeId + '-' + randomUUID())
  const selected = artifacts[request.recipeId]
  const selectedArtifacts: ToolReleaseArtifact[] = selected ? [selected] : []
  if (['ghidra-headless', 'jadx', 'apktool'].includes(request.recipeId)) selectedArtifacts.unshift(java)
  const confirmations = selectedArtifacts.some(artifact => artifact.format === 'exe')
    ? [{ id: 'installer-registration', description: 'The official installer writes installation registration outside the private tool directory. The tool files remain in the selected directory.' }] : []
  const warnings = request.recipeId === 'nmap' ? ['Complete the official interactive Nmap installer without changing its destination. Npcap, PATH changes and registry integration are disabled.']
    : request.recipeId === 'wireshark' ? ['Npcap is excluded. Offline capture analysis works without a capture driver.'] : []
  const pythonLockSha256 = request.recipeId === 'python-analysis' ? createHash('sha256').update(readFileSync(securityPythonRequirements)).digest('hex') : ''
  const commands = privateInstallationCommands(request.recipeId, destination, python, pythonArgs)
  return { recipeId: request.recipeId, recipeVersion: '1', toolIds: summary.toolIds, mode: 'private', version: summary.version, destination,
    steps: [...selectedArtifacts.flatMap(artifact => [{ id: 'download-' + artifact.id, kind: 'download' as const,
      description: `Download ${artifact.id} ${artifact.version} and verify SHA-256`, url: artifact.url, sha256: artifact.sha256,
      destination: join(destination, artifact.id + '.' + artifact.format) },
    ...(artifact.format === 'zip' ? [{ id: 'extract-' + artifact.id, kind: 'extract' as const, description: `Extract ${artifact.id} into the fresh private directory`, destination: join(destination, artifact.id) }] : [])]),
    ...commands.map((command, index) => ({ id: 'install-' + String(index), kind: 'process' as const, description: 'Run the reviewed private installation command.', ...command, cwd: destination })),
    { id: 'verify', kind: 'verify', description: 'Verify the installed executable identity and required runtime dependencies before selection.' },
    { id: 'publish', kind: 'publish', description: 'Select the verified installation only if the project configuration is unchanged.' }], confirmations, warnings,
    data: { kind: 'private-v1', artifacts: selectedArtifacts, python, pythonArgs, pythonLockSha256, pythonIdentity: null, platform: 'win32', architecture: 'x64' } }
}

/** Resolve the literal installer commands before confirmation.
 * @param recipeId - registered private recipe.
 * @param destination - fresh generation directory.
 * @param python - explicitly selected standalone Python.
 * @param pythonArgs - fixed interpreter launcher arguments.
 * @returns shell-free mutation commands; extraction and verification are separate plan steps.
 */
export function privateInstallationCommands(recipeId: string, destination: string, python: string,
  pythonArgs: string[]): { command: string; args: string[] }[] {
  const runtime = join(destination, 'runtime')
  if (recipeId === 'python-runtime') return [{ command: join(destination, 'python.exe'), args: ['/quiet', 'InstallAllUsers=0', 'TargetDir=' + runtime,
    'PrependPath=0', 'AppendPath=0', 'Include_launcher=0', 'InstallLauncherAllUsers=0', 'Include_test=0', 'Include_doc=0', 'Shortcuts=0', 'AssociateFiles=0'] }]
  if (recipeId === 'python-analysis') {
    const venv = join(destination, 'venv')
    return [{ command: python, args: [...pythonArgs, '-I', '-m', 'venv', venv] },
      { command: join(venv, 'Scripts/python.exe'), args: securityPythonInstallArguments(venv) }]
  }
  if (recipeId === 'wireshark' || recipeId === 'nmap') return [{ command: join(destination, recipeId + '.exe'), args: [
    ...recipeId === 'wireshark' ? ['/S', '/desktopicon=no'] : ['/NPCAP=NO', '/ZENMAP=NO', '/NDIFF=NO', '/NCAT=NO', '/NPING=NO', '/REGISTRYMODS=NO', '/REGISTERPATH=NO'], '/D=' + runtime] }]
  return []
}
