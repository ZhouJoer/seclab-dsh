/** Deployment-owned budgets for optional Jev consultations. @module */
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'

/** All bounds apply before an automatic consultation is admitted. */
export interface Config {
  /** Enable progress assessments and automatic consultations. */
  enabled: boolean
  /** TypeSafe systemone URL; HTTPS except for loopback test servers. */
  endpoint: string
  /** Bearer credential, never included in Session events. */
  apiKey: string
  /** Explicit Jev model version sent with every assessment. */
  model: string
  /** Completed tool-bearing steps required before the first assessment. */
  minToolSteps: number
  /** Additional tool-bearing steps between assessments. */
  checkEverySteps: number
  /** Maximum automatic consultations admitted within one turn. */
  maxConsultationsPerTurn: number
  /** Minimum probability assigned to consult_advisor. */
  probabilityThreshold: number
  /** Minimum provider confidence required for consultation. */
  confidenceThreshold: number
  /** Deadline in milliseconds, including response-body consumption. */
  timeoutMs: number
  /** Maximum UTF-8 bytes in the complete serialized Jev request. */
  maxRequestBytes: number
  /** Maximum response bytes accepted before JSON parsing. */
  maxResponseBytes: number
  /** Maximum retained calls, evicting the oldest first. */
  maxEvidenceCalls: number
  /** Maximum UTF-16 code units per evidence field, including its truncation marker. */
  maxFieldChars: number
}
/** Loader defaults; mounting the plugin alone makes no external requests. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(false),
  endpoint: Schema.string().default('https://api.typesafe.ai/v1/systemone'),
  apiKey: Schema.string().role('secret').default(''),
  model: Schema.string().default('jev-1.13.0'),
  minToolSteps: Schema.number().default(3), checkEverySteps: Schema.number().default(3),
  maxConsultationsPerTurn: Schema.number().default(1),
  probabilityThreshold: Schema.number().default(0.85), confidenceThreshold: Schema.number().default(0.8),
  timeoutMs: Schema.number().default(5000), maxRequestBytes: Schema.number().default(24000),
  maxResponseBytes: Schema.number().default(64000), maxEvidenceCalls: Schema.number().default(24),
  maxFieldChars: Schema.number().default(2000),
})

const positive = z.number().int().positive()
const schema = z.object({
  enabled: z.boolean(), endpoint: z.url(), apiKey: z.string(), model: z.string().trim().min(1),
  minToolSteps: positive, checkEverySteps: positive, maxConsultationsPerTurn: positive,
  probabilityThreshold: z.number().min(0).max(1), confidenceThreshold: z.number().min(0).max(1),
  timeoutMs: positive.max(2147483647), maxRequestBytes: positive, maxResponseBytes: positive,
  maxEvidenceCalls: positive, maxFieldChars: positive,
})

/**
 * Validate configuration before registering effects or sending credentials.
 * @param config Loader-resolved configuration.
 * @returns Detached validated settings.
 */
export function resolveConfig(config: Config): Config {
  const result = schema.parse(config)
  const url = new URL(result.endpoint)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('advisor-jev: endpoint requires HTTPS (loopback HTTP is allowed), without URL credentials, query or fragment')
  }
  if (result.enabled && !result.apiKey.trim()) throw new Error('advisor-jev: set apiKey before enabling automatic consultation')
  return result
}
