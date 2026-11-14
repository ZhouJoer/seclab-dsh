/** Revision-checked publication of verified tools into project selections. @module */
import { readFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { LocalToolConfiguration } from './tool-configuration.ts'
import { readSecurityEnvironments, validateSecurityEnvironments } from './security-environment-config.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'
import type { ToolInstallationExecutionResult, ToolInstallationPlan } from './tool-installation-types.ts'
import { ToolInstallationError } from './tool-installation-types.ts'
import { readToolSettings } from './local-tools.ts'

const revisionSchema = z.tuple([z.string(), z.string().nullable()])
async function contents(path: string | undefined): Promise<string | null> {
  if (!path) return null
  try { return await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
function deployment(environment: SecurityEnvironment): SecurityEnvironment {
  const { containerId: _containerId, resolvedImageId: _resolvedImageId, exchangeRoot: _exchangeRoot,
    webTarget: _webTarget, manifest: _manifest, ...result } = environment
  return result
}

/** Project configuration owner used by both the workbench and operator CLI. */
export class ToolInstallationSelections {
  private environmentContents: string | null = null
  /**
   * @param tools - shared project installation settings.
   * @param environments - live execution environments.
   * @param environmentPath - optional persisted deployment declarations.
   * @param stop - release an existing owned container before switching its verified image.
   */
  constructor(private readonly tools: LocalToolConfiguration, private readonly environments: SecurityEnvironment[],
    private readonly environmentPath: string | undefined, private readonly stop: (environment: SecurityEnvironment) => Promise<void>) {
    if (environmentPath) try { this.environmentContents = readFileSync(environmentPath, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /** Capture configuration independently of cached inventory and runtime observations.
   * @param environmentId - selected execution world.
   * @returns detached environment and revision of both project selection files.
   */
  async snapshot(environmentId: string): Promise<{ environment: SecurityEnvironment; configurationRevision: string }> {
    this.tools.refresh()
    const configuration = await contents(this.environmentPath)
    if (configuration !== this.environmentContents)
      throw new ToolInstallationError('configuration-conflict', 'Environment configuration changed; reload the Host before planning another installation.')
    const environment = this.environments.find(item => item.id === environmentId)
    if (!environment) throw new ToolInstallationError('invalid-request', 'Unknown installation environment')
    return { environment: structuredClone(environment),
      configurationRevision: JSON.stringify([this.tools.revision(), configuration]) }
  }

  /** Publish selections only while both project configuration writers are excluded.
   * @param plan - immutable reviewed configuration revision.
   * @param result - verified installations or image.
   * @returns completion after durable selection; conflicts preserve the verified installation.
   */
  async commit(plan: ToolInstallationPlan, result: ToolInstallationExecutionResult): Promise<void> {
    const [expectedTools, expectedEnvironments] = revisionSchema.parse(JSON.parse(plan.configurationRevision))
    const publish = async () => {
      if (result.environment && this.environmentPath) {
        const selected = readSecurityEnvironments(this.environmentPath).environments.find(item => item.id === plan.environment.id)
        if (selected && isDeepStrictEqual(selected, deployment(result.environment))) return
      }
      if (await contents(this.environmentPath) !== expectedEnvironments)
        throw new ToolInstallationError('configuration-conflict', 'Environment configuration changed during installation; the verified installation was not selected.')
      if (!result.environment) {
        if (Object.keys(result.pins).length) await this.tools.commitInstallations(result.pins, expectedTools, plan.environment.id)
        else await this.tools.atRevision(expectedTools, async () => {})
        return
      }
      const path = this.environmentPath
      if (!path) throw new ToolInstallationError('configuration-conflict', 'Configure an environment settings file before selecting the verified image.')
      await this.tools.atRevision(expectedTools, async () => {
        const selected = result.environment
        if (!selected || selected.id !== plan.environment.id || selected.externalContainer || selected.kind !== 'docker')
          throw new Error('The recipe returned an unsupported environment selection')
        const environment = this.environments.find(item => item.id === selected.id)
        if (!environment) throw new Error('Selected environment is no longer configured')
        const next = deployment(selected)
        const configuration = readSecurityEnvironments(path)
        configuration.environments = [...configuration.environments.filter(item => item.id !== next.id), next]
        validateSecurityEnvironments(configuration.environments)
        if (environment.containerId) await this.stop(environment)
        const text = JSON.stringify(configuration, null, 2) + '\n'
        await writeFileAtomic(path, text, { mode: 0o600 })
        this.environmentContents = text
        Object.assign(environment, next)
        this.tools.replaceDefaults(environment)
      })
    }
    try {
      if (this.environmentPath) {
        await mkdir(dirname(this.environmentPath), { recursive: true })
        await withFileLock(this.environmentPath, publish)
      } else await publish()
    } catch (error) {
      if (error instanceof ToolInstallationError) throw error
      throw new ToolInstallationError('configuration-conflict', 'The installation was verified but its selection was not committed. ' + String(error), { cause: error })
    }
  }

  /** Check whether a current project selection uses a managed generation.
   * @param location - recorded managed program directory.
   * @param selectionIds - all project configuration files recorded by installation management.
   * @returns true when an executable or launcher argument references the directory.
   */
  async inUse(location: string, selectionIds: readonly string[]): Promise<boolean> {
    this.tools.refresh()
    const within = (path: string) => {
      if (!isAbsolute(path)) return false
      const tail = relative(location, path)
      return tail === '' || tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail)
    }
    if (this.environments.some(environment => environment.tools.some(tool =>
      [tool.command, ...tool.prefixArgs ?? []].some(within)))) return true
    for (const path of selectionIds) {
      if (!isAbsolute(path) || await contents(path) === null) return true
      const selected = readToolSettings(path)
      if (Object.values(selected.installations).some(pins => Object.values(pins).some(pin =>
        [pin.command, ...pin.prefixArgs].some(within)))) return true
    }
    return false
  }

  /** Keep all known selection writers excluded until unused files have been removed.
   * @param location - recorded managed generation.
   * @param selectionIds - complete historical set of project selection files.
   * @param remove - manager-owned removal and ledger publication.
   * @returns removal result after every selection was checked under its writer lock.
   */
  async withUnusedInstallation<T>(location: string, selectionIds: readonly string[], remove: () => Promise<T>): Promise<T> {
    const paths = [...new Set(selectionIds)].sort()
    if (paths.some(path => !isAbsolute(path))) throw new ToolInstallationError('busy', 'A read-only deployment may still use this installation.')
    const visit = async (index: number): Promise<T> => {
      const path = paths[index]
      if (path) return withFileLock(path, () => visit(index + 1))
      if (await this.inUse(location, paths)) throw new ToolInstallationError('busy', 'A project still selects this installation, or its selection cannot be checked.')
      return remove()
    }
    return visit(0)
  }
}
