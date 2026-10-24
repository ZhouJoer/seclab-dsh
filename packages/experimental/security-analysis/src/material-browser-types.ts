/** Read-only directory pages and file previews from imported material snapshots. @module */
/** One immediate snapshot child, with its size or descendant file count. */
export type MaterialEntry = { kind: 'directory'; path: string; fileCount: number }
  | { kind: 'file'; path: string; size: number }

/** A directory page or a bounded file preview; paths belong to one immutable asset. */
export type MaterialBrowserView = { kind: 'directory'; entries: MaterialEntry[]; next: number | null; total: number }
  | { kind: 'text'; path: string; size: number; text: string; truncated: boolean }
  | { kind: 'image'; path: string; size: number; url: string }
  | { kind: 'binary'; path: string; size: number; hex: string }
