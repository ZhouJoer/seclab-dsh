// @vitest-environment jsdom
/** Optional declarations, non-destructive templates and local-only previews. @module */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { renderTaskContext, type TaskContext } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { TaskContextFields, taskContextIssue } from '../src/client/TaskContextFields.tsx'
import { AnalysisStart } from '../src/client/AnalysisStart.tsx'
import { WorkspaceResources } from '../src/client/WorkspaceResources.tsx'
import { ProjectTaskContext } from '../src/client/ProjectTaskContext.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
afterEach(cleanup)
function Fields() {
  const [value, setValue] = useState<TaskContext | null>(null)
  return <TaskContextFields t={t} value={value} onChange={setValue} maxBytes={4096} disabled={false} />
}
function expand(text: string) { const details = screen.getByText(text).closest('details'); if (details) details.open = true }

it('starts without authorization and previews background without claiming permission', () => {
  render(<Fields />)
  expect(screen.getByLabelText<HTMLInputElement>(zh.taskContextEnable).checked).toBe(false)
  fireEvent.change(screen.getByLabelText(zh.taskContextBackground), { target: { value: '  Background only  ' } })
  expect(document.querySelector('pre')?.textContent).toBe(renderTaskContext({ background: 'Background only' }, 0))
  expect(screen.queryByRole('alert')).toBeNull()
})
it('fills only empty fields and allows clearing authorization while retaining background', () => {
  render(<Fields />)
  fireEvent.change(screen.getByLabelText(zh.taskContextBackground), { target: { value: 'Retain this background' } })
  fireEvent.click(screen.getByRole('button', { name: zh.taskContextOwn }))
  fireEvent.change(screen.getByLabelText(zh.taskContextScope), { target: { value: 'Owned repository' } })
  fireEvent.change(screen.getByLabelText(zh.taskContextRestrictions), { target: { value: 'My stricter restriction' } })
  fireEvent.click(screen.getByRole('button', { name: zh.taskContextLab }))
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextBasis).value).toBe(zh.taskContextOwnBasis)
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextRestrictions).value).toBe('My stricter restriction')
  fireEvent.click(screen.getByLabelText(zh.taskContextEnable))
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextBackground).value).toBe('Retain this background')
  expect(screen.queryByLabelText(zh.taskContextScope)).toBeNull()
})
it('keeps commissioned permissions empty and rejects only enabled incomplete declarations', () => {
  render(<Fields />)
  fireEvent.click(screen.getByRole('button', { name: zh.taskContextCommissioned }))
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextAllowed).value).toBe('')
  expect(screen.getByRole('alert').textContent).toBe(zh.taskContextIncomplete)
  fireEvent.click(screen.getByLabelText(zh.taskContextEnable))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(taskContextIssue(null, 4096)).toBeUndefined()
  expect(taskContextIssue({ background: '中'.repeat(4096) }, 4096)).toBe('taskContextTooLong')
  expect(taskContextIssue({ authorization: { basis: 'Owner', scope: 'Code', allowedActions: 'Read', restrictions: 'No execution', expiresAt: NaN } }, 4096)).toBe('taskContextInvalid')
})
it('copies workspace defaults into a task without pasting them into the objective or saving defaults', async () => {
  const prepare = vi.fn(async () => {}), send = vi.fn(async () => {})
  render(<AnalysisStart t={t} disabled={false} taskContextMaxBytes={4096} defaultTaskContext={{ background: 'Default background' }}
    environments={[{ id: 'local', kind: 'local', label: 'Local' }]} limits={undefined}
    prepare={prepare} send={send} continueInChat={() => {}} started={() => {}} />)
  expand(zh.taskContextTitle)
  expect(screen.getByLabelText<HTMLInputElement>(zh.taskContextUseDefaults).checked).toBe(true)
  fireEvent.change(screen.getByLabelText(zh.taskContextBackground), { target: { value: 'This task only' } })
  expect(screen.getByLabelText<HTMLInputElement>(zh.taskContextUseDefaults).checked).toBe(false)
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: 'Inspect code' } })
  fireEvent.click(screen.getByRole('button', { name: zh.startAnalysis }))
  await waitFor(() => { expect(send).toHaveBeenCalledWith('Inspect code') })
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ taskContext: { background: 'This task only' }, objective: 'Inspect code' }))
})
it('saves workspace defaults only after an explicit click and retains the draft', async () => {
  const save = vi.fn(async () => {})
  render(<WorkspaceResources t={t} workspace={{ cwd: '/workspace', revision: 3, configured: true, environmentIds: ['local'], maxAttempts: 3 }}
    environments={[{ id: 'local', kind: 'local', label: 'Local', tools: [] }]} taskContextMaxBytes={4096} disabled={false} save={save} />)
  expand(zh.taskContextDefaults)
  fireEvent.change(screen.getByLabelText(zh.taskContextBackground), { target: { value: 'Saved default' } })
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.saveWorkspaceResources }))
  await waitFor(() => { expect(save).toHaveBeenCalledWith({ expectedRevision: 3, environmentIds: ['local'], maxAttempts: 3, taskContext: { background: 'Saved default' } }) })
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextBackground).value).toBe('Saved default')
})
it('submits a task-only clear and retains input when the owner reports a failed save', async () => {
  const manage = vi.fn(async () => false)
  render(<ProjectTaskContext t={t} disabled={false} value={{ background: 'Existing' }} maxBytes={4096} save={manage} />)
  expand(zh.taskContextTitle)
  fireEvent.change(screen.getByLabelText(zh.taskContextBackground), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: zh.taskContextSave }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith({ background: '' }) })
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextBackground).value).toBe('')
})
it('starts folded with saved status and retains drafts across folding and unrelated renders', () => {
  const save = vi.fn(async () => true)
  const props = { t, disabled: false, value: { background: 'Saved' }, maxBytes: 4096, save }
  const mounted = render(<ProjectTaskContext {...props} />)
  const details = screen.getByText(zh.taskContextTitle).closest('details')!
  expect(details.open).toBe(false)
  expect(details.querySelector('summary')?.textContent).toContain(zh.taskContextNotDeclared)
  expect(details.querySelector('summary')?.textContent).toContain(zh.taskContextBackgroundSet)
  details.open = true
  fireEvent.change(screen.getByLabelText(zh.taskContextBackground), { target: { value: 'Unsaved' } })
  details.open = false
  mounted.rerender(<ProjectTaskContext {...props} disabled />)
  expect(details.open).toBe(false)
  details.open = true
  expect(screen.getByLabelText<HTMLTextAreaElement>(zh.taskContextBackground).value).toBe('Unsaved')
  expect(save).not.toHaveBeenCalled()
})
