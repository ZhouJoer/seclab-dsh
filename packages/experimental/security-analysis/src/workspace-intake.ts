/** Persist operator-selected resources for future tasks in one workspace. @module */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { workspaceKey } from './task-bootstrap.ts'
import { taskContextSchema, resolveTaskContext } from './task-context.ts'
import { moduleSelectionSchema } from './analysis-modules.ts'

const selectionSchema = z.object({
  environmentIds: z.array(z.string().trim().min(1)).refine(ids => new Set(ids).size === ids.length, 'Environment IDs must be unique'),
  maxAttempts: z.number().int().positive(),
  unsealed: z.boolean().optional(),
  moduleSelection: moduleSelectionSchema.optional(),
}).strict()
const recordSchema = selectionSchema.extend({ revision: z.number().int().positive(), taskContext: taskContextSchema.optional() }).strict()
const updateSchema = selectionSchema.extend({ expectedRevision: z.number().int().nonnegative(),
  taskContext: taskContextSchema.nullable().optional() }).strict()
const taskSelectionSchema = selectionSchema.extend({ taskContext: taskContextSchema.optional() }).strict()
const taskRecordSchema = z.object({ revision: z.number().int().positive(), settings: taskSelectionSchema.optional() }).strict()
const taskUpdateSchema = z.object({ expectedRevision: z.number().int().nonnegative(),
  settings: selectionSchema.extend({ taskContext: taskContextSchema.nullable().optional() }).nullable() }).strict()
const workspaceIntakeDomain = defineDomain({
  name: 'security_workspace_intake_v2', version: 2,
  tables: { workspaces: domainTable(recordSchema), tasks: domainTable(taskRecordSchema) },
})

/** An empty environment selection explicitly disables intake for this workspace. */
export type WorkspaceIntakeRecord = z.infer<typeof recordSchema>
/** User-authored resource selection with the revision shown by the configuration UI. */
export type WorkspaceIntakeUpdate = z.infer<typeof updateSchema>
/** Saved first-message override; absence of settings follows workspace defaults. */
export type TaskIntakeRecord = z.infer<typeof taskRecordSchema>

/** Resource selections are independent of existing project permissions and import roots. */
export interface WorkspaceIntakeStore {
  /** @param cwd - absolute Session workspace directory. @returns detached saved selection, or absence when never configured. */
  get(cwd: string): WorkspaceIntakeRecord | undefined
  /**
   * Persist a selection after validating the wire input and configured resources.
   * @param cwd - absolute Session workspace directory resolved by the Host.
   * @param input - resources, attempt limit and revision (zero for first write);
   * omitted task context preserves it, null clears it.
   * @returns detached committed selection with its new revision.
   */
  set(cwd: string, input: unknown): Promise<WorkspaceIntakeRecord>
  /** @param id - destination conversation. @param cwd - its workspace. @returns detached first-message override. */
  task(id: SessionId, cwd: string): TaskIntakeRecord | undefined
  /** Save or clear this conversation's override without changing workspace defaults.
   * @param id - destination conversation.
   * @param cwd - its workspace.
   * @param input - revision and complete settings, or null to restore defaults.
   * @returns durable override revision.
   */
  setTask(id: SessionId, cwd: string, input: unknown): Promise<TaskIntakeRecord>
  /** @returns completion after accepted writes drain and the domain closes; new writes reject immediately. */
  close(): Promise<void>
}

function keyOf(cwd: string): string {
  if (!isAbsolute(cwd)) throw new Error('Workspace resource configuration requires an absolute cwd')
  return workspaceKey(cwd)
}

/**
 * Open durable workspace resource selections without changing project or file access.
 * @param ctx - Host context providing storageDomain.
 * @param configuredEnvironmentIds - deployment resource identities accepted by configuration writes.
 * @param taskContextMaxBytes - maximum complete model-facing task context size.
 * @returns store owned and closed by the caller.
 */
export async function openWorkspaceIntake(ctx: Context, configuredEnvironmentIds: readonly string[],
  taskContextMaxBytes: number): Promise<WorkspaceIntakeStore> {
  const domain = await ctx.storageDomain.open(workspaceIntakeDomain)
  const table = domain.table('workspaces')
  const tasks = domain.table('tasks')
  let writes = Promise.resolve()
  let closing: Promise<void> | undefined
  return {
    get(cwd) {
      return structuredClone(table.get(keyOf(cwd)))
    },
    async set(cwd, input) {
      if (closing !== undefined) throw new Error('Workspace resource configuration is closing')
      const key = keyOf(cwd)
      const update = updateSchema.parse(input)
      for (const id of update.environmentIds)
        if (!configuredEnvironmentIds.includes(id)) throw new Error('Unknown workspace environment: ' + id)
      const pending = writes.then(async () => {
        const current = table.get(key)
        if ((current?.revision ?? 0) !== update.expectedRevision)
          throw new Error('Workspace resource configuration changed; reload before saving')
        const taskContext = resolveTaskContext(update.taskContext === undefined ? current?.taskContext : update.taskContext,
          taskContextMaxBytes)
        const record = recordSchema.parse({ environmentIds: update.environmentIds,
          maxAttempts: update.maxAttempts, revision: update.expectedRevision + 1,
          ...((update.unsealed ?? current?.unsealed) === undefined ? {} : { unsealed: update.unsealed ?? current?.unsealed }),
          ...((update.moduleSelection ?? current?.moduleSelection) === undefined
            ? {} : { moduleSelection: update.moduleSelection ?? current?.moduleSelection }),
          ...(taskContext ? { taskContext } : {}) })
        await table.put(key, record)
        return structuredClone(record)
      })
      writes = pending.then(() => {}, () => {})
      return pending
    },
    task(id, cwd) {
      return structuredClone(tasks.get(JSON.stringify([id, keyOf(cwd)])))
    },
    async setTask(id, cwd, input) {
      if (closing !== undefined) throw new Error('Workspace resource configuration is closing')
      const key = JSON.stringify([id, keyOf(cwd)])
      const update = taskUpdateSchema.parse(input)
      const settings = update.settings
      if (settings) for (const environment of settings.environmentIds)
        if (!configuredEnvironmentIds.includes(environment)) throw new Error('Unknown workspace environment: ' + environment)
      const taskContext = resolveTaskContext(settings?.taskContext, taskContextMaxBytes)
      const pending = writes.then(async () => {
        if ((tasks.get(key)?.revision ?? 0) !== update.expectedRevision)
          throw new Error('Task configuration changed; reload before saving')
        const record = taskRecordSchema.parse({ revision: update.expectedRevision + 1,
          ...(settings ? { settings: { environmentIds: settings.environmentIds, maxAttempts: settings.maxAttempts,
            unsealed: settings.unsealed ?? false, ...(settings.moduleSelection ? { moduleSelection: settings.moduleSelection } : {}),
            ...(taskContext ? { taskContext } : {}) } } : {}) })
        await tasks.put(key, record)
        return structuredClone(record)
      })
      writes = pending.then(() => {}, () => {})
      return pending
    },
    close() {
      closing ??= writes.then(() => domain.close())
      return closing
    },
  }
}
