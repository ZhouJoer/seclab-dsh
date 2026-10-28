/** Deterministic reports from submitted conclusions and fixed source citations. @module */
import { findingHash } from './assessment.ts'
import type { SecurityRecord } from './model.ts'

/** Deployment limits for rendered output and main-body findings. */
export interface ReportLimits {
  maxFindings: number
  outputBytes: number
}
interface RenderedReport {
  markdown: string
  findingsMarkdown?: string
  recommendationsMarkdown?: string
}
function clean(value: string): string {
  return value.replace(/([<>\\`*_\[\]#|])/gu, '\\$1')
}
/** Render saved conclusions and observations without a model call or filesystem read.
 * @param records - fixed project revision including the submitted outcome.
 * @param limits - output limits applied to every complete document.
 * @returns immutable report documents with verified source excerpts.
 */
export function renderReport(records: SecurityRecord[], limits: ReportLimits): RenderedReport {
  const project = records.find(item => item.kind === 'engagement')?.value
  if (!project?.completion) throw new Error('Submit task results before publishing a report')
  const outcome = project.completion
  const title = clean(project.title)
  const evidence = records.filter(item => item.kind === 'evidence')
  const citedIds = new Set<string>(outcome.results.flatMap(item => item.evidenceIds))
  const findings = records.filter(item => item.kind === 'finding').filter(item => item.value.status !== 'refuted')
  for (const finding of findings) for (const id of finding.value.evidenceIds) citedIds.add(id)
  const references = evidence.filter(item => citedIds.has(item.value.id))
  const links = (ids: readonly string[]) => ids.map((id) => {
    const index = references.findIndex(item => item.value.id === id)
    if (index < 0) throw new Error('Report refers to missing evidence')
    return `[${index + 1}](#reference-${index + 1})`
  }).join(' ')
  const findingLine = (record: Extract<SecurityRecord, { kind: 'finding' }>) => {
    const finding = record.value
    const review = records.find(item => item.kind === 'review' && item.value.id === finding.review && item.value.findingHash === findingHash(finding))
    const status = { suspected: '疑似', confirmed: '已确认', inconclusive: '未定', refuted: '已排除' }[finding.status]
    const basis = review?.kind === 'review' ? review.value.basis === 'static' ? '，静态复核' : '，运行复核' : ''
    return `- ${clean(finding.title)}（${status}${basis}）：${clean(finding.explanation)}；条件：${clean(finding.conditions)}。 ${links(finding.evidenceIds)}`
  }
  const main = findings.slice(0, limits.maxFindings)
  const extra = findings.slice(limits.maxFindings)
  const lines = [`# ${title}：任务分析报告`, '', '## 任务目标', clean(project.objective)]
  const assets = records.filter(item => item.kind === 'asset')
  lines.push('', '## 范围', ...assets.map(({ value }) => {
    const location = 'kind' in value && value.kind === 'workspace' ? value.root : 'origin' in value ? value.origin : ''
    return `- ${clean(value.label)}${location ? '：' + clean(location) : ''}`
  }))
  if (!assets.length) lines.push('未登记目标。')
  if (project.environmentIds.length) lines.push('登记环境：' + project.environmentIds.map(clean).join('、'))
  if (outcome.summary) lines.push('', '## 执行摘要', clean(outcome.summary))
  if (outcome.methods?.length) lines.push('', '## 分析方法', ...outcome.methods.map(item => '- ' + clean(item)))
  if (outcome.analysis?.length) lines.push('', '## 推导与验证过程', ...outcome.analysis.map((item, index) => `${index + 1}. ${clean(item)}`))
  lines.push('', '## 结果', ...outcome.results.map(item => `- ${clean(item.title)}：${clean(item.result)} ${links(item.evidenceIds)}`),
    '', '## 技术发现', ...(main.length ? main.map(findingLine) : ['本任务未记录漏洞发现。']),
    ...(extra.length ? ['其他发现见补充发现。'] : []), '', '## 限制与未覆盖范围', clean(outcome.limitations) || '未提交额外限制；这不构成完整覆盖证明。', '', '## 引用')
  references.forEach((record, index) => {
    const evidence = record.value
    lines.push('', `<a id="reference-${index + 1}"></a>`, `### ${index + 1}. ${clean(evidence.title)}`)
    if (evidence.incomplete) lines.push('此观察不完整或未证明完整性。')
    if (evidence.citation) {
      const citation = evidence.citation
      lines.push(`${clean(citation.path)}:${citation.startLine}-${citation.endLine}`, '',
        ...citation.text.split('\n').map(line => '    ' + line))
    } else lines.push(clean(evidence.summary))
  })
  const recommendations = outcome.recommendations?.map((item) => {
    const finding = findings.find(record => record.value.id === item.findingId)
    if (!finding) throw new Error('Recommendation requires a current, non-refuted finding')
    return `- ${clean(finding.value.title)}：${clean(item.text)}`
  }) ?? []
  const documents: RenderedReport = { markdown: lines.join('\n') + '\n',
    ...(extra.length ? { findingsMarkdown: [`# ${title}：补充发现`, '', ...extra.map(item => findingLine(item).replaceAll('](#reference-', '](report.md#reference-')), ''].join('\n') } : {}),
    ...(recommendations.length ? { recommendationsMarkdown: [`# ${title}：修复建议`, '', ...recommendations, ''].join('\n') } : {}) }
  for (const content of [documents.markdown, documents.findingsMarkdown, documents.recommendationsMarkdown])
    if (content !== undefined && Buffer.byteLength(content) > limits.outputBytes)
      throw new Error('Rendered report exceeds the configured byte budget')
  return documents
}
