/** Bounded, cancellable TypeSafe HTTP decisions without automatic retries. @module */
import { z } from 'zod'
import type { Config } from './config.ts'
import type { JevAnswer } from './types.ts'

/** Expected transport and validation failure; no Advisor has been called. */
export class JevFailure extends Error {
  /**
   * @param code Stable classification safe to record without server bodies or credentials.
   * @param cause Original local cause, retained outside session logs.
   */
  constructor(readonly code: 'network' | 'timeout' | 'http' | 'response-too-large' | 'invalid-response' | 'input-too-large', cause?: unknown) {
    super(`Automatic progress assessment failed (${code}); continue or consult Advisor manually.`, { cause })
  }
}
const probability = z.number().min(0).max(1)
const answerSchema = z.object({
  model: z.string().min(1),
  answers: z.object({ route: z.object({
    type: z.literal('choice'),
    choice: z.enum(['continue', 'consult_advisor', 'insufficient_evidence', 'external_blocker']),
    probabilities: z.object({
      continue: probability, consult_advisor: probability, insufficient_evidence: probability, external_blocker: probability,
    }),
    confidence: probability,
  }) }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
})

/**
 * Execute one decision; validates the complete response before returning a route.
 * @param request Exact serialized request retained in the Session log.
 * @param config Validated endpoint, credentials and budgets.
 * @param signal Caller cancellation; abort always wins over a late response.
 * @returns Validated decision and provider-reported usage.
 */
export async function evaluate(request: string, config: Config, signal: AbortSignal): Promise<JevAnswer> {
  signal.throwIfAborted()
  if (Buffer.byteLength(request) > config.maxRequestBytes) throw new JevFailure('input-too-large')
  const deadline = new AbortController()
  const timer = setTimeout(() =>{  deadline.abort() }, config.timeoutMs)
  const combined = AbortSignal.any([signal, deadline.signal])
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: request,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new JevFailure('http')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    if (response.body) {
      const reader = response.body.getReader()
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > config.maxResponseBytes) {
            await reader.cancel()
            throw new JevFailure('response-too-large')
          }
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
    }
    let parsed: z.infer<typeof answerSchema>
    try { parsed = answerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
    catch (error) { throw new JevFailure('invalid-response', error) }
    combined.throwIfAborted()
    const route = parsed.answers.route
    const values = Object.values(route.probabilities)
    if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.001
      || values.some(value => value > route.probabilities[route.choice])) throw new JevFailure('invalid-response')
    return { model: parsed.model, choice: route.choice, probabilities: route.probabilities,
      confidence: route.confidence, usage: parsed.usage }
  } catch (error) {
    signal.throwIfAborted()
    if (deadline.signal.aborted) throw new JevFailure('timeout', error)
    if (error instanceof JevFailure) throw error
    throw new JevFailure('network', error)
  } finally { clearTimeout(timer) }
}
