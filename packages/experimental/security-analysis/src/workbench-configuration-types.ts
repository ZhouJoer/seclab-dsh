/** Browser-safe configuration returned by the security workbench. @module */
import type { TaskContext } from './task-context.ts'
import type { ModuleSelection } from './analysis-modules.ts'

/** Complete operator settings copied into a task at first send. */
export interface FirstMessageSettings {
  environmentIds: string[]
  maxAttempts: number
  taskContext?: TaskContext | undefined
  unsealed?: boolean | undefined
  moduleSelection?: ModuleSelection | undefined
}

/** Resolved workspace resources and available security capabilities. */
export interface WorkbenchConfiguration {
  workspace: {
    cwd: string
    revision: number
    configured: boolean
    environmentIds: string[]
    maxAttempts?: number
    taskContext?: TaskContext | undefined
    unsealed?: boolean | undefined
    moduleSelection?: ModuleSelection | undefined
  } | null
  /** Saved configuration for this conversation before its first project association. */
  startup?: { revision: number; settings?: FirstMessageSettings | undefined }
  materialLimits: { bytes: number; entries: number }
  taskContextMaxBytes: number
  selectedProject?: string
  projects: { id: string; title: string }[]
  environments: { id: string; kind: 'local' | 'docker' | 'android'; label: string; tools: string[] }[]
  providers: { id: string; operations: readonly string[] }[]
  knowledgeIntervalMs: number
}
