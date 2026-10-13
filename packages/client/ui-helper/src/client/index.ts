/** Optional Helper settings and transcript presentation. */
import helperRemote from '@deepseek-ai/dsh-helper/remote'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HelperSettings } from '@deepseek-ai/dsh-helper/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HelperController } from './controller.ts'
import { HelperSettingsCard } from './HelperSettings.tsx'
import { HelperControl, HelperToolCard, type UsageActions } from './HelperUsage.tsx'
import { en, zh, type HelperKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { helper: HelperKey }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { helperTest: unknown }
}
/** Services used by the optional Helper presentation. */
export const inject = ['remote', 'remote.session', 'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'configForms', 'pluginNavigation']

async function unwrap<T>(promise: Promise<RemoteResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw result.error
  return result.value
}

/**
 * Register Helper settings and tool presentation while its remote is available.
 * @param ctx Browser service context.
 * @returns Awaitable presentation teardown.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(helperRemote)
  const ui = ctx.inject(['remote.helper'], (scoped) => {
    scoped.effect(() => scoped.locale.register('helper', { en, zh }))
    const t = scoped.locale.bind('helper')
    const remote = scoped.remote.helper
    const controller = new HelperController(scoped.configForms.get<HelperSettings>('helper'), {
      loginFailed: () => t('loginFailed'),
      api: async () => {
        const catalog = await unwrap(scoped.remote.session.modelCatalog())
        if (catalog.failures.length) throw new Error(catalog.failures.map(item => `${item.name}: ${item.message}`).join('\n'))
        return catalog.groups.flatMap(group => group.models.map(model => ({ key: `${group.id}/${model.id}`, provider: group.id, id: model.id,
          name: `${group.name} · ${model.name}`, efforts: model.reasoning?.efforts.map(effort => effort.id) ?? [] })))
      },
      codex: async () => (await unwrap(remote.codexModels())).map(model => ({ ...model, key: model.id, provider: 'codex' })),
      account: () => unwrap(remote.account()), login: () => unwrap(remote.login()), cancelLogin: id => unwrap(remote.cancelLogin(id)),
      test: async (workspaceId) => {
        const workspace = scoped.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
        if (!workspace) throw new Error(t('noWorkspace'))
        const id = await scoped.sessions.create({ workspaceId: workspace.workspaceId })
        await scoped.sessions.using(id, { source: 'helperTest' }, async () => {
          const session = scoped.sessions.binding(id)?.session
          if (!session) throw new Error(t('sessionMissing'))
          await unwrap(session.command('/helper on'))
          scoped.uiWorkspace.openSession(id)
          await unwrap(session.prompt([{ type: 'text', text: t('testPrompt') }], 'queue'))
        })
      },
    })
    const face = controller.inject()
    scoped.effect(() => () =>{  controller.dispose() })
    scoped.on('connection/reset', () => { void controller.refresh() })
    scoped.effect(() => scoped.remote.$on('llm/adapters-updated', () => { void controller.refresh() }))
    scoped.effect(() => scoped.remote.$on('settings/document-updated', () => { void controller.refresh() }))
    scoped.effect(() => scoped.configForms.whileServed(['helper'], () => {
      void controller.refresh()
      return scoped.slots.inject('plugins.item', () => scoped.slots.register({ name: 'plugins.item', id: 'helper', order: 31,
        label: () => t('settingsTitle'), locale: 'helper', inject: () => ({ ...face, hooks: { ...face.hooks, helperWorkspaces: scoped.workspaces.list } }) }, HelperSettingsCard))
    }))
    const actions = (id: SessionId): UsageActions => ({
      configure: () => { scoped.pluginNavigation.openItem('helper') },
      toggle: async (enabled) => {
        const session = scoped.sessions.binding(id)?.session
        if (!session) throw new Error(t('sessionMissing'))
        await unwrap(session.command(`/helper ${enabled ? 'on' : 'off'}`))
      },
      openChild: (child) =>{  scoped.uiWorkspace.openSession(child) },
    })
    scoped.slots.inject('conversation.input.left', () => scoped.slots.register({ name: 'conversation.input.left', id: 'helper', locale: 'helper', inject: actions }, HelperControl))
    scoped.slots.inject('tool.call.toolview', () => scoped.slots.register({ name: 'tool.call.toolview', key: 'helper', locale: 'helper', inject: actions }, HelperToolCard))
  })
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}
