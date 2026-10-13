/** Saved model selections and official ChatGPT account controls. */
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { useState } from 'react'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HelperFace } from './controller.ts'
import css from './Helper.module.css'

/**
 * Render Helper preferences without issuing inference during save.
 * @param props Form, account directory and staged actions.
 * @returns Plugin settings page or summary.
 */
export function HelperSettingsCard(props: PropsRuntime<'plugins.item'> & PropsLocale<'helper'> & InjectFace<HelperFace & { hooks: { helperWorkspaces: ObservableSnapshot<WorkspaceSnapshot> } }>) {
  const state = props.useHelperForm(value => value)
  const directory = props.useHelperDirectory(value => value)
  const workspaces = props.useHelperWorkspaces(value => value.items)
  const [testWorkspace, setTestWorkspace] = useState('')
  const { t } = props
  if (props.view === 'summary') return t('description')
  const value = state.values
  const api = value.backend === 'api'
  const candidates = api ? directory.api : directory.codex
  const model = api ? value.model : value.codexModel
  const selected = candidates.find(item => item.id === model && (!api || item.provider === value.provider))
  const effort = api ? value.reasoningEffort : value.codexReasoningEffort
  const invalid = !selected || (effort !== '' && !selected.efforts.includes(effort))
  const disabled = !state.writable || state.saving
  return <SettingsForm state={{ ...state, invalid: state.invalid || invalid }} onSave={props.save} onDiscard={props.discard}
    labels={{ save: t('save'), saving: t('saving'), saveFailed: t('saveFailed'), unavailable: t('unavailable'), readOnly: t('readOnly') }}>
    <div className={css.card}>
      <label><input type="checkbox" disabled={disabled} checked={value.enabled === 'true'} onChange={(event) =>{  props.edit('enabled', String(event.target.checked)) }} />{t('enabled')}</label>
      <p className={css.muted}>{t('sessionHint')}</p>
      <label className={css.field}>{t('backend')}<select disabled={disabled} value={value.backend} onChange={(event) =>{  props.edit('backend', event.target.value) }}>
        <option value="codex">{t('codex')}</option><option value="api">{t('api')}</option>
      </select></label>
      {api ? <p className={css.muted}>{t('apiHint')}</p> : <section className={css.card}>
        <span>{directory.account === null ? t('loading') : directory.account.loggedIn ? t('loggedIn') : t('loggedOut')}
          {directory.account?.email && ` · ${directory.account.email}`}{directory.account?.planType && ` · ${directory.account.planType}`}</span>
        <div className={css.actions}>
          <button type="button" disabled={directory.busy || !!directory.loginId} onClick={props.login}>{t('login')}</button>
          {directory.loginId && <button type="button" disabled={directory.busy} onClick={props.cancelLogin}>{t('cancelLogin')}</button>}
          {directory.authUrl && <a href={directory.authUrl} target="_blank" rel="noreferrer">{t('openLogin')}</a>}
        </div>
      </section>}
      <label className={css.field}>{t('model')}<select disabled={disabled || directory.loading} value={selected?.key ?? '__missing__'} onChange={(event) =>{  props.chooseModel(value.backend, event.target.value) }}>
        {!selected && <option value="__missing__">{model || t('choose')}</option>}
        {candidates.map(item => <option key={item.key} value={item.key}>{item.name} · {item.id}</option>)}
      </select></label>
      <label className={css.field}>{t('effort')}<select disabled={disabled || !selected} value={effort} onChange={(event) =>{  props.edit(api ? 'reasoningEffort' : 'codexReasoningEffort', event.target.value) }}>
        {effort !== '' && !selected?.efforts.includes(effort) && <option value={effort}>{effort === '__choose__' ? t('chooseEffort') : effort}</option>}
        <option value="">{t('providerDefault')}</option>
        {selected?.efforts.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
      {invalid && <p role="status">{t('invalid')}</p>}
      <div className={css.actions}><button type="button" disabled={directory.loading} onClick={props.refresh}>{directory.loading ? t('loading') : t('refresh')}</button>
        <select aria-label={t('testWorkspace')} value={testWorkspace} onChange={(event) =>{  setTestWorkspace(event.target.value) }}>
          <option value="">{t('testWorkspace')}</option>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
        </select>
        <button type="button" disabled={!testWorkspace || state.dirty || state.saving || invalid || directory.busy} onClick={() => {
          const selectedWorkspace = workspaces.find(item => item.workspaceId === testWorkspace)
          if (selectedWorkspace) props.test(selectedWorkspace.workspaceId)
        }}>{t('test')}</button></div>
      <p className={css.muted}>{t('testHint')}</p>
      {directory.error && <p role="alert" className={css.error}>{directory.error}</p>}
    </div>
  </SettingsForm>
}
