/** Installation persistence preserves environment ownership and stable routes. @module */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { LocalToolConfiguration } from '../src/tool-configuration.ts'
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
