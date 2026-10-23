/** Expandable material snapshots with file previews and framework-owned reads. @module */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MaterialBrowserView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { CodeBlock, IconFolderCloseRegular, IconFolderOpenRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './MaterialBrowser.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Immutable project material directory or file content. */
    'security-material': MaterialBrowserView
  }
}
type Props = PropsLocale<typeof NS> & Pick<PropsRuntime<'main'>, 'useResource'> & {
  project: string
  asset: string
  label: string
  directory: boolean
}
type ReadProps = Props & { path: string }
type TreeProps = ReadProps & {
  expanded: ReadonlySet<string>
  toggle(path: string): void
  select(path: string): void
  selected: string | undefined
}

function address(props: ReadProps, mode: 'directory' | 'file', offset: number, retry: number) {
  return `dsh-resource://security-material/${encodeURIComponent(props.project)}/${encodeURIComponent(props.asset)}?${new URLSearchParams({ mode, path: props.path, offset: String(offset), retry: String(retry) })}`
}
function basename(path: string) { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }

function DirectoryPage(props: TreeProps & { offset: number }) {
  const [retry, setRetry] = useState(0)
  const [more, setMore] = useState(false)
  const resource = props.useResource<'security-material'>(address(props, 'directory', props.offset, retry))
  const value = resource.value?.kind === 'directory' ? resource.value : undefined
  return <>
    {resource.status === 'loading' && <li role="status" aria-label={props.t('dashboardLoading')}><StateDot state="ongoing" /></li>}
    {resource.status === 'failed' && <li role="alert">{props.t('dashboardReadFailed')} <button onClick={() => { setRetry(value => value + 1) }}>{props.t('dashboardRetry')}</button></li>}
    {value?.entries.map(entry => <li key={entry.path}>
      {entry.kind === 'directory' ? <details open={props.expanded.has(entry.path)} onToggle={(event) => {
        if (event.currentTarget.open !== props.expanded.has(entry.path)) props.toggle(entry.path)
      }}>
        <summary title={entry.path}>
          {props.expanded.has(entry.path) ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
          <span>{basename(entry.path)}</span><small>{entry.fileCount}</small>
        </summary>
        {props.expanded.has(entry.path) && <ul><DirectoryPage {...props} path={entry.path} offset={0} /></ul>}
      </details> : <button className={css.file} title={entry.path} aria-pressed={props.selected === entry.path}
        onClick={() => { props.select(entry.path) }}><span>{basename(entry.path)}</span><small>{entry.size.toLocaleString()} {props.t('dashboardBytes')}</small></button>}
    </li>)}
    {value && !value.total && <li className={css.empty}>{props.t('materialsEmptyFolder')}</li>}
    {value?.next !== null && value?.next !== undefined && (more
      ? <DirectoryPage {...props} offset={value.next} />
      : <li><button onClick={() => { setMore(true) }}>{props.t('materialsMoreFiles')}</button></li>)}
  </>
}

function FilePreview(props: ReadProps) {
  const [retry, setRetry] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)
  const resource = props.useResource<'security-material'>(address(props, 'file', 0, retry))
  const value = resource.value
  return <section className={css.preview} aria-label={props.t('materialsPreview')}>
    <header><strong>{props.path || basename(props.label)}</strong>{value && value.kind !== 'directory' && <small>{value.size.toLocaleString()} {props.t('dashboardBytes')}</small>}</header>
    {resource.status === 'loading' && <div className={css.loading} role="status" aria-label={props.t('dashboardLoading')}><StateDot state="ongoing" /></div>}
    {resource.status === 'failed' && <p role="alert">{props.t('materialsFileUnavailable')} <button onClick={() => { setRetry(value => value + 1) }}>{props.t('dashboardRetry')}</button></p>}
    {value?.kind === 'text' && <>{value.truncated && <p role="status">{props.t('dashboardTruncated')}</p>}
      <CodeBlock code={value.text} lang={props.path.split('.').at(-1) ?? 'text'} copyLabel={props.t('markdownCopy')} copiedLabel={props.t('markdownCopied')} />
      {!value.size && <p>{props.t('materialsEmptyFile')}</p>}</>}
    {value?.kind === 'image' && (imageFailed ? <p role="alert">{props.t('dashboardReadFailed')}</p>
      : <img src={value.url} alt={props.path || props.label} onError={() => { setImageFailed(true) }} />)}
    {value?.kind === 'binary' && <><p>{props.t('materialsBinaryPreview')}</p><CodeBlock code={value.hex} lang="text"
      copyLabel={props.t('markdownCopy')} copiedLabel={props.t('markdownCopied')} /></>}
  </section>
}

/** Browse the current snapshot while keeping directory expansion and selection across synchronization.
 * @param props - project-owned snapshot identity, label and framework resource hook.
 * @returns expandable folders and an adjacent file preview.
 */
export function MaterialBrowser(props: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<string>()
  const toggle = (path: string) => { setExpanded((previous) => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  }) }
  return <section className={css.browser} aria-label={props.label}>
    <header className={css.heading}><IconFolderOpenRegular /><h3 title={props.label}>{basename(props.label)}</h3></header>
    {props.directory ? <div className={css.columns}>
      <nav className={css.tree} aria-label={props.t('materialsFiles')}><ul><DirectoryPage {...props} path="" offset={0} expanded={expanded} toggle={toggle} selected={selected} select={setSelected} /></ul></nav>
      {selected === undefined ? <p className={css.empty}>{props.t('materialsSelectFile')}</p> : <FilePreview key={`${props.asset}:${selected}`} {...props} path={selected} />}
    </div> : <FilePreview key={props.asset} {...props} path="" />}
  </section>
}
