/** Collapsible task-level authorization and background editor. @module */
import { useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveTaskContext, type TaskContext } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { TaskContextFields, taskContextIssue } from './TaskContextFields.tsx'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Show saved declaration status without expanding the optional form.
 * @param props - saved context, configured byte limit and explicit operator actions.
 * @returns collapsed editor; folding retains unsaved input.
 */
export function ProjectTaskContext(props: PropsLocale<typeof NS> & {
  value: TaskContext | undefined
  maxBytes: number | undefined
  disabled: boolean
  loading?: boolean
  workspace?: { cwd: string; taskContext?: TaskContext } | undefined
  prepare?(this: void): void
  save(value: TaskContext | null): Promise<boolean>
  saveDefaults?: ((value: TaskContext | null) => Promise<boolean>) | undefined
}) {
  const { t } = props
  const [draft, setDraft] = useState<TaskContext | null>(props.value ?? null)
  const issue = props.maxBytes === undefined ? undefined : taskContextIssue(draft, props.maxBytes)
  const matchesDefaults = props.workspace?.taskContext !== undefined && !issue
    && JSON.stringify(resolveTaskContext(draft, Infinity)) === JSON.stringify(props.workspace.taskContext)
  return <details className={css.taskContextPanel} onToggle={(event) => {
    if (event.currentTarget.open && props.maxBytes === undefined) props.prepare?.()
  }}>
    <summary><span>{t('taskContextTitle')}</span><small>
      {t(props.value?.authorization ? 'taskContextDeclared' : 'taskContextNotDeclared')}
      {' · '}{t(props.value?.background ? 'taskContextBackgroundSet' : 'taskContextBackgroundEmpty')}
    </small></summary>
    {props.maxBytes === undefined
      ? props.loading ? <StateDot state="ongoing" />
        : <button onClick={props.prepare}>{t('dashboardRetry')}</button>
      : <>
        <TaskContextFields t={t} value={draft} maxBytes={props.maxBytes} disabled={props.disabled} onChange={setDraft} />
        <div className={css.taskActions}>
          <button disabled={props.disabled || !!issue}
            onClick={() => void props.save(draft)}>{t('taskContextSave')}</button>
          {props.saveDefaults && <button disabled={props.disabled || !!issue || matchesDefaults}
            onClick={() => void props.saveDefaults?.(draft)}>
            {t(matchesDefaults ? 'taskContextDefaultSaved' : 'taskContextSaveDefault')}
          </button>}
        </div>
        {props.saveDefaults && <p className={css.summaryHint}>{t('taskContextPersistHint')}<br />{props.workspace?.cwd}</p>}
      </>}
  </details>
}
