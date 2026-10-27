/** Shared terminal Factory for independently positioned session surfaces. @module */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalBodyInjected } from './face.ts'
import { LazyTerminalViewport } from './LazyTerminalBody.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'terminal.viewport': {
      scope: 'session'
      props: { contentId: string; visible: boolean; onNew: () => void }
      inject: TerminalBodyInjected
      locale: 'sidebarTerminal'
    }
  }
}

/** Render an owner-supplied terminal identity through the shared controller.
 * @param props - session-derived terminal model, theme and containing surface visibility.
 * @returns the lazily loaded terminal screen. */
export function Viewport(props: FactoryComponentPropsOf<'terminal.viewport'>) {
  const state = props.useTerminal(props.contentId)
  const theme = props.useTheme(value => value)
  return <LazyTerminalViewport model={props.view(props.contentId)} state={state} theme={theme}
    visible={props.visible} t={props.t} onNew={props.onNew} />
}
