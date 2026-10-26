/** Task browsing in the native chat sidebar, with navigation owned by each tab. @module */
import { useMemo, useState } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabParamsFor } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconShieldOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { Dashboard, type DashboardActions } from './Dashboard.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

type Props = DashboardActions & PropsLocale<typeof NS>
  & Pick<PropsRuntime<'sidebar.right.pane.tab'>, 'sessionId' | 'useTabInfo' | 'useWorkspaces' | 'useResource'>
  & PropsRenderSlots<'security.workbench.sidebar.session'>

/** Render the workbench without navigating away from its conversation.
 * @param props - tab navigation, workspace reads and task actions.
 * @returns the task browser and retained settings inside the sidebar. */
export function SidebarWorkbench(props: Props) {
  const { tab } = props.useTabInfo()
  const params = tab.navigation.params as SidebarRightTabParamsFor<'security-workbench'>
  const [selection, setSelection] = useState<{ revision: number; projectId: string }>()
  const projectId = selection?.revision === tab.navigation.revision ? selection.projectId : params?.projectId
  const destination = useMemo(() => projectId
    ? { projectId, ...(projectId === params?.projectId ? { sessionId: props.sessionId } : {}) } : undefined,
  [projectId, params?.projectId, props.sessionId])
  return <div className={css.sidebarWorkbench}>
    <Dashboard {...props} destination={destination} sidebarSessionId={props.sessionId}
      selectDestination={(id) => { setSelection({ revision: tab.navigation.revision, projectId: id }) }}
      renderSettings={input => props.renderSlot('security.workbench.sidebar.session', input)} />
  </div>
}

/** Localized workbench tab title with its security icon.
 * @param props - namespace-bound translator.
 * @returns the tab label and decorative shield. */
export function SidebarWorkbenchTitle(props: PropsLocale<typeof NS>) {
  return <><IconShieldOutlineRegular size={16} />{props.t('dashboardEntry')}</>
}
