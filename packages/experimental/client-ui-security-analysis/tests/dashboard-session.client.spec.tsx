// @vitest-environment jsdom
/** Environment preparation preserves user choices and never sends a model message. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AnalysisCreation } from '../src/client/AnalysisCreation.tsx'
import { en } from '../src/client/locales.ts'
import { workbenchConfiguration } from './configuration-fixture.client.ts'
const t = makeTranslate(en, common)
const workspaceId = 'workspace' as WorkspaceId
const sessionId = 'session' as SessionId
afterEach(cleanup)

it('keeps environment selections after a failed save and creates only after settings are saved', async () => {
  const initial = workbenchConfiguration({ workspace: { cwd: '/workspace', revision: 0, configured: false, environmentIds: [] } })
  const configure = vi.fn().mockRejectedValueOnce(new Error('Settings conflict')).mockResolvedValue(workbenchConfiguration())
  const start = vi.fn(async () => ({ sessionId, projectId: 'task' }))
  const open = vi.fn()
  render(<AnalysisCreation t={t} workspaceId={workspaceId} configurationForWorkspace={async () => initial}
    configureAnalysisWorkspace={configure} startAnalysis={start} openChat={open} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Lab' }))
  fireEvent.change(screen.getByLabelText(en.attemptLimit), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: en.newAnalysis }))
  await screen.findByText('Settings conflict', { exact: false })
  expect(start).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Lab' }).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.newAnalysis }))
  await waitFor(() => { expect(open).toHaveBeenCalledWith(sessionId) })
  expect(configure.mock.calls[0]).toEqual(configure.mock.calls[1])
})

it('does not navigate after leaving while a creation response is pending', async () => {
  const pending = Promise.withResolvers<{ sessionId: SessionId; projectId: string }>()
  const start = vi.fn(() => pending.promise)
  const open = vi.fn()
  const mounted = render(<AnalysisCreation t={t} workspaceId={workspaceId}
    configurationForWorkspace={async () => workbenchConfiguration()}
    configureAnalysisWorkspace={vi.fn()} startAnalysis={start} openChat={open} />)
  await waitFor(() => { expect(start).toHaveBeenCalledTimes(1) })
  mounted.unmount()
  await act(async () => { pending.resolve({ sessionId, projectId: 'task' }); await pending.promise })
  expect(open).not.toHaveBeenCalled()
})
