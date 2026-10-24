/** Task-owned capability selection shared by model discovery and execution. @module */
import { z } from 'zod'

/** Stable module identities; common investigation capabilities are always present. */
export const analysisModuleIdSchema = z.enum(['reverse.android', 'reverse.native', 'web', 'iot', 'pentest'])
/** A supported analysis module. */
export type AnalysisModuleId = z.infer<typeof analysisModuleIdSchema>
/** Persisted selection; automatic decisions require an explanation, not additional authority. */
export const moduleSelectionSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  modules: z.array(analysisModuleIdSchema).max(4).refine(ids => new Set(ids).size === ids.length, 'Repeated analysis module'),
  reason: z.string().trim().max(500),
}).strict()
/** Saved module preferences and the most recent routing decision. */
export type ModuleSelection = z.infer<typeof moduleSelectionSchema>
/** Read-only resource association, independent of installed tool health. */
export interface AnalysisModule {
  id: AnalysisModuleId
  description: string
  skills: readonly string[]
  tools: readonly string[]
  scripts: readonly string[]
}
/** Module metadata is discoverable without loading instructions or probing tools. */
export const analysisModules: readonly AnalysisModule[] = [
  { id: 'reverse.android', description: 'APK, DEX and JAR: manifest, Java/Kotlin, API and JNI entry points.',
    skills: ['security-android'], tools: ['jadx', 'adb', 'apk', 'analysis'],
    scripts: ['analysis.android-fingerprint', 'analysis.android-api', 'analysis.kotlin-names', 'analysis.android-callchain'] },
  { id: 'reverse.native', description: 'PE, ELF, shared libraries and firmware: native code and bounded process observations.',
    skills: ['security-native', 'security-firmware', 'security-dynamic'],
    tools: ['radare2', 'r2ghidra', 'ghidra', 'readelf', 'objdump', 'nm', 'analysis'],
    scripts: ['analysis.native-triage', 'analysis.native-xref-paths', 'dynamic.module-watch', 'dynamic.function-trace'] },
  { id: 'web', description: 'Web source, HTTP APIs and authorized application behavior.',
    skills: ['security-web', 'security-kali'], tools: [], scripts: [] },
  { id: 'iot', description: 'Offline captures, MQTT, wireless protocols and device logs.',
    skills: ['security-iot-offline', 'security-packet-analysis', 'security-mqtt'], tools: ['tshark', 'packet-capture'],
    scripts: ['tshark.wireless', 'tshark.capture-summary', 'tshark.extract-packets', 'mqtt.sessions', 'mqtt.topics'] },
  { id: 'pentest', description: 'Authorized penetration testing through operator-managed Kali environments: network, Web/API, password and wireless scenarios.',
    skills: ['security-kali', 'security-web'], tools: [], scripts: [] },
]

/** Resolve absent historical selections without rewriting their records.
 * @param selection - saved selection, if any.
 * @returns independent automatic or manual state.
 */
export function resolveModuleSelection(selection?: ModuleSelection): ModuleSelection {
  return selection ? structuredClone(selection) : { mode: 'auto', modules: [], reason: '' }
}

/** Resolve specialist methods for one task.
 * @param selection - committed task selection.
 * @returns names to enable for model invocation.
 */
export function moduleSkills(selection?: ModuleSelection): string[] {
  return [...new Set(analysisModules.filter(module => selection?.modules.includes(module.id)).flatMap(module => module.skills))]
}

/** Restrict dedicated tool discovery; common identity and workspace tools remain available.
 * @param name - registered tool name.
 * @param selection - committed task selection.
 * @returns whether the module permits this tool independently of role and permissions.
 */
export function moduleAllowsTool(name: string, selection?: ModuleSelection): boolean {
  const owners = analysisModules.filter(module => module.tools.some(id => name.replaceAll('-', '_') === 'security_' + id.replaceAll('-', '_')))
  return !owners.length || owners.some(module => selection?.modules.includes(module.id))
}

/** Filter catalog methods using their declared skill associations.
 * @param tool - catalog identity and associated methods.
 * @param selection - committed task selection.
 * @returns whether dedicated and skill-associated capability owners are enabled.
 */
export function moduleAllowsDefinition(tool: { id: string; skills: readonly string[] }, selection?: ModuleSelection): boolean {
  if (!moduleAllowsTool('security_' + tool.id, selection)) return false
  const owners = analysisModules.filter(module => module.skills.some(skill => tool.skills.includes(skill)))
  return !owners.length || owners.some(module => selection?.modules.includes(module.id))
}

/** Enforce module selection at the operation owner, including generic provider calls.
 * @param provider - provider identity.
 * @param operation - semantic operation.
 * @param selection - committed task selection.
 * @returns whether this operation belongs to an active or common capability.
 */
export function moduleAllowsOperation(provider: string, operation: string, selection?: ModuleSelection): boolean {
  const enabled = (id: AnalysisModuleId) => selection?.modules.includes(id) ?? false
  if (provider === 'tool-adapter') {
    if (operation.startsWith('analysis.')) return enabled(operation.startsWith('analysis.native-') ? 'reverse.native' : 'reverse.android')
    const tool = operation.split('.')[0] ?? ''
    return moduleAllowsTool('security_' + tool, selection)
  }
  if (provider === 'android') return enabled('reverse.android')
  if (provider === 'ghidra' || provider === 'frida') return enabled('reverse.native')
  if (provider === 'web' || provider === 'external-web') return enabled('web')
  if (provider === 'packet-capture' || provider === 'offline') return enabled('iot')
  return true
}
