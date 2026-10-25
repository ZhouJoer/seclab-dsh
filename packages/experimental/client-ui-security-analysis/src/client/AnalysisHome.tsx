/** Shared workbench destination and environment-only creation surface. @module */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Dashboard, type DashboardActions } from './Dashboard.tsx'
import { AnalysisCreation, type AnalysisCreationActions } from './AnalysisCreation.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** View selection owned by this client plugin instance. */
export type AnalysisDestination = { kind: 'overview' } | { kind: 'create'; workspaceId?: WorkspaceId }
  | { kind: 'project'; projectId: string; sessionId?: SessionId }
/** Navigation source bound by the renderer. */
export interface AnalysisHomeInjected {
  hooks: { destination: ObservableSnapshot<AnalysisDestination> }
}

/** Render creation or the exact task requested by native navigation.
 * @param props - native workspace facts, task actions and shared destination.
 * @returns the selected analysis surface. */
export function AnalysisHome(props: DashboardActions & AnalysisCreationActions & InjectFace<AnalysisHomeInjected>
  & PropsLocale<typeof NS> & PropsRuntime<'main'> & PropsRenderSlots<'security.workbench.session'>) {
  const destination = props.useDestination(value => value)
  const workspaces = props.useWorkspaces(value => value.items)
  const [selected, setSelected] = useState<WorkspaceId>()
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  if (destination.kind !== 'create') return <Dashboard {...props}
    renderSettings={input => props.renderSlot('security.workbench.session', input)}
    destination={destination.kind === 'project' ? destination : undefined} />
  const workspaceId = destination.workspaceId ?? selected ?? workspaces[0]?.workspaceId
  return <section className={css.root}>
    <div className={css.main}>
      <button onClick={() => { props.selectDestination('') }}>{props.t('dashboardBack')}</button>
      {workspaceId ? <AnalysisCreation key={workspaceId} {...props} workspaceId={workspaceId} /> : <section className={css.creation}>
        <h2>{props.t('newAnalysis')}</h2><p>{props.t('dashboardNoWorkspace')}</p>
        <label>{props.t('dashboardWorkspacePath')}<input value={path} onChange={(event) => { setPath(event.target.value) }} /></label>
        {error && <p role="alert">{error}</p>}
        <button disabled={adding || !path.trim()} onClick={() => {
          setAdding(true); setError('')
          void props.createWorkspace(path.trim()).then(setSelected).catch((error: unknown) => { setError(String(error)) })
            .finally(() => { setAdding(false) })
        }}>{props.t('dashboardAddWorkspace')}</button>
      </section>}
    </div>
  </section>
}
