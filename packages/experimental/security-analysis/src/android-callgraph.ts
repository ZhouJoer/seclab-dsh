/** Decode JADX's own call graph and method locations without inferring calls from text. @module */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'

const graphSchema = z.object({
  nodes: z.array(z.object({ id: z.number().int(), method: z.string() })),
  edges: z.array(z.object({ from: z.number().int(), to: z.number().int(), resolved: z.boolean() })),
})
const methodSchema = z.object({ signature: z.string(), declaration: z.string(), offset: z.string().optional(),
  lines: z.array(z.object({ code: z.string(), offset: z.string().optional(), 'source-line': z.number().optional() })).optional() })
const classSchema = z.object({ name: z.string(), methods: z.array(methodSchema).optional() })

/** Normalize the upstream graph, preserving exact descriptors and explicit source locations.
 * @param files - retained JADX JSON output files.
 * @returns method and edge observations; the caller preserves collection incompleteness.
 */
export function jadxCallgraphItems(files: readonly { path: string; text: string }[]): JsonValue[] {
  const file = files.find(item => item.path === 'callgraph.json')
  if (!file) throw new Error('JADX callgraph.json is missing; configure a JADX version supporting --call-graph json')
  const graph = graphSchema.parse(JSON.parse(file.text))
  const ids = new Map(graph.nodes.map(node => [node.id, node.method]))
  if (ids.size !== graph.nodes.length) throw new Error('JADX call graph contains repeated node IDs')
  const items: JsonValue[] = graph.nodes.map(node => ({ kind: 'method', method: node.method, path: file.path }))
  for (const edge of graph.edges) {
    const from = ids.get(edge.from), to = ids.get(edge.to)
    if (!from || !to) throw new Error('JADX call graph references an absent method')
    items.push({ kind: 'call', from, to, resolved: edge.resolved, basis: 'jadx-callgraph', path: file.path,
      callSite: null })
  }
  for (const source of files.filter(item => item.path.startsWith('sources/') && item.path !== 'sources/mapping.json')) {
    const cls = classSchema.parse(JSON.parse(source.text))
    for (const method of cls.methods ?? []) items.push({ kind: 'method-detail', method: cls.name + '.' + method.signature,
      path: source.path, declaration: method.declaration, offset: method.offset ?? null,
      lines: method.lines?.map(line => ({ code: line.code, offset: line.offset ?? null, sourceLine: line['source-line'] ?? null })) ?? [] })
  }
  return items
}
