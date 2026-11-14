/** Provision isolated security dependencies before publishing an interpreter selection. @module */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { dshHomePath } from '../packages/util/home-paths/src/index.ts'
import { withFileLock } from '../packages/util/atomic-write/src/index.ts'
import { builtinToolPack } from '../packages/experimental/security-analysis/src/builtin-tools.ts'
import { readToolSettings, resolveSecurityToolsFile, writeSecurityToolsFile } from './security-tools-config.ts'
import { manageToolInstallations } from './security-tool-installations.ts'

import { inspectSecurityPython, provisionSecurityPython, type PythonRunner } from '../packages/experimental/security-analysis/src/security-python-install.ts'
export type { PythonRunner } from '../packages/experimental/security-analysis/src/security-python-install.ts'

/** Explicit base interpreter and installation configuration for one provisioning operation. */
export interface SecurityPythonOptions {
  /** Long-lived, independently installed Python executable or launcher. */
  python: string
  /** Launcher arguments, for example `-3.14` for Windows py. */
  pythonArgs: string[]
  /** Absolute local tool settings file selected by the same rules as the toolbox. */
  config: string
  /** Explicit caller-owned root for this internal provisioning helper. */
  directory: string
}

/** Build and verify a fresh environment, then atomically select it without replacing other tools.
 * Failed or superseded environments remain beside the configuration for diagnosis and explicit cleanup.
 * Existing interpreters are never modified; concurrent configuration edits reject the commit.
 * @param options - explicit interpreter and destination.
 * @param run - bounded subprocess executor.
 * @returns selected virtual-environment executable.
 */
export async function initializeSecurityPython(options: SecurityPythonOptions, run: PythonRunner): Promise<string> {
  const before = readToolSettings(options.config)
  await inspectSecurityPython(options.python, options.pythonArgs, run)
  const root = options.directory
  await mkdir(root, { recursive: true })
  const environment = await mkdtemp(join(root, 'security-python-'))
  try {
    const python = await provisionSecurityPython({ ...options, directory: environment, platform: process.platform }, run)
    const definition = builtinToolPack.tools.find(tool => tool.id === 'python')
    if (!definition) throw new Error('Python tool definition is missing')
    await mkdir(dirname(options.config), { recursive: true })
    await withFileLock(options.config, () => {
      const current = readToolSettings(options.config)
      if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error('Tool settings changed during installation; run setup again.')
      current.installations.local = { ...current.installations.local,
        python: { command: python, prefixArgs: [], versionArgs: definition.args } }
      writeSecurityToolsFile(options.config, JSON.stringify(current, null, 2) + '\n')
      return Promise.resolve()
    })
    return python
  } catch (error) {
    throw new Error(`Python setup did not complete. Inspect ${environment}; existing interpreters were not changed. Check the tool configuration before retrying.`, { cause: error })
  }
}

/** Preview a shared-root Python installation without starting installation or publishing a selection.
 * @param args - CLI arguments.
 * @returns completion after the durable reviewed plan is printed.
 */
export async function setupSecurityPython(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: {
    python: { type: 'string' }, 'python-arg': { type: 'string', multiple: true },
    config: { type: 'string' }, 'timeout-ms': { type: 'string', default: '600000' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('pnpm security:python --python EXECUTABLE [--python-arg=ARG] [--config FILE] [--timeout-ms 600000]\nPreview a Python analysis environment in the shared installation root. First select it with security:tools install-root DIRECTORY. Apply the returned plan with security:tools install-apply PLAN --digest DIGEST --request-id ID. Requires standalone 64-bit Python 3.12–3.14. The preview does not install software or change the selected interpreter.')
    return
  }
  if (!values.python) throw new Error('Specify a long-lived standalone Python using --python EXECUTABLE. Setup does not install system Python or select an application cache automatically.')
  const timeout = Number(values['timeout-ms'])
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('--timeout-ms must be an integer from 1 to 2147483647')
  const config = resolveSecurityToolsFile(process.cwd(), dshHomePath(), values.config)
  await manageToolInstallations(['install-preview', 'python-analysis', '--option', 'python=' + values.python,
    '--option', 'pythonArgs=' + JSON.stringify(values['python-arg'] ?? [])], {
    file: config, environmentsFile: join(values.config ? dirname(config) : join(process.cwd(), '.dsh'), 'security-environments.json'),
    environmentId: 'local',
    catalog: builtinToolPack.tools, limits: { metadataTimeoutMs: timeout },
  })
}

if (import.meta.main) {
  try { await setupSecurityPython(process.argv.slice(2)) } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
