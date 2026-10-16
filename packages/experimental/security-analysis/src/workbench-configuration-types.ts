/** Browser-safe configuration returned by the security workbench. @module */
import type { TaskContext } from './task-context.ts'

/** Resolved workspace resources and available security capabilities. */
export interface WorkbenchConfiguration {
  workspace: {
    cwd: string
    revision: number
    configured: boolean
    environmentIds: string[]
    maxAttempts?: number
    taskContext?: TaskContext
  } | null
  materialLimits: { bytes: number; entries: number }
  taskContextMaxBytes: number
  selectedProject?: string
  projects: { id: string; title: string }[]
  environments: { id: string; kind: 'local' | 'docker' | 'android'; label: string; tools: string[] }[]
  providers: { id: string; operations: readonly string[] }[]
  knowledgeIntervalMs: number
}
