/** Staged Helper preferences and independently refreshed account/model metadata. */
import type { HelperSettings } from '@deepseek-ai/dsh-helper/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'

/** Selectable exact route and its advertised reasoning levels. */
export interface Candidate { key: string; provider: string; id: string; name: string; efforts: string[] }
/** Public account state; credentials stay in the Codex process. */
export interface Account { loggedIn: boolean; email?: string; planType?: string; login?: { loginId: string; status: 'pending' | 'completed' | 'failed'; error?: string } }
/** Directory operations supplied by the browser plugin. */
export interface DirectoryActions {
  loginFailed: () => string
  api: () => Promise<Candidate[]>
  codex: () => Promise<Candidate[]>
  account: () => Promise<Account>
  login: () => Promise<{ authUrl: string; loginId: string }>
  cancelLogin: (id: string) => Promise<void>
  test: (workspaceId: WorkspaceId) => Promise<void>
}
/** All fields staged by the Helper page. */
export const fields = ['enabled', 'mode', 'backend', 'provider', 'model', 'reasoningEffort', 'codexModel', 'codexReasoningEffort'] as const
/** Editable form values with the shared save state. */
export interface FormState extends SettingsFormShell { values: Record<typeof fields[number], string> }
/** Account and catalogs can fail independently. */
export interface DirectoryState {
  api: Candidate[]
  codex: Candidate[]
  account: Account | null
  loading: boolean
  error: string
  authUrl: string
  loginId: string
  busy: boolean
}
/** Observable state and actions injected into the settings view. */
export interface HelperFace extends SettingsFormActions {
  hooks: { helperForm: SnapshotStore<FormState>; helperDirectory: SnapshotStore<DirectoryState> }
  refresh: () => void
  login: () => void
  cancelLogin: () => void
  test: (workspaceId: WorkspaceId) => void
  chooseModel: (backend: string, key: string) => void
}
/** Own form subscriptions and fence metadata responses across reconnects. */
export class HelperController {
  private readonly form: SettingsFormModel<HelperSettings>
  private readonly state: SnapshotStore<FormState>
  private readonly directory = createSnapshotStore<DirectoryState>({ api: [], codex: [], account: null, loading: false, error: '', authUrl: '', loginId: '', busy: false })
  private generation = 0
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param scope Host preference section.
   * @param actions Account and model RPCs.
   */
  constructor(scope: SettingsFormScope<HelperSettings>, private readonly actions: DirectoryActions) {
    this.form = new SettingsFormModel(scope, fields.map(field => ({ field,
      format: value => typeof value === 'string' || typeof value === 'boolean' ? String(value) : '',
      parse: text => text === '__choose__' ? undefined : { kind: 'set', value: field === 'enabled' ? text === 'true' : text },
    })))
    this.state = this.form.bind(() => ({ ...this.form.shell(), values: {
      enabled: this.form.field('enabled').text, mode: this.form.field('mode').text, backend: this.form.field('backend').text,
      provider: this.form.field('provider').text, model: this.form.field('model').text,
      reasoningEffort: this.form.field('reasoningEffort').text, codexModel: this.form.field('codexModel').text,
      codexReasoningEffort: this.form.field('codexReasoningEffort').text,
    } }))
  }

  /**
   * Bind the settings view to this controller.
   * @returns Settings view actions and observable sources.
   */
  inject(): HelperFace {
    return { ...this.form.actions(), hooks: { helperForm: this.state, helperDirectory: this.directory },
      refresh: () => { void this.refresh() },
      login: () => { void this.perform(async () => {
        const login = await this.actions.login()
        if (this.disposed) return
        this.directory.update((state) => { state.authUrl = login.authUrl; state.loginId = login.loginId })
        this.pollLogin()
      }) },
      cancelLogin: () => { void this.perform(async () => {
        await this.actions.cancelLogin(this.directory.getSnapshot().loginId)
        if (this.disposed) return
        clearTimeout(this.timer)
        this.directory.update((state) => { state.loginId = ''; state.authUrl = '' })
      }) },
      test: (workspaceId) => { void this.perform(() => this.actions.test(workspaceId)) },
      chooseModel: (backend, key) => {
        const api = backend === 'api'
        const selected = this.directory.getSnapshot()[api ? 'api' : 'codex'].find(item => item.key === key)
        if (!selected) return
        const edit = this.form.actions().edit
        edit(api ? 'model' : 'codexModel', selected.id)
        if (api) edit('provider', selected.provider)
        edit(api ? 'reasoningEffort' : 'codexReasoningEffort', selected.efforts.includes('high') ? 'high' : '__choose__')
      },
    }
  }

  /** Refresh both backends; a failed catalog leaves its saved selection visible. */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    this.directory.update((state) => { state.loading = true; state.error = '' })
    const results = await Promise.allSettled([this.actions.api(), this.actions.codex(), this.actions.account()])
    if (this.disposed || generation !== this.generation) return
    this.directory.update((state) => {
      state.loading = false
      state.error = results.filter(item => item.status === 'rejected').map(item => String(item.reason)).join('\n')
      if (results[0].status === 'fulfilled') state.api = results[0].value
      if (results[1].status === 'fulfilled') state.codex = results[1].value
      if (results[2].status === 'fulfilled') state.account = results[2].value
    })
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    this.directory.update((state) => { state.busy = true; state.error = '' })
    try { await action() }
    catch (error) { if (!this.disposed) this.directory.update((state) => { state.error = String(error) }) }
    finally { if (!this.disposed) this.directory.update((state) => { state.busy = false }) }
  }

  private pollLogin(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.perform(async () => {
        const account = await this.actions.account()
        if (this.disposed) return
        const loginId = this.directory.getSnapshot().loginId
        const outcome = account.login?.loginId === loginId ? account.login : undefined
        this.directory.update((state) => {
          state.account = account
          if (outcome && outcome.status !== 'pending') { state.loginId = ''; state.authUrl = '' }
        })
        if (outcome?.status === 'failed') throw new Error(outcome.error || this.actions.loginFailed())
        if (outcome?.status === 'completed') await this.refresh()
        else if (loginId) this.pollLogin()
      })
    }, 2000)
  }

  /** Release form subscriptions, login polling and pending metadata responses. */
  dispose(): void { this.disposed = true; ++this.generation; clearTimeout(this.timer); this.form.dispose() }
}
