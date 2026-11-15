import { describe, expect, it } from 'vitest'
import { hasExactOutputQuote } from './output-quote.mjs'

describe('literal output quotations', () => {
  it('accepts exact stdout text after the tool envelope is decoded', () => {
    const output = '{"matches": [{"device": "b1", "active": 1}]}\n'
    expect(hasExactOutputQuote(JSON.stringify({ kind: 'foreground', stdout: { text: output } }), '"device": "b1", "active": 1')).toBe(true)
  })
  it('accepts a multiline read result without requiring JSON transport escapes', () => {
    const output = 'line one\nline two "quoted"'
    expect(hasExactOutputQuote(JSON.stringify({ path: 'data.txt', text: output }), output)).toBe(true)
  })
  it('does not normalize or interpret a paraphrase as an exact observation', () => {
    expect(hasExactOutputQuote(JSON.stringify({ stdout: { text: 'count = 3\n' } }), 'count = 4')).toBe(false)
    expect(hasExactOutputQuote(JSON.stringify({ stdout: { text: 'count = 3\n' } }), 'count=3')).toBe(false)
    expect(hasExactOutputQuote('count = 3', 'all rows passed')).toBe(false)
  })
})
