/** Operator installation plans, execution receipts and durable progress records. @module */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SecurityEnvironment } from './workbench/providers.ts'
import type { SecurityToolPin } from './local-tools.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Identity of one immutable reviewed installation plan. */
export type ToolInstallationPlanId = Branded<'ToolInstallationPlanId'>
/** Identity of one durable installation attempt. */
export type ToolInstallationOperationId = Branded<'ToolInstallationOperationId'>
/** Caller identity for an idempotent apply request. */
export type ToolInstallationRequestId = Branded<'ToolInstallationRequestId'>
/** Identity of one measured installation shared by projects. */
export type ManagedToolInstallationId = Branded<'ManagedToolInstallationId'>

/** Validated operator request; options are interpreted only by the selected registered recipe. */
export const toolInstallationRequestSchema = z.object({
  recipeId: z.string().min(1).max(100), environmentId: z.string().min(1).max(200),
  action: z.enum(['install', 'repair', 'upgrade', 'remove-owned']),
  options: z.record(z.string().max(100), z.string().max(8192)).default({}),
}).strict()
/** One recipe selection before resolution against the current installation root. */
export type ToolInstallationRequest = z.infer<typeof toolInstallationRequestSchema>

/** Exact human-reviewable acquisition, process or validation step. */
export interface ToolInstallationStep {
  id: string
  kind: 'download' | 'extract' | 'process' | 'verify' | 'publish' | 'manual'
  description: string
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  sha256?: string
  destination?: string
}
/** A recipe resolves all commands and acquisition identities before operator confirmation. */
export interface ToolInstallationRecipePlan {
  recipeId: string
  recipeVersion: string
  toolIds: string[]
  mode: 'private' | 'managed-container' | 'external-container' | 'system-component' | 'manual'
  version: string
  destination: string
  steps: ToolInstallationStep[]
  confirmations: { id: string; description: string }[]
  warnings: string[]
  /** Recipe-owned JSON, included in the reviewed digest and never accepted from apply callers. */
  data: Record<string, JsonValue>
}
/** Reviewed recipe bound to one root, environment and project configuration revision. */
export interface ToolInstallationPlan extends ToolInstallationRecipePlan {
  id: ToolInstallationPlanId
  digest: string
  createdAt: number
  toolRoot: string
  rootRevision: number
  configurationRevision: string
  environment: SecurityEnvironment
  request: ToolInstallationRequest
}
/** A user-selected root affects future plans; existing installations retain their locations. */
export interface ToolInstallationRoot {
  toolRoot: string | null
  revision: number
  writable: boolean
  detail: string
}
/** Bounded prerequisite or verification observation. */
export interface ToolInstallationCheck {
  id: string
  status: 'passed' | 'failed' | 'unknown'
  detail: string
}
/** Installation facts observed by a recipe, before the manager allocates a durable identity. */
export interface ToolInstallationReceipt {
  toolId: string
  version: string
  location: string
  ownership: 'managed' | 'system' | 'external'
  metadata?: Record<string, string>
}
/** Verified output; the manager owns publication of installation selections. */
export interface ToolInstallationExecutionResult {
  installations: ToolInstallationReceipt[]
  pins: Record<string, SecurityToolPin>
  /** A newly verified managed image selection, when the recipe produces one. */
  environment?: SecurityEnvironment
  checks: ToolInstallationCheck[]
}
/** One shared installation; removing a project's selection does not delete it. */
export interface ManagedToolInstallation extends ToolInstallationReceipt {
  id: ManagedToolInstallationId
  operationId: ToolInstallationOperationId
  root: string
  recipeId: string
  installedAt: number
}
/** Cancellation settles only after the executor has released its owned work. */
export type ToolInstallationPhase = 'planned' | 'preparing' | 'installing' | 'verifying' | 'committing'
  | 'cancelling' | 'completed' | 'cancelled' | 'failed' | 'interrupted' | 'needs-reconciliation' | 'installed-unbound'
/** Structured failures retain the safe next action without asserting rollback. */
export interface ToolInstallationFailure {
  code: 'unconfigured-root' | 'stale-plan' | 'busy' | 'invalid-request' | 'confirmation-required' | 'unsupported'
    | 'execution-failed' | 'cancelled' | 'configuration-conflict' | 'outcome-unknown' | 'storage-failed'
  detail: string
}
/** One bounded retained output chunk, addressed by monotonic sequence number. */
export interface ToolInstallationLog {
  cursor: number
  at: number
  channel: 'stdout' | 'stderr' | 'manager'
  text: string
}
/** Durable installation operation independent of any project or conversation lifetime. */
export interface ToolInstallationOperation {
  id: ToolInstallationOperationId
  requestId: ToolInstallationRequestId
  planId: ToolInstallationPlanId
  planDigest: string
  environmentId: string
  recipeId: string
  toolRoot: string
  phase: ToolInstallationPhase
  createdAt: number
  updatedAt: number
  cursor: number
  logs: ToolInstallationLog[]
  logsTruncated: boolean
  result?: ToolInstallationExecutionResult
  failure?: ToolInstallationFailure
}
/** Observer snapshots include retained chunks newer than the requested cursor. */
export interface ToolInstallationFrame {
  operation: ToolInstallationOperation
  nextCursor: number
  retainedFromCursor: number
  gap: boolean
}
/** Executor receives the shared root and a detached environment during bounded planning. */
export interface ToolInstallationPreviewContext {
  toolRoot: string
  environment: SecurityEnvironment
  signal: AbortSignal
}
/** One execution controller owns cancellation and durable progress publication. */
export interface ToolInstallationExecutionContext {
  signal: AbortSignal
  /** Persist output before publishing it to observers. */
  log(channel: ToolInstallationLog['channel'], text: string): Promise<void>
  /** Persist a running phase before beginning its work. */
  phase(phase: 'preparing' | 'installing' | 'verifying'): Promise<void>
}
/** Registered recipes own acquisition and verification, never project binding commits. */
export interface ToolInstallationExecutor {
  preview(request: ToolInstallationRequest, context: ToolInstallationPreviewContext): Promise<ToolInstallationRecipePlan>
  execute(plan: ToolInstallationPlan, context: ToolInstallationExecutionContext): Promise<ToolInstallationExecutionResult>
  /** Inspect uncertain outcomes without rerunning installers; null means the outcome remains unknown. */
  reconcile?(plan: ToolInstallationPlan, operation: ToolInstallationOperation,
    context: ToolInstallationExecutionContext): Promise<ToolInstallationExecutionResult | null>
}

/** Shared durable schema; unknown records fail closed instead of being silently discarded. */
export const toolInstallationPhaseSchema = z.enum(['planned', 'preparing', 'installing', 'verifying', 'committing',
  'cancelling', 'completed', 'cancelled', 'failed', 'interrupted', 'needs-reconciliation', 'installed-unbound'])
/** Validation of a plan identity crossing an operator or persistence interface. */
export const toolInstallationPlanIdSchema = z.string().min(1).transform(brandString<ToolInstallationPlanId>)
/** Validation of an operation identity crossing an operator or persistence interface. */
export const toolInstallationOperationIdSchema = z.string().min(1).transform(brandString<ToolInstallationOperationId>)
/** Validation of an idempotent apply identity supplied by an operator client. */
export const toolInstallationRequestIdSchema = z.string().min(1).max(200).transform(brandString<ToolInstallationRequestId>)

/** An executor cannot establish whether the external installer or remote process stopped. */
export class ToolInstallationOutcomeUnknownError extends Error {
  /** Requires read-only reconciliation before another installer may run. */
  readonly code = 'outcome-unknown'
}

/** A request was rejected before starting dependent installation work. */
export class ToolInstallationError extends Error {
  constructor(readonly code: ToolInstallationFailure['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ToolInstallationError'
  }
}
