/** Task skill reads derived from committed logs, excluding inherited fork events. @module */
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'

/** Observable skill exposure and reads; neither establishes compliance or causal attribution. */
export interface SecuritySkillUsage {
  name: string
  sessionId: string
  contentSha256: string | null
  available: boolean
  modelReads: number
  explicitReads: number
  failedReads: number
  sequences: number[]
}
/** Incomplete historical logs remain distinguishable from tasks that read no skills. */
export interface SecuritySkillUsagePage {
  items: SecuritySkillUsage[]
  unavailableSessions: string[]
  unattributedReads: number
}
const sourceSchema = z.object({ kind: z.string(), name: z.string().optional(), projectId: z.string().nullable().optional(),
  entries: z.array(z.object({ name: z.string() })).optional() })

/** Fold a captured log once; call IDs pair reads with their committed outcome.
 * @param events - immutable events from one observed Session.
 * @param inherited - prefix owned by another Session, excluded from counts.
 * @param sessionId - source Session identity for UI drill-down.
 * @param projectId - task being inspected.
 * @param soleProject - historical binding when the Session belonged to exactly one task.
 * @returns counts and unassignable reads, never inferred skill-to-tool causality.
 */
export function projectSkillUsage(events: readonly SessionEvent[], inherited: number, sessionId: string,
  projectId: string, soleProject?: string): Pick<SecuritySkillUsagePage, 'items' | 'unattributedReads'> {
  const rows = new Map<string, SecuritySkillUsage>()
  const calls = new Map<string, { name: string; project: string | null | undefined; seq: number }>()
  let project: string | null | undefined = soleProject
  let unattributedReads = 0
  const row = (name: string, hash: string | null) => {
    const key = JSON.stringify([name, hash])
    let value = rows.get(key)
    if (!value) {
      value = { name, sessionId, contentSha256: hash, available: false, modelReads: 0, explicitReads: 0, failedReads: 0, sequences: [] }
      rows.set(key, value)
    }
    return value
  }
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const settled = new Set<string>()
  for (const event of events) {
    if (event.type === 'user/message') {
      const source = sourceSchema.safeParse(event.data.source)
      if (!source.success) continue
      if (source.data.kind === 'security-task-context') project = source.data.projectId
      if (event.seq < inherited) continue
      if (source.data.kind === 'skill-catalog' && project === projectId)
        for (const entry of source.data.entries ?? []) row(entry.name, null).available = true
      if (source.data.kind === 'skill-invocation' && source.data.name) {
        if (project === undefined) unattributedReads++
        if (project !== projectId) continue
        const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
        const value = row(source.data.name, hash(text))
        value.explicitReads++; value.sequences.push(event.seq)
      }
    }
    if (event.seq < inherited) continue
    if (event.type === 'tool/call' && event.data.name === 'skill') {
      let args: unknown
      try { args = JSON.parse(event.data.arguments) }
      catch (error) { if (error instanceof SyntaxError) continue; throw error }
      const parsed = z.object({ name: z.string() }).safeParse(args)
      if (parsed.success) calls.set(event.data.callId, { name: parsed.data.name, project, seq: event.seq })
    }
    if (event.type !== 'tool/result' || settled.has(event.data.message.toolCallId)) continue
    const call = calls.get(event.data.message.toolCallId)
    if (!call) continue
    settled.add(event.data.message.toolCallId)
    if (call.project === undefined) unattributedReads++
    if (call.project !== projectId) continue
    const message = event.data.message
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const value = row(call.name, message.isError ? null : hash(text))
    if (message.isError) value.failedReads++
    else value.modelReads++
    value.sequences.push(call.seq)
  }
  const values = [...rows.values()]
  for (const value of values) if (value.contentSha256 !== null)
    value.available = rows.get(JSON.stringify([value.name, null]))?.available ?? false
  return { items: values.filter(value => value.contentSha256 !== null || value.failedReads > 0
    || !values.some(other => other.name === value.name && other.contentSha256 !== null)), unattributedReads }
}
