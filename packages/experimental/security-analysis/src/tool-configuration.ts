/** Operator-owned tool overrides shared with the source CLI. @module */
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, opendir } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { homedir } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { readToolSettings, standaloneTool, type SecurityToolPin, type SecurityToolSettings } from './local-tools.ts'
import { toolboxCatalog } from './toolbox.ts'
import type { ToolDefinition } from './tool-definitions.ts'
import type { ToolboxConfiguration, ToolboxFiles, ToolboxInventory } from './toolbox-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'
import { supportsAdapterEnvironment, toolAdapters, type ToolAdapterDefinition } from './tool-adapter-catalog.ts'

/** Wire input for probing, committing or removing one environment's executable. */
export const toolConfigurationInput = z.union([z.object({
  action: z.enum(['probe', 'save', 'remove']), id: z.string(), revision: z.string(),
  command: z.string().default(''), prefixArgs: z.array(z.string()).default([]), versionArgs: z.array(z.string()).default([]),
  temporaryDirectory: z.string().min(1).optional(),
  defaultEnvironmentId: z.string().min(1).optional(),
}).strict(), z.object({ action: z.literal('bind'), id: z.string(), revision: z.string(),
  defaultEnvironmentId: z.string().min(1) }).strict(),
z.object({ action: z.literal('reset-binding'), id: z.string(), revision: z.string() }).strict()])

/** Live configuration changes apply only after an atomic file commit. */
export class LocalToolConfiguration {
  private readonly defaults: Map<string, SecurityEnvironment['tools']>
  constructor(readonly path: string | undefined, readonly environment: SecurityEnvironment | undefined,
    private readonly catalog: () => readonly ToolDefinition[] = () => toolboxCatalog,
    private readonly environments: readonly SecurityEnvironment[] = environment ? [environment] : [],
    private readonly defaultBindings: Readonly<Record<string, string>> = {}) {
    if (path !== undefined && !isAbsolute(path)) throw new Error('Tool configuration file must be absolute')
    if (path !== undefined && environment?.kind !== 'local') throw new Error('Tool configuration requires a local environment')
    this.defaults = new Map(environments.map(item => [item.id, structuredClone(item.tools)]))
    this.refresh()
  }
  /** Reload edits without retaining removed overrides.
   * @returns the applied installation map. */
  refresh(): Record<string, SecurityToolPin> {
    const document = this.document()
    this.apply(document)
    return document.installations[this.environment?.id ?? 'local'] ?? {}
  }
  /** Capture the complete project installation revision without selecting an environment.
   * @returns revision used by installation preview and commit.
   */
  revision(): string { return revision(this.document()) }

  /** Apply a verified deployment image's tool defaults after its configuration commit.
   * @param environment - existing environment with its new verified deployment tools.
   */
  replaceDefaults(environment: SecurityEnvironment): void {
    this.defaults.set(environment.id, structuredClone(environment.tools))
    this.refresh()
  }

  /** Hold the project writer lock while publishing a related environment selection.
   * @param expectedRevision - project installation revision captured by the plan.
   * @param publish - environment commit performed while installation writers are excluded.
   * @returns publication result.
   */
  async atRevision<T>(expectedRevision: string, publish: () => Promise<T>): Promise<T> {
    const check = async () => {
      if (this.revision() !== expectedRevision) throw new Error('Tool configuration changed; reload before saving')
      return publish()
    }
    if (!this.path) return check()
    await mkdir(dirname(this.path), { recursive: true })
    return withFileLock(this.path, check)
  }
  private apply(document: SecurityToolSettings): void {
    for (const environment of this.environments) {
      const tools = new Map(this.defaults.get(environment.id)?.map(tool => [tool.id, tool]))
      for (const [id, pin] of Object.entries(document.installations[environment.id] ?? {}))
        tools.set(id, { id, ...pin, source: 'Operator tool configuration' })
      environment.tools = [...tools.values()]
    }
  }
  private document(): SecurityToolSettings {
    const document: SecurityToolSettings = this.path === undefined ? { version: 1, installations: {}, bindings: {} }
      : readToolSettings(this.path, this.environment?.id ?? 'local', this.catalog())
    for (const [environmentId, pins] of Object.entries(document.installations)) {
      const environment = this.editableEnvironment(environmentId)
      for (const [id, pin] of Object.entries(pins)) {
        if (environment.kind === 'local' && !isAbsolute(pin.command)) throw new Error(`${id}: choose an absolute executable path`)
        if (pin.command.includes('\0')) throw new Error(`${id}: executable contains a null character`)
        if (pin.temporaryDirectory && (environment.kind !== 'local' || !isAbsolute(pin.temporaryDirectory)))
          throw new Error(`${id}: private temporary directories require an absolute local path`)
      }
    }
    for (const [id, environmentId] of Object.entries({ ...this.defaultBindings, ...document.bindings })) {
      const adapter = toolAdapters.find(adapter => adapter.id === id)
      if (adapter) this.adapterEnvironment(adapter, environmentId)
      else { standaloneTool(id, this.catalog()); this.editableEnvironment(environmentId) }
    }
    return document
  }
  /** Save unique measured local installations without selecting adapters or replacing pins.
   * @param inventory - completed version probes in one environment.
   * @param expectedRevision - configuration captured before probing.
   * @returns whether any installations were saved.
   */
  async reconcile(inventory: ToolboxInventory, expectedRevision: string): Promise<boolean> {
    if (this.path === undefined || inventory.kind !== 'local') return false
    return this.mutate(expectedRevision, (document) => {
      const pins = document.installations[inventory.environmentId] ?? {}
      let changed = false
      for (const row of inventory.tools) {
        const definition = this.catalog().find(item => item.id === row.id)
        if (!definition || definition.dependency || definition.provider || !definition.commands.length
        || this.defaults.get(inventory.environmentId)?.some(item => item.id === row.id)
        || pins[row.id] || row.status !== 'available' || row.candidates || !isAbsolute(row.command)) continue
        pins[row.id] = { command: row.command, prefixArgs: row.prefixArgs ?? [], versionArgs: definition.args }
        changed = true
      }
      if (changed) {
        document.installations[inventory.environmentId] = pins
      }
      return changed
    })
  }
  /** Require an environment supporting managed adapter execution.
   * @param id - configured environment identity.
   * @returns the live manager-owned environment.
   */
  editableEnvironment(id: string): SecurityEnvironment {
    const environment = this.environments.find(item => item.id === id)
    if (!environment || environment.kind === 'android' || environment.externalContainer)
      throw new Error('Tool settings require a local or managed Docker environment: ' + id)
    return environment
  }
  private adapterEnvironment(adapter: ToolAdapterDefinition, id: string): SecurityEnvironment {
    const environment = this.environments.find(item => item.id === id)
    if (!environment || !supportsAdapterEnvironment(adapter, environment))
      throw new Error('Unsupported execution environment for ' + adapter.id + ': ' + id)
    return environment
  }
  /** Resolve an explicit binding or the task's unique compatible environment, without availability fallback.
   * @param tool - catalog identity.
   * @param environmentIds - environments already authorized by the task.
   * @param requestedEnvironmentId - single-call selection; omission inherits a binding or unique candidate. Cannot override a binding.
   * @returns configured environment identity.
   */
  route(tool: string, environmentIds: readonly string[] = [], requestedEnvironmentId?: string): string {
    const adapter = toolAdapters.find(adapter => adapter.id === tool)
    if (!adapter) throw new Error('Unknown tool adapter: ' + tool)
    const document = this.document()
    this.apply(document)
    const binding = document.bindings[adapter.bindingId] ?? this.defaultBindings[adapter.bindingId]
    const candidates = this.environments.filter(item => environmentIds.includes(item.id) && supportsAdapterEnvironment(adapter, item))
    if (requestedEnvironmentId && binding && requestedEnvironmentId !== binding)
      throw new Error('Requested environment conflicts with the fixed binding for ' + adapter.bindingId + ': ' + binding)
    if (requestedEnvironmentId && !environmentIds.includes(requestedEnvironmentId))
      throw new Error('Requested environment is outside the task environments: ' + requestedEnvironmentId)
    const id = binding ?? requestedEnvironmentId ?? (candidates.length === 1 ? candidates[0]?.id : undefined)
    if (!id) throw new Error('Configure a default execution environment for ' + adapter.bindingId
      + '; the task must authorize exactly one compatible environment to inherit it. Do not retry until configuration changes.')
    if (environmentIds.length && !environmentIds.includes(id))
      throw new Error('Adapter binding is outside the task environments: ' + id)
    const environment = this.adapterEnvironment(adapter, id)
    if (adapter.requiresDevice && !environment.deviceId) throw new Error('Configure a deviceId in environment ' + id)
    const missing = adapter.installationIds.filter(dependency => !environment.tools.some(tool => tool.id === dependency))
    if (missing.length) throw new Error('Configure an installation for ' + missing.join(', ') + ' in ' + id
      + '. Open Toolbox once to configure these dependencies; do not retry until configuration changes.')
    return environment.id
  }
  /** Read the current editable installation configuration.
   * @param environmentId - selected local or managed Docker environment.
   * @returns configured values and a revision for operator edits. */
  read(environmentId = this.environment?.id ?? ''): ToolboxConfiguration {
    const document = this.document()
    this.apply(document)
    const environment = this.editableEnvironment(environmentId)
    const pins = document.installations[environmentId] ?? {}
    const toolboxCatalog = this.catalog()
    const ids = new Set([...toolboxCatalog.filter(tool => tool.commands.length).map(tool => tool.id),
      ...environment.tools.map(tool => tool.id)])
    const bindings = { ...this.defaultBindings, ...document.bindings }
    return { editable: this.path !== undefined, revision: revision(document),
      environmentKind: environment.kind,
      environments: this.environments.filter(item => !item.externalContainer)
        .map(({ id, label, kind }) => ({ id, label, kind })),
      bindings, adapters: toolAdapters.map((adapter) => {
        const environmentId = bindings[adapter.bindingId]
        const target = this.environments.find(item => item.id === environmentId)
        const installed = target && adapter.installationIds.every(id => target.tools.some(tool => tool.id === id))
        const device = !adapter.requiresDevice || !!target?.deviceId
        return { id: adapter.id, toolName: adapter.toolName, provider: adapter.provider,
          operations: [...adapter.operations], bindingId: adapter.bindingId,
          ...(adapter.installationIds.length === 1 ? { installationId: adapter.installationIds[0] } : {}),
          dependencies: adapter.probeIds.filter(id => id !== adapter.id),
          environmentIds: this.environments.filter(item => supportsAdapterEnvironment(adapter, item)).map(item => item.id),
          ...(environmentId ? { environmentId } : {}),
          bindingSource: Object.hasOwn(document.bindings, adapter.bindingId) ? 'operator' : environmentId ? 'deployment' : 'none',
          status: !environmentId || installed && device ? 'unchecked' : 'unconfigured',
          ...(!device && environmentId ? { prerequisite: 'device' as const } : {}) }
      }), tools: [...ids].filter(id =>
        !toolboxCatalog.some(tool => tool.id === id && !tool.commands.length)).map((id) => {
        const tool = environment.tools.find(tool => tool.id === id)
        return { id, command: tool?.command ?? '', prefixArgs: tool?.prefixArgs ?? [],
          ...(tool?.temporaryDirectory ? { temporaryDirectory: tool.temporaryDirectory } : {}),
          versionArgs: tool?.versionArgs ?? standaloneTool(id, toolboxCatalog).args, saved: Object.hasOwn(pins, id) }
      }) }
  }
  /** Commit a checked executable or remove its override after checking the observed file revision.
   * @param id - installation identity.
   * @param pin - verified executable; undefined restores deployment defaults.
   * @param expectedRevision - revision shown by the editing form.
   * @param environmentId - installation's configured environment.
   * @param defaultEnvironmentId - optional fixed execution binding for the tool.
   * @returns committed configuration, already applied to subsequent operations.
   */
  async commit(id: string, pin: SecurityToolPin | undefined, expectedRevision: string,
    environmentId = this.environment?.id ?? '', defaultEnvironmentId?: string): Promise<ToolboxConfiguration> {
    if (this.path === undefined) throw new Error('Tool configuration is read-only')
    standaloneTool(id, this.catalog())
    const environment = this.editableEnvironment(environmentId)
    if (pin && (pin.command.includes('\0') || !pin.command.trim() || !pin.versionArgs.length
      || (environment.kind === 'local' && !isAbsolute(pin.command))
      || (pin.temporaryDirectory !== undefined && (environment.kind !== 'local' || !isAbsolute(pin.temporaryDirectory) || pin.temporaryDirectory.includes('\0')))))
      throw new Error('Invalid executable installation for ' + id)
    await this.mutate(expectedRevision, (document) => {
      const pins = document.installations[environmentId] ?? {}
      if (pin) pins[id] = pin
      else Reflect.deleteProperty(pins, id)
      document.installations[environmentId] = pins
      if (defaultEnvironmentId !== undefined) {
        this.editableEnvironment(defaultEnvironmentId)
        document.bindings[id] = defaultEnvironmentId
      }
    })
    return this.read(environmentId)
  }

  /** Save or reset an adapter route without probing or changing installations.
   * @param id - Independent adapter installation identity.
   * @param target - Selected environment; undefined removes the operator override.
   * @param expectedRevision - Last observed configuration revision.
   * @param environmentId - Environment whose installation view is returned.
   * @returns committed settings for subsequent calls.
   */
  async bind(id: string, target: string | undefined, expectedRevision: string, environmentId: string): Promise<ToolboxConfiguration> {
    if (this.path === undefined) throw new Error('Tool configuration is read-only')
    const adapter = toolAdapters.find(adapter => adapter.id === id)
    if (!adapter) throw new Error('Unknown tool adapter: ' + id)
    if (adapter.bindingId !== id) throw new Error('Configure the ' + adapter.bindingId + ' binding for ' + id)
    this.editableEnvironment(environmentId)
    if (target !== undefined) this.adapterEnvironment(adapter, target)
    await this.mutate(expectedRevision, (document) => {
      if (target === undefined) Reflect.deleteProperty(document.bindings, id)
      else document.bindings[id] = target
    })
    return this.read(environmentId)
  }

  /** Commit all verified installations together without changing adapter bindings.
   * @param pins - installations verified by the reviewed recipe.
   * @param expectedRevision - configuration observed before installation.
   * @param environmentId - environment receiving the installations.
   * @returns committed configuration for subsequent analysis.
   */
  async commitInstallations(pins: Record<string, SecurityToolPin>, expectedRevision: string,
    environmentId: string): Promise<ToolboxConfiguration> {
    const environment = this.editableEnvironment(environmentId)
    for (const [id, pin] of Object.entries(pins)) {
      standaloneTool(id, this.catalog())
      if (!pin.command.trim() || pin.command.includes('\0') || !pin.versionArgs.length
        || environment.kind === 'local' && !isAbsolute(pin.command)
        || pin.temporaryDirectory !== undefined && (environment.kind !== 'local' || !isAbsolute(pin.temporaryDirectory) || pin.temporaryDirectory.includes('\0')))
        throw new Error('Invalid executable installation for ' + id)
    }
    await this.mutate(expectedRevision, (document) => {
      document.installations[environmentId] = { ...document.installations[environmentId], ...pins }
    }, document => Object.entries(pins).every(([id, pin]) => isDeepStrictEqual(document.installations[environmentId]?.[id], pin)))
    return this.read(environmentId)
  }

  private async mutate<T>(expectedRevision: string, change: (document: SecurityToolSettings) => T,
    alreadyApplied?: (document: SecurityToolSettings) => boolean): Promise<T> {
    const path = this.path
    if (path === undefined) throw new Error('Tool configuration is read-only')
    await mkdir(dirname(path), { recursive: true })
    return withFileLock(path, async () => {
      const document = this.document()
      if (revision(document) !== expectedRevision && !alreadyApplied?.(document)) throw new Error('Tool configuration changed; reload before saving')
      const result = change(document)
      await writeFileAtomic(path, JSON.stringify(document, null, 2) + '\n', { mode: 0o600 })
      this.apply(document)
      return result
    })
  }
}
function revision(pins: SecurityToolSettings): string {
  return createHash('sha256').update(JSON.stringify(pins)).digest('hex')
}

/** Browse Host paths selected by an authenticated operator, without uploading tool binaries.
 * @param directory - absolute Host directory.
 * @param limit - maximum entries returned to the browser.
 * @returns directories and files, parent navigation and available roots.
 */
export async function browseToolFiles(directory: string, limit: number): Promise<ToolboxFiles> {
  if (!isAbsolute(directory)) throw new Error('Select an absolute Host directory')
  const roots = process.platform === 'win32'
    ? Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index) + ':\\').filter(existsSync)
    : ['/']
  const entries: ToolboxFiles['entries'] = []
  let truncated = false
  for await (const entry of await opendir(directory)) {
    if (!entry.isDirectory() && !entry.isFile()) continue
    if (entries.length >= limit) { truncated = true; break }
    entries.push({ name: entry.name, path: join(directory, entry.name), directory: entry.isDirectory() })
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  return { directory, parent: dirname(directory), roots: [...new Set([homedir(), parse(directory).root, ...roots])], entries, truncated }
}
