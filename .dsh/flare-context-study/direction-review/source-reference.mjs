/** Compact citation handles identify recorded calls without copying or certifying their output. */
export const SOURCE_REFERENCE_SUMMARY = 'Original source reference'
const locatorFields = ['path', 'file_path', 'filePath', 'filename', 'workdir', 'assetId', 'evidenceId', 'operation',
  'offset', 'length', 'limit', 'itemOffset', 'itemLimit', 'startLine', 'endLine']
const size = value => Buffer.byteLength(JSON.stringify(value))

/** Add bounded, explicitly display-only argument locators; existing receipt facts are never shortened. */
export function withSourceLocator(base, args, maxBytes) {
  if (size(base) >= maxBytes) return base
  const locator = {}
  let truncated = false
  for (const key of locatorFields) {
    const value = args?.[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    const candidate = { ...locator, [key]: value }
    if (size({ ...base, locator: candidate, locatorTruncated: true }) <= maxBytes) {
      locator[key] = value
      continue
    }
    truncated = true
    if (typeof value !== 'string') continue
    const chars = []
    for (const char of value) {
      chars.push(char)
      if (chars.length >= maxBytes) break
    }
    let low = 0, high = chars.length, best
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const prefix = chars.slice(0, middle).join('') + '…'
      if (size({ ...base, locator: { ...locator, [key]: prefix }, locatorTruncated: true }) <= maxBytes) {
        best = middle > 0 ? prefix : undefined
        low = middle + 1
      } else high = middle - 1
    }
    if (best !== undefined) locator[key] = best
  }
  const value = { ...base, ...Object.keys(locator).length ? { locator } : {}, ...truncated ? { locatorTruncated: true } : {} }
  return size(value) <= maxBytes ? value : base
}

/** Keep exact call identity, omitting an optional notice if identity alone exceeds its budget. */
export function sourceReference(exec, maxBytes) {
  const base = { kind: 'evidence-source', version: 1, callId: exec.callId, toolName: exec.name }
  return size(base) <= maxBytes ? withSourceLocator(base, exec.arguments, maxBytes) : undefined
}

/** Avoid a second host notice for the same call in the current tool result's deferred contexts. */
export function hasSourceReference(messages, callId, toolName) {
  return messages.some(message => {
    if (message.source.kind !== 'helper-checkpoint'
      || ![SOURCE_REFERENCE_SUMMARY, 'Premise execution receipt'].includes(message.source.summary)) return false
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    let value
    try { value = JSON.parse(text) }
    catch (_error) { return false /* A malformed notice cannot suppress a valid source handle. */ }
    return value?.callId === callId && value.toolName === toolName
      && ['evidence-source', 'premise-execution'].includes(value.kind)
  })
}
