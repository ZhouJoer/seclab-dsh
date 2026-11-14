/** Preview an operator-selected Kali image installation through the shared lifecycle. @module */
import { parseArgs } from 'node:util'
import { manageSecurityTools } from './security-tools.ts'

/** Resolve the toolbox convenience command without building or selecting an image.
 * @param args - configured Docker environment, package group and optional project files.
 * @returns completion after printing the immutable reviewed installation plan.
 */
export async function previewSecurityToolbox(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: {
    group: { type: 'string', default: 'kali-web' }, environment: { type: 'string' },
    environments: { type: 'string' }, config: { type: 'string' }, base: { type: 'string' },
    limits: { type: 'string' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('pnpm security:toolbox --environment ID [--group kali-web|kali-reverse|kali-firmware|kali-network] [--environments FILE] [--config FILE] [--base kalilinux/kali-last-release] [--limits FILE]\nPreview the selected Kali package group. Choose the shared root with security:tools install-root DIRECTORY, then apply the returned plan with security:tools install-apply PLAN --digest DIGEST --request-id ID [--confirm ID]. This command does not install packages or switch the selected image.')
    return
  }
  if (!['kali-web', 'kali-reverse', 'kali-firmware', 'kali-network'].includes(values.group)) throw new Error('Select a registered Kali group with --group; use --help.')
  if (!values.environment) throw new Error('Select a configured Docker environment with --environment ID; use --help.')
  const forwarded = ['install-preview', values.group, '--environment', values.environment]
  for (const name of ['environments', 'config', 'limits'] as const) if (values[name]) forwarded.push('--' + name, values[name])
  if (values.base) forwarded.push('--option', 'base=' + values.base)
  await manageSecurityTools(forwarded)
}

if (import.meta.main) {
  try { await previewSecurityToolbox(process.argv.slice(2)) } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
