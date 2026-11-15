/** Resolve citation identity without treating a saved record or a planned command as executed evidence. */
const nonempty = value => typeof value === 'string' && value.length > 0

/** Attach only workbench-owned source bindings for this session; result text cannot invent aliases. */
export function bindWorkbenchReferences(pairs, sessionId, view) {
  if (view === undefined) return pairs
  return pairs.map(pair => ({ ...pair, evidenceIds: [...new Set(view.records.filter(record => record.kind === 'evidence'
    && record.value.source?.sessionId === sessionId && record.value.source.callId === pair.callId
    && record.value.source.channel !== 'operator').map(record => record.value.id))] }))
}

/** List exact aliases for one completed result. */
export function pairReferences(pair) {
  return [pair.callId, 'r' + pair.resultSeq, ...pair.evidenceIds ?? []]
}

/** Resolve one exact reference, reporting collisions instead of choosing an arbitrary source. */
export function resolveEvidenceReference(pairs, inputRef) {
  const matches = pairs.filter(pair => pair.resultSeq !== undefined && pairReferences(pair).includes(inputRef))
  if (!matches.length) return { status: 'unresolved', inputRef, issue: 'no-completed-source' }
  if (matches.length > 1) return { status: 'ambiguous', inputRef, issue: 'multiple-completed-sources',
    candidates: matches.map(pair => ({ callId: pair.callId, resultSeq: pair.resultSeq })) }
  const pair = matches[0]
  return { status: 'resolved', pair, binding: { inputRef, callId: pair.callId, resultSeq: pair.resultSeq,
    ref: 'r' + pair.resultSeq, ...pair.evidenceIds?.includes(inputRef) ? { evidenceId: inputRef } : {} } }
}

/** Publish only unambiguous aliases; an evidence ID shared by two sources remains unresolved. */
export function referenceAliases(pairs, otherRefs = []) {
  const aliases = Object.create(null)
  const sourceRefs = new Set(pairs.flatMap(pairReferences))
  for (const ref of sourceRefs) {
    const resolved = resolveEvidenceReference(pairs, ref)
    if (resolved.status === 'resolved') aliases[ref] = resolved.pair.callId
  }
  for (const ref of otherRefs.filter(nonempty)) if (!sourceRefs.has(ref)) aliases[ref] = ref
  return aliases
}

/** Keep unresolved and planned citations visible, separately from canonical completed-source references. */
export function resolveReviewReferences(packet, submittedRefs) {
  const bindings = [], issues = [], refs = []
  for (const inputRef of submittedRefs) {
    const canonical = packet.referenceAliases === undefined ? packet.refs.includes(inputRef) ? inputRef : undefined
      : Object.hasOwn(packet.referenceAliases, inputRef) ? packet.referenceAliases[inputRef] : undefined
    if (canonical !== undefined) {
      refs.push(canonical)
      bindings.push({ inputRef, ref: canonical, kind: 'recorded' })
    } else if (packet.plannedRefs?.includes(inputRef)) {
      issues.push({ inputRef, issue: 'planned-not-completed' })
    } else issues.push({ inputRef, issue: 'not-in-review-packet' })
  }
  return { evidenceRefs: [...new Set(refs)], referenceBindings: bindings, referenceIssues: issues,
    submittedEvidenceRefs: [...submittedRefs], referenceStatus: issues.length ? 'partial' : 'complete' }
}
