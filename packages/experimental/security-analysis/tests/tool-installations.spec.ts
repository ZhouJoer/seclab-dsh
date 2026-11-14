/** Installation confirmation, durable recovery and cancellation use owned temporary roots. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecurityToolInstallations } from '../src/tool-installations.ts'
import { ToolInstallationStore, toolInstallationLedgerSchema, withExistingToolSelection } from '../src/tool-installation-store.ts'
import { ToolInstallationError, ToolInstallationOutcomeUnknownError } from '../src/tool-installation-types.ts'
import type { ToolInstallationExecutionResult, ToolInstallationExecutor, ToolInstallationOperation, ToolInstallationPlan } from '../src/tool-installation-types.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(overrides: Partial<ToolInstallationExecutor> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-installation-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
  const directory = join(root, 'home'), toolRoot = join(root, 'tools'), ctx = new Context()
  const state = { revision: 'first', commitFailure: false }
  const execute = vi.fn(async (plan: ToolInstallationPlan): Promise<ToolInstallationExecutionResult> => {
    await mkdir(plan.destination, { recursive: true })
    return { installations: [{ toolId: 'sample', version: '1', location: plan.destination, ownership: 'managed' }],
      pins: { sample: { command: join(plan.destination, 'sample'), prefixArgs: [], versionArgs: ['--version'] } },
      checks: [{ id: 'sample', status: 'passed', detail: 'version 1' }] }
  })
  const commit = vi.fn(async () => { if (state.commitFailure) throw new ToolInstallationError('configuration-conflict', 'Selections changed') })
  const executor: ToolInstallationExecutor = {
    preview: async (_request, context) => ({ recipeId: 'sample', recipeVersion: '1', toolIds: ['sample'], mode: 'private',
      version: '1', destination: join(context.toolRoot, 'sample-1'), steps: [], confirmations: [], warnings: [], data: {} }),
    execute, ...overrides,
  }
  const options = { directory, executor, maxLogBytes: 16, maxLogChunks: 2, selectionId: join(root, 'selection.json'),
    isInstallationInUse: async () => false,
    withUnusedInstallation: async <T>(_location: string, _references: readonly string[], remove: () => Promise<T>) => remove(),
    snapshot: async () => ({ environment: { id: 'host', kind: 'local' as const, label: 'Host', cwd: root, tools: [] }, configurationRevision: state.revision }),
    withEnvironment: async <T>(_id: string, run: (signal: AbortSignal) => Promise<T>) => run(new AbortController().signal), commit }
  const manager = new SecurityToolInstallations(ctx, options)
  cleanups.push(() => manager.close())
  await manager.root()
  const plan = async () => manager.preview({ recipeId: 'sample', environmentId: 'host', action: 'install', options: {} })
  const configure = async () => manager.setRoot(toolRoot, (await manager.root()).revision)
  return { root, directory, toolRoot, manager, plan, configure, state, execute, commit, options, executor }
}

async function settled(manager: SecurityToolInstallations, operation: ToolInstallationOperation) {
  let last = operation
  for await (const frame of manager.follow(operation.id, 0, new AbortController().signal)) last = frame.operation
  return last
}

it('requires an explicitly selected root and invalidates previews when it changes', async () => {
  const fixtureValue = await fixture(), { manager, plan, configure, execute } = fixtureValue
  await expect(plan()).rejects.toMatchObject({ code: 'unconfigured-root' })
  await configure(); const preview = await plan()
  expect(execute).not.toHaveBeenCalled()
  await manager.setRoot(join(fixtureValue.root, 'different'), (await manager.root()).revision)
  await expect(manager.apply(preview.id, preview.digest, 'request', [])).rejects.toMatchObject({ code: 'stale-plan' })
  expect(execute).not.toHaveBeenCalled()
})

it('publishes one attempt for concurrent retries and rejects changed configuration before execution', async () => {
  const { manager, plan, configure, state, execute, commit } = await fixture()
  await configure(); const stale = await plan(); state.revision = 'new'
  await expect(manager.apply(stale.id, stale.digest, 'stale', [])).rejects.toMatchObject({ code: 'stale-plan' })
  const preview = await plan()
  const [first, second] = await Promise.all([manager.apply(preview.id, preview.digest, 'same', []), manager.apply(preview.id, preview.digest, 'same', [])])
  expect(first.id).toBe(second.id)
  expect((await settled(manager, first)).phase).toBe('completed')
  expect(execute).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1)
  expect((await manager.list()).installations).toHaveLength(1)
})

it('retains verified output when the project selection CAS fails', async () => {
  const { manager, configure, plan, state, commit } = await fixture()
  state.commitFailure = true; await configure(); const preview = await plan()
  const operation = await settled(manager, await manager.apply(preview.id, preview.digest, 'conflict', []))
  expect(operation.phase).toBe('installed-unbound'); expect(operation.result?.pins.sample).toBeDefined()
  expect((await manager.list()).installations).toHaveLength(1); expect(commit).toHaveBeenCalledTimes(1)
})

it('requires external-container confirmation and retains uncertain remote cancellation', async () => {
  const entered = Promise.withResolvers<undefined>()
  const { manager, configure, plan, commit } = await fixture({
    preview: async (_request, context) => ({ recipeId: 'sample', recipeVersion: '1', toolIds: ['sample'], mode: 'external-container',
      version: '1', destination: context.toolRoot, steps: [], confirmations: [{ id: 'external-container', description: 'Modify external Kali' }], warnings: [], data: {} }),
    execute: async (_plan, context) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => { context.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      throw new ToolInstallationOutcomeUnknownError('Remote package manager may still be running')
    },
  })
  await configure(); const preview = await plan()
  await expect(manager.apply(preview.id, preview.digest, 'external', [])).rejects.toMatchObject({ code: 'confirmation-required' })
  const operation = await manager.apply(preview.id, preview.digest, 'external', ['external-container']); await entered.promise
  expect((await manager.cancel(operation.id)).phase).toBe('needs-reconciliation'); expect(commit).not.toHaveBeenCalled()
  await expect(manager.apply(preview.id, preview.digest, 'new', ['external-container'])).rejects.toMatchObject({ code: 'busy' })
})

it('bounds retained logs and reports a replay gap after cancellation settles', async () => {
  const entered = Promise.withResolvers<undefined>()
  const { manager, configure, plan } = await fixture({ execute: async (_plan, context) => {
    await context.log('stdout', '1234567890'); await context.log('stdout', 'abcdefghij'); entered.resolve(undefined)
    await new Promise<void>((resolve) => { context.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    context.signal.throwIfAborted(); throw new Error('Expected cancellation')
  } })
  await configure(); const preview = await plan(), operation = await manager.apply(preview.id, preview.digest, 'logs', [])
  await entered.promise
  const cancelled = await manager.cancel(operation.id)
  expect(cancelled.phase).toBe('cancelled'); expect(cancelled.logs.map(log => log.text)).toEqual(['abcdefghij'])
  const frames = []
  for await (const frame of manager.follow(operation.id, 0, new AbortController().signal)) frames.push(frame)
  expect(frames).toHaveLength(1); expect(frames[0]?.gap).toBe(true)
})

it('recovers an unfinished durable operation without rerunning its installer', async () => {
  const { manager, configure, plan, directory, options, execute } = await fixture()
  await configure(); const preview = await plan()
  const operation = await settled(manager, await manager.apply(preview.id, preview.digest, 'recovery', []))
  await manager.close()
  const content = toolInstallationLedgerSchema.parse(JSON.parse(await readFile(join(directory, 'ledger.json'), 'utf8')))
  const storedOperation = content.operations[operation.id]!
  storedOperation.phase = 'installing'; delete storedOperation.result
  await writeFile(join(directory, 'ledger.json'), JSON.stringify(content))
  const restarted = new SecurityToolInstallations(new Context(), options); cleanups.push(() => restarted.close())
  expect((await restarted.get(operation.id)).phase).toBe('interrupted'); expect(execute).toHaveBeenCalledTimes(1)
})

it('allows secondary Hosts to read while rejecting competing writes', async () => {
  const { manager, configure, directory } = await fixture(); await configure()
  const reader = await ToolInstallationStore.open(directory); cleanups.push(() => reader.close())
  expect(reader.writable).toBe(false); expect((await reader.read()).root.toolRoot).toBe((await manager.root()).toolRoot)
  await expect(reader.update(() => {})).rejects.toMatchObject({ code: 'busy' })
})

it('removes only a marked generation after checking all recorded selection references', async () => {
  const { manager, configure, plan, options, root } = await fixture()
  await configure(); const preview = await plan()
  await settled(manager, await manager.apply(preview.id, preview.digest, 'owned', []))
  const receipt = (await manager.list()).installations[0]!
  const references: string[][] = []
  options.isInstallationInUse = async (_location?: string, selectionIds?: readonly string[]) => {
    references.push([...(selectionIds ?? [])]); return true
  }
  await expect(manager.previewRemoval(receipt.id)).rejects.toMatchObject({ code: 'busy' })
  expect(references[0]).toEqual([join(root, 'selection.json')])
  options.isInstallationInUse = async () => false
  const removal = await manager.previewRemoval(receipt.id)
  await expect(manager.apply(removal.id, removal.digest, 'cleanup', [])).rejects.toMatchObject({ code: 'confirmation-required' })
  const operation = await settled(manager, await manager.apply(removal.id, removal.digest, 'cleanup', ['remove-owned']))
  expect(operation.phase).toBe('completed'); expect((await manager.list()).installations).toEqual([])
  await expect(readFile(join(receipt.location, '.dsh-tool-installation.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reconciles verified installations without reacquiring or reinstalling them', async () => {
  const { manager, configure, plan, state, executor, execute } = await fixture()
  executor.reconcile = async (_plan, operation) => operation.result ?? null
  await configure(); const preview = await plan(); state.commitFailure = true
  const installed = await settled(manager, await manager.apply(preview.id, preview.digest, 'unbound', []))
  state.commitFailure = false
  expect((await settled(manager, await manager.reconcile(installed.id))).phase).toBe('completed')
  expect(execute).toHaveBeenCalledTimes(1)
})

it('registers adoption before publication and keeps removal admission behind that commit', async () => {
  const { manager, configure, plan, options, root } = await fixture()
  await configure(); const preview = await plan()
  const installed = await settled(manager, await manager.apply(preview.id, preview.digest, 'existing', []))
  const receipt = (await manager.list()).installations[0]!, removal = await manager.previewRemoval(receipt.id)
  options.selectionId = join(root, 'another-project.json')
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const adoption = manager.withExistingSelection(installed.result!.pins.sample!, async () => {
    entered.resolve(undefined); await release.promise
  })
  await entered.promise
  const stored = toolInstallationLedgerSchema.parse(JSON.parse(await readFile(join(options.directory, 'ledger.json'), 'utf8')))
  expect(stored.selectionIds).toContain(options.selectionId)
  const deleting = manager.apply(removal.id, removal.digest, 'remove-existing', ['remove-owned'])
  expect((await manager.list()).operations).toHaveLength(1)
  release.resolve(undefined); await adoption
  expect((await settled(manager, await deleting)).phase).toBe('completed')
})

it('does not initialize a global ledger when a standalone selection uses an external tool', async () => {
  const { root } = await fixture(), directory = join(root, 'unused-home')
  const publish = vi.fn(async () => 'saved')
  expect(await withExistingToolSelection(directory, join(root, 'external.json'),
    [{ command: 'external-python', prefixArgs: [] }], publish)).toBe('saved')
  expect(publish).toHaveBeenCalledTimes(1)
  await expect(readFile(join(directory, 'ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('stops further mutations and reports an uncertain outcome if terminal persistence fails', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const { manager, configure, plan } = await fixture({ execute: async () => {
    entered.resolve(undefined); await release.promise
    return { installations: [], pins: {}, checks: [] }
  } })
  await configure(); const preview = await plan(), operation = await manager.apply(preview.id, preview.digest, 'storage', [])
  await entered.promise
  const persist = vi.spyOn(ToolInstallationStore.prototype, 'update').mockRejectedValue(new Error('Fixture storage unavailable'))
  try {
    const completion = settled(manager, operation); release.resolve(undefined)
    expect(await completion).toMatchObject({ phase: 'needs-reconciliation', failure: { code: 'storage-failed' } })
    expect((await manager.root()).writable).toBe(false)
    await expect(manager.apply(preview.id, preview.digest, 'retry', [])).rejects.toMatchObject({ code: 'storage-failed' })
  } finally { persist.mockRestore() }
})
