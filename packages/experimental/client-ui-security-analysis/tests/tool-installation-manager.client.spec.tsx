// @vitest-environment jsdom
/** Installation reviews require explicit confirmation and preserve drafts across reconnects. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolInstallationPlan, ToolInstallationOperation } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { ToolInstallationManager, type ToolInstallationActions } from '../src/client/ToolInstallationManager.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const plan: ToolInstallationPlan = { id: brandString<ToolInstallationPlan['id']>('plan'), digest: 'digest', createdAt: 1, toolRoot: '/tools', rootRevision: 1,
    configurationRevision: 'config', environment: { id: 'host', kind: 'local', label: 'Host', cwd: '/work', tools: [] },
    request: { recipeId: 'python-runtime', environmentId: 'host', action: 'install', options: {} }, recipeId: 'python-runtime', recipeVersion: '1', toolIds: ['python'], mode: 'private',
    version: '1', destination: '/tools/python/1', steps: [{ id: 'install', kind: 'process', description: 'Install selected Python', command: '/tools/python-installer', args: ['/quiet'] }],
    confirmations: [{ id: 'system-component', description: 'Approve required system runtime' }], warnings: [], data: {} }
  const operation: ToolInstallationOperation = { id: brandString<ToolInstallationOperation['id']>('operation'), requestId: brandString<ToolInstallationOperation['requestId']>('request'),
    planId: plan.id, planDigest: plan.digest, environmentId: 'host', recipeId: 'python-runtime', toolRoot: '/tools', phase: 'completed',
    createdAt: 1, updatedAt: 1, cursor: 1, logs: [], logsTruncated: false }
  let reset = () => {}
  const apply = vi.fn(async () => operation), preview = vi.fn(async () => plan)
  const actions: ToolInstallationActions = {
    root: vi.fn(async () => ({ toolRoot: '/tools', revision: 1, writable: true, detail: '' })),
    setRoot: vi.fn(async (path: string) => ({ toolRoot: path, revision: 2, writable: true, detail: '' })),
    recipes: async () => [{ id: 'python-runtime', toolIds: ['python'], environments: ['local'], platform: 'win32-x64', version: '1' }],
    preview, apply, get: async () => operation, list: vi.fn(async () => ({ operations: [], installations: [] })),
    follow: async function* () {}, cancel: async () => operation, reconcile: async () => operation,
    previewRemoval: async () => plan, pickInstallationDirectory: async () => ({ path: null, browse: true }),
    listInstallationDirectory: async () => ({ path: '/selected', entries: [] }),
    subscribeReset: (listener) => { reset = listener; return () => { reset = () => {} } },
  }
  const onChanged = vi.fn(), t = makeTranslate(zh, commonZh)
  const props = { actions, environmentId: 'host', environments: [{ id: 'host', kind: 'local' as const, label: 'Host' }], onChanged, t }
  return { props, actions, apply, preview, plan, operation, reset: () =>{  reset() } }
}

it('requires plan consent and every exception before applying the displayed digest', async () => {
  const fixtureValue = fixture(); render(<ToolInstallationManager {...fixtureValue.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.installationManage }))
  await screen.findByDisplayValue('/tools')
  fireEvent.click(screen.getByRole('button', { name: zh.installationPreview }))
  await screen.findByText('/tools/python/1')
  expect(screen.getByRole('region', { name: zh.installationReview }).textContent).toMatchSnapshot()
  const button = screen.getByRole('button', { name: zh.installationConfirm })
  expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByLabelText(zh.installationConsent)); expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByLabelText('Approve required system runtime')); expect(button.hasAttribute('disabled')).toBe(false)
  fireEvent.click(button)
  await waitFor(() =>{  expect(fixtureValue.apply).toHaveBeenCalledWith(fixtureValue.plan.id, 'digest', expect.any(String), ['system-component']) })
  expect(fixtureValue.preview).toHaveBeenCalledTimes(1)
})

it('uses directory browsing as a draft and preserves it after connection reset', async () => {
  const fixtureValue = fixture(); render(<ToolInstallationManager {...fixtureValue.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.installationManage })); await screen.findByDisplayValue('/tools')
  fireEvent.click(screen.getByRole('button', { name: zh.installationChooseDirectory }))
  await screen.findByText('/selected'); fireEvent.click(screen.getByRole('button', { name: zh.installationChooseCurrent }))
  expect(screen.getByLabelText(zh.installationRoot).getAttribute('value')).toBe('/selected')
  expect(fixtureValue.actions.setRoot).not.toHaveBeenCalled()
  act(() => { fixtureValue.reset() })
  await waitFor(() =>{  expect(fixtureValue.actions.root).toHaveBeenCalledTimes(2) })
  expect(screen.getByLabelText(zh.installationRoot).getAttribute('value')).toBe('/selected')
  fireEvent.click(screen.getByRole('button', { name: zh.installationSaveRoot }))
  await waitFor(() =>{  expect(fixtureValue.actions.setRoot).toHaveBeenCalledWith('/selected', 1) })
})

it('drops a preview that arrives after the operator changes environment', async () => {
  const fixtureValue = fixture(), pending = Promise.withResolvers<ToolInstallationPlan>()
  fixtureValue.preview.mockImplementation(() => pending.promise)
  const view = render(<ToolInstallationManager {...fixtureValue.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.installationManage })); await screen.findByDisplayValue('/tools')
  fireEvent.click(screen.getByRole('button', { name: zh.installationPreview }))
  view.rerender(<ToolInstallationManager {...fixtureValue.props} environmentId="other" />)
  await act(async () => { pending.resolve(fixtureValue.plan); await pending.promise })
  expect(screen.queryByText('/tools/python/1')).toBeNull()
  expect(fixtureValue.apply).not.toHaveBeenCalled()
})
