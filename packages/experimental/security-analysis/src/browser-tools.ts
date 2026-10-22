/** Explicit Playwright operations admitted by the security workbench. @module */

/** Interactive page tools; arbitrary code, file upload and installation are excluded. */
export const securityBrowserTools: readonly string[] = [
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_take_screenshot',
  'browser_click', 'browser_hover', 'browser_drag', 'browser_type', 'browser_fill_form',
  'browser_press_key', 'browser_select_option', 'browser_wait_for', 'browser_handle_dialog',
  'browser_tabs', 'browser_close', 'browser_console_messages', 'browser_network_requests', 'browser_find', 'browser_resize',
].map(name => 'mcp__playwright-mcp__' + name)

/** Identify the exact supported tools, without admitting future upstream additions.
 * @param name - registered tool identity.
 * @returns whether this is an admitted Playwright operation.
 */
export function isSecurityBrowserTool(name: string): boolean {
  return securityBrowserTools.includes(name)
}
