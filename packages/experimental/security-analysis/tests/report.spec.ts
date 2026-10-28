/** Reports render submitted facts and fixed excerpts without model synthesis. @module */
import { expect, it } from 'vitest'
import { renderReport } from '../src/workbench/report.ts'
import { engagementSchema, evidenceSchema, findingSchema, workspaceAssetSchema, type SecurityRecord } from '../src/workbench/model.ts'
const limits = { maxFindings: 1, outputBytes: 16384 }
function fixture(): SecurityRecord[] {
  return [{ kind: 'engagement', value: engagementSchema.parse({ id: 'project', title: '源码调查', objective: '检查登录路径',
    environmentIds: [], stopped: false, maxAttempts: 3, completion: { status: 'running', updatedAt: 1, detail: '',
      summary: '静态分析发现可疑路径', methods: ['读取处理函数'], analysis: ['比较调用条件'],
      results: [{ title: '结果', result: '已定位处理函数', evidenceIds: ['evidence'] }], limitations: '未做运行验证',
      recommendations: [{ findingId: 'finding', text: '验证调用者权限' }] } }) },
  { kind: 'evidence', value: evidenceSchema.parse({ id: 'evidence', engagementId: 'project', assetId: 'workspace', title: 'src/login.ts:2-3',
    summary: '代码片段', artifact: { sha256: 'a'.repeat(64), size: 10, mediaType: 'application/json' }, provider: 'source-citation',
    operation: 'read', toolVersion: 'recorded-session', request: {}, source: { sessionId: 'session', callId: 'read' },
    incomplete: false, createdAt: 1, citation: { path: 'src/login.ts', startLine: 2, endLine: 3, resultSeq: 4, text: 'if (user) {\n  run();' } }) },
  { kind: 'finding', value: findingSchema.parse({ id: 'finding', engagementId: 'project', assetId: 'workspace', title: '待核实登录路径',
    explanation: '权限条件需要核实', conditions: '外部请求', status: 'suspected', evidenceIds: ['evidence'], review: '' }) }]
}
it('renders exact observed excerpts, supplied narrative and separate recommendations', () => {
  const records = fixture()
  records.push({ kind: 'asset', value: workspaceAssetSchema.parse({ kind: 'workspace', id: 'workspace', engagementId: 'project', label: 'Source workspace', root: '/source' }) })
  const report = renderReport(records, limits)
  expect(report.markdown).toContain('## 范围\n- Source workspace：/source')
  expect(report.markdown).toContain('src/login.ts:2-3')
  expect(report.markdown).toContain('    if (user) {\n      run();')
  expect(report.markdown).toContain('疑似')
  expect(report.markdown).toContain('[1](#reference-1)')
  expect(report.markdown).not.toContain('验证调用者权限')
  expect(report.recommendationsMarkdown).toContain('验证调用者权限')
})
it('does not require new narrative fields for legacy saved outcomes', () => {
  const records = fixture()
  const project = records.find(item => item.kind === 'engagement')!
  delete project.value.completion!.summary
  delete project.value.completion!.analysis
  expect(renderReport(records, limits).markdown).not.toContain('## 执行摘要')
})
it('renders older uncertain evidence without asserting completeness', () => {
  const records = fixture()
  records.find(item => item.kind === 'evidence')!.value.incomplete = true
  expect(renderReport(records, limits).markdown).toContain('未证明完整性')
})
it('rejects missing evidence and oversized complete output', () => {
  expect(() => renderReport(fixture().filter(item => item.kind !== 'evidence'), limits)).toThrow('missing evidence')
  expect(() => renderReport(fixture(), { ...limits, outputBytes: 10 })).toThrow('byte budget')
})
it('requires a saved submission and never manufactures one', () => {
  const records = fixture()
  delete records.find(item => item.kind === 'engagement')!.value.completion
  expect(() => renderReport(records, limits)).toThrow('Submit task results')
})
