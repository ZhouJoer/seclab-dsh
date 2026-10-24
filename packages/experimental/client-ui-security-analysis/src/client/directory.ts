/** One connection-owned task directory shared by navigation and Session presentation. @module */
import type { SessionPresentation } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SecurityProjectSummary } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'

/** Current directory facts; a failed connection retains its last known associations. */
export interface SecurityDirectorySnapshot {
  projects: readonly SecurityProjectSummary[]
  failed: boolean
}

/** Shared read-only directory; disposal cancels its stream before removing presentation. */
export class SecurityDirectory {
  private snapshot: SecurityDirectorySnapshot = { projects: [], failed: false }
  private readonly listeners = new Set<() => void>()
  private names: ReadonlyMap<SessionId, SessionPresentation> = new Map()
  private lifetime: AbortController | undefined
  private readonly pending = new Set<Promise<void>>()
  /** Native presentation source, using the same directory generation as badges. */
  readonly presentations = { getSnapshot: () => this.names, subscribe: (listener: () => void) => this.subscribe(listener) }

  /**
   * @param follow - remote directory stream.
   * @param rename - revision-aware task rename action.
   */
  constructor(private readonly follow: (signal: AbortSignal) => AsyncIterable<SecurityProjectSummary[]>,
    private readonly rename: (projectId: string, title: string) => Promise<void>) {}

  /** Read the shared directory without creating a subscription.
   * @returns current immutable directory snapshot. */
  getSnapshot = (): SecurityDirectorySnapshot => this.snapshot

  /** Subscribe without starting another Remote stream.
   * @param listener - snapshot invalidator.
   * @returns disposer. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Adapt the shared observable to existing directory consumers without another Remote stream.
   * @param signal - consumer lifetime.
   * @returns directory baselines; a disconnected source rejects while retaining its data. */
  async *followProjects(signal: AbortSignal): AsyncIterable<SecurityProjectSummary[]> {
    let dirty = true
    let wake = () => {}
    const changed = () => { dirty = true; wake() }
    const off = this.subscribe(changed)
    signal.addEventListener('abort', changed)
    try {
      while (!signal.aborted) {
        const pending = Promise.withResolvers<void>(); wake = () => { pending.resolve() }
        if (dirty) {
          dirty = false
          if (this.snapshot.failed) throw new Error('Security directory disconnected')
          yield [...this.snapshot.projects]
        } else await pending.promise
      }
    } finally { off(); signal.removeEventListener('abort', changed) }
  }

  /** Replace an obsolete connection stream; late frames cannot overwrite the new connection. */
  start(): void {
    this.lifetime?.abort()
    const lifetime = new AbortController()
    this.lifetime = lifetime
    const pending = (async () => {
      try {
        for await (const projects of this.follow(lifetime.signal)) {
          if (lifetime.signal.aborted) return
          this.snapshot = { projects, failed: false }
          const names = new Map<SessionId, SessionPresentation>()
          for (const summary of projects) for (const binding of summary.sessions) {
            const primary = summary.project.mainSessionId === binding.sessionId
            names.set(binding.sessionId as SessionId, { ...names.get(binding.sessionId as SessionId), reserved: true,
              ...(primary ? { title: summary.project.title, rename: (title: string) => this.rename(summary.project.id, title) } : {}),
            })
          }
          this.names = names
          notifySubscribers(this.listeners, 'Security directory')
        }
        if (!lifetime.signal.aborted) this.fail()
      } catch (_error) { if (!lifetime.signal.aborted) this.fail() }
    })().finally(() => { this.pending.delete(pending) })
    this.pending.add(pending)
  }

  /** Cancel the stream and await its completion before releasing its Remote owner.
   * @returns completion after the stream settles. */
  async close(): Promise<void> { this.lifetime?.abort(); await Promise.all(this.pending); this.listeners.clear() }

  private fail(): void {
    this.snapshot = { ...this.snapshot, failed: true }
    notifySubscribers(this.listeners, 'Security directory')
  }
}
