/** Mouse-driven local tool selection with bounded Host probes and immediate save feedback. @module */
import { useEffect, useRef, useState } from 'react'
import type { ToolboxConfiguration, ToolboxConfigurationResult, ToolboxFiles } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Authenticated operator configuration actions; model tools cannot invoke these methods. */
export interface ToolConfigurationActions {
  toolboxConfiguration(this: void, environmentId: string): Promise<ToolboxConfiguration>
  configureTool(this: void, environmentId: string, input: string): Promise<ToolboxConfigurationResult>
  toolboxFiles(this: void, environmentId: string, directory?: string): Promise<ToolboxFiles>
}

/** Edit one local installation and report its measured version before applying changes.
 * @param props - selected environment, known settings, Host actions and localized labels.
 * @returns executable picker, optional argument fields and probe feedback.
 */
export function ToolSettings({ environmentId, configuration, selectedId, configureTool, toolboxFiles, onResult, onClose, notify, t }:
  Pick<ToolConfigurationActions, 'configureTool' | 'toolboxFiles'> & PropsLocale<typeof NS> & {
    notify?: ((text: string) => void) | undefined
    environmentId: string
    configuration: ToolboxConfiguration
    selectedId: string
    onResult(this: void, result: ToolboxConfigurationResult): void
    onClose(this: void): void
  }) {
  const initial = configuration.tools.find(tool => tool.id === selectedId)
  const [settings, setSettings] = useState(configuration)
  const [id, setId] = useState(selectedId)
  const [custom, setCustom] = useState(!initial && !configuration.adapters?.some(adapter => adapter.id === selectedId))
  const [command, setCommand] = useState(initial?.command ?? '')
  const [prefix, setPrefix] = useState(initial?.prefixArgs.join('\n') ?? '')
  const [version, setVersion] = useState(initial?.versionArgs.join('\n') ?? '--version')
  const [defaultEnvironment, setDefaultEnvironment] = useState(configuration.bindings?.[selectedId] ?? '')
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<ToolboxFiles>()
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ToolboxConfigurationResult>()
  const adapter = settings.adapters?.find(adapter => adapter.id === id)
  const bindingOnly = adapter !== undefined && adapter.installationId !== id
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function select(value: string) {
    const tool = settings.tools.find(tool => tool.id === value)
    const id = value === '__custom__' ? '' : value
    setId(id); setCustom(!id); setCommand(tool?.command ?? '')
    setPrefix(tool?.prefixArgs.join('\n') ?? ''); setVersion(tool?.versionArgs.join('\n') ?? '--version')
    setDefaultEnvironment(settings.bindings?.[id] ?? '')
    setResult(undefined); setFeedback(''); setError(''); setFiles(undefined)
  }
  async function browse(directory?: string) {
    setBusy(true); setError('')
    try {
      const next = await toolboxFiles(environmentId, directory)
      if (mounted.current) setFiles(next)
    }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function run(action: 'probe' | 'save' | 'remove' | 'bind' | 'reset-binding') {
    setBusy(true); setError(''); setFeedback(t(action === 'remove' ? 'toolRemoving' : 'toolCheckingSelection'))
    setResult(undefined)
    try {
      const binding = action === 'bind' || action === 'reset-binding'
      const next = await configureTool(environmentId, JSON.stringify(binding
        ? { action, id, revision: settings.revision, ...(action === 'bind' ? { defaultEnvironmentId: defaultEnvironment } : {}) }
        : { action, id, command, prefixArgs: prefix.split('\n').filter(Boolean),
          versionArgs: version.split('\n').filter(Boolean), revision: settings.revision }))
      if (!mounted.current) return
      setResult(next); setSettings(next.configuration)
      if (binding) setDefaultEnvironment(next.configuration.bindings?.[id] ?? '')
      setFeedback(next.saved ? '' : t(next.tool?.status === 'available' ? 'toolCheckPassed' : 'toolCheckFailed'))
      if (next.saved) notify?.(t(action === 'remove' ? 'toolRemoved' : 'toolApplied'))
      if (next.tool?.status === 'available') setCommand(next.tool.installation?.command ?? next.tool.command)
      if (next.saved) onResult(next)
    } catch (error) { if (mounted.current) { setError(error instanceof Error ? error.message : String(error)); setFeedback('') } }
    finally { if (mounted.current) setBusy(false) }
  }
  return <section className={css.form} aria-label={t('toolConfigure')}>
    <header className={css.header}><strong>{t('toolConfigure')}</strong>
      <button disabled={busy} onClick={onClose}>{t('toolCloseEditor')}</button></header>
    <fieldset disabled={busy} className={css.toolFields}>
      <label className={css.field}>{t('toolChooseType')}
        <select value={custom ? '__custom__' : id} onChange={(event) => { select(event.target.value) }}>
          {settings.tools.map(tool => <option key={tool.id} value={tool.id}>{tool.id}</option>)}
          {settings.adapters?.filter(adapter => adapter.bindingId === adapter.id && !settings.tools.some(tool => tool.id === adapter.id))
            .map(adapter => <option key={adapter.id} value={adapter.id}>{adapter.id}</option>)}
          <option value="__custom__">{t('toolCustom')}</option>
        </select>
      </label>
      {custom && <label className={css.field}>{t('toolIdentifier')}<input value={id} onChange={(event) => { setId(event.target.value); setFeedback(''); setResult(undefined) }} /></label>}
      {bindingOnly ? <p>{t('toolProviderSetupHint')}</p> : <>
        <label className={css.field}>{t('toolExecutable')}<input value={command} onChange={(event) => { setCommand(event.target.value); setFeedback(''); setResult(undefined) }} /></label>
        <p>{t(settings.environmentKind === 'docker' ? 'toolContainerExecutableHint' : 'toolExecutableHint')}</p>
        {settings.environmentKind !== 'docker' && <button onClick={() => void browse()}>{t('toolBrowseExecutable')}</button>}
        {files && <section className={css.toolFilePicker} aria-label={t('toolBrowseExecutable')}>
          <p><code>{files.directory}</code></p>
          <div className={css.tabs}>
            {files.roots.map(root => <button key={root} onClick={() => void browse(root)}>{root}</button>)}
            <button disabled={files.parent === files.directory} onClick={() => void browse(files.parent)}>{t('toolParentDirectory')}</button>
            <button onClick={() => { setFiles(undefined) }}>{t('toolClosePicker')}</button>
          </div>
          <div className={css.toolFileList}>
            {files.entries.map(entry => <button key={entry.path} title={entry.path} onClick={() => {
              if (entry.directory) void browse(entry.path)
              else { setCommand(entry.path); setFiles(undefined); setResult(undefined); setFeedback('') }
            }}><span aria-hidden="true">{entry.directory ? '📁' : '📄'}</span> {entry.name}</button>)}
          </div>
          {files.truncated && <p role="status">{t('toolFilesTruncated')}</p>}
        </section>}
        <details><summary>{t('toolAdvancedArguments')}</summary>
          <p>{t('toolArgumentsHint')}</p>
          <label className={css.field}>{t('toolPrefixArgs')}<textarea value={prefix} onChange={(event) => { setPrefix(event.target.value); setFeedback(''); setResult(undefined) }} /></label>
          <label className={css.field}>{t('toolVersionArgs')}<textarea value={version} onChange={(event) => { setVersion(event.target.value); setFeedback(''); setResult(undefined) }} /></label>
        </details>
        <div className={css.tabs}>
          <button disabled={!id} onClick={() => void run('probe')}>{t('toolCheckSelection')}</button>
          <button disabled={!id} onClick={() => void run('save')}>{t('toolCheckAndSave')}</button>
          {settings.tools.find(tool => tool.id === id)?.saved &&
          <button onClick={() => void run('remove')}>{t('toolRemoveOverride')}</button>}
        </div>
      </>}
    </fieldset>
    {adapter && (adapter.bindingId ?? adapter.installationId) === id &&
    <fieldset disabled={busy} className={css.toolFields}>
      <legend>{t('toolAdapterConfiguration')}</legend>
      <label className={css.field}>{t('toolDefaultEnvironment')}
        <select value={defaultEnvironment} onChange={(event) => { setDefaultEnvironment(event.target.value); setResult(undefined); setFeedback('') }}>
          <option value="">{t('toolInheritEnvironment')}</option>
          {settings.environments?.filter(environment => !adapter.environmentIds || adapter.environmentIds.includes(environment.id))
            .map(environment =>
              <option key={environment.id} value={environment.id}>{environment.label} · {environment.kind}</option>)}
        </select>
      </label>
      <p>{t('toolBindingHint')}</p>
      {!!adapter.dependencies.length && <p>{t('toolDependency')} {adapter.dependencies.join(', ')}</p>}
      <div className={css.tabs}>
        <button disabled={!defaultEnvironment} onClick={() => void run('bind')}>{t('toolSaveBinding')}</button>
        <button disabled={adapter.bindingSource !== 'operator'}
          onClick={() => void run('reset-binding')}>{t('toolResetBinding')}</button>
      </div>
    </fieldset>}
    {busy && <p role="status">{t('toolOperationPending')}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {error && <p role="alert">{error}</p>}
    {result?.tool && <div className={css.card}>
      <strong>{result.tool.id} · {t(result.tool.status === 'available' ? 'toolAvailable' : 'toolProbeError')}</strong>
      <p><code>{result.tool.command}</code></p>
      {result.tool.version && <pre>{result.tool.version}</pre>}
      {result.tool.detail && <pre role="alert">{result.tool.detail}</pre>}
    </div>}
  </section>
}
