/** On-demand skill reads from committed task Sessions; counts do not imply compliance. @module */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SecuritySkillUsagePage } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Combine committed reads by skill name, excluding catalog-only entries.
 * @param props - task identity, authenticated reader and localized labels.
 * @returns expandable usage rows and recoverable read errors.
 */
export function SkillUsage(props: PropsLocale<typeof NS> & {
  project: string
  skillUsage(this: void, project: string): Promise<SecuritySkillUsagePage>
}) {
  const [open, setOpen] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [page, setPage] = useState<SecuritySkillUsagePage>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    if (open) {
      setBusy(true); setFailed(false)
      void props.skillUsage(props.project).then((value) => { if (active) setPage(value) })
        .catch(() => { if (active) setFailed(true) })
        .finally(() => { if (active) setBusy(false) })
    }
    return () => { active = false }
  }, [props.project, props.skillUsage, open, epoch])
  const { t } = props
  const usage = new Map<string, { reads: number; failures: number }>()
  for (const item of page?.items ?? []) {
    const reads = item.modelReads + item.explicitReads
    if (reads === 0 && item.failedReads === 0) continue
    const counts = usage.get(item.name) ?? { reads: 0, failures: 0 }
    counts.reads += reads
    counts.failures += item.failedReads
    usage.set(item.name, counts)
  }
  return <details onToggle={(event) => { setOpen(event.currentTarget.open) }}>
    <summary>{t('skillUsageTitle')}</summary>
    {open && <>
      {failed && <p role="alert" className={css.error}>{t('skillUsageFailed')}</p>}
      {busy && !page && <div className={css.skeleton} aria-busy="true" />}
      {page && <>
        {(page.unavailableSessions.length > 0 || page.unattributedReads > 0) && <p role="status">{t('skillUsagePartial')} {page.unavailableSessions.length} / {page.unattributedReads}</p>}
        {!usage.size && <p className={css.muted}>{t('skillUsageEmpty')}</p>}
        <dl className={css.skillUsageList}>{Array.from(usage, ([name, counts]) => <div key={name}>
          <dt>{name}</dt>
          <dd>
            {counts.reads > 0 && <span>{t('skillUsageReads')} {counts.reads}</span>}
            {counts.failures > 0 && <span>{t('skillUsageErrors')} {counts.failures}</span>}
          </dd>
        </div>)}</dl>
      </>}
      <button disabled={busy} onClick={() => { setEpoch(value => value + 1) }}>{t('skillUsageRefresh')}</button>
    </>}
  </details>
}
