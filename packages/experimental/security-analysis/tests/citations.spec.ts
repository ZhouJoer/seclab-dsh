/** Citations resolve only exact, already committed read windows. @module */
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { resolveCitation } from '../src/citations.ts'
const cwd = resolve('nonexistent-workspace')
function read(id: string, seq: number, text: string, truncatedLines: number[] | null = []): SessionEvent[] {
  return [{ type: 'tool/call', seq: SessionSeq(seq), time: 0,
    data: { turn: 1, step: 1, callId: ToolCallId(id), name: 'read', arguments: '{}' } },
  { type: 'tool/result', seq: SessionSeq(seq + 1), time: 0, surfaceOp: 'append', data: { turn: 1, step: 1,
    message: createToolResultMessage({ callId: ToolCallId(id), content: [{ type: 'text', text }], isError: false }),
    meta: { path: resolve(cwd, 'src/login.ts'), lines: [{ number: 3, text }], ...(truncatedLines === null ? {} : { truncatedLines }) } } }]
}
const reference = { kind: 'source' as const, path: 'src/login.ts', startLine: 3, endLine: 3 }
it('selects the most recent single observation without opening the file', () => {
  const events = [...read('first', 0, 'old'), ...read('second', 2, 'new')]
  expect(resolveCitation(events, 0, cwd, reference)).toMatchObject({ callId: 'second', incomplete: false, citation: { text: 'new' } })
  expect(resolveCitation(events, 0, cwd, { ...reference, callId: 'first' }).citation?.text).toBe('old')
})
it('rejects missing ranges, inherited observations, pending calls and truncated lines', () => {
  const events = read('first', 0, 'line')
  expect(() => resolveCitation(events, 0, cwd, { ...reference, endLine: 4 })).toThrow('No committed read')
  expect(() => resolveCitation(events, 2, cwd, reference)).toThrow('No committed read')
  expect(() => resolveCitation(events.slice(0, 1), 0, cwd, reference)).toThrow('No committed read')
  expect(() => resolveCitation(read('first', 0, 'short', [3]), 0, cwd, reference)).toThrow('truncated')
})
it('retains uncertainty for legacy read metadata', () => {
  const events = read('first', 0, 'old', null)
  expect(resolveCitation(events, 0, cwd, reference).incomplete).toBe(true)
})
