/** Security methods use the shared skill catalog and follow their plugin lifecycle. @module */
import { Context } from '@deepseek-ai/cordis'
import Skills, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it } from 'vitest'
import { installSecurityMethods } from '../src/methods.ts'
import { fileURLToPath } from 'node:url'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { ANALYSIS_SCRIPTS_DIRECTORY } from '../src/analysis-scripts.ts'

const contexts: Context[] = []
const names = ['security-android', 'security-cve-mining', 'security-dynamic', 'security-firmware', 'security-investigation', 'security-iot-offline', 'security-kali', 'security-mqtt', 'security-native', 'security-packet-analysis', 'security-web']

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function createRegistry(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Skills)
  return ctx
}

const methodsPlugin = {
  name: 'security-methods-test',
  inject: ['skills'],
  apply(ctx: Context) {
    installSecurityMethods(ctx)
  },
}

describe('security method skills', () => {
  it('isolates active skills and restores global explicit-only entries on disposal', async () => {
    const ctx = await createRegistry()
    installSecurityMethods(ctx)
    const android = createScope(ctx, { preset: 'android' })
    const native = createScope(ctx, { preset: 'native' })
    try {
      const dispose = installSecurityMethods(android.ctx, ['security-android'])
      installSecurityMethods(native.ctx, ['security-native'])
      const active = async (scope: object) => (await ctx.skills.list({ scope }))
        .filter(skill => skill.invocation.modelInvocable).map(skill => skill.name)
      expect(await active(scopeOf(android.ctx)!)).toEqual(['security-android', 'security-investigation'])
      expect(await active(scopeOf(native.ctx)!)).toEqual(['security-investigation', 'security-native'])
      dispose()
      expect(await active(scopeOf(android.ctx)!)).toEqual(['security-investigation'])
    } finally { await android.dispose(); await native.dispose() }
  })

  it('discovers summaries and loads the requested instruction bodies', async () => {
    const ctx = await createRegistry()
    await ctx.plugin(methodsPlugin)

    const catalog = await ctx.skills.list()
    expect(catalog.map(skill => skill.name)).toEqual(names)
    expect(catalog.every(skill => !('content' in skill))).toBe(true)
    for (const name of names) {
      const skill = await ctx.skills.get(name)
      expect(skill).toMatchObject({
        name,
        source: 'bundled',
        provider: 'security-analysis',
        invocation: { modelInvocable: name === 'security-investigation', userInvocable: true },
      })
      if (!skill) throw new Error(`Missing security method: ${name}`)
      expect(renderSkillContent(skill).replaceAll(ANALYSIS_SCRIPTS_DIRECTORY, '<analysis-scripts>').replaceAll(fileURLToPath(new URL('../resources/skills/', import.meta.url)), '<security-skills>')).toMatchSnapshot(name)
    }
  })

  it('removes its registrations without removing unrelated skills', async () => {
    const ctx = await createRegistry()
    ctx.skills.register({ name: 'workspace-guide', description: 'Workspace guide.', source: 'runtime', content: 'Guide.' })
    const dispose = installSecurityMethods(ctx)
    await ctx.skills.list()

    dispose()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['workspace-guide'])
    for (const name of names) expect(await ctx.skills.get(name)).toBeUndefined()
  })

  it('removes cached skills on plugin disposal and allows registration after reload', async () => {
    const ctx = await createRegistry()
    const fiber = ctx.plugin(methodsPlugin)
    await fiber
    await ctx.skills.get('security-web')
    await ctx.skills.list()

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect(await ctx.skills.get('security-web')).toBeUndefined()

    await ctx.plugin(methodsPlugin)
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(names)
    expect(await ctx.skills.get('security-web')).toBeDefined()
  })
})
