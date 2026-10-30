import { expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { recordCodexTool } from '../src/tool-records.ts'

it('retains tool input and failed output without adding parent model messages', () => {
  const session = Session.create(SessionId('parent'))
  const before = session.deriveMessages()
  const item = { id: 'read-1', type: 'commandExecution', command: 'read sample', cwd: '/work' }
  recordCodexTool(session, { threadId: 'advisor', phase: 'started', item }, 4096)
  recordCodexTool(session, { threadId: 'advisor', phase: 'completed', item: {
    ...item, status: 'failed', exitCode: 1, aggregatedOutput: 'missing file',
  } }, 4096)
  const records = session.snapshotEvents().filter(record => record?.type === 'subagent-codex/tool')
  expect(records).toHaveLength(2)
  expect(records[0]?.data).toMatchObject({ childSessionId: 'advisor', itemId: 'read-1', phase: 'started', truncated: false })
  expect(records[1]?.data).toMatchObject({ phase: 'completed', record: expect.stringContaining('missing file') })
  expect(session.deriveMessages()).toEqual(before)
  const restored = Session.fromRestore(session.id, structuredClone(session.snapshotEvents()), session.header, SessionLogOffset(0), 'detached')
  expect(restored.snapshotEvents().filter(record => record?.type === 'subagent-codex/tool')).toEqual(records)
  expect(restored.deriveMessages()).toEqual(before)
})

it('bounds multibyte observations and preserves the original byte count', () => {
  const session = Session.create(SessionId('bounded'))
  const item = { id: 'large', type: 'commandExecution', aggregatedOutput: '证据'.repeat(1000) }
  recordCodexTool(session, { threadId: 'advisor', phase: 'completed', item }, 257)
  const record = session.snapshotEvents()[0]!
  expect(record?.type).toBe('subagent-codex/tool')
  expect(record?.data).toMatchObject({ originalBytes: Buffer.byteLength(JSON.stringify(item)), truncated: true })
  const data = record?.data as { record: string }
  expect(Buffer.byteLength(data.record)).toBeLessThanOrEqual(257)
  expect(data.record).not.toContain('\ufffd')
})
