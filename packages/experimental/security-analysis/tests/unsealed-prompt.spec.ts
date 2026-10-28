/** Direct-execution Markdown loading and scope-context behavior. @module */
import * as fs from 'node:fs'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { readUnsealedPrompt, unsealedScopeContext } from '../src/unsealed-prompt.ts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

afterEach(() => vi.resetAllMocks())

describe('unsealed prompt resource', () => {
  it('loads the Markdown resource verbatim', () => {
    const source = fs.readFileSync(new URL('../resources/prompts/unsealed.md', import.meta.url), 'utf8')
    expect(readUnsealedPrompt()).toBe(source)
  })
  it('preserves custom text without requiring section headings', () => {
    const source = '  Custom analysis instructions.\n\n'
    vi.mocked(fs.readFileSync).mockReturnValueOnce(source)
    expect(readUnsealedPrompt()).toBe(source)
  })
  it.each(['', ' \n\t'])('rejects empty prompt text %j', (source) => {
    const read = vi.mocked(fs.readFileSync).mockReturnValueOnce(source)
    try {
      expect(() => readUnsealedPrompt()).toThrow('Unsealed prompt is empty')
    } finally {
      read.mockReset()
    }
  })
  it('propagates file read failures instead of injecting fallback text', () => {
    const failure = new Error('prompt resource unavailable')
    const read = vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw failure })
    try {
      expect(() => readUnsealedPrompt()).toThrow(failure)
    } finally {
      read.mockReset()
    }
  })
  it('renders registered scope lines and an explicit empty-scope marker', () => {
    expect(unsealedScopeContext(['site: https://fixture.example (authorized addresses: 192.0.2.10)']))
      .toContain('- site: https://fixture.example')
    expect(unsealedScopeContext([])).toContain('none recorded yet')
  })
})
