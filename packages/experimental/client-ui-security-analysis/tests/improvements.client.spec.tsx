// @vitest-environment jsdom
/** Operator progress, implementation claims and independently cancellable observation. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { evolutionProposalSchema, evolutionRunSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/evolution-model.ts'
import type { EvolutionView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Improvements, type ImprovementActions } from '../src/client/Improvements.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en, common)
const suggestion = evolutionProposalSchema.parse({ id: 'suggestion', revision: 1, status: 'open', title: 'Reusable parser',
  component: 'analysis scripts', conditions: 'Packet analysis', problem: 'Repeated parser implementation', change: 'Add a parser tool',
  acceptance: ['Two tasks reuse the tool'], uncertainty: 'Source inspection required', occurrences: [{ projectId: 'alpha', runId: 'run', version: 'fixture',
    source: { id: 'source', projectId: 'alpha', sessionId: 'session', seq: 1, kind: 'tool/call', excerpt: 'Manual parsing', truncated: false, recordedAt: 1 } }],
  receipts: [], needsReview: false, createdAt: 1, updatedAt: 1 })
function harness() {
  const view: EvolutionView = { revision: 2, proposals: [suggestion], runs: [] }
  let aborted = false
  const update = vi.fn(async (_input: string) => view)
  const api: ImprovementActions = {
    analyzeImprovements: vi.fn(async () => view), updateImprovement: update,
    exportImprovement: vi.fn(async () => ({ markdown: '# Coding task', proposal: '{}', receipt: '{}' })),
    notifyImprovement: vi.fn(), followImprovements: async function* (signal) {
      yield view
      if (!signal.aborted) await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }) })
    },
  }
  return { api, update, aborted: () => aborted }
}
it('browses evidence and submits an implementation receipt without verifying it', async () => {
  const { api, update } = harness()
  const rendered = render(<Improvements {...api} t={t} projectId="alpha" />)
  fireEvent.click(await screen.findByRole('button', { name: /Reusable parser/ }))
  expect(screen.getByText('Manual parsing')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Change summary'), { target: { value: 'Added shared parser' } })
  fireEvent.change(screen.getByLabelText('Test command'), { target: { value: 'test parser' } })
  fireEvent.change(screen.getByLabelText('Test result'), { target: { value: 'passed' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Save implementation result' }).closest('form')!)
  await waitFor(() => { expect(update).toHaveBeenCalledTimes(1) })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ expectedRevision: 2, action: { kind: 'receipt', receipt: {
    proposalId: 'suggestion', summary: 'Added shared parser', tests: [{ command: 'test parser', result: 'passed' }],
  } } })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ action: { kind: 'receipt' } })
  rendered.unmount()
})
it('filters suggestions, requires an explicit verification action and releases its stream', async () => {
  const { api, update, aborted } = harness()
  const rendered = render(<Improvements {...api} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: /Reusable parser/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm verified' }))
  await waitFor(() => { expect(update).toHaveBeenCalledTimes(1) })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ action: { kind: 'status', proposalId: 'suggestion', status: 'verified' } })
  fireEvent.change(screen.getByLabelText('Improvement status'), { target: { value: 'ignored' } })
  expect(screen.getByText('No matching improvement suggestions')).toBeTruthy()
  rendered.unmount()
  expect(aborted()).toBe(true)
})
it('requests idle-time analysis without creating a source Agent', async () => {
  const { api } = harness()
  render(<Improvements {...api} t={t} projectId="alpha" />)
  await screen.findByRole('button', { name: /Reusable parser/ })
  expect(screen.queryByText('Improve capabilities, workflows, scripts and investigation methods through a coding AI')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Find improvements now' }))
  await waitFor(() => { expect(api.analyzeImprovements).toHaveBeenCalledOnce() })
  expect(api.notifyImprovement).toHaveBeenCalledWith('Analysis queued')
})

it.each(['failed', 'queued', 'running'] as const)('shows an actionable %s state and prevents duplicate analysis', async (status) => {
  const { api } = harness()
  api.followImprovements = async function* () {
    yield { revision: 3, proposals: [suggestion], runs: [evolutionRunSchema.parse({ id: 'run', projectId: 'alpha',
      status, manual: true, createdAt: 1, updatedAt: 2, detail: status === 'failed' ? 'Invalid model JSON' : '', proposalIds: [] })] }
  }
  render(<Improvements {...api} t={t} projectId="alpha" />)
  const button = await screen.findByRole('button', { name: status === 'failed' ? en.evoRetry : en.evoAnalyze })
  await screen.findByRole('button', { name: /Reusable parser/ })
  expect(button.getAttribute('data-variant') ?? button.className).toContain('primary')
  expect((button as HTMLButtonElement).disabled).toBe(status !== 'failed')
  if (status === 'failed') {
    expect(screen.getByText('Invalid model JSON')).toBeTruthy()
    fireEvent.click(button)
    await waitFor(() => { expect(api.analyzeImprovements).toHaveBeenCalledOnce() })
  }
})


it('shows the saved update time and confirms deletion before removing a suggestion', async () => {
  const { api, update } = harness()
  update.mockResolvedValue({ revision: 3, proposals: [], runs: [] })
  render(<Improvements {...api} t={t} projectId="alpha" />)
  const title = await screen.findByRole('button', { name: /Reusable parser/ })
  const time = document.querySelector('time')!
  expect(time.dateTime).toBe(new Date(suggestion.updatedAt).toISOString())
  expect(time.textContent).toBe(new Date(suggestion.updatedAt).toLocaleString())
  expect(title.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: en.evoDelete }))
  let confirmation = screen.getByRole('group', { name: en.evoDeleteConfirm })
  expect({ label: en.evoUpdatedAt, updatedAt: time.dateTime,
    actions: within(confirmation).getAllByRole('button').map(button => button.textContent) }).toMatchInlineSnapshot(`
      {
        "actions": [
          "Cancel",
          "Confirm suggestion deletion",
        ],
        "label": "Updated",
        "updatedAt": "1970-01-01T00:00:00.001Z",
      }
    `)
  expect(update).not.toHaveBeenCalled()
  fireEvent.click(within(confirmation).getByRole('button', { name: common.cancel }))
  expect(screen.queryByRole('group', { name: en.evoDeleteConfirm })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.evoDelete }))
  fireEvent.click(screen.getByRole('button', { name: en.evoDelete }))
  confirmation = screen.getByRole('group', { name: en.evoDeleteConfirm })
  fireEvent.click(within(confirmation).getByRole('button', { name: en.evoDeleteConfirm }))
  await waitFor(() => { expect(screen.queryByRole('button', { name: /Reusable parser/ })).toBeNull() })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ expectedRevision: 2,
    action: { kind: 'delete', proposalId: suggestion.id } })
  expect(api.notifyImprovement).toHaveBeenCalledWith(en.evoDeleted)
  expect(document.activeElement).toBe(screen.getByLabelText(en.query))
})

it('retains the suggestion and confirmation when deletion fails', async () => {
  const { api, update } = harness()
  update.mockRejectedValue(new Error('Revision changed'))
  render(<Improvements {...api} t={t} projectId="alpha" />)
  fireEvent.click(await screen.findByRole('button', { name: /Reusable parser/ }))
  fireEvent.click(screen.getByRole('button', { name: en.evoDelete }))
  fireEvent.click(within(screen.getByRole('group', { name: en.evoDeleteConfirm }))
    .getByRole('button', { name: en.evoDeleteConfirm }))
  await waitFor(() => { expect(api.notifyImprovement).toHaveBeenCalledWith(en.evoActionFailed) })
  expect(screen.getByRole('button', { name: /Reusable parser/ })).toBeTruthy()
  expect(screen.getByRole('group', { name: en.evoDeleteConfirm })).toBeTruthy()
})

it('exposes actions before expanding details and returns cancellation focus to the chosen row', async () => {
  const { api, update } = harness()
  api.followImprovements = async function* () {
    yield { revision: 2, proposals: [suggestion, evolutionProposalSchema.parse({ ...suggestion, id: 'second', title: 'Second suggestion' })], runs: [] }
  }
  render(<Improvements {...api} t={t} />)
  const title = await screen.findByRole('button', { name: /Reusable parser/ })
  const row = within(title.closest('article')!)
  expect(row.getAllByRole('button').slice(1).map(button => button.textContent)).toMatchInlineSnapshot(`
    [
      "View details",
      "Copy coding task",
      "Download task bundle",
      "Mark modified",
      "Confirm verified",
      "Ignore",
      "Delete suggestion",
    ]
  `)
  expect(screen.queryByText(suggestion.conditions)).toBeNull()
  fireEvent.click(row.getByRole('button', { name: en.evoShowDetails }))
  expect(row.getByText(suggestion.conditions)).toBeTruthy()
  fireEvent.click(row.getByRole('button', { name: en.evoHideDetails }))
  fireEvent.click(row.getByRole('button', { name: en.evoDelete }))
  fireEvent.click(within(row.getByRole('group', { name: en.evoDeleteConfirm })).getByRole('button', { name: common.cancel }))
  expect(document.activeElement).toBe(row.getByRole('button', { name: en.evoDelete }))
  expect(update).not.toHaveBeenCalled()
})

it('filters source tasks through a portaled menu with keyboard and outside dismissal', async () => {
  const { api } = harness()
  const longTitle = 'Analysis workspace / '.repeat(25)
  render(<Improvements {...api} t={t} tasks={[{ id: 'alpha', title: longTitle }]} />)
  const trigger = await screen.findByRole('button', { name: en.evoSourceTask })
  expect(trigger.textContent).toBe(en.evoAllTasks)
  trigger.focus()
  fireEvent.click(trigger)
  let menu = screen.getByRole('menu')
  expect(screen.getByRole('region', { name: en.evoTitle }).contains(menu)).toBe(false)
  expect(within(menu).getByRole('menuitem', { name: longTitle.trim() })).toBeTruthy()
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  fireEvent.pointerDown(screen.getByLabelText(en.query))
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(trigger)
  menu = screen.getByRole('menu')
  fireEvent.click(within(menu).getByRole('menuitem', { name: longTitle.trim() }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger.textContent).toBe(longTitle)
  expect(screen.getByRole('button', { name: /Reusable parser/ })).toBeTruthy()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: en.evoAllTasks }))
  expect(trigger.textContent).toBe(en.evoAllTasks)
})
