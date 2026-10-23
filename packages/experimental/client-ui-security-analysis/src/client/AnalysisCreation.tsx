/** Environment-only setup with an idempotent native conversation creation receipt. @module */
import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkspaceResources } from './WorkspaceResources.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Authenticated workspace creation actions; no method submits a model message. */
export interface AnalysisCreationActions {
  configurationForWorkspace(id: WorkspaceId): Promise<WorkbenchConfiguration>
  configureAnalysisWorkspace(id: WorkspaceId, input: string): Promise<WorkbenchConfiguration>
  startAnalysis(id: WorkspaceId, input: string): Promise<{ sessionId: SessionId; projectId: string }>
  openChat(id: SessionId): void
}

/** Resolve existing defaults and enter chat directly, showing setup only when required.
 * @param props - chosen native workspace and operator actions.
 * @returns environment setup or a recoverable creation error. */
export function AnalysisCreation(props: AnalysisCreationActions & PropsLocale<typeof NS> & { workspaceId: WorkspaceId }) {
  const { t, workspaceId } = props
  const [configuration, setConfiguration] = useState<WorkbenchConfiguration>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef({ operationId: randomUUID(), sessionId: randomUUID(), title: t('newAnalysisName') })
  const generation = useRef(0)
  const request = useRef<string>()
  const create = async (config: WorkbenchConfiguration, current: number) => {
    const workspace = config.workspace
    if (!workspace?.environmentIds.length || workspace.maxAttempts === undefined) return
    request.current ??= JSON.stringify({ ...attempt.current, environmentIds: workspace.environmentIds })
    const result = await props.startAnalysis(workspaceId, request.current)
    if (generation.current === current) props.openChat(result.sessionId)
  }
  const run = async (action: () => Promise<WorkbenchConfiguration>) => {
    const current = generation.current
    setBusy(true); setError('')
    try {
      const config = await action()
      if (current !== generation.current) return
      setConfiguration(config)
      await create(config, current)
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  useEffect(() => {
    generation.current++
    void run(() => props.configurationForWorkspace(workspaceId))
    return () => { generation.current++ }
  }, [workspaceId])
  return <section className={css.creation} aria-label={t('newAnalysis')}>
    <h2>{t('newAnalysis')}</h2><p>{t('analysisEnvironmentHint')}</p>
    {error && <p role="alert">{error}<button disabled={busy} onClick={() => void run(() => configuration
      ? Promise.resolve(configuration) : props.configurationForWorkspace(workspaceId))}>{t('dashboardRetry')}</button></p>}
    {configuration?.workspace && (!configuration.workspace.environmentIds.length || configuration.workspace.maxAttempts === undefined)
      && <WorkspaceResources environmentOnly t={t} workspace={configuration.workspace} environments={configuration.environments}
        taskContextMaxBytes={configuration.taskContextMaxBytes} disabled={busy}
        save={input => run(() => props.configureAnalysisWorkspace(workspaceId, JSON.stringify(input)))} />}
    {busy && <span role="status">{t('dashboardLoading')}</span>}
  </section>
}
