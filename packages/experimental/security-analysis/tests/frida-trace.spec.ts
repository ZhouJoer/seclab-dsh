/** Binary observations preserve embedded zeroes and report inaccessible memory. @module */
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { fridaTraceScript, traceSchema } from '../src/frida-trace.ts'

it('pairs entry and return observations and reads the requested length across zero bytes', () => {
  const messages: object[] = []
  const data = new Uint8Array([65, 0, 66, 0])
  const pointer = { toString: () => '0x1000', readByteArray: (length: number) => data.slice(0, length).buffer }
  const script = fridaTraceScript('sample', 'transform', traceSchema.parse({ arguments: [0], returnValue: true,
    memory: [{ argument: 0, length: 4, when: 'enter' }, { argument: 0, length: 4, when: 'leave' }], maxCalls: 1 }), 8192)
  runInNewContext(script, {
    Process: { getModuleByName: () => ({ name: 'sample', base: 0, getExportByName: () => pointer }) },
    ptr: () => pointer, send: (message: object) => messages.push(message),
    Interceptor: { attach: (_address: object, callbacks: { onEnter: (args: object[]) => void; onLeave: (value: object) => void }) => {
      const call = { threadId: 7, context: { pc: { sub: () => '0x20' } } }
      callbacks.onEnter.call(call, [pointer])
      data[2] = 67
      callbacks.onLeave.call(call, { toString: () => '0x4' })
      callbacks.onEnter.call(call, [pointer])
    } },
  })
  expect(messages).toEqual([
    expect.objectContaining({ call: 1, phase: 'enter', memory: [{ argument: 0, address: '0x1000', length: 4, hex: '41004200' }], incomplete: false }),
    expect.objectContaining({ call: 1, phase: 'leave', returnValue: '0x4', memory: [{ argument: 0, address: '0x1000', length: 4, hex: '41004300' }], incomplete: false }),
    { incomplete: true, reason: 'trace-call-limit', limit: 1 },
  ])
})

it('rejects captures that cannot fit the configured output budget before attaching', () => {
  expect(() => fridaTraceScript('sample', 'read', { arguments: [], returnValue: true,
    memory: [{ argument: 0, length: 4096, when: 'enter' }], maxCalls: 1 }, 4096)).toThrow('budget')
  expect(() => traceSchema.parse({ arguments: [0], returnValue: false,
    memory: [{ argument: 0, length: -1, when: 'enter' }], maxCalls: 1 })).toThrow()
})

it('marks unreadable memory incomplete and emits one cap marker without extra return observations', () => {
  const messages: object[] = []
  const pointer = { toString: () => '0xdead', readByteArray: () => { throw new Error('unmapped') } }
  const script = fridaTraceScript('sample', 'read', traceSchema.parse({ arguments: [], returnValue: false,
    memory: [{ argument: 0, length: 4, when: 'enter' }], maxCalls: 1 }), 8192)
  runInNewContext(script, {
    Process: { getModuleByName: () => ({ name: 'sample', base: 0, getExportByName: () => pointer }) },
    ptr: () => pointer, send: (message: object) => messages.push(message),
    Interceptor: { attach: (_address: object, callbacks: { onEnter: (args: object[]) => void; onLeave: (value: object) => void }) => {
      for (let i = 0; i < 3; i++) {
        const call = { threadId: 7, context: { pc: { sub: () => '0x20' } } }
        callbacks.onEnter.call(call, [pointer])
        callbacks.onLeave.call(call, { toString: () => '0' })
      }
    } },
  })
  expect(messages).toHaveLength(3)
  expect(messages[0]).toMatchObject({ phase: 'enter', incomplete: true,
    memory: [{ argument: 0, address: '0xdead', length: 4, error: 'Error: unmapped', incomplete: true }] })
  expect(messages[1]).toMatchObject({ phase: 'leave', returnValue: null, memory: [], incomplete: false })
  expect(messages[2]).toEqual({ incomplete: true, reason: 'trace-call-limit', limit: 1 })
})
