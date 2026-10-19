/** Bounded APK member extraction without materializing archive paths. @module */
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'

/** Enumerate package members without extracting or executing their contents.
 * @param bytes - verified package bytes.
 * @param maxMembers - maximum retained entries.
 * @returns bounded archive metadata and whether entries were omitted.
 */
export async function apkInventory(bytes: Buffer, maxMembers: number): Promise<{
  entries: { path: string; compressedBytes: number; bytes: number }[]
  incomplete: boolean
}> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
  try {
    return await new Promise((resolve, reject) => {
      const entries: { path: string; compressedBytes: number; bytes: number }[] = []
      const names = new Set<string>()
      zip.on('error', reject)
      zip.on('end', () => { resolve({ entries, incomplete: false }) })
      zip.on('entry', (entry: Entry) => {
        if (names.has(entry.fileName)) { reject(new Error('APK repeats a member')); return }
        if (entries.length >= maxMembers) { resolve({ entries, incomplete: true }); return }
        names.add(entry.fileName)
        entries.push({ path: entry.fileName, compressedBytes: entry.compressedSize, bytes: entry.uncompressedSize })
        zip.readEntry()
      })
      zip.readEntry()
    })
  } finally { zip.close() }
}

/** One APK member whose complete bytes passed the extraction budget. */
export interface ApkMember {
  path: string
  bytes: Buffer
  format: 'dex' | 'elf'
}
/**
 * Extract DEX and native library bytes from an APK without trusting its filenames or size claims.
 * @param bytes - verified APK artifact.
 * @param maxBytes - total uncompressed member budget.
 * @param maxMembers - maximum selected archive members.
 * @returns complete selected members; budget failures reject the import.
 */
export async function apkMembers(bytes: Buffer, maxBytes: number, maxMembers: number): Promise<ApkMember[]> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
  const members: ApkMember[] = []
  let total = 0
  const paths = new Set<string>()
  try {
    return await new Promise<ApkMember[]>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', () => {
        resolve(members)
      })
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const name = entry.fileName
          if (!/^(classes[0-9]*\.dex|lib\/[^/]+\/[^/]+\.so)$/u.test(name)) {
            zip.readEntry()
            return
          }
          if (paths.has(name) || members.length >= maxMembers || total + entry.uncompressedSize > maxBytes)
            throw new Error('APK exceeds member budget or repeats a member')
          paths.add(name)
          const stream = await new Promise<import('node:stream').Readable>((resolve, reject) => {
            zip.openReadStream(entry, (error, stream) => {
              if (error) reject(error)
              else resolve(stream)
            })
          })
          const chunks: Buffer[] = []
          for await (const value of stream) {
            const chunk = Buffer.from(value as Uint8Array)
            total += chunk.length
            if (total > maxBytes) {
              stream.destroy()
              throw new Error('APK uncompressed bytes exceed budget')
            }
            chunks.push(chunk)
          }
          const content = Buffer.concat(chunks)
          const dex = content.subarray(0, 4).toString() === 'dex\n'
          const elf = content.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
          if (!dex && !elf) throw new Error('APK executable member has an unexpected file signature')
          members.push({ path: name, bytes: content, format: dex ? 'dex' : 'elf' })
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}
