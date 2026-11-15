/** Match literal output, including text carried inside a JSON tool-result envelope. */
export function hasExactOutputQuote(serialized, quote) {
  if (serialized.includes(quote)) return true
  let value
  try { value = JSON.parse(serialized) }
  catch (_error) { return false /* Plain text has already been compared literally. */ }
  const pending = [value]
  while (pending.length) {
    const current = pending.pop()
    if (typeof current === 'string' && current.includes(quote)) return true
    if (current !== null && typeof current === 'object') pending.push(...Object.values(current))
  }
  return false
}
