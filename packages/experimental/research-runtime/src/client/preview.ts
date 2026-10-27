/** Native document previews open in a reading window independently of the bottom panel. @module */
import { fileAddressFor, isAbsoluteWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ResearchPreview } from '@deepseek-ai/dsh-experimental-research-workbench/client'

/** Route rich working files to the native preview, leaving immutable sources untouched.
 * @param sidebar - Native resource navigation and floating-window controller.
 * @param viewport - Current browser dimensions, read only when opening a file.
 * @returns A disposable research reader contribution; it owns no additional document state. */
export function documentPreview(sidebar: Pick<ISidebarRight, 'mounted' | 'openResource' | 'active' | 'float'>,
  viewport: () => { width: number; height: number }): ResearchPreview {
  return { id: 'native-document', open(resource) {
    const { sessionId, locator } = resource
    if (resource.source !== 'file' || !sessionId || sessionId !== sidebar.mounted.getSnapshot()
      || !locator.root || !locator.path
      || !/\.(?:docx?|pptx?|xlsx?|pdf|png|jpe?g|gif|webp|svg|html?|md|markdown)$/i.test(locator.path)) return false
    const path = isAbsoluteWorkspacePath(locator.path) ? locator.path : `${locator.root.replace(/[\\/]$/, '')}/${locator.path}`
    const address = fileAddressFor(sessionId, undefined, path)
    sidebar.openResource(address)
    const tab = sidebar.active()
    const { width, height } = viewport()
    if (tab && tab.contentId === address && width >= 768) {
      const windowWidth = Math.min(1040, width - 48)
      const windowHeight = Math.max(240, height - 80)
      sidebar.float(tab.id, { x: (width - windowWidth) / 2, y: 40, width: windowWidth, height: windowHeight })
    }
    return true
  } }
}
