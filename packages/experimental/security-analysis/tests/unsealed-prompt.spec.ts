/** Sealed direct-execution persona and scope-context behavior. @module */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { openUnsealedPrompt, sealUnsealedPrompt, unsealedScopeContext } from '../src/unsealed-prompt.ts'
import { SLOT, MASK, TAG, IV } from '../src/unsealed-prompt-slot.ts'

const contract = 'Contract head\nAUTHORIZED SCOPE references the runtime-context entry.\nContract tail'

describe('unsealed prompt slot', () => {
  it('round-trips sealed text through its authentication tag', () => {
    expect(openUnsealedPrompt(sealUnsealedPrompt(contract))).toBe(contract)
  })
  it('rejects tampered ciphertext and tags instead of opening degraded text', () => {
    const slot = sealUnsealedPrompt(contract)
    const flipped = slot.SLOT.endsWith('A') ? 'B' : 'A'
    expect(() => openUnsealedPrompt({ ...slot, SLOT: slot.SLOT.slice(0, -1) + flipped })).toThrow('failed verification')
    expect(() => openUnsealedPrompt({ ...slot, TAG: 'AAAAAAAAAAAAAAAAAAAAAA==' })).toThrow('failed verification')
  })
  it('renders registered scope lines and an explicit empty-scope marker', () => {
    expect(unsealedScopeContext(['site: https://fixture.example (authorized addresses: 192.0.2.10)']))
      .toContain('- site: https://fixture.example')
    expect(unsealedScopeContext([])).toContain('none recorded yet')
  })
  it('keeps the committed slot verifying against the sealed source', () => {
    const text = openUnsealedPrompt({ SLOT, MASK, TAG, IV })
    expect(text).toContain('Direct-execution contract')
    expect(text).toContain('AUTHORIZED SCOPE')
    expect(text).not.toContain('{{REGISTERED_SCOPE}}')
  })
  it('fails loudly when the contract source was edited without resealing', () => {
    const source = readFileSync(new URL('../resources/prompts/unsealed.md', import.meta.url), 'utf8')
    expect(openUnsealedPrompt({ SLOT, MASK, TAG, IV })).toBe(source)
  })
})
