/** Real Windows Git hooks over a Low-labeled native dependency. */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const installer = fileURLToPath(new URL('./install-lefthook.mjs', import.meta.url))
const launcher = fileURLToPath(new URL('./run-lefthook.mjs', import.meta.url))
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

describe.skipIf(process.platform !== 'win32')('Windows host Lefthook', () => {
  it('commits and stages fixes with a Low dependency, preserves failed checks, and cleans each copy', () => {
    const container = mkdtempSync(join(tmpdir(), 'dsh-hook-integrity-'))
    fixtures.push(container)
    const root = join(container, '工作区 with spaces')
    const hostTemp = join(container, 'host-temp')
    mkdirSync(root)
    mkdirSync(hostTemp)
    const env = {
      ...process.env,
      CI: 'false', GITHUB_ACTIONS: 'false',
      LEFTHOOK: '1', LEFTHOOK_BIN: '',
      TEMP: hostTemp, TMP: hostTemp,
      LOCALAPPDATA: join(container, 'app-data'),
      USERPROFILE: join(container, 'host-home'),
      GIT_CONFIG_GLOBAL: join(container, 'global.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Hooks Test', GIT_AUTHOR_EMAIL: 'hooks@example.test',
      GIT_COMMITTER_NAME: 'Hooks Test', GIT_COMMITTER_EMAIL: 'hooks@example.test',
    }
    const run = (command: string, args: string[]) => {
      const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
      expect(result.error, `${command}: ${result.stderr}`).toBeUndefined()
      expect(result.signal).toBeNull()
      return result
    }
    const ok = (command: string, args: string[]) => {
      const result = run(command, args)
      expect(result.status, `${command}: ${result.stdout}\n${result.stderr}`).toBe(0)
      return result.stdout
    }
    const write = (path: string, contents: string | Buffer) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, contents)
    }
    ok('git', ['init'])
    const dependency = createRequire(createRequire(import.meta.url).resolve('lefthook/package.json'))
    const native = `lefthook-windows-${process.arch}/bin/lefthook.exe`
    const source = join(root, 'node_modules', native)
    write(source, readFileSync(dependency.resolve(native)))
    write(join(root, 'node_modules/lefthook/package.json'), '{}\n')
    write(join(root, 'node_modules/.bin/lefthook.cmd'), '@exit /b 99\r\n')
    write(join(root, 'scripts/run-lefthook.mjs'), readFileSync(launcher))
    const esbuildPackage = join(root, `node_modules/.pnpm/@esbuild+win32-${process.arch}@fixture/node_modules/@esbuild/win32-${process.arch}`)
    write(join(esbuildPackage, 'esbuild.exe'), 'native fixture bytes')
    write(join(esbuildPackage, 'package.json'), '{}\n')
    ok('icacls', [join(esbuildPackage, 'esbuild.exe'), '/setintegritylevel', 'L'])
    ok('icacls', [source, '/setintegritylevel', 'L'])
    write(join(root, 'lefthook.yml'), [
      'lefthook: node scripts/run-lefthook.mjs',
      'pre-commit:',
      '  jobs:',
      '    - name: fixture check',
      "      glob: '*.txt'",
      '      run: node check.cjs',
      '      stage_fixed: true',
      '',
    ].join('\n'))
    write(join(root, 'check.cjs'), [
      "const fs = require('node:fs');",
      "if (fs.existsSync('reject')) { console.error('CHECK_REJECTED'); process.exit(23); }",
      "fs.appendFileSync('change.txt', 'fixed\\n');",
      '',
    ].join('\n'))
    const unsafeCache = spawnSync(process.execPath, [installer], {
      cwd: root, env: { ...env, USERPROFILE: root }, encoding: 'utf8', timeout: 30_000,
    })
    expect(unsafeCache.error).toBeUndefined()
    expect(unsafeCache.signal).toBeNull()
    expect(unsafeCache.status).toBe(1)
    expect(unsafeCache.stderr).toContain('host cache must be outside the workspace')
    expect(lstatSync(esbuildPackage).isSymbolicLink()).toBe(false)
    ok(process.execPath, [installer])
    expect(lstatSync(esbuildPackage).isSymbolicLink()).toBe(true)
    const esbuildTarget = realpathSync(esbuildPackage)
    expect(esbuildTarget.startsWith(join(env.USERPROFILE, '.cache', 'dsh', 'host-esbuild'))).toBe(true)
    expect(existsSync(env.LOCALAPPDATA)).toBe(false)
    expect(readFileSync(join(esbuildTarget, 'esbuild.exe'), 'utf8')).toBe('native fixture bytes')
    const hostLabels = ok('icacls', [join(esbuildTarget, 'esbuild.exe')])
    const aclModule = new URL('../packages/sandbox/sandbox-windows-acl/src/index.ts', import.meta.url).href
    const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href
    ok(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e',
      `import { AclWriteGrant, workspaceWriteSid } from ${JSON.stringify(aclModule)};
const grant = AclWriteGrant.create(workspaceWriteSid(process.cwd()));
try { grant.add(process.cwd(), true); } finally { grant.dispose(); }`])
    expect(ok('icacls', [join(esbuildTarget, 'esbuild.exe')])).toBe(hostLabels)
    const labels = ok('icacls', [source])
    const escaped = join(esbuildTarget, 'sandbox-wrote.txt')
    const runner = fileURLToPath(new URL('../packages/sandbox/sandbox-windows-acl/src/runner.ts', import.meta.url))
    expect(ok(process.execPath, ['--import', tsxLoader, runner,
      '--workspace', root, '--temp', hostTemp, '--mode', 'workspace-write',
      '--', process.execPath, '-e',
      `const fs = require('node:fs');
fs.writeFileSync('sandbox-wrote.txt', 'allowed');
try { fs.writeFileSync(${JSON.stringify(escaped)}, 'escape'); process.exit(10); }
catch (error) { if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error; console.log('HOST_CACHE_WRITE_DENIED'); }`,
    ])).toContain('HOST_CACHE_WRITE_DENIED')
    expect(existsSync(join(root, 'sandbox-wrote.txt'))).toBe(true)
    expect(existsSync(escaped)).toBe(false)
    ok(process.execPath, [installer])
    expect(realpathSync(esbuildPackage)).toBe(esbuildTarget)
    const hooksPath = ok('git', ['config', '--get', 'core.hooksPath']).trim()
    const hook = readFileSync(join(hooksPath, 'pre-commit'), 'utf8')
    expect(hook).toContain('node scripts/run-lefthook.mjs')
    expect(hook.indexOf('node scripts/run-lefthook.mjs')).toBeLessThan(hook.indexOf('dsh-lefthook-host-'))
    write(join(root, 'change.txt'), 'initial\n')
    ok('git', ['add', 'change.txt'])
    ok('git', ['commit', '-m', 'checked commit'])
    expect(ok('git', ['show', 'HEAD:change.txt'])).toBe('initial\nfixed\n')
    expect(readdirSync(hostTemp).filter(name => name.startsWith('dsh-lefthook-host-'))).toEqual([])
    expect(ok('icacls', [source])).toBe(labels)

    const head = ok('git', ['rev-parse', 'HEAD'])
    write(join(root, 'reject'), '')
    write(join(root, 'change.txt'), 'rejected\n')
    ok('git', ['add', 'change.txt'])
    const rejected = run('git', ['commit', '-m', 'must fail'])
    expect(rejected.status).not.toBe(0)
    expect(rejected.stdout + rejected.stderr).toContain('CHECK_REJECTED')
    expect(ok('git', ['rev-parse', 'HEAD'])).toBe(head)
    expect(readdirSync(hostTemp).filter(name => name.startsWith('dsh-lefthook-host-'))).toEqual([])
    expect(existsSync(source)).toBe(true)
  }, 60_000)
})
