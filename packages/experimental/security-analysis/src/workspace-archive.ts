/** Synchronize task and native conversation archival, including retries after partial commits. @module */
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { SecurityController } from './workbench/controller.ts'
import { primaryProjectId, type SecurityJournal } from './workbench/journal.ts'

/** Task edits synchronized with the primary conversation's archive state. */
export const archiveRequestSchema = z.object({ operationId: z.string().trim().min(1), expectedRevision: z.number().int().nonnegative(),
  action: z.object({ kind: z.enum(['archive', 'restore']) }).strict() }).strict()
type ArchiveRequest = { projectId: string; input: z.infer<typeof archiveRequestSchema> }

/** Install archive synchronization for this plugin activation.
 * @param ctx - owner of the workspace listener and cancellation diagnostics.
 * @param ready - initialized task controller.
 * @param getJournal - journal available after initialization.
 * @param pending - owner-drained asynchronous cancellation work.
 * @returns request context carrying the operator's revision and retry ID into the native archive event.
 */
export function installWorkspaceArchive(ctx: Context, ready: Promise<SecurityController>,
  getJournal: () => SecurityJournal | undefined, pending: Set<Promise<unknown>>): AsyncLocalStorage<ArchiveRequest> {
  const archiveRequest = new AsyncLocalStorage<ArchiveRequest>()
  ctx.inject(['workspaceRegistry'], (scope) => {
    scope.on('workspace/session-archive-change', async (request, next) => {
      const controller = await ready
      const journal = getJournal()
      assert(journal, 'Initialized workbench requires its journal')
      const carried = archiveRequest.getStore()
      const view = journal.view()
      const id = carried?.projectId ?? primaryProjectId(journal, view, request.sessionId)
      const record = view.records.find(item => item.kind === 'engagement' && item.value.id === id)
      if (record?.kind !== 'engagement') return next()
      const project = record.value
      if (carried && controller.mainSession(project.id) !== request.sessionId) throw new Error('Primary conversation changed; reload the task')
      const input = carried?.input ?? { operationId: randomUUID(), expectedRevision: view.revision,
        action: { kind: request.archived ? 'archive' : 'restore' } }
      if (carried && journal.hasCommitted(carried.input.operationId, { projectId: project.id, request: carried.input })
        && Boolean(project.archived) !== request.archived) {
        throw new RemoteError('security/archive-superseded', 'A newer task action replaced this request; reload the task', { projectId: project.id })
      }
      if (carried || Boolean(project.archived) !== request.archived) {
        await controller.manageProject(project.id, input, (settled) => {
          const observed = settled.catch((error: unknown) => { ctx.logger.warn('Security cancellation failed: %s', String(error)) })
          pending.add(observed)
          void observed.finally(() => { pending.delete(observed) })
        })
      }
      try { await next() }
      catch (cause) {
        throw new RemoteError('security/archive-sync-incomplete', 'Task state was saved; conversation synchronization failed. Retry the same action.',
          { projectId: project.id, taskArchived: request.archived,
            sessionArchived: scope.workspaceRegistry.archivedSessionIds.includes(request.sessionId) }, { cause })
      }
    })
  })

  return archiveRequest
}
