// @vitest-environment jsdom
/** The mining start form drafts the objective from mode and target and submits through the shared actions. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { MiningStart } from '../src/client/MiningStart.tsx'
import { zh } from '../src/client/locales.ts'

const environments = [{ id: 'mining', label: 'Mining sanitizer builds', kind: 'docker' }, { id: 'local', label: 'Local', kind: 'local' }]
const actions = () => ({
  prepare: vi.fn(async () => {}), send: vi.fn(async () => {}), continueInChat: vi.fn(), started: vi.fn(),
})

function mount(overrides: Partial<Parameters<typeof MiningStart>[0]> = {}) {
  const acts = actions()
  render(<MiningStart t={makeTranslate(zh, commonZh)} disabled={false}
    environments={overrides.environments ?? environments} limits={{ bytes: 1000, entries: 10 }}
    taskContextMaxBytes={4096} {...acts} {...overrides} />)
  return acts
}

afterEach(cleanup)

it('renders collapsed, reveals the mining modes and drafts the objective from the target', () => {
  mount()
  const card = screen.getByText('挖掘任务（实验）').closest('details')!
  expect(card.open).toBe(false)
  fireEvent.click(screen.getByText('挖掘任务（实验）'))
  expect(card.open).toBe(true)
  expect(screen.getByText('补丁引导（提供修复补丁作为唯一线索）')).toBeDefined()
  expect(screen.getByText('版本差分（提供两个版本，自行定位改动）')).toBeDefined()
  fireEvent.change(screen.getByLabelText('源码路径（Host 绝对路径）'), { target: { value: '/bench/case/vulnerable' } })
  const objective = screen.getByLabelText('任务文稿（自动生成，可编辑）') as HTMLTextAreaElement
  expect(objective.value).toContain('/bench/case/vulnerable')
  expect(objective.value).toContain('独立 buildTag')
})

it('switches the lead line with the mode and keeps start disabled without a target', () => {
  mount()
  fireEvent.click(screen.getByText('挖掘任务（实验）'))
  const objective = () => screen.getByLabelText('任务文稿（自动生成，可编辑）') as HTMLTextAreaElement
  fireEvent.change(screen.getByLabelText('源码路径（Host 绝对路径）'), { target: { value: '/v' } })
  fireEvent.change(screen.getByLabelText('补丁文件路径'), { target: { value: '/p.diff' } })
  expect(objective().value).toContain('/p.diff')
  fireEvent.click(screen.getByText('版本差分（提供两个版本，自行定位改动）'))
  expect(objective().value).not.toContain('/p.diff')
  fireEvent.change(screen.getByLabelText('对比版本路径'), { target: { value: '/f' } })
  expect(objective().value).toContain('/f')
  expect(objective().value).toContain('定位版本间的安全相关改动')
  fireEvent.change(screen.getByLabelText('源码路径（Host 绝对路径）'), { target: { value: '' } })
  expect(screen.getByRole('button', { name: zh.startAnalysis }).disabled).toBe(true)
})

it('prepares the task with the path material and sends the objective', async () => {
  const acts = mount()
  fireEvent.click(screen.getByText('挖掘任务（实验）'))
  fireEvent.change(screen.getByLabelText('源码路径（Host 绝对路径）'), { target: { value: 'D:/bench/case/vulnerable' } })
  fireEvent.change(screen.getByLabelText('任务文稿（自动生成，可编辑）'), { target: { value: 'objective text' } })
  const start = screen.getByRole('button', { name: zh.startAnalysis })
  expect(start.disabled).toBe(false)
  await fireEvent.click(start)
  await Promise.resolve()
  expect(acts.prepare).toHaveBeenCalledTimes(1)
  const input = acts.prepare.mock.calls[0]![0] as { material?: { kind: string; path: string }; objective: string; environmentId: string }
  expect(input.material).toMatchObject({ kind: 'path', path: 'D:/bench/case/vulnerable' })
  expect(input.objective).toBe('objective text')
  expect(input.environmentId).toBe('mining')
  expect(acts.send).toHaveBeenCalledWith('objective text')
})
