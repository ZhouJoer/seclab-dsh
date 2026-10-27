/** Versioned work-file reads and guarded operator saves. @module */
import type { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'

/** Complete read identity; the server rechecks every field before replacement. */
export interface ResearchFile {
  path: string
  root: string
  rootKey: FsTargetKey
  targetKey: FsTargetKey
  version: FsVersion
  text: string
  bytes: number
  bom: boolean
  newline: 'lf' | 'crlf' | 'mixed'
  writable: boolean
  reason: 'binary' | 'encoding' | 'mixed' | 'policy' | null
}

/** Replacement of an existing file, never a create-or-overwrite operation. */
export interface ResearchSave {
  path: string
  rootKey: FsTargetKey
  targetKey: FsTargetKey
  version: FsVersion
  text: string
}

/** A bounded directory listing in the effective Session directory. */
export interface ResearchDirectory {
  root: string
  path: string
  entries: { name: string; path: string; directory: boolean }[]
  truncated: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'research/unavailable': Record<string, never>
    'research/directory': Record<string, never>
    'research/missing': Record<string, never>
    'research/conflict': Record<string, never>
    'research/too-large': Record<string, never>
    'research/read-only': Record<string, never>
    'research/encoding': Record<string, never>
    'research/outside-workspace': Record<string, never>
    'research/not-file': Record<string, never>
  }
}
