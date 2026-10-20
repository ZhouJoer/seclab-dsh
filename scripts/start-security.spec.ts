/** The pnpm security source launcher composes the complete, keyless security profile. */

import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import * as SecurityProfile from '@deepseek-ai/dsh-experimental-security-profile'
import { execa } from 'execa'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'

interface DumpEntry {
  id?: string
  name?: string
  disabled?: unknown
  config?: unknown
}

const stringValue: unknown = expect.any(String)

it('keeps task intake and operator tools in the launched profile and resolves its skill preset', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-start-security-'))
  const ctx = new Context()
  try {
    // pnpm security is a source entry; exercising that exact entry owns its overlay order.
    const launch = resolveExampleLaunch({
      srcBin: fileURLToPath(new URL('./start-security.ts', import.meta.url)),
      mode: 'src',
      sourceImport: 'tsx/esm',
      tsconfigPath: fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)),
      configArgs: ['--dump-config'],
      env: {
        DSH_HOME: join(cwd, '.dsh'),
        DSH_AGENTS_HOME: join(cwd, '.agents'),
        DEEPSEEK_API_KEY: undefined,
        DEEPSEEK_BASE_URL: undefined,
        OPENAI_API_KEY: undefined,
      },
    })
    const result = await execa(launch.command, launch.args, {
      cwd,
      env: launch.env,
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.exitCode, result.stderr).toBe(0)
    const entries = load(result.stdout, { schema: entryListSchema }) as DumpEntry[]
    expect(Array.isArray(entries)).toBe(true)
    const workbench = entries.find(entry => entry.id === 'security-workbench')
    expect(workbench?.disabled).not.toBe(true)
    const toolsValue: unknown = expect.arrayContaining([
      { id: 'python', command: 'python', versionArgs: ['--version'], source: stringValue },
      { id: 'jadx', command: 'jadx', versionArgs: ['--version'], source: stringValue },
    ])
    const environmentsValue: unknown = expect.arrayContaining([expect.objectContaining({
      id: 'local',
      kind: 'local',
      cwd: { __jsExpr: 'process.cwd()' },
      tools: toolsValue,
    })])
    expect(workbench?.config).toMatchObject({
      analysisTurnTokens: 360000,
      taskIntake: {
        workspaces: [],
        defaultEnvironmentIds: ['local'],
        maxAttempts: 3,
      },
      environments: environmentsValue,
    })
    const scope = {
      process: { cwd: () => cwd, getBuiltinModule: (id: string) => process.getBuiltinModule(id) },
      dshHomePath: (...parts: string[]) => join(cwd, '.dsh', ...parts),
    }
    const localTools = join(cwd, '.dsh', 'security-tools.json')
    const homeTools = join(cwd, '.dsh', 'security', 'tools.json')
    const resolved = (): unknown => interpolate(scope, workbench?.config)
    expect(resolved()).toMatchObject({ toolConfiguration: { path: cwd + '/.dsh/security-tools.json' } })
    await mkdir(join(cwd, '.dsh', 'security'), { recursive: true })
    const savedTools = '{"installations":{"local":{"python":{"command":"custom-python"}}}}'
    await writeFile(homeTools, savedTools)
    expect(resolved()).toMatchObject({ toolConfiguration: { path: homeTools } })
    await writeFile(localTools, savedTools)
    expect(resolved()).toMatchObject({ toolConfiguration: { path: cwd + '/.dsh/security-tools.json' } })
    expect(await readFile(homeTools, 'utf8')).toBe(savedTools)
    expect(await readFile(localTools, 'utf8')).toBe(savedTools)
    const profilePatch = join(cwd, '.dsh', 'profiles', 'security', 'cordis.patch.yml')
    const homePatch = join(cwd, '.dsh', 'cordis.patch.yml')
    const cliPatch = join(cwd, 'explicit.yml')
    if (!workbench?.config || typeof workbench.config !== 'object') throw new Error('Missing workbench configuration')
    const saved = { ...workbench.config, analysisTurnTokens: 12345, evolution: { auto: false }, root: join(cwd, 'custom-data') }
    const patch = (config: object) => JSON.stringify([{ id: 'security-workbench', config }])
    const effective = async (extra: string[] = []) => {
      const run = await execa(launch.command, [...launch.args, ...extra], {
        cwd, env: launch.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
      })
      expect(run.exitCode, run.stderr).toBe(0)
      return (load(run.stdout, { schema: entryListSchema }) as DumpEntry[]).find(entry => entry.id === 'security-workbench')?.config
    }
    await writeFile(profilePatch, patch(saved))
    expect(await effective()).toEqual(saved)
    expect(await effective()).toEqual(saved)
    await writeFile(homePatch, patch({ ...saved, analysisTurnTokens: 23456 }))
    expect(await effective()).toEqual({ ...saved, analysisTurnTokens: 23456 })
    await writeFile(cliPatch, patch({ ...saved, analysisTurnTokens: 34567 }))
    expect(await effective(['--patch', cliPatch])).toEqual({ ...saved, analysisTurnTokens: 34567 })

    const presetProvider = entries.find(entry => entry.id === 'security-presets')
    expect(presetProvider).toMatchObject({ name: '@deepseek-ai/dsh-experimental-security-profile' })
    expect(presetProvider?.disabled).not.toBe(true)
    expect(entries.find(entry => entry.id === 'agent-preset-registry')?.config).toEqual({ default: 'security' })
    // This fixture mounts the declaration registry; Host services remain absent.
    ctx.baseUrl = new URL('../apps/cli/src/', import.meta.url).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentPresetRegistry, { default: 'security' })
    await ctx.plugin(SecurityProfile)
    const preset = await ctx.agentPresets.resolve()
    expect(preset.id).toBe('security')
    expect(preset.broken).toContain('waiting for')
    expect(preset.broken).not.toContain('never started')
    const composition = (await ctx.agentPresets.compositionInventory()).find(item => item.id === preset.id)
    expect(composition?.rows).toContainEqual({
      entryId: 'tool-skill',
      moduleName: '@deepseek-ai/dsh-tool-skill',
      enabled: true,
      fiberState: 0,
    })
    for (const [entryId, moduleName] of [
      ['tool-fs', '@deepseek-ai/dsh-tool-fs'], ['tool-fs-search', '@deepseek-ai/dsh-tool-fs-search'],
      ['tool-bash', '@deepseek-ai/dsh-tool-bash'], ['tool-pwsh', '@deepseek-ai/dsh-tool-pwsh'],
    ]) expect(composition?.rows).toContainEqual(expect.objectContaining({ entryId, moduleName,
      enabled: entryId === 'tool-bash' ? process.platform !== 'win32' : entryId === 'tool-pwsh' ? process.platform === 'win32' : true }))
  } finally {
    await ctx.fiber.dispose()
    await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
