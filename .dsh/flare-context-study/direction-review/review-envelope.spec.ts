import { describe, expect, it } from 'vitest'
import { parseReviewEnvelope } from './review-envelope.mjs'
import { commandFingerprint, parseAdoptionReview } from './adoption.mjs'
import { parseCompletionReview } from './completion.mjs'
import { parseHandoffReview } from './handoff.mjs'

const fence = (value: object, suffix = '') => '```json\n' + JSON.stringify(value, null, 2) + '\n```' + (suffix ? '\n' + suffix : '')
const minimal = { decision: 'observe', rationale: 'Read the original field before interpreting the aggregate.', evidenceRefs: ['source'] }
const json = JSON.stringify(minimal)
const explanation = '说明：这是一项待执行的检查。\n- 返回值只覆盖所读取的原始记录。\n- 保存建议不代表检查已经执行。'
const packet = { status: 'ready', refs: ['source'], rawUsableRefs: ['source'], plannedRefs: ['future'],
  basisKey: 'synthetic-basis', decisionSeq: 4, toolFingerprint: commandFingerprint('pwsh', { command: 'python analyze.py' }),
  answerText: 'All original rows were verified.' }
const check = { name: 'pwsh', arguments: { command: 'python -c "print(24)"' } }
const adoption = { decision: 'check-required', rationale: 'The proposed scan assumes a width that has not been measured.',
  evidenceRefs: ['source'], nextCheck: 'Measure the width of one original record.', check }
const completion = { decision: 'missing-required-check', rationale: 'Only a subset was observed.', evidenceRefs: ['source'],
  nextCheck: 'Read every original row before declaring the task complete.' }
const handoff = { decision: 'correct', rationale: 'The recorded check covers only the sampled rows.', evidenceRefs: ['source'],
  corrections: [{ claim: packet.answerText, replacement: 'Only sampled rows were checked; the remaining rows are unverified.', evidenceRefs: ['source'] }] }

describe('review answer envelope', () => {
  it.each([
    ['plain object', json, 'plain-json', false],
    ['plain whitespace', '\n  ' + json + '\n', 'plain-json', false],
    ['JSON fence', fence(minimal), 'fenced-json', false],
    ['unlabelled fence', '```\n' + json + '\n```', 'fenced-json', false],
    ['uppercase fence and CRLF', '```JSON\r\n' + json + '\r\n```\r\n', 'fenced-json', false],
    ['trailing explanatory prose', fence(minimal, explanation), 'fenced-json', true],
  ] as const)('accepts a complete %s', (_label, answer, format, hasExplanation) => {
    expect(parseReviewEnvelope(answer)).toEqual({ status: 'parsed', value: minimal, format, hasExplanation })
  })

  it('preserves JSON string escapes and nested values without treating them as envelope content', () => {
    const value = { ...minimal, rationale: 'Literal containers {} and [] and ``` inside a string.\nQuoted: "value".', nested: { items: [1, 2] } }
    expect(parseReviewEnvelope(fence(value, explanation))).toMatchObject({ status: 'parsed', value })
  })

  it.each([
    ['empty', ''], ['not text', null], ['object input', minimal], ['array', '[{}]'], ['primitive', 'true'],
    ['missing closing fence', '```json\n' + json], ['truncated JSON', '```json\n{"decision":\n```'],
    ['missing opening fence', json + '\n```'], ['unsupported language', '```javascript\n' + json + '\n```'],
    ['preface', 'Here is the review:\n' + fence(minimal)], ['plain JSON plus prose', json + '\n' + explanation],
    ['two plain objects', json + '\n' + json], ['two fenced objects', fence(minimal) + '\n' + fence(minimal)],
    ['another fenced language', fence(minimal) + '\n```python\nprint(24)\n```'],
    ['another tilde fence', fence(minimal) + '\n~~~python\nprint(24)\n~~~'],
    ['trailing JSON object', fence(minimal, explanation + '\n' + json)],
    ['trailing JSON array', fence(minimal, explanation + '\n[]')],
    ['trailing partial object', fence(minimal, explanation + '\n{"decision":')],
    ['standalone JSON primitive', fence(minimal, 'false')], ['fenced array', '```json\n[]\n```'],
    ['JSON comment', '```json\n{"decision":"observe"} // comment\n```'],
  ])('rejects %s without extracting a preferred candidate', (_label, answer) => {
    expect(parseReviewEnvelope(answer).status).toBe('invalid')
  })
})

describe('review envelopes retain domain validation', () => {
  const readers = [
    { name: 'adoption', value: adoption, parse: (answer: string) => parseAdoptionReview(answer, packet, { checkTools: ['pwsh'] }) },
    { name: 'completion', value: completion, parse: (answer: string) => parseCompletionReview(answer, packet) },
    { name: 'handoff', value: handoff, parse: (answer: string) => parseHandoffReview(answer, packet) },
  ]
  it.each(readers)('retains a complete $name decision followed by explanation', reader => {
    expect(reader.parse(fence(reader.value, explanation))).toMatchObject({ status: 'reviewed', scientificallyVerified: false,
      decision: reader.value.decision, evidenceRefs: ['source'] })
  })
  it.each(readers)('keeps missing fields, unexpected fields and multiple $name candidates unreviewed', reader => {
    for (const answer of [fence({}, explanation), fence({ ...reader.value, extraDecision: 'allow' }, explanation),
      fence(reader.value) + '\n' + fence(reader.value), fence({ ...reader.value, evidenceRefs: [] }, explanation)]) {
      expect(reader.parse(answer).status).toBe('unreviewed')
    }
  })

  it('retains the check as a proposal when a fenced answer also cites a planned operation', () => {
    const result = parseAdoptionReview(fence({ ...adoption, evidenceRefs: ['source', 'future'] }, explanation), packet, { checkTools: ['pwsh'] })
    expect(result).toMatchObject({ status: 'proposal-only', scientificallyVerified: false, check,
      evidenceRefs: ['source'], submittedEvidenceRefs: ['source', 'future'],
      referenceIssues: [{ inputRef: 'future', issue: 'planned-not-completed' }] })
  })
  it('does not manufacture a missing experiment or completed source from trailing prose', () => {
    const { check: _check, ...withoutCheck } = adoption
    for (const value of [withoutCheck, { ...adoption, evidenceRefs: ['future'] }, { ...adoption, nextCheck: '' }]) {
      expect(parseAdoptionReview(fence(value, 'The next action would be an independent check.'), packet, { checkTools: ['pwsh'] }).status)
        .toBe('unreviewed')
    }
  })
  it('preserves an algorithm proposal without treating syntactic acceptance as a scientific result', () => {
    const proposed = { name: 'pwsh', arguments: { command: 'python -c "print(1 == 1)"' } }
    const result = parseAdoptionReview(fence({ ...adoption, check: proposed }, explanation), packet, { checkTools: ['pwsh'] })
    expect(result).toMatchObject({ status: 'reviewed', decision: 'check-required', scientificallyVerified: false, check: proposed })
    expect(result).not.toHaveProperty('execution')
  })
  it('keeps completion evidence and literal handoff corrections constrained to their packet', () => {
    expect(parseCompletionReview(fence({ ...completion, evidenceRefs: ['future'] }, explanation), packet).status).toBe('unreviewed')
    expect(parseHandoffReview(fence({ ...handoff, corrections: [{ ...handoff.corrections[0], claim: 'Invented original claim.' }] }, explanation), packet).status)
      .toBe('unreviewed')
  })
})
