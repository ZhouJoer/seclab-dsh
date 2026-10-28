/** Lossless UTF-8 editing classification. @module */
import type { ResearchFile } from './types.ts'

/** Decode without normalizing BOM or line endings.
 * @param bytes - complete file bytes.
 * @returns text and reasons an editor must remain read-only. */
export function decodeResearchText(bytes: Uint8Array): Pick<ResearchFile, 'text' | 'bom' | 'newline' | 'writable' | 'reason'> {
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch (_error) {
    // Invalid UTF-8 remains an inspectable byte preview, never editable text.
    return { text: [...bytes.subarray(0, 256)].map(byte => byte.toString(16).padStart(2, '0')).join(' '), bom, newline: 'lf', writable: false, reason: 'encoding' }
  }
  const crlf = text.includes('\r\n')
  const rest = text.replaceAll('\r\n', '')
  const mixed = rest.includes('\r') || (crlf && rest.includes('\n'))
  const reason = text.includes('\0') ? 'binary' : mixed ? 'mixed' : null
  return { text, bom, newline: mixed ? 'mixed' : crlf ? 'crlf' : 'lf', writable: reason === null, reason }
}
