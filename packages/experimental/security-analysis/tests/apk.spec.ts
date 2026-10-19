/** APK imports retain measured members and reject ambiguous or oversized input. @module */
import { readFile } from 'node:fs/promises'
import { it, expect } from 'vitest'
import { apkInventory, apkMembers } from '../src/workbench/apk.ts'
const fixture = (name: string) => readFile(new URL('./fixtures/apk/' + name + '.apk', import.meta.url))
it('extracts only complete DEX and native library members', async () => {
  const members = await apkMembers(await fixture('members'), 1024, 2)
  expect(members.map(({ path, format }) => ({ path, format }))).toEqual([
    { path: 'classes.dex', format: 'dex' }, { path: 'lib/arm64-v8a/libdemo.so', format: 'elf' },
  ])
})
it.each(['duplicate', 'invalid', 'traversal'])('refuses %s archive entries', async (name) => {
  await expect(apkMembers(await fixture(name), 1024, 4)).rejects.toThrow()
})
it('enforces member and uncompressed byte budgets', async () => {
  const bytes = await fixture('members')
  await expect(apkMembers(bytes, 1024, 1)).rejects.toThrow(/budget/)
  await expect(apkMembers(bytes, 4, 3)).rejects.toThrow(/budget/)
})

it('lists archive metadata without extracting members and marks omitted entries', async () => {
  const bytes = await fixture('members')
  const complete = await apkInventory(bytes, 20)
  expect(complete.incomplete).toBe(false)
  expect(complete.entries).toContainEqual(expect.objectContaining({ path: 'classes.dex' }))
  const limited = await apkInventory(bytes, 1)
  expect(limited.entries).toHaveLength(1)
  expect(limited.incomplete).toBe(true)
  await expect(apkInventory(await fixture('duplicate'), 20)).rejects.toThrow('repeats')
})
