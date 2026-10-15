import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { HelperSettings } from '@deepseek-ai/dsh-helper/types'
import { HelperController, type Account } from '../src/client/controller.ts'

const controllers: HelperController[] = []
afterEach(() => { controllers.splice(0).forEach((controller) =>{  controller.dispose() }); vi.useRealTimers() })

function setup() {
  const host = stubConfigForm<HelperSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, user: {}, value: {
    enabled: false, mode: 'normal', backend: 'codex', provider: '', model: '', reasoningEffort: 'high', codexModel: 'expert', codexReasoningEffort: 'high',
  } })
  const actions = {
    loginFailed: () => 'ChatGPT login failed.',
    api: vi.fn(async () => [{ key: 'api/expert', provider: 'api', id: 'expert', name: 'Expert', efforts: ['high', 'low'] }]),
    codex: vi.fn(async () => [{ key: 'expert', provider: 'codex', id: 'expert', name: 'Expert', efforts: ['medium'] }]),
    account: vi.fn(async (): Promise<Account> => ({ loggedIn: true })),
    login: vi.fn(async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' })),
    cancelLogin: vi.fn(async () => {}), test: vi.fn(async () => {}),
  }
  const controller = new HelperController(host.scope, actions)
  controllers.push(controller)
  return { controller, face: controller.inject(), actions, host }
}

describe('Helper preferences', () => {
  it('prefers high and requires a choice when the selected model lacks high', async () => {
    const { controller, face, actions } = setup()
    await controller.refresh()
    face.chooseModel('api', 'api/expert')
    expect(face.hooks.helperForm.getSnapshot().values).toMatchObject({ provider: 'api', model: 'expert', reasoningEffort: 'high' })
    face.chooseModel('codex', 'expert')
    expect(face.hooks.helperForm.getSnapshot()).toMatchObject({ invalid: true, values: { codexReasoningEffort: '__choose__' } })
    face.edit('codexReasoningEffort', '')
    expect(face.hooks.helperForm.getSnapshot().invalid).toBe(false)
    expect(actions.test).not.toHaveBeenCalled()
  })

  it('retains saved selections and healthy metadata when a catalog fails', async () => {
    const { controller, face, actions } = setup()
    actions.codex.mockRejectedValue(new Error('directory unavailable'))
    await controller.refresh()
    expect(face.hooks.helperDirectory.getSnapshot()).toMatchObject({ loading: false, error: 'Error: directory unavailable', account: { loggedIn: true } })
    expect(face.hooks.helperDirectory.getSnapshot().api).toHaveLength(1)
    expect(face.hooks.helperForm.getSnapshot().values.codexModel).toBe('expert')
  })

  it('waits for the current login completion even when another account is already signed in', async () => {
    vi.useFakeTimers()
    const { face, actions } = setup()
    face.login()
    await vi.advanceTimersByTimeAsync(0)
    actions.account.mockResolvedValue({ loggedIn: true, login: { loginId: 'login', status: 'pending' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(face.hooks.helperDirectory.getSnapshot().loginId).toBe('login')
    actions.account.mockResolvedValue({ loggedIn: true, login: { loginId: 'login', status: 'failed', error: 'Expired' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(face.hooks.helperDirectory.getSnapshot()).toMatchObject({ loginId: '', authUrl: '', error: 'Error: Expired', busy: false })
    const calls = actions.account.mock.calls.length
    await vi.advanceTimersByTimeAsync(4000)
    expect(actions.account).toHaveBeenCalledTimes(calls)
  })

  it('cancels authentication and releases polling on disposal', async () => {
    vi.useFakeTimers()
    const { controller, face, actions } = setup()
    face.login()
    await vi.advanceTimersByTimeAsync(0)
    face.cancelLogin()
    await vi.advanceTimersByTimeAsync(0)
    expect(actions.cancelLogin).toHaveBeenCalledWith('login')
    expect(face.hooks.helperDirectory.getSnapshot().authUrl).toBe('')
    controller.dispose()
    await vi.advanceTimersByTimeAsync(4000)
    expect(actions.account).not.toHaveBeenCalled()
  })
})
