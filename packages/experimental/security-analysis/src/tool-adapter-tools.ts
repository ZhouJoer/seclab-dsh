/** Model tool registration for environment-independent analysis queries. @module */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import type { LocalToolConfiguration } from './tool-configuration.ts'
import type { SecurityController } from './workbench/controller.ts'
import { operationSchema } from './workbench/model.ts'
import { toolAdapters } from './tool-adapter-catalog.ts'
import { adapterResultPage } from './tool-adapter-results.ts'
import { parseAdapterParameters } from './tool-adapter-provider.ts'

/** Register dedicated tools while keeping execution inside the existing observation owner.
 * @param ctx - scoped registry owner.
 * @param options - settings, project initialization, response limits and shutdown ownership.
 */
export function registerToolAdapters(ctx: Context, options: {
  ready: Promise<SecurityController>
  settings: LocalToolConfiguration
  signal: AbortSignal
  maxItems: number
  modelResultBytes: number
  pending: Set<Promise<unknown>>
}): void {
  for (const adapter of toolAdapters) {
    const parameters: ParameterSchemaSpec = { assetId: { type: 'string', required: true, description: 'Imported file asset ID.' },
      operation: { type: 'string', required: true, enum: [...adapter.operations] },
      environmentId: { type: 'string', description: 'Task-authorized environment for this call; cannot override a fixed binding.' }, ...adapter.parameters }
    ctx.effect(() => ctx.tools.register(defineTool({ name: adapter.toolName,
      description: adapter.description + ' Uses operator configuration and saves evidence. '
        + (adapter.provider === 'tool-adapter'
          ? 'Returns a bounded item page; read further items with security_evidence itemOffset/itemLimit.'
          : 'Returns a bounded receipt; read original retained output with security_evidence offset/length.'),
      parameters,
      output: { schema: { type: 'json' }, render: (_args, value: JsonValue) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('Security tools require a session')
        const sessionId = exec.agent.id
        const run = async () => {
          const controller = await options.ready
          const { assetId, operation, environmentId, ...parameters } = z.looseObject({
            assetId: z.string().min(1), operation: z.string(), environmentId: z.string().min(1).optional(),
          }).parse(args)
          if (!adapter.operations.some(candidate => candidate === operation)) throw new Error('Unsupported operation for ' + adapter.toolName)
          if (adapter.provider === 'tool-adapter') parseAdapterParameters(adapter.id + '.' + operation, parameters)
          const settings = options.settings
          const previous = controller.activity?.invocation(sessionId, exec.callId)
          const admitted = previous?.verified ? operationSchema.safeParse(JSON.parse(previous.parameters)) : undefined
          const project = controller.view(sessionId).records.find(record => record.kind === 'engagement'
            && record.value.id === controller.binding(sessionId)?.engagementId)
          if (project?.kind !== 'engagement') throw new Error('Select a security task before using an adapter')
          const request = operationSchema.parse({ provider: adapter.provider,
            operation: adapter.provider === 'tool-adapter' ? adapter.id + '.' + operation : operation,
            assetId, environmentId: admitted?.success ? admitted.data.environmentId
              : settings.route(adapter.id, project.value.environmentIds, environmentId), parameters, impact: 'observe' })
          const evidence = await controller.observe(sessionId, request, exec.callId, AbortSignal.any([exec.signal, options.signal]))
            .catch((error: unknown) => {
              const saved = controller.view(sessionId).records.find(record => record.kind === 'evidence'
              && record.value.source.sessionId === sessionId && record.value.source.callId === exec.callId)
              if (saved?.kind === 'evidence') throw new Error(JSON.stringify({ evidenceId: saved.value.id,
                failure: error instanceof Error ? error.message : String(error), incomplete: true }))
              throw error
            })
          if (evidence.kind !== 'evidence') throw new Error('Adapter observation did not publish evidence')
          if (adapter.provider !== 'tool-adapter') {
            const receipt = { evidenceId: evidence.value.id,
              revision: controller.view(sessionId).revision, tool: adapter.id, operation,
              incomplete: evidence.value.incomplete, summary: evidence.value.summary,
              detail: 'Read original retained observations with security_evidence offset/length.' }
            while (receipt.summary && Buffer.byteLength(JSON.stringify(receipt)) > options.modelResultBytes)
              receipt.summary = receipt.summary.slice(0, Math.floor(receipt.summary.length / 2))
            if (Buffer.byteLength(JSON.stringify(receipt)) > options.modelResultBytes) throw new Error('Receipt metadata exceeds response budget')
            return receipt
          }
          const page = adapterResultPage(await controller.artifacts.read(evidence.value.artifact), evidence.value.id,
            0, options.maxItems, options.modelResultBytes - 128)
          if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error('Expected an adapter result page')
          return { ...page, revision: controller.view(sessionId).revision }
        }
        const pending = run()
        options.pending.add(pending)
        try { return await pending } finally { options.pending.delete(pending) }
      },
    })))
  }
}
