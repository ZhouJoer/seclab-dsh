/** Opt-in output limits and one delivery-only recovery for a workspace's main agents. */
import { normalize, resolve } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { installOutputRecovery } from '@deepseek-ai/dsh-helper'

export const name = 'local-output-delivery'
export const inject = ['agents']
export const Config = Schema.object({
  enabled: Schema.boolean().default(false),
  workspace: Schema.string().default(''),
  primaryMaxTokens: Schema.number().default(32768),
  recoveryReasoningEffort: Schema.string().default('low'),
  recoveryMaxTokens: Schema.number().default(8192),
})
const schema = z.object({
  enabled: z.boolean(), workspace: z.string(),
  primaryMaxTokens: z.number().int().positive(),
  recoveryReasoningEffort: z.string().min(1),
  recoveryMaxTokens: z.number().int().positive(),
})
const pathKey = value => {
  const path = normalize(resolve(value))
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** Install limits only for main agents in the explicitly configured workspace. */
export function apply(ctx, input) {
  const config = schema.parse(input)
  if (!config.enabled) return
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(config.workspace)) throw new Error('output-delivery: workspace must be an absolute path')
  const controllers = new Map()
  const lifetime = new AbortController()
  const restoreLimit = (agent, original) => {
    if (!original || original.maxTokens === config.primaryMaxTokens) return
    let applied = false
    const releaseRequest = agent.ctx.on('agent/request', async ({ agent: current }, next) => {
      const request = await next()
      if (current !== agent) return request
      applied = true
      if (request.provider !== original.provider || request.model !== original.model || request.maxTokens !== config.primaryMaxTokens) return request
      const { maxTokens: _limit, ...rest } = request
      return original.maxTokens === undefined ? rest : { ...rest, maxTokens: original.maxTokens }
    }, { prepend: true })
    const releaseCommit = agent.ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'request/header' || !applied) return
      releaseRequest(); releaseCommit()
    })
  }
  const install = agent => {
    if (lifetime.signal.aborted || controllers.has(agent.id) || agent.session.header.origin === 'subagent'
      || agent.session.header.parentSession !== undefined || typeof agent.session.header.cwd !== 'string'
      || pathKey(agent.session.header.cwd) !== pathKey(config.workspace)) return
    let originalLimit
    const detachLimit = agent.ctx.on('agent/request', async ({ agent: current }, next) => {
      const request = await next()
      if (current !== agent) return request
      if (!recovery.isRecovering && (originalLimit === undefined || request.maxTokens !== config.primaryMaxTokens
        || request.provider !== originalLimit.provider || request.model !== originalLimit.model)) {
        originalLimit = { provider: request.provider, model: request.model, maxTokens: request.maxTokens }
      }
      return { ...request, maxTokens: Math.min(request.maxTokens ?? config.primaryMaxTokens, config.primaryMaxTokens) }
    })
    const recovery = installOutputRecovery(agent, {
      reasoningEffort: config.recoveryReasoningEffort, maxTokens: config.recoveryMaxTokens,
      resetOnUserInput: true,
      canRecover: () => !lifetime.signal.aborted
        && ![...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user'),
    })
    let shutdown
    controllers.set(agent.id, () => shutdown ??= (async () => {
      try { await recovery.dispose() } finally {
        if (ctx.agents.get(agent.id) === agent && agent.ctx.fiber.uid !== null) restoreLimit(agent, originalLimit)
        detachLimit()
      }
    })())
  }
  ctx.on('agent/created', ({ agent }) => install(agent))
  ctx.on('agent/disposed', async ({ agent }) => {
    try { await controllers.get(agent.id)?.() } finally { controllers.delete(agent.id) }
  })
  for (const agent of ctx.agents.list()) install(agent)
  ctx.effect(() => async () => {
    lifetime.abort()
    const results = await Promise.allSettled([...controllers.values()].map(dispose => dispose()))
    controllers.clear()
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'Output delivery cleanup failed')
  }, 'output-delivery.release')
}
