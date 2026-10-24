/** Durable operator preferences and retry identities for fresh task rounds. @module */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { toolPreferencesSchema, type ToolPreferences } from './tool-definitions.ts'

const restartSchema = z.object({
  sessionId: z.string().min(1).transform(brandString<SessionId>),
  operationId: z.uuid(),
}).strict()
const definition = defineDomain({ name: 'security_task_settings', version: 1, tables: {
  preferences: domainTable(toolPreferencesSchema), restarts: domainTable(restartSchema),
} })

/** Durable settings lifetime owned by the security service. */
export interface TaskSettings {
  /** Preferences restored at service initialization. */
  preferences: Map<SessionId, ToolPreferences>
  /** Save preferences before exposing them to consumers.
   * @param id - owning Session.
   * @param value - validated operator selection.
   * @returns completion after durable storage.
   */
  savePreferences(id: SessionId, value: ToolPreferences): Promise<void>
  /** Reserve or retrieve the destination for a source round.
   * @param id - source Session.
   * @returns stable destination and journal operation identities.
   */
  restart(id: SessionId): Promise<z.infer<typeof restartSchema>>
  /** Flush and release storage after pending operations drain.
   * @returns completion after storage is closed.
   */
  close(): Promise<void>
}

/** Open settings independent of conversation history; the owner closes after pending operations drain.
 * @param ctx - Host storage service.
 * @returns durable preferences and stable restart destinations.
 */
export async function openTaskSettings(ctx: Context): Promise<TaskSettings> {
  const domain = await ctx.storageDomain.open(definition)
  const preferences = domain.table('preferences')
  const restarts = domain.table('restarts')
  return {
    preferences: new Map([...preferences.entries()].map(([id, value]) => [brandString<SessionId>(id), value])),
    async savePreferences(id: SessionId, value: ToolPreferences): Promise<void> {
      await preferences.put(id, toolPreferencesSchema.parse(value))
    },
    async restart(id: SessionId): Promise<z.infer<typeof restartSchema>> {
      const previous = restarts.get(id)
      if (previous) return previous
      const value = restartSchema.parse({ sessionId: 'session-' + randomUUID(), operationId: randomUUID() })
      await restarts.put(id, value)
      return value
    },
    close: () => domain.close(),
  }
}
