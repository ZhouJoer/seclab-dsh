/** Serialized project commits with recoverable permanent deletion over storage-domain. @module */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { recordSchema, type SecurityRecord, type WorkbenchView } from './model.ts'

const commitSchema = z
  .object({
    revision: z.number().int().positive(),
    operationId: z.string().min(1),
    fingerprint: z.string(),
    records: z.array(recordSchema),
    purge: z.object({ projectId: z.string().min(1),
      artifacts: z.array(z.string().regex(/^[a-f0-9]{64}$/u)), pending: z.boolean() }).strict().optional(),
  })
  .strict()
/** One opened journal owns a serialized command queue. */
export interface SecurityJournal {
  /** @returns the current committed snapshot. */
  view(): WorkbenchView
  /** Read historical task bindings without reviving or granting authority to Sessions. */
  sessionProjects(): Map<string, Set<string>>
  /** Read the coordinator recorded at project creation.
   * @param projectId - project identity.
   * @returns original coordinator, including inactive bindings. */
  mainSession(projectId: string): string | undefined
  /** Subscribe to any committed task change; disposal removes the listener. */
  subscribeAll(listener: () => void): () => void
  /** Subscribe to successful project commits; the returned disposer removes the listener. */
  subscribe(project: string, listener: () => void): () => void
  /** Subscribe to committed selection changes for one Session; disposal removes the listener. */
  subscribeSelection(session: string, listener: () => void): () => void
  /** Check an operation's retry identity.
   * @param operationId - stable command identity.
   * @param input - complete command used to detect changed retries.
   * @returns whether the same command committed; different input for the same ID throws. */
  hasCommitted(operationId: string, input: unknown): boolean
  /**
   * Commit one command atomically as one domain record.
   * @param operationId - caller's stable retry identity.
   * @param expectedRevision - observed global revision, optionally checking only the named project and Session selection.
   * @param input - complete command used to detect changed retries.
   * @param produce - validate against the latest snapshot and produce changed records.
   * @returns the committed snapshot; exact retries do not execute produce again.
   */
  commit(
    operationId: string,
    expectedRevision: number | { revision: number; projectId: string; sessionId: string } | undefined,
    input: unknown,
    produce: (view: WorkbenchView) => Promise<SecurityRecord[]> | SecurityRecord[],
  ): Promise<WorkbenchView>
  /** Permanently remove an archived project and scrub its historical records.
   * @param operationId - stable deletion retry identity.
   * @param expectedRevision - revision displayed at confirmation.
   * @param projectId - archived project to remove.
   * @param plan - collect unshared artifact digests before deleting any content.
   * @returns completion after the history is scrubbed; cleanup digests remain until acknowledged. */
  purge(operationId: string, expectedRevision: number, projectId: string,
    plan: (removed: SecurityRecord[], retained: SecurityRecord[]) => Promise<string[]>): Promise<void>
  /** @returns durable deletions still requiring file and activity cleanup. */
  pendingPurges(): { projectId: string; artifacts: string[] }[]
  /** Acknowledge completed file and activity cleanup.
   * @param projectId - deleted project.
   * @returns completion after cleanup metadata is cleared. */
  finishPurge(projectId: string): Promise<void>
  /** @returns completion after accepted commands settle and storage closes. */
  close(): Promise<void>
}
/** Resolve a primary coordinator without activating an archived binding.
 * @param journal - Source of the project's original coordinator.
 * @param view - Current journal snapshot.
 * @param sessionId - Current or archived conversation.
 * @returns the bound project's ID when this conversation is its primary coordinator.
 */
export function primaryProjectId(journal: SecurityJournal, view: WorkbenchView, sessionId: string): string | undefined {
  const binding = view.records.find(item => item.kind === 'binding' && item.value.sessionId === sessionId)
  if (binding?.kind === 'binding' && journal.mainSession(binding.value.engagementId) === sessionId) return binding.value.engagementId
}

/**
 * Open the security journal; another host must not share its storage root.
 * @param ctx - context providing storage-domain.
 * @returns the opened journal with reconstructed state.
 */
export async function openSecurityJournal(ctx: Context): Promise<SecurityJournal> {
  const domain = await ctx.storageDomain.open(
    defineDomain({
      name: 'security_workbench',
      version: 1,
      tables: { commits: domainTable(commitSchema) },
    }),
  )
  const table = domain.table('commits')
  const records = new Map<string, SecurityRecord>()
  const operations = new Map<string, string>()
  const listeners = new Map<string, Set<() => void>>()
  const allListeners = new Set<() => void>()
  const selections = new Map<string, Set<() => void>>()
  const projectRevisions = new Map<string, number>()
  const selectionRevisions = new Map<string, number>()
  let revision = 0
  let chain = Promise.resolve()
  let closing: Promise<void> | undefined
  const projectOf = (item: SecurityRecord) => item.kind === 'engagement' ? item.value.id : item.value.engagementId
  const apply = (commit: z.infer<typeof commitSchema>, items = commit.records) => {
    revision = commit.revision
    operations.set(commit.operationId, commit.fingerprint)
    for (const item of items) {
      const key = item.kind === 'binding' ? item.value.sessionId : item.value.id
      records.set(item.kind + ':' + key, item)
      projectRevisions.set(projectOf(item), revision)
      if (item.kind === 'binding') selectionRevisions.set(item.value.sessionId, revision)
    }
  }
  const scrub = async () => {
    const deleted = new Set([...table.entries()].flatMap(([, commit]) => commit.purge ? [commit.purge.projectId] : []))
    for (const [key, item] of records) if (deleted.has(projectOf(item))) records.delete(key)
    for (const [key, commit] of table.entries()) {
      const kept = commit.records.filter(item => !deleted.has(projectOf(item)))
      if (kept.length !== commit.records.length) await table.put(key, { ...commit, records: kept })
    }
  }
  try {
    const commits = [...table.entries()].sort((a, b) => a[1].revision - b[1].revision)
    for (const [key, commit] of commits) {
      if (commit.revision !== revision + 1 || key !== String(commit.revision) || operations.has(commit.operationId)) {
        throw new Error('Invalid security journal sequence or duplicate operation')
      }
      apply(commit)
    }
    await scrub()
  } catch (error) {
    await domain.close()
    throw error
  }
  const view = (): WorkbenchView => ({ revision, records: structuredClone([...records.values()]) })
  const fingerprintOf = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
  function matchesCommit(operationId: string, fingerprint: string): boolean {
    const previous = operations.get(operationId)
    if (previous === undefined) return false
    if (previous !== fingerprint) throw new Error('operationId was already used for different input')
    return true
  }
  function enqueue<T>(write: () => Promise<T>) {
    const pending = chain.then(write)
    chain = pending.then(() => {}, () => {})
    return pending
  }
  function queueOperation<T>(operationId: string, input: unknown,
    replay: () => T | Promise<T>, write: (fingerprint: string) => Promise<T>) {
    if (closing) return Promise.reject(new Error('Security journal is closing'))
    const fingerprint = fingerprintOf(input)
    return enqueue(async () => {
      if (!operationId.trim()) throw new Error('operationId is required')
      return matchesCommit(operationId, fingerprint) ? replay() : write(fingerprint)
    })
  }
  function publish(changed: SecurityRecord[], projects: Iterable<string>) {
    const notify = (kind: string, group?: Set<() => void>) => {
      for (const listener of group ?? []) {
        try { listener() } catch (error) { ctx.logger.warn('Security %s subscriber failed: %s', kind, String(error)) }
      }
    }
    notify('directory', allListeners)
    for (const item of changed) if (item.kind === 'binding') notify('selection', selections.get(item.value.sessionId))
    for (const id of projects) notify('project', listeners.get(id))
  }
  function mainSession(projectId: string): string | undefined {
    const project = records.get('engagement:' + projectId)
    if (project?.kind !== 'engagement') return undefined
    if (project.value.mainSessionId) return project.value.mainSessionId
    const commits = [...table.entries()].map(([, commit]) => commit).sort((a, b) => a.revision - b.revision)
    for (const commit of commits) {
      if (!commit.records.some(record => record.kind === 'engagement' && record.value.id === projectId)) continue
      const binding = commit.records.find(record => record.kind === 'binding'
        && record.value.engagementId === projectId && record.value.role === 'coordinator')
      if (binding?.kind === 'binding') return binding.value.sessionId
    }
    return undefined
  }
  return {
    view,
    mainSession,
    sessionProjects() {
      const result = new Map<string, Set<string>>()
      for (const [, commit] of table.entries()) for (const record of commit.records) {
        if (record.kind !== 'binding') continue
        const projects = result.get(record.value.sessionId) ?? new Set<string>()
        projects.add(record.value.engagementId); result.set(record.value.sessionId, projects)
      }
      return result
    },
    subscribeAll(listener) { allListeners.add(listener); return () => { allListeners.delete(listener) } },
    subscribe(project, listener) {
      const group = listeners.get(project) ?? new Set<() => void>()
      group.add(listener); listeners.set(project, group)
      return () => { group.delete(listener); if (!group.size) listeners.delete(project) }
    },
    subscribeSelection(session, listener) {
      const group = selections.get(session) ?? new Set<() => void>()
      group.add(listener); selections.set(session, group)
      return () => { group.delete(listener); if (!group.size) selections.delete(session) }
    },
    hasCommitted(operationId, input) {
      return operations.has(operationId) && matchesCommit(operationId, fingerprintOf(input))
    },
    commit(operationId, expectedRevision, input, produce) {
      return queueOperation(operationId, input, view, async (fingerprint) => {
        if (expectedRevision !== undefined) {
          const observed = typeof expectedRevision === 'number' ? expectedRevision : expectedRevision.revision
          const changedAt = typeof expectedRevision === 'number' ? revision
            : Math.max(projectRevisions.get(expectedRevision.projectId) ?? 0,
              selectionRevisions.get(expectedRevision.sessionId) ?? 0)
          if (observed < changedAt || observed > revision)
            throw new Error('Security state changed; reload before retrying')
        }
        const changed = z
          .array(recordSchema)
          .min(1)
          .parse(await produce(view()))
        const commit = commitSchema.parse({ revision: revision + 1, operationId, fingerprint, records: changed })
        await table.put(String(commit.revision), commit)
        apply(commit, changed)
        publish(changed, new Set(changed.map(projectOf)))
        return view()
      })
    },
    purge(operationId, expectedRevision, projectId, plan) {
      return queueOperation(operationId, { projectId, purge: true }, scrub, async (fingerprint) => {
        if (revision !== expectedRevision) throw new Error('Security state changed; reload before retrying')
        const project = records.get('engagement:' + projectId)
        if (project?.kind !== 'engagement') throw new Error('Unknown project')
        if (!project.value.archived) throw new Error('Delete the task before permanently deleting it')
        if ([...records.values()].some(item => item.kind === 'laboratory' && item.value.engagementId === projectId && item.value.state !== 'stopped'))
          throw new Error('Stop or reset owned laboratories before permanently deleting the task')
        const history = [...table.entries()].flatMap(([, commit]) => commit.records)
        const artifacts = await plan(history.filter(item => projectOf(item) === projectId),
          history.filter(item => projectOf(item) !== projectId))
        const commit = commitSchema.parse({ revision: revision + 1, operationId, fingerprint, records: [],
          purge: { projectId, artifacts, pending: true } })
        await table.put(String(commit.revision), commit)
        apply(commit)
        const sessions = [...records.values()].filter(item => item.kind === 'binding' && item.value.engagementId === projectId)
        await scrub()
        publish(sessions, [projectId])
      })
    },
    pendingPurges() {
      return [...table.entries()].flatMap(([, commit]) => commit.purge?.pending
        ? [{ projectId: commit.purge.projectId, artifacts: [...commit.purge.artifacts] }] : [])
    },
    finishPurge(projectId) {
      if (closing !== undefined) return Promise.reject(new Error('Security journal is closing'))
      return enqueue(async () => {
        for (const [key, commit] of table.entries()) if (commit.purge?.projectId === projectId && commit.purge.pending)
          await table.put(key, { ...commit, purge: { projectId, artifacts: [], pending: false } })
      })
    },
    close() {
      allListeners.clear()
      listeners.clear()
      selections.clear()
      closing ??= chain.then(() => domain.close())
      return closing
    },
  }
}
