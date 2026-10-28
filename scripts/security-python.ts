/** Provision isolated security dependencies before publishing an interpreter selection. @module */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { z } from 'zod'
import { dshHomePath } from '../packages/util/home-paths/src/index.ts'
import { withFileLock } from '../packages/util/atomic-write/src/index.ts'
import { builtinToolPack } from '../packages/experimental/security-analysis/src/builtin-tools.ts'
import { readToolSettings, resolveSecurityToolsFile, writeSecurityToolsFile } from './security-tools-config.ts'

const requirements = fileURLToPath(new URL('./security-python-requirements.txt', import.meta.url))
const identityCode = 'import json,sys,struct; print(json.dumps({"executable":sys.executable,"prefix":sys.prefix,"base":sys.base_prefix,"version":list(sys.version_info[:3]),"bits":struct.calcsize("P")*8}))'
const identitySchema = z.object({ executable: z.string().min(1), prefix: z.string(), base: z.string(),
  version: z.tuple([z.number().int(), z.number().int(), z.number().int()]), bits: z.number() })
const moduleCheck = 'import capstone,pefile,r2pipe,unicorn,frida,frida_tools,requests,pydantic; from unicorn import Uc,UC_ARCH_ARM,UC_MODE_ARM; from unicorn.arm_const import UC_ARM_REG_R0; u=Uc(UC_ARCH_ARM,UC_MODE_ARM); u.mem_map(4096,4096); u.mem_write(4096,bytes.fromhex("2a00a0e3")); u.emu_start(4096,4100,count=1); assert u.reg_read(UC_ARM_REG_R0)==42; assert list(capstone.Cs(capstone.CS_ARCH_ARM,capstone.CS_MODE_ARM).disasm(bytes.fromhex("2a00a0e3"),4096)); assert frida.get_local_device().type=="local"'

/** Shell-free Python process invocation returning bounded stdout. */
export type PythonRunner = (command: string, args: string[]) => Promise<string>

/** Explicit base interpreter and installation configuration for one provisioning operation. */
export interface SecurityPythonOptions {
  /** Long-lived, independently installed Python executable or launcher. */
  python: string
  /** Launcher arguments, for example `-3.14` for Windows py. */
  pythonArgs: string[]
  /** Absolute local tool settings file selected by the same rules as the toolbox. */
  config: string
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
  const base = identitySchema.parse(JSON.parse(await run(options.python, [...options.pythonArgs, '-I', '-c', identityCode])))
  if (base.prefix !== base.base || base.bits !== 64 || base.version[0] !== 3 || base.version[1] < 12 || base.version[1] > 14)
    throw new Error('Select a standalone 64-bit Python 3.12–3.14 with --python; virtual environments are not base installations.')
  const root = join(dirname(options.config), 'runtimes')
  await mkdir(root, { recursive: true })
  const environment = await mkdtemp(join(root, 'security-python-'))
  try {
    const lockedRequirements = await readFile(requirements, 'utf8')
    await writeFile(join(environment, 'requirements.txt'), lockedRequirements, { flag: 'wx' })
    await run(options.python, [...options.pythonArgs, '-I', '-m', 'venv', environment])
    const python = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const identity = identitySchema.parse(JSON.parse(await run(python, ['-I', '-c', identityCode])))
    if (resolve(identity.prefix) !== resolve(environment) || identity.prefix === identity.base || identity.base !== base.base)
      throw new Error('Created Python does not belong to the requested virtual environment and base installation.')
    await run(python, ['-I', '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--require-virtualenv',
      '-r', join(environment, 'requirements.txt')])
    await run(python, ['-I', '-m', 'pip', '--isolated', 'check'])
    await run(python, ['-I', '-c', moduleCheck])
    const definition = builtinToolPack.tools.find(tool => tool.id === 'python')
    if (!definition) throw new Error('Python tool definition is missing')
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

/** Parse setup options and report the committed interpreter; each child has an explicit deadline.
 * @param args - CLI arguments.
 * @returns completion after validation and atomic configuration publication.
 */
export async function setupSecurityPython(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: {
    python: { type: 'string' }, 'python-arg': { type: 'string', multiple: true },
    config: { type: 'string' }, 'timeout-ms': { type: 'string', default: '600000' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('pnpm security:python --python EXECUTABLE [--python-arg=ARG] [--config FILE] [--timeout-ms 600000]\nRequires standalone 64-bit Python 3.12–3.14. Creates a fresh environment, installs pinned dependencies and selects it only after validation. Existing environments are retained. Use the same --config for security:tools and toolConfiguration.path when overriding the profile defaults.')
    return
  }
  if (!values.python) throw new Error('Specify a long-lived standalone Python using --python EXECUTABLE. Setup does not install system Python or select an application cache automatically.')
  const timeout = Number(values['timeout-ms'])
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('--timeout-ms must be an integer from 1 to 2147483647')
  const config = resolveSecurityToolsFile(process.cwd(), dshHomePath(), values.config)
  const python = await initializeSecurityPython({ python: values.python, pythonArgs: values['python-arg'] ?? [], config }, async (command, commandArgs) => {
    const result = await execa(command, commandArgs, { timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
    return result.stdout
  })
  console.log(`Python ready: ${python}\nConfiguration: ${config}\nRefresh the toolbox, then run pnpm security:doctor python unicorn capstone pefile r2pipe frida --config "${config}"`)
}

if (import.meta.main) {
  try { await setupSecurityPython(process.argv.slice(2)) } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
