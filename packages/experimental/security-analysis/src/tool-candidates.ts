/** Candidate paths declared by tool packs, shared by CLI and Host probes. @module */
import { accessSync, constants, globSync, statSync, realpathSync, existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import type { ToolDefinition } from './tool-definitions.ts'
/** Find existing executables without executing them.
 * @param tool - Captured executable discovery names.
 * @param directories - explicit recursive search roots selected by the operator.
 * @returns distinct executable file candidates; configured pins are handled by the caller.
 */
export function toolCandidates(tool: ToolDefinition, directories: readonly string[] = []): string[] {
  const roots = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    for (const root of [...roots]) {
      const directory = root.replace(/^"|"$/g, '')
      if (existsSync(resolve(directory, 'git.exe'))) roots.push(resolve(directory, '../usr/bin'), resolve(directory, '../bin'))
    }
  }
  const suffixes = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.COM').toLowerCase().split(';')] : ['']
  const names = tool.commands.flatMap(command => suffixes.map(suffix => command + suffix))
  const paths = roots.flatMap(root => names.map(name => resolve(root.replace(/^"|"$/g, ''), name)))
  for (const directory of directories) {
    if (!statSync(directory).isDirectory()) throw new Error('Search directory is not a directory: ' + directory)
    for (const name of names) paths.push(...globSync('**/' + name, {
      cwd: directory, exclude: ['**/node_modules/**', '**/.git/**'],
    }).map(path => resolve(directory, path)))
  }
  const found = new Map<string, string>()
  for (const path of new Set(paths)) {
    try {
      if (!statSync(path).isFile()) continue
      accessSync(path, constants.X_OK)
      const canonical = realpathSync.native(path)
      found.set(process.platform === 'win32' ? canonical.toLowerCase() : canonical, canonical)
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
      throw error
    }
  }
  return [...found.values()]
}
