/** Toolbox and source utilities must select the same operator configuration. @module */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { resolveSecurityToolsFile } from './security-tools-config.ts'

it('uses checkout configuration, existing home configuration, and explicit selection in priority order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-security-config-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
  const cwd = join(directory, 'checkout'), home = join(directory, 'home')
  const local = join(cwd, '.dsh/security-tools.json'), legacy = join(home, 'security/tools.json')
  expect(resolveSecurityToolsFile(cwd, home)).toBe(local)
  await mkdir(join(home, 'security'), { recursive: true })
  await writeFile(legacy, '{}')
  expect(resolveSecurityToolsFile(cwd, home)).toBe(legacy)
  await mkdir(join(cwd, '.dsh'), { recursive: true })
  await writeFile(local, '{}')
  expect(resolveSecurityToolsFile(cwd, home)).toBe(local)
  expect(resolveSecurityToolsFile(cwd, home, 'explicit.json')).toBe(resolve(cwd, 'explicit.json'))
})
