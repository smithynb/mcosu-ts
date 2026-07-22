import { calculateGrade, type Grade } from '../core/Grade.ts'
import { OsuFile, OsuFileFormatError } from './OsuFile.ts'
import type { ReplayFrame } from '../core/Replay.ts'

export type ScoresDatabaseFormat = 'stable' | 'mcosu'
export type LocalScoreSource = ScoresDatabaseFormat | 'browser'

export interface LocalScore {
  readonly source: LocalScoreSource
  readonly md5: string
  readonly version: number
  readonly playerName: string
  readonly count300: number
  readonly count100: number
  readonly count50: number
  readonly countGeki: number
  readonly countKatu: number
  readonly countMiss: number
  readonly score: bigint
  readonly maxCombo: number
  readonly perfect: boolean
  readonly modsLegacy: number
  readonly modAcronyms: string
  readonly accuracy: number
  readonly grade: Grade
  readonly playedAt: Date
  readonly pp?: number
  readonly sliderBreaks?: number
  readonly speedMultiplier: number
  readonly importedLegacy: boolean
  readonly sourceOrder: number
  readonly replayFrames?: readonly ReplayFrame[]
}

export interface ScoresDatabaseResult {
  readonly format: ScoresDatabaseFormat
  readonly version: number
  readonly declaredBeatmapCount: number
  readonly scores: readonly LocalScore[]
}

export const MAX_MCOSU_SCORES_VERSION = 20210110

const MAX_BEATMAPS = 2_000_000
const MAX_SCORES_PER_BEATMAP = 1_000_000
const WINDOWS_EPOCH_TICKS = 621_355_968_000_000_000n
const TICKS_PER_MILLISECOND = 10_000n
const MOD_TARGET = 8_388_608
const MOD_HIDDEN = 8
const MOD_FLASHLIGHT = 1_024
const MOD_HALFTIME = 256
const MOD_DOUBLETIME = 64
const MOD_NIGHTCORE = 512

/** Port of the osu!stable branch in `OsuDatabase.cpp:2270-2414`. */
export function parseStableScoresDatabase(buffer: ArrayBuffer): ScoresDatabaseResult {
  const db = new OsuFile(buffer)
  const version = db.readInt()
  const declaredBeatmapCount = readCount(db, 'beatmap count', MAX_BEATMAPS)
  const scores: LocalScore[] = []
  let sourceOrder = 0

  for (let beatmapIndex = 0; beatmapIndex < declaredBeatmapCount; beatmapIndex += 1) {
    const md5 = readMd5(db, beatmapIndex)
    const scoreCount = readCount(db, 'score count', MAX_SCORES_PER_BEATMAP)
    for (let scoreIndex = 0; scoreIndex < scoreCount; scoreIndex += 1) {
      const mode = db.readByte()
      const scoreVersion = db.readInt()
      db.skipString() // beatmap hash repeated in the score
      const playerName = db.readString()
      db.skipString() // replay hash
      const hitCounts = readHitCounts(db)
      const signedScore = db.readInt()
      const score = BigInt(Math.max(0, signedScore))
      const maxCombo = nonNegativeShort(db.readShort())
      const perfect = db.readBool()
      const modsLegacy = db.readInt()
      db.skipString() // HP graph
      const ticks = db.readLongLong()
      db.skipByteArray()
      if (scoreVersion >= 20131110) db.skip(8)
      else if (scoreVersion >= 20121008) db.skip(4)
      if ((modsLegacy & MOD_TARGET) !== 0) db.skip(8)

      if (mode === 0) {
        scores.push(normalizeScore({
          source: 'stable', md5, version: scoreVersion, playerName,
          ...hitCounts, score, maxCombo, perfect, modsLegacy,
          playedAt: windowsTicksToDate(ticks), speedMultiplier: speedForMods(modsLegacy),
          importedLegacy: false, sourceOrder: sourceOrder++,
        }))
      }
    }
  }
  assertConsumed(db, 'stable scores.db')
  return { format: 'stable', version, declaredBeatmapCount, scores }
}

/** Port of McOsu's custom branch in `OsuDatabase.cpp:2078-2244`. */
export function parseMcOsuScoresDatabase(buffer: ArrayBuffer): ScoresDatabaseResult {
  const db = new OsuFile(buffer)
  const version = db.readInt()
  const declaredBeatmapCount = readCount(db, 'beatmap count', MAX_BEATMAPS)
  if (version > MAX_MCOSU_SCORES_VERSION) {
    throw new OsuFileFormatError(
      `McOsu scores.db version ${version} is newer than supported ${MAX_MCOSU_SCORES_VERSION}`,
      0,
    )
  }
  const scores: LocalScore[] = []
  let sourceOrder = 0

  for (let beatmapIndex = 0; beatmapIndex < declaredBeatmapCount; beatmapIndex += 1) {
    const md5 = readMd5(db, beatmapIndex)
    const scoreCount = readCount(db, 'score count', MAX_SCORES_PER_BEATMAP)
    for (let scoreIndex = 0; scoreIndex < scoreCount; scoreIndex += 1) {
      const modeOrFlags = db.readByte()
      const scoreVersion = db.readInt()
      let importedLegacy = false
      if (version === 20210103 && scoreVersion > 20190103) importedLegacy = db.readBool()
      else if (version > 20210103 && scoreVersion > 20190103) importedLegacy = (modeOrFlags & 0xa9) !== 0
      const unixTimestamp = db.readUnsignedLongLong()
      const playerName = db.readString()
      const hitCounts = readHitCounts(db)
      const score = db.readUnsignedLongLong()
      const maxCombo = nonNegativeShort(db.readShort())
      const modsLegacy = db.readInt()
      const sliderBreaks = nonNegativeShort(db.readShort())
      const pp = finiteFloat(db.readFloat(), 'pp', db.offset - 4)
      db.skip(4 * 6) // unstable rate, hit-error min/max, total/aim/speed stars
      const speedMultiplier = finiteFloat(db.readFloat(), 'speed multiplier', db.offset - 4)
      db.skip(4 * 4) // CS, AR, OD, HP
      let maxPossibleCombo = -1
      if (scoreVersion > 20180722) {
        maxPossibleCombo = db.readInt()
        db.skip(4 * 2) // hitobject and circle counts
      }
      db.skipString() // experimental mods

      if (modeOrFlags === 0 || (version > 20210103 && scoreVersion > 20190103)) {
        scores.push(normalizeScore({
          source: 'mcosu', md5, version: scoreVersion, playerName,
          ...hitCounts, score, maxCombo,
          perfect: maxPossibleCombo > 0 && maxCombo > 0 && maxCombo >= maxPossibleCombo,
          modsLegacy, playedAt: unixSecondsToDate(unixTimestamp),
          pp, sliderBreaks, speedMultiplier, importedLegacy,
          sourceOrder: sourceOrder++,
        }))
      }
    }
  }
  assertConsumed(db, 'McOsu scores.db')
  return { format: 'mcosu', version, declaredBeatmapCount, scores }
}

export function parseScoresDatabase(buffer: ArrayBuffer): ScoresDatabaseResult {
  try {
    return parseStableScoresDatabase(buffer)
  } catch (stableError) {
    try {
      return parseMcOsuScoresDatabase(buffer)
    } catch (customError) {
      const stableReason = stableError instanceof Error ? stableError.message : String(stableError)
      const customReason = customError instanceof Error ? customError.message : String(customError)
      throw new Error(`scores.db is neither a valid osu!stable nor McOsu database. Stable: ${stableReason}. McOsu: ${customReason}`)
    }
  }
}

export function indexScoresByMd5(scores: readonly LocalScore[]): ReadonlyMap<string, readonly LocalScore[]> {
  const index = new Map<string, LocalScore[]>()
  for (const score of scores) {
    const key = score.md5.toLowerCase()
    const list = index.get(key) ?? []
    list.push(score)
    index.set(key, list)
  }
  for (const list of index.values()) {
    list.sort((left, right) => {
      if (left.score !== right.score) return left.score > right.score ? -1 : 1
      const timeDelta = right.playedAt.getTime() - left.playedAt.getTime()
      return timeDelta !== 0 ? timeDelta : left.sourceOrder - right.sourceOrder
    })
  }
  return index
}

export function modsFromLegacy(mods: number): string {
  const values: string[] = []
  const flags: readonly [number, string][] = [
    [1, 'NF'], [2, 'EZ'], [8, 'HD'], [16, 'HR'], [32, 'SD'],
    [64, 'DT'], [128, 'RX'], [256, 'HT'], [512, 'NC'], [1024, 'FL'],
    [2048, 'Auto'], [4096, 'SO'], [8192, 'AP'], [16384, 'PF'], [536870912, 'V2'],
  ]
  for (const [flag, acronym] of flags) if ((mods & flag) !== 0) values.push(acronym)
  if (values.includes('NC')) remove(values, 'DT')
  if (values.includes('PF')) remove(values, 'SD')
  return values.join('') || 'NM'
}

function normalizeScore(
  score: Omit<LocalScore, 'accuracy' | 'grade' | 'modAcronyms'>,
): LocalScore {
  const total = score.count300 + score.count100 + score.count50 + score.countMiss
  const accuracy = total === 0
    ? 0
    : (score.count300 + score.count100 / 3 + score.count50 / 6) / total
  return {
    ...score,
    accuracy,
    grade: calculateGrade(score, {
      hidden: (score.modsLegacy & MOD_HIDDEN) !== 0,
      flashlight: (score.modsLegacy & MOD_FLASHLIGHT) !== 0,
    }),
    modAcronyms: modsFromLegacy(score.modsLegacy),
  }
}

function readHitCounts(db: OsuFile) {
  return {
    count300: nonNegativeShort(db.readShort()),
    count100: nonNegativeShort(db.readShort()),
    count50: nonNegativeShort(db.readShort()),
    countGeki: nonNegativeShort(db.readShort()),
    countKatu: nonNegativeShort(db.readShort()),
    countMiss: nonNegativeShort(db.readShort()),
  }
}

function readMd5(db: OsuFile, beatmapIndex: number): string {
  const offset = db.offset
  const md5 = db.readString().trim().toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(md5)) {
    throw new OsuFileFormatError(`Invalid MD5 for score beatmap ${beatmapIndex + 1}`, offset)
  }
  return md5
}

function readCount(db: OsuFile, label: string, maximum: number): number {
  const offset = db.offset
  const value = db.readInt()
  if (value < 0 || value > maximum) throw new OsuFileFormatError(`Invalid ${label}: ${value}`, offset)
  return value
}

function nonNegativeShort(value: number): number {
  return Math.max(0, value)
}

function finiteFloat(value: number, label: string, offset: number): number {
  if (!Number.isFinite(value)) throw new OsuFileFormatError(`Invalid ${label}: ${value}`, offset)
  return value
}

function windowsTicksToDate(ticks: bigint): Date {
  return checkedDate(Number((ticks - WINDOWS_EPOCH_TICKS) / TICKS_PER_MILLISECOND))
}

function unixSecondsToDate(seconds: bigint): Date {
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new OsuFileFormatError('Unix timestamp exceeds JavaScript range', 0)
  return checkedDate(Number(seconds) * 1_000)
}

function checkedDate(milliseconds: number): Date {
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) throw new OsuFileFormatError('Score timestamp is outside the JavaScript Date range', 0)
  return date
}

function speedForMods(mods: number): number {
  if ((mods & MOD_HALFTIME) !== 0) return 0.75
  if ((mods & (MOD_DOUBLETIME | MOD_NIGHTCORE)) !== 0) return 1.5
  return 1
}

function assertConsumed(db: OsuFile, label: string): void {
  if (db.remaining !== 0) throw new OsuFileFormatError(`Unexpected ${db.remaining} trailing bytes after ${label}`, db.offset)
}

function remove(values: string[], value: string): void {
  const index = values.indexOf(value)
  if (index >= 0) values.splice(index, 1)
}
