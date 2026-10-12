/** Fixed model-facing operations and role admission for external analysis tools. @module */
import type { ToolDefinition } from './tool-definitions.ts'
import type { ToolboxInventory } from './toolbox-types.ts'

/** Each adapter accepts task parameters, never an executable or command program. */
export const toolAdapters = [
  { id: 'radare2', operations: ['identity', 'functions', 'imports', 'exports', 'strings', 'xrefs-to', 'xrefs-from', 'disassemble'],
    description: 'Inspect binary metadata, functions, references and bounded disassembly.',
    parameters: { address: { type: 'string', description: 'Hexadecimal virtual address, for example 0x401000.' },
      count: { type: 'integer', description: 'Maximum instructions for disassembly.' } } },
  { id: 'r2ghidra', operations: ['decompile'], description: 'Decompile one function at a hexadecimal virtual address.',
    parameters: { address: { type: 'string', required: true } } },
  { id: 'tshark', operations: ['summary', 'packets'], description: 'Query an imported PCAP/PCAPNG file. Never opens a live capture interface.',
    parameters: { filter: { type: 'string', description: 'Wireshark display filter.' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Packet fields, such as frame.number, ip.src and tcp.port.' },
      count: { type: 'integer', description: 'Maximum input packets decoded.' } } },
  { id: 'jadx', operations: ['decompile'], description: 'Decompile an imported APK or DEX, optionally selecting one class.',
    parameters: { className: { type: 'string' } } },
  { id: 'file', operations: ['identity'], description: 'Identify an imported file using its contents.', parameters: {} },
  { id: 'strings', operations: ['strings'], description: 'Read printable strings with byte offsets.',
    parameters: { minLength: { type: 'integer' }, encoding: { type: 'string', enum: ['ascii', 'utf16le'] } } },
  { id: 'readelf', operations: ['headers', 'sections', 'symbols', 'dynamic'], description: 'Inspect ELF headers and named tables.', parameters: {} },
  { id: 'objdump', operations: ['headers', 'disassemble'], description: 'Inspect object headers or disassemble a bounded address range.',
    parameters: { startAddress: { type: 'string' }, endAddress: { type: 'string' } } },
  { id: 'nm', operations: ['symbols'], description: 'List object symbols and their addresses.', parameters: {} },
] as const

/** Resolve the shared installation of a dedicated adapter.
 * @param id - Adapter identity.
 * @returns installation identity; unknown adapters are rejected.
 */
export function adapterInstallation(id: string): string {
  if (!toolAdapters.some(tool => tool.id === id)) throw new Error('Unknown tool adapter: ' + id)
  return id === 'r2ghidra' ? 'radare2' : id
}

/** Project task-facing capabilities without executable discovery or launcher configuration.
 * @param tool - Operator catalog definition.
 * @param details - Whether to include the invocation guide.
 * @returns model-facing definition, retaining legacy workflows for tools without an adapter.
 */
export function modelToolDefinition(tool: ToolDefinition, details: boolean): object {
  const adapter = toolAdapters.find(item => item.id === tool.id)
  const brief = { id: tool.id, label: tool.label, description: adapter?.description ?? tool.description,
    tags: tool.tags, dependency: tool.dependency, provider: tool.provider, skills: tool.skills }
  if (!adapter) return details ? tool : { ...brief, invocation: tool.invocation }
  return { ...brief, invocation: 'adapter', toolName: 'security_' + adapter.id, operations: [...adapter.operations],
    ...(details ? { guide: adapter.description + ' Call security_' + adapter.id
      + ' with an imported asset and semantic parameters. Installation and execution environment are managed by the operator. Use this interface for the listed operations.' } : {}) }
}

/** Remove launch configuration from model inventory rows backed by dedicated adapters.
 * @param inventory - Operator installation observations.
 * @returns task-facing health without launch arguments for adapted tools.
 */
export function modelToolInventory(inventory: ToolboxInventory): object {
  return { ...inventory, tools: inventory.tools.map(tool => toolAdapters.some(adapter => adapter.id === tool.id)
    ? { id: tool.id, status: tool.status, version: tool.version, dependency: tool.dependency,
      toolName: 'security_' + tool.id, detail: tool.status === 'available' ? '' : 'Check this tool and its dependencies in operator tool settings.' }
    : tool) }
}

/** Match a registered adapter tool without interpreting model command text.
 * @param name - DSH tool name.
 * @returns catalog identity, or undefined for other tools.
 */
export function adapterToolId(name: string): string | undefined {
  return toolAdapters.find(tool => name === 'security_' + tool.id)?.id
}

/** Admit only declared read-only operations for the caller's analysis role.
 * @param role - durable role.
 * @param operation - resolved adapter operation.
 * @returns whether the role may collect this observation.
 */
export function canUseAdapter(role: string, operation: string): boolean {
  const [id, action] = operation.split('.')
  const tool = toolAdapters.find(item => item.id === id)
  if (!tool || !tool.operations.some(item => item === action) || ['researcher', 'reviewer'].includes(role)) return false
  if (role === 'web-analyst') return id === 'tshark'
  if (role !== 'reconnaissance') return true
  return id === 'tshark' || ['identity', 'headers', 'sections', 'symbols', 'dynamic', 'functions', 'imports', 'exports', 'strings'].includes(action ?? '')
}
