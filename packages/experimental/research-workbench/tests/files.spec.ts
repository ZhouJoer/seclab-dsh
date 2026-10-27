/** Real-file editing guards, lossless encodings, and isolated Session roots. @module */
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ResearchFiles, type ResearchScope } from '../src/index.ts'
import { decodeResearchText } from '../src/text.ts'

let ctx: Context
let root: string
let directory: string
let files: ResearchFiles
const session = SessionId('research-test')
const signal = () => new AbortController().signal
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-research-'))
  directory = join(root, '工作目录')
  await mkdir(directory)
  ctx = new Context()
  await ctx.plugin(LocalFileSystem)
  files = new ResearchFiles(ctx, { maxTextBytes: 128, maxEntries: 2 })
  vi.spyOn(files, 'scope').mockImplementation(async (_id, control): Promise<ResearchScope> => ({ root: await ctx.fs.resolve(directory, { signal: control }),
    cwd: directory, policy: { mode: 'workspace-write', workspaceRoot: root, sessionId: session } }))
})
afterEach(async () => { vi.restoreAllMocks(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })

it.each(['plain\n', '\uFEFF中文\r\n末尾', 'without-final-newline', ''])('preserves UTF-8 BOM, newline style and final newline for %j', async (text) => {
  const path = join(directory, '草稿.txt')
  await writeFile(path, text)
  const before = await files.read(session, path, signal())
  await files.save(session, { ...before, text: before.text }, signal())
  expect(await readFile(path)).toEqual(Buffer.from(text))
})
it('retains external changes and refuses a stale editor version', async () => {
  const path = join(directory, 'a.txt')
  await writeFile(path, 'baseline')
  const before = await files.read(session, path, signal())
  await writeFile(path, 'external mutation')
  await expect(files.save(session, { ...before, text: 'draft' }, signal())).rejects.toMatchObject({ code: 'research/conflict' })
  expect(await readFile(path, 'utf8')).toBe('external mutation')
})
it('does not recreate a renamed file or write after a directory switch', async () => {
  const path = join(directory, 'a.txt')
  await writeFile(path, 'baseline')
  const before = await files.read(session, path, signal())
  await rename(path, join(directory, 'b.txt'))
  await expect(files.save(session, { ...before, text: 'draft' }, signal())).rejects.toMatchObject({ code: 'research/not-file' })
  directory = join(root, 'second'); await mkdir(directory); await writeFile(join(directory, 'a.txt'), 'other project')
  await expect(files.save(session, { ...before, path: 'a.txt', text: 'draft' }, signal())).rejects.toMatchObject({ code: 'research/conflict' })
  expect(await readFile(join(directory, 'a.txt'), 'utf8')).toBe('other project')
})
it('rejects files outside the canonical root and directory junction escapes', async () => {
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'a.txt'), 'private')
  await expect(files.read(session, '../outside/a.txt', signal())).rejects.toMatchObject({ code: 'research/outside-workspace' })
  await symlink(outside, join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(files.read(session, 'link/a.txt', signal())).rejects.toMatchObject({ code: 'research/outside-workspace' })
})
it('rejects a changed read rather than returning a mixed baseline', async () => {
  const path = join(directory, 'a.txt'); await writeFile(path, 'before')
  const read = ctx.fs.readBytes.bind(ctx.fs)
  vi.spyOn(ctx.fs, 'readBytes').mockImplementationOnce(async (...args) => { const bytes = await read(...args); await writeFile(path, 'after-reading'); return bytes })
  await expect(files.read(session, path, signal())).rejects.toMatchObject({ code: 'research/conflict' })
})
it('refuses oversized buffers and makes binary, mixed newline and invalid UTF-8 read-only', async () => {
  await writeFile(join(directory, 'large.txt'), 'x'.repeat(129))
  await expect(files.read(session, 'large.txt', signal())).rejects.toThrow()
  for (const [name, bytes, reason] of [['binary', Buffer.from('a\0b'), 'binary'], ['mixed', Buffer.from('a\r\nb\n'), 'mixed'], ['encoding', Buffer.from([255, 254, 0]), 'encoding']] as const) {
    await writeFile(join(directory, name), bytes)
    const original = await files.read(session, name, signal())
    expect(original).toMatchObject({ writable: false, reason })
    await expect(files.save(session, { ...original, text: 'draft' }, signal())).rejects.toMatchObject({ code: 'research/read-only' })
  }
  expect(decodeResearchText(Buffer.from('a\rb'))).toMatchObject({ writable: false, reason: 'mixed' })
})
