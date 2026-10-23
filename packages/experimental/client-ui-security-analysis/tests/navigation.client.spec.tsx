// @vitest-environment jsdom
/** Native chat creation and task association remain independent of model submission. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { AnalysisCreation } from '../src/client/AnalysisCreation.tsx'
import { SecurityDirectory } from '../src/client/directory.ts'
import { SecuritySessionBadge, SecurityConversationNavigation } from '../src/client/SecurityNavigation.tsx'
import { engagementSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { workbenchConfiguration } from './configuration-fixture.client.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, common)
afterEach(cleanup)
const id = 'main' as SessionId
const workspaceId = 'workspace' as WorkspaceId
const project = engagementSchema.parse({ id: 'task', title: 'Inspect sample', objective: '', mainSessionId: id,
  environmentIds: ['local'], maxAttempts: 3, stopped: false })
const summary = { project, sessions: [{ sessionId: id, role: 'coordinator', active: true }], state: 'idle' as const,
  runningAgentCount: 0, runningInvocationCount: 0, pendingPlanIds: [], interruptedCheckIds: [], blockedCheckIds: [], next: '' }

it('reuses workspace settings and enters an empty native chat with no objective form', async () => {
  const startAnalysis = vi.fn(async (_workspace: WorkspaceId, _input: string) => ({ sessionId: id, projectId: 'task' }))
  const openChat = vi.fn()
  render(<AnalysisCreation t={t} workspaceId={workspaceId} configurationForWorkspace={async () => workbenchConfiguration()}
    configureAnalysisWorkspace={vi.fn()} startAnalysis={startAnalysis} openChat={openChat} />)
  await waitFor(() => { expect(openChat).toHaveBeenCalledWith(id) })
  expect(startAnalysis).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(JSON.parse(startAnalysis.mock.calls[0]![1])).not.toHaveProperty('objective')
})

it('retries an uncertain creation with the same request identities', async () => {
  const startAnalysis = vi.fn<(workspace: WorkspaceId, input: string) => Promise<{ sessionId: SessionId; projectId: string }>>()
    .mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue({ sessionId: id, projectId: 'task' })
  const openChat = vi.fn()
  render(<AnalysisCreation t={t} workspaceId={workspaceId} configurationForWorkspace={async () => workbenchConfiguration()}
    configureAnalysisWorkspace={vi.fn()} startAnalysis={startAnalysis} openChat={openChat} />)
  fireEvent.click(await screen.findByRole('button', { name: en.dashboardRetry }))
  await waitFor(() => { expect(openChat).toHaveBeenCalledWith(id) })
  expect(startAnalysis.mock.calls[0]).toEqual(startAnalysis.mock.calls[1])
})

it('shares names and reserved identities without replacing historical conversation names', async () => {
  const rename = vi.fn(async () => {})
  let stopped = false
  const directory = new SecurityDirectory(async function* (signal) {
    yield [{ ...summary, sessions: [...summary.sessions, { sessionId: 'history', role: 'coordinator', active: false }] },
      { ...summary, project: engagementSchema.parse({ ...project, id: 'earlier', mainSessionId: undefined }),
        sessions: [{ sessionId: id, role: 'coordinator', active: false }] }]
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    stopped = true
  }, rename)
  directory.start()
  try {
    await waitFor(() => { expect(directory.presentations.getSnapshot().get(id)?.title).toBe(project.title) })
    expect(directory.presentations.getSnapshot().get('history' as SessionId)).toEqual({ reserved: true })
    await directory.presentations.getSnapshot().get(id)?.rename?.('Renamed')
    expect(rename).toHaveBeenCalledWith('task', 'Renamed')
  } finally { await directory.close() }
  expect(stopped).toBe(true)
})

it('opens the exact associated task from a blank chat and its sidebar badge', () => {
  const openWorkbench = vi.fn()
  const props = { t, sessionId: id, openWorkbench,
    useDirectory: <T,>(select: (state: { projects: typeof summary[]; failed: boolean }) => T) =>
      select({ projects: [{ ...summary, project: engagementSchema.parse({ ...project, id: 'earlier', title: 'Earlier task' }),
        sessions: [{ sessionId: id, role: 'coordinator', active: false }] }, summary], failed: false }) }
  render(<><SecuritySessionBadge {...props} /><SecurityConversationNavigation {...props} /></>)
  fireEvent.click(screen.getByRole('button', { name: en.dashboardEntry + ' · ' + project.title }))
  fireEvent.click(screen.getByRole('button', { name: en.dashboardEntry }))
  expect(openWorkbench.mock.calls).toEqual([['task', id], ['task', id]])
  expect(screen.getByRole('navigation').textContent).toBe(project.title + en.analysisChat + en.dashboardEntry)
})
