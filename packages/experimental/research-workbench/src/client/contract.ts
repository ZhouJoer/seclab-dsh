/** Resource adapters and reversible research contributions. @module */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ResearchFile } from '../types.ts'

/** Stable source identity; locators are interpreted only by their registered adapter. */
export interface ResearchResource {
  source: string
  id: string
  group: string
  label: string
  locator: Record<string, string>
  sessionId?: SessionId
  line?: number
}

/** A complete or explicitly bounded reading result. */
export interface ResearchContent {
  text: string
  version: string
  complete: boolean
  language: string
  file?: ResearchFile
  currentPath?: string
  /** Complete display-only bytes; never a text comparison or editable draft. */
  media?: { kind: 'pdf' | 'image'; data: Uint8Array; mediaType: string; missingFonts: string[] }
}

/** A source owns reads and optional guarded writes, not panel rendering. */
export interface ResearchSource {
  id: string
  read(resource: ResearchResource, signal: AbortSignal): Promise<RemoteResult<ResearchContent>>
  save?(resource: ResearchResource, original: ResearchContent, text: string, signal: AbortSignal): Promise<RemoteResult<ResearchContent>>
}

/** Navigation metadata for a contributed panel; its UI registers through the keyed slot. */
export interface ResearchPanel { id: string; title(): string }

/** Optional reader that opens a supported resource outside the text editor. */
export interface ResearchPreview {
  id: string
  /** Open a supported resource, returning false to leave it to another reader.
   * @param resource - Explicit source identity, including its Session and directory.
   * @returns Whether this reader handled the open action. */
  open(resource: ResearchResource): boolean
}

/** Browser service implemented independently from security adapters. */
export interface ResearchWorkbench {
  /** Open or select a resource without creating a conversation.
   * @param resource - stable source identity and adapter locator.
   * @param options - Open in a large floating reader, or fullscreen on narrow displays. */
  open(resource: ResearchResource, options?: { floating: boolean }): void
  /** Select a comparison resource while preserving the chosen baseline.
   * @param resource - resource to read on the comparison's other side. */
  compare(resource: ResearchResource): void
  /** Register a source adapter for this plugin lifetime.
   * @param source - uniquely named reader and optional guarded writer.
   * @returns a disposer that aborts and awaits the adapter's pending requests. */
  registerSource(source: ResearchSource): () => Promise<void>
  /** Register navigation for a separately contributed research.panel occupant.
   * @param panel - unique panel id and localized title getter.
   * @returns an idempotent registration disposer. */
  registerPanel(panel: ResearchPanel): () => void
  /** Register a preview reader; comparisons continue to use the text adapter.
   * @param preview - Reader with a unique registration id.
   * @returns An idempotent disposer removing this reader. */
  registerPreview(preview: ResearchPreview): () => void
}

declare module '@deepseek-ai/cordis' { interface Context { /** Optional research navigation and adapter registry. */ researchWorkbench: ResearchWorkbench } }
