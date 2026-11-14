/** Private recipes preserve dependency selections and recheck recorded executables without reinstalling. @module */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it, onTestFinished } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { privateInstallationCommands, toolInstallationRecipes } from '../src/tool-installation-recipes.ts'
import { toolExecutableSha256 } from '../src/tool-installation-artifacts.ts'
import { verifyPrivateToolInstallation, type InstallationCommandRunner } from '../src/tool-installation-private.ts'
import type { ToolInstallationExecutionResult, ToolInstallationPlan, ToolInstallationPlanId } from '../src/tool-installation-types.ts'

const signal = new AbortController().signal
const environment = { id: 'local', label: 'Local', kind: 'local' as const, cwd: process.cwd(), tools: [] }
const plan: ToolInstallationPlan = { id: brandString<ToolInstallationPlanId>('private-plan'), digest: 'digest', createdAt: 1,
  toolRoot: '/owned', rootRevision: 1, configurationRevision: 'revision', environment,
  request: { recipeId: 'jadx', environmentId: 'local', action: 'install', options: {} }, recipeId: 'jadx', recipeVersion: '1',
  version: '1.5.6', toolIds: ['java', 'jadx'], mode: 'private', destination: '/owned/generation', steps: [], confirmations: [], warnings: [], data: {} }
const observed: ToolInstallationExecutionResult = { checks: [], pins: {
  java: { command: '/owned/generation/java.exe', prefixArgs: [], versionArgs: ['-version'] },
  jadx: { command: '/owned/generation/java.exe', prefixArgs: ['-cp', '/owned/generation/lib/*', 'jadx.cli.JadxCLI'], versionArgs: ['--version'] },
}, installations: [{ toolId: 'java', version: '25.0.5+8', location: plan.destination, ownership: 'managed' },
  { toolId: 'jadx', version: '1.5.6', location: plan.destination, ownership: 'managed' }] }

it('includes the selected private Java runtime in every dependent recipe', () => {
  for (const id of ['ghidra-headless', 'jadx', 'apktool'])
    expect(toolInstallationRecipes().find(recipe => recipe.id === id)?.toolIds).toEqual(['java', id])
})

it('keeps Npcap excluded and the private destination as the final official installer argument', () => {
  const command = privateInstallationCommands('nmap', '/owned/space path', '', [])[0]!
  expect(command.args).toContain('/NPCAP=NO')
  expect(command.args).not.toContain('/S')
  expect(command.args.at(-1)).toBe('/D=' + join('/owned/space path', 'runtime'))
})

it('previews an isolated hash-only wheel installation without dependency resolution', () => {
  const commands = privateInstallationCommands('python-analysis', '/owned/venv', '/python', ['-3.13'])
  expect(commands[1]?.args).toEqual(expect.arrayContaining(['--require-hashes', '--only-binary=:all:', '--no-deps', '--require-virtualenv', 'https://pypi.org/simple']))
})

it('reconciles a recorded Java-dependent installation using each tool own release version', async () => {
  const calls: string[][] = []
  const runner: InstallationCommandRunner = async (_command, args) => {
    calls.push(args)
    return args.includes('jadx.cli.JadxCLI') ? '1.5.6' : 'openjdk version "25.0.5"'
  }
  const result = await verifyPrivateToolInstallation(plan, observed, { signal, log: async () => {}, phase: async () => {} }, runner)
  expect(result.installations.map(receipt => receipt.version)).toEqual(['25.0.5+8', '1.5.6'])
  expect(result.checks.every(check => check.status === 'passed')).toBe(true)
  expect(calls).toEqual([['-version'], ['-cp', '/owned/generation/lib/*', 'jadx.cli.JadxCLI', '--version']])
})

it('rejects a replaced private Java runtime during reconciliation', async () => {
  await expect(verifyPrivateToolInstallation(plan, observed, { signal, log: async () => {}, phase: async () => {} }, async () => 'openjdk version "21.0.9"'))
    .rejects.toThrow('java version differs')
})

it('bounds and cancels executable hashing before accepting the interpreter identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-interpreter-hash-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'python.exe')
  await writeFile(executable, 'fixture')
  expect(await toolExecutableSha256(executable, 7, signal)).toBe(createHash('sha256').update('fixture').digest('hex'))
  await expect(toolExecutableSha256(executable, 6, signal)).rejects.toThrow('byte limit')
  await expect(toolExecutableSha256(executable, 7, AbortSignal.abort())).rejects.toThrow()
})
