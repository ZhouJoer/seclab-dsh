/** Opt-in correction acceptance using real Ghidra programs and test-only incorrect analysis facts. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { ghidraImportArguments, prepareGhidraAnalysisProfile, resolveGhidraAnalysisProfile } from '../src/ghidra-analysis-profile.ts'
import { requireProcessSuccess, runProcess } from '../src/workbench/process.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'

function elf(machine: 'mips' | 'riscv'): Buffer {
  const little = machine === 'riscv'
  const code = little ? [0x13, 0x05, 0xa0, 0x02, 0x67, 0x80, 0, 0] : [0x24, 0x02, 0, 0x2a, 0x03, 0xe0, 0, 0x08, 0, 0, 0, 0]
  const bytes = Buffer.alloc(0x1000 + code.length)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, little ? 1 : 2, 1])
  const word = (value: number, offset: number) => little ? bytes.writeUInt16LE(value, offset) : bytes.writeUInt16BE(value, offset)
  const dword = (value: number, offset: number) => little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset)
  word(2, 16); word(little ? 243 : 8, 18); dword(1, 20); dword(0x1000, 24); dword(52, 28)
  dword(little ? 0 : 0x50001005, 36); word(52, 40); word(32, 42); word(1, 44); word(40, 46)
  for (const [index, value] of [1, 0x1000, 0x1000, 0x1000, code.length, code.length, 5, 0x1000].entries()) dword(value, 52 + index * 4)
  bytes.set(code, 0x1000)
  return bytes
}

for (const kind of ['no-return', 'mips', 'riscv'] as const) {
  it.skipIf(!process.env.DSH_GHIDRA_HEADLESS_DIR || !process.env.DSH_GHIDRA_HEADLESS_JAVA)(
    'corrects ' + kind + ' analysis facts and decompiles the corrected program', { retry: 0 }, async ({ signal }) => {
      const distribution = process.env.DSH_GHIDRA_HEADLESS_DIR, java = process.env.DSH_GHIDRA_HEADLESS_JAVA
      if (!distribution || !java) throw new Error('Select a Ghidra distribution and Java executable')
      const root = await mkdtemp(join(process.env.DSH_GHIDRA_HEADLESS_TEST_ROOT ?? tmpdir(), 'dsh-ghidra-correction-'))
      const ctx = new Context()
      onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
      await ctx.plugin(LocalSubprocess)
      const environment: SecurityEnvironment = { id: 'ghidra-correction', kind: 'local', label: 'Ghidra correction fixture', cwd: root,
        tools: [{ id: 'java', command: java, versionArgs: ['-version'], source: 'Selected test JDK' }] }
      const limits = { signal, durationMs: 90_000, maxOutputBytes: 262144, graceMs: 3000 }
      const support = await runProcess(ctx, environment, 'java', ['-cp', join(distribution, 'support', 'LaunchSupport.jar'),
        'LaunchSupport', distribution, '-vmargs'], limits)
      requireProcessSuccess(support)
      const vmargs = support.stdout.split(/\r?\n/u).filter(Boolean)
      const scripts = join(root, 'scripts'), project = join(root, 'project'), settings = join(root, 'settings')
      await Promise.all([scripts, project, settings].map(path => mkdir(path)))
      const source = fileURLToPath(new URL('../resources/ghidra/', import.meta.url))
      await Promise.all((await readdir(source)).filter(name => name.endsWith('.java')).map(name => copyFile(join(source, name), join(scripts, name))))
      const fixture = join(scripts, 'DshGhidraCorrectionFixture.java')
      await copyFile(new URL('./fixtures/ghidra/DshGhidraCorrectionFixture.java', import.meta.url), fixture)
      const input = join(root, 'input'), configuration = join(root, 'analysis.json'), result = join(root, 'result.json')
      await writeFile(input, kind === 'no-return' ? Buffer.from([0xb8, 42, 0, 0, 0, 0xc3]) : elf(kind), { flag: 'wx' })
      const profile = resolveGhidraAnalysisProfile(kind === 'no-return'
        ? { import: { format: 'raw', languageId: 'x86:LE:64:default', compilerSpecId: 'gcc', baseAddress: '0x1000', entryAddress: '0x1000' }, corrections: { noReturn: true } }
        : { import: { format: 'auto', languageId: kind === 'mips' ? 'MIPS:BE:32:default' : 'RISCV:LE:32:default' },
          corrections: kind === 'mips' ? { mipsSoftFloat: true } : { riscvAbi: 'ilp32' } })
      await writeFile(configuration, JSON.stringify(await prepareGhidraAnalysisProfile(profile, input)), { flag: 'wx' })
      const launcher = [...vmargs, '-Xmx1024m', '-Djava.awt.headless=true',
        '-Dapplication.settingsdir=' + settings, '-Dapplication.cachedir=' + settings, '-Dapplication.tempdir=' + settings,
        '-cp', join(distribution, 'Ghidra', 'Framework', 'Utility', 'lib', 'Utility.jar'),
        'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless', project, 'fixture']
      const outcome = await runProcess(ctx, environment, 'java', [...launcher, '-import', input,
        ...ghidraImportArguments(profile), '-max-cpu', '2', '-analysisTimeoutPerFile', '30', '-scriptPath', scripts,
        '-preScript', join(scripts, 'DshGhidraPrepare.java'), configuration,
        '-postScript', fixture, 'prepare', kind, result,
        '-postScript', join(scripts, 'DshGhidraRepair.java'), configuration,
        '-postScript', fixture, 'verify', kind, result], limits)
      requireProcessSuccess(outcome)
      expect(outcome.truncated).toBe(false)
      const resultBytes = await readFile(result, 'utf8').catch((error: unknown) => {
        throw new Error('Ghidra correction fixture produced no verified result: ' + outcome.stdout + outcome.stderr, { cause: error })
      })
      const evidence = z.object({ correction: z.literal(kind), language: z.string(),
        report: z.record(z.string(), z.json()), pseudocode: z.string() }).parse(JSON.parse(resultBytes))
      expect(evidence.pseudocode).toContain('return')
      const reopenedResult = join(root, 'reopened.json')
      const reopened = await runProcess(ctx, environment, 'java', [...launcher, '-process', 'input', '-noanalysis', '-readOnly',
        '-scriptPath', scripts, '-postScript', fixture, 'verify', kind, reopenedResult], limits)
      requireProcessSuccess(reopened)
      const reopenedBytes = await readFile(reopenedResult, 'utf8').catch((error: unknown) => {
        throw new Error('Saved Ghidra corrections could not be verified: ' + reopened.stdout + reopened.stderr, { cause: error })
      })
      expect(JSON.parse(reopenedBytes)).toEqual(JSON.parse(resultBytes))
      const reports = process.env.DSH_GHIDRA_ACCEPTANCE_REPORT_DIRECTORY
      if (reports) {
        await mkdir(reports, { recursive: true })
        await writeFile(join(reports, basename(root) + '-' + kind + '.json'), resultBytes + '\n', { flag: 'wx' })
      }
    })
}
