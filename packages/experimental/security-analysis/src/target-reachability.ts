/** Reachability projection for project web targets from container environments. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { SecurityEnvironment } from './workbench/providers.ts'
import { runProcess } from './workbench/process.ts'

/** One measured reachability observation; unknown keeps an honest gap instead of a guessed address. */
export interface TargetReachCheck {
  readonly targetOrigin: string
  readonly status: 'reachable' | 'unreachable' | 'unknown'
  readonly reachableAs?: string
  readonly detail?: string
  readonly checkedAt: number
}

/** Candidate host-gateway names derived at runtime; none is machine-specific. */
const HOST_GATEWAY_NAMES = ['host.docker.internal']
/** Loopback origins name the operator host, not the container itself.
 * @param origin - project target origin.
 * @returns whether the origin addresses an operator-host loopback interface.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/gu, '')
    return hostname === 'localhost' || hostname === '::1' || /^127\.\d+\.\d+\.\d+$/u.test(hostname)
  } catch (_error) {
    return false
  }
}

/** Extract default-gateway addresses from `ip route` output.
 * @param routeOutput - raw container routing table text.
 * @returns gateway addresses in declaration order.
 */
export function gatewayHosts(routeOutput: string): string[] {
  return [...routeOutput.matchAll(/default via (\S+)/gu)]
    .flatMap(match => match[1] === undefined ? [] : [match[1]])
}

/** Replace an origin's host while keeping scheme, port and credentials-free shape.
 * @param origin - project target origin.
 * @param host - candidate host-gateway name or address.
 * @returns the substituted origin, or undefined for an unparseable input.
 */
export function substituteOriginHost(origin: string, host: string): string | undefined {
  try {
    const url = new URL(origin)
    url.hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    return url.toString()
  } catch (_error) {
    return undefined
  }
}

interface ProbeLimits { durationMs: number; maxOutputBytes: number; graceMs: number }

/** Probe whether a running container environment reaches the operator host's loopback web targets.
 *
 * Candidates are derived per run: the original origin, the host-gateway names, and the container's
 * measured default gateway. A result is recorded only from an actual response; without an HTTP
 * client in the container the observation stays unknown.
 *
 * @param ctx - Host subprocess service.
 * @param environment - running docker environment with a configured docker tool.
 * @param limits - per-command deadline and output bounds.
 * @param signal - caller cancellation.
 * @param origins - distinct loopback target origins, already bounded by the caller.
 * @returns one observation per origin.
 */
export async function probeTargetReachability(ctx: Context, environment: SecurityEnvironment, limits: ProbeLimits,
  signal: AbortSignal, origins: readonly string[]): Promise<TargetReachCheck[]> {
  const container = environment.externalContainer?.name ?? environment.containerId
  if (environment.kind !== 'docker' || !container) return origins.map(origin =>
    ({ targetOrigin: origin, status: 'unknown', detail: 'Environment is not a running container', checkedAt: Date.now() }))
  const docker = environment.tools.find(tool => tool.id === 'docker')
  if (!docker) return origins.map(origin =>
    ({ targetOrigin: origin, status: 'unknown', detail: 'Docker command is not configured', checkedAt: Date.now() }))
  const exec = async (script: string): Promise<{ output: string; failed: boolean }> => {
    const result = await runProcess(ctx, environment, 'docker', ['exec', container, 'sh', '-c', script],
      { ...limits, signal, stopContainerOnAbort: false })
    return { output: (result.stdout || result.stderr).trim(), failed: result.timedOut || result.cancelled || result.exitCode !== 0 }
  }
  let fetcher: string
  let gateways: string[] = []
  try {
    const discovery = await exec('command -v curl wget python3 python 2>/dev/null; ip route 2>/dev/null')
    const lines = discovery.output.split('\n').map(line => line.trim()).filter(Boolean)
    fetcher = lines.find(line => /^(\/\S+\/)?(curl|wget|python3?|python)$/u.test(line.split('/').pop() ?? '')) ?? ''
    gateways = gatewayHosts(discovery.output)
  } catch (error) {
    signal.throwIfAborted()
    return origins.map(origin => ({ targetOrigin: origin, status: 'unknown',
      detail: error instanceof Error ? error.message : String(error), checkedAt: Date.now() }))
  }
  const probeScript = (url: string): string | undefined => {
    const name = fetcher.split('/').pop() ?? ''
    const seconds = Math.max(1, Math.floor(limits.durationMs / 1000))
    if (name === 'curl') return `curl -s -o /dev/null -w '%{http_code}' -m ${seconds} '${url}'`
    if (name === 'wget') return `wget -q -T ${seconds} -t 1 -O /dev/null '${url}'; echo rc=$?`
    if (name === 'python3' || name === 'python')
      return `${name} -c "import urllib.request,sys\\ntry:\\n urllib.request.urlopen(urllib.request.Request('${url}', method='HEAD'), timeout=${seconds})\\n print('http')\\nexcept urllib.error.HTTPError:\\n print('http')\\nexcept Exception: sys.exit(1)"`
    return undefined
  }
  const checks: TargetReachCheck[] = []
  for (const origin of origins) {
    signal.throwIfAborted()
    const candidates = [origin, ...[...HOST_GATEWAY_NAMES, ...gateways]
      .map(host => substituteOriginHost(origin, host))
      .filter((url): url is string => !!url && url !== origin)]
    if (!fetcher) {
      checks.push({ targetOrigin: origin, status: 'unknown', detail: 'No HTTP client found in the container', checkedAt: Date.now() })
      continue
    }
    let reachableAs: string | undefined
    let detail = 'No candidate address answered'
    for (const candidate of candidates) {
      const script = probeScript(candidate)
      if (!script) break
      try {
        const probe = await exec(script)
        const answered = !probe.failed && (probe.output === 'http' || /^\d{3}$/u.test(probe.output) && probe.output !== '000'
          || /^rc=(?!4\b)\d+$/u.test(probe.output))
        if (answered) { reachableAs = candidate; break }
      } catch (error) {
        signal.throwIfAborted()
        detail = error instanceof Error ? error.message : String(error)
        break
      }
    }
    checks.push(reachableAs
      ? { targetOrigin: origin, status: 'reachable', reachableAs, checkedAt: Date.now() }
      : { targetOrigin: origin, status: 'unreachable', detail, checkedAt: Date.now() })
  }
  return checks
}
