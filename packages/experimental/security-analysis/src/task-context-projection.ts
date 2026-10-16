/** Independently logged task context, restored from committed Session events. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { isReplacementSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { EngagementId } from './workbench/model.ts'
import { renderTaskContext, resolveTaskContext, taskContextSchema, type TaskContext } from './task-context.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Current operator task declaration, independent of progress updates.
     * @persistenceAttribution
     */
    'security-task-context': ContextFormed & {
      kind: 'security-task-context'
      projectId: EngagementId | null
      context: TaskContext | null
    }
  }
}

const stateSchema = z.object({
  latest: z.object({
    projectId: z.string().transform(brandString<EngagementId>).nullable(),
    context: taskContextSchema.nullable(), text: z.string(),
  }).strict().nullable(),
  retained: z.number().int().nonnegative().transform(SessionSeq).nullable(),
}).strict()
type ContextState = z.infer<typeof stateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    securityTaskContext: ContextState
  }
}

const projection: ProjectionDefinition<'securityTaskContext'> = {
  key: 'securityTaskContext', stateSchema, stateVersion: 0,
  init: () => ({ latest: null, retained: null }),
  apply(state, event) {
    if (event.type === 'user/message' && event.data.source.kind === 'security-task-context') {
      const { projectId, context } = event.data.source
      return { latest: { projectId, context,
        text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('') }, retained: event.seq }
    }
    if (state.retained !== null && isReplacementSurfaceEvent(event) && event.sourceEventSeqs?.includes(state.retained))
      return { ...state, retained: null }
    return state
  },
}

/** Install task-context projection and overflow retry recovery without creating requests.
 * @param ctx - security plugin context, owning all subscriptions.
 * @param resolve - current bound project or provisional same-turn snapshot.
 * @param maxBytes - complete rendered snapshot limit.
 * @returns candidate message producer; the normal loop commits candidates after pre-step accepts.
 */
export function installTaskContext(ctx: Context,
  resolve: (agent: Agent) => { projectId: EngagementId | null; context: TaskContext | undefined },
  maxBytes: number): (agent: Agent) => UserMessage | undefined {
  ctx.sessionProjections.register(projection)
  const project = (agent: Agent): UserMessage | undefined => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'securityTaskContext')
    const current = resolve(agent)
    const context = resolveTaskContext(current.context, maxBytes)
    if (!context && !state?.latest) return undefined
    const text = renderTaskContext(context, Date.now())
    if (state?.retained !== null && state?.latest?.text === text && state.latest.projectId === current.projectId) return undefined
    return createUserMessage({ source: { kind: 'security-task-context', form: 'snapshot',
      sections: [{ name: 'security:task-context', text }], projectId: current.projectId, context: context ?? null },
    content: [{ type: 'text', text }] })
  }
  ctx.on('agent/request-error', async ({ agent, signal }, next) => {
    const action = await next()
    if (action?.kind === 'retry' && !signal.aborted) {
      const message = project(agent)
      if (message) agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
    return action
  }, { prepend: true })
  return project
}
