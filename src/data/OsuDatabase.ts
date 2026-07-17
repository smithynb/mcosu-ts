import { OsuFile, OsuFileFormatError } from './OsuFile.ts'

export const MINIMUM_OSU_DATABASE_VERSION = 20170222
export const STAR_RATING_FLOAT_VERSION = 20250108

export interface BeatmapEntry {
  readonly artist: string
  readonly title: string
  readonly creator: string
  readonly difficultyName: string
  readonly audioFile: string
  readonly md5: string
  /** Path from the beatmap-folder root (normally osu!/Songs). */
  readonly osuPath: string
  /** Beatmap folder path from the database, relative to the Songs directory. */
  readonly folder: string
  readonly ar: number
  readonly cs: number
  readonly hp: number
  readonly od: number
  readonly starRating?: number
  readonly length: number
  readonly mode: number
}

export interface OsuDatabaseResult {
  readonly version: number
  readonly folderCount: number
  readonly playerName: string
  readonly declaredBeatmapCount: number
  readonly beatmaps: BeatmapEntry[]
}

export class OsuDatabaseVersionError extends Error {
  readonly version: number
  readonly fallbackRecommended: boolean

  constructor(version: number, message: string, fallbackRecommended: boolean) {
    super(message)
    this.name = 'OsuDatabaseVersionError'
    this.version = version
    this.fallbackRecommended = fallbackRecommended
  }
}

const MAX_BEATMAPS = 2_000_000
const MAX_STAR_RATINGS = 100_000
const MAX_TIMING_POINTS = 2_000_000

/**
 * Parse McOsu's supported legacy osu!.db format and return osu!standard maps.
 *
 * Ported from McOsu `OsuDatabase.cpp:1324-1596` (`loadDB()`). The parser reads
 * every field for every mode before filtering, which keeps later entries
 * aligned even when taiko, catch, or mania maps are interleaved.
 */
export function parseOsuDatabase(buffer: ArrayBuffer): OsuDatabaseResult {
  const db = new OsuFile(buffer)

  // Header order: OsuDatabase.cpp:1355-1361.
  const version = db.readInt()
  const folderCount = db.readInt()
  db.readBool() // account unlocked
  db.skipDateTime()
  const playerName = db.readString()
  const declaredBeatmapCount = readCount(db, 'beatmap count', MAX_BEATMAPS)

  if (version < MINIMUM_OSU_DATABASE_VERSION) {
    throw new OsuDatabaseVersionError(
      version,
      `osu!.db version ${version} is older than McOsu's supported ${MINIMUM_OSU_DATABASE_VERSION} format. Update osu!stable and try again.`,
      false,
    )
  }

  const beatmaps: BeatmapEntry[] = []
  for (let index = 0; index < declaredBeatmapCount; index += 1) {
    const entryOffset = db.offset
    let entry: BeatmapEntry
    try {
      entry = readBeatmapEntry(db, version)
      validateEntry(entry, index, entryOffset)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new OsuFileFormatError(
        `osu!.db entry ${index + 1}/${declaredBeatmapCount} is misaligned or corrupt: ${reason}`,
        entryOffset,
      )
    }
    if (entry.mode !== 0 || isBlankEntry(entry)) continue
    beatmaps.push(entry)
  }

  // The osu! format documents one trailing Int32 permissions value. McOsu
  // ignores it because it stops after the entry loop. Accept exactly that
  // trailer or no trailer, but reject any other remainder as layout drift.
  if (db.remaining === 4) db.skip(4)
  if (db.remaining !== 0) {
    throw new OsuFileFormatError(
      `Unexpected ${db.remaining} trailing bytes after ${declaredBeatmapCount} beatmap entries; the database layout may have changed`,
      db.offset,
    )
  }

  return { version, folderCount, playerName, declaredBeatmapCount, beatmaps }
}

function readBeatmapEntry(db: OsuFile, version: number): BeatmapEntry {
  // Stable stopped prefixing each entry with its byte size in 20191107;
  // McOsu explicitly uses 20191107 (not the 20191106 wiki revision).
  if (version < 20191107) db.skip(4)

  const artist = db.readString().trim()
  db.skipString() // artist unicode
  const title = db.readString().trim()
  db.skipString() // title unicode
  const creator = db.readString().trim()
  const difficultyName = db.readString().trim()
  const audioFile = db.readString()
  const md5 = db.readString()
  const osuFile = db.readString()

  db.skip(1 + 2 + 2 + 2 + 8) // ranked state, object counts, modification time
  const ar = db.readFloat()
  const cs = db.readFloat()
  const hp = db.readFloat()
  const od = db.readFloat()
  db.skip(8) // slider multiplier

  // Four independent mode blocks must always be consumed. Stable changed each
  // rating value from a double to a float in database version 20250108.
  const starRating = readStarRatings(db, version, true)
  readStarRatings(db, version, false) // taiko
  readStarRatings(db, version, false) // catch
  readStarRatings(db, version, false) // mania

  db.skip(4) // drain time
  const rawLength = db.readInt()
  const length = Math.max(0, rawLength)
  db.skip(4) // preview time

  const timingPointCount = readCount(db, 'timing-point count', MAX_TIMING_POINTS)
  // OsuFile.cpp:303-308 is authoritative here: every supported timing point is
  // two little-endian doubles followed by one byte. No int/float version split
  // exists in the cited McOsu reader.
  for (let index = 0; index < timingPointCount; index += 1) db.skipTimingPoint()

  db.skip(4 + 4 + 4) // beatmap id, set id, thread id
  db.skip(4) // grades for standard, taiko, catch, mania
  db.skip(2 + 4) // local offset, stack leniency
  const mode = db.readByte()
  db.skipString() // source
  db.skipString() // tags
  db.skip(2) // online offset
  db.skipString() // title font
  db.skip(1 + 8 + 1) // unplayed, last played, osz2
  const folder = normalizeDatabasePath(db.readString().trim())
  db.skip(8) // last online check
  db.skip(5 + 4 + 1) // five override flags, last edit time, mania scroll speed

  return {
    artist,
    title,
    creator,
    difficultyName,
    audioFile,
    md5,
    osuPath: joinDatabasePath(folder, osuFile),
    folder,
    ar,
    cs,
    hp,
    od,
    ...(starRating === undefined ? {} : { starRating }),
    length,
    mode,
  }
}

function readStarRatings(db: OsuFile, version: number, keepNoMod: boolean): number | undefined {
  // Star blocks were introduced in 20140609. McOsu rejects older databases
  // before entry parsing, but retaining the gate documents the format boundary.
  if (version < 20140609) return undefined

  const count = readCount(db, 'star-rating count', MAX_STAR_RATINGS)
  let noModRating: number | undefined

  for (let index = 0; index < count; index += 1) {
    const modsType = db.readByte()
    if (modsType !== 0x08) {
      throw new OsuFileFormatError(`Expected Int32 star-rating object, received 0x${modsType.toString(16)}`, db.offset - 1)
    }
    const mods = db.readInt()
    const ratingType = db.readByte()
    const expectedRatingType = version >= STAR_RATING_FLOAT_VERSION ? 0x0c : 0x0d
    if (ratingType !== expectedRatingType) {
      throw new OsuFileFormatError(`Expected floating-point star-rating object, received 0x${ratingType.toString(16)}`, db.offset - 1)
    }
    const rating = version >= STAR_RATING_FLOAT_VERSION ? db.readFloat() : db.readDouble()
    if (!Number.isFinite(rating) || rating < 0 || rating > 100) {
      throw new OsuFileFormatError(`Invalid star rating ${rating}`, db.offset)
    }
    if (keepNoMod && mods === 0) noModRating = rating
  }

  return noModRating
}

function readCount(db: OsuFile, label: string, maximum: number): number {
  const offset = db.offset
  const count = db.readInt()
  if (count < 0 || count > maximum) {
    throw new OsuFileFormatError(`Invalid ${label}: ${count}`, offset)
  }
  return count
}

function validateEntry(entry: BeatmapEntry, index: number, offset: number): void {
  if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 3) {
    throw new OsuFileFormatError(`Invalid game mode ${entry.mode} in entry ${index + 1}`, offset)
  }
  for (const [label, value] of [['AR', entry.ar], ['CS', entry.cs], ['HP', entry.hp], ['OD', entry.od]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new OsuFileFormatError(`Invalid ${label} value ${value} in entry ${index + 1}`, offset)
    }
  }
}

function normalizeDatabasePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
}

function joinDatabasePath(folder: string, file: string): string {
  const normalizedFile = normalizeDatabasePath(file)
  return folder.length > 0 ? `${folder}/${normalizedFile}` : normalizedFile
}

function isBlankEntry(entry: BeatmapEntry): boolean {
  return (
    entry.artist.length === 0 &&
    entry.title.length === 0 &&
    entry.creator.length === 0 &&
    entry.difficultyName.length === 0 &&
    entry.md5.length === 0
  )
}
