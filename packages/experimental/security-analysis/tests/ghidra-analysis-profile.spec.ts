/** Explicit import settings preserve sample identity and reject unsafe mappings. @module */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { ghidraAnalysisSchema, ghidraImportArguments, prepareGhidraAnalysisProfile,
  resolveGhidraAnalysisProfile } from '../src/ghidra-analysis-profile.ts'
import { parseGhidraDol } from '../src/ghidra-dol.ts'

const raw = { format: 'raw', languageId: 'x86:LE:32:default', compilerSpecId: 'gcc', baseAddress: '0x400000', entryAddress: '0x400000' }

function dol() {
  const bytes = Buffer.alloc(0x10c)
  bytes.writeUInt32BE(0x100, 0)
  bytes.writeUInt32BE(0x80003100, 0x48)
  bytes.writeUInt32BE(8, 0x90)
  bytes.writeUInt32BE(0x108, 0x1c)
  bytes.writeUInt32BE(0x80003210, 0x64)
  bytes.writeUInt32BE(4, 0xac)
  bytes.writeUInt32BE(0x80003200, 0xd8)
  bytes.writeUInt32BE(0x20, 0xdc)
  bytes.writeUInt32BE(0x80003100, 0xe0)
  return bytes
}

async function sample(bytes: Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ghidra-profile-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, '中文 input.bin')
  await writeFile(path, bytes)
  return path
}

it('resolves one complete profile and canonicalizes equivalent analyzer and seed choices', () => {
  const defaults = resolveGhidraAnalysisProfile(undefined)
  expect(defaults).toEqual({ import: { format: 'auto' }, disabledAnalyzers: [], seeds: [],
    corrections: { noReturn: false, mipsSoftFloat: false, riscvAbi: null } })
  expect(resolveGhidraAnalysisProfile(defaults)).toEqual(defaults)
  const profile = resolveGhidraAnalysisProfile({ import: { ...raw, baseAddress: '0x0000400000' },
    disabledAnalyzers: ['B', 'A', 'B'], seeds: [{ kind: 'label', address: '0x0000AB', name: 'target' },
      { kind: 'function', address: '0x0010', name: 'entry' }], corrections: { noReturn: true } })
  expect(profile.import).toEqual(raw)
  expect(profile.disabledAnalyzers).toEqual(['A', 'B'])
  expect(profile.seeds).toEqual([{ kind: 'function', address: '0x10', name: 'entry' }, { kind: 'label', address: '0xab', name: 'target' }])
})

it.each([
  { script: 'Other.java' },
  { import: { format: 'auto', compilerSpecId: 'gcc' } },
  { import: { format: 'raw', languageId: 'x86:LE:32:default', compilerSpecId: 'gcc', baseAddress: '0x0' } },
  { import: { ...raw, argv: ['-postScript', 'Other.java'] } },
  { import: { format: 'dos-com', languageId: 'x86:LE:64:default' } },
  { import: { ...raw, baseAddress: '-1' } },
  { import: { ...raw, baseAddress: '0x10000000000000000' } },
  { import: { format: 'auto', languageId: 'x86:LE:64:default\n-postScript' } },
  { disabledAnalyzers: [' A'] },
  { disabledAnalyzers: ['A\nB'] },
  { seeds: [{ kind: 'label', address: '0x0' }] },
  { seeds: [{ kind: 'code', address: '0x0', name: 'unexpected' }] },
  { seeds: [{ kind: 'function', address: '0x0', name: 'contains space' }] },
  { seeds: [{ kind: 'function', address: '0x000a' }, { kind: 'function', address: '0xA' }] },
  { corrections: { mipsSoftFloat: true, riscvAbi: 'ilp32' } },
  { corrections: { riscvAbi: 'lp64' } },
  { import: { format: 'gamecube-dol' }, corrections: { mipsSoftFloat: true } },
  { import: { format: 'auto', languageId: 'x86:LE:32:default' }, corrections: { mipsSoftFloat: true } },
  { import: { format: 'auto', languageId: 'RISCV:LE:64:default' }, corrections: { riscvAbi: 'ilp32' } },
])('rejects conflicting or executable analysis input: %j', (input) => {
  expect(ghidraAnalysisSchema.safeParse(input).success).toBe(false)
})

it('builds fixed loader arguments without implicit architecture overrides', () => {
  expect(ghidraImportArguments(resolveGhidraAnalysisProfile(undefined))).toEqual([])
  expect(ghidraImportArguments(resolveGhidraAnalysisProfile({ import: { format: 'auto', languageId: 'ARM:LE:32:Cortex' } })))
    .toEqual(['-processor', 'ARM:LE:32:Cortex'])
  expect(ghidraImportArguments(resolveGhidraAnalysisProfile({ import: raw }))).toEqual([
    '-loader', 'BinaryLoader', '-loader-baseAddr', '0x400000', '-processor', 'x86:LE:32:default', '-cspec', 'gcc',
  ])
  expect(ghidraImportArguments(resolveGhidraAnalysisProfile({ import: { format: 'dos-com' } })))
    .toEqual(['-loader', 'BinaryLoader', '-loader-baseAddr', '1000:0100', '-processor', 'x86:LE:16:Real Mode', '-cspec', 'default'])
  expect(ghidraImportArguments(resolveGhidraAnalysisProfile({ import: { format: 'gamecube-dol' } })))
    .toEqual(['-loader', 'BinaryLoader', '-loader-baseAddr', '0x0', '-processor', 'PowerPC:BE:32:default', '-cspec', 'default'])
})

it('bounds the complete UTF-8 analysis profile before any process or project is acquired', () => {
  const seeds = Array.from({ length: 4096 }, (_, index) => ({ kind: 'label', address: '0x' + index.toString(16), name: '汉'.repeat(256) }))
  expect(() => resolveGhidraAnalysisProfile({ seeds })).toThrow('1 MiB script input limit')
})

it('checks raw entry bounds and the final 64-bit address without reading or changing bytes', async () => {
  const path = await sample(Buffer.from([0xc3, 0x90]))
  expect(await prepareGhidraAnalysisProfile(resolveGhidraAnalysisProfile({ import: raw }), path)).toMatchObject({
    format: 'dsh-ghidra-analysis-v1', import: raw,
  })
  await expect(prepareGhidraAnalysisProfile(resolveGhidraAnalysisProfile({ import: { ...raw, entryAddress: '0x400002' } }), path))
    .rejects.toMatchObject({ code: 'invalid_ghidra_import_image' })
  await expect(prepareGhidraAnalysisProfile(resolveGhidraAnalysisProfile({ import: { ...raw, baseAddress: '0xffffffffffffffff',
    entryAddress: '0xffffffffffffffff' } }), path)).rejects.toMatchObject({ code: 'invalid_ghidra_import_image' })
  const last = { ...raw, baseAddress: '0xfffffffffffffffe', entryAddress: '0xffffffffffffffff' }
  expect(await prepareGhidraAnalysisProfile(resolveGhidraAnalysisProfile({ import: last }), path)).toMatchObject({ import: last })
})

it('accepts a full COM address space and rejects overflow and empty imports', async () => {
  const profile = resolveGhidraAnalysisProfile({ import: { format: 'dos-com' } })
  expect(await prepareGhidraAnalysisProfile(profile, await sample(Buffer.alloc(0xff00)))).toMatchObject({ import: { format: 'dos-com' } })
  await expect(prepareGhidraAnalysisProfile(profile, await sample(Buffer.alloc(0xff01))))
    .rejects.toMatchObject({ code: 'invalid_ghidra_import_image' })
  await expect(prepareGhidraAnalysisProfile(profile, await sample(Buffer.alloc(0))))
    .rejects.toMatchObject({ code: 'invalid_ghidra_import_image' })
})

it('maps DOL sections and subtracts initialized data from BSS', async () => {
  const bytes = dol()
  const parsed = parseGhidraDol(bytes.subarray(0, 0x100), bytes.length)
  expect(parsed).toEqual({ sections: [
    { kind: 'text', index: 0, fileOffset: 0x100, address: 0x80003100, size: 8 },
    { kind: 'data', index: 0, fileOffset: 0x108, address: 0x80003210, size: 4 },
  ], bss: { address: 0x80003200, size: 0x20 },
  bssGaps: [{ address: 0x80003200, size: 0x10 }, { address: 0x80003214, size: 0xc }], entryPoint: 0x80003100 })
  expect(await prepareGhidraAnalysisProfile(resolveGhidraAnalysisProfile({ import: { format: 'gamecube-dol' } }), await sample(bytes)))
    .toMatchObject({ dol: parsed })
})

it.each([
  [0, 0xfc], [0, 0x10c], [0x48, 0x90000000], [0x48, 0x817ffffc],
  [0x48, 0x80003101], [0x90, 7], [0x1c, 0x104], [0x64, 0x80003104],
  [0xe0, 0x80003210], [0xe0, 0x80003101], [0xd8, 0x80003104], [0xdc, 0xffffffff],
])('refuses invalid DOL header word at %i = %i', (offset, value) => {
  const bytes = dol()
  bytes.writeUInt32BE(value, offset)
  expect(() => parseGhidraDol(bytes.subarray(0, 0x100), bytes.length)).toThrow()
})

it('refuses truncated DOL headers and preserves zero-sized BSS', () => {
  expect(() => parseGhidraDol(new Uint8Array(255), 300)).toThrow()
  const bytes = dol()
  bytes.writeUInt32BE(0, 0xdc)
  expect(parseGhidraDol(bytes.subarray(0, 0x100), bytes.length).bssGaps).toEqual([])
})
