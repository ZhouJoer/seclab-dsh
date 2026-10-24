/** Native conversation and sidebar entries addressing the exact security task. @module */
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MenuItemButton, Tooltip, IconShieldOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SecurityDirectorySnapshot } from './directory.ts'
import type { NS } from './locales.ts'
import css from './Navigation.module.css'

/** Shared business facts and identity-preserving navigation. */
export interface SecurityNavigationInjected {
  hooks: { directory: ObservableSnapshot<SecurityDirectorySnapshot> }
  openWorkbench(projectId: string, sessionId: SessionId): void
}
type Props = InjectFace<SecurityNavigationInjected> & PropsLocale<typeof NS> & { sessionId: SessionId }

function associatedProject(directory: SecurityDirectorySnapshot, sessionId: SessionId) {
  return directory.projects.find(item => item.sessions.some(binding => binding.sessionId === sessionId && binding.active))
    ?? directory.projects.find(item => item.sessions.some(binding => binding.sessionId === sessionId))
}

/** Start security analysis from the ordinary creation menu.
 * @param props - localized creation action and menu dismissal.
 * @returns the security creation mode. */
export function NewAnalysisMenu(props: PropsLocale<typeof NS> & { close(): void; beginAnalysis(): void }) {
  return <MenuItemButton onSelect={() => { props.close(); props.beginAnalysis() }}>{props.t('newAnalysis')}</MenuItemButton>
}

/** Persistent association mark; opening it never starts or resumes an analysis.
 * @param props - row identity, shared directory and localized actions.
 * @returns association button, or nothing for an ordinary conversation. */
export function SecuritySessionBadge(props: Props) {
  const project = props.useDirectory(value => associatedProject(value, props.sessionId))
  if (!project) return null
  return <Tooltip label={`${props.t('dashboardEntry')} · ${project.project.title}`} portal>
    <button className={css.badge} aria-label={`${props.t('dashboardEntry')} · ${project.project.title}`}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}
      onClick={(event) => { event.stopPropagation(); props.openWorkbench(project.project.id, props.sessionId) }}>
      <IconShieldOutlineRegular size={14} />
    </button>
  </Tooltip>
}

/** Conversation navigation, available before the first message.
 * @param props - displayed conversation and shared directory.
 * @returns the task's chat/workbench navigation. */
export function SecurityConversationNavigation(props: Props) {
  const project = props.useDirectory(value => associatedProject(value, props.sessionId))
  if (!project) return null
  return <nav className={css.views} aria-label={props.t('analysisViews')}>
    <span>{project.project.title}</span><button aria-current="page">{props.t('analysisChat')}</button>
    <button onClick={() => { props.openWorkbench(project.project.id, props.sessionId) }}>{props.t('dashboardEntry')}</button>
  </nav>
}

/** Keyboard-accessible workbench entry in the native Session menu.
 * @param props - exact row identity and menu dismissal callback.
 * @returns a menu item for associated conversations. */
export function SecuritySessionMenu(props: Props & { useMenuOpenState(): readonly [boolean, (open: boolean) => void] }) {
  const project = props.useDirectory(value => associatedProject(value, props.sessionId))
  const [, setOpen] = props.useMenuOpenState()
  if (!project) return null
  return <MenuItemButton onSelect={() => { setOpen(false); props.openWorkbench(project.project.id, props.sessionId) }}>{props.t('dashboardEntry')}</MenuItemButton>
}
