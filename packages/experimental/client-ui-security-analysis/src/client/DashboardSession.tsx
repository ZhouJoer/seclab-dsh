/** Session-scoped settings and approvals in the security workbench. @module */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Workbench, type WorkbenchActions } from './Workbench.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Owner inputs for a retained settings occurrence. */
export interface DashboardSessionInput {
  advancedOpen: boolean
  reviewOpen?: boolean
  focusCheckId?: string | undefined
  /** Current task facts shared with the parent workbench. */
  snapshot?: WorkbenchView
}

/** Render settings without allocating a second conversation composer.
 * @param props - retained Session and settings actions.
 * @returns settings or approvals for the selected task. */
export function DashboardSession(props: PropsRuntime<'security.workbench.session'> & PropsLocale<typeof NS> & WorkbenchActions) {
  if (!props.advancedOpen) return null
  return <div className={css.advanced}><Workbench {...props} autoOpen settingsOnly
    initialTab={props.reviewOpen ? 'planApprovals' : props.focusCheckId ? 'checks' : 'environments'} /></div>
}
