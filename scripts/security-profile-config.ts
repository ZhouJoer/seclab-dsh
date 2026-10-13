/** Source security profile layers precede the user's editable configuration. */
import { join } from 'node:path'
import { initProfile, readProfileManifest, writeProfileManifest } from '../packages/boot/app-boot/src/profile.ts'
import { withFileLock } from '../packages/util/atomic-write/src/index.ts'

/**
 * Add the source security bundles while preserving installed bundles and preferences.
 * @param directory Security profile directory.
 */
export async function prepareSecurityProfile(directory: string): Promise<void> {
  initProfile(directory, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  await withFileLock(join(directory, 'package.json'), () => {
    const manifest = readProfileManifest('dsh', directory)
    const bundles = manifest.dsh?.profile?.bundles
    if (!bundles) throw new Error('Security profile must declare its bundle list')
    const additions = ['@deepseek-ai/dsh-experimental-security-profile', '@deepseek-ai/dsh-experimental-security-web-profile']
      .filter(name => !bundles.includes(name))
    if (!additions.length) return Promise.resolve()
    writeProfileManifest(directory, {
      ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, ...additions] } },
    })
    return Promise.resolve()
  })
}
