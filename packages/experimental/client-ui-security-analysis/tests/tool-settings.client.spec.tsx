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
  adapters: [{ id: 'radare2', toolName: 'security_radare2', operations: ['identity'], installationId: 'radare2',
    dependencies: [], environmentId: 'local', bindingSource: 'operator', status: 'unchecked' }],
  bindings: { radare2: 'local' }, tools: [{ id: 'radare2', command: '/bin/r2', prefixArgs: [], versionArgs: ['-v'], saved: true }] }

it.each(['ghidra', 'packet-capture'])('edits the %s route without requiring a service executable', async (id) => {
  const settings: ToolboxConfiguration = { ...configuration, bindings: {}, adapters: [{ id, bindingId: id,
    toolName: 'security_' + id, provider: id, operations: ['summary'], dependencies: id === 'ghidra' ? [] : ['python', 'tshark'],
    environmentIds: ['local'], bindingSource: 'none', status: 'unchecked' }] }
  const configure = vi.fn(async (_environment: string, _input: string): Promise<ToolboxConfigurationResult> => ({
    saved: true, tool: null, configuration: settings,
  }))
  render(<ToolSettings environmentId="local" configuration={settings} selectedId={id}
    configureTool={configure} toolboxFiles={vi.fn()} onResult={vi.fn()} onClose={vi.fn()} t={makeTranslate(zh, common)} />)
  expect(screen.queryByLabelText(zh.toolExecutable)).toBeNull()
  const environments = screen.getByLabelText<HTMLSelectElement>(zh.toolDefaultEnvironment)
  expect([...environments.options].map(option => option.value)).toEqual(['', 'local'])
  expect(screen.getByText(zh.toolInheritEnvironment)).toBeDefined()
  if (id === 'packet-capture') expect(screen.getByText(/python, tshark/)).toBeDefined()
  fireEvent.change(environments, { target: { value: 'local' } })
  fireEvent.click(screen.getByRole('button', { name: zh.toolSaveBinding }))
  await waitFor(() => { expect(configure).toHaveBeenCalledOnce() })
  expect(JSON.parse(configure.mock.calls[0]![1])).toEqual({ action: 'bind', id, revision: 'revision-1', defaultEnvironmentId: 'local' })
})

it('saves a container installation without changing its adapter route or offering a Host picker', async () => {
  const pending = Promise.withResolvers<ToolboxConfigurationResult>()
  const configure = vi.fn((_environment: string, _input: string) => pending.promise), changed = vi.fn(), notify = vi.fn(), browse = vi.fn()
  render(<ToolSettings environmentId="box" configuration={configuration} selectedId="radare2"
    configureTool={configure} toolboxFiles={browse} onResult={changed} onClose={vi.fn()} notify={notify} t={makeTranslate(zh, common)} />)
  expect(screen.queryByRole('button', { name: zh.toolBrowseExecutable })).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.toolDefaultEnvironment), { target: { value: 'box' } })
  fireEvent.change(screen.getByLabelText(zh.toolExecutable), { target: { value: '/opt/r2' } })
  fireEvent.click(screen.getByRole('button', { name: zh.toolCheckAndSave }))
  expect(JSON.parse(configure.mock.calls[0]![1])).toMatchObject({ action: 'save', command: '/opt/r2', revision: 'revision-1' })
  expect(JSON.parse(configure.mock.calls[0]![1])).not.toHaveProperty('defaultEnvironmentId')
  expect(screen.getByRole('button', { name: zh.toolCloseEditor }).hasAttribute('disabled')).toBe(true)
  pending.resolve({ saved: true, configuration: { ...configuration, revision: 'revision-2', bindings: { radare2: 'box' } },
    tool: { id: 'radare2', category: 'reverse', status: 'available', command: 'docker', prefixArgs: ['exec', 'owned'],
      installation: { command: '/opt/r2', prefixArgs: [] }, version: '6.2', location: '', source: 'Container', detail: '', installUrl: '', invocation: 'shell' } })
  await waitFor(() => { expect(changed).toHaveBeenCalledOnce() })
  expect(notify).toHaveBeenCalledWith(zh.toolApplied)
  expect(screen.getByLabelText<HTMLInputElement>(zh.toolExecutable).value).toBe('/opt/r2')
  expect(browse).not.toHaveBeenCalled()
})

it('saves and resets only the binding even with an unfinished executable edit', async () => {
  const configure = vi.fn(async (_environment: string, _input: string): Promise<ToolboxConfigurationResult> => ({
    saved: true, tool: null, configuration: { ...configuration, revision: 'revision-2', bindings: { radare2: 'box' } },
  }))
  const changed = vi.fn()
  render(<ToolSettings environmentId="box" configuration={configuration} selectedId="radare2"
    configureTool={configure} toolboxFiles={vi.fn()} onResult={changed} onClose={vi.fn()} t={makeTranslate(zh, common)} />)
  fireEvent.change(screen.getByLabelText(zh.toolExecutable), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(zh.toolDefaultEnvironment), { target: { value: 'box' } })
  fireEvent.click(screen.getByRole('button', { name: zh.toolSaveBinding }))
  await waitFor(() => { expect(changed).toHaveBeenCalledOnce() })
  expect(JSON.parse(configure.mock.calls[0]![1])).toEqual({ action: 'bind', id: 'radare2', revision: 'revision-1', defaultEnvironmentId: 'box' })
  fireEvent.click(screen.getByRole('button', { name: zh.toolResetBinding }))
  await waitFor(() => { expect(changed).toHaveBeenCalledTimes(2) })
  expect(JSON.parse(configure.mock.calls[1]![1])).toEqual({ action: 'reset-binding', id: 'radare2', revision: 'revision-2' })
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
