/** Shared workspace resource settings for security task creation. @module */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { TaskContext } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { TaskContextFields, taskContextIssue } from './TaskContextFields.tsx'
import { resolveModuleSelection, type ModuleSelection } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { ModuleSelectionFields } from './ModuleSelection.tsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Render environment selection and an explicit attempt allowance.
 * @param props - resolved workspace, available environments and save action.
 * @returns workspace resource form.
 */
export function WorkspaceResources({ workspace, environments, disabled, save, taskContextMaxBytes, environmentOnly, onEdit,
  task, modified, taskSaved, cancel, cancelEdits, t }:
PropsLocale<typeof NS> & {
  workspace: NonNullable<WorkbenchConfiguration['workspace']>
  environments: WorkbenchConfiguration['environments']
  environmentOnly?: boolean
  onEdit?(this: void): void
  task?: boolean
  modified?: boolean
  taskSaved?: boolean
  cancel?(this: void): void
  cancelEdits?(this: void): void
  disabled: boolean
  taskContextMaxBytes: number
  save(this: void, input: {
    expectedRevision: number
    environmentIds: string[]
    maxAttempts: number
    taskContext: TaskContext | null
    unsealed?: boolean
    moduleSelection?: ModuleSelection }): Promise<void>
}) {
  const [environmentIds, setEnvironmentIds] = useState(workspace.environmentIds)
  const [attempts, setAttempts] = useState(workspace.maxAttempts === undefined ? '' : String(workspace.maxAttempts))
  const maxAttempts = Number(attempts)
  const [taskContext, setTaskContext] = useState<TaskContext | null>(workspace.taskContext ?? null)
  const [unsealed, setUnsealed] = useState(workspace.unsealed ?? false)
  const [modules, setModules] = useState(() => resolveModuleSelection(workspace.moduleSelection))
  const changed = JSON.stringify([environmentIds, attempts, taskContext, unsealed, modules])
    !== JSON.stringify([workspace.environmentIds, workspace.maxAttempts === undefined ? '' : String(workspace.maxAttempts),
      workspace.taskContext ?? null, workspace.unsealed ?? false, resolveModuleSelection(workspace.moduleSelection)])
  const dirty = (value: boolean) => { onEdit?.(); setUnsealed(value) }
  const unavailable = environmentIds.filter(id => !environments.some(environment => environment.id === id))
  const savePending = changed || modified || workspace.maxAttempts === undefined
  return <div className={css.resourceForm} onKeyDown={(event) => {
    if (task && savePending && !disabled && event.key === 'Escape') { event.stopPropagation(); cancelEdits?.() }
  }}>
    <fieldset>
      <legend>{t(task ? 'startupEnvironment' : 'workspaceResources')}</legend>
      {environments.map(environment => <label key={environment.id} className={css.resourceOption}>
        <input type="checkbox" checked={environmentIds.includes(environment.id)} disabled={disabled}
          onChange={(event) => { onEdit?.(); setEnvironmentIds(event.target.checked
            ? [...environmentIds, environment.id] : environmentIds.filter(id => id !== environment.id)) }} />
        <span>{environment.label}</span>
      </label>)}
      {unavailable.map(id => <label key={id} className={css.resourceOption}>
        <input type="checkbox" checked disabled={disabled}
          onChange={() => { onEdit?.(); setEnvironmentIds(environmentIds.filter(selected => selected !== id)) }} />
        <span>{id} · {t('unavailableEnvironment')}</span>
      </label>)}
      {environments.length === 0 && <p>{t('noWorkspaceResources')}</p>}
    </fieldset>
    {task && <label className={css.field}>{t('unsealTitle')}
      <select disabled={disabled} value={unsealed ? 'unsealed' : 'sealed'}
        onChange={(event) => { dirty(event.target.value === 'unsealed') }}>
        <option value="sealed">{t('unsealOff')}</option><option value="unsealed">{t('unsealOn')}</option>
      </select>
    </label>}
    <details open={workspace.maxAttempts === undefined}>
      <summary>{t('executionLimits')}</summary>
      <label className={css.field}>{t('attemptLimit')}
        <input type="number" min={1} step={1} disabled={disabled} value={attempts}
          onChange={(event) => { onEdit?.(); setAttempts(event.target.value) }} />
      </label>
    </details>
    {task && <details><summary>{t('moduleTitle')} · {t(modules.mode === 'auto' ? 'moduleAuto' : 'moduleManual')}</summary>
      <ModuleSelectionFields t={t} value={modules} disabled={disabled} compact
        onChange={(value) => { onEdit?.(); setModules(value) }} />
    </details>}
    {!task && <p className={css.summaryHint}>{t('workspaceResourcesHint')}</p>}
    {!environmentOnly && <details><summary>{t(task ? 'startupContext' : 'taskContextDefaults')}</summary>
      {!task && <p>{t('taskContextDefaultHint')}</p>}
      <TaskContextFields t={t} value={taskContext} onChange={(value) => { onEdit?.(); setTaskContext(value) }}
        disabled={disabled} maxBytes={taskContextMaxBytes} compact={!!task} />
    </details>}
    {(!task || savePending || taskSaved) && <div className={css.taskActions}>
      {task && taskSaved && !savePending ? <Button variant="outline" disabled={disabled} onClick={cancel}>
        {t('startupCancelSaved')}</Button> : <Button variant="primary" disabled={disabled || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1
      || !!taskContextIssue(taskContext, taskContextMaxBytes)}
      onClick={() => void save({ expectedRevision: workspace.revision, environmentIds, maxAttempts, taskContext,
        ...(task ? { unsealed, moduleSelection: modules } : {}) })}>
        {t(task ? 'startupSaveTask' : environmentOnly ? 'newAnalysis' : 'saveWorkspaceResources')}
      </Button>}
    </div>}
  </div>
}
