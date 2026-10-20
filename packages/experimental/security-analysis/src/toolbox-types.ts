/** Browser-safe tool inventory observations. @module */

/** A measured installation, independent of project execution authority. */
export interface ToolboxTool {
  id: string
  category: 'runtime' | 'reverse' | 'device' | 'web' | 'utility' | 'custom'
  status: 'available' | 'missing' | 'error' | 'not-checked'
  command: string
  /** Fixed launcher arguments to prepend when invoking the reported command. */
  prefixArgs?: string[]
  /** Executable inside a non-Host environment, suitable for saving its installation configuration. */
  installation?: { command: string; prefixArgs: string[] }
  version: string
  location: string
  /** Measured Python environment reported by the interpreter identity probe. */
  python?: { prefix: string; basePrefix: string; virtualEnvironment: boolean; pipAvailable: boolean }
  /** Multiple verified installations require an explicit operator choice. */
  candidates?: string[]
  source: string
  dependency?: string
  detail: string
  installUrl: string
  invocation: 'shell' | 'plugin' | 'python' | 'provider'
  /** Dedicated provider integration; readiness and plan authority are checked separately. */
  provider?: string
}

/** Current runtime health and separately measured optional installations. */
export interface ToolboxInventory {
  environmentId: string
  kind: 'local' | 'docker' | 'android'
  runtime: 'ready' | 'stopped' | 'unavailable' | 'unchecked'
  detail: string
  checkedAt: number
  containerId?: string
  workdir: string
  tools: ToolboxTool[]
}

/** Operator directory available without a conversation or project selection. */
export interface ToolboxDirectory {
  environments: { id: string; label: string; kind: ToolboxInventory['kind'] }[]
  inventory: ToolboxInventory
}

/** Editable local installation values; saved distinguishes overrides from deployment defaults. */
export interface ToolboxInstallation {
  id: string
  command: string
  prefixArgs: string[]
  versionArgs: string[]
  saved: boolean
}
/** Dedicated model interface and installation health in its selected environment. */
export interface ToolboxAdapter {
  id: string
  toolName: string
  operations: string[]
  /** Executable installation, absent for service-backed adapters. */
  installationId?: string
  /** Provider implementation required by this interface. */
  provider?: string
  /** Shared or independent route key in the operator bindings. */
  bindingId?: string
  /** Configured environments supported by this adapter. */
  environmentIds?: string[]
  /** Additional setup not established by an executable version check. */
  prerequisite?: 'device' | 'provider'
  dependencies: string[]
  environmentId?: string
  bindingSource: 'operator' | 'deployment' | 'none'
  status: 'unconfigured' | 'unchecked' | 'unavailable' | 'ready'
}
/** Operator configuration and revision used to reject stale saves. */
export interface ToolboxConfiguration {
  editable: boolean
  revision: string
  tools: ToolboxInstallation[]
  /** Installation paths are interpreted in this execution world. */
  environmentKind?: ToolboxInventory['kind']
  /** Environments available for operator-selected adapter routes. */
  environments?: { id: string; label: string; kind: ToolboxInventory['kind'] }[]
  /** Tool identities mapped to their selected execution environment. */
  bindings?: Record<string, string>
  /** Dedicated interfaces and health in their configured execution environments. */
  adapters?: ToolboxAdapter[]
}
/** One bounded version query and its optional configuration commit. */
export interface ToolboxConfigurationResult {
  saved: boolean
  tool: ToolboxTool | null
  configuration: ToolboxConfiguration
}
/** Host file choices for an authenticated operator selecting a tool. */
export interface ToolboxFiles {
  directory: string
  parent: string
  roots: string[]
  entries: { name: string; path: string; directory: boolean }[]
  truncated: boolean
}
