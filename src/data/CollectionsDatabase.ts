import { OsuFile, OsuFileFormatError } from './OsuFile.ts'

export type CollectionSource = 'stable' | 'mcosu'

export interface BeatmapCollection {
  readonly name: string
  readonly hashes: readonly string[]
  readonly sources: readonly CollectionSource[]
}

export interface CollectionsDatabaseResult {
  readonly source: CollectionSource
  readonly version: number
  readonly collections: readonly BeatmapCollection[]
}

export const MAX_MCOSU_COLLECTIONS_VERSION = 20220110
const MAX_COLLECTIONS = 1_000_000
const MAX_ENTRIES = 2_000_000

/** Port of OsuDatabase.cpp:2536-2634 collection.db read layout. */
export function parseCollectionsDatabase(buffer: ArrayBuffer, source: CollectionSource): CollectionsDatabaseResult {
  const db = new OsuFile(buffer)
  const versionOffset = db.offset
  const version = db.readInt()
  if (version <= 0) throw new OsuFileFormatError(`Invalid collections version: ${version}`, versionOffset)
  if (source === 'mcosu' && version > MAX_MCOSU_COLLECTIONS_VERSION) {
    throw new OsuFileFormatError(
      `McOsu collections version ${version} is newer than supported ${MAX_MCOSU_COLLECTIONS_VERSION}`,
      versionOffset,
    )
  }
  const count = readCount(db, 'collection count', MAX_COLLECTIONS)
  const collections: BeatmapCollection[] = []
  let totalEntries = 0
  for (let index = 0; index < count; index += 1) {
    const name = db.readString()
    const entryCount = readCount(db, `entry count for collection ${index + 1}`, MAX_ENTRIES)
    totalEntries += entryCount
    if (totalEntries > MAX_ENTRIES) throw new OsuFileFormatError(`Total collection entries exceed ${MAX_ENTRIES}`, db.offset)
    const hashes: string[] = []
    for (let entry = 0; entry < entryCount; entry += 1) {
      const hash = db.readString().trim().toLowerCase()
      // OsuDatabase.cpp:2644-2650 ignores non-MD5 entries while preserving
      // the rest of the collection. The string is still consumed structurally.
      if (/^[0-9a-f]{32}$/.test(hash)) hashes.push(hash)
    }
    collections.push({ name, hashes, sources: [source] })
  }
  if (db.remaining !== 0) throw new OsuFileFormatError(`Unexpected trailing collection data: ${db.remaining} bytes`, db.offset)
  return { source, version, collections }
}

/** OsuDatabase.cpp:2677-2722 merges same-name stable/custom collections. */
export function mergeCollections(groups: readonly (readonly BeatmapCollection[])[]): readonly BeatmapCollection[] {
  const merged = new Map<string, { name: string; hashes: Set<string>; sources: Set<CollectionSource> }>()
  for (const collections of groups) {
    for (const collection of collections) {
      const existing = merged.get(collection.name) ?? {
        name: collection.name,
        hashes: new Set<string>(),
        sources: new Set<CollectionSource>(),
      }
      for (const hash of collection.hashes) existing.hashes.add(hash.toLowerCase())
      for (const source of collection.sources) existing.sources.add(source)
      merged.set(collection.name, existing)
    }
  }
  return [...merged.values()]
    .map((collection) => ({ name: collection.name, hashes: [...collection.hashes], sources: [...collection.sources] }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function indexCollectionHashes(collections: readonly BeatmapCollection[]): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(collections.map((collection) => [collection.name, new Set(collection.hashes)]))
}

function readCount(db: OsuFile, label: string, maximum: number): number {
  const offset = db.offset
  const value = db.readInt()
  if (value < 0 || value > maximum) throw new OsuFileFormatError(`Invalid ${label}: ${value}`, offset)
  return value
}
