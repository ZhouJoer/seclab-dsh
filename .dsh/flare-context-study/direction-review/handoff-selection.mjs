/** Locate older source records by literal values in an answer, without validating the answer. */
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Extract explicit literals, named numeric fields and versions; bare counts do not locate evidence. */
export function answerLiterals(answer, maxLiterals) {
  const values = [...answer.matchAll(/`([^`\n]+)`|\b0x[0-9a-fA-F]{4,}\b|(?:\.[A-Za-z][A-Za-z0-9+_.-]*|\b[A-Za-z][A-Za-z0-9+_.-]*)[ \t]+v?\d+(?:\.\d+){0,3}\b/g),
    ...answer.matchAll(/\b[A-Za-z_][A-Za-z0-9_-]*[ \t]*(?:[:=][ \t]*|[ \t]+)-?(?:0x[0-9a-fA-F]+|\d+)\b(?![.\d])/g)]
    .sort((left, right) => left.index - right.index)
  const literals = new Map()
  for (const match of values) {
    const raw = match[1] ?? match[0]
    if (match[1] === undefined && /[A-Za-z0-9_.]/.test(answer[match.index + raw.length] ?? '')) continue
    const prefix = /(?:…|\.\.\.)$/.test(raw)
    const value = raw.replace(/(?:…|\.\.\.)$/, '').trim()
    const named = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*(?:[:=][ \t]*|[ \t]+)(-?(?:0x[0-9a-fA-F]+|\d+))$/.exec(value)
    if (value.length < 6 && !named || /^\d+(?:\.\d+)*$|^r\d+$|^call_/.test(value)) continue
    const key = named ? named[1].toLowerCase() + '=' + named[2].toLowerCase() : value.toLowerCase()
    if (!literals.has(key)) literals.set(key, { value, prefix,
      ...named ? { kind: 'named-number', label: named[1], number: named[2] } : {} })
    if (literals.size === maxLiterals) break
  }
  return [...literals.values()]
}

/** Rank actual output matches by specificity; matching only selects material for independent review. */
export function matchedHandoffEvidence(answer, pairs, config) {
  if (!config.handoffMaxMatchedEvidencePairs) return { literals: [], candidates: [] }
  const literals = answerLiterals(answer, config.handoffMaxMatchLiterals)
  const matches = literals.map(literal => {
    const expression = literal.kind === 'named-number'
      ? new RegExp('(^|[^A-Za-z0-9_])["\']?' + escaped(literal.label) + '["\']?\\s*(?:[:=]\\s*|\\s+)["\']?'
        + escaped(literal.number) + '["\']?($|[^A-Za-z0-9_.])', 'i')
      : new RegExp('(^|[^A-Za-z0-9_])' + literal.value.split(/\s+/).map(escaped).join('\\s+')
        + (literal.prefix ? '' : '($|[^A-Za-z0-9_])'), 'i')
    return { literal, pairs: pairs.filter(pair => expression.test(pair.result.text)) }
  })
  const candidates = pairs.map(pair => {
    const hits = matches.filter(match => match.pairs.includes(pair))
    return { pair, literals: hits.map(hit => hit.literal), score: hits.reduce((sum, hit) => sum + 1 / hit.pairs.length, 0),
      namedScore: hits.filter(hit => hit.literal.kind === 'named-number').reduce((sum, hit) => sum + 1 / hit.pairs.length, 0) }
  }).filter(item => item.score > 0).sort((left, right) => right.namedScore - left.namedScore || right.score - left.score || right.pair.resultSeq - left.pair.resultSeq)
  return { literals, candidates }
}
