/** Explicit maintenance of completed and interrupted Ghidra projects. @module */
import { useEffect, useRef, useState } from 'react'
import type { GhidraHeadlessCache } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Cache maintenance requires an explicit operator action and never stops analysis.
 * @param props - selected environment, authenticated action and localized labels.
 * @returns cache entry states and guarded removal controls.
 */
export function ToolboxCache(props: PropsLocale<typeof NS> & {
  environmentId: string
  read(environmentId: string, key?: string): Promise<GhidraHeadlessCache[]>
}) {
  const [entries, setEntries] = useState<GhidraHeadlessCache[]>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    generation.current++; setEntries(undefined); setBusy(false); setError('')
    return () => { generation.current++ }
  }, [props.environmentId])
  async function run(key?: string) {
    const current = generation.current
    setBusy(true); setError('')
    try {
      const next = await props.read(props.environmentId, key)
      if (generation.current === current) setEntries(next)
    } catch (error) { if (generation.current === current) setError(String(error)) }
    finally { if (generation.current === current) setBusy(false) }
  }
  return <section aria-label={props.t('toolGhidraCaches')}>
    <button disabled={busy} onClick={() => void run()}>{props.t('toolGhidraCaches')}</button>
    {error && <p role="alert">{error}</p>}
    {entries?.length === 0 && <p>{props.t('toolGhidraCacheEmpty')}</p>}
    {entries?.map(entry => <div className={css.card} key={entry.key}>
      <p><code>{entry.key}</code> · {props.t(entry.inUse ? 'toolGhidraCacheBusy' : entry.complete ? 'toolGhidraCacheComplete' : 'toolGhidraCacheIncomplete')}</p>
      <button disabled={busy || entry.inUse} onClick={() => void run(entry.key)}>{props.t('toolGhidraCacheRemove')}</button>
    </div>)}
  </section>
}
