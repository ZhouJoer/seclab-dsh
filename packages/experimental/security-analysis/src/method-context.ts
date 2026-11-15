/** Retained method instructions supplied before task work and selected specialist operations. @module */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { isReplacementSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { isModelInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { z } from 'zod'
import { analysisModules } from './analysis-modules.ts'
import type { SecurityController } from './workbench/controller.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Method instructions supplied by the selected security task or module.
     * @persistenceAttribution
     */
    'security-method': { kind: 'security-method'; form: 'instructions'; name: string }
  }
}

const stateSchema = z.object({
  calls: z.record(z.string(), z.string()),
  retained: z.array(z.object({ name: z.string(), seq: z.number().int().nonnegative().transform(SessionSeq) })),
})
type MethodState = z.infer<typeof stateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    securityMethods: MethodState
  }
}

const projection: ProjectionDefinition<'securityMethods'> = {
  key: 'securityMethods', stateSchema, stateVersion: 1,
  init: () => ({ calls: {}, retained: [] }),
  apply(state, event) {
    if (isReplacementSurfaceEvent(event) && event.sourceEventSeqs?.length)
      state = { ...state, retained: state.retained.filter(item => !event.sourceEventSeqs?.includes(item.seq)) }
    if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind === 'security-method' || source.kind === 'skill-invocation')
        return { ...state, retained: [...state.retained, { name: source.name, seq: event.seq }] }
    }
    if (event.type === 'tool/call' && event.data.name === 'skill') {
      let args: unknown
      try { args = JSON.parse(event.data.arguments) }
      catch (error) { if (error instanceof SyntaxError) return state; throw error }
      const parsed = z.object({ name: z.string() }).safeParse(args)
      if (parsed.success) return { ...state, calls: { ...state.calls, [event.data.callId]: parsed.data.name } }
    }
    if (event.type === 'tool/result') {
      const name = state.calls[event.data.message.toolCallId]
      if (name === undefined) return state
      const { [event.data.message.toolCallId]: _completed, ...calls } = state.calls
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const complete = !event.data.message.isError && text.includes('<skill_content name="' + name + '">')
        && text.endsWith('</skill_content>')
      return { calls, retained: complete ? [...state.retained, { name, seq: event.seq }] : state.retained }
    }
    return state
  },
}

function suppliedMethods(messages: readonly UserMessage[]): Set<string> {
  return new Set(messages.flatMap(message => message.source.kind === 'security-method' || message.source.kind === 'skill-invocation'
    ? [message.source.name] : []))
}

/** Supply only missing entry methods through the logged pre-step input path.
 * @param ctx - plugin lifetime with the Session projection registry.
 * @param controller - committed task and module selection owner.
 */
export function installMethodContext(ctx: Context, controller: SecurityController): void {
  ctx.sessionProjections.register(projection)
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !controller.binding(agent.id)) return decision
    const skills = ctx.get('skills')
    if (!skills) return decision
    const state = ctx.sessionProjections.stateOf(agent.session, 'securityMethods')
    if (!state) throw new Error('Security method projection is unavailable')
    const supplied = suppliedMethods(decision.messages)
    for (const item of state.retained) supplied.add(item.name)
    const selection = controller.moduleSelection(agent.id)
    const names = ['security-investigation', ...analysisModules.filter(module => selection?.modules.includes(module.id))
      .map(module => module.entrySkill)].filter(name => !supplied.has(name))
    if (!names.length) return decision
    const cwd = await ctx.get('workingDirectory')?.ensure(agent, signal) ?? agent.session.header.cwd
    const messages: UserMessage[] = []
    for (const name of names) {
      const skill = await skills.get(name, { cwd, signal, scope: agent })
      signal.throwIfAborted()
      if (!skill || !isModelInvocable(skill)) throw new Error('Selected security method is unavailable: ' + name)
      messages.push(createUserMessage({ source: { kind: 'security-method', form: 'instructions', name },
        content: [{ type: 'text', text: renderSkillContent(skill) }] }))
    }
    return { ...decision, messages: [...decision.messages, ...messages] }
  }, { prepend: true })
}
