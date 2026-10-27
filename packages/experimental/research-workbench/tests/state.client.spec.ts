// @vitest-environment jsdom
/** Draft isolation and recovery across layout changes and delayed save responses. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { createResearchStore } from '../src/client/store.ts'
import { persistResearch, restoreResearch } from '../src/client/persistence.ts'
const resource = (project: string) => ({ source: 'security', id: `${project}:a.txt`, group: project, label: 'a.txt', locator: { project, path: 'a.txt' } })
const content = { text: 'saved', complete: true, version: 'v1', language: 'text' }

it('restores a historical floating reader without persisting binary content or creating a draft', () => {
  const instance = createResearchStore().create()
  const item = resource('history')
  instance.actions.open(item, false)
  instance.actions.floating(item.id, { x: 24, y: 40, width: 1040, height: 720 })
  const media = { ...content, media: { kind: 'pdf' as const, data: new Uint8Array([37, 80, 68, 70]), mediaType: 'application/pdf', missingFonts: [] } }
  instance.actions.edit(item.id, media)
  instance.actions.baseline(item.id, media)
  expect(persistResearch(instance.getSnapshot())).toBe(true)
  const state = restoreResearch().state
  expect(state?.documents[0]?.draft).toBeUndefined()
  expect(state?.documents[0]?.original).toBeUndefined()
  expect(state?.comparison).toBeNull()
  expect(state?.expanded).toBe(false)
  expect(state?.documents[0]?.resource.sessionId).toBeUndefined()
  expect(state?.documents[0]?.floating).toEqual({ x: 24, y: 40, width: 1040, height: 720 })
  expect(state).toMatchSnapshot()
})
afterEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks() })
it('keeps same-path projects, selection and unsaved text through fullscreen and tab-local recovery', () => {
  const instance = createResearchStore().create(); const { actions } = instance
  actions.open(resource('one')); actions.edit('one:a.txt', content); actions.change('one:a.txt', 'draft')
  actions.selection('one:a.txt', { text: 'draft', from: 1, to: 1 }); actions.fullscreen(true); actions.open(resource('two')); actions.fullscreen(false)
  expect(instance.getSnapshot().documents.map(doc => [doc.resource.group, doc.draft])).toEqual([['one', 'draft'], ['two', undefined]])
  expect(persistResearch(instance.getSnapshot())).toBe(true)
  const restored = restoreResearch(); expect(restored.failed).toBe(false); expect(restored.state?.documents[0]?.draft).toBe('draft')
  expect(restored.state?.documents[0]?.selection?.text).toBe('draft'); expect(restored.state?.fullscreen).toBe(false)
  expect(instance.getSnapshot()).toMatchSnapshot()
})
it('does not replace edits made while a save was in flight', () => {
  const instance = createResearchStore().create(); const { actions } = instance
  actions.open(resource('one')); actions.edit('one:a.txt', content); actions.change('one:a.txt', 'submitted'); actions.change('one:a.txt', 'newer draft')
  actions.saved('one:a.txt', 'submitted', { ...content, text: 'submitted', version: 'v2' })
  expect(instance.getSnapshot().documents[0]).toMatchObject({ draft: 'newer draft', original: { text: 'submitted', version: 'v2' } })
})
it('reports invalid recovery and storage quota failures', () => {
  sessionStorage.setItem('dsh.research.v1', '{broken'); expect(restoreResearch()).toEqual({ failed: true })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(persistResearch(createResearchStore().create().getSnapshot())).toBe(false)
})

it('retries restored resources when their adapter arrives and retains floating geometry with drafts', () => {
  const instance = createResearchStore().create()
  instance.actions.open(resource('one'))
  instance.actions.edit('one:a.txt', content)
  instance.actions.change('one:a.txt', 'unsaved')
  instance.actions.floating('one:a.txt', { x: 120, y: 80, width: 640, height: 480 })
  instance.actions.contributions(['security'], [])
  expect(instance.getSnapshot().documents[0]?.epoch).toBe(1)
  expect(persistResearch(instance.getSnapshot())).toBe(true)
  expect(restoreResearch().state?.documents[0]).toMatchObject({
    draft: 'unsaved', floating: { x: 120, y: 80, width: 640, height: 480 },
  })
  instance.actions.contributions([], [])
  expect(instance.getSnapshot().documents[0]?.epoch).toBe(2)
})
