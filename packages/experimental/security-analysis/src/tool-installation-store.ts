/** Home-owned installation ledger with exclusive writer ownership and validated recovery. @module */
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { brandString } from '@deepseek-ai/dsh-brand'
import { toolInstallationOperationIdSchema, toolInstallationPlanIdSchema, toolInstallationRequestIdSchema,
  toolInstallationRequestSchema, toolInstallationPhaseSchema, ToolInstallationError } from './tool-installation-types.ts'
import type { ManagedToolInstallation, ManagedToolInstallationId, ToolInstallationExecutionResult,
  ToolInstallationOperation, ToolInstallationPlan } from './tool-installation-types.ts'
import type { SecurityToolPin } from './local-tools.ts'

const textMap = z.record(z.string(), z.string())
const check = z.object({ id: z.string(), status: z.enum(['passed', 'failed', 'unknown']), detail: z.string() }).strict()
const receipt = z.object({ toolId: z.string(), version: z.string(), location: z.string(),
  ownership: z.enum(['managed', 'system', 'external']), metadata: textMap.optional() }).strict()
const pin = z.object({ command: z.string().min(1), prefixArgs: z.array(z.string()), versionArgs: z.array(z.string()),
  temporaryDirectory: z.string().min(1).optional() }).strict()
const environment = z.object({ id: z.string(), kind: z.enum(['local', 'docker', 'android']), label: z.string(), cwd: z.string(),
  deviceId: z.string().optional(), image: z.string().optional(),
  externalContainer: z.object({ name: z.string(), workdir: z.string() }).strict().optional(),
  tools: z.array(z.object({ id: z.string(), command: z.string(), prefixArgs: z.array(z.string()).optional(),
    temporaryDirectory: z.string().min(1).optional(),
    versionArgs: z.array(z.string()), source: z.string() }).strict()),
  discovery: z.object({ searchDirs: z.array(z.string()) }).strict().optional(),
  resolvedImageId: z.string().optional(), containerId: z.string().optional(), exchangeRoot: z.string().optional(),
  webTarget: z.object({ origin: z.string(), instanceId: z.string(), networkId: z.string(), address: z.string(),
    laboratoryId: z.string(), target: z.string(), targetImageId: z.string() }).strict().optional(),
  manifest: z.object({ recipe: z.string(), imageId: z.string(), tools: textMap, templates: textMap }).strict().optional(),
}).strict()
/** Persisted executor output, including observations retained when binding fails. */
export const toolInstallationExecutionResultSchema = z.object({ installations: z.array(receipt),
  pins: z.record(z.string(), pin), environment: environment.optional(), checks: z.array(check),
}).strict().transform(value => value as ToolInstallationExecutionResult)
/** Complete reviewed plans are retained so recovery never reconstructs commands from log text. */
export const toolInstallationPlanSchema = z.object({
  id: toolInstallationPlanIdSchema, digest: z.string(), createdAt: z.number().int().nonnegative(),
  toolRoot: z.string().min(1), rootRevision: z.number().int().nonnegative(), configurationRevision: z.string(),
  environment, request: toolInstallationRequestSchema,
  recipeId: z.string().min(1), recipeVersion: z.string().min(1), toolIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(['private', 'managed-container', 'external-container', 'system-component', 'manual']),
  version: z.string(), destination: z.string(),
  steps: z.array(z.object({ id: z.string(), kind: z.enum(['download', 'extract', 'process', 'verify', 'publish', 'manual']),
    description: z.string(), command: z.string().optional(), args: z.array(z.string()).optional(),
    cwd: z.string().optional(), url: z.string().optional(), sha256: z.string().optional(), destination: z.string().optional(),
  }).strict()),
  confirmations: z.array(z.object({ id: z.string(), description: z.string() }).strict()),
  warnings: z.array(z.string()), data: z.record(z.string(), z.json()),
}).strict().transform(value => value as ToolInstallationPlan)
/** Durable operation validation keeps incomplete and unknown outcomes distinct. */
export const toolInstallationOperationSchema = z.object({
  id: toolInstallationOperationIdSchema, requestId: toolInstallationRequestIdSchema,
  planId: toolInstallationPlanIdSchema, planDigest: z.string(), environmentId: z.string(), recipeId: z.string(),
  toolRoot: z.string(), phase: toolInstallationPhaseSchema, createdAt: z.number(), updatedAt: z.number(),
  cursor: z.number().int().nonnegative(),
  logs: z.array(z.object({ cursor: z.number().int().positive(), at: z.number(), channel: z.enum(['stdout', 'stderr', 'manager']), text: z.string() }).strict()),
  logsTruncated: z.boolean(), result: toolInstallationExecutionResultSchema.optional(),
  failure: z.object({ code: z.enum(['unconfigured-root', 'stale-plan', 'busy', 'invalid-request', 'confirmation-required', 'unsupported',
    'execution-failed', 'cancelled', 'configuration-conflict', 'outcome-unknown', 'storage-failed']), detail: z.string() }).strict().optional(),
}).strict().transform(value => value as ToolInstallationOperation)
const managedInstallation = receipt.extend({
  id: z.string().min(1).transform(brandString<ManagedToolInstallationId>), operationId: toolInstallationOperationIdSchema,
  root: z.string(), recipeId: z.string(), installedAt: z.number(),
}).strict().transform(value => value as ManagedToolInstallation)
/** Versioned home ledger; root selection is separate from every project's tool bindings. */
export const toolInstallationLedgerSchema = z.object({ version: z.literal(1),
  root: z.object({ toolRoot: z.string().nullable(), revision: z.number().int().nonnegative() }).strict(),
  plans: z.record(z.string(), toolInstallationPlanSchema), operations: z.record(z.string(), toolInstallationOperationSchema),
  installations: z.record(z.string(), managedInstallation),
  selectionIds: z.array(z.string().min(1)),
}).strict()
/** Authoritative installation state shared by projects using one Harness home. */
export type ToolInstallationLedger = z.infer<typeof toolInstallationLedgerSchema>

type SelectionPin = Pick<SecurityToolPin, 'command' | 'prefixArgs'>
function referencesOwnedInstallation(ledger: ToolInstallationLedger, pins: SelectionPin | readonly SelectionPin[]): boolean {
  const selections = 'command' in pins ? [pins] : pins
  return Object.values(ledger.installations).some(installation => installation.ownership === 'managed' &&
    selections.flatMap(pin => [pin.command, ...pin.prefixArgs]).some((value) => {
      if (!isAbsolute(value)) return false
      const path = relative(installation.location, resolve(value))
      return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
    }))
}

/** Register a configuration consumer before publishing a selection of an already managed tool.
 * @param store - current writer-owned shared ledger.
 * @param selectionId - absolute project configuration filename.
 * @param pin - selected executable and launcher dependencies.
 * @param publish - selection commit, completed while the caller retains its management admission.
 * @returns the selection commit result.
 */
export async function registerExistingToolSelection<T>(store: ToolInstallationStore, selectionId: string,
  pin: SelectionPin | readonly SelectionPin[], publish: () => Promise<T>): Promise<T> {
  const ledger = await store.read()
  if (!referencesOwnedInstallation(ledger, pin)) return publish()
  await store.update((state) => { if (!state.selectionIds.includes(selectionId)) state.selectionIds.push(selectionId) })
  return publish()
}

/** Adopt a managed installation from a standalone operator command without creating an unused home ledger.
 * @param directory - fixed home management directory.
 * @param selectionId - absolute project configuration filename.
 * @param pin - selected executable and launcher dependencies.
 * @param publish - configuration commit protected by writer ownership.
 * @returns the selection commit result; an absent ledger contributes no side effects.
 */
export async function withExistingToolSelection<T>(directory: string, selectionId: string,
  pin: SelectionPin | readonly SelectionPin[], publish: () => Promise<T>): Promise<T> {
  let input: string
  try { input = await readFile(join(directory, 'ledger.json'), 'utf8') }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return publish()
    throw error
  }
  const ledger = toolInstallationLedgerSchema.parse(JSON.parse(input))
  if (!referencesOwnedInstallation(ledger, pin)) return publish()
  const store = await ToolInstallationStore.open(directory)
  try { return await registerExistingToolSelection(store, selectionId, pin, publish) }
  finally { await store.close() }
}

/** Exclusive writers serialize atomic commits; other Hosts can read current durable snapshots. */
export class ToolInstallationStore {
  private chain: Promise<void> = Promise.resolve()
  private closed = false
  private accepting = true
  private closing: Promise<void> | undefined
  private constructor(readonly directory: string, private readonly owner: DatabaseSync | undefined) {}
  /** Acquire the home's single-writer lock, retaining read access when another Host owns it.
   * @param directory - absolute home-owned management directory.
   * @returns initialized ledger handle.
   */
  static async open(directory: string): Promise<ToolInstallationStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const owner = new DatabaseSync(join(directory, 'owner.sqlite'))
    let writer: DatabaseSync | undefined = owner
    try { owner.exec('BEGIN EXCLUSIVE') }
    catch (error) {
      owner.close()
      if (!(error instanceof Error) || !('errcode' in error) || error.errcode !== 5) throw error
      writer = undefined
    }
    const store = new ToolInstallationStore(directory, writer)
    try { await store.read(); return store }
    catch (error) { await store.close(); throw error }
  }
  /** Whether this Host owns publication; readers never take ownership from a live Host. */
  get writable(): boolean { return this.owner !== undefined && this.accepting }
  /** Read freshly validated state, including commits by another Host.
   * @returns the current durable snapshot.
   */
  async read(): Promise<ToolInstallationLedger> {
    if (this.closed) throw new ToolInstallationError('busy', 'Tool installation manager is closed')
    let content: string
    try { content = await readFile(join(this.directory, 'ledger.json'), 'utf8') }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      return { version: 1, root: { toolRoot: null, revision: 0 }, plans: {}, operations: {}, installations: {}, selectionIds: [] }
    }
    return toolInstallationLedgerSchema.parse(JSON.parse(content))
  }
  /** Publish one complete change after earlier writes settle; a failure preserves the prior ledger.
   * @param change - synchronous mutation of a private freshly read snapshot.
   * @returns the committed snapshot.
   */
  update(change: (ledger: ToolInstallationLedger) => void): Promise<ToolInstallationLedger> {
    if (!this.writable) return Promise.reject(new ToolInstallationError('busy', 'Another Host owns tool installation management; use that Host or close it first'))
    const write = this.chain.then(async () => {
      const next = await this.read()
      change(next)
      const validated = toolInstallationLedgerSchema.parse(next)
      await writeFileAtomic(join(this.directory, 'ledger.json'), JSON.stringify(validated) + '\n', { mode: 0o600, dirMode: 0o700 })
      return validated
    })
    this.chain = write.then(() => {}, () => {})
    return write
  }
  /** Drain accepted writes before releasing the global management lock.
   * @returns completion after writer ownership is released.
   */
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.accepting = false
    this.closing = this.chain.then(() => { this.closed = true; this.owner?.close() })
    return this.closing
  }
}
