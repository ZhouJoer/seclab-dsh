/** Session-scoped Helper switch and durable consultation cards. */
import { useState } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HelperState, HelperMode } from '@deepseek-ai/dsh-helper/types'
import type { HelperKey } from './locales.ts'
import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './Helper.module.css'

/** Actions scoped to the currently displayed session. */
export interface UsageActions {
  toggle: (enabled: boolean, mode?: HelperMode) => Promise<void>
  openChild: (id: SessionId) => void
  configure: () => void
}

const metrics = [['inputTokens', 'input'], ['outputTokens', 'output'], ['cacheReadTokens', 'cache'], ['cacheWriteTokens', 'cacheWrite'], ['reasoningTokens', 'reasoning']] as const

function metricRows(calls: Readonly<HelperState['calls']>, t: (key: HelperKey) => string): string[] {
  return metrics.map(([key, label]) => {
    const reported = calls.flatMap(call => call.usage?.[key] === undefined ? [] : [call.usage[key]])
    return `${t(label)}: ${reported.length === 0 ? t('unreported') : reported.reduce((a, b) => a + b, 0).toLocaleString() + (reported.length < calls.length ? ` · ${t('unreported')}: ${calls.length - reported.length}` : '')}`
  })
}

/**
 * Show the persisted session policy and consultation totals.
 * @param props Durable projection and session command.
 * @returns Composer switch and statistics menu.
 */
export function HelperControl(props: Pick<PropsRuntime<'conversation.input.left'>, 'useProjection'> & PropsLocale<'helper'> & Pick<UsageActions, 'toggle' | 'configure'>) {
  const state = props.useProjection('helper')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!state) return null
  const { t } = props
  const selected = state.enabled ? state.mode : 'off'
  const items: MenuEntry[] = [
    ...(['off', 'normal', 'proactive'] as const).map(mode => ({ id: mode, label: t(mode), disabled: busy || selected === mode })),
    { type: 'label', id: 'mode-hint', text: t('modeHint') },
    { id: 'configure', label: t('configure') },
    ...(['completed', 'error', 'aborted', 'interrupted', 'running'] as const).map(status => ({ type: 'label' as const, id: status, text: `${t(status)}: ${state.calls.filter(call => call.status === status).length}` })),
    { type: 'label', id: 'elapsed', text: `${t('elapsed')}: ${(state.calls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0) / 1000).toFixed(1)} ${t('seconds')}` },
    ...metricRows(state.calls, t).map((text, index) => ({ type: 'label' as const, id: `metric-${index}`, text })),
  ]
  return <span><Menu open={open} onClose={() =>{  setOpen(false) }} portal side="top" compact items={items}
    anchor={<button className={css.trigger} type="button" aria-expanded={open} disabled={busy} onClick={() =>{  setOpen(!open) }}>{t('title')}: {t(selected)} · {state.calls.length}</button>}
    onSelect={(id) => {
      setOpen(false)
      if (id === 'configure') { props.configure(); return }
      if (id !== 'off' && id !== 'normal' && id !== 'proactive') return
      setBusy(true); setError('')
      void props.toggle(id !== 'off', id === 'proactive' ? 'proactive' : 'normal').catch((reason: unknown) =>{  setError(String(reason)) }).finally(() =>{  setBusy(false) })
    }} />{error && <span role="alert">{error}</span>}</span>
}

/**
 * Present a consultation beside its model-visible tool result.
 * @param props Raw tool data plus its durable execution projection.
 * @returns Consultation status, materials and advice.
 */
export function HelperToolCard(props: Pick<PropsRuntime<'tool.call.toolview'>, 'callId' | 'useProjection'>
  & PropsLocale<'helper'> & Pick<UsageActions, 'openChild'> & ToolCallPhaseProps) {
  const state = props.useProjection('helper')
  const call = state?.calls.find(item => item.callId === props.callId)
  const { t } = props
  const output = props.phase === 'result' ? props.block.content.map(item => item.type === 'text' ? item.text : '').join('\n') : ''
  const status = call?.status ?? (props.phase === 'result' ? props.block.isError ? 'error' : 'completed' : 'running')
  return <section className={css.record} data-tool="advisor">
    <div><strong>{t('title')}</strong> · {t(status)}</div>
    {call && <div className={css.metrics}><span>{t(call.backend)} · {call.model}</span>
      <span>{t('effort')}: {call.reasoningEffort ?? t('providerDefault')}</span>
      <span>{t('elapsed')}: {call.elapsedMs === undefined ? t('unreported') : `${(call.elapsedMs / 1000).toFixed(1)} ${t('seconds')}`}</span></div>}
    {props.phase !== 'preparing' && <details><summary>{t('materials')}</summary><pre>{props.phase === 'start' ? props.block.argsRaw : props.block.call?.argsRaw}</pre></details>}
    {output && <details open><summary>{t('answer')}</summary><pre>{output}</pre></details>}
    <div className={css.metrics}>{metricRows(call ? [call] : [], t).map(text => <span key={text}>{text}</span>)}</div>
    {call?.childSessionId && <button type="button" onClick={() => { if (call.childSessionId) props.openChild(call.childSessionId) }}>{t('child')}</button>}
  </section>
}
