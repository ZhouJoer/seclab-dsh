/** Installation persistence preserves environment ownership and stable routes. @module */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { LocalToolConfiguration, toolConfigurationInput } from '../src/tool-configuration.ts'
import { readSecurityTools, readToolSettings } from '../src/local-tools.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'
import type { ToolboxInventory } from '../src/toolbox-types.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-adapter-settings-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const path = join(root, 'tools.json')
  const local: SecurityEnvironment = { id: 'local', kind: 'local', label: 'Host', cwd: root, tools: [] }
  const docker: SecurityEnvironment = { id: 'box', kind: 'docker', label: 'Container', cwd: root, image: 'fixture',
    containerId: 'owned-container', exchangeRoot: join(root, 'runs'), tools: [
      { id: 'docker', command: process.execPath, source: 'Host', versionArgs: ['--version'] },
    ] }
  const open = () => new LocalToolConfiguration(path, local, undefined, [local, docker], { radare2: 'local' })
  return { root, path, local, docker, open }
}
it('saves unique discovery for adapter routing without replacing pins or binding a tool', () => {
  const { open, path } = fixture()
  const settings = open()
  const inventory: ToolboxInventory = { environmentId: 'local', kind: 'local', runtime: 'ready', detail: '',
    checkedAt: 0, workdir: '', tools: [{ id: 'file', category: 'utility', status: 'available', command: process.execPath,
      location: process.execPath, version: 'fixture', source: 'PATH', detail: '', installUrl: '', invocation: 'shell' }] }
  const revision = settings.read().revision
  expect(settings.reconcile(inventory, revision)).toBe(true)
  expect(open().route('file', ['local'])).toBe('local')
  expect(readToolSettings(path).bindings).toEqual({})
  expect(() => settings.reconcile(inventory, revision)).toThrow('changed')
  const current = settings.read().revision
  expect(settings.reconcile({ ...inventory, tools: [{ ...inventory.tools[0]!, command: path }] }, current)).toBe(false)
  expect(settings.read().tools.find(tool => tool.id === 'file')?.command).toBe(process.execPath)
  expect(settings.reconcile({ ...inventory, tools: [{ ...inventory.tools[0]!, id: 'strings',
    status: 'not-checked', candidates: [process.execPath, path] }] }, current)).toBe(false)
})
it('upgrades legacy local pins while keeping Docker paths, routes and manager state independent', () => {
  const { path, local, docker, open } = fixture()
  writeFileSync(path, JSON.stringify({ radare2: process.execPath }))
  const settings = open()
  expect(settings.route('r2ghidra')).toBe('local')
  const revision = settings.read('box').revision
  settings.commit('radare2', { command: '/opt/r2/bin/radare2', prefixArgs: [], versionArgs: ['-v'] }, revision, 'box', 'box')
  expect(open().route('r2ghidra')).toBe('box')
  expect(readSecurityTools(path).radare2?.command).toBe(process.execPath)
  expect(readToolSettings(path)).toMatchObject({ version: 1, bindings: { radare2: 'box' },
    installations: { box: { radare2: { command: '/opt/r2/bin/radare2' } } } })
  expect(local.tools.find(tool => tool.id === 'radare2')?.command).toBe(process.execPath)
  expect(docker.containerId).toBe('owned-container')
  expect(docker.exchangeRoot).toBe(join(local.cwd, 'runs'))
  const saved = readFileSync(path, 'utf8')
  expect(() => settings.commit('radare2', undefined, revision, 'box')).toThrow('changed')
  expect(readFileSync(path, 'utf8')).toBe(saved)
})
it('rejects unsupported or missing environments and malformed documents without silently defaulting', () => {
  const { path, open } = fixture()
  const settings = open()
  expect(() => settings.route('tshark')).toThrow('Configure a default')
  expect(() => settings.commit('radare2', undefined, settings.read().revision, 'missing')).toThrow('environment')
  writeFileSync(path, JSON.stringify({ version: 2, installations: {}, bindings: {} }))
  expect(() => open()).toThrow()
  writeFileSync(path, JSON.stringify({ version: 1, installations: {}, bindings: { radare2: 'missing' } }))
  expect(() => open()).toThrow('environment')
})

it('resolves deployment-only installations and shared routes without an editable file', () => {
  const { local, docker } = fixture()
  local.tools = [{ id: 'radare2', command: process.execPath, prefixArgs: [], versionArgs: ['-v'], source: 'Deployment' }]
  const settings = new LocalToolConfiguration(undefined, local, undefined, [local, docker], { radare2: 'local' })
  expect(settings.route('r2ghidra')).toBe('local')
  const configuration = settings.read()
  expect(configuration).toMatchObject({ editable: false, bindings: { radare2: 'local' } })
  expect(configuration.adapters?.find(tool => tool.id === 'r2ghidra')).toMatchObject({ installationId: 'radare2',
    dependencies: ['radare2'], environmentId: 'local', bindingSource: 'deployment', status: 'unchecked' })
  expect(() => settings.bind('radare2', 'box', configuration.revision, 'local')).toThrow('read-only')
  expect(() => settings.commit('radare2', undefined, configuration.revision)).toThrow('read-only')
})

it('saves and restores routes independently while preserving every installation and unrelated binding', () => {
  const { path, open, docker } = fixture()
  writeFileSync(path, JSON.stringify({ version: 1, bindings: { tshark: 'box' }, installations: {
    local: { radare2: { command: process.execPath, prefixArgs: ['fixture'], versionArgs: ['-v'] } },
    box: { tshark: { command: '/opt/tshark', prefixArgs: [], versionArgs: ['--version'] } },
  } }))
  const settings = open(), before = readToolSettings(path)
  const saved = settings.bind('radare2', 'box', settings.read().revision, 'local')
  expect(readToolSettings(path).installations).toEqual(before.installations)
  expect(saved.bindings).toEqual({ radare2: 'box', tshark: 'box' })
  expect(() => settings.route('r2ghidra')).toThrow('Configure an installation for radare2 in box')
  expect(docker.containerId).toBe('owned-container')
  const reset = settings.bind('radare2', undefined, saved.revision, 'local')
  expect(reset.bindings).toEqual({ radare2: 'local', tshark: 'box' })
  expect(() => settings.bind('radare2', 'box', saved.revision, 'local')).toThrow('changed')
  expect(() => settings.bind('r2ghidra', 'box', reset.revision, 'local')).toThrow('radare2 binding')
  expect(() => settings.bind('custom', 'box', reset.revision, 'local')).toThrow('Unknown tool adapter')
  expect(() => settings.bind('radare2', 'unknown', reset.revision, 'local')).toThrow('environment')
  settings.bind('tshark', undefined, reset.revision, 'local')
  expect(() => settings.route('tshark')).toThrow('Configure a default')
})

it('rejects executable fields on binding-only wire actions', () => {
  expect(toolConfigurationInput.parse({ action: 'bind', id: 'radare2', revision: 'r', defaultEnvironmentId: 'local' }))
    .toEqual({ action: 'bind', id: 'radare2', revision: 'r', defaultEnvironmentId: 'local' })
  expect(() => toolConfigurationInput.parse({ action: 'bind', id: 'radare2', revision: 'r', defaultEnvironmentId: 'local', command: 'r2' })).toThrow()
})

it('inherits a unique task environment and reports missing dependencies together without switching targets', () => {
  const { local, docker } = fixture()
  const settings = new LocalToolConfiguration(undefined, local, undefined, [local, docker])
  expect(settings.route('ghidra', ['local'])).toBe('local')
  expect(() => settings.route('packet-capture', ['local'])).toThrow('python, tshark')
  expect(() => settings.route('radare2', ['local', 'box'])).toThrow('exactly one compatible')
  expect(() => settings.route('radare2', ['box'])).toThrow('in box')
  const pinned = new LocalToolConfiguration(undefined, local, undefined, [local, docker], { radare2: 'local' })
  expect(() => pinned.route('radare2', ['box'])).toThrow('outside the task')
})

it('routes service, device and multiple-installation adapters without making services executable installations', () => {
  const { path, local, docker } = fixture()
  const device: SecurityEnvironment = { ...local, id: 'phone', kind: 'android', deviceId: 'operator-device',
    tools: [{ id: 'adb', command: process.execPath, versionArgs: ['version'], source: 'Deployment' }] }
  const settings = new LocalToolConfiguration(path, local, undefined, [local, docker, device],
    { ghidra: 'local', adb: 'phone', 'packet-capture': 'local' })
  expect(settings.route('ghidra')).toBe('local')
  expect(settings.route('adb')).toBe('phone')
  expect(() => settings.route('packet-capture')).toThrow('python')
  const config = settings.read()
  expect(config.adapters?.find(item => item.id === 'ghidra')).toMatchObject({ provider: 'ghidra', status: 'unchecked', dependencies: [] })
  expect(config.adapters?.find(item => item.id === 'ghidra')).not.toHaveProperty('installationId')
  expect(config.adapters?.find(item => item.id === 'packet-capture')).toMatchObject({
    dependencies: ['python', 'tshark'], status: 'unconfigured', environmentIds: ['local'] })
  expect(config.adapters?.find(item => item.id === 'packet-capture')).not.toHaveProperty('installationId')
  expect(() => settings.bind('ghidra', 'box', config.revision, 'local')).toThrow('Unsupported execution environment')
  expect(() => settings.commit('ghidra', undefined, config.revision)).toThrow('provider')
  settings.bind('adb', 'local', config.revision, 'local')
  expect(settings.read().adapters?.find(item => item.id === 'adb')).toMatchObject({ status: 'unconfigured', prerequisite: 'device' })
  expect(() => settings.route('adb')).toThrow('deviceId')
  expect(new LocalToolConfiguration(path, local, undefined, [local, docker, device]).read().bindings?.adb).toBe('local')
})

it('rejects external Kali adapter bindings while preserving its deployment installations', () => {
  const { local, docker } = fixture()
  const { image: _image, ...base } = docker
  const kali: SecurityEnvironment = { ...base, id: 'kali', externalContainer: { name: 'existing-kali', workdir: '/analysis' } }
  const tools = structuredClone(kali.tools)
  expect(() => new LocalToolConfiguration(undefined, local, undefined, [local, kali], { radare2: 'kali' }))
    .toThrow('Unsupported execution environment')
  expect(kali.tools).toEqual(tools)
  expect(kali.externalContainer).toEqual({ name: 'existing-kali', workdir: '/analysis' })
})
