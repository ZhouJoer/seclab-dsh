/** Confirmation of retained materials and settings for a fresh task round. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Preserve settings while discarding the active round's working context.
 * @param props - current materials and the authenticated restart operation.
 * @returns keyboard-accessible inline confirmation.
 */
export function RestartTask(props: PropsLocale<typeof NS> & {
  view: WorkbenchView
  disabled: boolean
  close(this: void): void
  restart(this: void, paths: Record<string, string | null>): Promise<void>
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => { panel.current?.focus() }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const missing = props.view.records.filter(item => item.kind === 'asset').map(item => item.value)
    .filter(asset => 'artifact' in asset && !asset.inputSource && !('parentId' in asset && asset.parentId))
  const { t } = props
  return <div ref={panel} id="security-restart-confirmation" className={css.restartConfirmation} role="group"
    aria-label={t('restartTaskConfirm')} aria-busy={busy} tabIndex={-1} onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); props.close() }
    }}>
    <strong>{t('restartTaskConfirm')}</strong>
    <p>{t('restartTaskHint')}</p>
    {!!missing.length && <p>{t('restartSavedMaterials')} {missing.map(asset => asset.label).join('、')}</p>}
    {error && <div className={css.error}><p role="alert">{t('restartTaskFailed')}</p>
      <details><summary>{t('restartErrorDetails')}</summary>{error}</details></div>}
    <div className={css.actions}><button className={css.primary} disabled={props.disabled || busy}
      onClick={() => {
        setBusy(true); setError('')
        void props.restart(Object.fromEntries(missing.map(asset => [asset.id, null])))
          .catch((error: unknown) => { setError(String(error)) }).finally(() => { setBusy(false) })
      }}>{t(busy ? 'restartTaskPending' : 'restartTaskConfirm')}</button>
    <button disabled={busy} onClick={props.close}>{t('cancel')}</button></div>
  </div>
}
