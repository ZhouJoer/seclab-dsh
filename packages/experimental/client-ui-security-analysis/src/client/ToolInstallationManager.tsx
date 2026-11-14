/** Reviewed installation plans and durable operation progress for authenticated operators. @module */
import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ManagedToolInstallation, ToolInstallationFrame, ToolInstallationOperation, ToolInstallationPhase, ToolInstallationPlan,
  ToolInstallationRecipeSummary, ToolInstallationRequest, ToolInstallationRoot, ToolboxEnvironment } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './ToolInstallationManager.module.css'

/** Narrow authenticated installation actions; disconnecting follow never cancels an operation. */
export interface ToolInstallationActions {
  root(this: void): Promise<ToolInstallationRoot>
  setRoot(this: void, path: string, revision: number): Promise<ToolInstallationRoot>
  recipes(this: void): Promise<ToolInstallationRecipeSummary[]>
  preview(this: void, request: ToolInstallationRequest): Promise<ToolInstallationPlan>
  apply(this: void, planId: ToolInstallationPlan['id'], digest: string, requestId: string, confirmations: string[]): Promise<ToolInstallationOperation>
  get(this: void, id: ToolInstallationOperation['id']): Promise<ToolInstallationOperation>
  list(this: void): Promise<{ operations: ToolInstallationOperation[]; installations: ManagedToolInstallation[] }>
  follow(this: void, id: ToolInstallationOperation['id'], afterCursor: number, signal: AbortSignal): AsyncIterable<ToolInstallationFrame>
  cancel(this: void, id: ToolInstallationOperation['id']): Promise<ToolInstallationOperation>
  reconcile(this: void, id: ToolInstallationOperation['id']): Promise<ToolInstallationOperation>
  previewRemoval(this: void, id: ManagedToolInstallation['id']): Promise<ToolInstallationPlan>
  pickInstallationDirectory(this: void): Promise<{ path: string | null; browse: boolean }>
  listInstallationDirectory(this: void, path?: string): Promise<{
    path: string
    parent?: string
    entries: { name: string; path: string }[]
  }>
  subscribeReset?(this: void, listener: () => void): () => void
}

const phases = { planned: 'installationPlanned', preparing: 'installationPreparing', installing: 'installationInstalling',
  verifying: 'installationVerifying', committing: 'installationCommitting', cancelling: 'installationCancelling', completed: 'installationCompleted',
  cancelled: 'installationCancelled', failed: 'installationFailed', interrupted: 'installationInterrupted',
  'needs-reconciliation': 'installationUnknown', 'installed-unbound': 'installationUnbound' } as const
const running = (phase: ToolInstallationPhase): boolean => ['planned', 'preparing', 'installing', 'verifying', 'committing', 'cancelling'].includes(phase)
const uncertain = (phase: ToolInstallationPhase): boolean => ['interrupted', 'needs-reconciliation', 'installed-unbound'].includes(phase)

/** Present a root picker, explicit plan review and bounded durable logs.
 * @param props - authenticated actions, selected environment and localized labels.
 * @returns installation management within the tool directory.
 */
export function ToolInstallationManager(props: PropsLocale<typeof NS> & {
  actions: ToolInstallationActions
  environmentId: string
  environments: ToolboxEnvironment[]
  onChanged(this: void): void
  notify?(this: void, message: string): void
}) {
  const { actions, environmentId, environments, t } = props
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [root, setRoot] = useState<ToolInstallationRoot>(), [path, setPath] = useState('')
  const [recipes, setRecipes] = useState<ToolInstallationRecipeSummary[]>([]), [recipe, setRecipe] = useState('')
  const [action, setAction] = useState<'install' | 'repair' | 'upgrade'>('install')
  const [history, setHistory] = useState<ToolInstallationOperation[]>([])
  const [installations, setInstallations] = useState<ManagedToolInstallation[]>([])
  const [preview, setPreview] = useState<ToolInstallationPlan>()
  const [confirmed, setConfirmed] = useState(false), [accepted, setAccepted] = useState<string[]>([])
  const [operation, setOperation] = useState<ToolInstallationOperation>(), [gap, setGap] = useState(false)
  const [browse, setBrowse] = useState<Awaited<ReturnType<ToolInstallationActions['listInstallationDirectory']>>>()
  const [reset, setReset] = useState(0)
  const generation = useRef(0), requestId = useRef(''), rootDraftDirty = useRef(false)
  const selectedOperation = useRef<ToolInstallationOperation['id'] | undefined>(undefined)
  selectedOperation.current = operation?.id
  const callbacks = useRef({ onChanged: props.onChanged, notify: props.notify, t })
  callbacks.current = { onChanged: props.onChanged, notify: props.notify, t }
  useEffect(() => actions.subscribeReset?.(() => { setReset(value => value + 1) }), [actions])
  useEffect(() => {
    const current = ++generation.current
    const selectedId = selectedOperation.current
    setPreview(undefined); setConfirmed(false); setAccepted([]); setOperation(undefined); setGap(false)
    if (!open) return
    setBusy(true); setError('')
    void Promise.all([actions.root(), actions.recipes(), actions.list()]).then(([root, recipes, list]) => {
      if (generation.current !== current) return
      setRoot(root)
      if (!rootDraftDirty.current) setPath(root.toolRoot ?? '')
      setRecipes(recipes); setHistory(list.operations); setInstallations(list.installations)
      const active = list.operations.find(item => item.id === selectedId)
        ?? list.operations.find(item => item.environmentId === environmentId && running(item.phase))
      setOperation(active)
    }).catch((error: unknown) => { if (generation.current === current) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (generation.current === current) setBusy(false) })
    return () => { generation.current++ }
  }, [actions, environmentId, open, reset])

  useEffect(() => {
    if (!operation || !running(operation.phase)) return
    const controller = new AbortController(), id = operation.id, cursor = operation.cursor, current = generation.current
    void (async () => {
      for await (const frame of actions.follow(id, cursor, controller.signal)) {
        if (controller.signal.aborted) return
        setGap(value => value || frame.gap)
        setOperation((previous) => {
          const logs = previous?.id === id ? previous.logs.filter(item => item.cursor >= frame.retainedFromCursor) : []
          const combined = new Map([...logs, ...frame.operation.logs].map(item => [item.cursor, item]))
          return { ...frame.operation, logs: [...combined.values()] }
        })
        setHistory(items => [frame.operation, ...items.filter(item => item.id !== id)])
        if (!running(frame.operation.phase)) {
          callbacks.current.onChanged()
          callbacks.current.notify?.(callbacks.current.t('installationFinished'))
          const list = await actions.list()
          if (generation.current === current) { setHistory(list.operations); setInstallations(list.installations) }
        }
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error))
    })
    return () => { controller.abort() }
  }, [actions, operation?.id, operation && running(operation.phase), reset])

  const perform = async (run: (wait: <T>(result: Promise<T>) => Promise<T>) => Promise<void>) => {
    const current = generation.current
    setBusy(true); setError('')
    try { await run(async (result) => {
      const value = await result
      if (generation.current !== current) throw new Error('Installation view changed')
      return value
    }) }
    catch (error) {
      if (generation.current === current) {
        setError(error instanceof Error ? error.message : String(error))
        props.notify?.(t('installationActionError'))
      }
    } finally { if (generation.current === current) setBusy(false) }
  }
  const showPreview = (plan: ToolInstallationPlan) => {
    setPreview(plan); setConfirmed(false); setAccepted([]); requestId.current = randomUUID()
  }
  const refresh = async () => {
    const current = generation.current
    const [currentRoot, list] = await Promise.all([actions.root(), actions.list()])
    if (generation.current !== current) return
    setRoot(currentRoot); setHistory(list.operations); setInstallations(list.installations)
  }
  const environment = environments.find(item => item.id === environmentId)
  const choices = recipes.filter(item => item.environments.some(kind => kind === environment?.kind))
  const selected = choices.find(item => item.id === recipe)?.id ?? choices[0]?.id ?? ''
  const disabled = busy || !root?.writable
  return <section>
    <button aria-expanded={open} onClick={() => { setOpen(value => !value) }}>{t('installationManage')}</button>
    {open && <div className={css.manager} aria-label={t('installationManage')} aria-busy={busy}>
      <p>{t('installationRootHelp')}</p>
      {root && !root.writable && <p role="status">{t('installationReadOnly')} · {root.detail}</p>}
      <fieldset disabled={disabled}>
        <label className={css.field}>{t('installationRoot')}<input value={path} onChange={(event) => { rootDraftDirty.current = true; setPath(event.target.value); setPreview(undefined) }} /></label>
        <div className={css.row}>
          <button onClick={() => void perform(async (wait) => {
            const result = await wait(actions.pickInstallationDirectory())
            if (result.path) { rootDraftDirty.current = true; setPath(result.path); setPreview(undefined) }
            if (result.browse) setBrowse(await wait(actions.listInstallationDirectory(path || undefined)))
          })}>{t('installationChooseDirectory')}</button>
          <button disabled={!path.trim() || path === root?.toolRoot} onClick={() => void perform(async (wait) => {
            if (!root) return
            const current = await wait(actions.setRoot(path, root.revision))
            rootDraftDirty.current = false; setRoot(current); setPath(current.toolRoot ?? ''); setPreview(undefined)
          })}>{t('installationSaveRoot')}</button>
        </div>
        {browse && <section className={css.review} aria-label={t('installationBrowse')}>
          <p className={css.path}>{browse.path}</p>
          <div className={css.row}>
            {browse.parent && <button onClick={() => void perform(async (wait) => {
              setBrowse(await wait(actions.listInstallationDirectory(browse.parent)))
            })}>{t('installationParent')}</button>}
            <button onClick={() => { rootDraftDirty.current = true; setPath(browse.path); setBrowse(undefined); setPreview(undefined) }}>{t('installationChooseCurrent')}</button>
          </div>
          <ul className={css.list}>{browse.entries.map(entry => <li key={entry.path}>
            <button className={css.path} onClick={() => void perform(async (wait) => {
              setBrowse(await wait(actions.listInstallationDirectory(entry.path)))
            })}>{entry.name}</button>
          </li>)}</ul>
        </section>}
        <label className={css.field}>{t('installationRecipe')}<select value={selected} onChange={(event) => { setRecipe(event.target.value); setPreview(undefined) }}>
          {choices.map(item => <option key={item.id} value={item.id}>{item.id} · {item.version}</option>)}
        </select></label>
        {!choices.length && <p>{t('installationNoRecipes')}</p>}
        <label className={css.field}>{t('installationAction')}<select value={action} onChange={(event) => {
          const value = event.target.value
          if (value === 'install' || value === 'repair' || value === 'upgrade') { setAction(value); setPreview(undefined) }
        }}>
          <option value="install">{t('installationInstall')}</option><option value="repair">{t('installationRepair')}</option><option value="upgrade">{t('installationUpgrade')}</option>
        </select></label>
        {!root?.toolRoot && <p>{t('installationNoRoot')}</p>}
        <button disabled={!root?.toolRoot || !selected} onClick={() => void perform(async (wait) => {
          showPreview(await wait(actions.preview({ recipeId: selected, environmentId, action, options: {} })))
        })}>{t('installationPreview')}</button>
      </fieldset>
      {preview && <section className={css.review} aria-label={t('installationReview')}>
        <h3>{t('installationReview')}</h3>
        <p>{preview.toolIds.join(', ')}</p>
        <dl><dt>{t('installationVersion')}</dt><dd>{preview.version}</dd><dt>{t('installationDestination')}</dt><dd>{preview.destination}</dd></dl>
        {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        <details><summary>{t('installationSteps')}</summary><ol>{preview.steps.map(step => <li key={step.id}>
          <p>{step.description}</p>
          {step.url && <p className={css.path}>{step.url}</p>}{step.sha256 && <code className={css.path}>{step.sha256}</code>}
          {step.command && <pre className={css.logs}>{[step.command, ...step.args ?? []].map(item => JSON.stringify(item)).join(' ')}</pre>}
        </li>)}</ol></details>
        <fieldset disabled={disabled}>
          {preview.confirmations.length > 0 && <p>{t('installationExceptions')}</p>}
          {preview.confirmations.map(item => <label key={item.id}><input type="checkbox" checked={accepted.includes(item.id)} onChange={(event) => {
            setAccepted(values => event.target.checked ? [...values, item.id] : values.filter(value => value !== item.id))
          }} /> {item.description}</label>)}
          <label><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked) }} /> {t('installationConsent')}</label>
          <div className={css.row}>
            <button disabled={!confirmed || preview.confirmations.some(item => !accepted.includes(item.id))}
              onClick={() => void perform(async (wait) => {
                const result = await wait(actions.apply(preview.id, preview.digest, requestId.current, accepted))
                setOperation(result); setGap(false); setPreview(undefined)
                if (!running(result.phase)) { await wait(refresh()); props.onChanged() }
              })}>{t('installationConfirm')}</button>
            <button onClick={() => { setPreview(undefined) }}>{t('installationDiscard')}</button>
          </div>
        </fieldset>
      </section>}
      {error && <div role="alert"><p>{t('installationActionError')}</p><details><summary>{t('installationErrorDetails')}</summary><p className={css.path}>{error}</p></details></div>}
      {operation && <section className={css.review} aria-label={t('installationLogs')}>
        <h3>{operation.recipeId} · {t(phases[operation.phase])}</h3>
        {operation.failure && <p>{operation.failure.detail}</p>}
        {(gap || operation.logsTruncated) && <p className={css.notice}>{t('installationLogGap')}</p>}
        <pre className={css.logs}>{operation.logs.map(item => item.text).join('')}</pre>
        <div className={css.row}>
          {running(operation.phase) && <button disabled={disabled || operation.phase === 'committing' || operation.phase === 'cancelling'} onClick={() => void perform(async (wait) => {
            setOperation(await wait(actions.cancel(operation.id))); await wait(refresh()); props.onChanged()
          })}>{t('installationCancel')}</button>}
          {uncertain(operation.phase) && <button disabled={disabled} onClick={() => void perform(async (wait) => {
            setOperation(await wait(actions.reconcile(operation.id))); await wait(refresh())
          })}>{t('installationReconcile')}</button>}
        </div>
      </section>}
      <div className={css.row}><h3>{t('installationHistory')}</h3><button disabled={busy} onClick={() => void perform(refresh)}>{t('installationRefresh')}</button></div>
      {!history.length && <p>{t('installationEmpty')}</p>}
      <ul className={css.list}>{history.map(item => <li key={item.id}><button onClick={() => void perform(async (wait) => {
        setOperation(await wait(actions.get(item.id))); setGap(false)
      })}>{item.recipeId} · {item.environmentId} · {t(phases[item.phase])}</button></li>)}</ul>
      {installations.length > 0 && <><h3>{t('installationOwned')}</h3><ul className={css.list}>{installations.map(item => <li key={item.id}>
        <p>{item.toolId} · {item.version} · {t(item.ownership === 'managed' ? 'installationPrivate' : item.ownership === 'external' ? 'installationExternal' : 'installationSystem')}</p>
        <p className={css.path}>{item.location}</p>
        {item.ownership === 'managed' && <button disabled={disabled} onClick={() => void perform(async (wait) => {
          showPreview(await wait(actions.previewRemoval(item.id)))
        })}>{t('installationRemove')}</button>}
      </li>)}</ul></>}
    </div>}
  </section>
}
