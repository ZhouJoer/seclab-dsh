/** Preview navigation preserves source scope and delegates window management to the native controller. @module */
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ResearchResource } from '@deepseek-ai/dsh-experimental-research-workbench/client'
import { documentPreview } from '../src/client/preview.ts'

const sessionId = SessionId('preview-session')
const resource: ResearchResource = { source: 'file', sessionId, id: 'office', group: 'workspace', label: '报告.docx',
  locator: { root: 'C:/工作目录', path: '报告.docx' } }
function setup(width = 1200) {
  let active: TabRecord | undefined
  const sidebar = { mounted: createSnapshotStore<SessionId | undefined>(sessionId),
    active: () => active, float: vi.fn(), openResource: vi.fn((address: string) => {
      active = { id: 'preview-tab' as TabId, kind: 'text', contentId: address, title: resource.label }
    }) }
  return { sidebar, preview: documentPreview(sidebar, () => ({ width, height: 900 })) }
}
it('opens a Chinese Office path in a large floating window using its actual source directory', () => {
  const { sidebar, preview } = setup()
  expect(preview.open(resource)).toBe(true)
  expect(decodeURIComponent(sidebar.openResource.mock.calls[0]![0])).toContain('C:/工作目录/报告.docx')
  expect(sidebar.float).toHaveBeenCalledWith('preview-tab', { x: 80, y: 40, width: 1040, height: 820 })
})
it('leaves small screens to native fullscreen and refuses other sessions or immutable assets', () => {
  const { sidebar, preview } = setup(390)
  expect(preview.open(resource)).toBe(true)
  expect(sidebar.float).not.toHaveBeenCalled()
  expect(preview.open({ ...resource, source: 'security' })).toBe(false)
  expect(preview.open({ ...resource, sessionId: SessionId('other') })).toBe(false)
  expect(preview.open({ ...resource, locator: { ...resource.locator, path: 'code.ts' } })).toBe(false)
  expect(sidebar.openResource).toHaveBeenCalledTimes(1)
})
