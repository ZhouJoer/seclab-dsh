/** Batched Git index reads owned by the bilingual pairing gate. */

import { spawnSync } from 'node:child_process'

/** Read exact Git output, retaining the existing per-blob output budget. */
function runGit(root: string, args: string[], operation: string, input?: string, blobs = 1): Buffer {
  const result = spawnSync('git', ['-C', root, ...args], { input, maxBuffer: (1 << 26) * blobs })
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`${operation} failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout
}

/**
 * Snapshot index identities once and fetch requested blobs in one Git batch.
 * @param root - Repository root.
 * @param requestedPaths - Exact repository-relative paths whose staged bytes are needed.
 * @returns All resolved index paths and the requested blobs; absent paths have no blob.
 * @throws Error when Git fails, a requested path is unmerged, or batch output is incomplete.
 */
export function readGitIndex(root: string, requestedPaths: readonly string[]): {
  paths: Set<string>
  blobs: Map<string, Buffer>
} {
  const requested = new Set(requestedPaths)
  const paths = new Set<string>()
  const selected = new Map<string, string>()
  const entries = runGit(root, ['ls-files', '--stage', '-z'], 'listing Git index paths')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  for (const entry of entries) {
    const match = /^\d+ ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(entry)
    if (!match?.[1] || !match[2] || match[3] === undefined) throw new Error('git ls-files --stage returned a malformed entry')
    const [, oid, stage, path] = match
    if (stage !== '0') {
      if (requested.has(path)) throw new Error(`${path} remains unmerged`)
      continue
    }
    paths.add(path)
    if (requested.has(path)) selected.set(path, oid)
  }
  const blobs = new Map<string, Buffer>()
  if (selected.size === 0) return { paths, blobs }
  const output = runGit(root, ['cat-file', '--batch'], 'reading staged blobs', [...selected.values()].join('\n') + '\n', selected.size)
  let offset = 0
  for (const [path, oid] of selected) {
    const end = output.indexOf(10, offset)
    const header = output.subarray(offset, end).toString('utf8')
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header)
    const size = Number(match?.[2])
    if (end < offset || match?.[1] !== oid || !Number.isSafeInteger(size) || size < 0)
      throw new Error(`Invalid git cat-file batch header for ${path}`)
    const start = end + 1
    offset = start + size
    if (output[offset] !== 10) throw new Error(`Incomplete git cat-file batch body for ${path}`)
    blobs.set(path, output.subarray(start, offset))
    offset++
  }
  if (offset !== output.length) throw new Error('Unexpected trailing git cat-file batch output')
  return { paths, blobs }
}
