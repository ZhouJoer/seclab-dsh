/** First-message retries preserve a single preparation and localized recovery state. @module */
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { FirstMessagePreparation } from '../src/client/first-message.ts'

it('shares an in-flight preparation and drains it before Remote teardown', async () => {
  const request = Promise.withResolvers<RemoteResult<void>>()
  const prepare = vi.fn(() => request.promise)
  const state = new FirstMessagePreparation(prepare, () => 'Retry setup')
  const id = SessionId('first')
  const first = state.run(id)
  expect(state.run(id)).toBe(first)
  expect(state.state.getSnapshot()[id]?.busy).toBe(true)
  let closed = false
  const closing = state.close().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  request.resolve({ ok: true, value: undefined })
  await Promise.all([first, closing])
  expect(prepare).toHaveBeenCalledOnce()
  expect(state.state.getSnapshot()[id]?.busy).toBe(false)
})

it('refreshes missing setup after failure and allows a successful retry', async () => {
  const prepare = vi.fn<ConstructorParameters<typeof FirstMessagePreparation>[0]>()
    .mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/bad-request', 'Host diagnostic', {}) })
    .mockResolvedValue({ ok: true, value: undefined })
  const state = new FirstMessagePreparation(prepare, () => 'Complete setup')
  const id = SessionId('retry')
  await expect(state.run(id)).rejects.toThrow('Complete setup')
  expect(state.state.getSnapshot()[id]).toEqual({ busy: false, revision: 1, error: 'Complete setup' })
  state.refresh(id)
  await state.run(id)
  expect(state.state.getSnapshot()[id]).toEqual({ busy: false, revision: 2 })
  await state.close()
})

it('removes the native security hint on mode changes without republishing identical hints', () => {
  const state = new FirstMessagePreparation(async () => ({ ok: true, value: undefined }), () => '')
  const id = SessionId('draft')
  state.present([id], 'Describe the files')
  const first = state.presentations.getSnapshot()
  state.present([id], 'Describe the files')
  expect(state.presentations.getSnapshot()).toBe(first)
  state.present([], 'Describe the files')
  expect(state.presentations.getSnapshot().size).toBe(0)
})

it('requires saving edited configuration before preparation and localizes transport failures', async () => {
  const prepare = vi.fn(async () => { throw new Error('Internal transport diagnostic') })
  const state = new FirstMessagePreparation(prepare, code => code === 'unsaved' ? 'Save first' : 'Retry preparation')
  const id = SessionId('edited')
  state.edited(id)
  await expect(state.run(id)).rejects.toThrow('Save first')
  expect(prepare).not.toHaveBeenCalled()
  state.refresh(id)
  await expect(state.run(id)).rejects.toThrow('Retry preparation')
  expect(state.state.getSnapshot()[id]?.error).toBe('Retry preparation')
})

it('blocks dirty or pending tool choices and releases them when leaving security mode', async () => {
  const prepare = vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined }))
  const state = new FirstMessagePreparation(prepare, code => code)
  const id = SessionId('tools')
  state.tools(id, { toolsDirty: true })
  state.refresh(id)
  await expect(state.run(id)).rejects.toThrow('unsaved')
  state.tools(id, { toolsDirty: false, toolsBusy: true })
  await expect(state.run(id)).rejects.toThrow('tools-busy')
  expect(prepare).not.toHaveBeenCalled()
  state.reset(id)
  await state.run(id)
  expect(prepare).toHaveBeenCalledOnce()
})
