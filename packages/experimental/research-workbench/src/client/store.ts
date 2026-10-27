/** Research view state and recoverable drafts, separate from resource reads. @module */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { FloatRect } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { ResearchContent, ResearchResource } from './contract.ts'

/** One open document and its explicitly started editing draft. */
export interface ResearchDocument {
  resource: ResearchResource
  epoch: number
  original?: ResearchContent
  draft?: string
  scroll: number
  floating?: FloatRect
  selection?: { text: string; from: number; to: number }
}
/** Root-owned state shared by bottom and fullscreen occurrences. */
export interface ResearchState {
  expanded: boolean
  fullscreen: boolean
  height: number
  active: string
  group: string
  panel: string
  documents: ResearchDocument[]
  comparison: string | null
  panels: { id: string; title: string }[]
  sources: string[]
  notice: string
}

type ResearchActions = {
  floating: (state: ResearchState, id: string, rect: FloatRect | null) => void
  reorder: (state: ResearchState, id: string, index: number) => void
  open: (state: ResearchState, resource: ResearchResource, expand?: boolean) => void
  select: (state: ResearchState, id: string) => void
  toggle: (state: ResearchState) => void
  fullscreen: (state: ResearchState, value: boolean) => void
  height: (state: ResearchState, value: number) => void
  panel: (state: ResearchState, id: string) => void
  contributions: (state: ResearchState, sources: string[], panels: { id: string; title: string }[]) => void
  edit: (state: ResearchState, id: string, original: ResearchContent) => void
  change: (state: ResearchState, id: string, text: string) => void
  saved: (state: ResearchState, id: string, text: string, original: ResearchContent) => void
  discard: (state: ResearchState, id: string) => void
  refresh: (state: ResearchState, id: string) => void
  close: (state: ResearchState, id: string) => void
  closeSaved: (state: ResearchState, id: string, submitted: string) => void
  compare: (state: ResearchState, id: string | null) => void
  baseline: (state: ResearchState, id: string, original: ResearchContent) => void
  selection: (state: ResearchState, id: string, selection: { text: string; from: number; to: number }) => void
  scroll: (state: ResearchState, id: string, position: number) => void
  notice: (state: ResearchState, message: string) => void
}

/** Build a registration-owned store; the renderer creates its live instance.
 * @param initial - validated restoration from the current browser tab.
 * @returns shared root store declaration. */
export function createResearchStore(initial?: ResearchState): EngineStoreHandle<ResearchState, ResearchActions> {
  return defineStore({
    init: (): ResearchState => initial ?? ({ expanded: false, fullscreen: false, height: 30, active: '', group: '', panel: '', documents: [], comparison: null, panels: [], sources: [], notice: '' }),
    actions: {
      floating(state, id: string, rect: FloatRect | null) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (!doc) return
        if (rect) doc.floating = rect
        else delete doc.floating
        state.active = id
      },
      reorder(state, id: string, index: number) {
        const previous = state.documents.findIndex(item => item.resource.id === id)
        if (previous < 0) return
        const [doc] = state.documents.splice(previous, 1)
        if (doc) state.documents.splice(index, 0, doc)
      },
      open(state, resource: ResearchResource, expand = true) {
        if (!state.documents.some(doc => doc.resource.id === resource.id)) state.documents.push({ resource, epoch: 0, scroll: 0 })
        state.active = resource.id
        state.group = resource.group
        state.panel = resource.source === 'file' ? 'files' : ''
        if (expand) state.expanded = true
      },
      select(state, id: string) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc) { state.active = id
          state.group = doc.resource.group
          state.panel = '' }
      },
      toggle(state) { state.expanded = !state.expanded; if (!state.expanded) state.fullscreen = false },
      fullscreen(state, value: boolean) { state.fullscreen = value; state.expanded = true },
      height(state, value: number) { state.height = Math.max(20, Math.min(50, value)) },
      panel(state, id: string) { state.panel = id; state.expanded = true },
      contributions(state, sources: string[], panels: { id: string; title: string }[]) {
        for (const doc of state.documents) {
          if (state.sources.includes(doc.resource.source) !== sources.includes(doc.resource.source)) doc.epoch++
        }
        state.sources = sources
        state.panels = panels
      },
      edit(state, id: string, original: ResearchContent) {
        if (original.media) return
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc) { doc.original = original
          doc.draft = original.text }
      },
      change(state, id: string, text: string) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc?.original) doc.draft = text
      },
      saved(state, id: string, text: string, original: ResearchContent) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (!doc) return
        doc.original = original
        if (doc.draft === text) doc.draft = original.text
        doc.epoch++
      },
      discard(state, id: string) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc) { delete doc.draft
          delete doc.original
          doc.epoch++ }
      },
      refresh(state, id: string) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc && doc.draft === undefined) { delete doc.original
          doc.epoch++ }
      },
      close(state, id: string) {
        state.documents = state.documents.filter(item => item.resource.id !== id)
        if (state.active === id) state.active = state.documents.find(item => item.resource.group === state.group)?.resource.id ?? ''
        if (state.comparison === id) state.comparison = null
      },
      closeSaved(state, id: string, submitted: string) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc?.draft !== submitted) return
        state.documents = state.documents.filter(item => item.resource.id !== id)
        if (state.active === id) state.active = state.documents.find(item => item.resource.group === state.group)?.resource.id ?? ''
        if (state.comparison === id) state.comparison = null
      },
      compare(state, id: string | null) { state.comparison = id },
      baseline(state, id: string, original: ResearchContent) {
        if (original.media) return
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc) { doc.original = original
          state.comparison = id }
      },
      selection(state, id: string, selection: { text: string; from: number; to: number }) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc) doc.selection = selection
      },
      scroll(state, id: string, position: number) {
        const doc = state.documents.find(item => item.resource.id === id)
        if (doc) doc.scroll = position
      },
      notice(state, message: string) { state.notice = message },
    },
  })
}
