/** Fixed model-facing operations and role admission for external analysis tools. @module */

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
