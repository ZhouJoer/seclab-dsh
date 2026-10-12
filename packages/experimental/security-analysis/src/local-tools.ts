/** Shared local executable configuration for the operator UI and source CLI. @module */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { builtinToolPack } from './builtin-tools.ts'
import { parseToolDefinition, type ToolDefinition } from './tool-definitions.ts'
const toolboxCatalog = builtinToolPack.tools

/** An executable and its read-only version query. */
export interface SecurityToolPin {
  command: string
  prefixArgs: string[]
  versionArgs: string[]
}

const settingsSchema = z.object({ version: z.literal(1),
  installations: z.record(z.string().min(1), z.record(z.string(), z.object({
    command: z.string().min(1), prefixArgs: z.array(z.string()), versionArgs: z.array(z.string()).min(1),
  }).strict())), bindings: z.record(z.string(), z.string().min(1)),
}).strict()
/** Environment-specific installations and operator-selected adapter routes. */
export type SecurityToolSettings = z.infer<typeof settingsSchema>

/** Read a versioned settings document or the legacy local installation map.
 * @param path - operator-owned JSON file.
 * @param legacyEnvironment - environment owning legacy local pins.
 * @param catalog - current tool definitions.
 * @returns normalized settings; missing files contribute no overrides.
 */
export function readToolSettings(path: string, legacyEnvironment = 'local',
  catalog: readonly ToolDefinition[] = toolboxCatalog): SecurityToolSettings {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, installations: {}, bindings: {} }
    throw error
  }
  const data: unknown = JSON.parse(text)
  if (data && typeof data === 'object' && 'version' in data) {
    const settings = settingsSchema.parse(data)
    for (const pins of Object.values(settings.installations)) for (const id of Object.keys(pins)) standaloneTool(id, catalog)
    return settings
  }
  return { version: 1, installations: { [legacyEnvironment]: parseLocalPins(data, path, catalog) }, bindings: {} }
}

/** Resolve built-in metadata or conventional defaults for a custom executable.
 * @param id - tool identifier; dependent tools require their parent runtime instead.
 * @param catalog - current definitions; built-ins when omitted.
 * @returns discovery names and version arguments.
 */
export function standaloneTool(id: string, catalog: readonly ToolDefinition[] = toolboxCatalog): ToolDefinition {
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid tool ID: ${id}; use lowercase letters, digits, hyphens or underscores`)
  const tool = catalog.find(tool => tool.id === id)
  if (tool && (tool.dependency || tool.invocation === 'provider' || !tool.commands.length)) throw new Error(`${id}: configure its parent runtime or provider instead`)
  return tool ?? parseToolDefinition({ id, label: id, commands: [id] })
}

/** Read validated installations without treating malformed files as empty.
 * @param path - JSON file mapping tool IDs to absolute paths or installation objects.
 * @param catalog - current definitions for default version arguments.
 * @returns saved installations, or an empty map when the file does not exist.
 */
export function readSecurityTools(path: string, catalog: readonly ToolDefinition[] = toolboxCatalog): Record<string, SecurityToolPin> {
  return parseLocalPins(readToolSettings(path, 'local', catalog).installations.local ?? {}, path, catalog)
}
function parseLocalPins(data: unknown, path: string, catalog: readonly ToolDefinition[]): Record<string, SecurityToolPin> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path}: expected a tool-to-installation JSON object`)
  const pins: Record<string, SecurityToolPin> = {}
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    const tool = standaloneTool(id, catalog)
    let command: unknown = value
    let versionArgs: unknown = tool.args
    let prefixArgs: unknown = []
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      command = 'command' in value ? value.command : undefined
      prefixArgs = 'prefixArgs' in value ? value.prefixArgs : []
      versionArgs = 'versionArgs' in value ? value.versionArgs : tool.args
    }
    if (typeof command !== 'string' || !isAbsolute(command)) throw new Error(`${path}: ${id} needs an absolute executable path`)
    if (!Array.isArray(versionArgs) || !versionArgs.length || !versionArgs.every((arg: unknown) => typeof arg === 'string'))
      throw new Error(`${path}: ${id} needs a nonempty versionArgs string array`)
    if (!Array.isArray(prefixArgs) || !prefixArgs.every((arg: unknown) => typeof arg === 'string'))
      throw new Error(`${path}: ${id} needs a prefixArgs string array`)
    pins[id] = { command, prefixArgs, versionArgs }
  }
  return pins
}

/** Replace one local configuration file atomically.
 * @param path - destination file, whose parent is created if needed.
 * @param contents - complete UTF-8 content.
 */
export function writeSecurityToolsFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
