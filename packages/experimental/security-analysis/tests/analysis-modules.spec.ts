/** Module selection controls both discovery and generic provider execution. @module */
import { expect, it } from 'vitest'
import { moduleAllowsDefinition, moduleAllowsOperation, moduleAllowsTool, moduleSelectionSchema, moduleSkills, resolveModuleSelection } from '../src/analysis-modules.ts'
import { manifestItems } from '../src/android-manifest.ts'
import { securityBrowserTools } from '../src/browser-tools.ts'
import { toolsForRole } from '../src/workbench/roles.ts'

it('admits only the browser catalog for coordinator and web analyst with the web module selected', () => {
  for (const name of securityBrowserTools) {
    expect(moduleAllowsTool(name)).toBe(false)
    expect(moduleAllowsTool(name, { mode: 'manual', modules: ['web'], reason: '' })).toBe(true)
    for (const role of ['coordinator', 'web-analyst'] as const) expect(toolsForRole(role)).toContain(name)
    for (const role of ['researcher', 'reviewer', 'reconnaissance', 'reverse-analyst'] as const) expect(toolsForRole(role)).not.toContain(name)
  }
  for (const name of ['browser_run_code', 'browser_evaluate', 'browser_file_upload', 'browser_install', 'browser_future_tool'])
    expect(toolsForRole('coordinator')).not.toContain('mcp__playwright-mcp__' + name)
})

it('keeps historical tasks automatic and exposes only common capabilities before selection', () => {
  expect(resolveModuleSelection()).toEqual({ mode: 'auto', modules: [], reason: '' })
  expect(moduleSkills()).toEqual([])
  expect(moduleAllowsTool('security_file')).toBe(true)
  expect(moduleAllowsTool('pwsh')).toBe(true)
  for (const name of ['security_jadx', 'security_ghidra', 'security_tshark', 'security_packet_capture'])
    expect(moduleAllowsTool(name)).toBe(false)
})

it('combines Android and native skills without enabling unrelated provider paths', () => {
  const selection = moduleSelectionSchema.parse({ mode: 'manual', modules: ['reverse.android', 'reverse.native'], reason: 'JNI' })
  expect(moduleSkills(selection)).toContain('security-native')
  for (const [provider, operation] of [['android', 'decompile'], ['tool-adapter', 'analysis.android-api'], ['tool-adapter', 'analysis.native-triage'], ['ghidra', 'decompile'], ['debugger', 'run']])
    expect(moduleAllowsOperation(provider!, operation!, selection)).toBe(true)
  for (const [provider, operation] of [['packet-capture', 'summary'], ['tool-adapter', 'tshark.summary'], ['web', 'request']])
    expect(moduleAllowsOperation(provider!, operation!, selection)).toBe(false)
  const copy = resolveModuleSelection(selection)
  copy.modules.length = 0
  expect(selection.modules).toHaveLength(2)
  expect(moduleSelectionSchema.safeParse({ ...selection, modules: ['web', 'web'] }).success).toBe(false)
})

it('routes the pentest module to Kali and Web skills without enabling reverse capabilities', () => {
  const selection = moduleSelectionSchema.parse({ mode: 'manual', modules: ['pentest'], reason: 'authorized lab exercise' })
  expect(moduleSkills(selection)).toEqual(['security-kali', 'security-web'])
  for (const name of ['security_jadx', 'security_ghidra', 'security_radare2', 'security_analysis'])
    expect(moduleAllowsTool(name, selection)).toBe(false)
  for (const [provider, operation] of [['android', 'decompile'], ['tool-adapter', 'analysis.native-triage'], ['ghidra', 'decompile'], ['packet-capture', 'summary'], ['frida', 'script'], ['debugger', 'run']])
    expect(moduleAllowsOperation(provider!, operation!, selection)).toBe(false)
  expect(moduleAllowsTool('security_file', selection)).toBe(true)
})

it('keeps Web enabling the Kali method and rejects five-module selections', () => {
  const selection = moduleSelectionSchema.parse({ mode: 'manual', modules: ['web'], reason: 'web app' })
  expect(moduleSkills(selection)).toEqual(['security-web', 'security-kali'])
  expect(moduleSelectionSchema.safeParse({ mode: 'manual', modules: ['reverse.android', 'reverse.native', 'web', 'iot', 'pentest'], reason: '' }).success).toBe(false)
})

it('filters catalog entries by module-owned skill associations', () => {
  const pentest = moduleSelectionSchema.parse({ mode: 'manual', modules: ['pentest'], reason: 'lab' })
  const iot = moduleSelectionSchema.parse({ mode: 'manual', modules: ['iot'], reason: 'capture' })
  expect(moduleAllowsDefinition({ id: 'nmap', skills: ['security-web', 'security-kali'] }, pentest)).toBe(true)
  expect(moduleAllowsDefinition({ id: 'nmap', skills: ['security-web', 'security-kali'] }, iot)).toBe(false)
  expect(moduleAllowsDefinition({ id: 'radare2', skills: ['security-firmware'] }, pentest)).toBe(false)
  expect(moduleAllowsDefinition({ id: 'hashcat', skills: ['security-kali'] }, pentest)).toBe(true)
})

it('retains manifest aliases, declarations and missing exported attributes without guessing defaults', () => {
  const items = manifestItems([{ path: 'resources/AndroidManifest.xml', text: '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="sample.app"><application><activity android:name=".Main"/><activity-alias android:name=".Launcher" android:targetActivity=".Main" android:exported="false"/></application></manifest>' }])
  expect(items).toContainEqual(expect.objectContaining({ component: 'activity', name: '.Main', declaredExported: null }))
  expect(items).toContainEqual(expect.objectContaining({ component: 'activity-alias', name: '.Launcher', declaredExported: 'false' }))
})

it('rejects absent, malformed and entity-bearing manifest resources', () => {
  expect(() => manifestItems([])).toThrow('did not produce')
  for (const text of ['<manifest>', '<!DOCTYPE manifest [<!ENTITY a "x">]><manifest/>', '<other/>', '<manifest/><manifest/>'])
    expect(() => manifestItems([{ path: 'AndroidManifest.xml', text }])).toThrow()
})
