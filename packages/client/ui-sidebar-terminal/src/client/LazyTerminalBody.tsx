/** Load xterm only after a terminal body is mounted. */
import { lazy, Suspense, type ReactNode } from 'react'
import type { TerminalBodyProps } from './terminal.tsx'
import type { TerminalViewportProps } from './terminal.tsx'

const LoadedTerminalBody = lazy(async () => ({ default: (await import('./terminal.tsx')).TerminalBody }))
const LoadedTerminalViewport = lazy(async () => ({ default: (await import('./terminal.tsx')).TerminalViewport }))

/** Load the shared terminal screen on demand for a non-sidebar owner.
 * @param props - existing model and framework-derived values.
 * @returns the deferred terminal viewport. */
export function LazyTerminalViewport(props: TerminalViewportProps): ReactNode {
  return <Suspense fallback={null}><LoadedTerminalViewport {...props} /></Suspense>
}

/**
 * Suspend while the package-local terminal chunk arrives.
 * @param props - Terminal body props supplied by the sidebar slot.
 * @returns the deferred terminal renderer.
 */
export function LazyTerminalBody(props: TerminalBodyProps): ReactNode {
  return <Suspense fallback={null}><LoadedTerminalBody {...props} /></Suspense>
}
