/** Fixed reverse-analysis scripts consume verified adapter artifacts through stdin. @module */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { adapterResultSchema, adapterProcessFailure, retainAdapterResult } from './tool-adapter-results.ts'
import { fileAsset } from './workbench/assessment.ts'
import { runProcess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisResult } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'

/** Run a packaged, non-programmable evidence transformation.
 * @param ctx - subprocess owner.
 * @param request - validated fixed operation.
 * @param context - controller-authorized input evidence and process limits.
 * @param maxItems - deployment item bound.
 * @param graceMs - subprocess cancellation grace.
 * @returns immutable structured candidates with input completeness and diagnostics.
 */
export async function runReverseAnalysis(ctx: Context, request: AnalysisOperation, context: AnalysisContext,
  maxItems: number, graceMs: number): Promise<AnalysisResult> {
  const operation = request.operation.slice('analysis.'.length)
  const accepted = operation.startsWith('native-')
    ? ['radare2', 'r2ghidra', 'readelf', 'objdump', 'nm', 'file', 'strings']
    : operation === 'android-fingerprint' ? ['apk', 'jadx'] : ['jadx']
  if (!context.inputEvidence?.length) throw new Error('Select saved adapter evidence for this asset')
  let total = 0
  const sources = []
  let graphOrigin: string | undefined
  for (const evidence of context.inputEvidence) {
    total += evidence.artifact.size
    if (total > context.maxOutputBytes) throw new Error('Analysis inputs exceed the artifact byte budget')
    if (evidence.provider !== 'tool-adapter') throw new Error('Analysis requires structured adapter evidence')
    const result = adapterResultSchema.parse(JSON.parse((await context.artifacts.read(evidence.artifact)).toString('utf8')))
    if (result.inputSha256 !== fileAsset(context.asset).artifact.sha256 || !accepted.includes(result.tool)
      || result.operation !== evidence.operation
      || (operation === 'android-callchain' && result.operation !== 'jadx.callgraph')
      || (operation === 'native-xref-paths' && !['radare2.functions', 'radare2.xrefs-to', 'radare2.xrefs-from', 'radare2.strings', 'radare2.imports', 'radare2.exports', 'radare2.symbols'].includes(result.operation))
      || (['android-api', 'kotlin-names'].includes(operation) && result.operation !== 'jadx.decompile'))
      throw new Error('Input evidence does not match the selected analysis operation')
    if (['native-xref-paths', 'android-callchain'].includes(operation)) {
      const origin = JSON.stringify([result.environmentId, result.tool, result.toolVersion])
      if (graphOrigin !== undefined && graphOrigin !== origin) throw new Error('Graph evidence must use one environment and tool version')
      graphOrigin = origin
    }
    sources.push({ evidenceId: evidence.id, result: {
      tool: result.tool, operation: result.operation, items: result.items,
      incomplete: result.incomplete || evidence.incomplete || !!evidence.failure,
    } })
  }
  const script = await readFile(new URL('../resources/analysis-scripts/reverse/analyze.py', import.meta.url), 'utf8')
  const process = await runProcess(ctx, context.environment, 'python', ['-I', '-u', '-B', '-c', script,
    '--operation', operation, '--max-items', String(maxItems), '--max-output-bytes', String(Math.floor(context.maxOutputBytes / 2))],
  { signal: context.signal, durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs },
  JSON.stringify({ sources, parameters: request.parameters }))
  const failure = adapterProcessFailure(process) ?? (process.truncated ? 'Analysis output exceeded the process byte limit' : undefined)
  const output = failure || process.truncated ? { items: [], incomplete: true, diagnostics: process.stderr }
    : z.object({ items: z.array(z.json()), incomplete: z.boolean(), diagnostics: z.string() }).strict().parse(JSON.parse(process.stdout))
  const retained = retainAdapterResult({ format: 'security-tool-result-v1', tool: 'analysis', operation: request.operation,
    environmentId: context.environment.id, inputSha256: fileAsset(context.asset).artifact.sha256,
    toolVersion: 'dsh-reverse-analysis-v1', items: output.items,
    incomplete: output.incomplete || sources.some(source => source.result.incomplete) || process.truncated || !!failure,
    diagnostics: [output.diagnostics, failure].filter(Boolean).join('\n'),
    raw: { inputEvidenceIds: sources.map(source => source.evidenceId), scriptSha256: createHash('sha256').update(script).digest('hex'), process: { ...process } },
  }, context.maxOutputBytes)
  return { ...retained, mediaType: 'application/json', summary: operation + ': ' + String(output.items.length) + ' candidates',
    toolVersion: 'dsh-reverse-analysis-v1', method: 'static', observationKind: 'inventory', ...(failure ? { failure } : {}) }
}
