/** Fixed package previews reject drift, missing hashes and destructive dependency solutions. @module */
import { expect, it } from 'vitest'
import { frozenKaliInstallScript, resolveKaliDebs, type KaliMetadataExecutor } from '../src/tool-installation-debs.ts'

const packages = 'a'.repeat(64), metadata = 'b'.repeat(64), digest = 'c'.repeat(64)
const options = { external: true, reverse: false, repair: false, marker: '/var/tmp/dsh-install-0001', maxDownloadBytes: 100 }
const state = packages + '\n' + metadata + '\n'
const archive = `DSH-PACKAGE nmap 7.99\n'https://example.test/nmap.deb' nmap_7.99_amd64.deb 40 SHA256:${digest}\nDSH-SHA256 ${digest}\n`
const fake: KaliMetadataExecutor = async (script) => {
  if (script.includes('dpkg --audit')) return state
  if (script.includes('--simulate')) return 'Inst nmap [7.98] (7.99 kali [amd64])\n'
  if (script.includes('DSH-PACKAGE')) return archive
  return ''
}

it('fixes complete package identities while external preview only reads existing metadata', async () => {
  const commands: string[] = []
  const result = await resolveKaliDebs(['nmap'], async (script) => { commands.push(script); return fake(script) }, options)
  expect(result.changes).toEqual([{ name: 'nmap', version: '7.99', previousVersion: '7.98' }])
  expect(result.artifacts).toEqual([{ name: 'nmap', version: '7.99', previousVersion: '7.98', url: 'https://example.test/nmap.deb',
    filename: 'nmap_7.99_amd64.deb', size: 40, sha256: digest }])
  expect(commands.some(command => command.includes('apt-get update') || command.includes('mkdir') || command.includes('download-file'))).toBe(false)
  const script = frozenKaliInstallScript(result, options.marker, true, false)
  expect(script).toContain('--no-download --no-remove --no-install-recommends')
  expect(script).toContain('Dir::Cache::archives=/var/tmp/dsh-install-0001/archives')
  expect(script).toContain('DPkg::Pre-Invoke::=')
  expect(script).toContain(`SHA256:${digest}`)
  expect(script).toContain("dpkg-query -W -f='${Version}' 'nmap'")
  expect(script).not.toContain('apt-get update')
})

it('includes newly selected dependencies in the fixed manifest', async () => {
  const result = await resolveKaliDebs(['nmap'], async (script) => {
    if (script.includes('--simulate')) return 'Inst nmap (7.99 kali [amd64])\nInst libpcap0.8 (1.10 kali [amd64])\n'
    if (script.includes('DSH-PACKAGE')) return archive + `DSH-PACKAGE libpcap0.8 1.10\n'https://example.test/libpcap.deb' libpcap_1.10_amd64.deb 25 SHA256:${digest}\nDSH-SHA256 ${digest}\n`
    return fake(script)
  }, options)
  expect(result.artifacts.map(item => item.name)).toEqual(['nmap', 'libpcap0.8'])
})

it.each([true, false])('repairs identical package versions with fixed archives and missing dependencies (external=%s)', async (external) => {
  const commands: string[] = []
  const result = await resolveKaliDebs(['nmap'], async (script) => {
    commands.push(script)
    if (script.includes('--simulate')) return 'Inst nmap [7.99] (7.99 kali [amd64])\nInst libpcap0.8 (1.10 kali [amd64])\n'
    if (script.includes('DSH-PACKAGE')) return archive + `DSH-PACKAGE libpcap0.8 1.10\n'https://example.test/libpcap.deb' libpcap_1.10_amd64.deb 25 SHA256:${digest}\nDSH-SHA256 ${digest}\n`
    return fake(script)
  }, { ...options, external, repair: true })
  expect(commands.find(command => command.includes('--simulate'))).toContain("--reinstall install 'nmap'")
  expect(result.artifacts.map(item => [item.name, item.previousVersion, item.version])).toEqual([
    ['nmap', '7.99', '7.99'], ['libpcap0.8', '', '1.10'],
  ])
  const script = frozenKaliInstallScript(result, options.marker, external, true)
  expect(script).toContain('--no-download --no-remove --no-install-recommends --reinstall')
  expect(script).toContain('nmap_7.99_amd64.deb')
  expect(script).toContain('libpcap_1.10_amd64.deb')
})

it('rejects an APT removal plan before producing install commands', async () => {
  await expect(resolveKaliDebs(['nmap'], script => script.includes('--simulate') ? Promise.resolve('Remv existing-tool [1]\n') : fake(script), options))
    .rejects.toMatchObject({ code: 'unsupported' })
})

it.each(['missing', 'disagrees'] as const)('rejects %s SHA-256 metadata', async (mode) => {
  await expect(resolveKaliDebs(['nmap'], script => script.includes('DSH-PACKAGE')
    ? Promise.resolve(mode === 'missing' ? archive.replace(`DSH-SHA256 ${digest}`, '') : archive.replace(`DSH-SHA256 ${digest}`, 'DSH-SHA256 ' + 'd'.repeat(64)))
    : fake(script), options)).rejects.toThrow()
})

it('rejects package-state drift and enforces the reviewed download budget', async () => {
  let reads = 0
  await expect(resolveKaliDebs(['nmap'], script => script.includes('dpkg --audit') && reads++ > 0
    ? Promise.resolve('f'.repeat(64) + '\n' + metadata) : fake(script), options)).rejects.toMatchObject({ code: 'stale-plan' })
  await expect(resolveKaliDebs(['nmap'], fake, { ...options, maxDownloadBytes: 39 })).rejects.toMatchObject({ code: 'unsupported' })
})

it('refuses external reverse-package resolution before downloading into the existing container', async () => {
  const commands: string[] = []
  await expect(resolveKaliDebs(['radare2'], async (script) => { commands.push(script); return fake(script) }, { ...options, reverse: true }))
    .rejects.toMatchObject({ code: 'unsupported' })
  expect(commands).toEqual([])
})

it.each([false, true])('resolves external reverse dependencies from isolated controls and preserves selected packages (repair=%s)', async (repair) => {
  const externalCommands: string[] = [], isolatedCommands: string[] = []
  const exec: KaliMetadataExecutor = async (script) => {
    externalCommands.push(script)
    if (script.includes('--simulate')) return script.includes('satisfy') ? 'Inst libc6 [2.35] (2.36 kali [amd64])\n' : 'Inst ghidra [11.0] (11.0 kali [amd64])\n'
    if (script.includes('DSH-PACKAGE')) return `DSH-PACKAGE ghidra 11.0\n'https://example.test/ghidra.deb' ghidra_11.0_amd64.deb 20 SHA256:${digest}\nDSH-SHA256 ${digest}\nDSH-PACKAGE libc6 2.36\n'https://example.test/libc6.deb' libc6_2.36_amd64.deb 40 SHA256:${digest}\nDSH-SHA256 ${digest}\n`
    if (script.includes('if dpkg-query')) return 'missing'
    return fake(script)
  }
  const artifactExecutor: KaliMetadataExecutor = async (script) => {
    isolatedCommands.push(script)
    if (!script.includes('download-file')) return ''
    const name = script.includes('r2ghidra_6.2.6') ? 'r2ghidra' : 'radare2'
    return `Package: ${name}\nVersion: 6.2.6\nDepends: ${name === 'r2ghidra' ? 'radare2 (>= 6.2.6), ' : ''}libc6 (>= 2.36)\nDSH-SIZE 20\n`
  }
  const result = await resolveKaliDebs(['radare2', 'r2ghidra', 'ghidra'], exec, { ...options, repair, reverse: true, artifactExecutor })
  expect(result.artifacts.map(item => item.name)).toEqual(['ghidra', 'libc6', 'radare2', 'r2ghidra'])
  expect(externalCommands.find(script => script.includes('satisfy'))).toContain("satisfy 'ghidra (= 11.0), libc6 (>= 2.36), libc6 (>= 2.36)'")
  expect(externalCommands.find(script => script.includes('--simulate') && script.includes('install'))?.includes('--reinstall')).toBe(repair)
  expect(externalCommands.some(script => /mkdir|download-file|dpkg-deb|apt-get update/u.test(script))).toBe(false)
  expect(isolatedCommands.filter(script => script.includes('download-file'))).toHaveLength(2)
  expect(isolatedCommands).toContain("dpkg --compare-versions '6.2.6' '>=' '6.2.6'")
})
