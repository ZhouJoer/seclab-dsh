/** Explicit Ghidra import settings and analysis inputs for provider-owned projects. @module */
import { open } from 'node:fs/promises'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import { parseGhidraDol, type GhidraDolImage } from './ghidra-dol.ts'

const address = z.string().regex(/^0x[0-9a-fA-F]{1,16}$/u, 'Use a 0x-prefixed hexadecimal address')
const identifier = z.string().min(1).max(256).regex(/^[\p{L}\p{N}_.:+ -]+$/u)
  .refine(value => value.trim() === value, 'Identifiers cannot start or end with whitespace')
const symbol = z.string().min(1).max(256).regex(/^\S+$/u).regex(/^[^\u0000-\u001f\u007f]+$/u)
const importSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('auto'), languageId: identifier.optional(), compilerSpecId: identifier.optional() }).strict(),
  z.object({ format: z.literal('raw'), languageId: identifier, compilerSpecId: identifier,
    baseAddress: address, entryAddress: address }).strict(),
  z.object({ format: z.literal('dos-com') }).strict(),
  z.object({ format: z.literal('gamecube-dol') }).strict(),
])
const seedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('function'), address, name: symbol.optional() }).strict(),
  z.object({ kind: z.literal('code'), address }).strict(),
  z.object({ kind: z.literal('label'), address, name: symbol }).strict(),
])

/** Task-selected analysis inputs; omitted fields select automatic import and no analysis overrides. */
export const ghidraAnalysisSchema = z.object({
  import: importSchema.optional(),
  disabledAnalyzers: z.array(z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u)
    .refine(value => value.trim() === value, 'Analyzer names cannot start or end with whitespace')).max(128).optional(),
  seeds: z.array(seedSchema).max(4096).optional(),
  corrections: z.object({ noReturn: z.boolean().optional(), mipsSoftFloat: z.boolean().optional(),
    riscvAbi: z.literal('ilp32').nullable().optional() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const selected = value.import
  if (selected?.format === 'auto' && selected.compilerSpecId && !selected.languageId)
    ctx.addIssue({ code: 'custom', path: ['import', 'compilerSpecId'], message: 'A compiler specification requires a language identifier' })
  if (value.corrections?.mipsSoftFloat && value.corrections.riscvAbi)
    ctx.addIssue({ code: 'custom', path: ['corrections'], message: 'MIPS and RISC-V corrections cannot apply to the same program' })
  if (selected && selected.format !== 'auto' && (value.corrections?.mipsSoftFloat || value.corrections?.riscvAbi))
    ctx.addIssue({ code: 'custom', path: ['corrections'], message: 'Architecture ABI corrections require an automatically loaded ELF image' })
  if (selected?.format === 'auto' && selected.languageId) {
    if (value.corrections?.mipsSoftFloat && !selected.languageId.startsWith('MIPS:'))
      ctx.addIssue({ code: 'custom', path: ['import', 'languageId'], message: 'MIPS soft-float correction requires a MIPS language' })
    if (value.corrections?.riscvAbi && selected.languageId !== 'RISCV:LE:32:default')
      ctx.addIssue({ code: 'custom', path: ['import', 'languageId'], message: 'RISC-V ilp32 correction requires RISCV:LE:32:default' })
  }
  const seeds = new Set<string>()
  for (const [index, seed] of (value.seeds ?? []).entries()) {
    if (!address.safeParse(seed.address).success) continue
    const key = seed.kind + ':' + BigInt(seed.address).toString(16)
    if (seeds.has(key)) ctx.addIssue({ code: 'custom', path: ['seeds', index], message: 'Duplicate seed kind and address' })
    seeds.add(key)
  }
})

/** Parsed optional inputs before explicit defaults and address normalization. */
export type GhidraAnalysisInput = z.infer<typeof ghidraAnalysisSchema>

/** Complete semantic profile included in the analysis-session and project-cache identity. */
export interface GhidraAnalysisProfile {
  import: z.infer<typeof importSchema>
  disabledAnalyzers: string[]
  seeds: z.infer<typeof seedSchema>[]
  corrections: { noReturn: boolean; mipsSoftFloat: boolean; riscvAbi: 'ilp32' | null }
}

/** Validated preparation input; DOL mappings are present only for an explicitly selected DOL import. */
export interface GhidraPreparedAnalysis extends GhidraAnalysisProfile {
  format: 'dsh-ghidra-analysis-v1'
  dol?: GhidraDolImage
}

/** A selected import cannot safely map the supplied immutable sample. */
export class GhidraImportImageError extends Error {
  /** Machine-readable identity of a refused sample mapping. */
  readonly code = 'invalid_ghidra_import_image'
}

/** Analysis input exceeds the preparation script's fixed UTF-8 protocol allowance. */
export class GhidraAnalysisProfileSizeError extends Error {
  /** Machine-readable identity of an oversized analysis profile. */
  readonly code = 'ghidra_analysis_profile_too_large'
}

const normalizedAddress = (value: string): string => '0x' + BigInt(value).toString(16)

function boundedProfile<T extends GhidraAnalysisProfile>(profile: T): T {
  if (Buffer.byteLength(JSON.stringify(profile), 'utf8') > 1024 * 1024)
    throw new GhidraAnalysisProfileSizeError('Ghidra analysis profile exceeds the 1 MiB script input limit; reduce seeds or symbol names')
  return profile
}

/** Resolve optional analysis input before execution; invalid input rejects without acquiring a process or project.
 * @param value - Model or stored analysis input; absence selects automatic import without overrides.
 * @returns Complete settings with canonical addresses and stable analyzer/seed ordering.
 */
export function resolveGhidraAnalysisProfile(value: unknown): GhidraAnalysisProfile {
  const parsed = ghidraAnalysisSchema.parse(value === undefined ? {} : value)
  const selected = parsed.import ?? { format: 'auto' as const }
  return boundedProfile({
    import: selected.format === 'raw' ? { ...selected, baseAddress: normalizedAddress(selected.baseAddress),
      entryAddress: normalizedAddress(selected.entryAddress) } : selected,
    disabledAnalyzers: [...new Set(parsed.disabledAnalyzers ?? [])].sort(),
    seeds: (parsed.seeds ?? []).map(seed => ({ ...seed, address: normalizedAddress(seed.address) }))
      .sort((left, right) => left.kind.localeCompare(right.kind, 'en') || (BigInt(left.address) < BigInt(right.address) ? -1 : 1)),
    corrections: { noReturn: parsed.corrections?.noReturn ?? false, mipsSoftFloat: parsed.corrections?.mipsSoftFloat ?? false,
      riscvAbi: parsed.corrections?.riscvAbi ?? null },
  })
}

/** Validate format-dependent file extents and retain the DOL section mapping for the bundled preparation script.
 * @param profile - Resolved semantic inputs.
 * @param targetPath - Materialized immutable sample on the Host filesystem.
 * @returns Fixed-version script input; no sample bytes are changed.
 */
export async function prepareGhidraAnalysisProfile(profile: GhidraAnalysisProfile, targetPath: string): Promise<GhidraPreparedAnalysis> {
  const prepared: GhidraPreparedAnalysis = boundedProfile({ format: 'dsh-ghidra-analysis-v1', ...profile })
  if (profile.import.format === 'auto') return prepared
  const file = await open(targetPath, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size === 0)
      throw new GhidraImportImageError('Ghidra special-format import requires a nonempty regular sample')
    switch (profile.import.format) {
      case 'raw': {
        const base = BigInt(profile.import.baseAddress), entry = BigInt(profile.import.entryAddress)
        const end = base + BigInt(info.size)
        if (end > 0x10000000000000000n || entry < base || entry >= end)
          throw new GhidraImportImageError('Raw binary entry must lie inside the mapped file without overflowing a 64-bit address')
        return prepared
      }
      case 'dos-com':
        if (info.size > 0xff00) throw new GhidraImportImageError('DOS COM images must fit the 65,280-byte region after the PSP')
        return prepared
      case 'gamecube-dol': {
        const header = Buffer.alloc(0x100)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        return boundedProfile({ ...prepared, dol: parseGhidraDol(header.subarray(0, bytesRead), info.size) })
      }
      default: return assertNever(profile.import)
    }
  } finally { await file.close() }
}

/** Build only the fixed loader/language argv associated with the resolved format.
 * @param profile - Resolved semantic inputs.
 * @returns Arguments appended after the immutable sample's import argument; never a script or executable.
 */
export function ghidraImportArguments(profile: GhidraAnalysisProfile): string[] {
  switch (profile.import.format) {
    case 'auto': return [
      ...(profile.import.languageId ? ['-processor', profile.import.languageId] : []),
      ...(profile.import.compilerSpecId ? ['-cspec', profile.import.compilerSpecId] : []),
    ]
    case 'raw': return ['-loader', 'BinaryLoader', '-loader-baseAddr', profile.import.baseAddress,
      '-processor', profile.import.languageId, '-cspec', profile.import.compilerSpecId]
    case 'dos-com': return ['-loader', 'BinaryLoader', '-loader-baseAddr', '1000:0100',
      '-processor', 'x86:LE:16:Real Mode', '-cspec', 'default']
    case 'gamecube-dol': return ['-loader', 'BinaryLoader', '-loader-baseAddr', '0x0',
      '-processor', 'PowerPC:BE:32:default', '-cspec', 'default']
    default: return assertNever(profile.import)
  }
}
