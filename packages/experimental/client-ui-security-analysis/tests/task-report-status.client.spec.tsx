// @vitest-environment jsdom
/** Report publication starts only from an explicit user action. @module */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { taskCompletionSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { TaskReportStatus } from '../src/client/TaskReportStatus.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('keeps saved conclusions available until the user requests a report', () => {
  const retry = vi.fn()
  const completion = taskCompletionSchema.parse({ status: 'saved', detail: '', updatedAt: 1,
    results: [{ title: 'Result', result: 'Observed value', evidenceIds: ['observed'] }], limitations: 'Offline only' })
  render(<TaskReportStatus completion={completion} disabled={false} retry={retry} t={makeTranslate(en, common)} />)
  expect(screen.getByRole('status').textContent).toBe('Outcomes saved; generate a report when needed')
  expect(retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Generate revision report' }))
  expect(retry).toHaveBeenCalledOnce()
})
