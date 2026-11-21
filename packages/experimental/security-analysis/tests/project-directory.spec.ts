/** Task directory derives simultaneous activity and pending operator work. @module */
import { expect, it } from 'vitest'
import { projectDirectory } from '../src/project-directory.ts'
import { engagementSchema, checkSchema, validationPlanSchema, recordSchema, type WorkbenchView } from '../src/workbench/model.ts'

function fixture(): WorkbenchView {
  return { revision: 1, records: [
    { kind: 'engagement', value: engagementSchema.parse({ id: 'project', title: 'HTTP', objective: 'Compare', environmentIds: ['local'], stopped: false, maxAttempts: 3 }) },
    { kind: 'check', value: checkSchema.parse({ id: 'check', engagementId: 'project', assetId: 'asset', title: 'Verify', phase: 'validation', criterion: 'Compare', dependencies: [], evidenceIds: [], status: 'planned', attempts: 0, rationale: '' }) },
    { kind: 'plan', value: validationPlanSchema.parse({ id: 'plan', engagementId: 'project', checkId: 'check', hypothesis: 'Compare', expectedObservation: 'Response', impact: 'Read', cleanup: 'Close', durationMs: 1000,
      hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'draft', operation: { provider: 'external-web', operation: 'sequence', environmentId: 'local', assetId: 'asset', parameters: {}, impact: 'observe', approvalUse: 'single-execution' } }) },
  ] }
}
it('counts only running Sessions with active bindings and keeps approval visible while running', () => {
  const view = fixture()
  view.records.push({ kind: 'engagement', value: engagementSchema.parse({
    id: 'other', title: 'Other', objective: 'Review', environmentIds: ['local'], stopped: false, maxAttempts: 3,
  }) })
  for (const [engagementId, sessionId, active] of [
    ['project', 'current', true], ['project', 'previous', false], ['project', 'idle', true],
    ['other', 'another', true], ['other', 'child', true],
  ] as const) {
    view.records.push(recordSchema.parse({ kind: 'binding', value: { sessionId, engagementId, role: 'coordinator', assetIds: [], active } }))
  }
  const directory = projectDirectory(view, new Set(['current', 'previous', 'unbound', 'another', 'child']), new Map([['other', 2]]))
  expect(directory).toMatchObject([
    { project: { id: 'project' }, state: 'running', runningAgentCount: 1, runningInvocationCount: 0, pendingPlanIds: ['plan'],
      sessions: [{ sessionId: 'current', active: true }, { sessionId: 'previous', active: false }, { sessionId: 'idle', active: true }] },
    { project: { id: 'other' }, state: 'running', runningAgentCount: 2, runningInvocationCount: 2, pendingPlanIds: [],
      sessions: [{ sessionId: 'another', active: true }, { sessionId: 'child', active: true }] },
  ])
})
it('shows background execution, stop cleanup and pause independently of agent activity', () => {
  const view = fixture()
  view.records.push(recordSchema.parse({ kind: 'execution', value: { id: 'execution', engagementId: 'project', assetId: 'asset', planId: 'plan', status: 'running', detail: '' } }))
  expect(projectDirectory(view, new Set(), new Map())[0]).toMatchObject({ state: 'running', pendingPlanIds: [] })
  const project = view.records.find(item => item.kind === 'engagement')!
  project.value.stopped = true
  expect(projectDirectory(view, new Set(), new Map())[0]?.state).toBe('stopping')
  view.records = view.records.filter(item => item.kind !== 'execution')
  expect(projectDirectory(view, new Set(), new Map())[0]?.state).toBe('stopped')
})
it('exposes interrupted checks and returns idle after reconciliation, without marking a task complete', () => {
  const view = fixture(); view.records = view.records.filter(item => item.kind !== 'plan')
  const check = view.records.find(item => item.kind === 'check')!
  check.value.status = 'interrupted'
  expect(projectDirectory(view, new Set(), new Map())[0]).toMatchObject({ state: 'interrupted', interruptedCheckIds: ['check'] })
  check.value.status = 'planned'
  expect(projectDirectory(view, new Set(), new Map())[0]?.state).toBe('idle')
})
