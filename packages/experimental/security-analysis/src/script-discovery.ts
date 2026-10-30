/** Bounded model discovery of packaged scripts, without probing their dependencies. @module */
import { fileURLToPath } from 'node:url'
import { analysisScripts } from './analysis-scripts.ts'
import type { AnalysisScript } from './analysis-script-types.ts'

interface ScriptDiscovery {
  id: string
  description: string
  toolIds: string[]
  skill: string
  invocation: string
  path?: string
  example?: string
  parameters?: AnalysisScript['parameters']
}

/** Search script purposes and identifiers; guides and paths are loaded only for selected entries.
 * @param query - free text, or an empty string for all entries.
 * @param ids - explicit script identities; omission searches all scripts.
 * @param details - include invocation parameters and package paths when true.
 * @returns matching script descriptions, without granting execution permission.
 */
export function discoverScripts(query: string, ids: readonly string[] | undefined, details: boolean): ScriptDiscovery[] {
  const scripts = analysisScripts().map(script => ({ id: String(script.id), path: script.path,
    description: [script.kind, script.category, script.skill].join(' '), toolIds: script.toolIds,
    skill: script.skill, example: script.example, parameters: script.parameters,
    invocation: script.id.startsWith('analysis.') ? 'adapter' : 'native' }))
  for (const operation of ['map', 'patch']) scripts.push({
    id: 'pe.' + operation,
    description: operation === 'map' ? 'PE address conversion VA RVA file offset 地址 映射 偏移'
      : 'PE explicit byte patch manifest 字节 补丁', invocation: 'native',
    path: fileURLToPath(new URL('../resources/analysis-scripts/reverse/pe.py', import.meta.url)),
    toolIds: ['python', 'pefile'], skill: 'security-native',
    parameters: [], example: 'python "<resourceBase>/reverse/pe.py" ' + operation + ' --help',
  })
  for (const id of ids ?? []) if (!scripts.some(script => script.id === id)) throw new Error('Unknown script: ' + id)
  const words = query.toLowerCase().trim().split(/\s+/u).filter(Boolean)
  return scripts.filter(script => (!ids?.length || ids.includes(script.id)) && (!words.length
    || words.some(word => [script.id, script.description, ...script.toolIds].join(' ').toLowerCase().includes(word))))
    .map(({ id, description, toolIds, skill, path, example, parameters, invocation }) => ({
      id, description, toolIds, skill, invocation,
      ...(details ? { path, example, parameters } : {}),
    }))
}
