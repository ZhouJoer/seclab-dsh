/** Operator-owned tool overrides shared with the source CLI. @module */
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { existsSync } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { z } from 'zod'
import { readToolSettings, standaloneTool, writeSecurityToolsFile, type SecurityToolPin, type SecurityToolSettings } from './local-tools.ts'
import { toolboxCatalog } from './toolbox.ts'
import type { ToolDefinition } from './tool-definitions.ts'
import type { ToolboxConfiguration, ToolboxFiles } from './toolbox-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'

/** Wire input for probing, committing or removing one environment's executable. */
export const toolConfigurationInput = z.object({
  action: z.enum(['probe', 'save', 'remove']), id: z.string(), revision: z.string(),
  command: z.string().default(''), prefixArgs: z.array(z.string()).default([]), versionArgs: z.array(z.string()).default([]),
  defaultEnvironmentId: z.string().min(1).optional(),
}).strict()

/** Live configuration changes apply only after an atomic file commit. */
export class LocalToolConfiguration {
  private readonly defaults: Map<string, SecurityEnvironment['tools']>
  constructor(readonly path: string, readonly environment: SecurityEnvironment,
    private readonly catalog: () => readonly ToolDefinition[] = () => toolboxCatalog,
    private readonly environments: readonly SecurityEnvironment[] = [environment],
    private readonly defaultBindings: Readonly<Record<string, string>> = {}) {
    if (!isAbsolute(path)) throw new Error('Tool configuration file must be absolute')
    if (environment.kind !== 'local') throw new Error('Tool configuration requires a local environment')
    this.defaults = new Map(environments.map(item => [item.id, structuredClone(item.tools)]))
    this.refresh()
  }
  /** Reload edits without retaining removed overrides.
   * @returns the applied installation map. */
  refresh(): Record<string, SecurityToolPin> {
    const document = this.document()
    for (const environment of this.environments) {
      const tools = new Map(this.defaults.get(environment.id)?.map(tool => [tool.id, tool]))
      for (const [id, pin] of Object.entries(document.installations[environment.id] ?? {}))
        tools.set(id, { id, ...pin, source: 'Operator tool configuration' })
      environment.tools = [...tools.values()]
    }
    return document.installations[this.environment.id] ?? {}
  }
  private document(): SecurityToolSettings {
    const document = readToolSettings(this.path, this.environment.id, this.catalog())
    for (const [environmentId, pins] of Object.entries(document.installations)) {
      const environment = this.editableEnvironment(environmentId)
      for (const [id, pin] of Object.entries(pins)) {
        if (environment.kind === 'local' && !isAbsolute(pin.command)) throw new Error(`${id}: choose an absolute executable path`)
        if (pin.command.includes('\0')) throw new Error(`${id}: executable contains a null character`)
      }
    }
    for (const [id, environmentId] of Object.entries({ ...this.defaultBindings, ...document.bindings })) {
      standaloneTool(id, this.catalog())
      this.editableEnvironment(environmentId)
    }
    return document
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
  /** Resolve the exact operator-selected environment without availability fallback.
   * @param tool - catalog identity.
   * @returns configured environment identity.
   */
  route(tool: string): string {
    const id = tool === 'r2ghidra' ? 'radare2' : tool
    const document = this.document()
    const environment = document.bindings[id] ?? this.defaultBindings[id]
    if (!environment) throw new Error('Configure a default execution environment for ' + id)
    return this.editableEnvironment(environment).id
  }
  /** Read the current editable installation configuration.
   * @param environmentId - selected local or managed Docker environment.
   * @returns configured values and a revision for operator edits. */
  read(environmentId = this.environment.id): ToolboxConfiguration {
    this.refresh()
    const document = this.document()
    const environment = this.editableEnvironment(environmentId)
    const pins = document.installations[environmentId] ?? {}
    const toolboxCatalog = this.catalog()
    const ids = new Set([...toolboxCatalog.filter(tool => tool.commands.length).map(tool => tool.id),
      ...environment.tools.map(tool => tool.id)])
    return { editable: true, revision: revision(document),
      environmentKind: environment.kind,
      environments: this.environments.filter(item => item.kind === 'local' || (item.kind === 'docker' && !item.externalContainer))
        .map(({ id, label, kind }) => ({ id, label, kind })),
      bindings: { ...this.defaultBindings, ...document.bindings }, tools: [...ids].filter(id =>
        !toolboxCatalog.some(tool => tool.id === id && !tool.commands.length)).map((id) => {
        const tool = environment.tools.find(tool => tool.id === id)
        return { id, command: tool?.command ?? '', prefixArgs: tool?.prefixArgs ?? [],
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
  commit(id: string, pin: SecurityToolPin | undefined, expectedRevision: string,
    environmentId = this.environment.id, defaultEnvironmentId?: string): ToolboxConfiguration {
    standaloneTool(id, this.catalog())
    const environment = this.editableEnvironment(environmentId)
    if (pin && (pin.command.includes('\0') || !pin.command.trim() || !pin.versionArgs.length
      || (environment.kind === 'local' && !isAbsolute(pin.command))))
      throw new Error('Invalid executable installation for ' + id)
    const document = this.document()
    if (revision(document) !== expectedRevision) throw new Error('Tool configuration changed; reload before saving')
    const pins = document.installations[environmentId] ?? {}
    if (pin) pins[id] = pin
    else Reflect.deleteProperty(pins, id)
    document.installations[environmentId] = pins
    if (defaultEnvironmentId !== undefined) {
      this.editableEnvironment(defaultEnvironmentId)
      document.bindings[id] = defaultEnvironmentId
    }
    writeSecurityToolsFile(this.path, JSON.stringify(document, null, 2) + '\n')
    return this.read(environmentId)
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
