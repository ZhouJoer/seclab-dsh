/** Browser-safe validation and deterministic rendering of operator task declarations. @module */
import { z } from 'zod'

const text = z.string().trim().min(1)
/** User statements are not verified authorization or execution approval. */
export const taskContextSchema = z.object({
  authorization: z.object({
    basis: text,
    scope: text,
    allowedActions: text,
    restrictions: text,
    expiresAt: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  background: z.string().trim().optional(),
}).strict()

/** Structured user declaration copied from workspace defaults into a task. */
export type TaskContext = z.infer<typeof taskContextSchema>

/** Render data without interpolation; an absent context explicitly supersedes earlier declarations.
 * @param context - current task snapshot, or absence after removal.
 * @param now - current epoch milliseconds used only to classify expiry.
 * @returns complete model-facing snapshot, with stable ordering and escaped field contents.
 */
export function renderTaskContext(context: TaskContext | undefined, now: number): string {
  const authorization = context?.authorization
  return 'This snapshot replaces earlier task declarations; absent or expired authorization cannot be relied on. Registered scope, delegated roles and execution approvals still apply.\n'
    + JSON.stringify({
      authorizationStatus: authorization ? authorization.expiresAt !== undefined && now >= authorization.expiresAt ? 'expired' : 'declared' : 'absent',
      authorization: authorization ? {
        basis: authorization.basis, scope: authorization.scope,
        allowedActions: authorization.allowedActions, restrictions: authorization.restrictions,
        ...(authorization.expiresAt === undefined ? {} : { expiresAt: authorization.expiresAt }),
      } : null,
      background: context?.background || null,
    })
}

/** Measure the exact UTF-8 model input without a tokenizer or model call.
 * @param text - rendered model input.
 * @returns number of UTF-8 bytes.
 */
export function taskContextBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** Validate and normalize operator input without discarding scope or restrictions.
 * @param input - untrusted saved or submitted task context; null clears it.
 * @param maxBytes - deployment limit for the complete rendered snapshot in either expiry state.
 * @returns detached normalized context, or absence for empty input.
 * @throws Invalid fields or an oversized snapshot.
 */
export function resolveTaskContext(input: unknown, maxBytes: number): TaskContext | undefined {
  if (input === undefined || input === null) return undefined
  const parsed = taskContextSchema.parse(input)
  const context = {
    ...(parsed.authorization ? { authorization: parsed.authorization } : {}),
    ...(parsed.background ? { background: parsed.background } : {}),
  }
  if (!context.authorization && !context.background) return undefined
  const size = Math.max(taskContextBytes(renderTaskContext(context, 0)),
    taskContextBytes(renderTaskContext(context, Number.MAX_SAFE_INTEGER)))
  if (size > maxBytes) throw new Error(`Task context exceeds ${String(maxBytes)} UTF-8 bytes; shorten the fields without removing required restrictions`)
  return context
}
