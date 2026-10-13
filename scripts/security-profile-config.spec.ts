import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readProfileManifest } from '../packages/boot/app-boot/src/profile.ts'
import { prepareSecurityProfile } from './security-profile-config.ts'

it('adds security as editable bundle layers and preserves user configuration across repeated launches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-security-profile-'))
  try {
    await prepareSecurityProfile(directory)
    const patch = '- id: helper\n  config:\n    backend: api\n'
    await writeFile(join(directory, 'cordis.patch.yml'), patch)
    const before = await readFile(join(directory, 'package.json'), 'utf8')
    await prepareSecurityProfile(directory)
    expect(await readFile(join(directory, 'package.json'), 'utf8')).toBe(before)
    expect(readProfileManifest('dsh', directory).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-experimental-security-profile', '@deepseek-ai/dsh-experimental-security-web-profile'])
    expect(await readFile(join(directory, 'cordis.patch.yml'), 'utf8')).toBe(patch)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
