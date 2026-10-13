/** Logged research-progress reminders and admission checks over persisted invocation counts. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { SecurityController } from './workbench/controller.ts'
import { adapterToolId } from './tool-adapter-catalog.ts'

const explorationTools = new Set(['bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'glob', 'grep',
  'web_search', 'web_fetch', 'security_static', 'security_execute', 'security_delegate'])
/** Admission denial shared with execution accounting; a progress request is not an analysis attempt. */
export const ANALYSIS_PROGRESS_REQUIRED = 'Save research progress with security_command action checkpoint before continuing analysis. '
  + 'Read security_scope and security_help action checkpoint as needed. Update the current checkpoint by id only '
  + 'when the question and phase are unchanged; otherwise create a new direction with its own title and reason. '
  + 'Record the current conclusion, next action or blocker, and existing evidence and finding references. '
  + 'For native analysis, use security_capture_analysis to save relevant calls first. Do not invent evidence or '
  + 'split an unchanged question merely to reset the call count.'

/** Require periodic coordinator progress without interrupting evidence capture, job cleanup or child reports.
 * @param ctx - plugin context owning the disposable prompt contribution and execution guard.
 * @param limit - configured recorded-call interval, checked before exploration tool admission.
 * @param controller - initialized project owner, unavailable while startup is pending.
 */
export function installAnalysisProgress(ctx: Context, limit: number, controller: () => SecurityController | undefined): void {
  const state = (sessionId: string) => {
    const owner = controller()
    const binding = owner?.binding(sessionId)
    if (!owner?.activity || binding?.role !== 'coordinator') return undefined
    const checkpoint = owner.view(sessionId).records.filter(record => record.kind === 'checkpoint').at(-1)?.value
    const { pending } = owner.activity.progress(binding.engagementId, sessionId, checkpoint)
    return { checkpoint, pending }
  }
  ctx.systemPrompt.context({ name: 'security:research-progress', order: ctx.systemPrompt.getContextOrder('SANDBOX_POLICY'),
    text: ({ agent }) => {
      const current = agent && state(agent.id)
      if (!current || current.pending < limit) return ''
      return 'Research progress: ' + JSON.stringify({ checkpointId: current.checkpoint?.id,
        title: current.checkpoint?.title, callsSinceCheckpoint: current.pending, callInterval: limit }) + '. '
        + ANALYSIS_PROGRESS_REQUIRED
    },
  })
  ctx.tools.guard((exec) => {
    if (!exec.agent || !(explorationTools.has(exec.name) || adapterToolId(exec.name))) return undefined
    const current = state(exec.agent.id)
    return current && current.pending >= limit ? ANALYSIS_PROGRESS_REQUIRED : undefined
  })
}
