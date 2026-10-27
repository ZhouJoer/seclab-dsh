// @vitest-environment jsdom
/** First-send settings remain compact and distinguish expired declarations from permission. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { FirstMessageSetup } from '../src/client/FirstMessageSetup.tsx'
import { workbenchConfiguration } from './configuration-fixture.client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof FirstMessageSetup>
function props(preset = 'security'): Props {
  const id = SessionId('first-message')
  const sessions: SessionListState = { ids: [id], byId: { [id]: { id, displayTitle: '', running: false,
    retainedBy: {}, blank: true, updatedAt: 0, projectionValues: { agentPreset: preset } } }, phase: 'ready', projectionsBySession: {} }
  const configuration = workbenchConfiguration()
  const useResource = () => ({ status: 'live' as const, value: configuration, failure: undefined })
  return { t: makeTranslate(en, common), sessionId: id, useSessions: select => select(sessions),
    useDirectory: select => select({ projects: [], failed: false }), usePreparation: select => select({}),
    useResource: useResource as Props['useResource'], saveSetup: vi.fn(async () => {}), saveDefaults: vi.fn(async () => {}),
    refreshSetup: vi.fn(), editSetup: vi.fn(), editTools: vi.fn(), toolsReady: vi.fn(),
    toolPreferenceOptions: vi.fn(async () => ({ tools: [], collections: [] })),
    toolPreferences: vi.fn(async () => ({ toolIds: [], tags: [], collectionIds: [] })) }
}

it('uses one expandable summary, marks edits and saves before starting', async () => {
  const api = props()
  const view = render(<FirstMessageSetup {...api} />)
  expect(view.container.querySelector('details')?.open).toBe(false)
  expect(screen.getByText(en.startupWorkspaceDefaults)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.startupSaveTask })).toBeNull()
  expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull()
  fireEvent.click(screen.getByText(en.startupConfigure))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  expect(api.editSetup).toHaveBeenCalledWith(api.sessionId)
  fireEvent.change(screen.getByRole('combobox', { name: en.unsealTitle }), { target: { value: 'unsealed' } })
  fireEvent.click(screen.getByRole('button', { name: en.startupSaveTask }))
  await waitFor(() => { expect(api.saveSetup).toHaveBeenCalledWith(api.sessionId, JSON.stringify({
    expectedRevision: 0, settings: { environmentIds: [], maxAttempts: 3, taskContext: null, unsealed: true,
      moduleSelection: { mode: 'auto', modules: [], reason: '' } },
  })) })
  expect(api.saveDefaults).not.toHaveBeenCalled()
  expect(view.asFragment()).toMatchSnapshot()
})

it('hides security setup in ordinary mode and displays an expired declaration without renewing it', () => {
  const api = props('standard')
  const view = render(<FirstMessageSetup {...api} />)
  expect(screen.getByText(en.startupOrdinary)).toBeTruthy()
  const security = props()
  const value = workbenchConfiguration({ workspace: { cwd: '/workspace', revision: 1, configured: true,
    environmentIds: ['local'], maxAttempts: 3, taskContext: { authorization: {
      basis: 'Owned fixture', scope: 'Local files', allowedActions: 'Read', restrictions: 'No network', expiresAt: 1,
    } } } })
  const useResource = () => ({ status: 'live' as const, value, failure: undefined })
  view.rerender(<FirstMessageSetup {...security} useResource={useResource as Props['useResource']} />)
  expect(screen.getByText(en.startupAuthorizationExpired)).toBeTruthy()
  expect(security.saveSetup).not.toHaveBeenCalled()
})

it('cancels edits without saving or changing the selected mode', () => {
  const api = props()
  render(<FirstMessageSetup {...api} />)
  fireEvent.click(screen.getByText(en.startupConfigure))
  fireEvent.change(screen.getByRole('combobox', { name: en.unsealTitle }), { target: { value: 'unsealed' } })
  fireEvent.keyDown(screen.getByRole('combobox', { name: en.unsealTitle }), { key: 'Escape' })
  expect(api.refreshSetup).toHaveBeenCalledWith(api.sessionId)
  expect(api.saveSetup).not.toHaveBeenCalled()
  expect(screen.getByText(en.startupSelected)).toBeTruthy()
})

it('keeps cleared task authorization separate from workspace defaults in the editor', () => {
  const api = props()
  const value = workbenchConfiguration({ workspace: { cwd: '/workspace', revision: 1, configured: true,
    environmentIds: ['local'], maxAttempts: 3, taskContext: { background: 'Workspace background' } },
  startup: { revision: 1, settings: { environmentIds: ['local'], maxAttempts: 3, unsealed: false } } })
  const useResource = () => ({ status: 'live' as const, value, failure: undefined })
  render(<FirstMessageSetup {...api} useResource={useResource as Props['useResource']} />)
  fireEvent.click(screen.getByText(en.startupConfigure))
  expect(screen.queryByDisplayValue('Workspace background')).toBeNull()
  expect(screen.getByText(en.startupTaskSettings)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.startupSaveTask })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.startupCancelSaved }))
  expect(api.saveSetup).toHaveBeenCalledWith(api.sessionId, JSON.stringify({ expectedRevision: 1, settings: null }))
})
