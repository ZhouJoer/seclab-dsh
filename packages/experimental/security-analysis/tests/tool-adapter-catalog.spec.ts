/** Model discovery projects fixed interfaces rather than operator launcher configuration. @module */
import { expect, it } from 'vitest'
import { modelToolDefinition, modelToolInventory, toolAdapters } from '../src/tool-adapter-catalog.ts'
import { parseToolDefinition } from '../src/tool-definitions.ts'

it.each(toolAdapters)('publishes the $id adapter independently of imported launcher instructions', ({ id, operations }) => {
  const definition = parseToolDefinition({ id, label: id, commands: ['/operator/private'], args: ['--private'],
    guide: 'Run the raw executable with shell' })
  for (const details of [true, false]) {
    const projection = modelToolDefinition(definition, details)
    expect(projection).toMatchObject({ id, invocation: 'adapter', toolName: 'security_' + id, operations })
    expect(JSON.stringify(projection)).not.toMatch(/operator\/private|--private|raw executable|"commands"|"args"/u)
  }
})

it('retains non-adapter discovery and redacts launcher fields only for managed adapters', () => {
  const custom = parseToolDefinition({ id: 'custom', label: 'Custom', commands: ['custom'], guide: 'Custom workflow' })
  expect(modelToolDefinition(custom, true)).toEqual(custom)
  const common = { category: 'utility' as const, status: 'available' as const, command: '/secret/tool', prefixArgs: ['--launcher'],
    version: '1', location: '/secret/tool', source: 'Host', detail: '', installUrl: '', invocation: 'shell' as const }
  const projection = modelToolInventory({ environmentId: 'local', kind: 'local', runtime: 'ready', checkedAt: 1,
    detail: '', workdir: '/work', tools: [{ ...common, id: 'radare2' }, { ...common, id: 'custom' }] })
  expect(projection).toMatchObject({ tools: [{ id: 'radare2', toolName: 'security_radare2', status: 'available' }, { id: 'custom', command: '/secret/tool' }] })
  const rows = (projection as { tools: object[] }).tools
  expect(JSON.stringify(rows[0])).not.toContain('/secret/tool')
  expect(JSON.stringify(rows[0])).not.toContain('--launcher')
})

it('rejects environment-variable discovery rules in imported definitions', () => {
  expect(() => parseToolDefinition({ id: 'custom', label: 'Custom', commands: ['custom'],
    searchPaths: [{ environment: 'CUSTOM_HOME', path: ['bin'] }] })).toThrow()
  expect(parseToolDefinition({ id: 'custom', label: 'Custom', commands: ['custom'], searchPaths: [] })).not.toHaveProperty('searchPaths')
})
