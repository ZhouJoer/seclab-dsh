/** Shared deployment validation for Host and container analysis environments. @module */
import Schema from '@deepseek-ai/schemastery'
import { dirname, isAbsolute, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import type { TaskIntakeConfig } from './task-bootstrap.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'

/** Operator fields shared by the profile schema and standalone environment files. */
export const securityEnvironmentSchema: Schema<SecurityEnvironment> = Schema.object({
  id: Schema.string().required(),
  kind: Schema.union(['local', 'docker', 'android'] as const).required(),
  label: Schema.string().required(),
  cwd: Schema.string().required(),
  deviceId: Schema.string(),
  image: Schema.string(),
  externalContainer: Schema.union([Schema.const(undefined), Schema.object({
    name: Schema.string().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u).required(),
    workdir: Schema.string().pattern(/^\/[^\0]*$/u).required(),
  })]),
  tools: Schema.array(Schema.object({
    id: Schema.string().required(), command: Schema.string().required(),
    prefixArgs: Schema.array(Schema.string()),
    versionArgs: Schema.array(Schema.string()).required(), source: Schema.string().required(),
  })).required(),
})

/** Validate relationships after field validation and before any execution.
 * @param environments - configured analysis environments.
 */
export function validateSecurityEnvironments(environments: readonly SecurityEnvironment[]): void {
  if (new Set(environments.map(environment => environment.id)).size !== environments.length)
    throw new Error('Environment IDs must be unique')
  for (const environment of environments) {
    if (['containerId', 'resolvedImageId', 'exchangeRoot', 'webTarget', 'manifest'].some(key => Object.hasOwn(environment, key)))
      throw new Error('Environment configuration cannot contain manager-owned runtime fields')
    if (!isAbsolute(environment.cwd)) throw new Error('Environment working directories must be absolute Host paths')
    if (new Set(environment.tools.map(tool => tool.id)).size !== environment.tools.length)
      throw new Error('Tool IDs must be unique within an environment')
    if (environment.externalContainer && (environment.kind !== 'docker' || environment.image !== undefined))
      throw new Error('externalContainer requires a Docker environment without an image')
    if (environment.kind === 'docker' && !environment.tools.some(tool => tool.id === 'docker'))
      throw new Error('Docker environments require a configured docker tool for the Host endpoint')
  }
}

/** Parse an operator-owned environment document without probing or starting containers.
 * @param input - decoded JSON deployment data.
 * @returns validated environments with no measured runtime state.
 */
export function parseSecurityEnvironments(input: unknown): SecurityEnvironment[] {
  const parse = Schema.array(securityEnvironmentSchema).required() as Schema<unknown, SecurityEnvironment[], 'defined'>
  const environments = parse(input)
  validateSecurityEnvironments(environments)
  return environments
}

/** Environments merged by identity into the security profile. */
export interface SecurityEnvironmentsConfiguration {
  environments: SecurityEnvironment[]
  defaultEnvironmentIds?: string[]
}

/** Read environment declarations with the same validation as the workbench.
 * @param path - operator-owned JSON file; an absent file contributes no environments.
 * @returns validated declarations with relative working directories resolved beside the file.
 */
export function readSecurityEnvironments(path: string): SecurityEnvironmentsConfiguration {
  let input: string
  try { input = readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { environments: [] }
    throw error
  }
  const data: unknown = JSON.parse(input)
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('environments' in data))
    throw new Error(`${path}: expected an object with an environments array`)
  const environments = parseSecurityEnvironments(Array.isArray(data.environments) ? data.environments.map((environment: unknown) => {
    if (environment && typeof environment === 'object' && 'cwd' in environment && typeof environment.cwd === 'string' && environment.cwd.trim())
      return { ...environment, cwd: resolve(dirname(path), environment.cwd) }
    return environment
  }) : data.environments)
  if (!('defaultEnvironmentIds' in data)) return { environments }
  const defaults: unknown = data.defaultEnvironmentIds
  if (!Array.isArray(defaults) || defaults.length === 0 ||
    !defaults.every((id: unknown): id is string => typeof id === 'string' && id.length > 0) || new Set(defaults).size !== defaults.length)
    throw new Error(`${path}: defaultEnvironmentIds must be a nonempty array of unique environment IDs`)
  return { environments, defaultEnvironmentIds: defaults }
}

/** Resolve the explicitly selected environment file before the workbench starts.
 * @param config - effective plugin configuration after all profile patch layers.
 * @returns configuration with file environments and optional intake defaults applied.
 */
export function resolveEnvironmentConfiguration<T extends {
  environmentConfigurationPath?: string
  environments: SecurityEnvironment[]
  taskIntake?: TaskIntakeConfig | undefined
}>(config: T): T {
  if (config.environmentConfigurationPath === undefined) return config
  if (!isAbsolute(config.environmentConfigurationPath)) throw new Error('environmentConfigurationPath must be absolute')
  validateSecurityEnvironments(config.environments)
  const configured = readSecurityEnvironments(config.environmentConfigurationPath)
  const environments = new Map(config.environments.map(environment => [environment.id, environment]))
  for (const environment of configured.environments) environments.set(environment.id, environment)
  if (configured.defaultEnvironmentIds && !config.taskIntake)
    throw new Error('Default environments require taskIntake in the workbench configuration')
  const taskIntake = configured.defaultEnvironmentIds && config.taskIntake
    ? { ...config.taskIntake, defaultEnvironmentIds: configured.defaultEnvironmentIds } : config.taskIntake
  for (const id of taskIntake?.defaultEnvironmentIds ?? []) {
    if (!environments.has(id)) throw new Error('Unknown default security environment: ' + id)
  }
  return { ...config, environments: [...environments.values()], taskIntake }
}
