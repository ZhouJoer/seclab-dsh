/** Generic project resource actions, shared by sidebar and full-page occurrences. @module */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Project-owned resource identity passed to optional action contributors. */
export interface SecurityResourceAction {
  projectId: string
  sessionId?: SessionId | undefined
  resource: { kind: 'material'; assetId: string; path: string; label: string; sourceRoot?: string | undefined }
    | { kind: 'evidence'; evidenceId: string; sha256: string; label: string }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Add optional resource actions receiving project and immutable resource identity. Entries coexist; an empty list adds no controls. */
    'security.resource.actions.item': { kind: 'list'; scope: 'root'; owner: SecurityResourceAction }
  }
  interface SlotFactoryMap {
    'security.resource.actions': {
      scope: 'root'
      props: SecurityResourceAction
      children: { 'security.resource.actions.item': { kind: 'list'; scope: 'root' } } }
  }
}
/** Render registered resource commands without requiring any specific extension.
 * @param props - immutable project resource identity and framework dispatch.
 * @returns optional actions from active plugins. */
export function ResourceActions(props: FactoryComponentPropsOf<'security.resource.actions'>) {
  return props.renderSlot('security.resource.actions.item', { projectId: props.projectId, sessionId: props.sessionId, resource: props.resource })
}
