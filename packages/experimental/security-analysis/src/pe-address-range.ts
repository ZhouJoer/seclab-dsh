/** Conservative preferred-image bounds for static PE address queries. @module */
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'

/** Header-declared image interval; its interior need not contain code or mapped sections. */
export interface PeImageRange {
  base: bigint
  end: bigint
}

async function readPart(file: FileHandle, size: number, offset: number): Promise<Buffer | undefined> {
  const bytes = Buffer.alloc(size)
  let filled = 0
  while (filled < size) {
    const result = await file.read(bytes, filled, size - filled, offset + filled)
    if (result.bytesRead === 0) return undefined
    filled += result.bytesRead
  }
  return bytes
}

/** Read preferred image bounds without loading the sample or reading its complete contents.
 * @param path - Verified private input returned by the artifact store.
 * @returns the PE32/PE32+ interval, or undefined when headers cannot establish consistent bounds.
 */
export async function readPeImageRange(path: string): Promise<PeImageRange | undefined> {
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    const dos = await readPart(file, 64, 0)
    if (!dos || dos.readUInt16LE(0) !== 0x5a4d) return undefined
    const peOffset = dos.readUInt32LE(60)
    if (peOffset < 64 || peOffset > size - 24) return undefined
    const coff = await readPart(file, 24, peOffset)
    if (!coff || coff.readUInt32LE(0) !== 0x4550) return undefined
    const sectionCount = coff.readUInt16LE(6)
    const optionalSize = coff.readUInt16LE(20)
    const optionalOffset = peOffset + 24
    const sectionOffset = optionalOffset + optionalSize
    const sectionBytes = sectionCount * 40
    if (!sectionCount || optionalSize < 96 || sectionOffset + sectionBytes > size) return undefined
    const optional = await readPart(file, Math.min(optionalSize, 112), optionalOffset)
    if (!optional) return undefined
    const magic = optional.readUInt16LE(0)
    if (magic !== 0x10b && magic !== 0x20b) return undefined
    if (magic === 0x20b && optionalSize < 112) return undefined
    const imageBase = magic === 0x20b ? optional.readBigUInt64LE(24) : BigInt(optional.readUInt32LE(28))
    const alignment = optional.readUInt32LE(32)
    const imageSize = optional.readUInt32LE(56)
    const headersSize = optional.readUInt32LE(60)
    if (!alignment || !imageSize || imageSize % alignment !== 0 || headersSize < sectionOffset + sectionBytes
      || headersSize > size || headersSize > imageSize) return undefined
    const imageEnd = imageBase + BigInt(imageSize)
    if (imageEnd > 1n << (magic === 0x20b ? 64n : 32n)) return undefined
    const sections = await readPart(file, sectionBytes, sectionOffset)
    if (!sections) return undefined
    for (let offset = 0; offset < sections.length; offset += 40) {
      const virtualSize = sections.readUInt32LE(offset + 8)
      const virtualAddress = sections.readUInt32LE(offset + 12)
      const rawSize = sections.readUInt32LE(offset + 16)
      const rawOffset = sections.readUInt32LE(offset + 20)
      if (virtualAddress + Math.max(virtualSize, rawSize) > imageSize || rawOffset + rawSize > size) return undefined
    }
    return { base: imageBase, end: imageEnd }
  } finally {
    await file.close()
  }
}

/** A static virtual address lies outside a validated preferred PE image interval. */
export class PeAddressOutsideImageError extends Error {
  /** Identifies rejection of a static address outside the validated PE image. */
  readonly code = 'PE_ADDRESS_OUTSIDE_IMAGE'
  constructor(readonly address: string, readonly range: PeImageRange) {
    super(`Virtual address ${address} is outside the PE image range [0x${range.base.toString(16)}, 0x${range.end.toString(16)}). `
      + `ImageBase is 0x${range.base.toString(16)}. Check the virtual address against this imported binary; no address was substituted.`)
  }
}

/** Reject addresses outside reliable preferred PE bounds; unknown formats remain tool-owned.
 * @param path - Verified private input returned by the artifact store.
 * @param addresses - Parsed hexadecimal virtual addresses for the current operation.
 * @returns completion without changing addresses; rejects with PeAddressOutsideImageError for an outside address.
 */
export async function checkPeAddresses(path: string, addresses: readonly string[]): Promise<void> {
  const range = await readPeImageRange(path)
  if (!range) return
  for (const address of addresses) {
    const value = BigInt(address)
    if (value < range.base || value >= range.end) throw new PeAddressOutsideImageError(address, range)
  }
}
