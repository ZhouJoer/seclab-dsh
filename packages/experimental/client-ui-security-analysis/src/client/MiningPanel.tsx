/** Collapsed manual-entry card for the experimental CVE mining benchmark. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Static manual instructions; nothing here starts a conversation or executes commands.
 * @param props - localized labels.
 * @returns a collapsed card describing the manual benchmark workflow.
 */
export function MiningPanel({ t }: PropsLocale<typeof NS>) {
  return <details className={css.miningCard}>
    <summary>{t('miningCardTitle')}</summary>
    <p>{t('miningCardIntro')}</p>
    <ol>
      <li><code>{t('miningCommandPrepare')}</code> — {t('miningCardPrepare')}</li>
      <li><code>{t('miningCommandRun')}</code> — {t('miningCardRun')}</li>
      <li><code>{t('miningCommandGrade')}</code> — {t('miningCardGrade')}</li>
    </ol>
    <p>{t('miningCardManual')}</p>
  </details>
}
