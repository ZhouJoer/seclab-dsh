/** Published PDF and spreadsheet chunks retain their bundled license notices. */
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const bundlePath = join(packageRoot, 'lib/client.js')
const pdfChunkPath = join(packageRoot, 'lib/client.pdf.js')
const require = createRequire(import.meta.url)
const licenseNames = [
  'LICENSE',
  'cmaps/LICENSE',
  'standard_fonts/LICENSE_FOXIT',
  'standard_fonts/LICENSE_LIBERATION',
  'wasm/LICENSE_JBIG2',
  'wasm/LICENSE_OPENJPEG',
  'wasm/LICENSE_PDFJS_JBIG2',
  'wasm/LICENSE_PDFJS_OPENJPEG',
  'wasm/LICENSE_PDFJS_QCMS',
  'wasm/LICENSE_QCMS',
] as const

function run(command: string, args: string[], cwd: string, timeout: number): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout })
  expect(result.error).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

const execFileAsync = promisify(execFile)

async function runPnpm(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  const entrypoint = process.env.npm_execpath
  if ((entrypoint === undefined || entrypoint === '') && process.platform === 'win32') {
    throw new Error('npm_execpath is required to run pnpm on Windows')
  }
  const command = entrypoint || 'pnpm'
  const isScript = /\.[cm]?js$/iu.test(command)
  const execution = execFileAsync(isScript ? process.execPath : command, isScript ? [command, ...args] : args,
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, signal })
  const closed = new Promise<void>((resolve) => { execution.child.once('close', () => { resolve() }) })
  try { return (await execution).stdout }
  finally { await closed }
}

describe.skipIf(!existsSync(bundlePath))('published document preview licenses', () => {
  let output: string
  let packing: Promise<string> | undefined
  let packed: { filename: string; files: { path: string }[] }
  const controller = new AbortController()

  beforeAll(async () => {
    output = mkdtempSync(join(tmpdir(), 'dsh-document-preview-pack-'))
    packing = runPnpm(['pack', '--json', '--pack-destination', output], packageRoot, controller.signal)
    packed = JSON.parse(await packing) as typeof packed
  })

  afterAll(async () => {
    controller.abort()
    if (packing !== undefined) {
      try { await packing }
      catch (_error) { /* The setup hook reports packing failures; cleanup also waits for an aborted child. */ }
    }
    if (output !== undefined) rmSync(output, { recursive: true, force: true })
  })

  it('keeps bundled licenses in the packed lazy chunks', ({ task }) => {
    expect(existsSync(pdfChunkPath)).toBe(true)
    expect(packed.files.map(file => file.path)).toContain('lib/client.js')
    expect(packed.files.map(file => file.path)).toContain('lib/client.pdf.js')
    expect(packed.files.map(file => file.path)).toContain('lib/client.frontmatter-fields.js')
    expect(packed.files.some(file => file.path.endsWith('pdfjs-NOTICES.txt'))).toBe(false)

    run('tar', ['-xf', resolve(packageRoot, packed.filename), '-C', output,
      'package/lib/client.js', 'package/lib/client.pdf.js', 'package/lib/client.excel.js', 'package/lib/client.frontmatter-fields.js'],
    packageRoot, task.timeout)
    const client = readFileSync(join(output, 'package/lib/client.js'), 'utf8')
    const pdf = readFileSync(join(output, 'package/lib/client.pdf.js'), 'utf8')
    expect([...client.matchAll(/require\.async\("(\.\/client[^"/]*\.js)"\)/gu)].map(match => match[1]))
      .toEqual(['./client.frontmatter-fields.js', './client.pdf.js', './client.excel.js'])
    expect(client).not.toMatch(/\brequire\("\.\/client[^"/]*\.js"\)/u)
    expect([...pdf.matchAll(/require\("(\.\/client[^"/]*\.js)"\)/gu)].map(match => match[1]))
      .toEqual([])
    expect(client).not.toContain('//! Bundled PDF.js license notices')
    expect(client).not.toContain('/pdfjs-dist/')
    expect(pdf).toContain('//! Bundled PDF.js license notices')
    const excel = readFileSync(join(output, 'package/lib/client.excel.js'), 'utf8')
    expect(excel).not.toMatch(/\brequire\("\.\/client[^"/]*\.js"\)/u)
    expect(client).not.toContain('FortuneSheet')
    expect(excel).toContain('//! Bundled spreadsheet license notices')
    expect(excel).toContain('Copyright (c) 2022 Suzhou Ruilisi Technology Co., Ltd')
    expect(excel).toContain('Permission is hereby granted, free of charge')
    for (const dependency of ['xlsx', 'papaparse']) {
      const root = dirname(require.resolve(dependency === 'xlsx' ? dependency : `${dependency}/package.json`))
      const license = readFileSync(join(root, 'LICENSE'), 'utf8').trimEnd()
      expect(excel).toContain(license.split('\n').map(line => `// ${line}`).join('\n'))
    }
    const frontmatter = readFileSync(join(output, 'package/lib/client.frontmatter-fields.js'), 'utf8')
    expect(frontmatter).not.toMatch(/\brequire\("\.\/client[^"/]*\.js"\)/u)
    let frontmatterInitialized = false
    runInNewContext(frontmatter, { window: { __ModuleLoader__: { load: (registration: {
      factory: (resolve: (specifier: string) => unknown) => { FrontmatterFields: unknown }
    }) => {
      const loaded = registration.factory((specifier) => {
        if (specifier === 'react' || specifier === 'react/jsx-runtime') return require(specifier)
        throw new Error(`Unexpected browser dependency: ${specifier}`)
      })
      expect(typeof loaded.FrontmatterFields).toBe('function')
      frontmatterInitialized = true
    } } } })
    expect(frontmatterInitialized).toBe(true)
    let initialized = false
    runInNewContext(excel, { window: { __ModuleLoader__: { load: (registration: {
      factory: (resolve: (specifier: string) => unknown) => { ExcelBody: unknown }
    }) => {
      const loaded = registration.factory((specifier) => {
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
        if (specifier === 'react' || specifier === 'react/jsx-runtime' || specifier === 'react-dom') return require(specifier)
        throw new Error(`Unexpected browser dependency: ${specifier}`)
      })
      expect(typeof loaded.ExcelBody).toBe('function')
      initialized = true
    } } } })
    expect(initialized).toBe(true)
    const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))
    for (const name of licenseNames) {
      const source = readFileSync(join(pdfRoot, name), 'utf8').trimEnd()
      const commented = [`// ${name}`, '// ', ...source.split('\n').map(line => `// ${line}`)].join('\n')
      expect(pdf, `${name} must be visible in package/lib/client.pdf.js`).toContain(commented)
    }
  })
})
