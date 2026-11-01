/** Script discovery returns selected invocation details without executable probes. @module */
import { expect, it } from 'vitest'
import { discoverScripts } from '../src/script-discovery.ts'

it('finds PE address helpers in Chinese without loading paths or unrelated scripts', () => {
  const entries = discoverScripts('地址', undefined, false)
  expect(entries.map(entry => entry.id)).toEqual(['pe.map'])
  expect(entries[0]).not.toHaveProperty('path')
  expect(entries[0]?.toolIds).toEqual(['python', 'pefile'])
  expect(discoverScripts('', ['pe.patch'], true)[0]?.example).toContain('patch --help')
  expect(() => discoverScripts('', ['missing'], false)).toThrow('Unknown script')
})

it('distinguishes fixed adapters from native scripts and returns independent results', () => {
  const entries = discoverScripts('', ['analysis.native-triage'], true)
  expect(entries[0]?.invocation).toBe('adapter')
  entries[0]!.toolIds.push('changed')
  expect(discoverScripts('', ['analysis.native-triage'], true)[0]?.toolIds).not.toContain('changed')
})
