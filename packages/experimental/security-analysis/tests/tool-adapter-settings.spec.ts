/** Installation persistence preserves environment ownership and stable routes. @module */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { LocalToolConfiguration, toolConfigurationInput } from '../src/tool-configuration.ts'
import { readSecurityTools, readToolSettings } from '../src/local-tools.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'

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
  expect(settings.route('r2ghidra')).toBe('box')
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
