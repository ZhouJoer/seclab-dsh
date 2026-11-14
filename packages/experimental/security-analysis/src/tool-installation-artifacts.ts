/** Bounded verified downloads and extraction into fresh private installation generations. @module */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { open as openZip, type Entry, type ZipFile } from 'yauzl'

/** Operator-configurable resource limits shared by installation recipes. */
export interface ToolInstallationExecutorBounds {
  /** Maximum milliseconds for each authenticated artifact download. */
  downloadTimeoutMs: number
  /** Maximum bytes per artifact download or selected executable digest. */
  maxDownloadBytes: number
  /** Maximum total uncompressed bytes extracted from one archive. */
  maxExtractedBytes: number
  /** Maximum entries accepted from one installation archive. */
  maxArchiveEntries: number
  /** Maximum milliseconds for each installer or verification subprocess. */
  processTimeoutMs: number
  /** Maximum retained bytes for each installer stdout or stderr stream. */
  maxOutputBytes: number
  /** Milliseconds available for owned subprocess termination and draining. */
  graceMs: number
  /** Maximum milliseconds for each preview metadata or temporary-environment subprocess. */
  metadataTimeoutMs: number
  /** Maximum bytes retained from each preview subprocess stream. */
  maxMetadataBytes: number
}

/** Hash a selected executable while bounding bytes and observing cancellation.
 * @param path - absolute selected executable.
 * @param maxBytes - maximum accepted executable size.
 * @param signal - operation lifetime.
 * @returns complete SHA-256 digest.
 */
export async function toolExecutableSha256(path: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  const stream = createReadStream(path, { signal })
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const part of stream) {
      const chunk = Buffer.from(part as Uint8Array)
      bytes += chunk.length
      if (bytes > maxBytes) throw new Error('Selected interpreter exceeds the executable byte limit')
      hash.update(chunk)
    }
    return hash.digest('hex')
  } finally { stream.destroy() }
}

/** Download a reviewed HTTPS artifact and require its complete SHA-256 digest.
 * Partial files remain in the unselected generation for diagnosis.
 * @param artifact - fixed upstream URL and digest.
 * @param destination - exclusive file inside a fresh generation.
 * @param bounds - transfer timeout and maximum bytes.
 * @param signal - operation cancellation.
 */
export async function downloadToolArtifact(artifact: { url: string; sha256: string }, destination: string,
  bounds: ToolInstallationExecutorBounds, signal: AbortSignal): Promise<void> {
  if (new URL(artifact.url).protocol !== 'https:' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error('Invalid reviewed artifact identity')
  const timeout = AbortSignal.timeout(bounds.downloadTimeoutMs)
  const combined = AbortSignal.any([signal, timeout])
  const response = await fetch(artifact.url, { signal: combined })
  if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') throw new Error(`Artifact download failed: HTTP ${response.status}`)
  const file = await open(destination, 'wx')
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for (;;) {
      combined.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > bounds.maxDownloadBytes) throw new Error('Artifact exceeds download byte limit')
      hash.update(part.value)
      await file.writeFile(part.value)
    }
    if (hash.digest('hex') !== artifact.sha256) throw new Error('Artifact SHA-256 does not match the reviewed plan')
  } finally {
    await reader.cancel()
    await file.close()
  }
}

/** Extract an authenticated ZIP while rejecting path aliases, links and expansion overflow.
 * @param archive - verified ZIP file.
 * @param destination - nonexistent private extraction directory.
 * @param bounds - entry and uncompressed byte limits.
 * @param signal - operation cancellation.
 */
export async function extractToolZip(archive: string, destination: string, bounds: ToolInstallationExecutorBounds,
  signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await mkdir(destination)
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    openZip(archive, { lazyEntries: true, validateEntrySizes: true, autoClose: false }, (error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
  let total = 0
  let entries = 0
  const paths = new Set<string>()
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          signal.throwIfAborted()
          const name = entry.fileName.replace(/\/$/u, '')
          const parts = name.split('/')
          if (!name || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/u.test(part)
            || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new Error('Archive contains an unsafe path')
          const mode = entry.externalFileAttributes >>> 16
          if ((mode & 0xf000) === 0xa000 || (entry.generalPurposeBitFlag & 1) !== 0) throw new Error('Archive links and encrypted entries are not supported')
          if (paths.has(name.toLowerCase()) || ++entries > bounds.maxArchiveEntries) throw new Error('Archive repeats a path or exceeds entry limit')
          paths.add(name.toLowerCase())
          total += entry.uncompressedSize
          if (total > bounds.maxExtractedBytes) throw new Error('Archive exceeds extracted byte limit')
          const target = join(destination, ...parts)
          if (entry.fileName.endsWith('/')) await mkdir(target, { recursive: true })
          else {
            await mkdir(dirname(target), { recursive: true })
            const stream = await new Promise<import('node:stream').Readable>((resolve, reject) => {
              zip.openReadStream(entry, (error, value) => { if (error) reject(error); else resolve(value) })
            })
            const file = await open(target, 'wx')
            let written = 0
            try {
              for await (const part of stream) {
                signal.throwIfAborted()
                const chunk = Buffer.from(part as Uint8Array)
                written += chunk.length
                if (written > entry.uncompressedSize) throw new Error('Archive member exceeds declared size')
                await file.writeFile(chunk)
              }
              if (written !== entry.uncompressedSize) throw new Error('Archive member is incomplete')
            } finally { stream.destroy(); await file.close() }
          }
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
    signal.throwIfAborted()
  } finally { zip.close() }
}
