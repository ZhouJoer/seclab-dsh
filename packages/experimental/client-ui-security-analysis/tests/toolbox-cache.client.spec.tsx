// @vitest-environment jsdom
/** Cache controls preserve list state on errors and ignore obsolete environment replies. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as common } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { GhidraHeadlessCache } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { ToolboxCache } from '../src/client/ToolboxCache.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, common)

it('lists only on request, disables busy entries and preserves entries after failed cleanup', async () => {
  const entries = [{ key: 'a'.repeat(64), complete: true, inUse: true }, { key: 'b'.repeat(64), complete: false, inUse: false }]
  const read = vi.fn(async (_environment: string, key?: string) => {
    if (key) throw new Error('Project is now busy')
    return entries
  })
  render(<ToolboxCache environmentId="local" read={read} t={t} />)
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.toolGhidraCaches }))
  await screen.findByText(entries[0]!.key)
  const buttons = screen.getAllByRole<HTMLButtonElement>('button', { name: zh.toolGhidraCacheRemove })
  expect(buttons[0]!.disabled).toBe(true)
  fireEvent.click(buttons[1]!)
  expect((await screen.findByRole('alert')).textContent).toContain('Project is now busy')
  expect(screen.getByText(entries[1]!.key)).toBeDefined()
  expect(read).toHaveBeenLastCalledWith('local', entries[1]!.key)
})

it('ignores a late reply after changing the selected environment', async () => {
  const pending = Promise.withResolvers<GhidraHeadlessCache[]>()
  const read = vi.fn(() => pending.promise)
  const view = render(<ToolboxCache environmentId="local" read={read} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: zh.toolGhidraCaches }))
  view.rerender(<ToolboxCache environmentId="docker" read={read} t={t} />)
  pending.resolve([{ key: 'c'.repeat(64), complete: true, inUse: false }])
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.toolGhidraCaches }).disabled).toBe(false) })
  expect(screen.queryByText('c'.repeat(64))).toBeNull()
})
