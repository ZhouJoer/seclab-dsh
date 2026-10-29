/** Recovery suggestions depend on codes, not diagnostic prose. @module */
import { expect, it } from 'vitest'
import { analysisFailure } from '../src/analysis-failure.ts'

it.each([['ENOENT', 'missing-path'], ['EACCES', 'permission'], ['ENOEXEC', 'unsupported-format']])(
  'retains the system cause and classifies %s', (code, category) => {
    const cause = Object.assign(new Error('original diagnostic'), { code, path: '/fixture' })
    const result = analysisFailure(cause)
    expect(result).toBeInstanceOf(Error)
    if (!(result instanceof Error)) throw new Error('Missing diagnostic error')
    expect(result.cause).toBe(cause)
    expect(JSON.parse(result.message)).toMatchObject({ code, category, path: '/fixture', message: cause.message })
  },
)
it('does not infer a cause from text or unknown codes', () => {
  for (const cause of [new Error('antivirus blocked a missing DLL'), { code: 'CUSTOM', message: 'failed' }, null])
    expect(analysisFailure(cause)).toBe(cause)
})
