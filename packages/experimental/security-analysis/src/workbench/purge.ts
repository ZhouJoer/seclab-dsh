/** Artifact reachability for irreversible task deletion. @module */
import type { SecurityRecord } from './model.ts'
import { recordArtifacts, type ArtifactStore } from './artifacts.ts'
import { sourceManifest } from './source.ts'

/** Collect all content referenced by task records, including source members.
 * @param store - verified immutable content storage.
 * @param records - retained or deleted journal records.
 * @returns unique content digests. */
export async function referencedArtifacts(store: ArtifactStore, records: SecurityRecord[]): Promise<Set<string>> {
  const digests = new Set<string>()
  for (const item of records) {
    for (const artifact of recordArtifacts(item)) digests.add(artifact.sha256)
    if (item.kind === 'asset' && 'kind' in item.value && item.value.kind === 'source') {
      const manifest = await sourceManifest(store, item.value)
      for (const file of manifest.files) digests.add(file.artifact.sha256)
    }
  }
  return digests
}

/** Collect deleted task content that no retained journal record references.
 * @param store - verified immutable content storage.
 * @param removed - all historical records owned by the deleted task.
 * @param retained - historical records belonging to other tasks.
 * @returns unshared content digests, including source-manifest members. */
export async function unsharedArtifacts(store: ArtifactStore, removed: SecurityRecord[], retained: SecurityRecord[]): Promise<string[]> {
  const removedArtifacts = await referencedArtifacts(store, removed)
  const kept = await referencedArtifacts(store, retained)
  return [...removedArtifacts].filter(hash => !kept.has(hash))
}
