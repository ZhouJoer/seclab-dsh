/** Root-scoped PDF reader for immutable resources without a conversation. @module */
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { ZoomViewport, zoomSurfaceClass } from '../zoom/ZoomViewport.tsx'
import type { PdfView } from './store.ts'
import type { ZoomPreference } from '../zoom/types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** Complete immutable PDF bytes; the occurrence owns rendering and zoom state. */
    'document.pdf': { scope: 'root'; props: { data: Uint8Array; identity: string }; locale: 'sidebarPdf' }
  }
}

const Content = lazy(() => import('./pdf.tsx').then(module => ({ default: module.PdfContent })))

/** Framework-derived inputs for the Session-independent PDF Factory. */
export type PdfViewportProps = FactoryComponentPropsOf<'document.pdf'>

/** Render a document revision independently of the current conversation.
 * @param props - Framework locale and complete PDF bytes.
 * @returns Lazily loaded PDF pages and zoom controls. */
export function PdfViewport(props: PdfViewportProps) {
  return <Reader key={props.identity} {...props} />
}

function Reader(props: FactoryComponentPropsOf<'document.pdf'>) {
  const data = useMemo(() => new Uint8Array(props.data), [props.data])
  const [signal] = useState(() => new AbortController().signal)
  const [view, setView] = useState<PdfView>({ page: 1 })
  const onPage = useCallback((page: number) => {
    setView(previous => previous.page === page ? previous : { ...previous, page })
  }, [])
  const onZoom = useCallback((zoom: ZoomPreference) => { setView(previous => ({ ...previous, zoom })) }, [])
  const scrollportRef = useCallback(() => {}, [])
  const loading = <p role="status">{props.t('rendering')}</p>
  return <Suspense fallback={loading}><Content data={data} signal={signal} view={view} onPage={onPage} onZoom={onZoom}
    scrollportRef={scrollportRef} ZoomViewport={ZoomViewport} zoomSurfaceClass={zoomSurfaceClass}
    t={props.t} loading={loading} /></Suspense>
}
