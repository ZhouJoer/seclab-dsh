/** Operator tool configuration files shared by the source utilities. @module */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parseSecurityEnvironments } from '../packages/experimental/security-analysis/src/security-environment-config.ts'
import type { SecurityEnvironmentsConfiguration } from '../packages/experimental/security-analysis/src/security-environment-config.ts'
export { readSecurityEnvironments, type SecurityEnvironmentsConfiguration } from '../packages/experimental/security-analysis/src/security-environment-config.ts'
import { writeSecurityToolsFile } from '../packages/experimental/security-analysis/src/local-tools.ts'
export { readSecurityTools, readToolSettings, standaloneTool, writeSecurityToolsFile } from '../packages/experimental/security-analysis/src/local-tools.ts'

/** Select the same installation file as the security profile; explicit paths always win.
 * @param cwd - launch directory.
 * @param home - resolved Harness home.
 * @param explicit - optional operator-selected file.
 * @returns absolute installation configuration path.
 */
export function resolveSecurityToolsFile(cwd: string, home: string, explicit?: string): string {
  if (explicit !== undefined) return resolve(cwd, explicit)
  const local = resolve(cwd, '.dsh/security-tools.json')
  const legacy = resolve(home, 'security/tools.json')
  return existsSync(local) || !existsSync(legacy) ? local : legacy
}

/** Save installations if the configuration is unchanged and every environment remains valid.
 * @param path - existing environment configuration file.
 * @param configuration - validated deployment declarations to replace it.
 * @param expected - complete file text captured before probing or editing.
 */
export function writeSecurityEnvironments(path: string, configuration: SecurityEnvironmentsConfiguration, expected: string): void {
  const current = readFileSync(path, 'utf8')
  if (current !== expected) throw new Error('Security environments changed; run the command again before saving')
  parseSecurityEnvironments(configuration.environments)
  const original: unknown = JSON.parse(current)
  const declared = original && typeof original === 'object' && 'environments' in original && Array.isArray(original.environments)
    ? original.environments : []
  const environments = configuration.environments.map((environment) => {
    const previous: unknown = declared.find((item: unknown) => item && typeof item === 'object' && 'id' in item && item.id === environment.id)
    if (previous && typeof previous === 'object' && 'cwd' in previous && typeof previous.cwd === 'string' &&
      !isAbsolute(previous.cwd) && resolve(dirname(path), previous.cwd) === environment.cwd)
      return { ...environment, cwd: previous.cwd }
    return environment
  })
  writeSecurityToolsFile(path, JSON.stringify({ ...configuration, environments }, null, 2) + '\n')
}
