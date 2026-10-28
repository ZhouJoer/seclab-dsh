/** Workspace tasks register targets without importing source files. @module */
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, onTestFinished, vi } from 'vitest'
import { openSecurityJournal } from '../src/workbench/journal.ts'
import { recordSchema } from '../src/workbench/model.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { SecurityController } from '../src/workbench/controller.ts'

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-security-workbench-'))
  const ctx = new Context()
  const backend = new JsonStorageBackend(root)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test', backend)
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const journal = await openSecurityJournal(ctx)
  const artifacts = new ArtifactStore(root, 65536)
  const controller = new SecurityController(journal, artifacts, {
    taskContextMaxBytes: 4096,
    importRoots: [root],
    environments: [{ id: 'local', kind: 'local', label: 'Lab', cwd: root, tools: [] },
      { id: 'kali', kind: 'docker', label: 'Kali', cwd: root,
        externalContainer: { name: 'kali-linux', workdir: '/workspace' },
        tools: [{ id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'Host' }] }],
    maxDurationMs: 1000,
    maxOutputBytes: 32768,
    approvalTtlMs: 60000,
    maxArtifactBytes: 65536,
    maxDerivedAssets: 10,
  })
  onTestFinished(async () => {
    await controller.dispose()
    await facility.closeAll()
    await backend.close()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const sessionId = SessionId(randomUUID())
  const request = { kind: 'create' as const, title: 'New analysis', objective: '', environmentIds: ['local'], maxAttempts: 3 }
  const operationId = randomUUID()
  const create = () => controller.createWorkspaceTask(sessionId, operationId, workspace,
    { title: request.title, environmentIds: request.environmentIds }, async () => request)
  await create()
  const project = () => controller.projects()[0]!
  return { root, workspace, controller, journal, artifacts, sessionId, operationId, request, create, project }
}

it('creates once without an objective, keeps an operator rename, and learns only the first real message', async () => {
  const h = await harness()
  await h.create()
  const defaults = vi.fn(() => Promise.reject(new Error('Workspace defaults changed')))
  await h.controller.createWorkspaceTask(h.sessionId, h.operationId, h.workspace,
    { title: h.request.title, environmentIds: h.request.environmentIds }, defaults)
  expect(defaults).not.toHaveBeenCalled()
  expect(h.controller.projects()).toHaveLength(1)
  expect(h.project()).toMatchObject({ objective: '', mainSessionId: h.sessionId })
  await h.controller.manageProject(h.project().id, { operationId: randomUUID(), expectedRevision: h.journal.view().revision,
    action: { kind: 'rename', title: 'Owned task' } })
  await h.controller.describeWorkspaceTask(h.sessionId, 'message', 'Review this directory')
  await h.controller.describeWorkspaceTask(h.sessionId, 'next-message', 'Follow-up')
  expect(h.project()).toMatchObject({ title: 'Owned task', objective: 'Review this directory' })
})


it('registers only the selected root and preserves its target on repeated preparation', async () => {
  const h = await harness()
  const put = vi.spyOn(h.artifacts, 'put')
  const read = vi.spyOn(h.artifacts, 'read')
  const imported = vi.spyOn(h.artifacts, 'import')
  await h.controller.ensureWorkspaceTarget(h.sessionId)
  await h.controller.ensureWorkspaceTarget(h.sessionId)
  const assets = h.controller.view(h.sessionId).records.filter(item => item.kind === 'asset')
  expect(assets).toHaveLength(1)
  expect(assets[0]?.value).toMatchObject({ kind: 'workspace', root: h.workspace })
  expect(put).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect(imported).not.toHaveBeenCalled()
})

it('adds a workspace target to a historical task without replacing its source snapshot', async () => {
  const h = await harness()
  const previous = h.project().workspaceMaterials!.assetId!
  const historical = recordSchema.parse({ kind: 'asset', value: { kind: 'source', id: previous,
    engagementId: h.project().id, label: 'Historical source', identity: 'measured',
    artifact: { sha256: 'a'.repeat(64), size: 4, mediaType: 'application/vnd.dsh.source-tree+json' },
    inputSource: { kind: 'path', path: h.workspace } } })
  await h.journal.commit(randomUUID(), undefined, {}, () => [historical])
  const imported = vi.spyOn(h.artifacts, 'import')
  const put = vi.spyOn(h.artifacts, 'put')
  await Promise.all([h.controller.ensureWorkspaceTarget(h.sessionId), h.controller.ensureWorkspaceTarget(h.sessionId)])
  const assets = h.controller.view(h.sessionId).records.filter(item => item.kind === 'asset')
  expect(assets).toHaveLength(2)
  expect(assets.find(item => item.value.id === previous)).toEqual(historical)
  expect(h.project().workspaceMaterials!.assetId).not.toBe(previous)
  expect(imported).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()
})
