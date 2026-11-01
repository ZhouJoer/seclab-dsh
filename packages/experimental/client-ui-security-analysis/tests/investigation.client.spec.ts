/** Graph references preserve the meaning and uncertainty of saved investigation records. @module */
import { expect, it } from 'vitest'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { investigation, visibleInvestigation } from '../src/client/investigation.ts'
import { investigationFixture } from './investigation-fixture.client.ts'

it('uses recorded dependencies, direction succession, support and opposition without deriving links from time or shared assets', () => {
  const graph = investigation(investigationFixture())
  expect(graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: 'check:read', target: 'check:verify', relation: 'graphDepends' }),
    expect.objectContaining({ source: 'evidence:partial', target: 'review:review', relation: 'graphOpposes' }),
    expect.objectContaining({ source: 'asset:input', target: 'evidence:partial', relation: 'graphSubject' }),
    expect.objectContaining({ source: 'checkpoint:first', target: 'checkpoint:second', relation: 'graphFollowup' }),
  ]))
  expect(graph.edges.some(edge => edge.source === 'check:verify' && edge.target === 'evidence:partial')).toBe(false)
  expect(graph.nodes.find(node => node.id === 'finding:finding')).toMatchObject({ title: 'Missing ownership check', state: 'suspected' })
  expect(graph.nodes.find(node => node.id === 'review:review')?.state).toBeUndefined()
  expect(graph.missing.get('finding:finding')).toBe(1)
  expect(graph.nodes.some(node => node.title === 'missing')).toBe(false)
})

it('folds linked observations while retaining orphan observations and explicitly labeling the projected references', () => {
  const graph = investigation(investigationFixture())
  const folded = visibleInvestigation(graph, false)
  expect(folded.nodes.some(node => node.id === 'evidence:source')).toBe(false)
  expect(folded.nodes.find(node => node.id === 'evidence:partial')).toMatchObject({ attention: true, state: 'failed' })
  expect(folded.edges).toContainEqual(expect.objectContaining({ source: 'check:read', target: 'finding:finding', relation: 'graphLinkedObservation' }))
  expect(visibleInvestigation(graph, true)).toBe(graph)
  expect(new Set(folded.edges.map(edge => edge.id)).size).toBe(folded.edges.length)
})

it('retains separate identities for equal titles and does not mutate committed records', () => {
  const view = investigationFixture()
  const before = structuredClone(view)
  const graph = investigation(view)
  expect(graph.nodes.find(node => node.id === 'check:verify')).toMatchObject({ attention: true, state: 'blocked' })
  expect(graph.nodes.filter(node => node.title === 'Missing ownership check')).toHaveLength(2)
  visibleInvestigation(graph, false)
  expect(view).toEqual(before)
})


it('closes the recorded direction at its report without inventing missing research phases', () => {
  const view = investigationFixture()
  const artifact = { sha256: 'a'.repeat(64), size: 100, mediaType: 'text/plain' }
  view.records.push(recordSchema.parse({ kind: 'report', value: { id: 'result', engagementId: 'project', revision: 5,
    checkpointId: 'second', evidenceIds: ['source'], markdown: artifact, json: artifact, createdAt: 3 } }))
  const graph = investigation(view)
  expect(graph.nodes.find(node => node.id === 'report:result')).toMatchObject({ state: 'reportDelivered', running: false })
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'checkpoint:second', target: 'report:result' }))
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'evidence:source', target: 'report:result' }))
  expect(graph.nodes.filter(node => node.record.kind === 'checkpoint')).toHaveLength(2)
  const folded = visibleInvestigation(graph, false)
  expect(folded.nodes.some(node => node.id === 'report:result')).toBe(true)
  expect(folded.edges.some(edge => edge.target === 'report:result')).toBe(true)
})

it('keeps legacy reports unlinked when they have no saved direction references', () => {
  const view = investigationFixture()
  const artifact = { sha256: 'a'.repeat(64), size: 1, mediaType: 'text/plain' }
  view.records.push(recordSchema.parse({ kind: 'report', value: { id: 'old', engagementId: 'project', revision: 1,
    markdown: artifact, json: artifact, createdAt: 0 } }))
  const graph = investigation(view)
  expect(graph.nodes.some(node => node.id === 'report:old')).toBe(true)
  expect(graph.edges.some(edge => edge.target === 'report:old')).toBe(false)
})


it('closes at saved outcomes before the user generates a report', () => {
  const view = investigationFixture()
  view.records.push(recordSchema.parse({ kind: 'engagement', value: { id: 'project', title: 'Inspection', objective: 'Read the handler',
    environmentIds: ['local'], maxAttempts: 1, stopped: false, completion: { status: 'saved', detail: '', updatedAt: 3,
      summary: 'Handler inspected', results: [{ title: 'Behavior', result: 'Returns input', evidenceIds: ['source'] }],
      limitations: 'Caller unverified', checkpointId: 'second' } } }))
  const graph = investigation(view)
  expect(graph.nodes.find(node => node.id === 'engagement:project')).toMatchObject({ summary: 'Handler inspected', state: 'completed' })
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'checkpoint:second', target: 'engagement:project' }))
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'evidence:source', target: 'engagement:project' }))
  expect(graph.nodes.some(node => node.record.kind === 'report')).toBe(false)
})
