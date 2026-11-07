/** Synthetic PE headers with one section and no executable fixture program. @module */

/** Build a PE image for static address checks.
 * @param bits - PE32 or PE32+ optional-header encoding.
 * @param base - Preferred image base, defaulting to the conventional base for the selected width.
 * @returns bytes with a 0x2000-byte image interval and one section at RVA 0x1000.
 */
export function peImageBytes(bits: 32 | 64 = 64, base = bits === 64 ? 0x180000000n : 0x400000n): Buffer {
  const bytes = Buffer.alloc(0x400)
  bytes.write('MZ'); bytes.writeUInt32LE(0x80, 60); bytes.writeUInt32LE(0x4550, 0x80)
  bytes.writeUInt16LE(bits === 64 ? 0x8664 : 0x14c, 0x84)
  bytes.writeUInt16LE(1, 0x86)
  const optionalSize = bits === 64 ? 240 : 224
  bytes.writeUInt16LE(optionalSize, 0x94)
  bytes.writeUInt16LE(bits === 64 ? 0x20b : 0x10b, 0x98)
  if (bits === 64) bytes.writeBigUInt64LE(base, 0x98 + 24)
  else bytes.writeUInt32LE(Number(base), 0x98 + 28)
  bytes.writeUInt32LE(0x1000, 0x98 + 32)
  bytes.writeUInt32LE(0x2000, 0x98 + 56)
  bytes.writeUInt32LE(0x200, 0x98 + 60)
  const section = 0x98 + optionalSize
  bytes.write('.text', section)
  bytes.writeUInt32LE(0x300, section + 8)
  bytes.writeUInt32LE(0x1000, section + 12)
  bytes.writeUInt32LE(0x200, section + 16)
  bytes.writeUInt32LE(0x200, section + 20)
  return bytes
}
