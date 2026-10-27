/** Optional immutable security material and evidence adapters. @module */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-experimental-security-analysis/remote'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-security-analysis/client'
import type { ResearchResource } from '@deepseek-ai/dsh-experimental-research-workbench/client'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

const en = { open: 'Preview in window', compare: 'Add to comparison', unavailable: 'This resource cannot be read as text' }
const zh = { open: '大窗口预览', compare: '加入比较', unavailable: '此资源无法作为文本读取' }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'research-security': keyof typeof en } }
/** Independently disabled bridge dependencies. */
export const inject = ['researchWorkbench', 'remote', 'remote.securityWorkbench', 'slots', 'locale']
type Props = PropsRuntime<'security.resource.actions.item'> & PropsLocale<'research-security'> & { open(resource: ResearchResource, compare: boolean): void }
function Actions(props: Props) {
  const item = props.resource
  const resource: ResearchResource = { source: 'security', group: `security:${props.projectId}`,
    id: JSON.stringify(['security', props.projectId, item.kind, item.kind === 'material' ? item.assetId : item.evidenceId, item.kind === 'material' ? item.path : item.sha256]),
    label: item.label, ...(props.sessionId ? { sessionId: props.sessionId } : {}),
    locator: item.kind === 'material' ? { project: props.projectId, kind: item.kind, asset: item.assetId, path: item.path, ...(item.sourceRoot ? { sourceRoot: item.sourceRoot } : {}) }
      : { project: props.projectId, kind: item.kind, evidence: item.evidenceId, sha256: item.sha256 } }
  return <><Button size="sm" onClick={() =>{  props.open(resource, false) }}>{props.t('open')}</Button>
    <Button size="sm" onClick={() =>{  props.open(resource, true) }}>{props.t('compare')}</Button></>
}
/** Register the adapter and resource commands; disabling removes both.
 * @param ctx - optional research and security services. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('research-security', { en, zh }))
  ctx.effect(() => ctx.researchWorkbench.registerSource({ id: 'security', async read(resource, signal) {
    const locator = resource.locator
    if (locator.kind === 'material') {
      const result = await ctx.remote.securityWorkbench.projectMaterialDocument(locator.project ?? '', JSON.stringify({ assetId: locator.asset, path: locator.path }), signal)
      signal.throwIfAborted()
      if (!result.ok) return result
      if (result.value.kind === 'text') return { ok: true, value: { text: result.value.text, complete: !result.value.truncated,
        version: result.value.version, language: (locator.path || resource.label).split('.').at(-1) ?? 'text' } }
      if (result.value.kind === 'pdf' || result.value.kind === 'image') return { ok: true, value: {
        text: '', complete: true, version: result.value.version, language: '', media: {
          kind: result.value.kind, data: result.value.data,
          mediaType: result.value.kind === 'pdf' ? 'application/pdf' : result.value.mediaType,
          missingFonts: result.value.kind === 'pdf' ? result.value.missingFonts : [],
        },
      } }
      return { ok: true, value: { text: result.value.hex, complete: false, version: result.value.version, language: 'text' } }
    } else {
      const result = await ctx.remote.securityWorkbench.projectArtifact(locator.project ?? '', locator.sha256 ?? '')
      signal.throwIfAborted()
      if (!result.ok) return result
      const value: unknown = JSON.parse(result.value)
      if (typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string' && 'truncated' in value && typeof value.truncated === 'boolean'
        && (!('binary' in value) || !value.binary)) return { ok: true, value: { text: value.text, complete: !value.truncated, version: locator.sha256 ?? '', language: 'json' } }
    }
    return { ok: false, error: new RemoteError('gateway/bad-request', ctx.locale.bind('research-security')('unavailable'), {}) }
  } }))
  ctx.slots.inject('security.resource.actions.item', () => ctx.slots.register({ name: 'security.resource.actions.item', id: 'research-security', locale: 'research-security',
    inject: () => ({ open: (resource: ResearchResource, compare: boolean) => {
      if (compare) ctx.researchWorkbench.compare(resource)
      else ctx.researchWorkbench.open(resource, { floating: true })
    } }) }, Actions))
}
