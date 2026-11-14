/** Operator CLI projection of the workbench's shared installation lifecycle. @module */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { brandString } from '../packages/util/brand/src/index.ts'
import { dshHomePath } from '../packages/util/home-paths/src/index.ts'
import { SecurityToolInstallations } from '../packages/experimental/security-analysis/src/tool-installations.ts'
import { ToolInstallationSelections } from '../packages/experimental/security-analysis/src/tool-installation-settings.ts'
import { LocalToolConfiguration } from '../packages/experimental/security-analysis/src/tool-configuration.ts'
import { createToolInstallationExecutor } from '../packages/experimental/security-analysis/src/tool-installation-executor.ts'
import { toolInstallationRecipes } from '../packages/experimental/security-analysis/src/tool-installation-recipes.ts'
import { toolInstallationConfig, type ToolInstallationConfig } from '../packages/experimental/security-analysis/src/tool-installation-config.ts'
import { toolInstallationOperationIdSchema, toolInstallationPlanIdSchema, toolInstallationRequestSchema,
  type ManagedToolInstallationId, type ToolInstallationOperationId } from '../packages/experimental/security-analysis/src/tool-installation-types.ts'
import { readSecurityEnvironments } from './security-tools-config.ts'
import type { SecurityEnvironment } from '../packages/experimental/security-analysis/src/workbench/providers.ts'
import type { ToolDefinition } from '../packages/experimental/security-analysis/src/tool-definitions.ts'

/** Run one installation command using the same home ledger, recipes and selection transaction as the workbench.
 * @param args - command and explicit plan/confirmation parameters.
 * @param options - selected project files and registered definitions.
 * @returns completion after any owned installation has settled.
 */
export async function manageToolInstallations(args: string[], options: {
  file: string
  environmentsFile: string
  environmentId: string
  catalog: readonly ToolDefinition[]
  limits?: Partial<ToolInstallationConfig>
}): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    digest: { type: 'string' }, 'request-id': { type: 'string' }, confirm: { type: 'string', multiple: true },
    option: { type: 'string', multiple: true }, action: { type: 'string', default: 'install' }, limits: { type: 'string' }, follow: { type: 'boolean' },
  } })
  const [action, selected] = positionals
  if (positionals.length > 2) throw new Error('Expected one recipe, plan, operation or root directory argument.')
  if (action === 'install-recipes') { console.log(JSON.stringify(toolInstallationRecipes(), null, 2)); return }
  const environments = existsSync(options.environmentsFile) ? readSecurityEnvironments(options.environmentsFile).environments : []
  let local = environments.find(environment => environment.kind === 'local')
  if (!local) {
    local = { id: 'local', label: 'Local', kind: 'local', cwd: process.cwd(), tools: [] }
    environments.unshift(local)
  }
  const configuration = new LocalToolConfiguration(options.file, local, () => options.catalog, environments)
  const selections = new ToolInstallationSelections(configuration, environments,
    existsSync(options.environmentsFile) ? options.environmentsFile : undefined,
    (_environment: SecurityEnvironment) => Promise.reject(new Error('Stop the owned container through the running workbench before switching its image from this CLI.')))
  const declaredLimits = values.limits ? z.record(z.string(), z.number()).parse(JSON.parse(readFileSync(resolve(values.limits), 'utf8')))
    : options.limits ?? {}
  const parseLimits = toolInstallationConfig as Schema<unknown, ToolInstallationConfig, 'defined'>
  const bounds = parseLimits(declaredLimits)
  const ctx = new Context()
  const shutdown = new AbortController()
  const interrupted = (): void => { shutdown.abort(new Error('CLI installation interrupted')) }
  process.on('SIGINT', interrupted)
  process.on('SIGTERM', interrupted)
  try {
    await ctx.plugin(LocalSubprocess)
    const manager = new SecurityToolInstallations(ctx, { directory: dshHomePath('security', 'tool-installations'), selectionId: options.file,
      executor: createToolInstallationExecutor(ctx, bounds), maxLogBytes: bounds.maxLogBytes, maxLogChunks: bounds.maxLogChunks,
      snapshot: id => selections.snapshot(id), withEnvironment: (_id, run) => run(shutdown.signal),
      commit: (plan, result) => selections.commit(plan, result),
      isInstallationInUse: (location, paths) => selections.inUse(location, paths),
      withUnusedInstallation: (location, paths, remove) => selections.withUnusedInstallation(location, paths, remove) })
    const observe = async (id: ToolInstallationOperationId): Promise<void> => {
      for await (const frame of manager.follow(id, 0, new AbortController().signal)) {
        for (const chunk of frame.operation.logs)
          (chunk.channel === 'stderr' ? process.stderr : process.stdout).write(chunk.text + '\n')
        console.log(JSON.stringify({ id, phase: frame.operation.phase, failure: frame.operation.failure }))
      }
      const operation = await manager.get(id)
      if (operation.phase !== 'completed') process.exitCode = 1
    }
    if (action === 'install-root') {
      const root = await manager.root()
      console.log(JSON.stringify(selected ? await manager.setRoot(resolve(selected), root.revision) : root, null, 2))
    } else if (action === 'install-preview') {
      if (!selected) throw new Error('Expected install-preview RECIPE_ID')
      const recipeOptions: Record<string, string> = {}
      for (const value of values.option ?? []) {
        const separator = value.indexOf('=')
        if (separator < 1) throw new Error('--option requires NAME=VALUE')
        recipeOptions[value.slice(0, separator)] = value.slice(separator + 1)
      }
      const request = toolInstallationRequestSchema.parse({ recipeId: selected, environmentId: options.environmentId,
        action: values.action, options: recipeOptions })
      console.log(JSON.stringify(await manager.preview(request), null, 2))
    } else if (action === 'install-remove-preview') {
      if (!selected) throw new Error('Expected install-remove-preview INSTALLATION_ID')
      console.log(JSON.stringify(await manager.previewRemoval(brandString<ManagedToolInstallationId>(selected)), null, 2))
    } else if (action === 'install-apply') {
      if (!selected || !values.digest || !values['request-id']) throw new Error('Expected install-apply PLAN_ID --digest DIGEST --request-id UNIQUE_ID [--confirm ID]')
      const operation = await manager.apply(toolInstallationPlanIdSchema.parse(selected), values.digest, values['request-id'], values.confirm ?? [])
      console.log(JSON.stringify({ operationId: operation.id }))
      await observe(operation.id)
    } else if (action === 'install-status') {
      if (selected && values.follow) await observe(toolInstallationOperationIdSchema.parse(selected))
      else console.log(JSON.stringify(selected ? await manager.get(toolInstallationOperationIdSchema.parse(selected))
        : await manager.list(), null, 2))
    } else if (action === 'install-cancel' || action === 'install-reconcile') {
      if (!selected) throw new Error('Expected ' + action + ' OPERATION_ID')
      if (!(await manager.root()).writable) throw new Error('Another Host owns this operation. Cancel or reconcile it in that running workbench.')
      const id = toolInstallationOperationIdSchema.parse(selected)
      if (action === 'install-cancel') console.log(JSON.stringify(await manager.cancel(id), null, 2))
      else { await manager.reconcile(id); await observe(id) }
    } else throw new Error('Unknown installation action: ' + String(action))
  } finally {
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', interrupted)
    await ctx.fiber.dispose()
  }
}
