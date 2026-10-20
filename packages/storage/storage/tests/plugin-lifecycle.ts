/** Backend cleanup must retain consumers that are already leaving the registry. @module */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import Storage, { storageBackendServiceKey } from '../src/index.ts'
import type { StorageBackend } from '../src/index.ts'

/** A mounted provider and an independent reader of its durable medium. */
export interface StoragePluginFixture {
  fiber: Fiber
  reopen(): Promise<StorageBackend>
}

/** Verify the last consumer write across provider and enclosing-owner teardown.
 * @param name - registered backend name.
 * @param mount - provider factory over a private test medium.
 */
export function runStoragePluginLifecycle(name: string, mount: (ctx: Context) => Promise<StoragePluginFixture>): void {
  it.each(['provider', 'root', 'root-after-consumer'] as const)(`${name} retains the final write during %s disposal`, async (target) => {
    const ctx = new Context()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    onTestFinished(async () => { release.resolve(undefined); await ctx.fiber.dispose() })
    await ctx.plugin(Storage)
    const fixture = await mount(ctx)
    const unit = await ctx.storage.backend.get(name).kv!.open({ name: 'cleanup', version: 1, tables: ['records'], hasGlobal: false })
    const failures: unknown[] = []
    const consumer = await ctx.plugin({
      inject: [storageBackendServiceKey(name)],
      apply(owner: Context) {
        owner.effect(() => async () => {
          entered.resolve(undefined)
          await release.promise
          try { await unit.putRecord('records', 'final', { status: 'cancelled' }) }
          catch (error) { failures.push(error) }
          finally { await unit.close() }
        })
      },
    })
    const leaving = target === 'root-after-consumer' ? consumer.dispose() : Promise.resolve()
    if (target === 'root-after-consumer') await entered.promise
    const disposal = (target === 'provider' ? fixture.fiber : ctx.fiber).dispose()
    let disposed = false
    void disposal.then(() => { disposed = true })
    try {
      await entered.promise
      expect((await unit.loadAll()).tables['records']).toEqual({})
      expect(disposed).toBe(false)
      release.resolve(undefined)
      await Promise.all([leaving, disposal])
      expect(failures).toEqual([])
      const reader = await fixture.reopen()
      try {
        const saved = await reader.kv!.open({ name: 'cleanup', version: 1, tables: ['records'], hasGlobal: false })
        expect((await saved.loadAll()).tables['records']).toEqual({ final: { status: 'cancelled' } })
      } finally { await reader.close() }
    } finally { release.resolve(undefined); await Promise.all([leaving, disposal]) }
  })
}
