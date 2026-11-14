/** Deployment limits shared by Host and operator installation commands. @module */
import Schema from '@deepseek-ai/schemastery'
import type { ToolInstallationExecutorBounds } from './tool-installation-artifacts.ts'

/** Acquisition, execution and retained progress limits. */
export interface ToolInstallationConfig extends ToolInstallationExecutorBounds {
  /** Maximum total UTF-8 bytes retained in one operation's progress log. */
  maxLogBytes: number
  /** Maximum retained progress chunks per installation operation. */
  maxLogChunks: number
}
/** Validated installation limits; command-line and Host composition share these defaults. */
export const toolInstallationConfig: Schema<ToolInstallationConfig> = Schema.object({
  downloadTimeoutMs: Schema.number().step(1).min(1).max(2147483647).default(900000),
  maxDownloadBytes: Schema.number().step(1).min(1).default(2147483648),
  maxExtractedBytes: Schema.number().step(1).min(1).default(8589934592),
  maxArchiveEntries: Schema.number().step(1).min(1).default(100000),
  processTimeoutMs: Schema.number().step(1).min(1).max(2147483647).default(1800000),
  maxOutputBytes: Schema.number().step(1).min(1).default(4194304),
  graceMs: Schema.number().step(1).min(1).default(5000),
  metadataTimeoutMs: Schema.number().step(1).min(1).max(2147483647).default(30000),
  maxMetadataBytes: Schema.number().step(1).min(1).default(1048576),
  maxLogBytes: Schema.number().step(1).min(1).default(1048576),
  maxLogChunks: Schema.number().step(1).min(1).default(1000),
}).default({})
