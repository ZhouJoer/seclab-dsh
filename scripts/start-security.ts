/** Launch the optional security Web profile through the existing dsh CLI. @module */
import { fileURLToPath } from 'node:url'
import { resolveProfileDir } from '../packages/boot/app-boot/src/profile.ts'
import { runCli } from '../apps/cli/src/bin.ts'
import { prepareSecurityProfile } from './security-profile-config.ts'

await prepareSecurityProfile(resolveProfileDir('security'))
const args = [
  '--profile', 'security',
  ...process.argv.slice(2),
]
process.argv = [process.execPath, fileURLToPath(new URL('../apps/cli/src/bin.ts', import.meta.url)), ...args]
await runCli()
