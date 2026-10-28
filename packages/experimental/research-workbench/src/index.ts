/** Operator file editing confined to the effective Session directory. @module */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { decodeResearchText } from './text.ts'
import type { ResearchDirectory, ResearchFile, ResearchSave } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Version-protected operator access to work files. */
    researchFiles: ResearchFiles
  }
}

/** Bounds on a complete editor buffer and one directory listing. */
export interface Config {
  /** Maximum complete UTF-8 file size for editing and saves, in bytes. */
  maxTextBytes: number
  /** Maximum number of entries returned by a directory listing. */
  maxEntries: number
}

/** Effective directory and policy shared with optional research extensions. */
export interface ResearchScope {
  root: FsTarget
  cwd: string
  policy: SandboxExecutionPolicy
}

/** File operations never activate an Agent or change immutable evidence. */
export class ResearchFiles extends TypertRemoteService {
  static inject = ['fs', 'sessionQuery', 'workingDirectory', 'sandboxPolicy', 'typert']
  static Config: z<Config> = z.object({
    maxTextBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
    maxEntries: z.number().step(1).min(1).default(2000),
  })

  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  /** @param ctx - filesystem, Session observations and transport.
   * @param config - deployment-owned response limits. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'researchFiles')
    ctx.effect(() => async () => { this.lifetime.abort(); await Promise.allSettled(this.pending) })
  }

  private async task<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const pending = operation(combined)
    this.pending.add(pending)
    try { return await pending } finally { this.pending.delete(pending) }
  }

  /** Resolve current directory without activating a historical Agent.
   * @param sessionId - authenticated Session resource.
   * @param signal - operation lifetime.
   * @returns canonical directory and the Session's standing file policy. */
  async scope(sessionId: SessionId, signal: AbortSignal): Promise<ResearchScope> {
    using observed = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
    if (!observed.projections) throw new RemoteError('research/unavailable', 'Session projections are unavailable', {})
    const cwd = observed.projections.values.workingDirectory ?? observed.header.cwd ?? this.ctx.workingDirectory.defaultDirectory
    const root = await this.ctx.fs.resolve(cwd, { signal })
    if ((await this.ctx.fs.stat(root, signal))?.type !== 'directory') throw new RemoteError('research/directory', 'Working directory is unavailable', {})
    return { root, cwd: this.ctx.fs.processPath(root), policy: {
      mode: observed.events.findLast(event => event.type === 'sandbox/mode')?.data.mode ?? this.ctx.sandboxPolicy.defaultMode,
      workspaceRoot: observed.header.cwd ?? this.ctx.sandboxPolicy.workspaceRoot,
      sessionId,
    } }
  }

  /** List only canonical descendants of the current directory.
   * @param sessionId - admitted Session.
   * @param path - relative directory, or empty for its root.
   * @param signal - caller cancellation.
   * @returns bounded children and the exact working directory. */
  @Remote({ resources: { session: (sessionId: SessionId) => sessionId } })
  async list(sessionId: SessionId, path: string, signal: AbortSignal): Promise<ResearchDirectory> {
    return this.task(signal, signal => this.listFile(sessionId, path, signal))
  }

  private async listFile(sessionId: SessionId, path: string, signal: AbortSignal): Promise<ResearchDirectory> {
    const scope = await this.scope(sessionId, signal)
    const target = await this.target(scope, path || '.', signal)
    if ((await this.ctx.fs.stat(target, signal))?.type !== 'directory') throw new RemoteError('research/directory', 'Select a directory', {})
    const entries = await this.ctx.fs.listDir(target, signal)
    return { root: scope.cwd, path, truncated: entries.length > this.config.maxEntries,
      entries: entries.slice(0, this.config.maxEntries).filter(entry => entry.type !== 'other' && this.ctx.fs.contains(scope.root, entry.target))
        .map(entry => ({ name: entry.name, path: this.ctx.fs.processPath(entry.target), directory: entry.type === 'directory' })) }
  }

  /** Read complete UTF-8 with a stable before/after version.
   * @param sessionId - admitted Session.
   * @param path - existing work file.
   * @param signal - caller cancellation.
   * @returns original text and the replacement preconditions. */
  @Remote({ resources: { session: (sessionId: SessionId) => sessionId } })
  async read(sessionId: SessionId, path: string, signal: AbortSignal): Promise<ResearchFile> {
    return this.task(signal, signal => this.readFile(sessionId, path, signal))
  }

  private async readFile(sessionId: SessionId, path: string, signal: AbortSignal): Promise<ResearchFile> {
    const scope = await this.scope(sessionId, signal)
    const target = await this.file(scope, path, signal)
    const before = await this.ctx.fs.stat(target, signal)
    if (!before) throw new RemoteError('research/missing', 'File no longer exists', {})
    const bytes = await this.ctx.fs.readBytes(target, signal, this.config.maxTextBytes)
    const after = await this.ctx.fs.stat(target, signal)
    const current = await this.target(scope, path, signal)
    if (after?.version !== before.version || current.targetKey !== target.targetKey) throw new RemoteError('research/conflict', 'File changed during reading; reload it', {})
    const decoded = decodeResearchText(bytes)
    return { ...decoded, path: this.ctx.fs.processPath(target), root: scope.cwd, rootKey: scope.root.targetKey,
      targetKey: target.targetKey, version: before.version, bytes: bytes.length,
      writable: decoded.writable && scope.policy.mode !== 'read-only',
      reason: decoded.reason ?? (scope.policy.mode === 'read-only' ? 'policy' : null) }
  }

  /** Replace one unchanged existing text file; failures preserve caller drafts.
   * @param sessionId - admitted Session.
   * @param request - exact read identity and replacement text.
   * @param signal - caller cancellation.
   * @returns committed version and text; never retries an unknown write outcome. */
  @Remote({ resources: { session: (sessionId: SessionId) => sessionId } })
  async save(sessionId: SessionId, request: ResearchSave, signal: AbortSignal): Promise<ResearchFile> {
    return this.task(signal, signal => this.saveFile(sessionId, request, signal))
  }

  private async saveFile(sessionId: SessionId, request: ResearchSave, signal: AbortSignal): Promise<ResearchFile> {
    if (Buffer.byteLength(request.text, 'utf8') > this.config.maxTextBytes) throw new RemoteError('research/too-large', 'Editor text exceeds the configured limit', {})
    const original = await this.read(sessionId, request.path, signal)
    if (!original.writable) throw new RemoteError('research/read-only', 'This file is read-only', {})
    if (original.rootKey !== request.rootKey || original.targetKey !== request.targetKey || original.version !== request.version)
      throw new RemoteError('research/conflict', 'File or working directory changed; compare before saving', {})
    const text = (original.bom ? '\uFEFF' : '') + request.text
    if (Buffer.byteLength(text, 'utf8') > this.config.maxTextBytes) throw new RemoteError('research/too-large', 'Editor text exceeds the configured limit', {})
    const decoded = decodeResearchText(new TextEncoder().encode(text))
    if (!decoded.writable || (original.newline === 'crlf' && /(?<!\r)\n/.test(request.text)) || (original.newline === 'lf' && request.text.includes('\r')))
      throw new RemoteError('research/encoding', 'Keep the original UTF-8 encoding and line endings', {})
    const scope = await this.scope(sessionId, signal)
    if (scope.root.targetKey !== request.rootKey || scope.policy.mode === 'read-only') throw new RemoteError('research/conflict', 'Working directory or policy changed', {})
    const target = await this.file(scope, request.path, signal)
    if (target.targetKey !== request.targetKey) throw new RemoteError('research/conflict', 'File identity changed', {})
    const saved = await this.ctx.fs.writeText(target, text, { kind: 'replaceIfVersion', version: request.version }, signal, scope.policy)
    return { ...original, text: request.text, bytes: Buffer.byteLength(text), version: saved.version }
  }

  private async target(scope: ResearchScope, path: string, signal: AbortSignal): Promise<FsTarget> {
    const target = await this.ctx.fs.resolve(path, { cwd: scope.cwd, signal })
    if (!this.ctx.fs.contains(scope.root, target)) throw new RemoteError('research/outside-workspace', 'Select a file within the current working directory', {})
    return target
  }

  private async file(scope: ResearchScope, path: string, signal: AbortSignal): Promise<FsTarget> {
    if ((await this.ctx.fs.lstat(path, { cwd: scope.cwd }, signal))?.type !== 'file') throw new RemoteError('research/not-file', 'Select an existing regular file', {})
    const target = await this.target(scope, path, signal)
    if ((await this.ctx.fs.stat(target, signal))?.type !== 'file') throw new RemoteError('research/not-file', 'File no longer exists', {})
    return target
  }
}

export default ResearchFiles
