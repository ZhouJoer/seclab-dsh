// @vitest-environment jsdom
/** Operator module selection remains editable after save failures. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ProjectModules, ProjectUnseal } from '../src/client/ModuleSelection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('saves a manual combination and retains it when the server rejects the revision', async () => {
  const save = vi.fn(async () => { throw new Error('Revision changed') })
  render(<ProjectModules value={undefined} save={save} t={makeTranslate(zh, commonZh)} />)
  fireEvent.click(screen.getByText(zh.moduleTitle, { selector: 'summary' }))
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: zh.moduleAndroid }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(zh.moduleMode), { target: { value: 'manual' } })
  fireEvent.click(screen.getByRole('checkbox', { name: zh.moduleAndroid }))
  fireEvent.click(screen.getByRole('checkbox', { name: zh.moduleNative }))
  fireEvent.click(screen.getByRole('button', { name: zh.moduleSave }))
  await screen.findByRole('alert')
  expect(save).toHaveBeenCalledWith({ mode: 'manual', modules: ['reverse.android', 'reverse.native'], reason: '' })
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: zh.moduleAndroid }).checked).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe('Revision changed')
  expect(screen.getByText('security-android')).toBeDefined()
})

it('returns a manual task to an empty automatic selection without probing tools', async () => {
  const save = vi.fn(async () => {})
  render(<ProjectModules value={{ mode: 'manual', modules: ['reverse.android'], reason: 'APK' }} save={save} t={makeTranslate(zh, commonZh)} />)
  fireEvent.click(screen.getByText(zh.moduleTitle, { selector: 'summary' }))
  fireEvent.change(screen.getByLabelText(zh.moduleMode), { target: { value: 'auto' } })
  fireEvent.click(screen.getByRole('button', { name: zh.moduleSave }))
  await waitFor(() =>{  expect(save).toHaveBeenCalledWith({ mode: 'auto', modules: [], reason: '' }) })
  expect(screen.getByText(zh.modulePending)).toBeDefined()
})

it('toggles the direct-execution contract immediately and retains save errors', async () => {
  const save = vi.fn(async () => { throw new Error('Revision changed') })
  render(<ProjectUnseal value={undefined} save={save} t={makeTranslate(zh, commonZh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh.unsealEnable }))
  await screen.findByRole('alert')
  expect(save).toHaveBeenCalledWith(true)
  expect(screen.getByRole('alert').textContent).toBe('Revision changed')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.unsealEnable }).disabled).toBe(false)
})

it('keeps the committed mode while saving and preserves the action when the mode changes', async () => {
  let finish!: () => void
  const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const props = { value: undefined, save, t: makeTranslate(zh, commonZh) }
  const mounted = render(<ProjectUnseal {...props} />)
  const button = screen.getByRole<HTMLButtonElement>('button', { name: zh.unsealEnable })
  fireEvent.click(button)
  expect(button.disabled).toBe(true)
  expect(button.textContent).toBe(zh.unsealSaving)
  fireEvent.click(button)
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  button.focus()
  mounted.rerender(<ProjectUnseal {...props} value={true} />)
  expect(screen.getByRole('button', { name: zh.unsealDisable })).toBe(button)
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  expect(save).toHaveBeenLastCalledWith(false)
  await act(async () => { finish() })
})

it('keeps mode help out of the card and disables changes for a read-only task', () => {
  render(<ProjectUnseal value={true} disabled save={vi.fn()} t={makeTranslate(zh, commonZh)} />)
  expect(screen.queryByText(zh.unsealHelp)).toBeNull()
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.unsealDisable }).disabled).toBe(true)
})
