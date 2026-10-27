/** Framework-derived research surfaces and optional extension seats. @module */
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ResearchContent, ResearchResource } from './contract.ts'
import type { ResearchDirectory } from '../types.ts'
import type { createResearchStore } from './store.ts'
import type { en } from './locales.ts'

/** Services and snapshots projected into registered components. */
export interface ResearchInject {
  hooks: { view: ObservableSnapshot<{ narrow: boolean; session: SessionReference | undefined }> }
  open(resource: ResearchResource): void
  save(resource: ResearchResource, original: ResearchContent, text: string): Promise<RemoteResult<ResearchContent>>
  openChat(resource: ResearchResource): void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'research-workbench': keyof typeof en }
  interface ResourceProtocolMap { research: ResearchContent; 'research-directory': ResearchDirectory }
  interface SlotMap {
    /** Register an optional page by its registerPanel id. Receives the selected Session when present; absent keys render nothing. */
    'research.panel': { kind: 'keyed'; scope: 'session-maybe' }
    /** Contribute the selected-text insertion action. Receives text and an error reporter;
     * replaces the single action, absent means no control. */
    'research.reference': { kind: 'single'; scope: 'session'; owner: { text: string; report(message: string): void } }
  }
  interface SlotFactoryMap {
    'research.surface': {
      scope: 'root'
      props: { overlay: boolean }
      store: ReturnType<typeof createResearchStore>
      inject: ResearchInject
      locale: 'research-workbench'
      children: { 'research.panel': { kind: 'keyed'; scope: 'session-maybe' }; 'research.reference': { kind: 'single'; scope: 'session' } }
    }
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' { interface SessionReferenceSourceMap { researchWorkbench: unknown } }
