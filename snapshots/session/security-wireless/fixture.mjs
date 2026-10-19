/** Real provider discovery without external software or device probes. */
import { join } from 'node:path'
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
export const name = 'security-wireless-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subprocess', 'subagents', 'jobs', 'approval']
export async function apply(ctx) {
  const originalUUID = crypto.randomUUID
  let identifier = 0
  crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++identifier).padStart(12, '0')
  syncBuiltinESMExports()
  ctx.effect(() => () => { crypto.randomUUID = originalUUID; syncBuiltinESMExports() })
  const built = process.env.DSH_EXAMPLE_MODE === 'lib'
  const entry = built ? 'lib/index.js' : 'src/index.ts'
  const service = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(service.default, { root: join(process.env.DSH_HOME, 'security'), importRoots: [process.cwd()],
    toolCatalogPath: join(process.env.DSH_HOME, 'tools.json'), environments: [], knowledgeIntervalMs: 0 })
  const providerEntry = built ? 'lib/packet-capture.js' : 'src/packet-capture-provider.ts'
  const provider = await import(new URL(`../../../packages/experimental/security-analysis/${providerEntry}`, import.meta.url))
  await ctx.plugin(provider, {})
  ctx.inject(['securityWorkbench'], securityCtx => {
    securityCtx.on('tools/execute', async (exec, next) => {
      if (exec.callId === 'route-wireless') {
        const controller = await securityCtx.securityWorkbench.ready
        await controller.command(exec.agent.id, { operationId: 'fixture-wireless-task', expectedRevision: 0,
          action: { kind: 'create', title: 'Offline capture methods', objective: 'Inspect IoT analysis capabilities', environmentIds: [], maxAttempts: 1 } }, true)
      }
      return next()
    })
  })
}
