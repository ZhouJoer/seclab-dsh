/** Mining-specialized analysis start: target submission, rediscovery mode and a generated objective. @module */
import { useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { MaterialPanel, type MaterialSelection } from './MaterialPanel.tsx'
import { resolveModuleSelection } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { AnalysisStartProps } from './AnalysisStart.tsx'
import css from './Workbench.module.css'

/** Rediscovery lead modes; the objective draft names the supplied lead. */
type MiningMode = 'patch-guided' | 'version-diff' | 'audit'
/** Target kinds; source uses a Host path snapshot, binary uploads files, web registers an HTTP target. */
type MiningTarget = 'source' | 'binary' | 'web'

/**
 * Compose the mining objective draft from the selected mode and target.
 * @param t - localized copy.
 * @param mode - rediscovery lead mode.
 * @param target - submitted target kind.
 * @param fields - current field values for the selected target and lead.
 * @returns multi-line objective text mirroring the blind bench task wording.
 */
function draftObjective(t: AnalysisStartProps['t'], mode: MiningMode, target: MiningTarget,
  fields: { sourcePath: string; secondPath: string; patchPath: string; origin: string }): string {
  const lines = [t('miningObjectiveIntro')]
  if (target === 'web' && fields.origin.trim()) lines.push(`${t('miningObjectiveWeb')} ${fields.origin.trim()}`)
  else if (fields.sourcePath.trim()) lines.push(`${t('miningObjectiveSource')} ${fields.sourcePath.trim()}`)
  if (mode === 'patch-guided' && fields.patchPath.trim()) lines.push(`${t('miningObjectivePatch')} ${fields.patchPath.trim()}`)
  if (mode === 'version-diff' && fields.secondPath.trim()) lines.push(`${t('miningObjectiveDiff')} ${fields.secondPath.trim()}`)
  if (mode === 'audit') lines.push(t('miningObjectiveAudit'))
  lines.push(t('miningObjectiveConstraints'))
  return lines.join('\n')
}

/**
 * Render the additive mining start form beside the general analysis form.
 * @param props - localized copy, configured environments and the same authenticated task actions the general form uses.
 * @returns mining task submission form. */
export function MiningStart(props: AnalysisStartProps) {
  const { t } = props
  const [mode, setMode] = useState<MiningMode>('patch-guided')
  const [target, setTarget] = useState<MiningTarget>('source')
  const [sourcePath, setSourcePath] = useState('')
  const [secondPath, setSecondPath] = useState('')
  const [patchPath, setPatchPath] = useState('')
  const [origin, setOrigin] = useState(''); const [pathPrefix, setPathPrefix] = useState('/')
  const [upload, setUpload] = useState<{ material: MaterialSelection; title: string }>()
  const [objective, setObjective] = useState('')
  const [objectiveDirty, setObjectiveDirty] = useState(false)
  const [open, setOpen] = useState(false)
  const [environment, setEnvironment] = useState<string>()
  const [prepared, setPrepared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')
  const [moduleSelection] = useState(() => resolveModuleSelection())
  const attempt = useRef<{ payload: string; operationId: string }>()
  const dockerish = props.environments.find(item => item.kind === 'docker')
  const environmentId = environment ?? dockerish?.id ?? ''
  const environmentIds = [...new Set([environmentId, props.environments.find(item => item.kind === 'local')?.id]
    .filter((id): id is string => !!id))]
  const locked = props.disabled || busy || prepared
  const hasTarget = target === 'web' ? origin.trim() !== '' : target === 'source' ? sourcePath.trim() !== '' : upload !== undefined
  const cannotStart = props.disabled || busy || selecting || prepared || !hasTarget
    || !objective.trim() || !props.environments.some(item => item.id === environmentId)
  const title = target === 'web' ? origin.trim() : target === 'source'
    ? sourcePath.trim().split(/[\\/]/).filter(Boolean).at(-1) || t('materialObjective') : upload?.title ?? ''
  const start = async (sendImmediately: boolean) => {
    setBusy(true); setError('')
    try {
      if (!prepared) {
        const material = target === 'source' ? { kind: 'path' as const, path: sourcePath.trim() }
          : target === 'binary' ? upload?.material : undefined
        const input = { material, title, objective: objective.trim(), environmentId, environmentIds,
          taskContext: props.defaultTaskContext ?? null, moduleSelection,
          ...(target === 'web' && origin.trim() ? { target: { origin: origin.trim(), pathPrefix,
            allowedAddresses: [] } } : {}) }
        const payload = JSON.stringify(input)
        if (attempt.current?.payload !== payload) attempt.current = { payload, operationId: randomUUID() }
        await props.prepare({ ...input, operationId: attempt.current.operationId })
        setPrepared(true)
      }
      if (sendImmediately) await props.send(objective.trim())
      else props.continueInChat(objective.trim())
      props.started()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <details className={css.secondaryDetails} open={open}>
    <summary onClick={(event) => { event.preventDefault(); setOpen(!open) }}>{t('miningTaskTitle')}</summary>
    {!open ? undefined : <>
      <p>{t('miningTaskHint')}</p>
      <fieldset className={css.form} disabled={locked}>
        <legend>{t('miningModeLabel')}</legend>
        {(['patch-guided', 'version-diff', 'audit'] as const).map(key =>
          <label key={key} className={css.resourceOption}><input type="radio" name="mining-mode" checked={mode === key}
            onChange={() => { setMode(key) }} />{t(key === 'patch-guided' ? 'miningModePatch' : key === 'version-diff' ? 'miningModeDiff' : 'miningModeAudit')}</label>)}
        <legend>{t('miningTargetLabel')}</legend>
        {(['source', 'binary', 'web'] as const).map(key =>
          <label key={key} className={css.resourceOption}><input type="radio" name="mining-target" checked={target === key}
            onChange={() => { setTarget(key) }} />{t(key === 'source' ? 'miningTargetSource' : key === 'binary' ? 'miningTargetBinary' : 'miningTargetWeb')}</label>)}
        {target === 'source' && <div className={css.form}>
          <label className={css.field}>{t('miningSourcePath')}<input value={sourcePath} disabled={locked}
            onChange={(event) => { setSourcePath(event.target.value) }} /></label>
          <p className={css.summaryHint}>{t('miningSourcePathHint')}</p>
          {mode === 'version-diff' && <label className={css.field}>{t('miningSecondPath')}<input value={secondPath} disabled={locked}
            onChange={(event) => { setSecondPath(event.target.value) }} /></label>}
          {mode === 'version-diff' && <p className={css.summaryHint}>{t('miningSecondPathHint')}</p>}
          {mode === 'patch-guided' && <label className={css.field}>{t('miningPatchPath')}<input value={patchPath} disabled={locked}
            onChange={(event) => { setPatchPath(event.target.value) }} /></label>}
          {mode === 'patch-guided' && <p className={css.summaryHint}>{t('miningPatchPathHint')}</p>}
        </div>}
        {target === 'binary' && <MaterialPanel t={t} disabled={locked} limits={props.limits} filesOnly
          onBusyChange={setSelecting}
          submit={(material, materialTitle) => {
            setUpload({ material, title: materialTitle })
            return Promise.resolve()
          }} />}
        {target === 'web' && <div className={css.form}>
          <label className={css.field}>{t('httpOrigin')}<input value={origin} disabled={locked}
            onChange={(event) => { setOrigin(event.target.value) }} /></label>
          <label className={css.field}>{t('httpPrefix')}<input value={pathPrefix} disabled={locked}
            onChange={(event) => { setPathPrefix(event.target.value) }} /></label>
        </div>}
      </fieldset>
      {props.limits && <p className={css.summaryHint}>{`${t('miningLimitsHint')}: ${props.limits.entries} / ${props.limits.bytes}`}</p>}
      <label className={css.field}>{t('miningObjectiveLabel')}<textarea rows={7}
        value={objectiveDirty ? objective : draftObjective(t, mode, target, { sourcePath, secondPath, patchPath, origin })}
        disabled={locked} onChange={(event) => { setObjective(event.target.value); setObjectiveDirty(true) }} /></label>
      {props.environments.length > 0 && <label className={css.field}>{t('environment')}<select value={environmentId} disabled={locked}
        onChange={(event) => { setEnvironment(event.target.value) }}>
        {props.environments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {prepared && <p>{t('analysisPrepared')}</p>}
      {!hasTarget && <p className={css.summaryHint}>{t('miningNoTarget')}</p>}
      {error && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.taskActions}>
        <button className={css.primaryAction} disabled={cannotStart} onClick={() => void start(false)}>{t('saveAnalysisAndChat')}</button>
        <button disabled={cannotStart} onClick={() => void start(true)}>{t(prepared ? 'retryAnalysis' : 'startAnalysis')}</button>
      </div>
    </>}
  </details>
}
