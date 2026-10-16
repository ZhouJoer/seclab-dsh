/** Task declarations are optional, bounded data rather than interpolated instructions. @module */
import { describe, expect, it } from 'vitest'
import { renderTaskContext, resolveTaskContext, taskContextBytes } from '../src/task-context.ts'

const authorization = { basis: 'Owner', scope: 'sample', allowedActions: 'Read source', restrictions: 'No execution' }
describe('task context', () => {
  it.each([undefined, null, {}, { background: '  ' }])('omits empty declarations: %j', (input) => {
    expect(resolveTaskContext(input, 4096)).toBeUndefined()
  })
  it('accepts background without authorization and trims only surrounding whitespace', () => {
    const context = resolveTaskContext({ background: '  Test {{model}}\n</context> "data"  ' }, 4096)
    expect(context).toEqual({ background: 'Test {{model}}\n</context> "data"' })
    const rendered = renderTaskContext(context, 0)
    expect(rendered).toContain('{{model}}')
    expect(JSON.parse(rendered.split('\n')[1]!)).toEqual({ authorizationStatus: 'absent', authorization: null, background: context?.background })
  })
  it('requires all authorization fields only when a declaration is supplied', () => {
    for (const key of ['basis', 'scope', 'allowedActions', 'restrictions']) {
      expect(() => resolveTaskContext({ authorization: { ...authorization, [key]: '' } }, 4096)).toThrow()
    }
    expect(resolveTaskContext({ authorization }, 4096)).toEqual({ authorization })
    expect(() => resolveTaskContext({ authorization: { ...authorization, expiresAt: NaN } }, 4096)).toThrow()
    expect(() => resolveTaskContext({ authorization, approval: true }, 4096)).toThrow()
  })
  it('keeps expiry stable until the deadline and renders removal explicitly', () => {
    const context = { authorization: { ...authorization, expiresAt: 100 } }
    expect(renderTaskContext(context, 1)).toBe(renderTaskContext(context, 99))
    expect(renderTaskContext(context, 99)).toContain('"authorizationStatus":"declared"')
    expect(renderTaskContext(context, 100)).toContain('"authorizationStatus":"expired"')
    expect(renderTaskContext(undefined, 100)).toContain('"authorization":null')
  })
  it('counts the complete UTF-8 snapshot and never truncates restrictions', () => {
    const context = { authorization: { ...authorization, restrictions: '禁止联网'.repeat(30) } }
    const bytes = taskContextBytes(renderTaskContext(context, 0))
    expect(bytes).toBe(Buffer.byteLength(renderTaskContext(context, 0)))
    expect(resolveTaskContext(context, bytes)).toEqual(context)
    expect(() => resolveTaskContext(context, bytes - 1)).toThrow('exceeds')
  })
})
