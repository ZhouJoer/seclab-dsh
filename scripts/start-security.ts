/** Launch the optional security Web profile through the existing dsh CLI. @module */
import { fileURLToPath } from 'node:url'
import { resolveProfileDir } from '../packages/boot/app-boot/src/profile.ts'
import { runCli } from '../apps/cli/src/bin.ts'
import { prepareSecurityToolsPatch } from './security-tools-config.ts'
import { prepareSecurityProfile } from './security-profile-config.ts'

const toolTemplate = '../apps/cli/config/examples/security-analysis/cordis.yml'
await prepareSecurityProfile(resolveProfileDir('security'))
const toolPatch = prepareSecurityToolsPatch(fileURLToPath(new URL(toolTemplate, import.meta.url)))
const args = [
  '--profile', 'security',
  '--patch', toolPatch,
  ...process.argv.slice(2),
]
process.argv = [process.execPath, fileURLToPath(new URL('../apps/cli/src/bin.ts', import.meta.url)), ...args]
await runCli()
