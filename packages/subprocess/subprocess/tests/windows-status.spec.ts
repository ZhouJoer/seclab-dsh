/** Windows process status decoding accepts both Node and PowerShell representations. @module */
import { expect, it } from 'vitest'
import { windowsStatusDiagnostic } from '../src/windows-status.ts'

it.each([
  [-1073741515, 3221225781, '0xC0000135', 'STATUS_DLL_NOT_FOUND'],
  [-1073741701, 3221225595, '0xC000007B', 'STATUS_INVALID_IMAGE_FORMAT'],
  [-1073741511, 3221225785, '0xC0000139', 'STATUS_ENTRYPOINT_NOT_FOUND'],
] as const)('decodes signed and unsigned %s', (signed, unsigned, hex, name) => {
  expect(windowsStatusDiagnostic(signed)).toBe(windowsStatusDiagnostic(unsigned))
  expect(windowsStatusDiagnostic(signed)).toContain(hex)
  expect(windowsStatusDiagnostic(signed)).toContain(name)
})
it.each([null, 0, 1, 23, -1, 4294967295])('leaves ordinary or unknown exit %s uninterpreted', (code) => {
  expect(windowsStatusDiagnostic(code)).toBeUndefined()
})
