// @vitest-environment jsdom
/** Environment bindings and asynchronous installation settings. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as common } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolboxConfiguration, ToolboxConfigurationResult } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { ToolSettings } from '../src/client/ToolSettings.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const configuration: ToolboxConfiguration = { editable: true, revision: 'revision-1', environmentKind: 'docker',
  environments: [{ id: 'local', label: 'Host', kind: 'local' }, { id: 'box', label: 'Box', kind: 'docker' }],
  bindings: { radare2: 'local' }, tools: [{ id: 'radare2', command: '/bin/r2', prefixArgs: [], versionArgs: ['-v'], saved: true }] }

it('saves a container installation and fixed route without offering a Host picker', async () => {
  const pending = Promise.withResolvers<ToolboxConfigurationResult>()
  const configure = vi.fn((_environment: string, _input: string) => pending.promise), changed = vi.fn(), notify = vi.fn(), browse = vi.fn()
  render(<ToolSettings environmentId="box" configuration={configuration} selectedId="radare2"
    configureTool={configure} toolboxFiles={browse} onResult={changed} onClose={vi.fn()} notify={notify} t={makeTranslate(zh, common)} />)
  expect(screen.queryByRole('button', { name: zh.toolBrowseExecutable })).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.toolDefaultEnvironment), { target: { value: 'box' } })
  fireEvent.change(screen.getByLabelText(zh.toolExecutable), { target: { value: '/opt/r2' } })
  fireEvent.click(screen.getByRole('button', { name: zh.toolCheckAndSave }))
  expect(JSON.parse(configure.mock.calls[0]![1])).toMatchObject({ action: 'save', command: '/opt/r2', defaultEnvironmentId: 'box', revision: 'revision-1' })
  expect(screen.getByRole('button', { name: zh.toolCloseEditor }).hasAttribute('disabled')).toBe(true)
  pending.resolve({ saved: true, configuration: { ...configuration, revision: 'revision-2', bindings: { radare2: 'box' } },
    tool: { id: 'radare2', category: 'reverse', status: 'available', command: 'docker', prefixArgs: ['exec', 'owned'],
      installation: { command: '/opt/r2', prefixArgs: [] }, version: '6.2', location: '', source: 'Container', detail: '', installUrl: '', invocation: 'shell' } })
  await waitFor(() => { expect(changed).toHaveBeenCalledOnce() })
  expect(notify).toHaveBeenCalledWith(zh.toolApplied)
  expect(screen.getByLabelText<HTMLInputElement>(zh.toolExecutable).value).toBe('/opt/r2')
  expect(browse).not.toHaveBeenCalled()
})

it('ignores a late save after changing environments or leaving the editor', async () => {
  const pending = Promise.withResolvers<ToolboxConfigurationResult>()
  const changed = vi.fn(), notify = vi.fn()
  const view = render(<ToolSettings environmentId="box" configuration={configuration} selectedId="radare2"
    configureTool={() => pending.promise} toolboxFiles={vi.fn()} onResult={changed} onClose={vi.fn()}
    notify={notify} t={makeTranslate(zh, common)} />)
  fireEvent.click(screen.getByRole('button', { name: zh.toolCheckAndSave }))
  view.unmount()
  pending.resolve({ saved: true, configuration, tool: null })
  await pending.promise
  expect(changed).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})
