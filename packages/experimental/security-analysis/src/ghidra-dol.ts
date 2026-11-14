/** GameCube DOL section admission for the Ghidra private-project loader. @module */

/** File-backed section from the fixed DOL header tables. */
export interface GhidraDolSection { kind: 'text' | 'data'; index: number; fileOffset: number; address: number; size: number }
/** Explicit GameCube MEM1 mapping; BSS gaps exclude initialized data sections. */
export interface GhidraDolImage {
  sections: GhidraDolSection[]
  bss: { address: number; size: number }
  bssGaps: { address: number; size: number }[]
  entryPoint: number
}
/** The DOL header cannot be represented by the supported GameCube MEM1 loader. */
export class GhidraDolImageError extends Error {
  /** Machine-readable identity of a refused DOL mapping. */
  readonly code = 'invalid_ghidra_dol_image'
}

const overlaps = (left: { address: number; size: number }, right: { address: number; size: number }): boolean =>
  left.address < right.address + right.size && right.address < left.address + left.size

function mem1(address: number, size: number): boolean {
  return address >= 0x80000000 && size > 0 && address + size <= 0x81800000
}

/** Decode the 256-byte big-endian header and reject overlapping, truncated, or unsupported mappings.
 * @param header - First 256 bytes of the immutable sample.
 * @param fileBytes - Measured length of the same sample.
 * @returns Header sections and non-overlapping BSS gaps; executable entry must belong to a text section.
 */
export function parseGhidraDol(header: Uint8Array, fileBytes: number): GhidraDolImage {
  if (header.length !== 0x100 || !Number.isSafeInteger(fileBytes) || fileBytes < 0x100 || fileBytes > 0xffffffff)
    throw new GhidraDolImageError('DOL import requires its complete 256-byte header and a 32-bit file extent')
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const word = (offset: number) => view.getUint32(offset, false)
  const sections: GhidraDolSection[] = []
  for (let slot = 0; slot < 18; slot++) {
    const size = word(0x90 + slot * 4)
    if (!size) continue
    const kind = slot < 7 ? 'text' : 'data'
    const index = slot < 7 ? slot : slot - 7
    const fileOffset = word(slot * 4), address = word(0x48 + slot * 4)
    if (fileOffset < 0x100 || fileOffset + size > fileBytes || !mem1(address, size))
      throw new GhidraDolImageError('DOL section must map existing file bytes into cached GameCube MEM1')
    if (kind === 'text' && (address % 4 !== 0 || size % 4 !== 0))
      throw new GhidraDolImageError('DOL text sections must use aligned PowerPC instructions')
    const section: GhidraDolSection = { kind, index, fileOffset, address, size }
    if (sections.some(existing => overlaps(existing, section)
      || overlaps({ address: existing.fileOffset, size: existing.size }, { address: fileOffset, size })))
      throw new GhidraDolImageError('DOL sections cannot overlap in file bytes or loaded addresses')
    sections.push(section)
  }
  const entryPoint = word(0xe0)
  if (entryPoint % 4 !== 0 || !sections.some(section => section.kind === 'text'
    && entryPoint >= section.address && entryPoint < section.address + section.size))
    throw new GhidraDolImageError('DOL entry must name an aligned instruction in a text section')
  const bss = { address: word(0xd8), size: word(0xdc) }
  const bssGaps: { address: number; size: number }[] = []
  if (bss.size) {
    if (!mem1(bss.address, bss.size) || sections.some(section => section.kind === 'text' && overlaps(bss, section)))
      throw new GhidraDolImageError('DOL BSS must lie in cached GameCube MEM1 without overlapping text')
    let cursor = bss.address
    const end = bss.address + bss.size
    for (const section of sections.filter(section => section.kind === 'data' && overlaps(bss, section))
      .sort((left, right) => left.address - right.address)) {
      if (section.address > cursor) bssGaps.push({ address: cursor, size: section.address - cursor })
      cursor = Math.max(cursor, Math.min(end, section.address + section.size))
    }
    if (cursor < end) bssGaps.push({ address: cursor, size: end - cursor })
  }
  return { sections, bss, bssGaps, entryPoint }
}
