/** In-memory full-text search over committed security records. @module */
import { lstatSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { SecurityRecord } from './model.ts'

const createRecords = 'CREATE VIRTUAL TABLE records USING fts5(id UNINDEXED, engagement UNINDEXED, content)'

/**
 * Remove a standalone disk index whose entire schema matches the workbench's FTS tables.
 * @param root - Security root held under the Host's exclusive ownership lock.
 */
export function removeLegacySearchIndex(root: string): void {
  const path = join(root, 'search.sqlite')
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return
  if (['-journal', '-wal', '-shm'].some(suffix => lstatSync(path + suffix, { throwIfNoEntry: false }))) return
  try {
    using candidate = new DatabaseSync(pathToFileURL(path).href + '?immutable=1', { readOnly: true })
    using expected = new DatabaseSync(':memory:')
    expected.exec(createRecords)
    const schema = 'SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name'
    if (!isDeepStrictEqual(candidate.prepare(schema).all(), expected.prepare(schema).all())) return
  } catch (error) {
    // SQLITE_CORRUPT and SQLITE_NOTADB leave the owner of the file unidentified.
    if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number'
      && [11, 26].includes(error.errcode & 0xff)) return
    throw error
  }
  unlinkSync(path)
}

/**
 * Search exact tokens in the records visible to the caller.
 * @param records - Authorized records, including searchable evidence text.
 * @param engagementId - Project whose matches may be returned.
 * @param query - Human query, including Chinese words or identifiers.
 * @param limit - Positive maximum number of matches.
 * @returns Matching record keys ordered by relevance.
 */
export function searchRecords(records: readonly SecurityRecord[], engagementId: string, query: string, limit: number): string[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Search limit must be positive')
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  const words = [...segmenter.segment(query)]
    .filter(word => word.isWordLike)
    .map(word => '"' + word.segment.replaceAll('"', '""') + '"')
  if (!words.length) return []
  using database = new DatabaseSync(':memory:')
  database.exec('PRAGMA temp_store = MEMORY')
  database.exec(createRecords)
  const insert = database.prepare('INSERT INTO records(id, engagement, content) VALUES (?, ?, ?)')
  for (const record of records) {
    if (record.kind === 'binding' || (record.kind === 'knowledge' && (record.value.supersededBy || record.value.excluded))) continue
    const project = record.kind === 'engagement' ? record.value.id : record.value.engagementId
    const content = [...segmenter.segment(JSON.stringify(record.value))].map(word => word.segment).join(' ')
    insert.run(record.kind + ':' + record.value.id, project, content)
  }
  const rows = database.prepare('SELECT id FROM records WHERE records MATCH ? AND engagement = ? ORDER BY rank LIMIT ?')
    .all(words.join(' AND '), engagementId, limit)
  return rows.map(row => String(row.id))
}
