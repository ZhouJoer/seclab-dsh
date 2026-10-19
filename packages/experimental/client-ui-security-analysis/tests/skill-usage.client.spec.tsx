// @vitest-environment jsdom
/** Committed reads remain visible after a failed refresh and task changes discard stale responses. @module */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { SkillUsage } from '../src/client/SkillUsage.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
it('loads on expansion, combines used skills and preserves data when refresh fails', async () => {
  const read = vi.fn().mockResolvedValue({ items: [{ name: 'security-native', sessionId: 'child', contentSha256: 'abc',
    available: true, modelReads: 2, explicitReads: 1, failedReads: 0, sequences: [3, 9] },
  { name: 'security-native', sessionId: 'parent', contentSha256: 'def',
    available: true, modelReads: 1, explicitReads: 0, failedReads: 0, sequences: [4] },
  { name: 'unused-skill', sessionId: 'parent', contentSha256: null,
    available: true, modelReads: 0, explicitReads: 0, failedReads: 0, sequences: [] },
  { name: 'failed-skill', sessionId: 'parent', contentSha256: null,
    available: false, modelReads: 0, explicitReads: 0, failedReads: 1, sequences: [5] }], unavailableSessions: [], unattributedReads: 0 })
  render(<SkillUsage project="task" skillUsage={read} t={makeTranslate(en, common)} />)
  expect(read).not.toHaveBeenCalled()
  const summary = screen.getByText('Skill usage')
  const details = summary.parentElement as HTMLDetailsElement
  details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByText('security-native')
  expect(screen.getAllByText('security-native')).toHaveLength(1)
  expect(screen.getByText('Reads 4')).toBeTruthy()
  expect(screen.getByText('Failed 1')).toBeTruthy()
  expect(screen.queryByText('unused-skill')).toBeNull()
  expect(screen.queryByText('Failed 0')).toBeNull()
  read.mockRejectedValueOnce(new Error('disconnected'))
  fireEvent.click(screen.getByRole('button'))
  await screen.findByRole('alert')
  expect(screen.getByText('security-native')).toBeTruthy()
})
it('shows an empty state when only catalog entries exist', async () => {
  const read = vi.fn().mockResolvedValue({ items: [{ name: 'unused-skill', sessionId: 'parent', contentSha256: null,
    available: true, modelReads: 0, explicitReads: 0, failedReads: 0, sequences: [] }], unavailableSessions: [], unattributedReads: 0 })
  render(<SkillUsage project="task" skillUsage={read} t={makeTranslate(en, common)} />)
  const details = screen.getByText('Skill usage').parentElement as HTMLDetailsElement
  details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByText('No usage yet')
  expect(screen.queryByText('unused-skill')).toBeNull()
})
it('discards an in-flight result after switching tasks', async () => {
  let finish: ((value: { items: []; unavailableSessions: []; unattributedReads: number }) => void) | undefined
  const old = new Promise<{ items: []; unavailableSessions: []; unattributedReads: number }>((resolve) => { finish = resolve })
  const read = vi.fn().mockImplementation((project: string) => project === 'old' ? old
    : Promise.resolve({ items: [], unavailableSessions: [], unattributedReads: 0 }))
  const view = render(<SkillUsage key="old" project="old" skillUsage={read} t={makeTranslate(en, common)} />)
  const details = screen.getByText('Skill usage').parentElement as HTMLDetailsElement
  details.open = true; fireEvent(details, new Event('toggle'))
  await vi.waitFor(() => { expect(read).toHaveBeenCalledWith('old') })
  view.rerender(<SkillUsage key="new" project="new" skillUsage={read} t={makeTranslate(en, common)} />)
  finish?.({ items: [], unavailableSessions: [], unattributedReads: 9 })
  expect(screen.queryByRole('status')).toBeNull()
  expect(read).not.toHaveBeenCalledWith('new')
})
