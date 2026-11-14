/** Shared isolated Python provisioning without project configuration effects. @module */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import assert from 'node:assert/strict'

/** Shell-free Python invocation; the caller owns deadlines, cancellation and output limits. */
export type PythonRunner = (command: string, args: string[]) => Promise<string>

const identityCode = 'import json,sys,struct; print(json.dumps({"executable":sys.executable,"prefix":sys.prefix,"base":sys.base_prefix,"version":list(sys.version_info[:3]),"bits":struct.calcsize("P")*8}))'
const identitySchema = z.object({ executable: z.string().min(1), prefix: z.string(), base: z.string(),
  version: z.tuple([z.number().int(), z.number().int(), z.number().int()]), bits: z.number() })
const moduleCheck = 'import capstone,pefile,r2pipe,unicorn,frida,frida_tools,requests,pydantic; from unicorn import Uc,UC_ARCH_ARM,UC_MODE_ARM; from unicorn.arm_const import UC_ARM_REG_R0; u=Uc(UC_ARCH_ARM,UC_MODE_ARM); u.mem_map(4096,4096); u.mem_write(4096,bytes.fromhex("2a00a0e3")); u.emu_start(4096,4100,count=1); assert u.reg_read(UC_ARM_REG_R0)==42; assert list(capstone.Cs(capstone.CS_ARCH_ARM,capstone.CS_MODE_ARM).disasm(bytes.fromhex("2a00a0e3"),4096)); assert frida.get_local_device().type=="local"'

/** Packaged dependency lock consumed by both operator installation and repository setup. */
export const securityPythonRequirements = fileURLToPath(new URL('../resources/security-python-requirements.txt', import.meta.url))

/** Resolve the complete pinned dependency transaction, with no implicit dependency downloads.
 * @param directory - fresh virtual-environment directory.
 * @returns isolated pip arguments shared by preview and execution.
 */
export function securityPythonInstallArguments(directory: string): string[] {
  return ['-I', '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--require-virtualenv',
    '--require-hashes', '--only-binary=:all:', '--no-deps', '--no-cache-dir', '--index-url', 'https://pypi.org/simple', '-r', join(directory, 'requirements.txt')]
}

/** Recheck locked module versions and native behavior without reinstalling packages.
 * @param python - selected virtual-environment interpreter.
 * @param requirements - retained reviewed requirements contents.
 * @param run - owned process executor.
 */
export async function verifySecurityPythonModules(python: string, requirements: string, run: PythonRunner): Promise<void> {
  const versions = Object.fromEntries([...requirements.matchAll(/^([a-zA-Z0-9_-]+)==([^\s\\]+).*$/gmu)].map((match) => {
    assert(match[1] && match[2], 'Dependency lock matches contain name and version')
    return [match[1], match[2]]
  }))
  if (!Object.keys(versions).length) throw new Error('The retained Python dependency lock is empty')
  await run(python, ['-I', '-m', 'pip', '--isolated', 'check'])
  await run(python, ['-I', '-B', '-c', `import importlib.metadata; expected=${JSON.stringify(versions)}; assert all(importlib.metadata.version(name)==version for name,version in expected.items()), "Installed versions differ from the reviewed dependency lock"`])
  await run(python, ['-I', '-B', '-c', moduleCheck])
}

/** Probe a supported independently installed interpreter without changing it.
 * @param command - selected interpreter or launcher.
 * @param args - fixed launcher arguments.
 * @param run - owned process executor.
 * @returns interpreter identity after architecture and version validation.
 */
export async function inspectSecurityPython(command: string, args: string[],
  run: PythonRunner): Promise<z.infer<typeof identitySchema>> {
  const identity = identitySchema.parse(JSON.parse(await run(command, [...args, '-I', '-c', identityCode])))
  if (identity.prefix !== identity.base || identity.bits !== 64 || identity.version[0] !== 3
    || identity.version[1] < 12 || identity.version[1] > 14)
    throw new Error('Select a standalone 64-bit Python 3.12–3.14; virtual environments are not base installations.')
  return identity
}

/** Populate a caller-owned fresh directory and verify the pinned analysis modules.
 * Failed directories remain available for diagnosis; no interpreter selection is published here.
 * @param options - explicit base interpreter, fresh destination and target platform.
 * @param run - owned process executor.
 * @returns verified virtual-environment executable.
 */
export async function provisionSecurityPython(options: {
  python: string
  pythonArgs: string[]
  directory: string
  platform: NodeJS.Platform
}, run: PythonRunner): Promise<string> {
  const base = await inspectSecurityPython(options.python, options.pythonArgs, run)
  await writeFile(join(options.directory, 'requirements.txt'), await readFile(securityPythonRequirements, 'utf8'), { flag: 'wx' })
  await run(options.python, [...options.pythonArgs, '-I', '-m', 'venv', options.directory])
  const python = join(options.directory, options.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const identity = identitySchema.parse(JSON.parse(await run(python, ['-I', '-c', identityCode])))
  if (resolve(identity.prefix) !== resolve(options.directory) || identity.prefix === identity.base || identity.base !== base.base)
    throw new Error('Created Python does not belong to the requested virtual environment and base installation.')
  await run(python, securityPythonInstallArguments(options.directory))
  await verifySecurityPythonModules(python, await readFile(join(options.directory, 'requirements.txt'), 'utf8'), run)
  return python
}
