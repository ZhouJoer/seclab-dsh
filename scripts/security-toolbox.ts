/** Build the dsh-security-toolbox Docker image from the security-analysis toolbox recipe. @module */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const toolboxDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)),
  '..', 'packages', 'experimental', 'security-analysis', 'resources', 'toolbox')
const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf('--' + name)
  return index === -1 ? undefined : args[index + 1]
}
const baseImage = flag('base') ?? 'debian:12-slim'
const tag = flag('tag') ?? 'dsh-security-toolbox:latest'
const result = spawnSync('docker', ['build', '--build-arg', 'BASE_IMAGE=' + baseImage, '-t', tag, toolboxDirectory], {
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) throw new Error('toolbox image build exited with ' + String(result.status))
console.log('built ' + tag + ' from ' + baseImage)
