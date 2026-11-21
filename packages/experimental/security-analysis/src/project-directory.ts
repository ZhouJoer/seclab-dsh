/** Lightweight task execution facts, derived without a second persistent task status. @module */
import type { Engagement, WorkbenchView, CheckId, ValidationPlanId } from './workbench/model.ts'

/** Orthogonal runtime and operator-action facts for one task. */
export interface SecurityProjectSummary {
  project: Engagement
  /** Current associations, including inactive historical conversations. */
  sessions: { sessionId: string; role: string; active: boolean }[]
  runningAgentCount: number
  runningInvocationCount: number
  pendingPlanIds: ValidationPlanId[]
  blockedCheckIds: CheckId[]
  interruptedCheckIds: CheckId[]
  next: string
  state: 'removed' | 'stopping' | 'stopped' | 'running' | 'interrupted' | 'approval' | 'blocked' | 'idle'
}
/** Derive one directory snapshot from committed records and live execution counts.
 * @param view - one consistent journal snapshot.
 * @param runningSessions - Sessions whose Agent is running.
 * @param invocations - running invocation counts by project, counted once per invocation.
 * @returns lightweight task directory. */
export function projectDirectory(view: WorkbenchView, runningSessions: ReadonlySet<string>,
  invocations: ReadonlyMap<string, number>): SecurityProjectSummary[] {
  const grouped = Map.groupBy(view.records.filter(record => record.kind !== 'engagement'), record => record.value.engagementId)
  return view.records.filter(record => record.kind === 'engagement').map(({ value: project }) => {
    const records = grouped.get(project.id) ?? []
    const sessions = records.filter(record => record.kind === 'binding').map(({ value }) => ({
      sessionId: value.sessionId, role: value.role, active: value.active !== false,
    }))
    const checks = records.filter(item => item.kind === 'check')
    const consumed = new Set(records.filter(item => item.kind === 'execution').map(item => item.value.planId))
    const runningAgentCount = sessions.filter(session => session.active && runningSessions.has(session.sessionId)).length
    const runningInvocationCount = invocations.get(project.id) ?? 0
    const active = runningAgentCount > 0 || runningInvocationCount > 0 || records.some(item =>
      item.kind === 'execution' && item.value.status === 'running' || item.kind === 'delegation' && ['pending', 'running'].includes(item.value.status))
    const pendingPlanIds = records.filter(item => item.kind === 'plan').filter(item => item.value.status === 'draft' && !consumed.has(item.value.id) &&
      checks.some(check => check.value.id === item.value.checkId && check.value.status === 'planned')).map(item => item.value.id)
    const blockedCheckIds = checks.filter(item => item.value.status === 'blocked').map(item => item.value.id)
    const interruptedCheckIds = checks.filter(item => item.value.status === 'interrupted').map(item => item.value.id)
    const state: SecurityProjectSummary['state'] = project.archived ? 'removed' : project.stopped ? active ? 'stopping' : 'stopped'
      : active ? 'running' : interruptedCheckIds.length ? 'interrupted' : pendingPlanIds.length ? 'approval' : blockedCheckIds.length ? 'blocked' : 'idle'
    return { project, sessions, runningAgentCount, runningInvocationCount, pendingPlanIds, blockedCheckIds, interruptedCheckIds, state,
      next: project.completion ? '' : records.findLast(item => item.kind === 'checkpoint')?.value.next ?? '' }
  })
}
