import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConsultationId } from '@deepseek-ai/dsh-helper/types'
import { helperProjection } from '../../../subagent/helper/src/projection.ts'
import type { HelperState } from '@deepseek-ai/dsh-helper/types'
import { Config, resolveConfig } from '../src/config.ts'
import { buildRequest } from '../src/evidence.ts'
import { excerpt, progressProjection } from '../src/projection.ts'
import type { ProgressState } from '../src/types.ts'

const config = resolveConfig(Config({}))
const evidence = (): ProgressState => ({ turn: 1, completedSteps: 3, lastCheck: 0, consultations: 0,
  task: 'Inspect the failure', previousAdvice: '', hasTools: false,
  tools: [1, 2, 3].map(index => ({ id: ToolCallId(`call-${index}`), seq: index, step: index, name: 'probe', arguments: '{}', result: 'Failure' })),
})

describe('Jev configuration and evidence', () => {
  it('defaults off and rejects invalid enabled credentials, bounds and insecure remote endpoints', () => {
    expect(config.enabled).toBe(false)
    expect(() => resolveConfig(Config({ enabled: true }))).toThrow('apiKey')
    expect(() => resolveConfig(Config({ checkEverySteps: 0 }))).toThrow()
    expect(() => resolveConfig(Config({ probabilityThreshold: 2 }))).toThrow()
    for (const endpoint of ['http://example.com', 'https://user:password@example.com', 'https://example.com?key=secret']) {
      expect(() => resolveConfig(Config({ endpoint }))).toThrow('HTTPS')
    }
  })

  it('bounds complete serialized UTF-8 requests and keeps call/result pairs together', () => {
    const state = evidence()
    state.tools = state.tools.map(tool => ({ ...tool, result: '证据'.repeat(1000) }))
    const small = resolveConfig(Config({ maxRequestBytes: 9000 }))
    const request = buildRequest(state, small)
    expect(Buffer.byteLength(request)).toBeLessThanOrEqual(small.maxRequestBytes)
    const parsed = JSON.parse(request) as { state: { recentSteps: Array<{ arguments: string; result: string }> } }
    expect(parsed.state.recentSteps.length).toBeLessThan(3)
    expect(parsed.state.recentSteps.every((tool: { arguments: string; result: string }) => tool.arguments && tool.result)).toBe(true)
    expect(() => buildRequest(state, Config({ maxRequestBytes: 1 }))).toThrow('input-too-large')
    expect(() => buildRequest({ ...state, tools: [] }, config)).toThrow('input-too-large')
  })

  it('accounts for exact byte limits and excludes incomplete calls', () => {
    const state = evidence()
    state.tools.push({ id: ToolCallId('pending'), seq: 4, step: 4, name: 'probe', arguments: '{}' })
    const request = buildRequest(state, config)
    expect(buildRequest(state, Config({ maxRequestBytes: Buffer.byteLength(request) }))).toBe(request)
    expect(request).not.toContain('pending')
  })

  it('marks truncation inside the limit without breaking surrogate pairs', () => {
    expect(excerpt('short', 20)).toBe('short')
    expect(excerpt('very long', 1)).toBe('[')
    expect(excerpt('😀'.repeat(20), 12)).toBe('[truncated]')
  })

  it('counts one step for multiple tools and reconstructs progress without side effects', () => {
    const session = Session.create(SessionId('projection'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Investigate.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    for (const id of ['one', 'two']) session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(id), name: 'probe', arguments: '{}' })
    session.append('step/end', { turn: 1, step: 1 })
    const projection = progressProjection(config)
    let state = projection.init(session.header, session.inheritedEventCount)
    for (const event of session.snapshotEvents()) state = projection.apply(state, event)
    expect(state.completedSteps).toBe(1)
    expect(state.tools).toHaveLength(2)
    expect(state.task).toBe('Investigate.')
  })

  it('restores an unfinished automatic consultation as interrupted without a tool ID', () => {
    const session = Session.create(SessionId('restore'))
    const data = { consultationId: brandString<ConsultationId>('auto-1'), backend: 'api' as const, model: 'expert', startedAt: 1,
      status: 'running' as const, question: { reason: 'stalled', question: 'Inspect.' } }
    session.append('helper/auto-start', data)
    session.append('helper/auto-start', data)
    session.append('session/end-seed', {})
    let state: HelperState = helperProjection.init()
    for (const event of session.snapshotEvents()) state = helperProjection.apply(state, event)
    expect(state.calls).toMatchObject([{ consultationId: 'auto-1', status: 'interrupted' }])
  })
})
