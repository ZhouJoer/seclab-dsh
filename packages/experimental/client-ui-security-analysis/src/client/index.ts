/** Mount the generated security Remote contribution and localized workbench. @module */
import { ResourceActions } from './ResourceActions.tsx'
import securityRemote from '@deepseek-ai/dsh-experimental-security-analysis/remote'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ProjectIcon, type ProjectActions } from './project-actions.tsx'
import { SecurityToolRow, securityToolNames } from './SecurityToolRow.tsx'
import type { WorkbenchActions } from './Workbench.tsx'
import { selectCoordinator } from './session-selection.ts'
import type { DashboardActions } from './Dashboard.tsx'
import { AnalysisHome, type AnalysisDestination } from './AnalysisHome.tsx'
import { SecurityDirectory } from './directory.ts'
import { NewAnalysisMenu, SecuritySessionBadge, SecurityConversationNavigation, SecuritySessionMenu } from './SecurityNavigation.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ImprovementToast, improvementNotifications } from './Improvements.tsx'
import { ConversationProgressLauncher, ConversationProgressTab, ConversationProgressTitle, type ConversationProgressActions, type ConversationProgressEntryActions } from './ConversationProgress.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DashboardSession, type DashboardSessionInput } from './DashboardSession.tsx'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { NS, zh, en, type SecurityKey } from './locales.ts'
import { SidebarWorkbench, SidebarWorkbenchTitle } from './SidebarWorkbench.tsx'
import { IconShieldOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { FirstMessageSetup, type FirstMessageSetupInjected } from './FirstMessageSetup.tsx'
import { FirstMessagePreparation } from './first-message.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Retained coordinator Session hosted within the security task detail. */
    'security.workbench.session': { kind: 'single'; scope: 'session'; owner: DashboardSessionInput }
    /** Retained settings scoped to the workbench's sidebar occurrence. */
    'security.workbench.sidebar.session': { kind: 'single'; scope: 'session'; owner: DashboardSessionInput }
  }
  interface LocaleNamespaceMap {
    /** Security workbench operator-facing copy. */
    'security-workbench': SecurityKey
  }
}
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Task to display beside the current conversation; omission opens the task list. */
    'security-workbench': { projectId?: string }
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { securityWorkbench: unknown }
}
/** Services required to mount security RPC and the input dock. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'conversation', 'layout', 'workspaces', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs', 'resources']

async function unwrap<T>(pending: Promise<RemoteResult<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}
/**
 * Mount the generated namespace before registering its consumer.
 * @param ctx - browser context with Remote, slots and locale.
 * @returns disposer that awaits both UI and Remote teardown.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.slots.registerFactory({ name: 'security.resource.actions', scope: 'root', children: { 'security.resource.actions.item': { kind: 'list', scope: 'root' } } }, ResourceActions))
  const disposeRemote = await ctx.remote.$mount(securityRemote)
  const ui = ctx.inject(['remote.securityWorkbench', 'slots', 'locale'], (scoped) => {
    scoped.effect(() => scoped.locale.register(NS, { zh, en }))
    for (const key of securityToolNames) scoped.slots.inject('tool.call.toolview', () =>
      scoped.slots.register({ name: 'tool.call.toolview', key, locale: NS }, SecurityToolRow))
    const remote = scoped.remote.securityWorkbench
    scoped.effect(() => scoped.resources.register<'security-material'>({ protocol: 'security-material',
      async *open(address, { signal }) {
        const url = new URL(address)
        const [project, asset] = url.pathname.slice(1).split('/').map(decodeURIComponent)
        const result = await remote.projectMaterial(project ?? '', JSON.stringify({ assetId: asset ?? '',
          mode: url.searchParams.get('mode'), path: url.searchParams.get('path'), offset: Number(url.searchParams.get('offset')) }))
        if (!signal.aborted) yield result
      },
    }))
    const notifications = improvementNotifications()
    scoped.slots.inject('shell.overlay', () => scoped.slots.register({ name: 'shell.overlay', id: 'security-improvements-toast',
      inject: () => ({ notifications }) }, ImprovementToast))
    const projectActions: ProjectActions = {
      deviceDirectory: id => unwrap(remote.deviceDirectory(id)),
      deviceInventory: id => unwrap(remote.deviceInventory(id)),
      toolboxConfiguration: id => unwrap(remote.toolboxConfiguration(id)),
      configureTool: (id, input) => unwrap(remote.configureTool(id, input)),
      toolboxFiles: (id, directory) => unwrap(remote.toolboxFiles(id, directory)),
      toolboxInventory: (id, tools) => unwrap(remote.toolboxInventory(id, tools)),
      toolboxDirectory: id => unwrap(remote.toolboxDirectory(id)),
      toolCatalog: () => unwrap(remote.toolCatalog()),
      scriptCatalog: () => unwrap(remote.scriptCatalog()),
      previewToolPack: input => unwrap(remote.previewToolPack(input)),
      importToolPack: (input, revision, replace) => unwrap(remote.importToolPack(input, revision, replace)),
      exportToolPack: id => unwrap(remote.exportToolPack(id)),
      manageProject: (id, input) => unwrap(remote.manageProject(id, input)),
      projects: () => unwrap(remote.projects()), project: id => unwrap(remote.project(id)),
      laboratory: (project, action, id) => unwrap(remote.laboratory(project, action, id)),
      report: (project, id, format) => unwrap(remote.report(project, id, format)),
      subscribeReset: listener => scoped.on('connection/reset', listener),
    }
    const panel = 'security-projects' as MainPanelId
    const destination = createSnapshotStore<AnalysisDestination>({ kind: 'overview' })
    const directory = new SecurityDirectory(signal => remote.followProjects(signal), async (id, title) => {
      const snapshot = await unwrap(remote.project(id))
      await unwrap(remote.manageProject(id, JSON.stringify({ operationId: randomUUID(), expectedRevision: snapshot.revision,
        action: { kind: 'rename', title } })))
    })
    scoped.effect(() => { directory.start(); return () => directory.close() })
    scoped.on('connection/reset', () => { directory.start() })
    scoped.effect(() => scoped.sessions.registerPresentation(directory.presentations))
    const preparation = new FirstMessagePreparation(id => remote.prepareAnalysis(id), code => scoped.locale.bind(NS)(
      code === 'security/setup-required' ? 'startupSetupRequired' : code === 'unsaved' ? 'startupUnsaved'
        : code === 'tools-busy' ? 'startupToolsBusy' : 'startupCreateFailed'))
    scoped.effect(() => () => preparation.close())
    scoped.effect(() => scoped.sessions.registerPresentation(preparation.presentations))
    const associated = (id: SessionId) => directory.getSnapshot().projects.some(project =>
      project.sessions.some(session => session.sessionId === id))
    const refreshHints = () => {
      const sessions = scoped.sessions.list.getSnapshot()
      for (const id of sessions.ids) {
        const state = preparation.state.getSnapshot()[id]
        if (sessions.byId[id]?.projectionValues?.agentPreset !== 'security'
          && (state?.needsSave || state?.toolsDirty || state?.toolsBusy)) preparation.reset(id)
      }
      preparation.present(sessions.ids.filter(id => sessions.byId[id]?.projectionValues?.agentPreset === 'security' && !associated(id)),
        scoped.locale.bind(NS)('startupPlaceholder'))
    }
    scoped.effect(() => scoped.sessions.list.subscribe(refreshHints))
    scoped.effect(() => directory.subscribe(refreshHints))
    scoped.on('locale/change', refreshHints)
    refreshHints()
    scoped.on('conversation/before-send', async (id, signal) => {
      signal?.throwIfAborted()
      if (scoped.sessions.list.getSnapshot().byId[id]?.projectionValues?.agentPreset !== 'security' || associated(id)) return
      await preparation.run(id)
    })
    scoped.effect(() => scoped.resources.register<'security-startup'>({ protocol: 'security-startup',
      async *open(address, { signal }) {
        const id = decodeURIComponent(new URL(address).pathname.slice(1)) as SessionId
        const result = await remote.configuration(id)
        if (!signal.aborted) yield result
      },
    }))
    scoped.slots.inject('conversation.input.dock', () => scoped.slots.register({ name: 'conversation.input.dock',
      id: 'security-first-message', order: -30, locale: NS,
      inject: (): FirstMessageSetupInjected => ({ hooks: { preparation: preparation.state, directory },
        saveSetup: async (id, input) => { await unwrap(remote.configureStartup(id, input)); preparation.refresh(id) },
        saveDefaults: async (id, input) => { await unwrap(remote.configureWorkspace(id, input)); preparation.refresh(id) },
        refreshSetup: (id) => { preparation.refresh(id) },
        editSetup: (id) => { preparation.edited(id) },
        toolPreferenceOptions: id => unwrap(remote.toolPreferenceOptions(id)),
        toolPreferences: (id, input) => unwrap(remote.toolPreferences(id, input)),
        editTools: (id, toolsDirty) => { preparation.tools(id, { toolsDirty }) },
        toolsReady: (id, ready) => { preparation.tools(id, { toolsBusy: !ready }) },
      }),
    }, FirstMessageSetup))
    const openWorkbench = (projectId: string, sessionId?: SessionId) => {
      scoped.layout.beginNavigation()
      destination.set(projectId ? { kind: 'project', projectId, ...(sessionId ? { sessionId } : {}) } : { kind: 'overview' })
      scoped.layout.selectPanel(panel)
    }
    const beginAnalysis = () => {
      scoped.layout.beginNavigation()
      const sessions = scoped.sessions.list.getSnapshot()
      const current = sessions.ids.find(id => sessions.byId[id]?.retainedBy.mainView)
      const workspaces = scoped.workspaces.list.getSnapshot().items
      const workspaceId = workspaces.find(item => current && item.sessionIds.includes(current))?.workspaceId ?? workspaces[0]?.workspaceId
      destination.set({ kind: 'create', ...(workspaceId ? { workspaceId } : {}) })
      scoped.layout.selectPanel(panel)
    }
    const navigation = () => ({ hooks: { directory }, openWorkbench })
    const openSidebarWorkbench = (projectId?: string) => {
      scoped.sidebarRight.openTab('security-workbench', { params: projectId ? { projectId } : {} })
    }
    scoped.slots.inject('sidebar.session.row.badge', () => scoped.slots.register({ name: 'sidebar.session.row.badge',
      id: 'security-analysis', locale: NS, inject: navigation }, SecuritySessionBadge))
    scoped.slots.inject('sidebar.workspaces.session.menu.item', () => scoped.slots.register({ name: 'sidebar.workspaces.session.menu.item',
      id: 'security-analysis', order: 210, locale: NS, inject: navigation }, SecuritySessionMenu))
    scoped.slots.inject('conversation.session.header.navigation', () => scoped.slots.register({ name: 'conversation.session.header.navigation',
      id: 'security-analysis', locale: NS, inject: () => ({ hooks: { directory }, openWorkbench: openSidebarWorkbench }) }, SecurityConversationNavigation))
    scoped.slots.inject('sidebar.new.item', () => scoped.slots.register({ name: 'sidebar.new.item',
      id: 'security-analysis', locale: NS, inject: () => ({ beginAnalysis }) }, NewAnalysisMenu))
    scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({ name: 'sidebar.panellist', id: panel, order: 30, label: () => scoped.locale.bind(NS)('title'), locale: NS }, ProjectIcon))
    const actions: WorkbenchActions = {
      openChild: (address) => { scoped.uiWorkspace.openSession(address) },
      toolPreferenceOptions: id => unwrap(remote.toolPreferenceOptions(id)),
      toolPreferences: (id, input) => unwrap(remote.toolPreferences(id, input)),
      followActivity: (id, signal) => remote.followActivity(id, signal),
      skillUsage: id => unwrap(remote.skillUsage(id)),
      activityDetails: (id, checkpoint, offset, through) => unwrap(remote.activityDetails(id, checkpoint, offset, through)),
      sendAnalysis: async (id, objective) => {
        const session = scoped.sessions.binding(id)?.session
        if (!session) throw new Error(scoped.locale.bind(NS)('analysisSessionChanged'))
        await unwrap(session.prompt([{ type: 'text', text: objective }], 'queue'))
      },
      openAnalysisChat: (id, objective) => {
        const binding = scoped.sessions.binding(id)
        if (!binding) throw new Error(scoped.locale.bind(NS)('analysisSessionChanged'))
        const input = scoped.conversation.input.for(binding.ctx)
        if (!input.state.getSnapshot().draft) input.setDraft(objective)
        scoped.uiWorkspace.openSession(id)
      },
      manageProject: projectActions.manageProject,
      importMaterials: (id, input) => unwrap(remote.importMaterials(id, input)),
      subscribeReset: projectActions.subscribeReset,
      load: id => unwrap(remote.view(id)),
      observe: (id, input) => unwrap(remote.observe(id, input)),
      refine: id => unwrap(remote.refineKnowledge(id)),
      command: (id, command) => unwrap(remote.command(id, command)),
      configuration: id => unwrap(remote.configuration(id)),
      configureWorkspace: (id, input) => unwrap(remote.configureWorkspace(id, input)),
      environment: (id, environment, action) => unwrap(remote.environment(id, environment, action)),
      execute: (id, plan, operation, revision) => unwrap(remote.execute(id, plan, operation, revision)),
      search: (id, query, shared) => unwrap(remote.search(id, query, shared)),
      artifact: (id, hash) => unwrap(remote.artifact(id, hash)),
      report: projectActions.report,
    }
    const changeProjectState = async (id: SessionId, kind: 'stop' | 'resume') => {
      await scoped.sessions.using(id, { source: 'securityWorkbench' }, async () => {
        const view = await actions.load(id)
        await actions.command(id, JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action: { kind } }))
      })
    }
    const dashboardActions: DashboardActions = {
      generateReport: (id, revision) => scoped.sessions.using(id, { source: 'securityWorkbench' }, () =>
        actions.command(id, JSON.stringify({ operationId: randomUUID(), expectedRevision: revision, action: { kind: 'report' } }))),
      beginAnalysis,
      openChat: (id) => { scoped.uiWorkspace.openSession(id) },
      selectDestination: (id) => { openWorkbench(id) },
      refreshWorkspaceMaterials: id => unwrap(remote.refreshWorkspaceMaterials(id)),
      configureWorkspace: (id, input) => actions.configureWorkspace(id, input),
      followProjects: signal => directory.followProjects(signal),
      httpHistory: (project, input) => unwrap(remote.httpHistory(project, input)),
      httpExchange: (project, evidence, step, part, offset) => unwrap(remote.httpExchange(project, evidence, step, part, offset)),
      httpIdentities: (project, target) => unwrap(remote.httpIdentities(project, target)),
      configureHttpIdentity: (project, target, input) => unwrap(remote.configureHttpIdentity(project, target, input)),
      removeHttpIdentity: (project, target, identity) => unwrap(remote.removeHttpIdentity(project, target, identity)),
      configuration: session => actions.configuration(session),
      command: (session, input) => actions.command(session, input),
      execute: (session, plan, operation, revision) => actions.execute(session, plan, operation, revision),
      observe: (id, input) => scoped.sessions.using(id, { source: 'securityWorkbench' }, () => unwrap(remote.observe(id, input))),
      analyzeImprovements: input => unwrap(remote.analyzeImprovements(input)),
      updateImprovement: input => unwrap(remote.updateImprovement(input)),
      exportImprovement: id => unwrap(remote.exportImprovement(id)),
      followImprovements: signal => remote.followImprovements(signal),
      notifyImprovement: notifications.push,
      ...projectActions,
      openChild: actions.openChild,
      followActivity: actions.followActivity,
      skillUsage: actions.skillUsage,
      activityDetails: actions.activityDetails,
      projectArtifact: (id, hash) => unwrap(remote.projectArtifact(id, hash)),
      findSession: async (projectId) => {
        const [ids] = await Promise.all([unwrap(remote.projectSessions(projectId)), scoped.sessions.refresh()])
        const directory = scoped.sessions.list.getSnapshot()
        const archived = scoped.workspaces.list.getSnapshot().archivedSessionIds
        return selectCoordinator(ids, directory, archived)
      },
      createSession: workspaceId => scoped.sessions.create({ workspaceId }),
      restartTask: (id, paths) => unwrap(remote.restartTask(id, JSON.stringify(paths))),
      openRestartDraft: async (id, objective) => {
        await scoped.sessions.using(id, { source: 'securityWorkbench' }, () => {
          const binding = scoped.sessions.binding(id)
          if (!binding) throw new Error(scoped.locale.bind(NS)('analysisSessionChanged'))
          scoped.conversation.input.for(binding.ctx).setDraft(objective)
          scoped.uiWorkspace.openSession(id)
          return Promise.resolve()
        })
      },
      retainSession: id => scoped.sessions.retain(id, { source: 'securityWorkbench' }),
      associateSession: async (id, projectId) => {
        await scoped.sessions.using(id, { source: 'securityWorkbench' }, async () => {
          const view = await unwrap(remote.project(projectId))
          await unwrap(remote.command(id, JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision,
            action: { kind: 'select', engagementId: projectId } })))
        })
      },
      stopProject: id => changeProjectState(id, 'stop'),
      resumeProject: id => changeProjectState(id, 'resume'),
      createWorkspace: async path => (await scoped.workspaces.create({ path })).workspaceId,
    }
    scoped.slots.inject('main', () => scoped.slots.register({
      name: 'main', key: panel, locale: NS,
      children: { 'security.workbench.session': { kind: 'single', scope: 'session' } },
      inject: () => ({ ...dashboardActions, hooks: { destination },
        configurationForWorkspace: (id: import('@deepseek-ai/dsh-api-workspace-controller/client').WorkspaceId) => unwrap(remote.configurationForWorkspace(id)),
        configureAnalysisWorkspace: (id: import('@deepseek-ai/dsh-api-workspace-controller/client').WorkspaceId, input: string) => unwrap(remote.configureAnalysisWorkspace(id, input)),
        startAnalysis: async (id: import('@deepseek-ai/dsh-api-workspace-controller/client').WorkspaceId, input: string) => {
          const result = await unwrap(remote.startAnalysis(id, input))
          await scoped.sessions.refresh()
          return result
        },
      }),
    }, AnalysisHome))
    scoped.slots.inject('security.workbench.session', () => scoped.slots.register({
      name: 'security.workbench.session', locale: NS, inject: () => actions,
    }, DashboardSession))
    const workbenchId = '@deepseek-ai/dsh-experimental-client-ui-security-analysis/workbench'
    scoped.effect(() => scoped.sidebarRightTabs.register({ id: workbenchId, kind: 'security-workbench', priority: 'builtin',
      keepMounted: true, title: () => scoped.locale.bind(NS)('dashboardEntry'),
      guide: [{ id: 'security-workbench', order: 31, title: () => scoped.locale.bind(NS)('dashboardEntry'), icon: IconShieldOutlineRegular }],
    }))
    scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab', key: workbenchId, locale: NS,
      children: { 'security.workbench.sidebar.session': { kind: 'single', scope: 'session' } },
      inject: () => dashboardActions,
    }, SidebarWorkbench))
    scoped.slots.inject('security.workbench.sidebar.session', () => scoped.slots.register({
      name: 'security.workbench.sidebar.session', locale: NS, inject: () => actions,
    }, DashboardSession))
    scoped.slots.inject('sidebar.right.pane.tab.title', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab.title', key: workbenchId, locale: NS,
    }, SidebarWorkbenchTitle))
    const progressId = '@deepseek-ai/dsh-experimental-client-ui-security-analysis/progress'
    scoped.effect(() => scoped.sidebarRightTabs.register({ id: progressId, kind: 'security-progress', priority: 'builtin',
      title: () => scoped.locale.bind(NS)('activityEntry'),
      guide: [{ id: 'security-progress', order: 30, title: () => scoped.locale.bind(NS)('activityEntry') }],
    }))
    scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab', key: progressId, locale: NS,
      inject: (): ConversationProgressActions => {
        return { ...dashboardActions,
          followSessionView: (id, signal) => remote.followSessionView(id, signal),
          openDashboard: openSidebarWorkbench,
        }
      },
    }, ConversationProgressTab))
    scoped.slots.inject('sidebar.right.pane.tab.title', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab.title', key: progressId, locale: NS,
    }, ConversationProgressTitle))
    scoped.slots.inject('conversation.input.dock', () => scoped.slots.register({
      name: 'conversation.input.dock', id: 'security-workbench', order: 30, locale: NS,
      inject: (): ConversationProgressEntryActions => ({ followSessionView: (id, signal) => remote.followSessionView(id, signal),
        followActivity: (id, signal) => actions.followActivity(id, signal), subscribeReset: actions.subscribeReset,
        openProgress: () => { scoped.sidebarRight.openTab('security-progress') },
        openDashboard: openSidebarWorkbench }),
    }, ConversationProgressLauncher))
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

export type { SecurityResourceAction } from './ResourceActions.tsx'
