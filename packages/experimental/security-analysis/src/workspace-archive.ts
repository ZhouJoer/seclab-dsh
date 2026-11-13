/** Synchronize task and native conversation archival, including retries after partial commits. @module */
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { SecurityController } from './workbench/controller.ts'
import type { SecurityJournal } from './workbench/journal.ts'

/** Install archive synchronization for this plugin activation.
 * @param ctx - owner of the workspace listener and cancellation diagnostics.
 * @param ready - initialized task controller.
 * @param getJournal - journal available after initialization.
 * @param pending - owner-drained asynchronous cancellation work.
 * @returns task management operation accepting the caller context for isolated workspace lookup and preserving partial-failure errors.
 */
export function installWorkspaceArchive(ctx: Context, ready: Promise<SecurityController>,
  getJournal: () => SecurityJournal | undefined, pending: Set<Promise<unknown>>): (caller: Context, projectId: string, request: unknown) => Promise<ReturnType<SecurityController['projects']>> {
  const archiveRequest = new AsyncLocalStorage<{ projectId: string; input: unknown }>()
  ctx.inject(['workspaceRegistry'], (scope) => {
    scope.on('workspace/session-archive-change', async (request, next) => {
      const controller = await ready
      const journal = getJournal()
      assert(journal, 'Initialized workbench requires its journal')
      const carried = archiveRequest.getStore()
      const binding = journal.view().records.find(item => item.kind === 'binding' && item.value.sessionId === request.sessionId)
      const project = carried ? controller.projects(true).find(item => item.id === carried.projectId)
        : controller.projects(true).find(item => binding?.kind === 'binding' && item.id === binding.value.engagementId
          && (item.mainSessionId ?? journal.mainSession(item.id)) === request.sessionId)
      if (!project) return next()
      if (controller.mainSession(project.id) !== request.sessionId) throw new Error('Primary conversation changed; reload the task')
      const input = carried?.input ?? { operationId: randomUUID(), expectedRevision: journal.view().revision,
        action: { kind: request.archived ? 'archive' : 'restore' } }
      if (carried) {
        const parsed = z.object({ operationId: z.string(), expectedRevision: z.number(),
          action: z.object({ kind: z.enum(['archive', 'restore']) }).strict() }).strict().parse(input)
        if (journal.replay(parsed.operationId, { projectId: project.id, request: parsed })
          && Boolean(project.archived) !== request.archived) {
          throw new RemoteError('security/archive-superseded', 'A newer task action replaced this request; reload the task', { projectId: project.id })
        }
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

  return async (caller: Context, projectId: string, request: unknown) => {
    const controller = await ready
    const archive = z.object({ operationId: z.string().trim().min(1), expectedRevision: z.number().int().nonnegative(),
      action: z.object({ kind: z.enum(['archive', 'restore']) }).strict() }).strict().safeParse(request)
    const workspaces = caller.get('workspaceRegistry')
    if (archive.success && workspaces) {
      const sessionId = controller.mainSession(projectId)
      if (!sessionId) throw new Error('Task has no primary conversation; reload the task')
      await archiveRequest.run({ projectId, input: archive.data }, async () => {
        const id = brandString<SessionId>(sessionId)
        if (archive.data.action.kind === 'archive') await workspaces.archiveSession(id, { stopActivity: true })
        else await workspaces.unarchiveSession(id)
      })
      return controller.projects(true)
    } else return controller.manageProject(projectId, request)
  }
}
