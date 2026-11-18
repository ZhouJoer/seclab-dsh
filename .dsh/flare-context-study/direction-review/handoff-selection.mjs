/** Locate older source records by literal values in an answer, without validating the answer. */
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const digestLengths = [32, 40, 56, 64, 96, 128]

function digestLocator(raw) {
  const match = /^([a-f\d]{8,128})(…|\.\.\.)?$/i.exec(raw)
  return match && (match[2] || digestLengths.includes(match[1].length))
}

/** Require the matched output token to have a complete digest width. */
function digestPattern({ value, prefix }) {
  const tails = digestLengths.filter(width => prefix ? width >= value.length : width === value.length)
    .map(width => '[a-f0-9]{' + (width - value.length) + '}')
  return new RegExp('(^|[^A-Za-z0-9_])' + value + '(?:' + tails.join('|') + ')($|[^A-Za-z0-9_])', 'i')
}

/** Extract explicit literals, named numeric fields and versions; bare counts do not locate evidence. */
export function answerLiterals(answer, maxLiterals) {
  const values = [...answer.matchAll(/`([^`\n]+)`|\b0x[0-9a-fA-F]{4,}\b|(?:\.[A-Za-z][A-Za-z0-9+_.-]*|\b[A-Za-z][A-Za-z0-9+_.-]*)[ \t]+v?\d+(?:\.\d+){0,3}\b/g),
    ...[...answer.matchAll(/\b([a-f\d]{8,128}(?:…|\.\.\.)?)(?![a-z\d_])/gi)].filter(match => digestLocator(match[0])),
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
      ...named ? { kind: 'named-number', label: named[1], number: named[2] }
        : digestLocator(raw) ? { kind: 'digest' } : {} })
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
    const digest = literal.kind === 'digest' && digestPattern(literal)
    const digestMatches = new Set(digest ? pairs.filter(pair => digest.test(pair.result.text)) : [])
    return { literal, pairs: pairs.filter(pair => expression.test(pair.result.text)), digestMatches }
  })
  const candidates = pairs.map(pair => {
    const hits = matches.filter(match => match.pairs.includes(pair))
    return { pair, literals: hits.map(hit => hit.literal), score: hits.reduce((sum, hit) => sum + 1 / hit.pairs.length, 0),
      digestScore: hits.reduce((sum, hit) => sum + (hit.digestMatches.has(pair) ? 1 / hit.digestMatches.size : 0), 0),
      namedScore: hits.filter(hit => hit.literal.kind === 'named-number').reduce((sum, hit) => sum + 1 / hit.pairs.length, 0) }
  }).filter(item => item.score > 0).sort((left, right) => right.namedScore - left.namedScore || right.digestScore - left.digestScore
    || right.score - left.score || right.pair.resultSeq - left.pair.resultSeq)
  return { literals, candidates }
}
