/** Structured installation diagnostics shared by the toolbox and CLI. @module */
import type { ToolDefinition } from './tool-definitions.ts'
import type { ToolboxEnvironment, ToolboxTool } from './toolbox-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'

/** Describe environment actions without acquiring a runtime or changing its state.
 * @param environment - configured execution world.
 * @returns ownership and supported operator actions.
 */
export function toolboxEnvironment(environment: SecurityEnvironment): ToolboxEnvironment {
  const management = environment.externalContainer ? 'external-container'
    : environment.kind === 'docker' ? 'managed-container' : environment.kind === 'android' ? 'device' : 'local'
  return { id: environment.id, label: environment.label, kind: environment.kind, management,
    actions: management === 'managed-container' ? ['inspect', 'start', 'stop', 'install']
      : management === 'device' ? ['inspect'] : ['inspect', 'install'] }
}

/** Attach prerequisite observations while retaining the original probe diagnostics.
 * @param row - measured or unchecked installation.
 * @param definition - version requirements and integration declaration.
 * @returns the row with structured checks; incompatible versions cannot be available.
 */
export function toolHealth(row: ToolboxTool, definition: ToolDefinition): ToolboxTool {
  const checks: NonNullable<ToolboxTool['checks']> = [{ kind: 'installation',
    status: row.status === 'available' ? 'passed' : row.status === 'not-checked' ? 'unknown' : 'failed',
    code: row.reason ?? (row.status === 'available' ? 'detected' : 'unchecked'), detail: row.detail }]
  const requirement = definition.compatibility
  if (row.status === 'available' && requirement) {
    const match = /(?:^|\s|["v])(\d+)\.(\d+)(?:\.\d+)?/u.exec(row.version)
    const major = match ? Number(match[1]) : undefined
    const compatible = major !== undefined && (requirement.minimumMajor === undefined || major >= requirement.minimumMajor)
      && (requirement.maximumMajor === undefined || major <= requirement.maximumMajor)
    checks.push({ kind: 'compatibility', status: major === undefined ? 'unknown' : compatible ? 'passed' : 'failed',
      code: major === undefined ? 'version-unresolved' : compatible ? 'compatible' : 'incompatible-version',
      detail: row.version })
    if (!compatible) {
      row = { ...row, status: 'error', reason: 'incompatible-version',
        detail: major === undefined ? 'Cannot establish the required tool version; select a supported installation.'
          : 'Tool version is outside the declared supported range; select a compatible installation.' }
    }
  } else checks.push({ kind: 'compatibility', status: requirement ? 'unknown' : 'not-required',
    code: requirement ? 'installation-required' : 'no-version-constraint', detail: '' })
  checks.push({ kind: 'connection', status: definition.provider ? 'unknown' : 'not-required',
    code: definition.provider ? 'connection-not-checked' : 'local-command', detail: '' },
  { kind: 'target', status: 'unknown', code: 'target-not-checked', detail: '' })
  return { ...row, checks }
}
