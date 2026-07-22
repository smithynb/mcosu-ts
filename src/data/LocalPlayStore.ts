import { calculateGrade } from '../core/Grade.ts'
import type { GameplayMods } from '../core/Mods.ts'
import { modsToLegacy } from '../core/Mods.ts'
import type { ScoreSnapshot } from '../core/Score.ts'
import { indexScoresByMd5, modsFromLegacy, type LocalScore } from './ScoresDatabase.ts'
import type { ReplayFrame } from '../core/Replay.ts'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CompletedPlay {
  readonly id: string
  readonly md5: string
  readonly playerName: string
  readonly score: ScoreSnapshot
  readonly pp: number
  readonly mods: GameplayMods
  readonly playedAt: Date
  readonly replayFrames?: readonly ReplayFrame[]
}

interface StoredPlay {
  readonly id: string
  readonly md5: string
  readonly playerName: string
  readonly score: Omit<ScoreSnapshot, 'accuracy' | 'score'> & { readonly score: string }
  readonly pp: number
  readonly modsLegacy: number
  readonly playedAt: string
  readonly replayFrames?: readonly ReplayFrame[]
}

const STORAGE_KEY = 'mcosu-ts.local-plays.v1'

export class LocalPlayStore {
  readonly #storage: StorageLike | null
  readonly #key: string
  #plays: StoredPlay[]

  constructor(storage: StorageLike | null = browserStorage(), key = STORAGE_KEY) {
    this.#storage = storage
    this.#key = key
    this.#plays = read(storage, key)
  }

  add(play: CompletedPlay): readonly LocalScore[] {
    if (!this.#plays.some((item) => item.id === play.id)) {
      const { accuracy: _accuracy, score: numericScore, ...counts } = play.score
      this.#plays.push({
        id: play.id,
        md5: play.md5.toLowerCase(),
        playerName: play.playerName,
        score: { ...counts, score: String(Math.max(0, Math.trunc(numericScore))) },
        pp: play.pp,
        modsLegacy: modsToLegacy(play.mods),
        playedAt: play.playedAt.toISOString(),
        replayFrames: play.replayFrames?.map((frame) => ({ ...frame })),
      })
      this.#persist()
    }
    return this.scores()
  }

  scores(): readonly LocalScore[] {
    return this.#plays.flatMap((play, sourceOrder) => {
      const playedAt = new Date(play.playedAt)
      const values = [play.score.combo, play.score.maxCombo, play.score.count300,
        play.score.count100, play.score.count50, play.score.countMiss, play.score.countGeki, play.score.countKatu, play.pp]
      if (!/^[0-9a-f]{32}$/.test(play.md5) || !Number.isFinite(playedAt.getTime()) ||
        !/^\d+$/.test(play.score.score) || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) return []
      const total = play.score.count300 + play.score.count100 + play.score.count50 + play.score.countMiss
      const accuracy = total === 0 ? 0 : (play.score.count300 + play.score.count100 / 3 + play.score.count50 / 6) / total
      return [{
        source: 'browser' as const,
        md5: play.md5,
        version: 1,
        playerName: play.playerName,
        ...play.score,
        score: BigInt(play.score.score),
        perfect: play.score.countMiss === 0 && play.score.count100 === 0 && play.score.count50 === 0,
        modsLegacy: play.modsLegacy,
        modAcronyms: modsFromLegacy(play.modsLegacy),
        accuracy,
        grade: calculateGrade(play.score, { hidden: (play.modsLegacy & 8) !== 0 }),
        playedAt,
        pp: play.pp,
        speedMultiplier: (play.modsLegacy & (64 | 512)) !== 0 ? 1.5 : (play.modsLegacy & 256) !== 0 ? 0.75 : 1,
        importedLegacy: false,
        sourceOrder,
        replayFrames: validReplayFrames(play.replayFrames) ? play.replayFrames?.map((frame) => ({ ...frame })) : undefined,
      }]
    })
  }

  mergedIndex(existing: readonly LocalScore[]): ReadonlyMap<string, readonly LocalScore[]> {
    return indexScoresByMd5([...existing, ...this.scores()])
  }

  #persist(): void {
    try { this.#storage?.setItem(this.#key, JSON.stringify(this.#plays)) } catch { /* local scores remain in memory */ }
  }
}

function validReplayFrames(value: unknown): value is readonly ReplayFrame[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= 2_000_000 && value.every((frame) => {
    if (typeof frame !== 'object' || frame === null) return false
    const item = frame as ReplayFrame
    return Number.isFinite(item.delta) && item.delta >= 0 && Number.isFinite(item.x) && Number.isFinite(item.y) &&
      Number.isSafeInteger(item.keys) && item.keys >= 0 && item.keys <= 15
  }))
}

function read(storage: StorageLike | null, key: string): StoredPlay[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is StoredPlay => typeof item === 'object' && item !== null &&
      typeof (item as StoredPlay).id === 'string' && typeof (item as StoredPlay).md5 === 'string' &&
      typeof (item as StoredPlay).playedAt === 'string' && typeof (item as StoredPlay).score === 'object')
  } catch { return [] }
}

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
