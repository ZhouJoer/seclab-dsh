/** Saved task outcomes and report delivery feedback. @module */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

type Completion = Extract<WorkbenchView['records'][number], { kind: 'engagement' }>['value']['completion']
/** Show report settlement without treating a stopped turn as task completion.
 * @param props - durable outcomes and the existing report request action.
 * @returns persistent delivery status and a retry for saved outcomes.
 */
export function TaskReportStatus({ completion, disabled, retry, t }: PropsLocale<typeof NS> & {
  completion: Completion
  disabled: boolean
  retry: () => void
}) {
  if (!completion) return null
  const labels = { running: 'reportPreparing', completed: 'reportDelivered', failed: 'reportFailed', interrupted: 'reportInterrupted' } as const
  const failed = completion.status === 'failed' || completion.status === 'interrupted'
  return <section aria-label={t('reports')}>
    <p role="status">{t(labels[completion.status])}</p>
    {failed && <Button variant="primary" size="sm" disabled={disabled} onClick={retry}>{t('reportRetry')}</Button>}
    {completion.detail && <details><summary>{t('evoRunDetail')}</summary><p>{completion.detail}</p></details>}
  </section>
}
