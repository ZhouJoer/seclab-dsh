/** Checked adapter selections scoped to the retained active session. @module */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolPreferenceOptions, ToolPreferences as Preferences } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'
/** Carrier-authenticated session preference actions. */
export interface ToolPreferenceActions {
  toolPreferenceOptions(this: void, sessionId: SessionId): Promise<ToolPreferenceOptions>
  toolPreferences(this: void, sessionId: SessionId, input?: string): Promise<Preferences>
}
type Props = ToolPreferenceActions & PropsLocale<typeof NS> & {
  sessionId: SessionId
  disabled?: boolean
  onReadyChange?: (ready: boolean) => void
}
/** Apply checked selections while retaining the draft and saved preferences on failure.
 * @param props - active session, actions and locale.
 * @returns preference editor with automatic-discovery reset.
 */
export function ToolPreferences(props: Props) {
  return <PreferenceEditor key={props.sessionId} {...props} />
}

function PreferenceEditor(props: Props) {
  const { t, sessionId } = props
  const [catalog, setCatalog] = useState<ToolPreferenceOptions>(), [selection, setSelection] = useState<Preferences>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)
  const [dirty, setDirty] = useState(false), [retry, setRetry] = useState(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useLayoutEffect(() => {
    props.onReadyChange?.(!busy)
  }, [busy, props.onReadyChange])
  useEffect(() => {
    let active = true
    if (open) {
      setBusy(true); setError('')
      void Promise.all([props.toolPreferenceOptions(sessionId), props.toolPreferences(sessionId)]).then(([catalog, selection]) => {
        const ids = new Set([...selection.toolIds, ...catalog.collections
          .filter(group => selection.collectionIds.includes(group.id)).flatMap(group => group.toolIds)])
        const selected = selection.toolIds.length + selection.tags.length + selection.collectionIds.length
          ? catalog.tools.filter(tool => ((!selection.toolIds.length && !selection.collectionIds.length) || ids.has(tool.id))
            && (!selection.tags.length || selection.tags.some(tag => tool.tags.includes(tag)))).map(tool => tool.id) : []
        if (active) { setCatalog(catalog); setSelection({ toolIds: selected, tags: [], collectionIds: [] }); setSaved(false) }
      }).catch((error: unknown) => { if (active) setError(String(error)) }).finally(() => { if (active) setBusy(false) })
    }
    return () => { active = false }
  }, [sessionId, open, retry, props.toolPreferenceOptions, props.toolPreferences])
  const apply = async (value: Preferences) => {
    setBusy(true); setError('')
    try {
      const next = await props.toolPreferences(sessionId, JSON.stringify(value))
      if (mounted.current) {
        setSelection(next); setSaved(true); setDirty(false)
      }
    } catch (error) { if (mounted.current) setError(String(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <details className={css.card} onToggle={(event) => {
    if (event.currentTarget.open) setOpen(true)
  }}>
    <summary>{t('toolPreferenceTitle')}</summary>
    <p>{t('toolPreferenceHelp')}</p>
    {selection && <fieldset className={css.toolFields} disabled={busy || props.disabled}>
      {catalog?.collections.map(group => <label key={group.id}><input type="checkbox"
        disabled={!group.toolIds.length}
        checked={!!group.toolIds.length && group.toolIds.every(id => selection.toolIds.includes(id))} onChange={(event) => {
          setSelection({ toolIds: event.target.checked
            ? [...new Set([...selection.toolIds, ...group.toolIds])]
            : selection.toolIds.filter(id => !group.toolIds.includes(id)), tags: [], collectionIds: [] })
          setSaved(false); setDirty(true)
        }} />{group.label}</label>)}
      <details><summary>{t('toolChooseType')}</summary><div className={css.toolFields}>{catalog?.tools.map(tool => <label key={tool.id}><input type="checkbox" disabled={!!tool.unavailable && !selection.toolIds.includes(tool.id)} checked={selection.toolIds.includes(tool.id)} onChange={(event) => {
        setSelection({ ...selection, toolIds: event.target.checked
          ? [...selection.toolIds, tool.id] : selection.toolIds.filter(id => id !== tool.id) }); setSaved(false); setDirty(true)
      }} />{tool.label}{tool.unavailable && <span>{t(tool.unavailable === 'adapter' ? 'toolPreferenceNoAdapter'
        : tool.unavailable === 'sample' ? 'toolPreferenceNeedsSample'
          : tool.unavailable === 'provider' ? 'toolPreferenceNoProvider' : 'toolPreferenceNeedsConfiguration')}</span>}
      {tool.detail && <details><summary>{t('toolPreferenceDetails')}</summary>{tool.detail}</details>}</label>)}</div></details>
      <button onClick={() => void apply(selection)}>{t('toolPreferenceSave')}</button>
      <button onClick={() => void apply({ toolIds: [], collectionIds: [], tags: [] })}>{t('toolPreferenceAuto')}</button>
    </fieldset>}
    {saved && <p role="status">{t('toolPreferenceSaved')}</p>}
    {dirty && props.onReadyChange && <p role="status">{t('toolPreferenceUnsaved')}</p>}
    {error && <p role="alert">{selection && t('toolPreferenceFailed')} {error}</p>}
    {error && !selection && <button disabled={busy || props.disabled}
      onClick={() => { setRetry(value => value + 1) }}>{t('refresh')}</button>}
  </details>
}
