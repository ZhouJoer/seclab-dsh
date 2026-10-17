/** Immutable source snapshots and bounded, line-addressed observations. @module */
import assert from 'node:assert/strict'
import { isUtf8 } from 'node:buffer'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { artifactSchema, type Artifact, type AnalysisOperation } from './model.ts'
import type { ArtifactStore } from './artifacts.ts'
import type { AnalysisProvider, AnalysisContext, AnalysisResult } from './providers.ts'

const memberPath = z.string().min(1).refine(value =>
  !value.includes('\\') && !value.includes(':') && !value.includes('\0') &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Expected a relative source path')
/** Persisted member identities and explicit snapshot exclusions. */
export const sourceManifestSchema = z.object({
  version: z.literal(1),
  files: z.array(z.object({ path: memberPath, artifact: artifactSchema, text: z.boolean() }).strict()),
  excluded: z.array(z.object({ path: memberPath, reason: z.string() }).strict()),
}).strict().refine(value => new Set([...value.files, ...value.excluded].map(item => item.path)).size ===
  value.files.length + value.excluded.length, 'Duplicate source path')

/** Detect UTF-8 source text without accepting NUL bytes.
 * @param bytes - imported content.
 * @returns whether source line operations can read the content.
 */
export function isSourceText(bytes: Buffer): boolean {
  return !bytes.includes(0) && isUtf8(bytes)
}

/** Publish a validated immutable source manifest.
 * @param store - artifact owner.
 * @param manifest - measured members and exclusions.
 * @returns the complete manifest artifact.
 */
export function saveSourceManifest(store: ArtifactStore, manifest: z.infer<typeof sourceManifestSchema>): Promise<Artifact> {
  return store.put(Buffer.from(JSON.stringify(sourceManifestSchema.parse(manifest))), 'application/vnd.dsh.source-tree+json')
}

/**
 * Snapshot regular files without following links or executing source.
 * @param store - immutable artifact owner.
 * @param path - selected source file or directory; a file is the only member and uses its basename.
 * @param roots - operator-approved import roots.
 * @param limits - maximum visited entries and cumulative file bytes.
 * @returns measured manifest artifact.
 */
export async function importSource(store: ArtifactStore, path: string, roots: string[],
  limits: { entries: number; bytes: number }): Promise<Artifact> {
  if (!isAbsolute(path)) throw new Error('Select an absolute source file or directory')
  const root = await realpath(path)
  const approved = await Promise.all(roots.map(value => realpath(value)))
  if (!approved.some((value) => {
    const tail = relative(value, root)
    return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail)
  })) throw new Error('Source path is outside the configured import roots')
  const selected = await lstat(path)
  if (!selected.isFile() && !selected.isDirectory()) throw new Error('Source import requires a regular file or directory')
  const manifest: z.infer<typeof sourceManifestSchema> = { version: 1, files: [], excluded: [] }
  let entries = 0
  let bytes = 0
  const importFile = async (absolute: string, path: string, size: number): Promise<void> => {
    if (bytes + size > limits.bytes) throw new Error('Source snapshot exceeds the configured byte limit')
    const imported = await store.import(absolute, [root])
    bytes += imported.artifact.size
    if (bytes > limits.bytes) throw new Error('Source snapshot exceeds the configured byte limit')
    const content = await store.read(imported.artifact)
    manifest.files.push({ path, artifact: imported.artifact, text: isSourceText(content) })
  }
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const names = (await readdir(directory)).sort()
    for (const name of names) {
      if (++entries > limits.entries) throw new Error(`Source snapshot exceeds the configured entry limit (${limits.entries}; visited ${entries}). Increase security-workbench.maxDerivedAssets and restart the Host, or select a smaller directory.`)
      const path = memberPath.parse(prefix + name)
      const absolute = join(directory, name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        manifest.excluded.push({ path, reason: 'Not a regular file or directory' })
      } else if (stat.isDirectory()) {
        const resolved = await realpath(absolute)
        const tail = relative(root, resolved)
        if (tail === '..' || tail.startsWith('..' + sep) || isAbsolute(tail)) throw new Error('Source directory changed during import')
        await visit(absolute, path + '/')
      } else {
        await importFile(absolute, path, stat.size)
      }
    }
  }
  if (selected.isFile()) {
    if (++entries > limits.entries) throw new Error(`Source snapshot exceeds the configured entry limit (${limits.entries}; visited ${entries}). Increase security-workbench.maxDerivedAssets and restart the Host, or select a smaller directory.`)
    await importFile(root, memberPath.parse(basename(root)), selected.size)
  } else {
    await visit(root, '')
  }
  return saveSourceManifest(store, manifest)
}

/** Read the manifest of the assigned source asset.
 * @param store - verified artifact owner.
 * @param asset - assigned source asset.
 * @returns verified source entries. */
export async function sourceManifest(store: ArtifactStore, asset: AnalysisContext['asset']): Promise<z.infer<typeof sourceManifestSchema>> {
  if (!('kind' in asset) || asset.kind !== 'source') throw new Error('Select an imported source file or directory')
  return sourceManifestSchema.parse(JSON.parse((await store.read(asset.artifact)).toString('utf8')))
}

function directoryMembers(manifest: z.infer<typeof sourceManifestSchema>, path: string) {
  const prefix = path === '' ? '' : path + '/'
  const files = manifest.files.filter(file => file.path.startsWith(prefix))
  const excluded = manifest.excluded.filter(file => file.path.startsWith(prefix))
  if (path !== '' && !files.length && !excluded.length) throw new Error('Directory is absent from the snapshot')
  return { prefix, files, excluded }
}

function directoryEntries(manifest: z.infer<typeof sourceManifestSchema>, path: string) {
  const { prefix, files, excluded } = directoryMembers(manifest, path)
  const directories = new Map<string, { kind: 'directory'; path: string; fileCount: number; bytes: number; excludedCount: number }>()
  const children: ({ kind: 'file'; extension: string } & z.infer<typeof sourceManifestSchema>['files'][number]
    | { kind: 'excluded' } & z.infer<typeof sourceManifestSchema>['excluded'][number])[] = []
  for (const member of [...files, ...excluded]) {
    const tail = member.path.slice(prefix.length)
    const slash = tail.indexOf('/')
    if (slash < 0) {
      children.push('artifact' in member ? { kind: 'file', extension: extname(member.path).toLowerCase(), ...member }
        : { kind: 'excluded', ...member })
      continue
    }
    const childPath = prefix + tail.slice(0, slash)
    let directory = directories.get(childPath)
    if (!directory) {
      directory = { kind: 'directory', path: childPath, fileCount: 0, bytes: 0, excludedCount: 0 }
      directories.set(childPath, directory)
    }
    if ('artifact' in member) {
      directory.fileCount++
      directory.bytes += member.artifact.size
    } else directory.excludedCount++
  }
  return [...directories.values(), ...children].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

/** Source observations use immutable bytes without external execution. */
export class SourceProvider implements AnalysisProvider {
  resourceKey(): null { return null }
  readonly id = 'source'
  readonly operations = ['directory', 'list', 'read', 'search']
  readonly inputGuide = 'For an imported directory, including reverse-engineering materials, start with directory and path "" (root). It lists immediate children with descendant file counts and byte sizes, without reading member contents. File extensions and text flags are hints, not verified formats. Enter only task-relevant subdirectories, then select relevant files for targeted text reads or binary identity and specialist analysis. Do not inspect every file or decompile every function merely because it was imported. directory accepts path (default root), offset and limit; list retains the flat manifest with offset and limit. read requires an exact path and accepts startLine (1-based), limit. search requires a literal query and accepts either an exact path or a directory subtree, offset and limit; omitting both searches all text files, so narrow the scope first. Paths belong to the immutable snapshot, never the live filesystem. Results include hashes, exclusions and continuation positions; uninspected files remain uninspected.'
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!('kind' in context.asset) || context.asset.kind !== 'source') throw new Error('Select an imported source file or directory')
    if (request.script || request.impact !== 'observe') throw new Error('Source inspection is read-only')
    const page = { offset: z.number().int().nonnegative().default(0), limit: z.number().int().positive().default(100) }
    const directoryPath = z.union([z.literal(''), memberPath])
    const schema = request.operation === 'directory' ? z.object({ ...page, path: directoryPath.default('') }).strict()
      : request.operation === 'list' ? z.object(page).strict()
        : request.operation === 'read' ? z.object({ path: memberPath, startLine: z.number().int().positive().default(1), limit: page.limit }).strict()
          : request.operation === 'search' ? z.object({ ...page, query: z.string().min(1), path: memberPath.optional(),
            directory: directoryPath.optional() }).strict().refine(value => value.path === undefined || value.directory === undefined,
            'Choose an exact file path or a directory, not both') : undefined
    if (!schema) throw new Error('Unsupported source operation')
    return { ...request, parameters: schema.parse(request.parameters) }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const manifest = await sourceManifest(context.artifacts, context.asset)
    const query = request.parameters.query
    if (request.operation === 'search') assert(typeof query === 'string', 'Resolved source search requires text')
    const items: object[] = []
    const offset = Number(request.parameters.offset ?? Number(request.parameters.startLine ?? 1) - 1)
    const limit = Number(request.parameters.limit)
    let count = 0
    let hasMore = false
    const payload = () => ({ snapshot: 'artifact' in context.asset ? context.asset.artifact.sha256 : '',
      operation: request.operation, items, nextOffset: offset + items.length,
      ...(request.operation === 'read' ? { nextLine: offset + items.length + 1 } : {}), hasMore,
      excludedCount: manifest.excluded.length })
    const append = (item: object): boolean => {
      if (count++ < offset) return true
      items.push(item)
      if (items.length > limit || Buffer.byteLength(JSON.stringify(payload())) + 32 > context.maxOutputBytes) {
        items.pop()
        if (!items.length) throw new Error('One source result exceeds the output budget')
        hasMore = true
        return false
      }
      return true
    }
    if (request.operation === 'directory') {
      assert(typeof request.parameters.path === 'string', 'Resolved directory path requires text')
      for (const item of directoryEntries(manifest, request.parameters.path)) {
        context.signal.throwIfAborted()
        if (!append(item)) break
      }
    } else if (request.operation === 'list') {
      for (const item of [...manifest.files, ...manifest.excluded]) {
        context.signal.throwIfAborted()
        if (!append(item)) break
      }
    } else {
      const directory = request.parameters.directory
      const candidates = typeof directory === 'string' ? directoryMembers(manifest, directory).files : manifest.files
      const files = candidates.filter(file => request.parameters.path === undefined || file.path === request.parameters.path)
      if (request.parameters.path !== undefined && !files.length) throw new Error('Source path is absent from the snapshot')
      outer: for (const file of files) {
        context.signal.throwIfAborted()
        if (!file.text) {
          if (request.operation === 'read') throw new Error('Source member is not UTF-8 text')
          continue
        }
        const lines = new TextDecoder('utf-8', { fatal: true }).decode(await context.artifacts.read(file.artifact)).split(/\r?\n/u)
        for (const [index, text] of lines.entries()) {
          if (request.operation === 'search' && typeof query === 'string' && !text.includes(query)) continue
          if (!append({ path: file.path, sha256: file.artifact.sha256, line: index + 1, text })) break outer
        }
      }
    }
    context.signal.throwIfAborted()
    const bytes = Buffer.from(JSON.stringify(payload()))
    if (bytes.length > context.maxOutputBytes) throw new Error('Source result exceeds the output budget')
    return { bytes, mediaType: 'application/json', summary: request.operation + ': ' + String(items.length) + ' source entries; use security_evidence for file hashes, line numbers and content', incomplete: hasMore,
      toolVersion: 'dsh-source/1', method: 'static', observationKind: request.operation === 'read' ? 'implementation' : 'inventory' }
  }
}
