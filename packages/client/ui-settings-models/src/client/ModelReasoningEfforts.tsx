/** Editable reasoning levels and provider parameter values for custom API models. */
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Edit inherited, disabled, or explicitly mapped reasoning capabilities.
 * @param props Model draft and staged update callback.
 * @returns The reasoning capability editor.
 */
export function ModelReasoningEfforts(props: {
  model: DeepSeekModelDraft
  disabled: boolean
  t: (key: ModelsKey) => string
  onChange: (model: DeepSeekModelDraft) => void
}) {
  const { model, t, disabled, onChange } = props
  const raw = model['reasoningEfforts']
  const mapping = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const mode = raw === false ? 'none' : raw === undefined ? 'inherit' : 'custom'
  return <fieldset disabled={disabled} className={styles['modelField']}>
    <legend>{t('reasoningConfig')}</legend>
    <select aria-label={t('reasoningConfig')} value={mode} onChange={(event) => {
      const { reasoningEfforts: _removed, ...rest } = model
      onChange(event.target.value === 'inherit' ? rest : { ...rest, reasoningEfforts: event.target.value === 'none' ? false : { high: 'high' } })
    }}>
      <option value="inherit">{t('reasoningInherit')}</option>
      <option value="none">{t('reasoningNone')}</option>
      <option value="custom">{t('reasoningCustom')}</option>
    </select>
    {mode === 'custom' && <>
      <p>{t('reasoningMappingHint')}</p>
      {levels.map(level => <label key={level} className={styles['modelField']}>
        <span><input type="checkbox" checked={level in mapping} onChange={(event) => {
          const next = { ...mapping }
          if (event.target.checked) next[level] = level === 'off' ? null : level
          else Reflect.deleteProperty(next, level)
          onChange({ ...model, reasoningEfforts: next })
        }} />{level}</span>
        {level in mapping && <input className={styles['input']} aria-label={`${t('reasoningWireValue')} ${level}`}
          value={typeof mapping[level] === 'string' ? mapping[level] : ''}
          placeholder={level === 'off' ? t('reasoningOmit') : level}
          onChange={(event) =>{  onChange({ ...model, reasoningEfforts: { ...mapping, [level]: level === 'off' && !event.target.value ? null : event.target.value } }) }} />}
      </label>)}
    </>}
  </fieldset>
}
