/** First-send task settings with explicit workspace-default actions. @module */
import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchConfiguration, SecurityProjectSummary } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Button, IconShieldOutlineRegular, IconChevronDownOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorkspaceResources } from './WorkspaceResources.tsx'
import { ToolPreferences, type ToolPreferenceActions } from './ToolPreferences.tsx'
import type { FirstMessageState } from './first-message.ts'
import type { SecurityDirectorySnapshot } from './directory.ts'
import type { NS } from './locales.ts'
import css from './FirstMessageSetup.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Workspace defaults used only before the first security task association. */
    'security-startup': WorkbenchConfiguration
  }
}

/** Session-addressed setup actions and preparation feedback. */
export interface FirstMessageSetupInjected extends ToolPreferenceActions {
  hooks: {
    preparation: ObservableSnapshot<Readonly<Record<string, FirstMessageState>>>
    directory: ObservableSnapshot<SecurityDirectorySnapshot>
  }
  /** Save settings for this conversation before admitting the draft.
   * @param id - current composer.
   * @param input - serialized revision-checked task settings, or null settings to reset.
   * @returns completion after the task configuration is saved.
   */
  saveSetup(id: SessionId, input: string): Promise<void>
  /** Copy saved task settings into workspace defaults.
   * @param id - current composer.
   * @param input - revision-checked workspace update.
   * @returns completion after the workspace defaults are saved.
   */
  saveDefaults(id: SessionId, input: string): Promise<void>
  /** Refresh the displayed setup.
   * @param id - current composer.
   */
  refreshSetup(id: SessionId): void
  /** Mark unsaved edits so Send cannot silently copy older settings.
   * @param id - current composer.
   */
  editSetup(id: SessionId): void
  /** Track unsaved checked-tool edits. @param id - composer. @param dirty - whether edits remain unapplied. */
  editTools(id: SessionId, dirty: boolean): void
  /** Track tool readiness checks. @param id - composer. @param ready - whether preparation may proceed. */
  toolsReady(id: SessionId, ready: boolean): void
}
type Props = Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId' | 'useSessions' | 'useResource'>
  & PropsLocale<typeof NS> & InjectFace<FirstMessageSetupInjected>

function SetupDetails(props: Props) {
  const { sessionId, t } = props
  const state = props.usePreparation(value => value[sessionId])
  const resource = props.useResource<'security-startup'>(`dsh-resource://security-startup/${encodeURIComponent(sessionId)}?revision=${state?.revision ?? 0}`)
  const config = resource.value
  const workspace = config?.workspace
  const custom = config?.startup?.settings
  const settings = custom ?? workspace
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const summary = useRef<HTMLElement>(null)
  const missing = !!settings && (!settings.environmentIds.length || settings.maxAttempts === undefined
    || settings.environmentIds.some(id => !config?.environments.some(environment => environment.id === id)))
  const authorization = settings?.taskContext?.authorization
  const expired = authorization?.expiresAt !== undefined && authorization.expiresAt <= Date.now()
  const environments = settings?.environmentIds.map(id => config?.environments.find(environment => environment.id === id)?.label ?? id).join('、')
  const sameAsDefaults = !!custom && !!workspace && JSON.stringify([custom.environmentIds, custom.maxAttempts,
    custom.taskContext ?? null, custom.unsealed ?? false, custom.moduleSelection]) === JSON.stringify([workspace.environmentIds,
    workspace.maxAttempts, workspace.taskContext ?? null, workspace.unsealed ?? false, workspace.moduleSelection])
  const save = async (operation: () => Promise<void>) => {
    setSaving(true); setError('')
    try { await operation() }
    catch (_error) { setError(t('startupSaveFailed')) }
    finally { setSaving(false) }
  }
  const cancelEdits = () => { setError(''); props.refreshSetup(sessionId); setExpanded(false); summary.current?.focus() }
  return <section className={css.setup} aria-label={t('startupTitle')} aria-busy={state?.busy || saving}>
    <details open={expanded || missing || !!state?.error} onToggle={(event) => {
      const open = event.currentTarget.open
      if (!open && state?.needsSave && !saving && !state.busy) cancelEdits()
      else setExpanded(open)
    }}>
      <summary ref={summary}>
        <IconShieldOutlineRegular size={16} />
        <span className={css.summary}>
          <strong>{t('startupSelected')}</strong>
          <span>{t(state?.needsSave ? 'startupModified' : custom ? 'startupTaskSettings' : 'startupWorkspaceDefaults')}</span>
          <span>{environments || t('startupChooseEnvironment')}</span>
          <span>{t(settings?.unsealed ? 'unsealOn' : 'unsealOff')}</span>
          <span data-warning={expired || undefined}>{t(expired ? 'startupAuthorizationExpired' : authorization ? 'taskContextDeclared' : 'taskContextNotDeclared')}</span>
        </span>
        <span className={css.configure}>{t('startupConfigure')}<IconChevronDownOutlineRegular className={css.chevron} size={16} /></span>
      </summary>
      <div className={css.fields}>
        {resource.status === 'loading' && <div role="status" aria-label={t('dashboardLoading')}><StateDot state="ongoing" /></div>}
        {resource.status === 'failed' && <p role="alert">{t('dashboardReadFailed')}
          <button onClick={() => { props.refreshSetup(sessionId) }}>{t('dashboardRetry')}</button></p>}
        {config && workspace && settings && <WorkspaceResources
          key={`${workspace.cwd}:${workspace.revision}:${config.startup?.revision ?? 0}:${state?.revision ?? 0}`} t={t}
          workspace={{ ...workspace, ...settings, taskContext: settings.taskContext, unsealed: settings.unsealed,
            moduleSelection: settings.moduleSelection, revision: config.startup?.revision ?? 0 }}
          task modified={!!state?.needsSave} taskSaved={!!custom} cancelEdits={cancelEdits}
          cancel={() => void save(() => props.saveSetup(sessionId,
            JSON.stringify({ expectedRevision: config.startup?.revision ?? 0, settings: null })))}
          environments={config.environments} taskContextMaxBytes={config.taskContextMaxBytes}
          onEdit={() => { props.editSetup(sessionId) }}
          disabled={saving || !!state?.busy || !!state?.toolsDirty || !!state?.toolsBusy}
          save={async ({ expectedRevision: _revision, ...value }) => {
            await save(() => props.saveSetup(sessionId,
              JSON.stringify({ expectedRevision: config.startup?.revision ?? 0, settings: value })))
          }} />}
        {custom && workspace && !state?.needsSave && !sameAsDefaults && <div className={css.actions}>
          <Button size="sm" disabled={saving || !!state?.busy || !!state?.toolsDirty || !!state?.toolsBusy}
            onClick={() => void save(() => props.saveDefaults(sessionId,
              JSON.stringify({ expectedRevision: workspace.revision, ...custom, taskContext: custom.taskContext ?? null })))}>
            {t('startupSetDefaults')}</Button>
        </div>}
        <ToolPreferences key={`${workspace?.cwd}:${workspace?.revision}:${config?.startup?.revision ?? 0}`}
          t={t} sessionId={sessionId} compact disabled={saving || !!state?.busy || !!state?.needsSave}
          toolPreferenceOptions={props.toolPreferenceOptions} toolPreferences={props.toolPreferences}
          onDirtyChange={(dirty) => { props.editTools(sessionId, dirty) }}
          onReadyChange={(ready) => { props.toolsReady(sessionId, ready) }} />
      </div>
    </details>
    {state?.busy && <p className={css.hint} role="status"><StateDot state="ongoing" />{t('startupPreparing')}</p>}
    {(state?.error || error) && <p role="alert" className={css.error}>{error || state?.error}</p>}
  </section>
}

function AssociatedSetup(props: Props & { project: SecurityProjectSummary['project'] }) {
  const { t, sessionId, project } = props
  return <section className={css.setup} aria-label={t('startupTitle')}>
    <details>
      <summary>
        <IconShieldOutlineRegular size={16} />
        <span className={css.summary}>
          <strong>{t('startupTaskSettings')}</strong>
          <span>{t('environment')}: {project.environmentIds.join('、')}</span>
        </span>
        <span className={css.configure}>{t('startupConfigure')}<IconChevronDownOutlineRegular className={css.chevron} size={16} /></span>
      </summary>
      <div className={css.fields}>
        <ToolPreferences {...props} compact eager
          onDirtyChange={(dirty) => { props.editTools(sessionId, dirty) }}
          onReadyChange={(ready) => { props.toolsReady(sessionId, ready) }} />
      </div>
    </details>
  </section>
}

/** Show first-send settings, including retained selections for an associated restart draft.
 * @param props - framework session facts, directory and workspace setup actions.
 * @returns selected mode and compact settings before association.
 */
export function FirstMessageSetup(props: Props) {
  const preset = props.useSessions(value => value.byId[props.sessionId]?.projectionValues?.agentPreset)
  const blank = props.useSessions(value => value.byId[props.sessionId]?.blank)
  const associated = props.useDirectory(value => value.projects.find(project =>
    project.sessions.some(session => session.sessionId === props.sessionId))?.project)
  if (!blank) return null
  if (preset !== 'security') return <div className={css.ordinary} role="status">{props.t('startupOrdinary')}</div>
  if (associated) return <AssociatedSetup {...props} project={associated} />
  return <SetupDetails {...props} />
}
