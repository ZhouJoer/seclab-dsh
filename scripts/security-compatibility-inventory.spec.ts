/** Regression coverage for shared-source and Session event inventory admission. @module */
import { describe, expect, it } from 'vitest'
import { securitySessionEvents, verifySecurityPatchInventory, verifySecuritySessionEvents } from './security-compatibility-inventory.ts'

it('checks event additions and required reader support', () => {
  expect(() => { verifySecuritySessionEvents(['base'], ['base', 'helper/start'], ['helper/start']) }).not.toThrow()
  expect(() => { verifySecuritySessionEvents(['base'], ['base', 'helper/start'], []) }).toThrow('Register required')
  expect(() => { verifySecuritySessionEvents(['base'], ['base'], ['helper/start']) }).toThrow('Missing required')
})

it('reads literal event declarations and refuses unsupported registry sources', () => {
  expect(securitySessionEvents("export const KNOWN_SESSION_EVENT_TYPES = new Set(['helper/start'])")).toEqual(['helper/start'])
  for (const source of ['', 'const KNOWN_SESSION_EVENT_TYPES = dynamic', 'const KNOWN_SESSION_EVENT_TYPES = new Set(values)', 'const KNOWN_SESSION_EVENT_TYPES = new Set([value])']) {
    expect(() => securitySessionEvents(source)).toThrow()
  }
})

const baseline = ['packages/core/session/package.json', 'packages/core/session/src/index.ts', 'apps/cli/package.json']

describe('security patch ownership', () => {
  it('accepts registered edits and additions in shared packages', () => {
    const changed = ['packages/core/session/src/index.ts', 'apps/cli/src/new.ts']
    expect(() => { verifySecurityPatchInventory(baseline, changed, changed) }).not.toThrow()
  })

  it.each(['packages/core/session/src/index.ts', 'packages/core/session/src/new.ts', 'apps/cli/src/new.ts'])('rejects an unregistered source change at %s', (path) => {
    expect(() => { verifySecurityPatchInventory(baseline, [path], []) }).toThrow(path)
  })

  it('requires exact files instead of directory-wide exceptions', () => {
    expect(() => { verifySecurityPatchInventory(baseline, ['packages/core/session/src/new.ts'], ['packages/core/session/src']) }).toThrow('new.ts')
  })

  it('normalizes Windows paths before matching ownership', () => {
    expect(() => { verifySecurityPatchInventory(['apps\\cli\\package.json'], ['apps\\cli\\src\\new.ts'], []) }).toThrow('apps/cli/src/new.ts')
    expect(() => { verifySecurityPatchInventory(baseline, ['apps\\cli\\src\\new.ts'], ['apps/cli/src/new.ts']) }).not.toThrow()
  })

  it('excludes plugin-owned packages and non-source files', () => {
    expect(() => { verifySecurityPatchInventory(baseline, ['packages/experimental/local/src/index.ts', 'packages/core/session/README.md'], []) }).not.toThrow()
  })

  it('refuses an empty baseline', () => {
    expect(() => { verifySecurityPatchInventory([], [], []) }).toThrow('no packages')
  })
})
