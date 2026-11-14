/** Inventory separates measured installations from compatibility and target prerequisites. @module */
import { expect, it } from 'vitest'
import { parseToolDefinition } from '../src/tool-definitions.ts'
import { toolHealth, toolboxEnvironment } from '../src/tool-health.ts'
import type { ToolboxTool } from '../src/toolbox-types.ts'
const row: ToolboxTool = { id: 'java', category: 'runtime', status: 'available', command: 'java', location: 'java',
  version: 'openjdk version "21.0.4"', source: 'operator', detail: '', installUrl: '', invocation: 'shell' }

it('keeps installation discovery distinct from unsupported Java and unchecked target access', () => {
  const tool = parseToolDefinition({ id: 'java', label: 'Java', commands: ['java'], compatibility: { minimumMajor: 25 } })
  const result = toolHealth(row, tool)
  expect(result).toMatchObject({ status: 'error', reason: 'incompatible-version' })
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'installation', status: 'passed' }),
    expect.objectContaining({ kind: 'compatibility', status: 'failed' }),
    expect.objectContaining({ kind: 'target', status: 'unknown' }),
  ]))
})

it('does not infer compatibility from unrecognized output', () => {
  const tool = parseToolDefinition({ id: 'java', label: 'Java', commands: ['java'], compatibility: { minimumMajor: 17 } })
  const result = toolHealth({ ...row, version: 'launcher ready' }, tool)
  expect(result.status).toBe('error')
  expect(result.checks).toContainEqual(expect.objectContaining({ kind: 'compatibility', status: 'unknown' }))
})

it('rejects an inverted compatibility range in an imported definition', () => {
  expect(() => parseToolDefinition({ id: 'java', label: 'Java', commands: ['java'],
    compatibility: { minimumMajor: 25, maximumMajor: 17 } })).toThrow('Minimum compatible version')
})

it('offers external container inspection and installation without lifecycle ownership', () => {
  const environment = { id: 'external', label: 'External Kali', kind: 'docker' as const, cwd: '/workspace', tools: [],
    externalContainer: { name: 'kali', workdir: '/analysis' } }
  expect(toolboxEnvironment(environment)).toMatchObject({ management: 'external-container', actions: ['inspect', 'install'] })
})
