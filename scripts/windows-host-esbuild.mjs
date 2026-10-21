/**
 * Keep pnpm's native esbuild packages outside a Low-labeled workspace.
 * Directory junctions preserve dependency resolution without requiring the
 * administrator privilege needed for Windows file symbolic links.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync,
  renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

/** Remove only a real immediate child of the directory that allocated it. */
function removeOwnedDirectory(path, parent) {
  if (lstatSync(path).isSymbolicLink() || dirname(realpathSync(path)) !== realpathSync(parent)) {
    throw new Error(`Refusing to remove native tool directory outside its owner: ${path}`)
  }
  rmSync(path, { recursive: true, force: true, maxRetries: 3 })
}

/**
 * Relocate Windows esbuild platform packages to an owned host cache.
 * Call under the repository installer lock. Existing cache bytes must match;
 * failures retain the original package or report any rollback failure.
 * @param {string} root - Repository containing pnpm's virtual store.
 * @param {string} hostCache - Host-owned cache outside the writable workspace.
 */
export function prepareWindowsEsbuild(root, hostCache) {
  const virtualStore = join(root, 'node_modules', '.pnpm')
  if (!existsSync(virtualStore)) return
  if (!isAbsolute(hostCache)) throw new Error(`Native esbuild host cache must be absolute: ${hostCache}`)
  mkdirSync(hostCache, { recursive: true })
  const workspace = realpathSync(root)
  const cacheRoot = realpathSync(hostCache)
  const child = relative(workspace, cacheRoot)
  if (child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))) {
    throw new Error(`Native esbuild host cache must be outside the workspace: ${cacheRoot}`)
  }
  for (const entry of readdirSync(virtualStore)) {
    if (!entry.startsWith(`@esbuild+win32-${process.arch}@`)) continue
    const source = join(virtualStore, entry, 'node_modules', '@esbuild', `win32-${process.arch}`)
    const files = readdirSync(source).sort().map(name => {
      const path = join(source, name)
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unexpected native esbuild package entry: ${path}`)
      return { name, bytes: readFileSync(path) }
    })
    const digest = createHash('sha256')
    for (const file of files) digest.update(file.name).update('\0').update(file.bytes)
    const target = join(cacheRoot, digest.digest('hex'))
    if (!existsSync(target)) {
      mkdirSync(target)
      try {
        for (const file of files) writeFileSync(join(target, file.name), file.bytes, { flag: 'wx', mode: 0o700 })
      } catch (error) {
        removeOwnedDirectory(target, cacheRoot)
        throw error
      }
    }
    if (lstatSync(target).isSymbolicLink()) throw new Error(`Native esbuild cache cannot be a link: ${target}`)
    for (const file of files) {
      const path = join(target, file.name)
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !readFileSync(path).equals(file.bytes)) {
        throw new Error(`Native esbuild cache differs from the installed package: ${path}`)
      }
    }
    if (realpathSync(source) === target) continue
    const backup = `${source}.dsh-backup-${randomUUID()}`
    renameSync(source, backup)
    try {
      symlinkSync(target, source, 'junction')
    } catch (error) {
      try { renameSync(backup, source) } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Restore native esbuild package from ${backup} to ${source}`)
      }
      throw error
    }
    if (lstatSync(backup).isSymbolicLink()) unlinkSync(backup)
    else removeOwnedDirectory(backup, dirname(source))
  }
}
