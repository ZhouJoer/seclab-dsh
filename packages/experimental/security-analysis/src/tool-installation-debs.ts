/** Fixed Debian package identities resolved from an APT dependency simulation. @module */
import { z } from 'zod'
import { ToolInstallationError } from './tool-installation-types.ts'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const change = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?$/u),
  version: z.string().regex(/^[a-zA-Z0-9.+:~_-]+$/u), previousVersion: z.string() }).strict()
const artifact = change.extend({ url: z.url(), filename: z.string().regex(/^[a-zA-Z0-9_.+:%~=-]+\.deb$/u),
  size: z.number().int().positive(), sha256: hash }).strict()
/** Immutable package changes and downloads included in the approved container plan. */
export const kaliDebResolutionSchema = z.object({ state: z.object({ packages: hash, metadata: hash }).strict(),
  changes: z.array(change), artifacts: z.array(artifact) }).strict()
/** Complete package transaction observed during preview. */
export type KaliDebResolution = z.infer<typeof kaliDebResolutionSchema>
/** Bounded Docker exec callback for one fixed preview target. */
export type KaliMetadataExecutor = (script: string) => Promise<string>

const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"
const packageState = "dpkg-query -W -f='${binary:Package}\\t${Version}\\t${db:Status-Status}\\n' | LC_ALL=C sort | sha256sum | cut -d ' ' -f 1"
const metadataState = "find /var/lib/apt/lists -type f ! -name lock -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | cut -d ' ' -f 1"
const stateScript = `set -eu\ntest -z "$(dpkg --audit)"\n${packageState}\n${metadataState}\n`
const externalDebs = [
  { name: 'radare2', version: '6.2.6', filename: 'radare2_6.2.6_amd64.deb', url: 'https://github.com/radareorg/radare2/releases/download/6.2.6/radare2_6.2.6_amd64.deb', sha256: '0dddf90e217e38a6a658881b9ec7e217198487c75b7f82a332b3cbd30834636f' },
  { name: 'r2ghidra', version: '6.2.6', filename: 'r2ghidra_6.2.6_amd64.deb', url: 'https://github.com/radareorg/r2ghidra/releases/download/6.2.6/r2ghidra_6.2.6_amd64.deb', sha256: 'c553b2d0402d0568140934397e8f13ef9596aee56a760dba5bea88248c2a6305' },
]

function packageChanges(simulation: string): KaliDebResolution['changes'] {
  const changes: KaliDebResolution['changes'] = []
  for (const line of simulation.split(/\r?\n/u)) {
    if (line.startsWith('Remv ')) throw new ToolInstallationError('unsupported', 'The package transaction would remove existing software. Select a fresh managed image.')
    if (!line.startsWith('Inst ')) continue
    const match = /^Inst (\S+)(?: \[([^\]]+)\])? \((\S+) /u.exec(line)
    if (!match) throw new ToolInstallationError('unsupported', 'APT returned an unsupported package change')
    changes.push(change.parse({ name: match[1], version: match[3], previousVersion: match[2] ?? '' }))
  }
  if (new Set(changes.map(item => item.name)).size !== changes.length) throw new Error('APT returned duplicate package changes')
  return changes
}

/** Read package and APT metadata fingerprints without modifying an external container.
 * @param exec - bounded command runner for the fixed target.
 * @returns current package and repository fingerprints; unfinished dpkg work is rejected.
 */
export async function readKaliPackageState(exec: KaliMetadataExecutor): Promise<KaliDebResolution['state']> {
  const lines = (await exec(stateScript)).trim().split(/\r?\n/u)
  return kaliDebResolutionSchema.shape.state.parse({ packages: lines[0], metadata: lines[1] })
}

/** Resolve every changed package to its exact version, repository URI and SHA-256.
 * @param packages - reviewed finite tool group, including package dependencies selected by APT.
 * @param exec - runner in the isolated resolver or read-only external target.
 * @param options - ownership, private temporary location and total download budget.
 * @returns the fixed transaction; package removals and incomplete metadata are rejected.
 */
export async function resolveKaliDebs(packages: string[], exec: KaliMetadataExecutor,
  options: {
    external: boolean
    reverse: boolean
    repair: boolean
    marker: string
    maxDownloadBytes: number
    artifactExecutor?: KaliMetadataExecutor
  }): Promise<KaliDebResolution> {
  if (options.external && options.reverse && !options.artifactExecutor) throw new ToolInstallationError('unsupported', 'External reverse engineering preview requires an isolated Debian artifact inspector')
  await exec('set -eu\n(. /etc/os-release; test "$ID" = kali)\ntest "$(dpkg --print-architecture)" = amd64\n')
  if (!options.external) await exec('apt-get update')
  const state = await readKaliPackageState(exec), extras: KaliDebResolution['artifacts'] = []
  const artifactExec = options.artifactExecutor ?? exec, dependencies: string[] = [], conflicts: string[] = []
  if (options.reverse) for (const deb of externalDebs) {
    const path = options.marker + '/' + deb.filename
    const output = await artifactExec(`set -eu\nmkdir -p ${quote(options.marker)}\n/usr/lib/apt/apt-helper download-file ${quote(deb.url)} ${quote(path)} ${quote('SHA256:' + deb.sha256)}\ndpkg-deb -f ${quote(path)}\nprintf '\\nDSH-SIZE '\nwc -c < ${quote(path)}\n`)
    const fields = new Map([...output.replace(/\n[ \t]+/gu, ' ').matchAll(/^([A-Za-z-]+): (.*)$/gmu)].map(match => [match[1], match[2] ?? '']))
    if (fields.get('Package') !== deb.name || fields.get('Version') !== deb.version) throw new Error('External Debian artifact package identity does not match the reviewed release')
    let previousVersion = ''
    if (options.external) {
      for (const field of ['Depends', 'Pre-Depends']) {
        for (const clause of (fields.get(field) ?? '').split(',').map(item => item.trim()).filter(Boolean)) {
          let supplied = false
          for (const alternative of clause.split('|').map(item => item.trim())) {
            const expression = /^([a-z0-9][a-z0-9+.-]*)(?::(?:any|native|amd64))?(?:\s+\((<<|<=|=|>=|>>)\s+([a-zA-Z0-9.+:~_-]+)\))?$/u
            const relation = expression.exec(alternative)
            if (!relation) throw new ToolInstallationError('unsupported', 'The signed Debian artifact uses an unsupported dependency expression: ' + alternative)
            const owned = externalDebs.find(item => item.name === relation[1])
            if (!owned) continue
            if (relation[2] && relation[3]) await artifactExec(`dpkg --compare-versions ${quote(owned.version)} ${quote(relation[2])} ${quote(relation[3])}`)
            supplied = true; break
          }
          if (!supplied) dependencies.push(clause)
        }
      }
      for (const field of ['Conflicts', 'Breaks']) {
        const value = fields.get(field)
        if (value) conflicts.push(value)
      }
      const installed = (await exec(`if dpkg-query -W -f='\${db:Status-Status}\\t\${Version}' ${quote(deb.name)} 2>/dev/null; then :; else printf missing; fi`)).trim()
      if (installed.startsWith('installed\t')) {
        previousVersion = z.string().regex(/^[a-zA-Z0-9.+:~_-]+$/u).parse(installed.slice('installed\t'.length))
        await artifactExec(`dpkg --compare-versions ${quote(previousVersion)} le ${quote(deb.version)}`)
      }
    }
    extras.push(artifact.parse({ ...deb, previousVersion, size: Number(/^DSH-SIZE (\d+)$/mu.exec(output)?.[1]) }))
  }
  const names = packages.filter(name => !externalDebs.some(deb => deb.name === name))
  const simulate = 'LC_ALL=C apt-get --simulate --no-remove --no-install-recommends '
  const changes = packageChanges(await exec(simulate + (options.repair ? '--reinstall ' : '') + 'install '
    + [...names.map(quote), ...(!options.external ? extras.map(deb => quote(options.marker + '/' + deb.filename)) : [])].join(' ')))
  if (options.external && options.reverse) {
    const selected = [...names.filter(name => !changes.some(item => item.name === name)),
      ...changes.map(item => `${item.name} (= ${item.version})`), ...dependencies]
    const complete = packageChanges(await exec(simulate + 'satisfy '
      + [quote(selected.join(', ')), ...conflicts.map(item => quote('Conflicts: ' + item))].join(' ')))
    for (const item of complete) {
      const existing = changes.find(selected => selected.name === item.name)
      if (existing && existing.version !== item.version) throw new ToolInstallationError('unsupported', 'External Debian dependencies conflict with the selected repository package versions')
      if (!existing) changes.push(item)
    }
  }
  if (options.external) for (const deb of extras) {
    if (changes.some(item => item.name === deb.name)) throw new ToolInstallationError('unsupported', 'APT selected a repository version of a pinned external Debian package')
    changes.push({ name: deb.name, version: deb.version, previousVersion: deb.previousVersion })
  }
  const repository = changes.filter(item => !extras.some(deb => deb.name === item.name))
  const query = repository.map(item => `printf '%s\\n' ${quote('DSH-PACKAGE ' + item.name + ' ' + item.version)}\napt-get --print-uris download ${quote(item.name + '=' + item.version)}\napt-cache show --no-all-versions ${quote(item.name + '=' + item.version)} | sed -n 's/^SHA256: /DSH-SHA256 /p'`).join('\n')
  const blocks = (query ? await exec('set -eu\n' + query) : '').split(/^DSH-PACKAGE /mu).slice(1)
  const artifacts = repository.map((item) => {
    const block = blocks.find(block => block.split(/\r?\n/u)[0] === `${item.name} ${item.version}`)
    if (!block) throw new ToolInstallationError('unsupported', 'APT omitted a fixed download for ' + item.name)
    const uri = /^'([^']+)' (\S+) (\d+) (\S+)$/mu.exec(block)
    const hashes = [...new Set([...block.matchAll(/^DSH-SHA256 ([a-f0-9]{64})$/gmu)].map(match => match[1]))]
    if (!uri || hashes.length !== 1) throw new ToolInstallationError('unsupported', 'APT did not provide one SHA-256 download identity for ' + item.name)
    const result = artifact.parse({ ...item, url: uri[1], filename: uri[2], size: Number(uri[3]), sha256: hashes[0] })
    if (!['http:', 'https:'].includes(new URL(result.url).protocol)) throw new ToolInstallationError('unsupported', 'Package sources must use HTTP(S)')
    if (uri[4]?.startsWith('SHA256:') && uri[4].slice(7) !== result.sha256) throw new Error('APT download and package metadata disagree about SHA-256')
    return result
  })
  for (const deb of extras) {
    const selected = changes.find(item => item.name === deb.name)
    if (selected) artifacts.push({ ...deb, previousVersion: selected.previousVersion })
  }
  if (artifacts.length !== changes.length) throw new Error('The package transaction has an unresolved download')
  if (artifacts.reduce((total, item) => total + item.size, 0) > options.maxDownloadBytes) throw new ToolInstallationError('unsupported', 'Resolved package downloads exceed the configured byte limit')
  if (options.external && JSON.stringify(await readKaliPackageState(exec)) !== JSON.stringify(state)) throw new ToolInstallationError('stale-plan', 'The external package state changed during preview')
  return { state, changes, artifacts }
}

/** Generate a transaction that downloads only reviewed artifacts and prohibits APT downloads or removals.
 * @param resolution - complete fixed package transaction.
 * @param marker - unique transaction directory.
 * @param external - whether repository metadata must still match the external target.
 * @param repair - reinstall the reviewed packages even when their versions are already installed.
 * @returns the exact install script shown in the plan.
 */
export function frozenKaliInstallScript(resolution: KaliDebResolution, marker: string, external: boolean, repair: boolean): string {
  const assets = marker + '/archives'
  const lines = ['set -eu', '(. /etc/os-release; test "$ID" = kali)', 'test "$(dpkg --print-architecture)" = amd64',
    `test "$(${packageState})" = ${quote(resolution.state.packages)}`,
    ...(external ? [`test "$(${metadataState})" = ${quote(resolution.state.metadata)}`] : []), `mkdir -p ${quote(assets + '/partial')}`]
  for (const item of resolution.artifacts) {
    const path = assets + '/' + item.filename
    lines.push(`/usr/lib/apt/apt-helper download-file ${quote(item.url)} ${quote(path)} ${quote('SHA256:' + item.sha256)}`,
      `test "$(wc -c < ${quote(path)})" -eq ${item.size}`, `printf '%s\\n' ${quote(item.sha256 + '  ' + path)} | sha256sum -c -`)
  }
  if (resolution.artifacts.length) {
    // This first dpkg hook runs under APT's frontend lock before any package mutation.
    const hook = `if ! test -f ${quote(marker + '/checked')}; then test "$(${packageState})" = ${quote(resolution.state.packages)} && touch ${quote(marker + '/checked')}; fi`
    lines.push('export DEBIAN_FRONTEND=noninteractive', `apt-get -y --no-download --no-remove --no-install-recommends ${repair ? '--reinstall ' : ''}-o ${quote('Dir::Cache::archives=' + assets)} -o ${quote('DPkg::Pre-Invoke::=' + hook)} install ${resolution.artifacts.map(item => quote(assets + '/' + item.filename)).join(' ')}`)
    for (const item of resolution.artifacts) lines.push(`test "$(dpkg-query -W -f='\${Version}' ${quote(item.name)})" = ${quote(item.version)}`)
  }
  return lines.join('\n') + '\n'
}
