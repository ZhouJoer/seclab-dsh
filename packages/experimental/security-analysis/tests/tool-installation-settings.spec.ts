/** Installation publication coordinates project selections without deleting installed tools. @module */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolInstallationSelections } from '../src/tool-installation-settings.ts'
import { LocalToolConfiguration } from '../src/tool-configuration.ts'
import { readToolSettings } from '../src/local-tools.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'
import type { ToolInstallationExecutionResult, ToolInstallationPlan, ToolInstallationPlanId } from '../src/tool-installation-types.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-selection-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const environment: SecurityEnvironment = { id: 'local', label: 'Host', kind: 'local', cwd: root, tools: [] }
  const path = join(root, 'tools.json'), environmentPath = join(root, 'environments.json')
  const settings = new LocalToolConfiguration(path, environment)
  const selections = new ToolInstallationSelections(settings, [environment], environmentPath, async () => {})
  const snapshot = await selections.snapshot('local')
  const plan: ToolInstallationPlan = { ...snapshot, id: brandString<ToolInstallationPlanId>('plan'), digest: 'digest',
    recipeId: 'fixture', recipeVersion: '1', toolIds: ['file'], mode: 'private', version: '1', destination: root,
    steps: [], confirmations: [], warnings: [], data: {}, createdAt: 0, toolRoot: root, rootRevision: 1,
    request: { recipeId: 'fixture', environmentId: 'local', action: 'install', options: {} } }
  const result: ToolInstallationExecutionResult = { installations: [], checks: [],
    pins: { file: { command: join(root, '工具 安装', 'file.exe'), prefixArgs: [], versionArgs: ['--version'] } } }
  return { root, path, environmentPath, settings, selections, plan, result }
}

it('commits verified Chinese and space paths together while retaining explicit bindings', async () => {
  const { settings, selections, plan, result, path } = await fixture()
  await selections.commit(plan, result)
  expect(settings.read().tools.find(tool => tool.id === 'file')?.command).toBe(result.pins.file!.command)
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ bindings: {} })
})

it('retains the previous selection when another operator edits during installation', async () => {
  const { settings, selections, plan, result, path } = await fixture()
  await settings.commit('file', { command: process.execPath, prefixArgs: [], versionArgs: ['--version'] }, settings.read().revision)
  const previous = await readFile(path, 'utf8')
  await expect(selections.commit(plan, result)).rejects.toMatchObject({ code: 'configuration-conflict' })
  expect(await readFile(path, 'utf8')).toBe(previous)
})

it('reconciles an already published installation without overwriting unrelated edits', async () => {
  const { settings, selections, plan, result, path } = await fixture()
  await selections.commit(plan, result)
  await settings.commit('strings', { command: process.execPath, prefixArgs: [], versionArgs: ['--version'] }, settings.read().revision)
  const previous = await readFile(path, 'utf8')
  await selections.commit(plan, result)
  expect(await readFile(path, 'utf8')).toBe(previous)
})

it('requires a Host reload when deployment files change before preview', async () => {
  const { selections, environmentPath } = await fixture()
  await writeFile(environmentPath, JSON.stringify({ environments: [] }))
  await expect(selections.snapshot('local')).rejects.toMatchObject({ code: 'configuration-conflict' })
})

it('rejects a relative private temporary path without corrupting settings', async () => {
  const { settings, path } = await fixture()
  await expect(settings.commit('file', { command: process.execPath, prefixArgs: [], versionArgs: ['--version'],
    temporaryDirectory: 'relative' }, settings.read().revision)).rejects.toThrow('Invalid executable')
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects environment edits before writing any tool selection', async () => {
  const { selections, plan, result, path, environmentPath } = await fixture()
  await writeFile(environmentPath, JSON.stringify({ environments: [] }))
  await expect(selections.commit(plan, result)).rejects.toMatchObject({ code: 'configuration-conflict' })
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('allows only one of two writers holding the same observed revision to commit', async () => {
  const { settings, path, root } = await fixture()
  const other = new LocalToolConfiguration(path, { id: 'local', label: 'Host', kind: 'local', cwd: root, tools: [] })
  const revision = settings.read().revision
  const pin = { command: process.execPath, prefixArgs: [], versionArgs: ['--version'] }
  const outcomes = await Promise.allSettled([settings.commit('file', pin, revision), other.commit('strings', pin, revision)])
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(Object.keys(readToolSettings(path).installations.local!)).toHaveLength(1)
})

it('refuses cleanup while another project selects the generation or a recorded selection cannot be read', async () => {
  const { selections, root } = await fixture()
  const other = join(root, 'other-project.json'), generation = join(root, 'generation')
  await writeFile(other, JSON.stringify({ version: 1, bindings: {}, installations: {
    local: { file: { command: join(generation, 'file.exe'), prefixArgs: [], versionArgs: ['--version'] } },
  } }))
  expect(await selections.inUse(generation, [other])).toBe(true)
  expect(await selections.inUse(generation, [join(root, 'missing.json')])).toBe(true)
  await writeFile(other, JSON.stringify({ version: 1, bindings: {}, installations: {} }))
  expect(await selections.inUse(generation, [other])).toBe(false)
})
