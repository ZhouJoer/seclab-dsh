/** Optional subagent, tool-statistics and terminal pages for the bottom workbench. @module */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionReference, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalCloseFailure } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-terminal/client'
import { Button, IconPlusOutlineRegular, IconStopFillRegular, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { InjectFace, PropsLocale, PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-experimental-research-workbench/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import { toolStatistics, type ToolStatistics } from './tool-stats.ts'
import { documentPreview } from './preview.ts'
import { en, zh } from './locales.ts'
import css from './runtime.module.css'

type Panel = 'agents' | 'tools' | 'terminal'
interface TerminalTab { sessionId: SessionId; tabId: string; contentId: string }
interface RuntimeState {
  sessionId: SessionId | undefined
  session: SessionReference | undefined
  tools: ToolStatistics[]
  terminals: TerminalTab[]
  active: string
}
interface Injected {
  panel: Panel
  hooks: {
    runtime: ObservableSnapshot<RuntimeState>
    sessions: ObservableSnapshot<SessionListState>
    closeFailures: ObservableSnapshot<readonly TerminalCloseFailure[]>
  }
  open: (id: SessionId) => void
  createTerminal: () => void
  selectTerminal: (key: string) => void
  closeTerminal: (key: string) => void
  retryClose: (id: TerminalCloseFailure['id']) => void
}
type Props = PropsRuntime<'research.panel'> & PropsLocale<'research-runtime'> & PropsRenderFactories & InjectFace<Injected>

function Page(props: Props) {
  const state = props.useRuntime(value => value)
  const sessions = props.useSessions(value => value)
  const failures = props.useCloseFailures(value => value)
  const terminals = state.terminals.filter(tab => tab.sessionId === state.sessionId)
  const terminal = terminals.find(tab => tab.tabId === state.active) ?? terminals[0]
  const [firstTab, ...otherTabs] = terminals.map((tab, index) => ({ value: tab.tabId,
    label: `${props.t('terminal')} ${index + 1}`, id: `research-tab-${tab.tabId}`, panelId: `research-panel-${tab.tabId}` }))
  if (!state.sessionId) return <div className={css.empty}>{props.t('noSession')}</div>
  if (props.panel === 'terminal') return <section className={css.terminal}>
    <div className={css.toolbar}>
      {firstTab && terminal && <div className={css.terminalTabs}>
        <SegmentedTabs items={[firstTab, ...otherTabs]} value={terminal.tabId}
          onChange={props.selectTerminal} label={props.t('terminal')} />
      </div>}
      <Button size="sm" variant="outline" icon={<IconPlusOutlineRegular size={14} />}
        onClick={props.createTerminal}>{props.t('newTerminal')}</Button>
      {terminal && <Button size="sm" className={css.endTerminal} icon={<IconStopFillRegular size={12} />}
        onClick={() => { props.closeTerminal(terminal.tabId) }}>{props.t('closeTerminal')}</Button>}
    </div>
    {failures.map(failure => <p role="alert" key={failure.id}>{props.t('closeFailed')} {failure.title}
      <Button size="sm" onClick={() => { props.retryClose(failure.id) }}>{props.t('retry')}</Button>
    </p>)}
    {terminal && state.session ? <div className={css.terminalViewport} role="tabpanel"
      id={`research-panel-${terminal.tabId}`} aria-labelledby={`research-tab-${terminal.tabId}`}>
      {props.renderFactorySlot('terminal.viewport', { contentId: terminal.contentId, visible: true, onNew: props.createTerminal })}
    </div> : <div className={css.empty}>{props.t('terminalHelp')}</div>}
  </section>
  if (props.panel === 'tools') return <section className={css.page}>
    <p className={css.description}>{props.t('toolsHelp')}</p>
    {state.tools.length ? <table aria-label={props.t('tools')}><thead><tr>{(['tool', 'calls', 'completed', 'failed', 'active', 'averageDuration'] as const)
      .map(key => <th scope="col" key={key}>{props.t(key)}</th>)}</tr></thead><tbody>{state.tools.map(row => <tr key={row.tool}>
      <th scope="row">{row.tool || props.t('unnamedTool')}</th><td>{row.calls}</td><td>{row.completed}</td>
      <td>{row.failed}</td><td>{row.active}</td>
      <td>{row.averageDuration === undefined ? '—' : props.t('elapsed', { value: String(row.averageDuration) })}</td>
    </tr>)}</tbody></table> : <div className={css.empty}>{props.t('empty')}</div>}
  </section>
  const children = sessions.projectionsBySession[state.sessionId]?.values.subagentCatalog ?? []
  const rows = children.map(child => ({ id: child.id,
    title: child.label ?? sessions.byId[child.id]?.displayTitle ?? child.id }))
  return <section className={css.page}>
    <p className={css.description}>{props.t('agentHelp')}</p>
    {rows.length ? rows.map(row => <div className={css.row} key={row.id}>
      <span className={css.dot} />
      <span className={css.rowTitle}>{row.title}</span>
      <span className={css.status}>{props.t('recorded')}</span>
      <Button size="sm" onClick={() =>{  props.open(row.id) }}>{props.t('open')}</Button>
    </div>) : <div className={css.empty}>{props.t('empty')}</div>}
  </section>
}

/** Required services are supplied by the generic Web composition. */
export const inject = ['researchWorkbench', 'slots', 'locale', 'uiSession', 'sessions', 'uiConversation', 'uiWorkspace', 'webTerminals']
declare module '@deepseek-ai/dsh-api-session-controller/client' { interface SessionReferenceSourceMap { researchRuntime: unknown } }

/** Contribute optional bottom pages and own their retained conversation and terminal views.
 * @param ctx - framework services, without a security or Git dependency. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('research-runtime', { en, zh }))
  ctx.inject(['sidebarRight', 'documentPreviews'], (scoped) => {
    scoped.effect(() => scoped.researchWorkbench.registerPreview(documentPreview(scoped.sidebarRight,
      () => ({ width: window.innerWidth, height: window.innerHeight }))))
  })
  const state = createSnapshotStore<RuntimeState>({ sessionId: undefined, session: undefined, tools: [], terminals: [], active: '' })
  const owner = {}
  let reference: SessionReference | undefined
  let unwatch: () => void = () => {}
  const update = () => {
    const key = ctx.uiSession.adapter.current.getSnapshot().key
    if (key === reference?.sessionId) return
    unwatch()
    reference?.release()
    reference = key ? ctx.sessions.retain(SessionId(key), { source: 'researchRuntime' }) : undefined
    state.set({ ...state.getSnapshot(), sessionId: reference?.sessionId, session: reference, tools: [] })
    if (!reference) return
    const chat = ctx.uiConversation.binding(reference.binding).target('chat')
    const refresh = () =>{  state.set({ ...state.getSnapshot(), tools: toolStatistics(chat.getSnapshot()) }) }
    unwatch = chat.subscribe(refresh)
    refresh()
  }
  ctx.effect(() => {
    const unsubscribe = ctx.uiSession.adapter.current.subscribe(update)
    update()
    return () => { unsubscribe(); unwatch(); reference?.release(); ctx.webTerminals.retainTabs([], owner) }
  })
  const createTerminal = () => {
    const current = state.getSnapshot()
    if (!current.sessionId) return
    const key = `research:${randomUUID()}`
    const tab = { sessionId: current.sessionId, tabId: key, contentId: key }
    const terminals = [...current.terminals, tab]
    ctx.webTerminals.retainTabs(terminals, owner)
    state.set({ ...current, terminals, active: key })
  }
  const closeTerminal = (key: string) => {
    const current = state.getSnapshot()
    const tab = current.terminals.find(tab => tab.tabId === key)
    if (!tab) return
    ctx.webTerminals.close(tab.sessionId, tab.tabId, tab.contentId)
    const terminals = current.terminals.filter(tab => tab.tabId !== key)
    ctx.webTerminals.retainTabs(terminals, owner)
    state.set({ ...current, terminals, active: '' })
  }
  for (const panel of ['agents', 'tools', 'terminal'] as const) {
    ctx.effect(() => ctx.researchWorkbench.registerPanel({ id: panel, title: () => ctx.locale.bind('research-runtime')(panel) }))
    ctx.slots.inject('research.panel', () => ctx.slots.register({ name: 'research.panel', key: panel, locale: 'research-runtime',
      inject: (): Injected => ({ panel,
        hooks: { runtime: state, sessions: ctx.sessions.list, closeFailures: ctx.webTerminals.closeFailures },
        open: (id) =>{  ctx.uiWorkspace.openSession(id) }, createTerminal, closeTerminal,
        retryClose: (id) => { ctx.webTerminals.retryClose(id) },
        selectTerminal: (key) =>{  state.set({ ...state.getSnapshot(), active: key }) },
      }),
    }, Page))
  }
}
