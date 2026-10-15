// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { HelperState, HelperCall } from '@deepseek-ai/dsh-helper/types'
import type {} from '../src/client/index.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HelperControl, HelperToolCard } from '../src/client/HelperUsage.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh)

it('opens configuration separately and selects normal or proactive mode', async () => {
  const state: HelperState = { enabled: false, mode: 'normal', calls: [] }
  const useProjection = (() => state) as ComponentProps<typeof HelperControl>['useProjection']
  const configure = vi.fn(), toggle = vi.fn(async () => {})
  const view = render(<HelperControl t={t} useProjection={useProjection} configure={configure} toggle={toggle} />)
  fireEvent.click(view.getByRole('button', { name: 'Advisor: 关闭 · 0' }))
  fireEvent.click(view.getByRole('menuitem', { name: '配置高级模型 / Codex' }))
  expect(configure).toHaveBeenCalledOnce()
  expect(toggle).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Advisor: 关闭 · 0' }))
  fireEvent.click(view.getByRole('menuitem', { name: '正常' }))
  await vi.waitFor(() => { expect(toggle).toHaveBeenCalledWith(true, 'normal'); expect(view.getByRole('button', { name: 'Advisor: 关闭 · 0' }).hasAttribute('disabled')).toBe(false) })
  expect(configure).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: 'Advisor: 关闭 · 0' }))
  fireEvent.click(view.getByRole('menuitem', { name: '积极' }))
  await vi.waitFor(() => { expect(toggle).toHaveBeenCalledWith(true, 'proactive'); expect(view.getByRole('button', { name: 'Advisor: 关闭 · 0' }).hasAttribute('disabled')).toBe(false) })
  state.enabled = true; state.mode = 'proactive'
  view.rerender(<HelperControl t={t} useProjection={useProjection} configure={configure} toggle={toggle} />)
  fireEvent.click(view.getByRole('button', { name: 'Advisor: 积极 · 0' }))
  expect(view.getByRole('menuitem', { name: '积极' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('menuitem', { name: '关闭' }))
  await vi.waitFor(() => { expect(toggle).toHaveBeenCalledWith(false, 'normal') })
})

it.each(['native', 'ptc'])('shows persisted advice, missing usage and child log for %s calls', (mode) => {
  const callId = 'consult' as HelperCall['callId']
  const state: HelperState = { enabled: true, mode: 'normal', calls: [{ callId, backend: 'api', model: 'expert',
    ...(mode === 'ptc' ? { rootCallId: 'run-code' as HelperCall['callId'] } : {}),
    reasoningEffort: 'high', status: 'completed', startedAt: 0, elapsedMs: 1500,
    childSessionId: SessionId('child'), usage: { inputTokens: 20, outputTokens: 10 },
  }] }
  const useProjection = (() => state) as ComponentProps<typeof HelperToolCard>['useProjection']
  const openChild = vi.fn()
  const props: ComponentProps<typeof HelperToolCard> = { t, callId, useProjection, openChild, phase: 'result',
    block: { kind: 'tool-result', seq: 10, time: 0, callTime: 0, callId, call: { name: 'helper', argsRaw: '{"reason":"uncertain"}' },
      content: [{ type: 'text', text: 'Inspect the race before retrying.' }], isError: false, subCalls: [] },
  }
  const view = render(<HelperToolCard {...props} />)
  expect(view.getByText('Inspect the race before retrying.')).toBeTruthy()
  expect(view.getByText('思考强度: high')).toBeTruthy()
  expect(view.getByText('推理 token: 未报告')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '打开只读子代理日志' }))
  expect(openChild).toHaveBeenCalledWith('child')
  view.unmount()
  const restored = render(<HelperToolCard {...props} />)
  expect(restored.getByText('输入 token: 20')).toBeTruthy()
})

it.each(['error', 'aborted', 'interrupted'] as const)('shows persisted %s without assuming success', (status) => {
  const callId = 'consult' as HelperCall['callId']
  const state: HelperState = { enabled: false, mode: 'normal',
    calls: [{ callId, backend: 'codex', model: 'expert', startedAt: 0, status }],
  }
  const useProjection = (() => state) as ComponentProps<typeof HelperToolCard>['useProjection']
  const view = render(<HelperToolCard t={t} callId={callId} useProjection={useProjection} openChild={vi.fn()} phase="result"
    block={{ kind: 'tool-result', seq: 10, time: 0, callTime: 0, callId, call: null, content: [], isError: true, subCalls: [] }} />)
  expect(view.getByText(new RegExp(zh[status]))).toBeTruthy()
  expect(view.queryByText('成功')).toBeNull()
})
