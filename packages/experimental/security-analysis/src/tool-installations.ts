/** Operator-owned installation lifecycle, shared receipts and project selection commits. @module */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { toolInstallationRecipes, type ToolInstallationRecipeSummary } from './tool-installation-recipes.ts'
import { ToolInstallationStore, toolInstallationExecutionResultSchema, toolInstallationPlanSchema,
  registerExistingToolSelection, withExistingToolSelection } from './tool-installation-store.ts'
import { ToolInstallationError, ToolInstallationOutcomeUnknownError, toolInstallationRequestSchema,
  toolInstallationRequestIdSchema, toolInstallationOperationIdSchema, toolInstallationPlanIdSchema } from './tool-installation-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'
import type { SecurityToolPin } from './local-tools.ts'
import type { ManagedToolInstallation, ManagedToolInstallationId, ToolInstallationExecutionContext, ToolInstallationExecutionResult,
  ToolInstallationExecutor, ToolInstallationFailure, ToolInstallationFrame, ToolInstallationOperation, ToolInstallationOperationId,
  ToolInstallationPhase, ToolInstallationPlan, ToolInstallationPlanId, ToolInstallationRequest, ToolInstallationRoot } from './tool-installation-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { securityToolInstallations: SecurityToolInstallations }
}

/** Host composition supplies project configuration ownership and environment execution leases. */
export interface SecurityToolInstallationsOptions {
  /** Fixed home-owned management directory, independent of profile storage remapping. */
  directory: string
  executor: ToolInstallationExecutor
  maxLogBytes: number
  maxLogChunks: number
  /** Stable project selection file identity recorded before each publication attempt. */
  selectionId: string
  /** All recorded project references must be readable and free of selections under this location. */
  isInstallationInUse?(location: string, selectionIds: readonly string[]): Promise<boolean>
  /** Hold every selection file lock while rechecking references and removing the unused generation. */
  withUnusedInstallation?<T>(location: string, selectionIds: readonly string[], remove: () => Promise<T>): Promise<T>
  /** Capture the selected environment and the revision of all configuration affected by commit. */
  snapshot(environmentId: string): Promise<{ environment: SecurityEnvironment; configurationRevision: string }>
  /** Hold the same lease used by analysis and environment operations until the callback settles. */
  withEnvironment<T>(environmentId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T>
  /** Compare the reviewed revision and atomically publish verified selections. */
  commit(plan: ToolInstallationPlan, result: ToolInstallationExecutionResult): Promise<void>
}

const runningPhases = new Set<ToolInstallationPhase>(['planned', 'preparing', 'installing', 'verifying', 'committing', 'cancelling'])
const uncertainPhases = new Set<ToolInstallationPhase>(['interrupted', 'needs-reconciliation', 'installed-unbound'])
const detail = (error: unknown): string => error instanceof Error ? error.message : String(error)
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const digest = (plan: ToolInstallationPlan): string => createHash('sha256').update(JSON.stringify({ ...plan, digest: '' })).digest('hex')
const contains = (root: string, child: string): boolean => {
  const path = relative(root, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Installs only immutable confirmed plans; a failed selection commit never erases installed output. */
export class SecurityToolInstallations extends TypertRemoteService {
  private readonly lifecycle: { ready?: Promise<ToolInstallationStore> } = {}
  private readonly shutdown = new AbortController()
  private readonly active = new Map<ToolInstallationOperationId, { controller: AbortController; done: Promise<void>; removing: boolean }>()
  private readonly listeners = new Set<() => void>()
  private readonly publicationFailures = new Map<ToolInstallationOperationId, ToolInstallationFailure>()
  private admissions: Promise<void> = Promise.resolve()
  private closing: Promise<void> | undefined

  constructor(ctx: Context, private readonly options: SecurityToolInstallationsOptions) {
    super(ctx, 'securityToolInstallations')
    if (!isAbsolute(options.directory)) throw new Error('Tool installation management directory must be absolute')
    for (const value of [options.maxLogBytes, options.maxLogChunks])
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Tool installation output limits must be positive integers')
    ctx.effect(() => () => this.close())
  }

  private get ready(): Promise<ToolInstallationStore> {
    if (!this.lifecycle.ready) {
      if (this.shutdown.signal.aborted) return Promise.reject(new ToolInstallationError('busy', 'Tool installation manager is closed'))
      this.lifecycle.ready = this.initialize()
    }
    return this.lifecycle.ready
  }

  private async initialize(): Promise<ToolInstallationStore> {
    const store = await ToolInstallationStore.open(this.options.directory)
    if (!store.writable) return store
    try {
      await store.update((ledger) => {
        for (const operation of Object.values(ledger.operations)) if (runningPhases.has(operation.phase)) {
          operation.phase = operation.result ? 'needs-reconciliation' : 'interrupted'
          operation.failure = { code: 'outcome-unknown', detail: 'The previous Host stopped before this operation settled. Reconcile its state before retrying.' }
          operation.updatedAt = Date.now(); operation.cursor++
        }
      })
      return store
    } catch (error) { await store.close(); throw error }
  }

  private admit<T>(run: () => Promise<T>): Promise<T> {
    if (this.shutdown.signal.aborted) return Promise.reject(new ToolInstallationError('busy', 'Tool installation manager is shutting down'))
    const result = this.admissions.then(() => {
      if (this.publicationFailures.size) throw new ToolInstallationError('storage-failed', 'Installation state could not be saved. Resolve storage access and restart this Host before making changes.')
      return run()
    })
    this.admissions = result.then(() => {}, () => {})
    return result
  }
  private notify(): void { for (const listener of this.listeners) listener() }
  private async update(id: ToolInstallationOperationId,
    change: (operation: ToolInstallationOperation) => void): Promise<ToolInstallationOperation> {
    const store = await this.ready
    const ledger = await store.update((state) => {
      const operation = state.operations[id]
      if (!operation) throw new ToolInstallationError('invalid-request', 'Unknown installation operation')
      change(operation); operation.updatedAt = Date.now(); operation.cursor++
    })
    this.notify()
    const operation = ledger.operations[id]
    if (!operation) throw new ToolInstallationError('invalid-request', 'Unknown installation operation')
    return operation
  }

  /** List implemented installation recipes without probing or changing the Host.
   * @returns explicit platform and environment choices for the operator picker.
   */
  @Remote
  recipes(): ToolInstallationRecipeSummary[] { return toolInstallationRecipes() }

  /** Read the shared installation root and this Host's writer availability.
   * @returns persisted root selection and manager availability.
   */
  @Remote
  async root(): Promise<ToolInstallationRoot> {
    const store = await this.ready, ledger = await store.read()
    return { ...ledger.root, writable: store.writable && this.publicationFailures.size === 0,
      detail: this.publicationFailures.size ? 'Installation state could not be saved. Resolve storage access and restart this Host.'
        : store.writable ? '' : 'Another Host owns installation management. Use that Host or close it first.' }
  }

  /** Select the root for future installations; existing receipts and directories remain unchanged.
   * @param directory - explicitly selected absolute Host directory.
   * @param expectedRevision - root revision last displayed to the operator.
   * @returns committed canonical root selection.
   */
  @Remote
  setRoot(directory: string, expectedRevision: number): Promise<ToolInstallationRoot> {
    return this.admit(async () => {
      z.number().int().nonnegative().parse(expectedRevision)
      if (!isAbsolute(directory) || directory.includes('\0')) throw new ToolInstallationError('invalid-request', 'Select an absolute installation directory')
      const store = await this.ready
      if (this.active.size) throw new ToolInstallationError('busy', 'Wait for active installations before changing the root')
      if (!store.writable) throw new ToolInstallationError('busy', 'Another Host owns installation management')
      const before = await store.read()
      if (before.root.revision !== expectedRevision) throw new ToolInstallationError('stale-plan', 'The installation root changed; refresh before saving')
      await mkdir(directory, { recursive: true }); const canonical = await realpath(directory)
      await access(canonical, constants.W_OK)
      await store.update((ledger) => {
        if (ledger.root.revision !== expectedRevision) throw new ToolInstallationError('stale-plan', 'The installation root changed')
        if (ledger.root.toolRoot !== canonical) ledger.root = { toolRoot: canonical, revision: expectedRevision + 1 }
      })
      return this.root()
    })
  }

  /** Resolve a recipe preview without changing selected tools; metadata resolution may use disposable containers and downloads.
   * @param request - registered recipe, environment, action and recipe options.
   * @returns exact immutable commands, sources, destinations and required confirmations.
   */
  @Remote
  async preview(request: ToolInstallationRequest): Promise<ToolInstallationPlan> {
    const parsed = toolInstallationRequestSchema.parse(request), store = await this.ready
    if (this.publicationFailures.size) throw new ToolInstallationError('storage-failed', 'Resolve installation storage access and restart this Host before previewing changes')
    if (parsed.action === 'remove-owned') throw new ToolInstallationError('invalid-request', 'Use previewRemoval to select a recorded owned installation')
    const ledger = await store.read()
    if (!ledger.root.toolRoot) throw new ToolInstallationError('unconfigured-root', 'Choose an installation root before previewing an installation')
    if (!store.writable) throw new ToolInstallationError('busy', 'Another Host owns installation management')
    const snapshot = await this.options.snapshot(parsed.environmentId)
    const recipe = await this.options.executor.preview(parsed, { toolRoot: ledger.root.toolRoot,
      environment: structuredClone(snapshot.environment), signal: this.shutdown.signal })
    const plan = toolInstallationPlanSchema.parse({ ...recipe, id: brandString<ToolInstallationPlanId>(randomUUID()), digest: '',
      createdAt: Date.now(), toolRoot: ledger.root.toolRoot, rootRevision: ledger.root.revision,
      configurationRevision: snapshot.configurationRevision, environment: snapshot.environment, request: parsed })
    if (plan.recipeId !== parsed.recipeId) throw new ToolInstallationError('invalid-request', 'The recipe returned a different installation identity')
    if (plan.mode === 'private' && !contains(plan.toolRoot, resolve(plan.destination)))
      throw new ToolInstallationError('invalid-request', 'Private tool programs must be installed below the selected root')
    if (plan.mode === 'external-container' && !plan.confirmations.some(item => item.id === 'external-container'))
      throw new ToolInstallationError('invalid-request', 'External container changes require a separate confirmation')
    if (plan.mode === 'system-component' && !plan.confirmations.some(item => item.id === 'system-component'))
      throw new ToolInstallationError('invalid-request', 'System component changes require a separate confirmation')
    plan.digest = digest(plan)
    await store.update((state) => {
      if (state.root.revision !== plan.rootRevision) throw new ToolInstallationError('stale-plan', 'The installation root changed during preview')
      state.plans[plan.id] = plan
    })
    return structuredClone(plan)
  }

  /** Start one confirmed stored plan; replaying the same request returns the same operation.
   * @param planId - stored preview identity.
   * @param expectedDigest - digest of the complete preview displayed for confirmation.
   * @param requestId - caller-generated idempotency identity, retained across connection retries.
   * @param confirmations - every explicit exception accepted by the operator.
   * @returns durable operation; follow observes asynchronous progress.
   */
  @Remote
  apply(planId: ToolInstallationPlanId, expectedDigest: string, requestId: string,
    confirmations: string[]): Promise<ToolInstallationOperation> {
    return this.admit(async () => {
      const id = toolInstallationPlanIdSchema.parse(planId), key = toolInstallationRequestIdSchema.parse(requestId)
      z.array(z.string()).parse(confirmations)
      const store = await this.ready, ledger = await store.read()
      const existing = Object.values(ledger.operations).find(operation => operation.requestId === key)
      if (existing) {
        if (existing.planId !== id || existing.planDigest !== expectedDigest) throw new ToolInstallationError('invalid-request', 'This request identity already belongs to another plan')
        return existing
      }
      const plan = ledger.plans[id]
      if (!plan || plan.digest !== expectedDigest || digest(plan) !== expectedDigest) throw new ToolInstallationError('stale-plan', 'The installation preview is missing or changed; create a new preview')
      if (plan.mode === 'manual') throw new ToolInstallationError('unsupported', 'This tool requires the manual setup instructions in its preview')
      if (plan.rootRevision !== ledger.root.revision || plan.toolRoot !== ledger.root.toolRoot) throw new ToolInstallationError('stale-plan', 'The installation root changed; create a new preview')
      if (plan.confirmations.some(item => !confirmations.includes(item.id))) throw new ToolInstallationError('confirmation-required', 'Confirm each installation exception before applying this plan')
      const snapshot = await this.options.snapshot(plan.request.environmentId)
      if (snapshot.configurationRevision !== plan.configurationRevision
        || canonicalJson(snapshot.environment) !== canonicalJson(plan.environment))
        throw new ToolInstallationError('stale-plan', 'Environment or tool selections changed; create a new preview')
      if (this.active.size) throw new ToolInstallationError('busy', 'Another tool installation is running')
      if (plan.request.action !== 'remove-owned' && Object.values(ledger.operations).some(operation => uncertainPhases.has(operation.phase) &&
        operation.environmentId === plan.request.environmentId && (operation.recipeId === plan.recipeId ||
          ['external-container', 'system-component'].includes(ledger.plans[operation.planId]?.mode ?? ''))))
        throw new ToolInstallationError('busy', 'Reconcile the previous operation for this recipe before starting another')
      const now = Date.now(), operation: ToolInstallationOperation = { id: brandString<ToolInstallationOperationId>(randomUUID()),
        requestId: key, planId: plan.id, planDigest: plan.digest, environmentId: plan.request.environmentId,
        recipeId: plan.recipeId, toolRoot: plan.toolRoot, phase: 'planned', createdAt: now, updatedAt: now, cursor: 0, logs: [], logsTruncated: false }
      await store.update((state) => { state.operations[operation.id] = operation })
      this.start(operation, plan, false)
      return operation
    })
  }

  private start(operation: ToolInstallationOperation, plan: ToolInstallationPlan, reconcile: boolean): void {
    const controller = new AbortController()
    const active = { controller, done: Promise.resolve(), removing: plan.request.action === 'remove-owned' }
    this.active.set(operation.id, active)
    active.done = this.run(operation, plan, controller.signal, reconcile).catch((error: unknown) => {
      this.publicationFailures.set(operation.id, { code: 'storage-failed', detail: 'The operation stopped, but its outcome could not be saved. Resolve storage access and restart the Host to reconcile it. ' + detail(error) })
      this.ctx.logger('security-tool-installations').error('Could not persist installation outcome: %s', detail(error))
    }).finally(() => { this.active.delete(operation.id); this.notify() })
    this.notify()
  }

  private executionContext(id: ToolInstallationOperationId, signal: AbortSignal): ToolInstallationExecutionContext {
    return { signal, phase: async (phase) => {
      await this.update(id, (operation) => { if (operation.phase !== 'cancelling') operation.phase = phase })
    }, log: async (channel, text) => {
      if (!text) return
      const bytes = Buffer.from(text), truncated = bytes.length > this.options.maxLogBytes
      const bounded = truncated ? bytes.subarray(bytes.length - this.options.maxLogBytes).toString('utf8') : text
      await this.update(id, (operation) => {
        operation.logs.push({ cursor: operation.cursor + 1, at: Date.now(), channel, text: bounded })
        operation.logsTruncated ||= truncated
        while (operation.logs.length > this.options.maxLogChunks
          || operation.logs.reduce((total, item) => total + Buffer.byteLength(item.text), 0) > this.options.maxLogBytes) {
          operation.logs.shift(); operation.logsTruncated = true
        }
      })
    } }
  }

  private async run(operation: ToolInstallationOperation, plan: ToolInstallationPlan,
    requestedSignal: AbortSignal, reconcile: boolean): Promise<void> {
    const progress = { committing: false }
    const lifetime = AbortSignal.any([requestedSignal, this.shutdown.signal])
    let executionSignal = lifetime
    try {
      await this.options.withEnvironment(operation.environmentId, async (leaseSignal) => {
        const signal = AbortSignal.any([lifetime, leaseSignal]), context = this.executionContext(operation.id, signal)
        executionSignal = signal
        signal.throwIfAborted()
        if (!reconcile) {
          const snapshot = await this.options.snapshot(operation.environmentId)
          if (snapshot.configurationRevision !== plan.configurationRevision
            || canonicalJson(snapshot.environment) !== canonicalJson(plan.environment))
            throw new ToolInstallationError('stale-plan', 'Environment or tool selections changed before execution; create a new preview')
        }
        await context.phase('preparing')
        if (plan.request.action === 'remove-owned') {
          if (reconcile) {
            try { await access(plan.destination) }
            catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
              const ids = z.array(z.string()).parse(plan.data.installationIds)
              await (await this.ready).update((ledger) => {
                ledger.installations = Object.fromEntries(Object.entries(ledger.installations).filter(([id]) => !ids.includes(id)))
              })
              await this.update(operation.id, (item) => { item.phase = 'completed'; delete item.failure })
              return
            }
            throw new ToolInstallationOutcomeUnknownError('The generation directory still exists. Preview and confirm removal again to finish cleanup.')
          }
          await this.removeOwned(plan, context)
          await this.update(operation.id, (item) => { item.phase = 'completed'; delete item.failure })
          return
        }
        const observed = reconcile ? await this.options.executor.reconcile?.(plan, operation, context)
          : await this.options.executor.execute(plan, context)
        if (!observed) throw new ToolInstallationOutcomeUnknownError('The installed state could not be established. Inspect the retained logs and environment before retrying.')
        const result = toolInstallationExecutionResultSchema.parse(observed)
        await this.update(operation.id, (item) => { item.result = result })
        if (result.checks.some(check => check.status !== 'passed')) throw new ToolInstallationOutcomeUnknownError('Installation verification is incomplete; selections were not changed')
        signal.throwIfAborted()
        const store = await this.ready
        for (const location of new Set(result.installations.filter(receipt => receipt.ownership === 'managed').map(receipt => receipt.location))) {
          if (!contains(plan.toolRoot, resolve(location)) || await realpath(location) !== resolve(location))
            throw new ToolInstallationError('invalid-request', 'Managed installation directories must be real directories below the selected root')
          const marker = join(location, '.dsh-tool-installation.json')
          const markerValue = { version: 1, operationId: operation.id, root: plan.toolRoot, recipeId: plan.recipeId }
          try { await writeFile(marker, JSON.stringify(markerValue), { flag: 'wx', mode: 0o600 }) }
          catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
            if (canonicalJson(JSON.parse(await readFile(marker, 'utf8'))) !== canonicalJson(markerValue))
              throw new ToolInstallationError('invalid-request', 'The directory belongs to another installation operation')
          }
        }
        await store.update((ledger) => {
          if (!ledger.selectionIds.includes(this.options.selectionId)) ledger.selectionIds.push(this.options.selectionId)
          for (const receipt of result.installations) {
            if (receipt.ownership === 'managed' && !contains(plan.toolRoot, resolve(receipt.location)))
              throw new ToolInstallationError('invalid-request', 'A managed installation is outside its selected root')
            const id = brandString<ManagedToolInstallationId>(`${operation.id}:${receipt.toolId}`)
            ledger.installations[id] = { ...receipt, id, operationId: operation.id, root: plan.toolRoot,
              recipeId: plan.recipeId, installedAt: Date.now() }
          }
        })
        progress.committing = true
        await this.update(operation.id, (item) => { item.phase = 'committing'; delete item.failure })
        await this.options.commit(plan, result)
        await this.update(operation.id, (item) => { item.phase = 'completed' })
      })
    } catch (error) {
      let phase: ToolInstallationPhase = 'failed', failure: ToolInstallationFailure
      if (progress.committing) {
        phase = 'installed-unbound'; failure = { code: 'configuration-conflict', detail: `Tools were installed, but selections were not committed: ${detail(error)}` }
      } else if (error instanceof ToolInstallationOutcomeUnknownError || (executionSignal.aborted && (plan.mode === 'external-container' || plan.mode === 'system-component'))) {
        phase = 'needs-reconciliation'; failure = { code: 'outcome-unknown', detail: detail(error) }
      } else if (executionSignal.aborted) {
        phase = 'cancelled'; failure = { code: 'cancelled', detail: 'Installation cancelled after owned work settled. Partial files may remain in the planned directory.' }
      } else failure = { code: error instanceof ToolInstallationError ? error.code : 'execution-failed', detail: detail(error) }
      await this.update(operation.id, (item) => { item.phase = phase; item.failure = failure })
    }
  }

  /** Read one durable operation, including its retained output and uncertain-outcome diagnosis.
   * @param operationId - operation identity.
   * @returns current durable operation.
   */
  @Remote
  async get(operationId: ToolInstallationOperationId): Promise<ToolInstallationOperation> {
    const id = toolInstallationOperationIdSchema.parse(operationId), store = await this.ready
    const operation = (await store.read()).operations[id]
    if (!operation) throw new ToolInstallationError('invalid-request', 'Unknown installation operation')
    return this.withPublicationFailure(operation)
  }

  /** List shared installations and durable attempts across projects.
   * @returns newest operations first, plus retained installation receipts.
   */
  @Remote
  async list(): Promise<{ operations: ToolInstallationOperation[]; installations: ManagedToolInstallation[] }> {
    const ledger = await (await this.ready).read()
    return { operations: Object.values(ledger.operations)
      .map(operation => this.withPublicationFailure(operation)).sort((a, b) => b.createdAt - a.createdAt),
    installations: Object.values(ledger.installations) }
  }

  private withPublicationFailure(operation: ToolInstallationOperation): ToolInstallationOperation {
    const failure = this.publicationFailures.get(operation.id)
    return failure ? { ...operation, phase: 'needs-reconciliation', failure } : operation
  }

  /** Follow committed progress; a disconnected observer never cancels installation.
   * @param operationId - operation identity.
   * @param afterCursor - last observed durable cursor, or zero for retained history.
   * @param signal - observer connection lifetime.
   * @returns snapshots containing retained chunks newer than the requested cursor.
   */
  @Remote({ mode: 'stream' })
  async *follow(operationId: ToolInstallationOperationId, afterCursor: number, signal: AbortSignal): AsyncIterable<ToolInstallationFrame> {
    z.number().int().nonnegative().parse(afterCursor)
    const store = await this.ready, lifetime = AbortSignal.any([signal, this.shutdown.signal])
    const state = { dirty: true }; let wake = () => {}
    const changed = () => { state.dirty = true; wake() }
    this.listeners.add(changed); lifetime.addEventListener('abort', changed, { once: true })
    try {
      while (!lifetime.aborted) {
        const pending = Promise.withResolvers<void>(); wake = pending.resolve
        if (!state.dirty) { await pending.promise; continue }
        state.dirty = false
        const operation = await this.get(operationId), first = operation.logs[0]?.cursor
        const frame = { operation: { ...operation, logs: operation.logs.filter(log => log.cursor > afterCursor) },
          nextCursor: operation.cursor,
          retainedFromCursor: first ?? operation.cursor + 1,
          gap: operation.logsTruncated && (first === undefined || afterCursor < first - 1) }
        afterCursor = operation.cursor
        yield frame
        if (!store.writable || !runningPhases.has(operation.phase)) return
      }
    } finally { this.listeners.delete(changed); lifetime.removeEventListener('abort', changed) }
  }

  /** Cancel owned execution and wait until its environment lease has been released.
   * @param operationId - active operation identity.
   * @returns settled operation; an atomic selection commit is allowed to finish.
   */
  @Remote
  async cancel(operationId: ToolInstallationOperationId): Promise<ToolInstallationOperation> {
    const operation = await this.get(operationId), active = this.active.get(operation.id)
    if (!active || operation.phase === 'committing') return operation
    const current = await this.update(operation.id, (item) => { if (item.phase !== 'committing') item.phase = 'cancelling' })
    if (current.phase === 'committing') return current
    active.controller.abort(new Error('Installation cancelled by operator'))
    await active.done
    return this.get(operationId)
  }

  /** Inspect an uncertain or unbound attempt without rerunning installation commands.
   * @param operationId - operation requiring reconciliation.
   * @returns durable operation; follow observes the read-only verification and optional CAS commit.
   */
  @Remote
  reconcile(operationId: ToolInstallationOperationId): Promise<ToolInstallationOperation> {
    return this.admit(async () => {
      const operation = await this.get(operationId)
      if (!uncertainPhases.has(operation.phase)) return operation
      if (this.active.size) throw new ToolInstallationError('busy', 'Another tool installation is running')
      const ledger = await (await this.ready).read(), plan = ledger.plans[operation.planId]
      if (!plan) throw new ToolInstallationError('stale-plan', 'The reviewed installation plan is missing')
      if (plan.digest !== operation.planDigest || digest(plan) !== operation.planDigest)
        throw new ToolInstallationError('stale-plan', 'The stored plan differs from the reviewed operation; inspect the installation manually')
      if (!this.options.executor.reconcile && plan.request.action !== 'remove-owned') throw new ToolInstallationError('unsupported', 'This recipe does not support automatic reconciliation; inspect its output and select an existing installation')
      await this.update(operation.id, (item) => { item.phase = 'preparing' })
      this.start(operation, plan, true)
      return this.get(operation.id)
    })
  }

  /** Preview deletion of one whole DSH-owned generation after checking every recorded project reference.
   * @param installationId - receipt identity for the generation to remove.
   * @returns a confirmed-plan preview covering all receipts sharing that generation.
   */
  @Remote
  async previewRemoval(installationId: ManagedToolInstallationId): Promise<ToolInstallationPlan> {
    const store = await this.ready, ledger = await store.read(), installation = ledger.installations[installationId]
    if (!installation || installation.ownership !== 'managed') throw new ToolInstallationError('invalid-request', 'Only recorded DSH-owned installations can be removed')
    const operation = ledger.operations[installation.operationId], original = operation && ledger.plans[operation.planId]
    if (!original) throw new ToolInstallationError('invalid-request', 'The installation ownership record is incomplete')
    await this.checkRemoval(installation, ledger.selectionIds)
    const receipts = Object.values(ledger.installations).filter(item => item.location === installation.location)
    const snapshot = await this.options.snapshot(original.request.environmentId)
    const plan = toolInstallationPlanSchema.parse({ ...original, id: brandString<ToolInstallationPlanId>(randomUUID()), digest: '', createdAt: Date.now(),
      toolRoot: ledger.root.toolRoot, rootRevision: ledger.root.revision,
      configurationRevision: snapshot.configurationRevision, environment: snapshot.environment,
      request: { recipeId: 'owned-cleanup', environmentId: original.request.environmentId, action: 'remove-owned', options: {} },
      recipeId: 'owned-cleanup', recipeVersion: '1', toolIds: receipts.map(item => item.toolId), mode: 'private', destination: installation.location,
      steps: [{ id: 'remove-owned', kind: 'process',
        description: 'Remove the recorded DSH-owned generation directory and its receipts.', destination: installation.location }],
      confirmations: [{ id: 'remove-owned', description: 'Permanently remove this unused DSH-owned generation directory.' }], warnings: [],
      data: { installationIds: receipts.map(item => item.id) } })
    plan.digest = digest(plan)
    await store.update((state) => { state.plans[plan.id] = plan })
    return plan
  }

  private async checkRemoval(installation: ManagedToolInstallation, selectionIds: readonly string[]): Promise<void> {
    if (!this.options.isInstallationInUse || await this.options.isInstallationInUse(installation.location, selectionIds))
      throw new ToolInstallationError('busy', 'A project still selects this installation, or a recorded project selection could not be checked')
    if (installation.ownership !== 'managed' || !contains(installation.root, resolve(installation.location)) ||
      await realpath(installation.root) !== installation.root || await realpath(installation.location) !== resolve(installation.location))
      throw new ToolInstallationError('invalid-request', 'The owned installation directory moved or points outside its recorded root')
    const marker = z.object({ version: z.literal(1), operationId: toolInstallationOperationIdSchema,
      root: z.string(), recipeId: z.string() }).strict()
      .parse(JSON.parse(await readFile(join(installation.location, '.dsh-tool-installation.json'), 'utf8')))
    if (marker.operationId !== installation.operationId || marker.root !== installation.root || marker.recipeId !== installation.recipeId)
      throw new ToolInstallationError('invalid-request', 'The installation ownership marker does not match its receipt')
  }

  private async removeOwned(plan: ToolInstallationPlan, context: ToolInstallationExecutionContext): Promise<void> {
    const ids = z.array(z.string()).min(1).parse(plan.data.installationIds), store = await this.ready, ledger = await store.read()
    if (!this.options.withUnusedInstallation) throw new ToolInstallationError('unsupported', 'Removal requires exclusive access to every recorded project selection')
    await this.options.withUnusedInstallation(plan.destination, ledger.selectionIds, async () => {
      for (const id of ids) {
        const receipt = ledger.installations[id]
        if (!receipt || receipt.location !== plan.destination) throw new ToolInstallationError('stale-plan', 'The removal receipts changed; preview removal again')
        await this.checkRemoval(receipt, ledger.selectionIds)
      }
      context.signal.throwIfAborted()
      await context.phase('installing')
      try { await rm(plan.destination, { recursive: true }) }
      catch (error) { throw new ToolInstallationOutcomeUnknownError(`Removal may be incomplete: ${detail(error)}`) }
      await store.update((state) => {
        state.installations = Object.fromEntries(Object.entries(state.installations).filter(([id]) => !ids.includes(id)))
      })
    })
  }

  /** Register a project's use of an existing managed tool before publishing its selection.
   * @param pin - selected executable and any launcher dependency paths.
   * @param publish - atomic project configuration commit.
   * @returns the committed selection; pending removals reject adoption before publication.
   */
  withExistingSelection<T>(pin: Pick<SecurityToolPin, 'command' | 'prefixArgs'>, publish: () => Promise<T>): Promise<T> {
    return this.admit(async () => {
      if ([...this.active.values()].some(operation => operation.removing)) throw new ToolInstallationError('busy', 'Wait for managed tool removal before selecting an installation')
      if (!this.lifecycle.ready) return withExistingToolSelection(this.options.directory, this.options.selectionId, pin, publish)
      return registerExistingToolSelection(await this.ready, this.options.selectionId, pin, publish)
    })
  }

  /** Drain admitted requests, cancel execution and release writer ownership after all consumers settle.
   * @returns completion after the shared ledger is closed.
   */
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.shutdown.abort(new Error('Tool installation Host is shutting down')); this.notify()
    this.closing = (async () => {
      await this.admissions
      await Promise.all([...this.active.values()].map(operation => operation.done))
      if (this.lifecycle.ready) await (await this.lifecycle.ready).close()
    })()
    return this.closing
  }
}
