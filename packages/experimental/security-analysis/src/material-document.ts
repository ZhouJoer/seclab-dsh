/** Read-only document rendering from project-owned artifact bytes. @module */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OfficeToPdf, OfficeExtension, OfficeSourceKey } from '@deepseek-ai/dsh-office-to-pdf'
import type { MaterialDocument } from './material-browser-types.ts'
import type { WorkbenchView } from './workbench/model.ts'
import type { ArtifactStore } from './workbench/artifacts.ts'
import { isSourceText, sourceManifest } from './workbench/source.ts'

const requestSchema = z.object({ assetId: z.string().min(1).max(128), path: z.string() }).strict()

/** Authorize the exact snapshot member before reading or converting it.
 * @param records - Records belonging to the requested project.
 * @param store - Digest-verifying immutable artifact store.
 * @param input - Serialized asset identity and exact manifest path, never a Host path.
 * @param maxTextBytes - Existing bounded text-preview limit.
 * @param converter - Optional shared Office conversion service.
 * @param signal - Caller and owner lifetime.
 * @returns Snapshot identity and display-only content; no workspace path or write operation. */
export async function readMaterialDocument(records: WorkbenchView['records'], store: ArtifactStore, input: string,
  maxTextBytes: number, converter: Pick<OfficeToPdf, 'convert'> | undefined, signal: AbortSignal): Promise<MaterialDocument> {
  signal.throwIfAborted()
  const request = requestSchema.parse(JSON.parse(input))
  const asset = records.find(item => item.kind === 'asset' && item.value.id === request.assetId)
  if (asset?.kind !== 'asset' || !('artifact' in asset.value)) throw new Error('Material is outside the project scope')
  const manifest = 'kind' in asset.value ? await sourceManifest(store, asset.value) : undefined
  const artifact = manifest ? manifest.files.find(item => item.path === request.path)?.artifact
    : request.path === '' ? asset.value.artifact : undefined
  if (!artifact) throw new Error('File is absent from the material snapshot')
  const name = request.path || asset.value.label
  const common = { name, version: artifact.sha256, size: artifact.size }
  const extension = name.split('.').at(-1)?.toLowerCase()
  const office = (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const).find(value => value === extension)
  if (office) {
    if (!converter) throw new Error('Office preview service is unavailable')
    const result = await converter.convert({ extension: office satisfies OfficeExtension, priority: 'foreground', source: {
      key: brandString<OfficeSourceKey>(JSON.stringify(['security-material', artifact.sha256])),
      version: artifact.sha256, bytes: artifact.size,
      read: async (upstream, maxBytes) => {
        upstream.throwIfAborted()
        if (artifact.size > maxBytes) throw new Error('Material exceeds the preview byte limit')
        const bytes = await store.read(artifact)
        upstream.throwIfAborted()
        return { bytes, version: artifact.sha256 }
      },
    } }, signal)
    signal.throwIfAborted()
    return { ...common, kind: 'pdf', data: result.pdf, missingFonts: result.missingFonts }
  }
  const bytes = await store.read(artifact)
  signal.throwIfAborted()
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return { ...common, kind: 'pdf', data: bytes, missingFonts: [] }
  const mediaType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ? 'image/gif'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : undefined
  if (mediaType) return { ...common, kind: 'image', data: bytes, mediaType }
  if (isSourceText(bytes)) return { ...common, kind: 'text',
    text: new TextDecoder().decode(bytes.subarray(0, maxTextBytes), { stream: bytes.length > maxTextBytes }),
    truncated: bytes.length > maxTextBytes }
  return { ...common, kind: 'binary', hex: bytes.subarray(0, 256).toString('hex').match(/.{1,32}/g)?.join('\n') ?? '' }
}
