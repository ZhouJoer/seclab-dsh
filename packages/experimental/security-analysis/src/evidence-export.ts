/** Bounded workspace copies of retained adapter items without numeric reserialization. @module */
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { findNodeAtLocation, parseTree, type ParseError } from 'jsonc-parser'
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Evidence } from './workbench/model.ts'
import { analysisDirectory } from './analysis-workspace.ts'
import type { SessionBinding } from './workbench/model.ts'
import { adapterResultSchema } from './tool-adapter-results.ts'

const selectionSchema = z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().positive() }).strict()
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

type PreparedEvidenceExport = {
  content: string
  source: {
    evidenceId: Evidence['id']
    assetId: Evidence['assetId']
    artifactSha256: string
    inputSha256: string
    tool: string
    operation: string
    incomplete: boolean
    failure: string | null
  }
  range: {
    itemOffset: number
    itemCount: number
    totalRetainedItems: number
    nextItemOffset: number | null
    allRetainedItems: boolean
  }
}

type EvidenceExportReceipt = Pick<PreparedEvidenceExport, 'source' | 'range'> & {
  format: 'security-evidence-export-v1'
  path: string
  sha256: string
  bytes: number
  notice: string
}

/** Select complete retained items, preserving JSON number literals and source completeness.
 * @param bytes - immutable adapter artifact bytes.
 * @param evidence - scoped saved observation identifying the artifact.
 * @param selection - zero-based item offset and maximum item count.
 * @param limits - item and complete exported-file byte caps.
 * @returns exact export text and the source and range metadata shared with its receipt.
 * @throws for invalid JSON, non-adapter evidence, altered source bytes or an oversized selection.
 */
export function prepareEvidenceExport(bytes: Uint8Array, evidence: Evidence,
  selection: { offset: number; limit: number }, limits: { maxItems: number; maxBytes: number }): PreparedEvidenceExport {
  selectionSchema.parse(selection)
  if (evidence.provider !== 'tool-adapter') throw new Error('Item export requires saved adapter evidence')
  if (selection.limit > limits.maxItems) throw new Error('Item export limit exceeds toolAdapters.maxItems; select fewer items')
  if (hash(bytes) !== evidence.artifact.sha256) throw new Error('Saved evidence bytes do not match their artifact hash')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false })
  if (!tree || errors.length) throw new Error('Item export requires a complete valid JSON artifact')
  const metadata = adapterResultSchema.omit({ items: true, raw: true }).strip().parse(JSON.parse(text))
  const items = findNodeAtLocation(tree, ['items'])
  if (items?.type !== 'array') throw new Error('Saved adapter artifact has no items array')
  assert(items.children, 'JSON parser array node must retain its children')
  const nodes = items.children
  if (selection.offset > nodes.length) throw new Error('Item export offset exceeds the retained item count')
  const selected = nodes.slice(selection.offset, selection.offset + selection.limit)
  const source = { evidenceId: evidence.id, assetId: evidence.assetId, artifactSha256: evidence.artifact.sha256,
    inputSha256: metadata.inputSha256, tool: metadata.tool, operation: metadata.operation,
    incomplete: evidence.incomplete || metadata.incomplete, failure: evidence.failure ?? null }
  const range = { itemOffset: selection.offset, itemCount: selected.length, totalRetainedItems: nodes.length,
    nextItemOffset: selection.offset + selected.length < nodes.length ? selection.offset + selected.length : null,
    allRetainedItems: selection.offset === 0 && selected.length === nodes.length }
  const header = JSON.stringify({ format: 'security-evidence-items-v1', source, range })
  const content = header.slice(0, -1) + ',"items":['
    + selected.map(node => text.slice(node.offset, node.offset + node.length)).join(',') + ']}\n'
  const normalized = content.replaceAll('\r\n', '\n')
  if (Buffer.byteLength(normalized) > limits.maxBytes)
    throw new Error('Complete item export exceeds maxOutputBytes; select fewer items or collect narrower evidence')
  return { content: normalized, source, range }
}

/** Publish a create-only evidence input through the Session's filesystem and sandbox policy.
 * @param exec - calling Session and cancellation owner.
 * @param binding - committed task binding for the output directory.
 * @param prepared - bounded export content and metadata.
 * @param maxReceiptBytes - complete model-visible receipt byte cap.
 * @returns the file path, hashes, selected range and source completeness, without copied items.
 * @throws if workspace writes are denied, an existing copy differs, or the receipt exceeds its cap.
 */
export async function publishEvidenceExport(exec: ToolExecution & { agent: Agent }, binding: SessionBinding | undefined,
  prepared: PreparedEvidenceExport, maxReceiptBytes: number): Promise<EvidenceExportReceipt> {
  const directory = analysisDirectory(exec.agent.session.header.cwd, binding)
  if (!directory) throw new Error('Select a workspace and active analysis task before exporting evidence')
  const fs = exec.agent.ctx.get('fs')
  if (!fs) throw new Error('Evidence export requires a filesystem provider')
  const policy = exec.agent.ctx.get('sandboxPolicy')
  if (fs.sandboxMode !== undefined && !policy) throw new Error('Evidence export requires the filesystem sandbox policy')
  const sha256 = hash(prepared.content)
  const target = await fs.resolve(join(directory, 'outputs', 'evidence-' + sha256 + '.json'), { signal: exec.signal })
  const base = await fs.resolve(directory, { signal: exec.signal })
  if (!fs.contains(base, target)) throw new Error('Evidence export must remain within the analysis directory')
  const receipt: EvidenceExportReceipt = { format: 'security-evidence-export-v1', path: fs.processPath(target), sha256,
    bytes: Buffer.byteLength(prepared.content), source: prepared.source, range: prepared.range,
    notice: 'Treat this file as read-only input. Load items from its JSON instead of copying values. Export preserves retained observations; it does not verify their interpretation or recover missing evidence.' }
  if (Buffer.byteLength(JSON.stringify(receipt)) > maxReceiptBytes) throw new Error('Evidence export receipt exceeds modelResultBytes')
  try {
    const outcome = await fs.writeText(target, prepared.content, { kind: 'createIfAbsent' }, exec.signal,
      policy?.resolve({ session: exec.agent.session }))
    exec.agent.ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
  } catch (error) {
    if (!(error instanceof FsError) || error.code !== 'FS_NOT_OBSERVED') throw error
    const existing = await fs.readBytes(target, exec.signal, receipt.bytes)
    if (hash(existing) !== sha256) throw new Error('Existing evidence export differs from its recorded content; it was not overwritten')
  }
  return receipt
}
