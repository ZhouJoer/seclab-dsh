/** First-message preparation and native composer presentation for security conversations. @module */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPresentation } from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Transient preparation feedback and resource refresh generation for one composer. */
export interface FirstMessageState {
  busy: boolean
  error?: string
  revision: number
  needsSave?: boolean
  toolsDirty?: boolean
  toolsBusy?: boolean
}

/** Connection-owned preparation; duplicate sends share one creation request. */
export class FirstMessagePreparation {
  /** Per-composer request progress and recoverable setup failures. */
  readonly state = createSnapshotStore<Readonly<Record<string, FirstMessageState>>>({})
  /** Native composer hints for unassociated security conversations. */
  readonly presentations = createSnapshotStore<ReadonlyMap<SessionId, SessionPresentation>>(new Map())
  private readonly pending = new Map<SessionId, Promise<void>>()

  /**
   * @param prepare - authenticated, idempotent task preparation.
   * @param failure - localized description of a remote error code.
   */
  constructor(private readonly prepare: (id: SessionId) => Promise<RemoteResult<void>>,
    private readonly failure: (code: string) => string) {}

  /** Refresh the configuration after an explicit settings save.
   * @param id - composer owning the configuration.
   */
  refresh(id: SessionId): void {
    const previous = this.state.getSnapshot()[id]
    this.state.set({ ...this.state.getSnapshot(), [id]: { busy: false, revision: (previous?.revision ?? 0) + 1,
      ...(previous?.toolsDirty ? { toolsDirty: true } : {}), ...(previous?.toolsBusy ? { toolsBusy: true } : {}) } })
  }

  /** Clear discarded editor state when leaving security mode.
   * @param id - composer whose security editors unmounted.
   */
  reset(id: SessionId): void {
    const previous = this.state.getSnapshot()[id]
    this.state.set({ ...this.state.getSnapshot(), [id]: { busy: false, revision: (previous?.revision ?? 0) + 1 } })
  }

  /** Track the independent checked-tool editor without changing task configuration.
   * @param id - owning composer.
   * @param patch - changed tool editor state.
   */
  tools(id: SessionId, patch: { toolsDirty?: boolean; toolsBusy?: boolean }): void {
    const previous = this.state.getSnapshot()[id] ?? { busy: false, revision: 0 }
    if (Object.entries(patch).every(([key, value]) => previous[key as keyof FirstMessageState] === value)) return
    this.state.set({ ...this.state.getSnapshot(), [id]: { ...previous, ...patch } })
  }

  /** Require an explicit save before copying edited task settings.
   * @param id - composer with unsaved configuration.
   */
  edited(id: SessionId): void {
    const previous = this.state.getSnapshot()[id] ?? { busy: false, revision: 0 }
    this.state.set({ ...this.state.getSnapshot(), [id]: { ...previous, needsSave: true } })
  }

  /** Publish hints only when the selected conversations or localized copy changed.
   * @param ids - blank security conversations without an existing task.
   * @param placeholder - localized first-message hint.
   */
  present(ids: readonly SessionId[], placeholder: string): void {
    const current = this.presentations.getSnapshot()
    if (current.size === ids.length && ids.every(id => current.get(id)?.composerPlaceholder === placeholder)) return
    this.presentations.set(new Map(ids.map(id => [id, { composerPlaceholder: placeholder }])))
  }

  /** Reject a send while task or checked-tool edits are unsaved or being checked.
   * @param id - composer whose current editor state controls admission. */
  requireReady(id: SessionId): void {
    const state = this.state.getSnapshot()[id]
    if (state?.needsSave || state?.toolsDirty) throw new Error(this.failure('unsaved'))
    if (state?.toolsBusy) throw new Error(this.failure('tools-busy'))
  }

  /** Prepare once, surfacing a recoverable failure without starting a model request.
   * @param id - authenticated destination conversation.
   * @returns completion after its task association exists.
   */
  run(id: SessionId): Promise<void> {
    try { this.requireReady(id) } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const existing = this.pending.get(id)
    if (existing) return existing
    const revision = this.state.getSnapshot()[id]?.revision ?? 0
    this.state.set({ ...this.state.getSnapshot(), [id]: { busy: true, revision } })
    let failure = this.failure('unknown')
    const pending = Promise.resolve().then(async () => {
      const result = await this.prepare(id)
      if (!result.ok) { failure = this.failure(result.error.code); throw result.error }
    }).then(() => {
      this.state.set({ ...this.state.getSnapshot(), [id]: { busy: false, revision } })
    }).catch((error: unknown) => {
      const message = failure
      this.state.set({ ...this.state.getSnapshot(), [id]: { busy: false, revision: revision + 1, error: message } })
      throw new Error(message, { cause: error })
    }).finally(() => { this.pending.delete(id) })
    this.pending.set(id, pending)
    return pending
  }

  /** Drain requests before their Remote service is removed.
   * @returns completion after all first-message preparations settle.
   */
  async close(): Promise<void> { await Promise.allSettled(this.pending.values()) }
}
