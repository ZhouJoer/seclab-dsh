/** Reversible per-Agent module views derived only from committed task state. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import { moduleAllowsTool, moduleSkills, resolveModuleSelection } from './analysis-modules.ts'
import { installSecurityMethods } from './methods.ts'
import { toolsForRole } from './workbench/roles.ts'
import type { SecurityController } from './workbench/controller.ts'
import type { SecurityJournal } from './workbench/journal.ts'

/** Keep skills and tool restrictions synchronized before the next request assembly.
 * @param ctx - plugin lifetime with skills, agents and tools available.
 * @param controller - initialized task owner.
 * @param journal - committed task notifications.
 */
export function installModuleRuntime(ctx: Context, controller: SecurityController, journal: SecurityJournal): void {
  const views = new Map<Agent, { key: string; dispose(): void }>()
  let skillsAvailable = false
  let disposed = false
  const refresh = (agent: Agent) => {
    if (disposed) return
    const binding = controller.binding(agent.id)
    const selection = controller.moduleSelection(agent.id)
    const key = JSON.stringify([binding, selection, skillsAvailable])
    if (views.get(agent)?.key === key) return
    views.get(agent)?.dispose()
    views.delete(agent)
    const skills = skillsAvailable ? installSecurityMethods(agent.ctx, moduleSkills(selection)) : () => {}
    try {
      const allow = ctx.tools.schemas(scopeParentOf(agent)).filter(tool =>
        toolsForRole(binding?.role).includes(tool.name) && moduleAllowsTool(tool.name, selection)).map(tool => tool.name)
      const tools = agent.ctx.get('tools')
      if (!tools) throw new Error('Module views require the tools service')
      const restrict = tools.restrict({ allow })
      views.set(agent, { key, dispose() { restrict(); skills() } })
    } catch (error) { skills(); throw error }
  }
  ctx.effect(() => {
    const off = journal.subscribeAll(() => { for (const agent of ctx.agents.list()) refresh(agent) })
    return () => { disposed = true; off(); for (const view of views.values()) view.dispose(); views.clear() }
  })
  ctx.inject(['skills'], (skillCtx) => {
    skillsAvailable = true
    for (const agent of ctx.agents.list()) refresh(agent)
    skillCtx.effect(() => () => {
      skillsAvailable = false
      for (const agent of ctx.agents.list()) refresh(agent)
    })
  })
  ctx.on('agent/created', ({ agent }) => { refresh(agent) })
  ctx.on('agent/disposed', ({ agent }) => { views.get(agent)?.dispose(); views.delete(agent) })
  ctx.systemPrompt.context({ name: 'security:modules', order: ctx.systemPrompt.getContextOrder('SANDBOX_POLICY'),
    text: ({ agent }) => agent ? 'Active analysis modules: ' + JSON.stringify(resolveModuleSelection(controller.moduleSelection(agent.id)))
      + '. In auto mode the coordinator selects relevant modules with security_command action modules before specialist analysis. Manual mode requires an operator change. A module grants no additional permission.' : '' })
  for (const agent of ctx.agents.list()) refresh(agent)
}
