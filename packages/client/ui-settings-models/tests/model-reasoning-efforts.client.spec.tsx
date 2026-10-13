// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelReasoningEfforts } from '../src/client/ModelReasoningEfforts.tsx'
import { en } from '../src/client/locales.ts'
import { validateDeepSeekModels } from '../src/client/DeepSeekModelsEditor.tsx'
afterEach(cleanup)

it('rejects empty or unusable effort mappings before saving a model', () => {
  for (const reasoningEfforts of [{}, { off: null }, { high: '' }, { high: null }, { invalid: 'high' }]) {
    expect(validateDeepSeekModels([{ id: 'expert', reasoningEfforts }])).toEqual({ index: 0, key: 'reasoningMappingInvalid' })
  }
  for (const reasoningEfforts of [undefined, false, { off: null, high: 'deep' }]) {
    expect(validateDeepSeekModels([{ id: 'expert', reasoningEfforts }])).toBeUndefined()
  }
})

it('chooses high by default and preserves explicit API parameter mappings', () => {
  const onChange = vi.fn()
  const view = render(<ModelReasoningEfforts model={{ id: 'expert' }} disabled={false} t={key => en[key]} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } })
  expect(onChange).toHaveBeenLastCalledWith({ id: 'expert', reasoningEfforts: { high: 'high' } })
  view.rerender(<ModelReasoningEfforts model={{ id: 'expert', reasoningEfforts: { high: 'high' } }} disabled={false} t={key => en[key]} onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox', { name: `${en.reasoningWireValue} high` }), { target: { value: 'deep' } })
  expect(onChange).toHaveBeenLastCalledWith({ id: 'expert', reasoningEfforts: { high: 'deep' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inherit' } })
  expect(onChange).toHaveBeenLastCalledWith({ id: 'expert' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'none' } })
  expect(onChange).toHaveBeenLastCalledWith({ id: 'expert', reasoningEfforts: false })
})
