/** Shared recursive workspace observers publishing immutable task materials. @module */
import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { ArtifactStore } from './workbench/artifacts.ts'
import { isSourceText, saveSourceManifest } from './workbench/source.ts'
import type { Artifact } from './workbench/model.ts'
import type { SecurityController } from './workbench/controller.ts'
import { workspaceKey } from './task-bootstrap.ts'

/** Deployment budgets for automatic workspace material collection. */
export interface WorkspaceMaterialOptions {
  /** Maximum entries visited by one scan and retained in its index. */
  maxEntries: number
  /** Maximum aggregate size of current workspace file bytes. */
  maxBytes: number
  /** Event coalescing delay and write-stability observation interval. */
  debounceMs: number
  /** Directory names excluded at every depth, independent of .gitignore. */
  excludedDirectories: string[]
}

/** Runtime freshness, separate from the persisted last successful snapshot. */
export interface WorkspaceMaterialState {
  state: 'syncing' | 'ready' | 'failed'
  detail?: string
}

type Member = { path: string; artifact: Artifact; text: boolean }
interface Owner {
  root: string
  watcher: FSWatcher
  abort: AbortController
  projects: Map<string, number>
  files: Map<string, Member>
  excluded: Map<string, string>
  changes: Set<string>
  full: boolean
  ready: boolean
  needsRescan: boolean
  failure?: Error
  running?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  state: WorkspaceMaterialState
}

/** One Host-owned collector; task leases share observers for the same real directory. */
export class WorkspaceMaterialSync {
  private readonly owners = new Map<string, Owner>()
  private readonly listeners = new Set<() => void>()
  private readonly closing = new Set<Promise<void>>()
  private closed = false

  /**
   * @param controller - task and artifact publication owner.
   * @param artifacts - immutable byte store used by the controller.
   * @param storageRoot - excluded output root, even when inside the workspace.
   * @param options - validated scan budgets and exclusion names.
   */
  constructor(private readonly controller: SecurityController, private readonly artifacts: ArtifactStore,
    private readonly storageRoot: string, private readonly options: WorkspaceMaterialOptions) {}

  /** Subscribe to freshness changes; the disposer removes the listener.
   * @param listener - directory projection invalidator.
   * @returns subscription disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read freshness without starting a watcher.
   * @param project - task identity.
   * @returns active observer state, or absence while the task is not observed. */
  state(project: string): WorkspaceMaterialState | undefined {
    return [...this.owners.values()].find(owner => owner.projects.has(project))?.state
  }

  /** Acquire observation for an unarchived workspace task; scanning runs in the background.
   * @param projectId - durable task identity.
   * @returns asynchronous release that drains the observer when its last lease leaves. */
  async retain(projectId: string): Promise<() => Promise<void>> {
    this.assertOpen()
    const project = this.controller.projects().find(item => item.id === projectId)
    if (!project?.workspaceMaterials) return async () => {}
    const root = resolve(project.workspaceMaterials.root)
    // Keep a missing directory observable so its failure can be retried in the UI.
    const canonical = await realpath(root).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return root
      throw error
    })
    this.assertOpen()
    const key = workspaceKey(canonical)
    let owner = this.owners.get(key)
    if (!owner) {
      const watcher = watch(canonical, { ignoreInitial: true, followSymlinks: false,
        ignored: path => this.excluded(canonical, path) !== undefined,
        awaitWriteFinish: { stabilityThreshold: this.options.debounceMs, pollInterval: this.options.debounceMs } })
      owner = { root: canonical, watcher, abort: new AbortController(), projects: new Map(), files: new Map(),
        excluded: new Map(), changes: new Set(), full: true, ready: false, needsRescan: false, state: { state: 'syncing' } }
      this.owners.set(key, owner)
      const target = owner
      watcher.on('all', (_event, path) => {
        if (target.abort.signal.aborted) return
        target.changes.add(resolve(path))
        if (target.changes.size > this.options.maxEntries) { target.changes.clear(); target.full = true }
        this.schedule(target)
      })
      watcher.on('error', (error) => {
        if (!target.abort.signal.aborted) {
          target.failure = error instanceof Error ? error : new Error(String(error))
          target.needsRescan = true
          this.publish(target, { state: 'failed', detail: target.failure.message })
        }
      })
      watcher.on('ready', () => { target.ready = true; this.schedule(target) })
    }
    const previous = owner.projects.get(projectId) ?? 0
    owner.projects.set(projectId, previous + 1)
    if (owner.ready && previous === 0) { owner.full = true; this.schedule(owner) }
    let released = false
    const retained = owner
    return async () => {
      if (released) return
      released = true
      const count = retained.projects.get(projectId) ?? 0
      if (count > 1) retained.projects.set(projectId, count - 1)
      else retained.projects.delete(projectId)
      if (retained.projects.size || this.owners.get(key) !== retained) return
      this.owners.delete(key)
      const pending = this.stop(retained)
      this.closing.add(pending)
      try { await pending } finally { this.closing.delete(pending) }
    }
  }

  /** Await current changes; a failed source never masquerades as fresh input.
   * @param projectId - task whose current workspace materials are required.
   * @returns completion after synchronization, rejecting on collection failure. */
  async flush(projectId: string): Promise<void> {
    const owner = [...this.owners.values()].find(item => item.projects.has(projectId))
    if (!owner) return
    if (owner.failure) throw owner.failure
    if (!owner.ready) await new Promise<void>((resolveReady, reject) => {
      const ready = () => { cleanup(); resolveReady() }
      const abort = () => { cleanup(); reject(new Error('Workspace material observer released')) }
      const failed = (error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))) }
      const cleanup = () => { owner.watcher.off('error', failed); owner.watcher.off('ready', ready); owner.abort.signal.removeEventListener('abort', abort) }
      owner.watcher.once('ready', ready)
      owner.watcher.once('error', failed)
      owner.abort.signal.addEventListener('abort', abort, { once: true })
      if (owner.abort.signal.aborted) abort()
    })
    if (owner.timer) { clearTimeout(owner.timer); delete owner.timer }
    do {
      await (owner.running ?? this.run(owner))
      if (owner.state.state === 'failed') break
      owner.abort.signal.throwIfAborted()
    } while (owner.full || owner.changes.size)
    if (owner.state.state === 'failed') throw new Error('Workspace materials could not be synchronized: ' + (owner.state.detail ?? 'Unknown collection error'))
  }

  /** Request a complete retry after a visible collection failure.
   * @param projectId - observed task.
   * @returns completion after the fresh scan. */
  async refresh(projectId: string): Promise<void> {
    const owner = [...this.owners.values()].find(item => item.projects.has(projectId))
    if (owner) { owner.full = true; delete owner.failure }
    await this.flush(projectId)
  }

  /** Stop all callbacks and await pending artifact publications before storage teardown.
   * @returns quiescent completion. */
  async close(): Promise<void> {
    this.closed = true
    const owners = [...this.owners.values()]
    this.owners.clear()
    const settled = await Promise.allSettled([...owners.map(owner => this.stop(owner)), ...this.closing])
    this.listeners.clear()
    const errors: unknown[] = []
    for (const result of settled) if (result.status === 'rejected') errors.push(result.reason)
    if (errors.length) throw new AggregateError(errors, 'Workspace material observers could not close')
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Workspace material collection is closed')
  }

  private async stop(owner: Owner): Promise<void> {
    owner.abort.abort(new Error('Workspace material observer released'))
    if (owner.timer) clearTimeout(owner.timer)
    try { await owner.watcher.close() } finally { await owner.running }
  }

  private publish(owner: Owner, state: WorkspaceMaterialState): void {
    owner.state = state
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('Workspace material subscriber failed:', error) }
    }
  }

  private schedule(owner: Owner): void {
    if (!owner.ready || owner.abort.signal.aborted || owner.running) return
    if (owner.timer) clearTimeout(owner.timer)
    owner.timer = setTimeout(() => { delete owner.timer; void this.run(owner) }, this.options.debounceMs)
  }

  private excluded(root: string, path: string): string | undefined {
    const tail = relative(root, path)
    if (tail === '') return undefined
    if (tail === '..' || tail.startsWith('..' + sep) || isAbsolute(tail)) return 'Outside the workspace'
    const storage = relative(resolve(this.storageRoot), resolve(path))
    if (storage === '' || storage !== '..' && !storage.startsWith('..' + sep) && !isAbsolute(storage)) return 'Workbench storage'
    const segments = tail.split(sep)
    if (segments[0] === '.dsh' && segments[1] === 'analysis') return 'Analysis output'
    if (segments.some(part => this.options.excludedDirectories.includes(part))) return 'Excluded directory'
    return undefined
  }

  private run(owner: Owner): Promise<void> {
    if (owner.running) return owner.running
    const full = owner.full || owner.needsRescan
    owner.needsRescan = false
    const paths = [...owner.changes]
    owner.full = false; owner.changes.clear()
    this.publish(owner, { state: 'syncing' })
    const operation = (async () => {
      const files = full ? new Map<string, Member>() : new Map(owner.files)
      const excluded = full ? new Map<string, string>() : new Map(owner.excluded)
      let snapshot: Promise<Artifact> | undefined
      const prepare = () => snapshot ??= (async () => {
        let entries = 0
        let bytes = [...files.values()].reduce((sum, file) => sum + file.artifact.size, 0)
        const visit = async (path: string): Promise<void> => {
          owner.abort.signal.throwIfAborted()
          if (++entries > this.options.maxEntries) throw new Error('Workspace material entry limit exceeded')
          const name = relative(owner.root, path).split(sep).join('/')
          const reason = this.excluded(owner.root, path)
          if (reason) { excluded.set(name, reason); return }
          const stat = await lstat(path).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT' && name) return undefined
            throw error
          })
          if (!stat) return
          if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) { excluded.set(name, 'Not a regular file or directory'); return }
          if (stat.isDirectory()) {
            for (const child of (await readdir(path)).sort()) await visit(join(path, child))
          } else {
            if (bytes + stat.size > this.options.maxBytes) throw new Error('Workspace material byte limit exceeded')
            const imported = await this.artifacts.import(path, [owner.root])
            bytes += imported.artifact.size
            const content = await this.artifacts.read(imported.artifact)
            files.set(name, { path: name, artifact: imported.artifact, text: isSourceText(content) })
          }
        }
        if (full) await visit(owner.root)
        else for (const path of paths) {
          const name = relative(owner.root, path).split(sep).join('/')
          for (const [key, file] of files) if (key === name || key.startsWith(name + '/')) { files.delete(key); bytes -= file.artifact.size }
          for (const key of excluded.keys()) if (key === name || key.startsWith(name + '/')) excluded.delete(key)
          await visit(path)
        }
        if (files.size + excluded.size > this.options.maxEntries) throw new Error('Workspace material entry limit exceeded')
        if ([...files.values()].reduce((sum, file) => sum + file.artifact.size, 0) > this.options.maxBytes)
          throw new Error('Workspace material byte limit exceeded')
        owner.abort.signal.throwIfAborted()
        return saveSourceManifest(this.artifacts, { version: 1,
          files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
          excluded: [...excluded].map(([path, reason]) => ({ path, reason })).sort((a, b) => a.path.localeCompare(b.path)) })
      })()
      owner.abort.signal.throwIfAborted()
      const targets = [...owner.projects.keys()].flatMap((projectId) => {
        const root = this.controller.projects().find(item => item.id === projectId)?.workspaceMaterials?.root
        return root ? [{ projectId, root }] : []
      })
      if (targets.length) await this.controller.syncWorkspaceMaterials(targets, prepare)
      owner.files = files; owner.excluded = excluded
      this.publish(owner, { state: 'ready' })
    })().catch((error: unknown) => {
      owner.needsRescan = true
      if (!owner.abort.signal.aborted) this.publish(owner, { state: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      delete owner.running
      if (owner.full || owner.changes.size) this.schedule(owner)
    })
    owner.running = operation
    return operation
  }
}
