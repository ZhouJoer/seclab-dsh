/** Shared optional authorization fields, templates and exact model preview. @module */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { renderTaskContext, resolveTaskContext, taskContextBytes, type TaskContext } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Localized validation independent of network requests.
 * @param value - editable context; null means no declaration or background.
 * @param maxBytes - configured full-snapshot limit.
 * @returns locale key for invalid fields, or absence when ready to save.
 */
export function taskContextIssue(value: TaskContext | null | undefined, maxBytes: number):
  'taskContextIncomplete' | 'taskContextInvalid' | 'taskContextTooLong' | undefined {
  const auth = value?.authorization
  if (auth && [auth.basis, auth.scope, auth.allowedActions, auth.restrictions].some(field => !field.trim())) return 'taskContextIncomplete'
  try { resolveTaskContext(value, Infinity) }
  catch (_error) { return 'taskContextInvalid' }
  try { resolveTaskContext(value, maxBytes) }
  catch (_error) { return 'taskContextTooLong' }
  return undefined
}

function localDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** Render optional user declarations; templates fill empty fields without saving.
 * @param props - controlled draft, deployment limit and localized labels.
 * @returns editable fields and a deterministic, non-model-generated preview.
 */
export function TaskContextFields({ value, maxBytes, disabled, onChange, t }: PropsLocale<typeof NS> & {
  value: TaskContext | null | undefined
  maxBytes: number
  disabled: boolean
  onChange(this: void, value: TaskContext | null): void
}) {
  const [commissioned, setCommissioned] = useState(false)
  const auth = value?.authorization
  const emptyAuth = { basis: '', scope: '', allowedActions: '', restrictions: '' }
  const issue = taskContextIssue(value, maxBytes)
  const normalized = issue && issue !== 'taskContextTooLong' ? undefined : resolveTaskContext(value, Infinity)
  const preview = normalized ? renderTaskContext(normalized, Date.now()) : ''
  const fields = [
    ['basis', 'taskContextBasis', 'taskContextBasisHint'], ['scope', 'taskContextScope', 'taskContextScopeHint'],
    ['allowedActions', 'taskContextAllowed', 'taskContextAllowedHint'], ['restrictions', 'taskContextRestrictions', 'taskContextRestrictionsHint'],
  ] as const
  const template = (kind: 'own' | 'commissioned' | 'lab') => {
    setCommissioned(kind === 'commissioned')
    const prior = auth ?? emptyAuth
    onChange({ ...value, authorization: { ...prior,
      basis: prior.basis.trim() ? prior.basis : kind === 'own' ? t('taskContextOwnBasis') : kind === 'lab' ? t('taskContextLabBasis') : '',
      allowedActions: prior.allowedActions.trim() ? prior.allowedActions : kind === 'own' ? t('taskContextOwnAllowed') : '',
      restrictions: prior.restrictions.trim() ? prior.restrictions : kind === 'own' ? t('taskContextOwnRestrictions') : kind === 'lab' ? t('taskContextLabRestrictions') : '',
    } })
  }
  return <div className={css.taskContextFields}>
    <p className={css.summaryHint}>{t('taskContextHint')}</p>
    <fieldset disabled={disabled}><legend>{t('taskContextTemplates')}</legend>
      <div className={css.taskActions}>
        <button type="button" onClick={() => { template('own') }}>{t('taskContextOwn')}</button>
        <button type="button" onClick={() => { template('commissioned') }}>{t('taskContextCommissioned')}</button>
        <button type="button" onClick={() => { template('lab') }}>{t('taskContextLab')}</button>
      </div>
      {commissioned && <p>{t('taskContextCommissionHint')}</p>}
    </fieldset>
    <label className={css.resourceOption}><input type="checkbox" checked={!!auth} disabled={disabled}
      onChange={(event) => { onChange(event.target.checked ? { ...value, authorization: emptyAuth } : value?.background ? { background: value.background } : null) }} />{t('taskContextEnable')}</label>
    {auth && <fieldset disabled={disabled}>
      {fields.map(([key, label, hint]) => <label key={key} className={css.field}>{t(label)}
        <textarea rows={2} value={auth[key]} placeholder={t(hint)}
          onChange={(event) => { onChange({ ...value, authorization: { ...auth, [key]: event.target.value } }) }} />
      </label>)}
      <label className={css.field}>{t('taskContextExpiry')} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
        <input type="datetime-local" value={localDate(auth.expiresAt)} onChange={(event) => {
          const { expiresAt: _previous, ...rest } = auth
          onChange({ ...value, authorization: { ...rest,
            ...(event.target.value ? { expiresAt: new Date(event.target.value).getTime() } : {}) } })
        }} />
      </label>
    </fieldset>}
    <label className={css.field}>{t('taskContextBackground')}<textarea rows={3} value={value?.background ?? ''} disabled={disabled}
      placeholder={t('taskContextBackgroundHint')} onChange={(event) => { onChange({ ...value, background: event.target.value }) }} /></label>
    {issue && <p role="alert" className={css.error}>{t(issue)}</p>}
    <details><summary>{t('taskContextPreview')} · {taskContextBytes(preview)} / {maxBytes} {t('taskContextBytes')}</summary>
      {preview ? <pre className={css.taskContextPreview}>{preview}</pre> : <p>{t('taskContextEmpty')}</p>}
    </details>
  </div>
}
