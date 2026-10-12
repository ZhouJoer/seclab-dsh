// @vitest-environment jsdom
/** The mining card stays collapsed and states its manual-only workflow. @module */
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { MiningPanel } from '../src/client/MiningPanel.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('renders collapsed by default and reveals only manual benchmark instructions', () => {
  render(<MiningPanel t={makeTranslate(zh, commonZh)} />)
  const card = screen.getByText('CVE 挖掘基准（实验）').closest('details')!
  expect(card.open).toBe(false)
  fireEvent.click(screen.getByText('CVE 挖掘基准（实验）'))
  expect(card.open).toBe(true)
  expect(screen.getByText(/对话不会自动启动 CVE 挖掘/)).toBeDefined()
  expect(screen.getByText(/pnpm security:cve-bench prepare/)).toBeDefined()
})
