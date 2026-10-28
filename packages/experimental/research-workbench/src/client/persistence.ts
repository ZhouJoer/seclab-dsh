/** Browser-tab recovery with explicit corruption and quota reporting. @module */
import type { ResearchState } from './store.ts'

const KEY = 'dsh.research.v1'
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function content(value: unknown): boolean {
  if (!record(value) || typeof value.text !== 'string' || typeof value.version !== 'string' || typeof value.language !== 'string' || typeof value.complete !== 'boolean') return false
  if (value.media !== undefined) return false
  if (value.currentPath !== undefined && typeof value.currentPath !== 'string') return false
  if (value.file === undefined) return true
  const file = value.file
  return record(file) && ['path', 'root', 'rootKey', 'targetKey', 'version', 'text'].every(key => typeof file[key] === 'string')
    && typeof file.bytes === 'number' && typeof file.bom === 'boolean' && typeof file.writable === 'boolean'
    && ['lf', 'crlf', 'mixed'].includes(String(file.newline)) && [null, 'binary', 'encoding', 'mixed', 'policy'].includes(file.reason as string | null)
}
/** Validate restored documents before their locators enter resource providers.
 * @param value - untrusted browser storage.
 * @returns whether all fields consumed by the panel are present. */
export function isResearchState(value: unknown): value is ResearchState {
  return record(value) && typeof value.expanded === 'boolean' && typeof value.fullscreen === 'boolean'
    && typeof value.height === 'number' && value.height >= 20 && value.height <= 50
    && ['active', 'group', 'panel', 'notice'].every(key => typeof value[key] === 'string')
    && (value.comparison === null || typeof value.comparison === 'string')
    && Array.isArray(value.sources) && value.sources.every(item => typeof item === 'string')
    && Array.isArray(value.panels) && value.panels.every(item => record(item) && typeof item.id === 'string' && typeof item.title === 'string')
    && Array.isArray(value.documents) && value.documents.every((doc) => {
    if (!record(doc) || !record(doc.resource) || typeof doc.epoch !== 'number' || typeof doc.scroll !== 'number') return false
    const resource = doc.resource
    return ['source', 'id', 'group', 'label'].every(key => typeof resource[key] === 'string')
        && (resource.sessionId === undefined || typeof resource.sessionId === 'string')
        && (resource.line === undefined || (typeof resource.line === 'number' && resource.line >= 1))
        && record(resource.locator) && Object.values(resource.locator).every(item => typeof item === 'string')
        && (doc.draft === undefined || typeof doc.draft === 'string') && (doc.original === undefined || content(doc.original))
        && (doc.selection === undefined || (record(doc.selection) && typeof doc.selection.text === 'string'
          && typeof doc.selection.from === 'number' && typeof doc.selection.to === 'number'))
        && (doc.floating === undefined || (record(doc.floating)
          && ['x', 'y', 'width', 'height'].every(key => typeof doc.floating === 'object' && doc.floating !== null
            && key in doc.floating && Number.isFinite(Reflect.get(doc.floating, key)))))
  })
}
/** Read tab-local drafts, falling back to layout-only persistence.
 * @returns restored state or an explicit storage error. */
export function restoreResearch(): { state?: ResearchState; failed: boolean } {
  try {
    const text = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
    if (!text) return { failed: false }
    const parsed: unknown = JSON.parse(text)
    if (!isResearchState(parsed)) return { failed: true }
    return { state: { ...parsed, fullscreen: false, panels: [], sources: [] }, failed: false }
  } catch (_error) { return { failed: true } }
}
/** Persist drafts only in this browser tab and geometry in local storage.
 * @param state - current panel state.
 * @returns false when recovery could not be written. */
export function persistResearch(state: ResearchState): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
    localStorage.setItem(KEY, JSON.stringify({ ...state, documents: state.documents.map(({ resource, epoch, scroll, floating }) => ({ resource, epoch, scroll, floating })), notice: '', fullscreen: false }))
    return true
  } catch (_error) { return false }
}
