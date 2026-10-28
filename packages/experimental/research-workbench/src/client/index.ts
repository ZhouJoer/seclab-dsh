/** Optional research surface, adapters, and generated file Remote. @module */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-experimental-research-workbench/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type BoundActions } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ResearchContent, ResearchPanel, ResearchResource, ResearchSource, ResearchWorkbench } from './contract.ts'
import { createResearchStore } from './store.ts'
import { persistResearch, restoreResearch } from './persistence.ts'
import { Bottom, Overlay, Reference, Surface } from './Surface.tsx'
import { NS, en, zh } from './locales.ts'
import './slots.ts'

export type { ResearchContent, ResearchPanel, ResearchPreview, ResearchResource, ResearchSource, ResearchWorkbench } from './contract.ts'
/** Required browser services; security adapters remain optional. */
export const inject = ['remote', 'slots', 'resources', 'locale', 'uiSession', 'sessions', 'uiWorkspace', 'layout']

/** Mount file RPC and registration-owned browser state.
 * @param ctx - composed browser services.
 * @returns awaited UI and Remote disposal. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.researchFiles'], (scoped) => {
    const lifetime = new AbortController()
    scoped.effect(() => () => { lifetime.abort() })
    scoped.effect(() => scoped.locale.register(NS, { en, zh }))
    scoped.effect(() => scoped.layout.registerBottomPlacement('center'))
    const restored = restoreResearch()
    const handle = createResearchStore(restored.state)
    let actions: BoundActions<typeof handle> | undefined
    const descriptors = new Map(restored.state?.documents.map(doc => [doc.resource.id, doc.resource]) ?? [])
    const queued: { resource: ResearchResource; compare: boolean; floating: boolean }[] = []
    const openReader = (resource: ResearchResource, compare: boolean, floating: boolean) => {
      if (!actions) { queued.push({ resource, compare, floating }); return }
      actions.open(resource, !floating || window.innerWidth < 768)
      if (compare) actions.compare(resource.id)
      if (floating) {
        if (window.innerWidth < 768) actions.fullscreen(true)
        else actions.floating(resource.id, {
          x: 24, y: 40, width: Math.min(1040, window.innerWidth - 48), height: Math.max(240, window.innerHeight - 80),
        })
      }
    }
    const sources = new Map<string, { source: ResearchSource; controller: AbortController; pending: Set<Promise<unknown>> }>()
    const panels = new Map<string, ResearchPanel>()
    const previews = new Map<string, import('./contract.ts').ResearchPreview>()
    const sync = () => actions?.contributions([...sources.keys()],
      [...panels.values()].map(panel => ({ id: panel.id, title: panel.title() })))
    const create = handle.create.bind(handle)
    handle.create = (scope) => {
      const instance = create(scope)
      actions = instance.actions
      sync()
      for (const item of queued.splice(0)) openReader(item.resource, item.compare, item.floating)
      if (restored.failed) actions.notice(scoped.locale.bind(NS)('storage'))
      let reporting = false
      scoped.effect(() => instance.subscribe(() => {
        if (reporting || persistResearch(instance.getSnapshot())) return
        reporting = true
        instance.actions.notice(scoped.locale.bind(NS)('storage'))
        reporting = false
      }))
      return instance
    }
    const navigate = (resource: ResearchResource, compare: boolean, floating = false) => {
      if (!compare) for (const preview of previews.values()) { if (preview.open(resource)) return }
      descriptors.set(resource.id, resource)
      openReader(resource, compare, floating)
    }
    const service: ResearchWorkbench = {
      open: (resource, options) =>{  navigate(resource, false, options?.floating) }, compare: (resource) =>{  navigate(resource, true) },
      registerPreview(preview) {
        if (previews.has(preview.id)) throw new Error(`Duplicate research preview: ${preview.id}`)
        previews.set(preview.id, preview)
        return () => { if (previews.get(preview.id) === preview) previews.delete(preview.id) }
      },
      registerSource(source) {
        if (sources.has(source.id)) throw new Error(`Duplicate research source: ${source.id}`)
        const entry = { source, controller: new AbortController(), pending: new Set<Promise<unknown>>() }
        sources.set(source.id, entry)
        sync()
        return async () => {
          entry.controller.abort()
          if (sources.get(source.id) === entry) { sources.delete(source.id); sync() }
          await Promise.allSettled(entry.pending)
        }
      },
      registerPanel(panel) {
        if (panels.has(panel.id)) throw new Error(`Duplicate research panel: ${panel.id}`)
        panels.set(panel.id, panel); sync()
        return () => { if (panels.get(panel.id) === panel) { panels.delete(panel.id); sync() } }
      },
    }
    const disposeService = scoped.reflect.provide('researchWorkbench', service)
    scoped.effect(() => disposeService)
    const failure = (): RemoteResult<never> => ({ ok: false, error: new RemoteError('gateway/internal', scoped.locale.bind(NS)('unavailable'), {}) })
    const fileContent = (file: import('../types.ts').ResearchFile): ResearchContent => ({ text: file.text, version: file.version, complete: true, language: file.path.split('.').at(-1) ?? 'text', file })
    scoped.effect(() => service.registerSource({ id: 'file',
      async read(resource, signal) {
        if (!resource.sessionId) return failure()
        const result = await scoped.remote.researchFiles.read(resource.sessionId, resource.locator.path ?? '', signal)
        if (!result.ok) return result
        if (resource.locator.root && result.value.root !== resource.locator.root) return failure()
        return { ok: true, value: fileContent(result.value) }
      },
      async save(resource, original, text, signal) {
        if (!resource.sessionId || !original.file) return failure()
        const file = original.file
        const result = await scoped.remote.researchFiles.save(resource.sessionId, {
          path: file.path, rootKey: file.rootKey, targetKey: file.targetKey, version: file.version, text,
        }, signal)
        return result.ok ? { ok: true, value: fileContent(result.value) } : result
      },
    }))
    scoped.effect(() => scoped.resources.register({ protocol: 'research', async *open(address, { signal }) {
      const url = new URL(address)
      const id = url.searchParams.get('id')
      const descriptor = descriptors.get(id ?? '')
      const entry = descriptor && sources.get(descriptor.source)
      if (!descriptor || !entry) { yield failure(); return }
      const combined = AbortSignal.any([signal, lifetime.signal, entry.controller.signal])
      let pending: Promise<RemoteResult<ResearchContent>> | undefined
      try {
        pending = entry.source.read(descriptor, combined)
        entry.pending.add(pending)
        const result = await pending
        if (!combined.aborted) yield result
      }
      catch (error) { if (!combined.aborted) yield { ok: false, error: new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}) } }
      finally { if (pending) entry.pending.delete(pending) }
    } }))
    scoped.effect(() => scoped.resources.register({ protocol: 'research-directory', async *open(address, { signal }) {
      const url = new URL(address)
      const session = url.searchParams.get('session')
      if (!session) { yield failure(); return }
      const result = await scoped.remote.researchFiles.list(SessionId(session), url.searchParams.get('path') ?? '', signal)
      if (!signal.aborted) yield result
    } }))
    const media = window.matchMedia('(max-width: 767px)')
    const view = createSnapshotStore<{ narrow: boolean; session: SessionReference | undefined }>({
      narrow: media.matches, session: undefined,
    })
    scoped.effect(() => {
      let retained: SessionReference | undefined
      const update = () => {
        const key = scoped.uiSession.adapter.current.getSnapshot().key
        if (retained?.sessionId === key) return
        const previous = retained
        retained = key ? scoped.sessions.retain(SessionId(key), { source: 'researchWorkbench' }) : undefined
        view.set({ narrow: media.matches, session: retained }); previous?.release()
      }
      const resize = () =>{  view.set({ narrow: media.matches, session: retained }) }
      const dispose = scoped.uiSession.adapter.current.subscribe(update)
      media.addEventListener('change', resize); update()
      return () => { dispose(); media.removeEventListener('change', resize); retained?.release() }
    })
    scoped.effect(() => scoped.slots.registerFactory({ name: 'research.surface', scope: 'root', store: handle, locale: NS,
      children: { 'research.panel': { kind: 'keyed', scope: 'session-maybe' }, 'research.reference': { kind: 'single', scope: 'session' } },
      inject: () => ({ hooks: { view }, open: (resource) =>{  service.open(resource) },
        openChat: (resource) => { if (resource.sessionId) scoped.uiWorkspace.openSession(resource.sessionId) },
        save: async (resource, original, text) => {
          const entry = sources.get(resource.source)
          if (!entry?.source.save) return failure()
          const signal = AbortSignal.any([lifetime.signal, entry.controller.signal])
          const pending = entry.source.save(resource, original, text, signal)
          entry.pending.add(pending)
          try { return await pending } finally { entry.pending.delete(pending) }
        } }),
    }, Surface))
    scoped.slots.inject('research.reference', () => scoped.slots.register({ name: 'research.reference', locale: NS }, Reference))
    scoped.slots.inject('shell.bottom', () => scoped.slots.register({ name: 'shell.bottom' }, Bottom))
    scoped.slots.inject('shell.overlay', () => scoped.slots.register({ name: 'shell.overlay', id: 'research-workbench' }, Overlay))
  })
  return async () => { await ui.dispose(); await disposeRemote() }
}
