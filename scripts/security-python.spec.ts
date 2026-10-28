/** Provisioning failures must not replace the interpreter used by active work. @module */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { initializeSecurityPython, setupSecurityPython, type PythonRunner } from './security-python.ts'
import { readToolSettings } from './security-tools-config.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-python-setup-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
  const config = join(directory, 'tools.json')
  const saved = JSON.stringify({ version: 1, installations: { local: {
    python: { command: join(directory, 'old-python'), prefixArgs: [], versionArgs: ['--version'] },
    jadx: { command: 'java', prefixArgs: ['jadx'], versionArgs: ['--version'] },
  } }, bindings: { jadx: 'local' } })
  await writeFile(config, saved)
  const base = join(directory, 'base')
  const options = { python: join(base, 'python'), pythonArgs: [], config }
  let environment = ''
  const calls: string[][] = []
  const run: PythonRunner = async (command, args) => {
    calls.push(args)
    if (args.includes('venv')) environment = args.at(-1) ?? ''
    if (args.some(arg => arg.includes('sys.version_info'))) return JSON.stringify({
      executable: command, prefix: command === options.python ? base : environment,
      base, version: [3, 14, 10], bits: 64,
    })
    return ''
  }
  return { directory, config, saved, options, calls, run }
}

it('publishes a verified environment while preserving bindings and unrelated tools', async () => {
  const f = await fixture()
  const python = await initializeSecurityPython(f.options, f.run)
  const result = readToolSettings(f.config)
  expect(result.installations.local).toMatchObject({ python: { command: python },
    jadx: { command: 'java', prefixArgs: ['jadx'], versionArgs: ['--version'] } })
  expect(result.bindings).toEqual({ jadx: 'local' })
  expect(f.calls.find(args => args.includes('install'))).toContain('--require-virtualenv')
  expect(f.calls.find(args => args.includes('check'))).toEqual(['-I', '-m', 'pip', '--isolated', 'check'])
  const environments = await readdir(join(f.directory, 'runtimes'))
  expect(await readFile(join(f.directory, 'runtimes', environments[0] ?? '', 'requirements.txt'), 'utf8')).toContain('unicorn==2.1.4')
  const next = await initializeSecurityPython(f.options, f.run)
  expect(next).not.toBe(python)
  expect(await readdir(join(f.directory, 'runtimes'))).toHaveLength(2)
})

it.each(['venv', 'install', 'check', 'smoke'])('preserves configuration when %s fails and retains diagnostic files', async (stage) => {
  const f = await fixture()
  const failed: PythonRunner = async (command, args) => {
    if (args.includes(stage) || stage === 'smoke' && args.some(arg => arg.includes('import capstone')))
      throw new Error('fixture subprocess failure')
    return f.run(command, args)
  }
  await expect(initializeSecurityPython(f.options, failed)).rejects.toThrow('existing interpreters were not changed')
  expect(await readFile(f.config, 'utf8')).toBe(f.saved)
  expect(await readdir(join(f.directory, 'runtimes'))).toHaveLength(1)
})

it('does not overwrite an operator edit made during installation', async () => {
  const f = await fixture()
  const edited = JSON.stringify({ version: 1, installations: {}, bindings: { jadx: 'another-environment' } })
  const run: PythonRunner = async (command, args) => {
    if (args.some(arg => arg.includes('import capstone'))) await writeFile(f.config, edited)
    return f.run(command, args)
  }
  await expect(initializeSecurityPython(f.options, run)).rejects.toThrow('Python setup did not complete')
  expect(await readFile(f.config, 'utf8')).toBe(edited)
})

it.each([
  { prefix: '/venv', base: '/base', bits: 64, version: [3, 14, 0] },
  { prefix: '/base', base: '/base', bits: 32, version: [3, 14, 0] },
  { prefix: '/base', base: '/base', bits: 64, version: [3, 9, 0] },
  { prefix: '/base', base: '/base', bits: 64, version: [3, 15, 0] },
])('rejects an unsupported base before creating an environment: %j', async (identity) => {
  const f = await fixture()
  await expect(initializeSecurityPython(f.options, async () => JSON.stringify({ ...identity, executable: '/python' })))
    .rejects.toThrow('standalone 64-bit Python')
  expect(await readFile(f.config, 'utf8')).toBe(f.saved)
  expect(await readdir(f.directory)).toEqual(['tools.json'])
})

it('rejects a created executable resolving outside its owned environment', async () => {
  const f = await fixture()
  await expect(initializeSecurityPython(f.options, async (_command, args) => f.run(f.options.python, args)))
    .rejects.toThrow('Python setup did not complete')
  expect(await readFile(f.config, 'utf8')).toBe(f.saved)
})

it('requires an explicit base and rejects invalid subprocess deadlines before provisioning', async () => {
  await expect(setupSecurityPython([])).rejects.toThrow('--python EXECUTABLE')
  for (const timeout of ['0', '-1', 'NaN', '1.5', '2147483648'])
    await expect(setupSecurityPython(['--python', 'absent', '--timeout-ms', timeout])).rejects.toThrow('--timeout-ms')
})

it('supports a fresh clone with no pre-existing configuration', async () => {
  const f = await fixture()
  const config = join(f.directory, 'fresh', 'tools.json')
  const python = await initializeSecurityPython({ ...f.options, config }, f.run)
  expect(JSON.parse(await readFile(config, 'utf8'))).toMatchObject({
    version: 1, installations: { local: { python: { command: python } } }, bindings: {},
  })
})

it('documents explicit setup and environment retention in command help', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await setupSecurityPython(['--help'])
    expect(output.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "pnpm security:python --python EXECUTABLE [--python-arg=ARG] [--config FILE] [--timeout-ms 600000]
      Requires standalone 64-bit Python 3.12–3.14. Creates a fresh environment, installs pinned dependencies and selects it only after validation. Existing environments are retained. Use the same --config for security:tools and toolConfiguration.path when overriding the profile defaults.",
        ],
      ]
    `)
  } finally { output.mockRestore() }
})
