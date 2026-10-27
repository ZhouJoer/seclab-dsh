/** Task module editing and cold-readable resource summaries. @module */
import { useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { analysisModules, resolveModuleSelection, type ModuleSelection as Selection } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

const labels = { 'reverse.android': 'moduleAndroid', 'reverse.native': 'moduleNative', web: 'moduleWeb', iot: 'moduleIot', pentest: 'modulePentest' } as const

/** Edit a local module draft without probing tools or activating an Agent.
 * @param props - current draft, localized copy and update callback.
 * @returns automatic/manual selection and resource metadata.
 */
export function ModuleSelectionFields({ value, onChange, disabled, compact, t }: PropsLocale<typeof NS> & {
  value: Selection
  onChange: (value: Selection) => void
  disabled?: boolean
  compact?: boolean
}) {
  return <fieldset className={css.toolFields} disabled={disabled}>
    <legend>{t('moduleTitle')}</legend>
    <label>{t('moduleMode')}<select value={value.mode} onChange={(event) => {
      onChange({ mode: event.target.value === 'manual' ? 'manual' : 'auto', modules: [], reason: '' })
    }}><option value="auto">{t('moduleAuto')}</option><option value="manual">{t('moduleManual')}</option></select></label>
    {!compact && <p className={css.summaryHint}>{t('moduleHelp')}</p>}
    {(!compact || value.mode === 'manual') && analysisModules.map(module => <label key={module.id}>
      <input type="checkbox" disabled={value.mode === 'auto'} checked={value.modules.includes(module.id)} onChange={(event) => {
        onChange({ ...value, modules: event.target.checked ? [...value.modules, module.id] : value.modules.filter(id => id !== module.id) })
      }} />{t(labels[module.id])}
    </label>)}
    {!compact && value.reason && <p>{t('moduleReason')}: {value.reason}</p>}
    {!compact && value.modules.length === 0 && <p>{t('modulePending')}</p>}
    {!compact && <details><summary>{t('moduleResources')}</summary>
      {analysisModules.filter(module => value.modules.includes(module.id)).map(module => <div key={module.id}>
        <strong>{t(labels[module.id])}</strong><p>{module.skills.join(', ')}</p><p>{module.tools.join(', ')}</p><p>{module.scripts.join(', ')}</p>
      </div>)}
    </details>}
  </fieldset>
}

/** Save task selections through the existing revision-checked project operation.
 * @param props - committed selection and operator save action.
 * @returns draft editor retaining errors without changing the saved task.
 */
export function ProjectModules({ value, save, disabled, t }: PropsLocale<typeof NS> & {
  value: Selection | undefined
  save: (value: Selection) => Promise<void>
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(() => resolveModuleSelection(value))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <details className={css.card}><summary>{t('moduleTitle')}</summary>
    <ModuleSelectionFields t={t} value={draft} onChange={setDraft} disabled={disabled || busy} />
    <button disabled={disabled || busy || JSON.stringify(draft) === JSON.stringify(resolveModuleSelection(value))}
      onClick={() => { setBusy(true); setError(''); void save(draft).catch((error: unknown) => {
        setError(error instanceof Error ? error.message : String(error))
      }).finally(() => { setBusy(false) }) }}>{t('moduleSave')}</button>
    {error && <p role="alert">{error}</p>}
  </details>
}

/** Toggle the direct-execution contract through the existing revision-checked project operation.
 * @param props - committed mode and operator save action.
 * @returns an immediate mode action with hover/focus help; failed saves retain the current mode.
 */
export function ProjectUnseal({ value, save, disabled, t }: PropsLocale<typeof NS> & {
  value: boolean | undefined
  save: (unsealed: boolean) => Promise<void>
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <section className={css.executionMode} aria-label={t('unsealTitle')}>
    <Tooltip label={`${t(value === true ? 'unsealOn' : 'unsealOff')}\n${t('unsealHelp')}`} portal side="bottom" maxWidth={320}>
      <button type="button" className={css.modeAction} disabled={disabled || busy} aria-busy={busy}
        onClick={() => { setBusy(true); setError(''); void save(value !== true).catch((error: unknown) => {
          setError(error instanceof Error ? error.message : String(error))
        }).finally(() => { setBusy(false) }) }}>{t(busy ? 'unsealSaving' : value === true ? 'unsealDisable' : 'unsealEnable')}</button>
    </Tooltip>
    {error && <p role="alert">{error}</p>}
  </section>
}
