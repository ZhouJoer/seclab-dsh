/** Resolve report references from committed native observations, without filesystem reads. @module */
import { relative, resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Citation } from './workbench/model.ts'
import { analysisLog } from './analysis-log.ts'

/** Fixed bytes and quality of one already observed source window or tool interaction. */
export interface ResolvedCitation {
  callId: string
  resultSeq: number
  title: string
  bytes: Buffer
  incomplete: boolean
  workspaceRoot?: string
  citation?: { path: string; startLine: number; endLine: number; text: string; resultSeq: number }
}
const readMeta = z.object({ path: z.string(), lines: z.array(z.object({ number: z.number().int(), text: z.string() })),
  truncatedLines: z.array(z.number().int()).optional() })
/** Select a single committed observation; paths are compared without consulting today's files.
 * @param events - persisted events of the authorized Session.
 * @param inherited - inherited prefix excluded from local observations.
 * @param cwd - recorded Session working directory.
 * @param reference - requested source window or native call.
 * @returns fixed original evidence, with explicit uncertainty for older read metadata.
 */
export function resolveCitation(events: readonly SessionEvent[], inherited: number, cwd: string | undefined,
  reference: Citation): ResolvedCitation {
  if (reference.kind === 'tool') {
    const selected = analysisLog(events, inherited, [reference.callId])
    const result = selected.find(event => event.type === 'tool/result' && event.data.message.toolCallId === reference.callId)
    if (!result) throw new Error('Tool citation has no committed result')
    return { callId: reference.callId, resultSeq: result.seq, title: 'Native analysis output',
      bytes: Buffer.from(JSON.stringify(selected)), incomplete: true }
  }
  if (reference.endLine < reference.startLine || !cwd) throw new Error('Source citation requires a working directory and an ordered line range')
  const target = resolve(cwd, reference.path)
  const calls = new Map(events.filter(event => event.type === 'tool/call').filter(event => event.seq >= inherited)
    .map(event => [event.data.callId, event]))
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool/result' || event.seq < inherited || event.data.message.isError) continue
    const call = calls.get(event.data.message.toolCallId)
    if (!call || call.data.name !== 'read' || (reference.callId && reference.callId !== call.data.callId)) continue
    const parsed = readMeta.safeParse(event.data.meta)
    if (!parsed.success || resolve(parsed.data.path) !== target) continue
    const lines = parsed.data.lines.filter(line => line.number >= reference.startLine && line.number <= reference.endLine)
    if (lines.length !== reference.endLine - reference.startLine + 1 ||
      lines.some((line, index) => line.number !== reference.startLine + index)) continue
    if (parsed.data.truncatedLines?.some(line => line >= reference.startLine && line <= reference.endLine))
      throw new Error('Source citation contains truncated lines; read an untruncated observation first')
    const path = relative(cwd, target)
    if (path === '..' || path.startsWith('..\\') || path.startsWith('../') || isAbsolute(path))
      throw new Error('Source citation is outside the recorded workspace')
    const citation = { path: path.replaceAll('\\', '/'), startLine: reference.startLine, endLine: reference.endLine,
      text: lines.map(line => line.text).join('\n'), resultSeq: event.seq }
    return { callId: call.data.callId, resultSeq: event.seq, title: `${citation.path}:${citation.startLine}-${citation.endLine}`,
      workspaceRoot: cwd, bytes: Buffer.from(JSON.stringify(citation)), incomplete: parsed.data.truncatedLines === undefined, citation }
  }
  throw new Error('No committed read covers this source citation; read the requested lines first')
}
