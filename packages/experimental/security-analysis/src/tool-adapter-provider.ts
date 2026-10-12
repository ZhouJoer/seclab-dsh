/** Fixed external-tool queries over immutable project artifacts. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import { AndroidProvider } from './android-provider.ts'
import { inspectToolbox } from './toolbox.ts'
import { toolboxCatalog } from './toolbox.ts'
import { toolAdapters } from './tool-adapter-catalog.ts'
import { adapterProcessFailure, retainAdapterResult } from './tool-adapter-results.ts'
import { fileAsset } from './workbench/assessment.ts'
import { isPacketCapture } from './workbench/artifacts.ts'
import { runProcess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'

/** Deployment-owned collection and teardown bounds. */
export interface ToolAdapterLimits {
  /** Maximum semantic observations retained per analysis. */
  maxItems: number
  /** Maximum instructions requested in one radare2 disassembly. */
  maxInstructions: number
  /** Maximum input frames examined by one offline TShark query. */
  maxPackets: number
  /** Time in milliseconds allowed for process cleanup. */
  graceMs: number
}
const address = z.string().regex(/^0x[0-9a-fA-F]{1,16}$/u)
const count = z.number().int().positive()
const argsSchema = z.object({ address: address.optional(), startAddress: address.optional(), endAddress: address.optional(),
  count: count.optional(), filter: z.string().max(4096).optional(),
  fields: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/u)).min(1).max(64).optional(),
  className: z.string().regex(/^[a-zA-Z0-9_.$]+$/u).optional(), minLength: count.max(1024).optional(),
  encoding: z.enum(['ascii', 'utf16le']).optional(),
}).strict()
const operationParts = (operation: string) => {
  const adapter = toolAdapters.find(tool => tool.operations.some(action => tool.id + '.' + action === operation))
  if (!adapter) throw new Error('Unknown static tool adapter operation')
  return { adapter, action: operation.slice(adapter.id.length + 1) }
}

/** Build provider-owned argv after validating all command-language values.
 * @param operation - declared tool and operation.
 * @param parameters - resolved semantic arguments.
 * @param path - materialized immutable input path.
 * @returns argv without an executable or launcher prefix.
 */
export function adapterArguments(operation: string, parameters: unknown, path: string): string[] {
  const { adapter, action } = operationParts(operation)
  const args = argsSchema.parse(parameters)
  switch (adapter.id) {
    case 'radare2':
    case 'r2ghidra': {
      const queries: Record<string, string> = { identity: 'ij', functions: 'aflj', imports: 'iij', exports: 'iEj',
        strings: 'izj', 'xrefs-to': 'axtj', 'xrefs-from': 'axfj', disassemble: 'pdj', decompile: 'pdgj' }
      const targeted = ['xrefs-to', 'xrefs-from', 'disassemble', 'decompile'].includes(action)
      if (targeted && !args.address) throw new Error('This operation requires a hexadecimal virtual address')
      const analysis = ['functions', 'xrefs-to', 'xrefs-from', 'decompile'].includes(action) ? 'aa;' : ''
      const command = queries[action]
      if (!command) throw new Error('Unsupported radare2 query')
      const query = command + (action === 'disassemble' ? ' ' + String(args.count) : '')
      return ['-N', '-q', '-e', 'scr.color=0', '-c', analysis + query + (targeted && args.address ? ' @ ' + args.address : ''), path]
    }
    case 'tshark': return ['-n', '-r', path, '-c', String(args.count), ...(args.filter ? ['-Y', args.filter] : []),
      '-T', 'json', ...(args.fields ?? []).flatMap(field => ['-e', field])]
    case 'file': return ['-b', '--', path]
    case 'strings': return ['-a', '-t', 'x', '-n', String(args.minLength), '-e', args.encoding === 'utf16le' ? 'l' : 's', '--', path]
    case 'readelf': return ['-W', { headers: '-h', sections: '-S', symbols: '-s', dynamic: '-d' }[action] ?? '-h', '--', path]
    case 'objdump': {
      if (action === 'headers') return ['-h', '--', path]
      if (!args.startAddress || !args.endAddress || BigInt(args.startAddress) >= BigInt(args.endAddress))
        throw new Error('Disassembly requires an increasing hexadecimal address range')
      return ['-d', '--start-address=' + args.startAddress, '--stop-address=' + args.endAddress, '--', path]
    }
    case 'nm': return ['-P', '-n', '--', path]
    case 'jadx': throw new Error('JADX execution belongs to the Android provider')
  }
}

/** Decode native tool output without interpreting diagnostic text as observations.
 * @param operation - declared tool and operation.
 * @param stdout - complete collected stdout.
 * @returns semantic records, retaining source addresses or line locations.
 */
export function decodeAdapterOutput(operation: string, stdout: string): JsonValue[] {
  const { adapter, action } = operationParts(operation)
  if (adapter.id === 'radare2' || adapter.id === 'r2ghidra') {
    const value = z.json().parse(JSON.parse(stdout))
    if (adapter.id === 'r2ghidra') return [z.object({ code: z.string() }).catchall(z.json()).parse(value)]
    if (action === 'identity') return [z.object({ core: z.record(z.string(), z.json()) }).catchall(z.json()).parse(value)]
    return z.array(z.record(z.string(), z.json())).parse(value)
  }
  if (adapter.id === 'tshark') {
    const packets = z.array(z.object({ _source: z.object({ layers: z.record(z.string(), z.json()) }) })).parse(JSON.parse(stdout))
    const items = packets.map(packet => ({ frameNumber: packet._source.layers['frame.number'] ?? null, fields: packet._source.layers }))
    if (action === 'packets') return items
    const protocols = new Map<string, number>()
    for (const { fields } of items) {
      const value = fields['frame.protocols']
      const protocol = (Array.isArray(value) ? value[0] : value)
      const name = typeof protocol === 'string' ? protocol : 'unknown'
      protocols.set(name, (protocols.get(name) ?? 0) + 1)
    }
    return [...protocols].map(([protocols, packets]) => ({ protocols, packets }))
  }
  if (adapter.id === 'file') return stdout.trim() ? [{ description: stdout.trim() }] : []
  const records: JsonValue[] = []
  for (const [index, line] of stdout.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    const sourceLine = index + 1
    if (adapter.id === 'strings') {
      const match = /^\s*([a-fA-F0-9]+) (.*)$/u.exec(line)
      if (!match) throw new Error('Unexpected strings output at line ' + String(sourceLine))
      records.push({ offset: '0x' + String(match[1]), text: match[2] ?? '', sourceLine })
    } else if (adapter.id === 'nm') {
      const match = /^(\S+)\s+(\S)(?:\s+([a-fA-F0-9]+))?(?:\s+([a-fA-F0-9]+))?\s*$/u.exec(line)
      if (!match) throw new Error('Unexpected nm output at line ' + String(sourceLine))
      records.push({ name: match[1] ?? '', type: match[2] ?? '', address: match[3] ? '0x' + match[3] : null,
        size: match[4] ? '0x' + match[4] : null, sourceLine })
    } else if (adapter.id === 'objdump' && action === 'disassemble') {
      const match = /^\s*([a-fA-F0-9]+):\s+((?:[a-fA-F0-9]{2,8}\s+)+)\s*(.*)$/u.exec(line)
      if (match) records.push({ address: '0x' + String(match[1]), bytes: match[2]?.trim() ?? '', instruction: match[3] ?? '', sourceLine })
    } else if (adapter.id === 'readelf' && action === 'symbols') {
      const match = /^\s*(\d+):\s+([a-fA-F0-9]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/u.exec(line)
      if (match) records.push({ index: Number(match[1]), address: '0x' + String(match[2]), size: Number(match[3]),
        type: match[4] ?? '', binding: match[5] ?? '', visibility: match[6] ?? '', section: match[7] ?? '', name: match[8] ?? '', sourceLine })
    } else if (adapter.id === 'readelf' && action === 'sections') {
      const match = /^\s*\[\s*(\d+)\]\s+(\S+)\s+(\S+)\s+([a-fA-F0-9]+)\s+([a-fA-F0-9]+)\s+([a-fA-F0-9]+)\s+(.*)$/u.exec(line)
      if (match) records.push({ index: Number(match[1]), name: match[2] ?? '', type: match[3] ?? '', address: '0x' + String(match[4]),
        fileOffset: '0x' + String(match[5]), size: '0x' + String(match[6]), attributes: match[7] ?? '', sourceLine })
    } else if (adapter.id === 'readelf' && action === 'dynamic') {
      const match = /^\s*(0x[a-fA-F0-9]+)\s+\(([^)]+)\)\s+(.*)$/u.exec(line)
      if (match) records.push({ tag: match[1] ?? '', name: match[2] ?? '', value: match[3] ?? '', sourceLine })
    } else if (adapter.id === 'objdump' && action === 'headers') {
      const match = /^\s*(\d+)\s+(\S+)\s+([a-fA-F0-9]+)\s+([a-fA-F0-9]+)\s+([a-fA-F0-9]+)\s+([a-fA-F0-9]+)\s+(.*)$/u.exec(line)
      if (match) records.push({ index: Number(match[1]), name: match[2] ?? '', size: '0x' + String(match[3]), address: '0x' + String(match[4]),
        loadAddress: '0x' + String(match[5]), fileOffset: '0x' + String(match[6]), alignment: match[7] ?? '', sourceLine })
    } else {
      const colon = line.indexOf(':')
      records.push(colon > 0 ? { field: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), sourceLine }
        : { columns: line.trim().split(/\s+/u), sourceLine })
    }
  }
  return records
}

/** Executes fixed read-only queries with environment-owned installations. */
export class ToolAdapterProvider implements AnalysisProvider {
  readonly id = 'tool-adapter'
  readonly operations = toolAdapters.flatMap(tool => tool.operations.map(action => tool.id + '.' + action))
  readonly inputGuide = 'Use the dedicated security_<tool> tools with an imported asset and semantic parameters. Environment selection and installation belong to operator settings.'
  constructor(private readonly ctx: Context, private readonly limits: ToolAdapterLimits, private readonly maxFiles: number) {}
  activityTools(request: AnalysisOperation): string[] { return [operationParts(request.operation).adapter.id] }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    const { adapter, action } = operationParts(request.operation)
    if (request.script || context.environment.externalContainer || context.environment.kind === 'android')
      throw new Error('Static tool adapters require local or managed Docker execution without a script')
    const asset = fileAsset(context.asset)
    if (adapter.id === 'jadx' && !['apk', 'dex'].includes(asset.format)) throw new Error('JADX requires APK or DEX input')
    const parameters = argsSchema.parse(request.parameters)
    const allowed = new Set(Object.keys(adapter.parameters))
    for (const key of Object.keys(parameters)) if (!allowed.has(key)) throw new Error('Unsupported parameter for ' + adapter.id + ': ' + key)
    if (adapter.id === 'radare2' && action === 'disassemble') parameters.count = Math.min(parameters.count ?? this.limits.maxInstructions, this.limits.maxInstructions)
    if (adapter.id === 'tshark') {
      parameters.count = Math.min(parameters.count ?? this.limits.maxPackets, this.limits.maxPackets)
      parameters.fields = [...new Set(['frame.number', 'frame.protocols', ...parameters.fields ?? ['frame.len', 'ip.src', 'ip.dst']])]
    }
    if (adapter.id === 'strings') { parameters.minLength ??= 4; parameters.encoding ??= 'ascii' }
    if (adapter.id === 'objdump' && action === 'disassemble' && parameters.startAddress && parameters.endAddress
      && BigInt(parameters.endAddress) - BigInt(parameters.startAddress) > BigInt(context.maxOutputBytes))
      throw new Error('Disassembly range exceeds the configured byte budget')
    if (adapter.id !== 'jadx') adapterArguments(request.operation, parameters, 'input')
    return { ...request, impact: 'observe', parameters: z.record(z.string(), z.json()).parse(parameters) }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const { adapter } = operationParts(request.operation)
    const asset = fileAsset(context.asset)
    const limits = { signal: context.signal, durationMs: context.durationMs,
      maxOutputBytes: Math.floor(context.maxOutputBytes / 8), graceMs: this.limits.graceMs }
    const inventory = await inspectToolbox(this.ctx, context.environment, limits, context.signal, [adapter.id])
    const selected = inventory.tools.find(tool => tool.id === adapter.id)
    if (inventory.runtime !== 'ready' || !selected || selected.status !== 'available')
      throw new Error('Analysis tool unavailable: ' + adapter.id + ': ' + (selected?.detail || inventory.detail || inventory.runtime))
    const installations = inventory.tools.filter(tool => tool.status === 'available' && !tool.dependency).map(tool => ({
      id: tool.id, ...(tool.installation ?? { command: tool.command, prefixArgs: tool.prefixArgs ?? [] }),
      versionArgs: context.environment.tools.find(item => item.id === tool.id)?.versionArgs ?? toolboxCatalog.find(item => item.id === tool.id)?.args ?? ['--version'],
      source: tool.source,
    }))
    const environment = { ...context.environment,
      tools: [...context.environment.tools.filter(tool => !installations.some(item => item.id === tool.id)), ...installations] }
    let items: JsonValue[] = [], raw: JsonValue = null, diagnostics = '', incomplete = false, failure: string | undefined
    if (adapter.id === 'jadx') {
      const provider = new AndroidProvider(this.ctx, { graceMs: this.limits.graceMs, maxFiles: this.maxFiles })
      const result = await provider.run({ ...request, provider: 'android', operation: 'decompile' }, { ...context, environment, maxOutputBytes: limits.maxOutputBytes })
      const output = z.object({ files: z.array(z.object({ path: z.string(), text: z.string() })), diagnostics: z.string(), incomplete: z.boolean(), process: z.json() }).parse(JSON.parse(Buffer.from(result.bytes).toString('utf8')))
      items = output.files; raw = output; incomplete = result.incomplete; diagnostics = output.diagnostics
      failure = result.failure
    } else {
      if (adapter.id === 'tshark' && !isPacketCapture(await context.artifacts.read(asset.artifact))) throw new Error('TShark requires PCAP or PCAPNG input')
      const path = await context.artifacts.materialize(asset.artifact)
      try {
        const process = await runProcess(this.ctx, environment, adapter.id === 'r2ghidra' ? 'radare2' : adapter.id,
          adapterArguments(request.operation, request.parameters, path), limits)
        raw = { ...process }; diagnostics = process.stderr; incomplete = process.truncated
        failure = adapterProcessFailure(process)
        if (!failure && !process.truncated) {
          try {
            items = decodeAdapterOutput(request.operation, process.stdout)
            if (adapter.id === 'tshark' && (request.parameters.filter !== undefined
              || z.array(z.json()).parse(JSON.parse(process.stdout)).length >= Number(request.parameters.count)))
              incomplete = true
          }
          catch (error) { failure = 'Cannot decode ' + adapter.id + ' output: ' + String(error) }
        } else if (!failure) failure = 'Raw tool output exceeded the collection limit; narrow the query'
      } finally { await context.artifacts.release(path) }
    }
    if (items.length > this.limits.maxItems) { items = items.slice(0, this.limits.maxItems); incomplete = true }
    const retained = retainAdapterResult({ format: 'security-tool-result-v1', tool: adapter.id, operation: request.operation,
      environmentId: environment.id, toolVersion: selected.version, inputSha256: asset.artifact.sha256,
      items, raw, diagnostics, incomplete: incomplete || failure !== undefined }, context.maxOutputBytes)
    return { ...retained, mediaType: 'application/json', summary: adapter.id + ': ' + String(items.length) + ' retained observations',
      toolVersion: selected.version, method: 'static', observationKind: ['disassemble', 'decompile'].includes(operationParts(request.operation).action) ? 'implementation' : 'inventory',
      ...(failure === undefined ? {} : { failure }) }
  }
}
