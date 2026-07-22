import type { GameplayBeatmap } from '../data/GameplayLoader.ts'
import { applyStacking } from './Stacking.ts'
import {
  osuLocalOffset,
  osuModHdCircleFadeInEndPercent,
  osuModHdCircleFadeInStartPercent,
  osuModHdCircleFadeOutEndPercent,
  osuModHdCircleFadeOutStartPercent,
  osuUniversalOffset,
} from './ConVars.ts'

export type GameplayMod = 'NF' | 'EZ' | 'HD' | 'HR' | 'DT' | 'NC' | 'HT' | 'Auto'
export type GameplayMods = Readonly<Record<GameplayMod, boolean>>

export const NO_MODS: GameplayMods = {
  NF: false, EZ: false, HD: false, HR: false,
  DT: false, NC: false, HT: false, Auto: false,
}

export interface ModdedGameplayBeatmap extends GameplayBeatmap {
  readonly mods: GameplayMods
  readonly scoreMultiplier: number
}

// Osu.cpp:1956-1977. Difficulty adjustments are applied HR then EZ and capped.
export function applyDifficultyMods(beatmap: GameplayBeatmap, mods: GameplayMods): ModdedGameplayBeatmap {
  let ar = beatmap.approachRate
  let cs = beatmap.circleSize
  let od = beatmap.overallDifficulty
  let hp = beatmap.drainRate
  // getDifficultyMultiplier() assigns HR first and EZ second, so EZ wins if a
  // caller supplies the normally-incompatible pair.
  const difficultyMultiplier = mods.EZ ? 0.5 : mods.HR ? 1.4 : 1
  const circleSizeMultiplier = mods.EZ ? 0.5 : mods.HR ? 1.3 : 1
  ar = clamp(ar * difficultyMultiplier, 0, 10)
  od = clamp(od * difficultyMultiplier, 0, 10)
  hp = clamp(hp * difficultyMultiplier, 0, 10)
  cs = clamp(cs * circleSizeMultiplier, 0, 10)
  const difficulty = { ...beatmap, approachRate: ar, circleSize: cs, overallDifficulty: od, drainRate: hp }
  return {
    ...applyStacking(difficulty, { approachRate: ar, hardRock: mods.HR }),
    mods,
    scoreMultiplier: scoreMultiplier(mods),
  }
}

// Osu.cpp:1980-2007 scoreV1 factors, multiplied in McOsu's order.
export function scoreMultiplier(mods: GameplayMods): number {
  let multiplier = 1
  if (mods.EZ || mods.NF) multiplier *= 0.5
  if (mods.HT) multiplier *= 0.3
  if (mods.HR) multiplier *= 1.06
  if (mods.DT || mods.NC) multiplier *= 1.12
  if (mods.HD) multiplier *= 1.06
  return multiplier
}

export function modSpeed(mods: GameplayMods): number {
  return mods.DT || mods.NC ? 1.5 : mods.HT ? 0.75 : 1
}

/** DT preserves pitch; NC intentionally raises it. */
export function modPitchPreserved(mods: GameplayMods): boolean {
  return !mods.NC
}

export function modsToLegacy(mods: GameplayMods): number {
  let result = 0
  if (mods.NF) result |= 1
  if (mods.EZ) result |= 2
  if (mods.HD) result |= 8
  if (mods.HR) result |= 16
  if (mods.DT) result |= 64
  if (mods.HT) result |= 256
  if (mods.NC) result |= 512 | 64
  if (mods.Auto) result |= 2048
  return result
}

// OsuBeatmap.cpp:581-587: universal is added after scaling by speed; local is subtracted.
export function musicPositionWithOffsets(
  musicPositionMS: number,
  speedMultiplier: number,
  databaseLocalOffsetMS = 0,
): number {
  return musicPositionMS
    + osuUniversalOffset.getFloat() * speedMultiplier
    - databaseLocalOffsetMS
    - osuLocalOffset.getFloat()
}

// OsuHitObject.cpp:481-493. Percentages are fractions of the AR approach interval.
export function hiddenAlpha(positionMS: number, objectTimeMS: number, approachMS: number): number {
  const percent = (objectTimeMS - positionMS) / Math.max(approachMS, 1)
  const fadeIn = rangeProgress(
    percent,
    osuModHdCircleFadeInStartPercent.getFloat(),
    osuModHdCircleFadeInEndPercent.getFloat(),
  )
  const fadeOut = 1 - rangeProgress(
    percent,
    osuModHdCircleFadeOutStartPercent.getFloat(),
    osuModHdCircleFadeOutEndPercent.getFloat(),
  )
  return clamp(Math.min(fadeIn, fadeOut), 0, 1)
}

function rangeProgress(value: number, start: number, end: number): number {
  if (start === end) return value <= end ? 1 : 0
  return clamp((start - value) / (start - end), 0, 1)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
