/** Native docking geometry for research documents; drafts remain in the research store. @module */
import type { DockIntents, DockLabels, LayoutState, PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResearchState } from './store.ts'
import './slots.ts'

const root = 'research' as PaneId
const pane = (id: string) => `research:${id}` as PaneId

/** Project open documents into the same docking component used by the right sidebar.
 * @param state - documents and recoverable floating positions.
 * @param props - bound store actions and localized copy.
 * @param narrow - narrow screens dock every reader in the fullscreen layer.
 * @returns layout, labels and mutation intents. */
export function researchDock(
  state: ResearchState, props: FactoryComponentPropsOf<'research.surface'>, narrow: boolean,
): { layout: LayoutState; intents: DockIntents; labels: DockLabels } {
  const docs = state.documents.filter(doc => doc.resource.group === state.group || (doc.floating && !narrow))
  const docked = docs.filter(doc => narrow || !doc.floating)
  const floats = docs.filter(doc => doc.floating && !narrow)
  const active = docked.find(doc => doc.resource.id === state.active) ?? docked[0]
  const layout: LayoutState = {
    rootId: root, activePaneId: floats.some(doc => doc.resource.id === state.active) ? pane(state.active) : root,
    expanded: state.expanded, mode: 'push',
    nodes: { [root]: { kind: 'pane', id: root, host: 'dock', tabs: docked.map(doc => doc.resource.id as TabId),
      activeTabId: active?.resource.id as TabId | undefined, rect: undefined },
    ...Object.fromEntries(floats.map(doc => [pane(doc.resource.id), {
      kind: 'pane' as const, id: pane(doc.resource.id), host: 'float' as const,
      tabs: [doc.resource.id as TabId], activeTabId: doc.resource.id as TabId, rect: doc.floating,
    }])) },
    tabs: Object.fromEntries(docs.map(doc => [doc.resource.id, { id: doc.resource.id as TabId, kind: 'document',
      contentId: doc.resource.id, title: `${doc.resource.label}${doc.draft !== undefined && doc.draft !== doc.original?.text ? ' *' : ''}` }])),
    floats: floats.map(doc => pane(doc.resource.id)),
  }
  const find = (id: PaneId) => floats.find(doc => pane(doc.resource.id) === id)
  const intents: DockIntents = {
    focusTab: (id) =>{  props.actions.select(id) },
    focusPane: (id) => { const doc = find(id); if (doc) props.actions.select(doc.resource.id) },
    closeTab: (id) =>{  props.actions.close(id) },
    floatTab: (id, rect) =>{  props.actions.floating(id, rect ?? { x: 80, y: 80, width: 720, height: 480 }) },
    unfloatPane: (id) => { const doc = find(id); if (doc) props.actions.floating(doc.resource.id, null) },
    moveFloat: (id, x, y) => {
      const doc = find(id)
      if (doc?.floating) props.actions.floating(doc.resource.id, { ...doc.floating, x, y })
    },
    resizeFloat: (id, rect) => { const doc = find(id); if (doc) props.actions.floating(doc.resource.id, rect) },
    placeTab: (id, _pane, index) => { props.actions.floating(id, null); props.actions.reorder(id, index) },
    dropTab: (id) =>{  props.actions.floating(id, null) },
    splitPane: () => {}, addTab: () => {}, duplicateTab: () => {}, resizeSplit: () => {},
  }
  const t = props.t
  const labels: DockLabels = { emptyPane: t('empty'), splitPane: t('split'), splitPaneDisabled: t('split'), splitPaneNarrow: t('split'),
    closeTab: t('close'), addTab: t('files'), dockFloat: t('dock'), closeFloat: t('close'),
    dropZone: { center: t('dock'), left: t('dock'), right: t('dock'), top: t('dock'), bottom: t('dock') } }
  return { layout, intents, labels }
}
