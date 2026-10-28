/** Read-only directory pages and file previews from imported material snapshots. @module */
/** One immediate snapshot child, with its size or descendant file count. */
export type MaterialEntry = { kind: 'directory'; path: string; fileCount: number }
  | { kind: 'file'; path: string; size: number }

/** A directory page or a bounded file preview; paths belong to one immutable asset. */
export type MaterialBrowserView = { kind: 'directory'; entries: MaterialEntry[]; next: number | null; total: number }
  | { kind: 'text'; path: string; size: number; text: string; truncated: boolean }
  | { kind: 'image'; path: string; size: number; url: string }
  | { kind: 'binary'; path: string; size: number; hex: string }

/** Immutable document bytes or bounded text authorized by one project's asset record. */
export type MaterialDocument = {
  name: string
  version: string
  size: number
} & ({ kind: 'text'; text: string; truncated: boolean }
  | { kind: 'pdf'; data: Uint8Array; missingFonts: string[] }
  | { kind: 'image'; data: Uint8Array; mediaType: string }
  | { kind: 'binary'; hex: string })
