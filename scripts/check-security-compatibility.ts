/** Verify the fork identity, built consumers, Loader behavior and recorded Session readers after an upstream merge. @module */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { z } from 'zod'
import { pnpmInvocation } from './pnpm-invocation.ts'

const manifest = z.object({
  version: z.literal(1),
  upstreamCommit: z.string().regex(/^[0-9a-f]{40}$/u),
  reviewedForkCommit: z.string().regex(/^[0-9a-f]{40}$/u),
  requiredSessionEvents: z.array(z.string()).nonempty(),
  patches: z.array(z.object({
    id: z.string().min(1),
    paths: z.array(z.string()).nonempty(),
    consumers: z.array(z.string()).nonempty(),
    checks: z.array(z.string()).nonempty(),
    retireWhen: z.string().min(1),
  })).nonempty(),
}).parse(JSON.parse(readFileSync(new URL('./security-compatibility.json', import.meta.url), 'utf8')))

for (const patch of manifest.patches) {
  for (const path of [...patch.paths, ...patch.consumers, ...patch.checks]) {
    assert(existsSync(path), `${patch.id}: missing ${path}; review the patch inventory before accepting this merge`)
  }
}
await execa('git', ['merge-base', '--is-ancestor', manifest.upstreamCommit, 'HEAD'])
await execa('git', ['merge-base', '--is-ancestor', manifest.reviewedForkCommit, 'HEAD'])
const forkCommit = (await execa('git', ['rev-parse', 'HEAD'])).stdout
const dirty = (await execa('git', ['status', '--porcelain'])).stdout.length > 0
console.log(JSON.stringify({ upstreamCommit: manifest.upstreamCommit, forkCommit, dirty, reviewedForkCommit: manifest.reviewedForkCommit }))

async function pnpm(args: string[]): Promise<void> {
  const invocation = pnpmInvocation(args)
  await execa(invocation.command, invocation.args, { stdio: 'inherit' })
}

await pnpm(['run', 'build:artifacts'])
await pnpm(['run', 'build:check'])

// Plain Node checks the artifact imports without tsx's source-path resolver.
await execa(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  const subprocess = await import(${JSON.stringify(pathToFileURL(resolve('packages/subprocess/subprocess/lib/index.js')).href)});
  assert.equal(typeof subprocess.windowsStatusDiagnostic, 'function');
  const session = await import(${JSON.stringify(pathToFileURL(resolve('packages/core/session/lib/index.js')).href)});
  for (const event of ${JSON.stringify(manifest.requiredSessionEvents)}) assert(session.KNOWN_SESSION_EVENT_TYPES.has(event), event);
  for (const path of ${JSON.stringify(['index', 'environment', 'typert.host', 'typert.remote-client'].map(name =>
    pathToFileURL(resolve('packages/experimental/security-analysis/lib/' + name + '.js')).href))}) await import(path);
  const host = await import(${JSON.stringify(pathToFileURL(resolve('packages/experimental/security-analysis/lib/typert.host.js')).href)});
  const remote = await import(${JSON.stringify(pathToFileURL(resolve('packages/experimental/security-analysis/lib/typert.remote-client.js')).href)});
  for (const descriptors of [host.TYPERT.invocations, remote.default.descriptors]) {
    const progress = descriptors.find(method => method.method === 'followSessionView');
    assert.deepEqual(progress.parameters.map(parameter => [parameter.name, parameter.source]), [['sessionId', 'json']]);
  }
`], { stdio: 'inherit' })

const unitChecks = new Set([
  'scripts/start-security.spec.ts', 'scripts/security-tools.spec.ts',
  'packages/experimental/security-analysis/tests/workbench.spec.ts',
  'packages/experimental/security-analysis/tests/external-environments.spec.ts',
  'packages/experimental/client-ui-security-analysis/tests/conversation-progress.client.spec.tsx',
  'scripts/verify-repository-references.spec.ts',
  ...manifest.patches.flatMap(patch => patch.checks).filter(path => !path.startsWith('snapshots/')),
])
await pnpm(['exec', 'vitest', 'run', ...unitChecks])
await pnpm(['run', 'test:snapshot', '-t', 'security|helper|advisor-jev|background-job-admission'])
