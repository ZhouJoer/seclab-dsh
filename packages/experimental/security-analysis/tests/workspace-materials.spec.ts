/** Filesystem changes publish immutable, task-scoped materials. @module */
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, onTestFinished, vi } from 'vitest'
import { openSecurityJournal } from '../src/workbench/journal.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { SecurityController } from '../src/workbench/controller.ts'
import { sourceManifest } from '../src/workbench/source.ts'
import { modelPage } from '../src/workbench/model-view.ts'
import { WorkspaceMaterialSync } from '../src/workspace-materials.ts'

async function harness(maxBytes = 65536) {
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
    reportLimits: { inputBytes: 32768, maxChars: 1200, maxFindings: 5, maxLessons: 3, outputBytes: 16384 },
  }, async () => '')
  const observers: WorkspaceMaterialSync[] = []
  onTestFinished(async () => {
    for (const sync of observers) await sync.close()
    await controller.dispose()
    await facility.closeAll()
    await backend.close()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const sync = new WorkspaceMaterialSync(controller, artifacts, join(root, 'output'), {
    maxEntries: 100, maxBytes, debounceMs: 10, excludedDirectories: ['node_modules', '.git'],
  })
  observers.push(sync)
  const sessionId = SessionId(randomUUID())
  const request = { kind: 'create' as const, title: 'New analysis', objective: '', environmentIds: ['local'], maxAttempts: 3 }
  const operationId = randomUUID()
  const create = () => controller.createWorkspaceTask(sessionId, operationId, workspace,
    { title: request.title, environmentIds: request.environmentIds }, async () => request)
  await create()
  const project = () => controller.projects()[0]!
  const manifest = async () => {
    const asset = controller.projectView(project().id).records.find(item => item.kind === 'asset' && item.value.id === project().workspaceMaterials?.assetId)
    if (!asset || asset.kind !== 'asset') throw new Error('No workspace material snapshot')
    return sourceManifest(artifacts, asset.value)
  }
  return { root, workspace, sync, controller, journal, artifacts, sessionId, operationId, request, create, project, manifest }
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

it('follows add/change/delete and retains original bytes after releasing one of two shared leases', async () => {
  const h = await harness()
  await mkdir(join(h.workspace, 'build'))
  await mkdir(join(h.workspace, 'node_modules'))
  await writeFile(join(h.workspace, '.gitignore'), 'build/')
  await writeFile(join(h.workspace, 'build', 'sample.exe'), 'MZ original')
  await writeFile(join(h.workspace, 'node_modules', 'ignored.js'), 'dependency')
  const release = await h.sync.retain(h.project().id)
  const second = await h.sync.retain(h.project().id)
  await h.sync.flush(h.project().id)
  const original = await h.manifest()
  expect(original.files.map(item => item.path)).toEqual(['.gitignore', 'build/sample.exe'])
  const sample = original.files.find(item => item.path === 'build/sample.exe')!
  await release()
  await writeFile(join(h.workspace, 'build', 'sample.exe'), 'MZ changed')
  await vi.waitFor(async () => {
    expect((await h.manifest()).files.find(item => item.path === sample.path)?.artifact.sha256).not.toBe(sample.artifact.sha256)
  })
  expect((await h.artifacts.read(sample.artifact)).toString()).toBe('MZ original')
  await writeFile(join(h.workspace, 'new.txt'), 'new file')
  await vi.waitFor(async () => { expect((await h.manifest()).files.some(item => item.path === 'new.txt')).toBe(true) })
  await rm(join(h.workspace, 'new.txt'))
  await vi.waitFor(async () => { expect((await h.manifest()).files.some(item => item.path === 'new.txt')).toBe(false) })
  const visible = modelPage(h.controller.projectView(h.project().id), { kind: 'asset', offset: 0 }, 65536)
  expect(visible.records).toHaveLength(1)
  expect(h.controller.projectView(h.project().id).records.filter(item => item.kind === 'asset').length).toBeGreaterThan(1)
  await second()
  expect(h.sync.state(h.project().id)).toBeUndefined()
})

it('keeps the last successful snapshot on a budget failure and recovers with a full scan', async () => {
  const h = await harness(32)
  await writeFile(join(h.workspace, 'small.txt'), 'small')
  await h.sync.retain(h.project().id)
  await h.sync.flush(h.project().id)
  const before = h.project().workspaceMaterials?.assetId
  await writeFile(join(h.workspace, 'large.txt'), 'x'.repeat(33))
  await expect(h.sync.refresh(h.project().id)).rejects.toThrow('byte limit')
  expect(h.project().workspaceMaterials?.assetId).toBe(before)
  await rm(join(h.workspace, 'large.txt'))
  await writeFile(join(h.workspace, 'small.txt'), 'fixed')
  await h.sync.refresh(h.project().id)
  expect(h.sync.state(h.project().id)?.state).toBe('ready')
  const member = (await h.manifest()).files[0]!
  expect((await h.artifacts.read(member.artifact)).toString()).toBe('fixed')
})

it('shares one scan across tasks and rescans when a missing directory returns', async () => {
  const h = await harness()
  await rm(h.workspace, { recursive: true })
  const secondSession = SessionId(randomUUID())
  await h.controller.createWorkspaceTask(secondSession, randomUUID(), h.workspace, {
    title: 'Second task', environmentIds: ['local'],
  }, async () => ({ maxAttempts: 3 }))
  const secondProject = h.controller.projects().find(item => item.mainSessionId === secondSession)!
  await h.sync.retain(h.project().id)
  await h.sync.retain(secondProject.id)
  await expect(h.sync.flush(h.project().id)).rejects.toThrow()
  await mkdir(h.workspace)
  await writeFile(join(h.workspace, 'restored.txt'), 'restored')
  await h.sync.refresh(h.project().id)
  expect(h.controller.projects().every(item => item.workspaceMaterials?.assetId)).toBe(true)
  const manifest = await h.manifest()
  expect(manifest.files.map(item => item.path)).toEqual(['restored.txt'])
})
