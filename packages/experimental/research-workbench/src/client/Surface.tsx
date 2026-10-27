/** Shared bottom and modal reader; all reads use framework resource props. @module */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { FactoryComponentPropsOf, PropsRuntime, PropsRenderFactories, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, FileTypeIcon, Modal, DiffBlock, CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ResearchContent } from './contract.ts'
import type { ResearchDocument } from './store.ts'
import './slots.ts'
import { DockSurface, FloatLayer } from '@deepseek-ai/dsh-client-ui-dockkit'
import { researchDock } from './docking.ts'
import css from './Surface.module.css'

const Editor = lazy(() => import('./Editor.tsx'))
type Props = FactoryComponentPropsOf<'research.surface'>
type DocumentProps = Props & { doc: ResearchDocument }
function address(doc: ResearchDocument) { return `dsh-resource://research/read?${new URLSearchParams({ id: doc.resource.id, epoch: String(doc.epoch) })}` }

/** Frame-owned bottom occurrence. @param props - renderer factory dispatch. @returns research surface. */
export function Bottom(props: PropsRuntime<'shell.bottom'> & PropsRenderFactories) { return props.renderFactorySlot('research.surface', { overlay: false }) }
/** Floating occurrence sharing the same factory state. @param props - renderer factory dispatch. @returns fullscreen surface. */
export function Overlay(props: PropsRuntime<'shell.overlay'> & PropsRenderFactories) { return props.renderFactorySlot('research.surface', { overlay: true }) }
/** Insert one selection without submission or draft replacement.
 * @param props - exact Session input actions and selected source text.
 * @returns explicit insertion button. */
export function Reference(props: PropsRuntime<'research.reference'> & PropsLocale<'research-workbench'>) {
  return <Button size="sm" disabled={!props.text} onClick={() => {
    const captured = props.inputActions.captureInsertion()
    if (!props.inputActions.insertText(props.text, captured)) props.report(props.t('referenceFailed'))
    else props.inputActions.persistDraft()
  }}>{props.t('reference')}</Button>
}

function Files(props: Props) {
  const session = props.useView(value => value.session)
  const [path, setPath] = useState('')
  const [retry, setRetry] = useState(0)
  const listing = props.useResource<'research-directory'>(session ? `dsh-resource://research-directory/list?${new URLSearchParams({ session: session.sessionId, path, retry: String(retry) })}` : '')
  if (!session) return <p>{props.t('noSession')}</p>
  return <nav className={css.files} aria-label={props.t('tree')}>
    <Button size="sm" onClick={() => { setPath(''); setRetry(value => value + 1) }}>{props.t('refresh')}</Button>
    {path && <Button size="sm" onClick={() => { setPath('') }}>{props.t('parent')}</Button>}
    {listing.status === 'loading' && <p role="status">{props.t('loading')}</p>}
    {listing.status === 'failed' && <p role="alert">{props.t('failed')}</p>}
    {listing.value?.truncated && <p>{props.t('incomplete')}</p>}
    {listing.value?.entries.map(entry => <Button size="sm" key={entry.path} title={entry.path} onClick={() => {
      if (entry.directory) { setPath(entry.path); return }
      const root = listing.value?.root
      if (!root) return
      props.open({ source: 'file', id: JSON.stringify(['file', session.sessionId, root, entry.path]), group: JSON.stringify(['file', session.sessionId, root]),
        label: entry.name, sessionId: session.sessionId, locator: { path: entry.path, root } })
    }}>{entry.directory ? '▸ ' : ''}{entry.name}</Button>)}
  </nav>
}

function Comparison(props: DocumentProps & { content: ResearchContent; baseline: ResearchDocument }) {
  const read = props.useResource<'research'>(address(props.baseline))
  const before = props.baseline.original ?? read.value
  if (!before) return <p>{props.t('loading')}</p>
  if (before.media || props.content.media) return <p>{props.t('textOnly')}</p>
  if (!before.complete || !props.content.complete) return <p>{props.t('incomplete')}</p>
  return <>
    <p className={css.origins}>
      {props.baseline.resource.label} · {before.version} → {props.doc.resource.label} · {props.content.version}
    </p>
    <TextDiff {...props} before={before.text} after={props.content.text} />
  </>
}
function TextDiff(props: Props & { doc: ResearchDocument; before: string; after: string }) {
  const diffs = [{ path: props.doc.resource.label, oldText: props.before, newText: props.after }]
  return <DiffBlock diffs={diffs} maxLines={200}
    labels={{ copy: props.t('copy'), copied: props.t('copied'), collapse: props.t('collapse'), collapseAria: props.t('collapse'),
      expand: () => props.t('fullscreen'), expandAria: () => props.t('fullscreen'), codeLabel: props.t('raw'), wrapLabel: props.t('wrap'), unwrapLabel: props.t('unwrap') }} />
}

function Document(props: DocumentProps) {
  const { doc, actions, t } = props
  const state = props.useStore(value => value)
  const session = props.useView(value => value.session)
  const read = props.useResource<'research'>(address(doc))
  const content = doc.original ?? read.value
  const [closing, setClosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [diff, setDiff] = useState(false)
  const [records, setRecords] = useState(false)
  const [query, setQuery] = useState('')
  const area = useRef<HTMLTextAreaElement | null>(null)
  const dirty = doc.draft !== undefined && doc.draft !== doc.original?.text
  const draft = doc.draft ?? content?.text ?? ''
  const reading = useRef(doc)
  reading.current = doc
  const restoreReader = useCallback((node: HTMLTextAreaElement | null) => {
    area.current = node
    if (!node) return
    const document = reading.current
    const line = document.selection?.from ?? document.resource.line ?? 1
    const start = draft.split('\n').slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0)
    node.setSelectionRange(start, start + (document.selection?.text.length ?? 0))
    node.scrollTop = document.scroll || (line - 1) * 20.8
  }, [draft])
  const save = async (close: boolean) => {
    if (!content || doc.draft === undefined || saving) return
    setSaving(true)
    try {
      const result = await props.save(doc.resource, content, doc.draft)
      if (!result.ok) { actions.notice(`${t('saveFailed')} (${result.error.code})`); return }
      actions.saved(doc.resource.id, doc.draft, result.value); actions.notice(t('saved'))
      if (close) actions.closeSaved(doc.resource.id, doc.draft)
    } catch (error) { actions.notice(`${t('saveFailed')} ${error instanceof Error ? error.message : String(error)}`) }
    finally { setSaving(false) }
  }
  const close = () => { if (dirty) setClosing(true); else actions.close(doc.resource.id) }
  const selected = doc.selection
  const quote = selected?.text && content ? `\n[${doc.resource.label}] ${doc.resource.source}:${JSON.stringify(doc.resource.locator)} @ ${content.version} L${selected.from}-${selected.to}${dirty ? ` (${t('dirty')})` : ''}\n${selected.text.split('\n').map(line => `> ${line}`).join('\n')}\n` : ''
  const baseline = state.documents.find(item => item.resource.id === state.comparison && item.resource.id !== doc.resource.id)
  const available = state.sources.includes(doc.resource.source)
  if (content?.media) return <article className={css.document}>
    <p className={css.origins}>{doc.resource.label} · {content.version.slice(0, 16)} · {t('readonly')}</p>
    {content.media.missingFonts.length > 0 && <p role="status" className={css.notice}>{t('missingFonts', { fonts: content.media.missingFonts.join(', ') })}</p>}
    <div className={css.media}>
      {content.media.kind === 'pdf' ? props.renderFactorySlot('document.pdf', { data: content.media.data, identity: `${doc.resource.id}:${content.version}` }, { fallback: <p>{t('previewUnavailable')}</p> })
        : <ImagePreview media={content.media} label={doc.resource.label} />}
    </div>
  </article>
  return <article className={css.document}>
    <div className={css.toolbar}>

      {content?.file?.writable && doc.draft === undefined && available && <Button size="sm" onClick={() =>{  actions.edit(doc.resource.id, content) }}>{t('edit')}</Button>}
      {doc.draft !== undefined && <><Button size="sm" disabled={saving || !dirty || !available} onClick={() => { void save(false) }}>{t('save')}</Button>
        <Button size="sm" disabled={saving} onClick={() =>{  actions.discard(doc.resource.id) }}>{t('discard')}</Button><Button size="sm" onClick={() =>{  setDiff(value => !value) }}>{t('draftDiff')}</Button></>}
      {content?.complete && <Button size="sm" onClick={() =>{  actions.baseline(doc.resource.id, { ...content, text: draft }) }}>{t('compare')}</Button>}
      <Button size="sm" disabled={doc.draft !== undefined} onClick={() =>{  actions.refresh(doc.resource.id) }}>{t('refresh')}</Button>
      <Button size="sm" disabled={saving} onClick={close}>{t('close')}</Button>
    </div>
    {!available && <p role="status">{t('unavailable')}</p>}
    {read.status === 'loading' && !content && <p role="status">{t('loading')}</p>}
    {read.status === 'failed' && <p role="alert">{t('failed')} <details><summary>{t('details')}</summary>{`${read.failure?.code ?? ''} ${read.failure?.message ?? ''}`}</details></p>}
    {content && <>
      <p className={css.origins} title={`${doc.resource.label} · ${content.version}`}>{content.file?.path ?? doc.resource.locator.path ?? doc.resource.label} · {content.version.slice(0, 16)} {content.file?.writable ? '' : t('readonly')} {dirty ? t('dirty') : ''}</p>
      {!content.complete && <p role="status">{t('incomplete')}</p>}
      <div className={css.toolbar}>
        {doc.draft !== undefined && content.file && <Button size="sm" onClick={() => {
          actions.baseline(doc.resource.id, { ...content, text: draft })
          props.open({ ...doc.resource, id: `${doc.resource.id}:current:${doc.epoch}`, label: `${doc.resource.label} (${t('current')})` })
        }}>{t('current')}</Button>}
        {session ? <props.SessionProvider session={session}>{props.renderSlot('research.reference', { text: quote, report: actions.notice })}</props.SessionProvider>
          : <Button size="sm" disabled={!doc.resource.sessionId} onClick={() =>{  props.openChat(doc.resource) }}>{t('noSession')}</Button>}
        {content.currentPath && session && <Button size="sm" onClick={() =>{  props.open({ source: 'file', id: JSON.stringify(['file', session.sessionId, content.currentPath]),
          group: JSON.stringify(['file', session.sessionId, content.currentPath]), label: doc.resource.label, sessionId: session.sessionId, locator: { path: content.currentPath ?? '' } }) }}>{t('current')}</Button>}
        <label>{t('find')} <input value={query} onChange={(event) =>{  setQuery(event.target.value) }} /></label>
        <Button size="sm" disabled={!query} onClick={() => {
          const target = area.current
          if (!target) return
          const start = draft.indexOf(query, target.selectionEnd) >= 0 ? draft.indexOf(query, target.selectionEnd) : draft.indexOf(query)
          if (start >= 0) { target.focus(); target.setSelectionRange(start, start + query.length) }
        }}>{t('next')}</Button>
        {/jsonl?|ndjson/.test(content.language) && <Button size="sm" onClick={() =>{  setRecords(value => !value) }}>{records ? t('raw') : t('records')}</Button>}
      </div>
      <div className={css.content}>
        {diff && doc.original ? <TextDiff {...props} before={doc.original.text} after={draft} />
          : baseline ? <Comparison {...props} baseline={baseline} content={{ ...content, text: draft }} />
            : doc.draft !== undefined ? <Suspense fallback={<p>{t('loading')}</p>}><Editor key={doc.resource.id}
              initial={draft} newline={content.file?.newline === 'crlf' ? 'crlf' : 'lf'} label={doc.resource.label}
              scroll={doc.scroll} onScroll={(position) =>{  actions.scroll(doc.resource.id, position) }}
              onChange={(text) =>{  actions.change(doc.resource.id, text) }}
              onSelection={(text, from, to) =>{  actions.selection(doc.resource.id, { text, from, to }) }} /></Suspense>
              : records ? <ol>{(content.language === 'json' ? [draft] : draft.split(/\r?\n/)).map((line, index) => {
                let parsed: string
                try { parsed = JSON.stringify(JSON.parse(line), null, 2) } catch (error) { return <li key={index}><p>{t('invalidJson')} {index + 1}: {error instanceof Error ? error.message : String(error)}</p><pre>{line}</pre></li> }
                return <li key={index}><CodeBlock code={parsed} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} /></li>
              })}</ol>
                : <div className={css.reader}><pre aria-hidden="true" style={{ transform: `translateY(-${doc.scroll}px)` }}>{draft.split('\n').map((_, index) => index + 1).join('\n')}</pre><textarea ref={restoreReader} readOnly value={draft} aria-label={doc.resource.label} wrap="off"
                  onScroll={(event) =>{  actions.scroll(doc.resource.id, event.currentTarget.scrollTop) }}
                  onSelect={(event) => {
                    const field = event.currentTarget
                    actions.selection(doc.resource.id, { text: draft.slice(field.selectionStart, field.selectionEnd),
                      from: draft.slice(0, field.selectionStart).split('\n').length, to: draft.slice(0, field.selectionEnd).split('\n').length }) }} /></div>}
      </div>
    </>}
    <Modal open={closing} title={t('confirmClose')} closeLabel={t('cancel')} onClose={() =>{  setClosing(false) }}>
      <Button size="sm" disabled={saving || !available} onClick={() => { void save(true) }}>{t('save')}</Button>
      <Button size="sm" disabled={saving} onClick={() =>{  actions.close(doc.resource.id) }}>{t('discard')}</Button>
      <Button size="sm" onClick={() =>{  setClosing(false) }}>{t('cancel')}</Button>
    </Modal>
  </article>
}

function ImagePreview({ media, label }: { media: NonNullable<ResearchContent['media']>; label: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([new Uint8Array(media.data)], { type: media.mediaType }))
    setUrl(value)
    return () => { URL.revokeObjectURL(value) }
  }, [media])
  return url ? <img className={css.image} src={url} alt={label} /> : null
}

/** Shared native docking chrome with independent floating document windows.
 * @param props - framework state, resources and localized actions.
 * @returns bottom tools, floating readers or narrow-screen fullscreen reader. */
export function Surface(props: Props) {
  const state = props.useStore(value => value)
  const view = props.useView(value => value)
  const drag = useRef<{ y: number; height: number }>()
  const fullscreen = state.expanded && (state.fullscreen || view.narrow)
  const docking = researchDock(state, props, view.narrow)
  const groups = [...new Map(state.documents.map(doc => [doc.resource.group,
    doc.resource.locator.root ?? doc.resource.label])).entries()]
  const renderTab = (tab: import('@deepseek-ai/dsh-client-ui-dockkit').TabRecord) => {
    const doc = state.documents.find(item => item.resource.id === tab.contentId)
    return doc ? <Document key={doc.resource.id} {...props} doc={doc} /> : null
  }
  const canClose = (id: string) => {
    const doc = state.documents.find(item => item.resource.id === id)
    return doc?.draft === undefined || doc.draft === doc.original?.text
  }
  const native = { state: docking.layout, intents: docking.intents, labels: docking.labels, renderTab, canCloseTab: canClose }
  const floats = <div className={css.floats}><FloatLayer {...native} /></div>
  if (props.overlay && !fullscreen) return view.narrow ? null : floats
  if (!props.overlay && fullscreen) return <div className={css.launcher}>
    <Button size="sm" onClick={() =>{  props.actions.toggle() }}>{props.t('title')}</Button>
  </div>
  const documentArea = <DockSurface {...native} canSplit={false} hideSplitWhenBlocked canAddTab={() => false}
    renderTabTitle={tab => <span className={css.tabTitle}><FileTypeIcon size={16} path={tab.title} />{tab.title}</span>} />
  const body = <section className={css.surface} style={fullscreen ? undefined : {
    height: state.expanded ? `${state.height}dvh` : 'auto',
  }} aria-label={props.t('title')}>
    {state.expanded && !fullscreen && <div className={css.resize} role="separator" aria-orientation="horizontal"
      aria-label={props.t('height')} aria-valuemin={20} aria-valuemax={50} aria-valuenow={state.height} tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { y: event.clientY, height: state.height }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (drag.current) props.actions.height(drag.current.height + (drag.current.y - event.clientY) / window.innerHeight * 100)
      }}
      onPointerUp={(event) => {
        drag.current = undefined
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }} onPointerCancel={() => { drag.current = undefined }} onLostPointerCapture={() => { drag.current = undefined }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          props.actions.height(state.height + (event.key === 'ArrowUp' ? 5 : -5))
        }
      }} />}
    <header className={css.header}>
      <div className={css.tools}>
        <Button size="sm" aria-expanded={state.expanded} onClick={() =>{  props.actions.toggle() }}>{props.t('title')}</Button>
        <Button size="sm" aria-pressed={state.panel === 'files'} onClick={() =>{  props.actions.panel('files') }}>{props.t('files')}</Button>
        {state.panels.map(panel => <Button size="sm" key={panel.id} aria-pressed={state.panel === panel.id}
          onClick={() =>{  props.actions.panel(panel.id) }}>{panel.title}</Button>)}
      </div>
      {state.expanded && <div className={css.controls}>
        <Button size="sm" onClick={() => {
          if (view.narrow) props.actions.toggle()
          else props.actions.fullscreen(!state.fullscreen)
        }}>
          {props.t(view.narrow ? 'close' : fullscreen ? 'restore' : 'fullscreen')}
        </Button>
        {!view.narrow && <Button size="sm" onClick={() =>{  props.actions.toggle() }}>{props.t('collapse')}</Button>}
      </div>}
    </header>
    {state.expanded && <>
      {state.notice && <p className={css.notice} role="status">{state.notice}</p>}
      {state.panels.some(panel => panel.id === state.panel) ? <props.SessionProvider session={view.session}>
        {props.renderSlot('research.panel', {}, { entryKey: state.panel })}
      </props.SessionProvider>
        : <div className={css.workspace}>
          <aside className={css.explorer}>
            <div className={css.explorerTitle}>{props.t('tree')}</div>
            {groups.length > 1 && <select aria-label={props.t('groups')} value={state.group} onChange={(event) => {
              const first = state.documents.find(doc => doc.resource.group === event.target.value)
              if (first) props.actions.select(first.resource.id)
            }}>{groups.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>}
            <Files key={view.session?.sessionId} {...props} />
          </aside>
          <div className={css.documents}>{documentArea}</div>
        </div>}
      {state.comparison && <div className={css.comparisonBar}><span>{props.t('comparing')}</span>
        <Button size="sm" onClick={() =>{  props.actions.compare(null) }}>{props.t('clearCompare')}</Button></div>}
    </>}
  </section>
  return fullscreen ? <Modal open title={props.t('title')} closeLabel={props.t('close')}
    onClose={() =>{  props.actions.toggle() }} className={css.modal ?? ''} contentClassName={css.modalContent ?? ''}>
    {body}{!view.narrow && floats}
  </Modal> : body
}
