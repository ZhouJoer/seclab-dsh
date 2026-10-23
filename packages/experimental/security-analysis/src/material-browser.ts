/** Operator-only browsing of project-owned immutable materials. @module */
import { z } from 'zod'
import type { MaterialBrowserView, MaterialEntry } from './material-browser-types.ts'
import type { WorkbenchView } from './workbench/model.ts'
import type { ArtifactStore } from './workbench/artifacts.ts'
import { directoryEntries, isSourceText, sourceManifest } from './workbench/source.ts'

const requestSchema = z.object({
  assetId: z.string().min(1).max(128),
  mode: z.enum(['directory', 'file']),
  path: z.string(),
  offset: z.number().int().nonnegative().default(0),
}).strict()

/** Read a directory page or file without interpreting a path on the live filesystem.
 * @param records - records of the authorized project.
 * @param store - digest-verifying artifact owner.
 * @param input - serialized asset, operation, snapshot path and page offset.
 * @param maxOutputBytes - configured preview and directory response budget.
 * @returns a bounded directory page, text, raster image or binary prefix.
 */
export async function readProjectMaterial(records: WorkbenchView['records'], store: ArtifactStore,
  input: string, maxOutputBytes: number): Promise<MaterialBrowserView> {
  const request = requestSchema.parse(JSON.parse(input))
  const asset = records.find(item => item.kind === 'asset' && item.value.id === request.assetId)
  if (asset?.kind !== 'asset' || !('artifact' in asset.value)) throw new Error('Material is outside the project scope')
  const source = 'kind' in asset.value
    ? await sourceManifest(store, asset.value) : undefined
  if (request.mode === 'directory') {
    if (!source) throw new Error('Material is not a directory snapshot')
    const members: MaterialEntry[] = directoryEntries(source, request.path).flatMap((item): MaterialEntry[] =>
      item.kind === 'file' ? [{ kind: 'file', path: item.path, size: item.artifact.size }]
        : item.kind === 'directory' && item.fileCount ? [{ kind: 'directory', path: item.path, fileCount: item.fileCount }] : [])
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || a.path.localeCompare(b.path))
    const entries: MaterialEntry[] = []
    let bytes = 128
    for (const member of members.slice(request.offset)) {
      const size = Buffer.byteLength(JSON.stringify(member)) + 1
      if (bytes + size > maxOutputBytes) {
        if (!entries.length) throw new Error('One material path exceeds the output budget')
        break
      }
      entries.push(member); bytes += size
      if (entries.length === 100) break
    }
    const next = request.offset + entries.length
    return { kind: 'directory', entries, total: members.length, next: next < members.length ? next : null }
  }
  const reference = source ? source.files.find(item => item.path === request.path)?.artifact
    : request.path === '' ? asset.value.artifact : undefined
  if (!reference) throw new Error('File is absent from the material snapshot')
  const bytes = await store.read(reference)
  const common = { path: request.path || asset.value.label, size: bytes.length }
  if (isSourceText(bytes)) return { ...common, kind: 'text',
    text: new TextDecoder().decode(bytes.subarray(0, maxOutputBytes), { stream: bytes.length > maxOutputBytes }),
    truncated: bytes.length > maxOutputBytes }
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ? 'image/gif'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : undefined
  if (mime && Math.ceil(bytes.length / 3) * 4 + 128 <= maxOutputBytes)
    return { ...common, kind: 'image', url: `data:${mime};base64,${bytes.toString('base64')}` }
  return { ...common, kind: 'binary', hex: bytes.subarray(0, 256).toString('hex').match(/.{1,32}/g)?.join('\n') ?? '' }
}
