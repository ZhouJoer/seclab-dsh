/** Fixed model-facing operations and role admission for external analysis tools. @module */
import type { ToolDefinition } from './tool-definitions.ts'
import type { ToolboxInventory } from './toolbox-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'

/** Each adapter accepts task parameters, never an executable or command program. */
export const staticToolAdapters = [
  { id: 'radare2', operations: ['identity', 'functions', 'imports', 'exports', 'symbols', 'strings', 'xrefs-to', 'xrefs-from', 'disassemble'],
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

/** Model capability, operator route and prerequisites for one read-only interface. */
export interface ToolAdapterDefinition {
  id: string
  toolName: string
  provider: 'tool-adapter' | 'ghidra' | 'android' | 'packet-capture'
  operations: readonly string[]
  description: string
  parameters: Readonly<Record<string, unknown>>
  bindingId: string
  installationIds: readonly string[]
  probeIds: readonly string[]
  environmentKinds: readonly SecurityEnvironment['kind'][]
  requiresDevice: boolean
}

/** Existing providers retain their own output formats, role checks and execution lifetime. */
export const toolAdapters = [
  ...staticToolAdapters.map(adapter => ({ ...adapter, toolName: 'security_' + adapter.id, provider: 'tool-adapter' as const,
    bindingId: adapter.id === 'r2ghidra' ? 'radare2' : adapter.id,
    installationIds: [adapter.id === 'r2ghidra' ? 'radare2' : adapter.id],
    probeIds: adapter.id === 'r2ghidra' ? ['radare2', 'r2ghidra'] : [adapter.id],
    environmentKinds: ['local', 'docker'] as const, requiresDevice: false })),
  { id: 'ghidra', toolName: 'security_ghidra', provider: 'ghidra', bindingId: 'ghidra',
    operations: ['identity', 'functions', 'imports', 'exports', 'strings', 'decompile', 'disassemble', 'xrefs-to', 'xrefs-from'],
    description: 'Query the managed Ghidra program bound to an imported sample. Database writes still require a validation plan.',
    parameters: { address: { type: 'string', description: 'Function or reference hexadecimal address.' },
      offset: { type: 'integer' }, limit: { type: 'integer' }, filter: { type: 'string' } },
    installationIds: [], probeIds: [], environmentKinds: ['local'], requiresDevice: false },
  { id: 'adb', toolName: 'security_adb', provider: 'android', bindingId: 'adb',
    operations: ['device', 'packages', 'package-info'],
    description: 'Inspect the operator-selected Android device and installed packages. Does not accept shell commands or change the device.',
    parameters: { packageName: { type: 'string', description: 'Package identity required for package-info.' } },
    installationIds: ['adb'], probeIds: ['adb'], environmentKinds: ['local', 'android'], requiresDevice: true },
  { id: 'packet-capture', toolName: 'security_packet_capture', provider: 'packet-capture', bindingId: 'packet-capture',
    operations: ['summary', 'packets'], description: 'Decode Wi-Fi or BLE records from an imported PCAP/PCAPNG. Never opens a live interface.',
    parameters: { protocol: { type: 'string', required: true, enum: ['wifi', 'ble'] },
      filter: { type: 'string', description: 'TShark display filter.' }, maxPackets: { type: 'integer' },
      maxDecodeBytes: { type: 'integer' } },
    installationIds: ['python', 'tshark'], probeIds: ['python', 'tshark'], environmentKinds: ['local'], requiresDevice: false },
] as const satisfies readonly ToolAdapterDefinition[]

/** Check execution support without treating detection results as permission.
 * @param adapter - Implemented capability.
 * @param environment - Operator-owned execution world.
 * @returns whether this adapter supports the environment's transport.
 */
export function supportsAdapterEnvironment(adapter: ToolAdapterDefinition, environment: Pick<SecurityEnvironment, 'kind' | 'externalContainer'>): boolean {
  return !environment.externalContainer && adapter.environmentKinds.includes(environment.kind)
}

/** Resolve the shared installation of a dedicated adapter.
 * @param id - Adapter identity.
 * @returns installation identity; unknown adapters are rejected.
 */
export function adapterInstallation(id: string): string {
  if (!staticToolAdapters.some(tool => tool.id === id)) throw new Error('Unknown static tool adapter: ' + id)
  return id === 'r2ghidra' ? 'radare2' : id
}

/** Project task-facing capabilities without executable discovery or launcher configuration.
 * @param tool - Operator catalog definition.
 * @param details - Whether to include the invocation guide.
 * @param native - Include the existing advanced workflow instead of the dedicated interface.
 * @param adapterOnly - Omit native fallback instructions for checked operator selections.
 * @returns model-facing definition, retaining legacy workflows for tools without an adapter.
 */
export function modelToolDefinition(tool: ToolDefinition, details: boolean, native = false, adapterOnly = false): object {
  const adapter = toolAdapters.find(item => item.id === tool.id)
  const brief = { id: tool.id, label: tool.label, description: adapter?.description ?? tool.description,
    tags: tool.tags, dependency: tool.dependency, provider: tool.provider, skills: tool.skills }
  if (!adapter) return details ? tool : { ...brief, invocation: tool.invocation }
  if (native) return { ...(details ? tool : { ...brief, invocation: tool.invocation }),
    adapter: { toolName: adapter.toolName, operations: [...adapter.operations] } }
  return { ...brief, invocation: 'adapter', toolName: adapter.toolName, operations: [...adapter.operations],
    supportedEnvironments: [...adapter.environmentKinds], externalContainer: false,
    ...(details ? { guide: adapter.description + ' Call ' + adapter.toolName
      + ' with an imported asset and semantic parameters. Installation and execution environment are managed by the operator. Use this interface for the listed operations in supported environments.'
      + (adapterOnly ? ' Report unsupported operations to the operator; checked preferences disable native workflows.'
        : ' For other operations or an external container, request security_capabilities details with native: true and security_environment with native: true; existing native workflows remain available.') } : {}) }
}

/** Remove launch configuration from model inventory rows backed by dedicated adapters.
 * @param inventory - Operator installation observations.
 * @param options - Native workflow selection and external-container ownership.
 * @returns task-facing health without launch arguments for adapted tools.
 */
export function modelToolInventory(inventory: ToolboxInventory,
  options: { native?: boolean; externalContainer?: boolean; adapterOnly?: boolean } = {}): object {
  return { ...inventory, tools: inventory.tools.map((tool) => {
    const adapter = toolAdapters.find(adapter => adapter.id === tool.id
      && adapter.environmentKinds.some(kind => kind === inventory.kind))
    return !options.native && !options.externalContainer && adapter
      ? { id: tool.id, status: tool.status, version: tool.version, dependency: tool.dependency,
        toolName: adapter.toolName,
        detail: tool.status === 'available'
          ? 'Available through ' + adapter.toolName + '; this does not establish a Shell command on PATH.'
            + (options.adapterOnly ? ' Use the adapter directly and report unsupported operations to the operator.'
              : ' For operations outside the adapter, request security_environment with native: true and use its exact command and prefixArgs. Do not search for another executable.')
          : [tool.detail, 'Check this tool and its dependencies in operator tool settings.'].filter(Boolean).join('\n') }
      : tool
  }) }
}

/** Reduce one measured text field to its first line within a fixed width.
 * @param text - complete measured field.
 * @returns first line, trimmed to 160 characters.
 */
function firstLine(text: string): string {
  return text.split(/\r?\n/u, 1).join('').slice(0, 160)
}

/**
 * Compact a measured inventory to environment health and per-tool identity when
 * the complete projection exceeds the model output budget. Launch
 * configuration, locations and sources stay reachable through narrowed
 * toolId or toolIds queries, which return one tool's full row.
 * @param inventory - Operator installation observations.
 * @returns budget-stable projection keeping kind, runtime, workdir and each
 *   tool's id, status, dependency, version line and failure detail.
 */
export function compactToolInventory(inventory: ToolboxInventory): object {
  return {
    environmentId: inventory.environmentId, kind: inventory.kind, runtime: inventory.runtime,
    detail: firstLine(inventory.detail), checkedAt: inventory.checkedAt, workdir: inventory.workdir,
    ...(inventory.containerId === undefined ? {} : { containerId: inventory.containerId }),
    compact: 'The complete inventory exceeded the output budget; query toolId or toolIds for each tool\'s full entry and launch configuration',
    tools: inventory.tools.map(tool => ({
      id: tool.id, status: tool.status, ...(tool.dependency === undefined ? {} : { dependency: tool.dependency }),
      version: firstLine(tool.version),
      ...(tool.status === 'available' ? {} : { detail: firstLine(tool.detail) }),
    })),
  }
}

/** Match a registered adapter tool without interpreting model command text.
 * @param name - DSH tool name.
 * @returns catalog identity, or undefined for other tools.
 */
export function adapterToolId(name: string): string | undefined {
  return toolAdapters.find(tool => name === tool.toolName)?.id
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
  if (id === 'packet-capture') return true
  if (role === 'web-analyst') return id === 'tshark'
  if (id === 'adb') return true
  if (role !== 'reconnaissance') return true
  return id === 'tshark' || ['identity', 'headers', 'sections', 'symbols', 'dynamic', 'functions', 'imports', 'exports', 'strings'].includes(action ?? '')
}
