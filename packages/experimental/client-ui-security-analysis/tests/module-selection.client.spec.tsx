// @vitest-environment jsdom
/** Operator module selection remains editable after save failures. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ProjectModules } from '../src/client/ModuleSelection.tsx'
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
