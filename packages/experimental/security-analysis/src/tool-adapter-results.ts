/** Retained adapter observations and byte-bounded evidence pages. @module */
import { z } from 'zod'
import { windowsStatusDiagnostic } from '@deepseek-ai/dsh-subprocess'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ProcessResult } from './workbench/process.ts'

/** Versioned artifact payload, independent of Session and activity record formats. */
export const adapterResultSchema = z.object({ format: z.literal('security-tool-result-v1'),
  tool: z.string(), operation: z.string(), environmentId: z.string(), toolVersion: z.string(), inputSha256: z.string(),
  items: z.array(z.json()), incomplete: z.boolean(), diagnostics: z.string(), raw: z.json(),
}).strict()
/** Parsed retained adapter output. */
export type AdapterResult = z.infer<typeof adapterResultSchema>

/** Fit the complete artifact, including raw diagnostics, within its collection budget.
 * @param result - normalized observations and original process output.
 * @param maxBytes - complete artifact byte limit.
 * @returns retained JSON bytes and their completeness.
 */
export function retainAdapterResult(result: AdapterResult, maxBytes: number): { bytes: Buffer; incomplete: boolean } {
  const retained = structuredClone(result)
  let bytes = Buffer.from(JSON.stringify(retained))
  while (bytes.length > maxBytes && retained.items.length) {
    retained.items.pop(); retained.incomplete = true
    bytes = Buffer.from(JSON.stringify(retained))
  }
  if (bytes.length > maxBytes) {
    const text = JSON.stringify(retained.raw)
    retained.raw = { truncated: true, preview: text.slice(0, Math.floor(maxBytes / 8)) }
    retained.diagnostics = retained.diagnostics.slice(0, Math.floor(maxBytes / 8))
    retained.incomplete = true
    bytes = Buffer.from(JSON.stringify(retained))
  }
  if (bytes.length > maxBytes) throw new Error('Adapter metadata exceeds the artifact budget')
  return { bytes, incomplete: retained.incomplete }
}

/** Select structured evidence items without executing the tool again.
 * @param bytes - saved adapter artifact.
 * @param evidenceId - scoped evidence reference.
 * @param offset - first item.
 * @param limit - requested item count.
 * @param maxBytes - complete response byte limit.
 * @returns a bounded page with an item continuation, or an oversized-item diagnostic.
 */
export function adapterResultPage(bytes: Uint8Array, evidenceId: string, offset: number, limit: number, maxBytes: number): JsonValue {
  z.number().int().nonnegative().parse(offset)
  z.number().int().positive().parse(limit)
  const result = adapterResultSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
  if (offset > result.items.length) throw new Error('Item offset exceeds the retained result')
  const page = { evidenceId, tool: result.tool, operation: result.operation, incomplete: result.incomplete,
    summary: result.tool + ': ' + String(result.items.length) + ' retained observations',
    total: result.items.length, items: [] as JsonValue[], nextItemOffset: offset < result.items.length ? offset : null,
    detail: 'Read raw evidence by byte offset for complete retained output and diagnostics.' }
  for (const item of result.items.slice(offset, offset + limit)) {
    page.items.push(item)
    page.nextItemOffset = offset + page.items.length < result.items.length ? offset + page.items.length : null
    if (Buffer.byteLength(JSON.stringify(page)) > maxBytes) {
      page.items.pop(); page.nextItemOffset = offset + page.items.length
      if (!page.items.length) page.detail = 'This item exceeds the response budget. Read raw evidence by byte offset and length.'
      break
    }
  }
  if (Buffer.byteLength(JSON.stringify(page)) > maxBytes) throw new Error('Evidence page metadata exceeds the response budget')
  return page
}

/** Preserve independent subprocess termination facts in adapter diagnostics.
 * @param result - settled process observations.
 * @returns failure message, if execution did not complete.
 */
export function adapterProcessFailure(result: ProcessResult): string | undefined {
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.cancelled)
    return JSON.stringify({ exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled,
      diagnostic: windowsStatusDiagnostic(result.exitCode) })
  return undefined
}
