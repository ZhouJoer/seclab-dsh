/**
 * Run repository hooks without inheriting a workspace executable's Low label.
 * Windows copies native Lefthook bytes into a private temporary directory;
 * the caller's token and the workspace security descriptors remain unchanged.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Execute the installed Lefthook version and await exit before removing its copy.
 * Custom command shims and POSIX installations execute in place.
 * @param {string} root - Repository root containing the installed dependency.
 * @param {string[]} args - Arguments passed to Lefthook.
 * @param {NodeJS.ProcessEnv} env - Environment inherited by the hook runner.
 * @returns {import('node:child_process').SpawnSyncReturns<Buffer>} Child outcome.
 */
export function runLefthook(root, args, env) {
  const windows = process.platform === 'win32'
  let command = join(root, 'node_modules', '.bin', windows ? 'lefthook.cmd' : 'lefthook')
  let temporary
  try {
    const manifest = join(root, 'node_modules', 'lefthook', 'package.json')
    if (windows && existsSync(manifest)) {
      const dependency = createRequire(realpathSync(manifest))
      const source = dependency.resolve(`lefthook-windows-${process.arch}/bin/lefthook.exe`)
      temporary = mkdtempSync(join(tmpdir(), 'dsh-lefthook-host-'))
      command = join(temporary, 'lefthook.exe')
      // A fresh file inherits the temp directory's label. CopyFile and hard
      // links can retain the source object's Low integrity label.
      writeFileSync(command, readFileSync(source), { flag: 'wx', mode: 0o700 })
    }
    return windows && temporary === undefined
      ? spawnSync(`"${command}"`, args, { cwd: root, env, stdio: 'inherit', shell: true })
      : spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  } finally {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true, maxRetries: 3 })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = runLefthook(process.cwd(), process.argv.slice(2), process.env)
    if (result.error !== undefined) throw result.error
    if (result.signal !== null) throw new Error(`Lefthook terminated by ${result.signal}`)
    process.exitCode = result.status ?? 1
  } catch (error) {
    console.error(`[run-lefthook] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
