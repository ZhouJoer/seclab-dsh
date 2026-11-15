/** Extract one complete review object without repairing JSON or interpreting explanatory prose. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const parse = text => {
  try { return { parsed: true, value: JSON.parse(text) } }
  catch (_error) { return { parsed: false } /* Incomplete or ambiguous JSON remains unusable. */ }
}

/** Accept a complete JSON object or one leading JSON fence followed only by unstructured explanation.
 * @param answer The complete public model answer; delivery status is checked by the caller.
 * @returns A parsed object and envelope metadata, or an explicit rejection. Domain fields and evidence still require validation.
 */
export function parseReviewEnvelope(answer) {
  if (typeof answer !== 'string') return { status: 'invalid', issue: 'not-text' }
  const source = answer.trim()
  const plain = parse(source)
  if (plain.parsed) return object(plain.value)
    ? { status: 'parsed', value: plain.value, format: 'plain-json', hasExplanation: false }
    : { status: 'invalid', issue: 'not-an-object' }
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n([\s\S]*))?$/i.exec(source)
  if (!fenced) return { status: 'invalid', issue: 'incomplete-or-unsupported-envelope' }
  const suffix = (fenced[2] ?? '').trim()
  // Container delimiters, additional fences and standalone JSON cannot be unstructured explanation.
  if (/[{}\[\]]|`{3}|~{3}/.test(suffix) || suffix && parse(suffix).parsed)
    return { status: 'invalid', issue: 'ambiguous-trailing-content' }
  const body = parse(fenced[1])
  if (!body.parsed) return { status: 'invalid', issue: 'invalid-fenced-json' }
  if (!object(body.value)) return { status: 'invalid', issue: 'not-an-object' }
  return { status: 'parsed', value: body.value, format: 'fenced-json', hasExplanation: suffix.length > 0 }
}
