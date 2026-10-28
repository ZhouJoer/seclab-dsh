/** Validated security commands shared by Host execution and browser consumers. @module */
import { z } from 'zod'
import { moduleSelectionSchema } from '../analysis-modules.ts'
import { taskContextSchema } from '../task-context.ts'
import {
  checkSchema,
  externalWebAssetSchema,
  findingSchema,
  knowledgeEntrySchema,
  operationSchema,
  phaseSchema,
  taskOutcomeSchema,
  citationSchema,
} from './model.ts'

const text = z.string().trim().min(1)
/** External HTTP target accepted while creating or importing a task. */
export const externalTargetInput = externalWebAssetSchema.pick({
  origin: true,
  pathPrefix: true,
  allowedAddresses: true,
  environmentId: true,
  label: true,
})
const checkInput = checkSchema.omit({
  id: true,
  engagementId: true,
  status: true,
  attempts: true,
  rationale: true,
  ownerSessionId: true,
})
const references = { evidenceIds: z.array(text).max(20).default([]), citations: z.array(citationSchema).max(20).optional() }
const resultInput = taskOutcomeSchema.shape.results.element.extend(references)
const actions = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      title: text,
      objective: z.string().trim(),
      environmentIds: z.array(text),
      maxAttempts: z.number().int().positive(),
      target: externalTargetInput.optional(),
      taskContext: taskContextSchema.nullable().optional(),
      moduleSelection: moduleSelectionSchema.optional(),
      unsealed: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('select'), engagementId: text }).strict(),
  z.object({ kind: z.literal('leave') }).strict(),
  z.object({ kind: z.literal('modules'), selection: moduleSelectionSchema }).strict(),
  z.object({ kind: z.literal('checkpoint'), id: text.optional(), phase: phaseSchema,
    title: text.max(100), reason: z.string().max(300), summary: z.string().max(300), next: z.string().max(300),
    evidenceIds: z.array(text), findingIds: z.array(text),
  }).strict(),
  z.object({ kind: z.literal('import'), path: text, label: text }).strict(),
  z.object({ kind: z.literal('import-source'), path: text.describe('Absolute source file or directory inside the configured import roots. A selected file imports only that file.'), label: text }).strict(),
  z.object({ kind: z.literal('import-member'), assetId: text, path: text.describe('Exact relative path from the imported source manifest.'), label: text }).strict(),
  z.object({ kind: z.literal('import-legacy'), path: text, title: text }).strict(),
  z.object({ kind: z.literal('check'), check: checkInput }).strict(),
  z.object({ kind: z.literal('web-target'), environmentId: text, label: text, pathPrefix: text.default('/') }).strict(),
  z.object({ kind: z.literal('external-web-target'), environmentId: text, label: text,
    origin: text, pathPrefix: text, allowedAddresses: z.array(text).min(1) }).strict(),
  z.object({ kind: z.literal('finding-http-reference'), findingId: text, evidenceId: text, stepId: text,
    role: z.enum(['baseline', 'verification', 'supporting']) }).strict(),
  z.object({ kind: z.literal('revise-finding'), findingId: text, title: text, explanation: text, conditions: text, ...references }).strict(),
  z.object({ kind: z.literal('conclude'), reviewId: text }).strict(),
  z.object({ kind: z.literal('delegation-disposition'), delegationId: text,
    decision: z.enum(['accepted', 'needs-more', 'rejected']), reason: text }).strict(),
  z.object({ kind: z.literal('report') }).strict(),
  taskOutcomeSchema.extend({ kind: z.literal('complete-task'), results: z.array(resultInput).min(1).max(30) }).strict(),
  z.object({ kind: z.literal('template'), assetId: text }).strict(),
  z.object({ kind: z.literal('finish'), checkId: text, evidenceIds: z.array(text), rationale: text }).strict(),
  z.object({ kind: z.literal('reopen'), checkId: text, rationale: text }).strict(),
  z.object({ kind: z.literal('reconcile'), checkId: text, rationale: text }).strict(),
  z.object({ kind: z.literal('finding'), finding: findingSchema.omit({ id: true, engagementId: true }).extend(references) }).strict(),
  z
    .object({
      kind: z.literal('plan'),
      checkId: text,
      operation: operationSchema,
      script: z.string().optional(),
      hypothesis: text,
      expectedObservation: text,
      impact: text,
      cleanup: text,
      durationMs: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('approve'), planId: text }).strict(),
  z.object({ kind: z.literal('revoke'), planId: text }).strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('publish'), knowledgeId: text }).strict(),
  z.object({ kind: z.literal('remember'), entry: knowledgeEntrySchema }).strict(),
])
/** Structured command shared by model tools and the Web controller. */
export const commandSchema = z
  .object({
    operationId: text,
    expectedRevision: z.number().int().nonnegative(),
    action: actions,
  })
  .strict()
/** Parsed, boundary-validated command. */
export type SecurityCommand = z.infer<typeof commandSchema>
