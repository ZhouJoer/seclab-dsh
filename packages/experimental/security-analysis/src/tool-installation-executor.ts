/** Package-owned installer orchestration using the configured subprocess provider. @module */
import type { Context } from '@deepseek-ai/cordis'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { ToolInstallationExecutor } from './tool-installation-types.ts'
import { ToolInstallationOutcomeUnknownError } from './tool-installation-types.ts'
import { previewPrivateToolRecipe } from './tool-installation-recipes.ts'
import { executePrivateToolRecipe, verifyPrivateToolInstallation, type InstallationCommandRunner } from './tool-installation-private.ts'
import { previewContainerToolRecipe, executeContainerToolRecipe, reconcileContainerToolRecipe } from './tool-installation-container.ts'
import { toolExecutableSha256, type ToolInstallationExecutorBounds } from './tool-installation-artifacts.ts'
import { inspectSecurityPython } from './security-python-install.ts'
import { privateToolRecipeDataSchema } from './tool-installation-recipes.ts'

/** Construct the reviewed recipe executor; the manager owns plans, approvals, binding and durable state.
 * @param ctx - lifecycle-owned subprocess service.
 * @param bounds - required deployment limits from workbench configuration.
 * @returns executable private and Docker installation recipes.
 */
export function createToolInstallationExecutor(ctx: Context, bounds: ToolInstallationExecutorBounds): ToolInstallationExecutor {
  const runner = (durationMs: number, maxOutputBytes: number): InstallationCommandRunner =>
    async (command, args, cwd, signal, log, temporaryDirectory) => {
      const result = await runProcess(ctx, { id: 'tool-installation', label: 'Tool installation', kind: 'local', cwd,
        tools: [{ id: 'installer', command, prefixArgs: [], versionArgs: [], source: 'reviewed-recipe', ...(temporaryDirectory ? { temporaryDirectory } : {}) }] }, 'installer', args,
      { signal, durationMs, maxOutputBytes, graceMs: bounds.graceMs, stopContainerOnAbort: false })
      if (result.stdout) await log?.('stdout', result.stdout)
      if (result.stderr) await log?.('stderr', result.stderr)
      requireProcessSuccess(result)
      if (result.truncated) throw new Error('Installation command output exceeded its configured limit; inspect the operation logs.')
      return result.stdout.trim() ? result.stdout : result.stderr
    }
  const run = runner(bounds.processTimeoutMs, bounds.maxOutputBytes)
  const inspect = runner(bounds.metadataTimeoutMs, bounds.maxMetadataBytes)
  return {
    async preview(request, context) {
      context.signal.throwIfAborted()
      if (request.recipeId.startsWith('kali-')) return previewContainerToolRecipe(request, context, inspect, bounds)
      let plan = previewPrivateToolRecipe(request, context)
      if (request.recipeId === 'python-analysis') {
        const data = privateToolRecipeDataSchema.parse(plan.data)
        const identity = await inspectSecurityPython(data.python, data.pythonArgs,
          (command, args) => inspect(command, args, context.environment.cwd, context.signal))
        plan = previewPrivateToolRecipe({ ...request, options: { python: identity.executable, pythonArgs: '[]' } }, context)
        plan.data.pythonIdentity = { executable: identity.executable, base: identity.base, version: identity.version, bits: 64,
          sha256: await toolExecutableSha256(identity.executable, bounds.maxDownloadBytes, context.signal) }
        plan.version = identity.version.join('.')
      }
      return plan
    },
    async execute(plan, context) {
      if (plan.mode === 'managed-container' || plan.mode === 'external-container') return executeContainerToolRecipe(plan, context, run, bounds)
      try { return await executePrivateToolRecipe(plan, context, bounds, run) }
      catch (error) {
        if (context.signal.aborted && ['python-runtime', 'wireshark', 'nmap'].includes(plan.recipeId))
          throw new ToolInstallationOutcomeUnknownError('The official installer was interrupted. Inspect its registration and destination before retrying.', { cause: error })
        throw error
      }
    },
    async reconcile(plan, operation, context) {
      if (plan.mode === 'managed-container' || plan.mode === 'external-container') return reconcileContainerToolRecipe(plan, context, run)
      if (operation.result) return verifyPrivateToolInstallation(plan, operation.result, context, run)
      return null
    },
  }
}
