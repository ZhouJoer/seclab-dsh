/** Loopback-target reachability projection derives candidates at runtime, never from fixed addresses. @module */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { gatewayHosts, isLoopbackOrigin, probeTargetReachability, substituteOriginHost } from '../src/target-reachability.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
const run = vi.mocked(runProcess)
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false })
const environment: SecurityEnvironment = { id: 'kali', label: 'Kali', kind: 'docker', cwd: process.cwd(),
  externalContainer: { name: 'kali-linux', workdir: '/workspace' }, tools: [
    { id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'Host' },
  ] }
const limits = { durationMs: 8000, maxOutputBytes: 4096, graceMs: 100 }
const signal = new AbortController().signal

beforeEach(() => {
  run.mockReset()
  // The process runner is mocked; probes read captured stdout only.
  Object.assign(new Context(), {})
})

describe('origin classification', () => {
  it('classifies operator-loopback origins and rejects everything else', () => {
    for (const origin of ['http://127.0.0.1:18082/', 'https://localhost/', 'http://[::1]:8443/', 'http://127.8.8.8/'])
      expect(isLoopbackOrigin(origin)).toBe(true)
    for (const origin of ['http://10.0.0.5/', 'http://example.com/', 'https://192.168.1.1/', 'not-a-url'])
      expect(isLoopbackOrigin(origin)).toBe(false)
  })
  it('extracts default gateways and substitutes hosts without losing scheme, port or path', () => {
    expect(gatewayHosts('default via 172.17.0.1 dev eth0\n172.17.0.0/16 dev eth0')).toEqual(['172.17.0.1'])
    expect(gatewayHosts('')).toEqual([])
    expect(substituteOriginHost('http://127.0.0.1:18082/app', 'host.docker.internal')).toBe('http://host.docker.internal:18082/app')
    expect(substituteOriginHost('http://127.0.0.1/', 'fd00::1')).toBe('http://[fd00::1]/')
    expect(substituteOriginHost('broken', 'host')).toBeUndefined()
  })
})

describe('container probing', () => {
  it('records the first answering candidate with its substituted origin', async () => {
    run.mockImplementation(async (_ctx, _env, _id, args) => {
      const script = String(args.at(-1))
      if (script.includes('command -v')) return ok('/usr/bin/curl\ndefault via 172.17.0.1 dev eth0')
      if (script.includes('127.0.0.1:18082')) return ok('000')
      if (script.includes('host.docker.internal')) return ok('401')
      throw new Error('unexpected probe: ' + script)
    })
    const checks = await probeTargetReachability(new Context(), environment, limits, signal, ['http://127.0.0.1:18082/'])
    expect(checks).toEqual([{ targetOrigin: 'http://127.0.0.1:18082/', status: 'reachable',
      reachableAs: 'http://host.docker.internal:18082/', checkedAt: expect.any(Number) }])
    expect(run.mock.calls[0]?.[3]).toEqual(['exec', 'kali-linux', 'sh', '-c', expect.stringContaining('command -v')])
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('stays unknown without an HTTP client instead of guessing an address', async () => {
    run.mockImplementation(async (_ctx, _env, _id, args) =>
      ok(String(args.at(-1)).includes('command -v') ? 'default via 172.17.0.1 dev eth0' : ''))
    const checks = await probeTargetReachability(new Context(), environment, limits, signal, ['http://localhost:8080/'])
    expect(checks).toEqual([{ targetOrigin: 'http://localhost:8080/', status: 'unknown',
      detail: 'No HTTP client found in the container', checkedAt: expect.any(Number) }])
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('reports unreachable when every derived candidate stays silent', async () => {
    run.mockImplementation(async (_ctx, _env, _id, args) => {
      const script = String(args.at(-1))
      if (script.includes('command -v')) return ok('/usr/bin/wget')
      return ok('rc=4')
    })
    const checks = await probeTargetReachability(new Context(), environment, limits, signal, ['http://127.0.0.1:9/'])
    expect(checks[0]).toMatchObject({ status: 'unreachable' })
  })
  it('does not probe a non-container environment', async () => {
    const local: SecurityEnvironment = { id: 'local', label: 'Local', kind: 'local', cwd: process.cwd(), tools: [] }
    const checks = await probeTargetReachability(new Context(), local, limits, signal, ['http://127.0.0.1:80/'])
    expect(checks[0]).toMatchObject({ status: 'unknown' })
    expect(run).not.toHaveBeenCalled()
  })
})
