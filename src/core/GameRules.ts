import {
  osuApproachTimeMax,
  osuApproachTimeMid,
  osuApproachTimeMin,
  osuHitWindow100Max,
  osuHitWindow100Mid,
  osuHitWindow100Min,
  osuHitWindow300Max,
  osuHitWindow300Mid,
  osuHitWindow300Min,
  osuHitWindow50Max,
  osuHitWindow50Mid,
  osuHitWindow50Min,
  osuHitWindowMiss,
} from './ConVars.ts'

export const OSU_COORD_WIDTH = 512
export const OSU_COORD_HEIGHT = 384

export const PLAYFIELD_BORDER_TOP_PERCENT = 0.117
export const PLAYFIELD_BORDER_BOTTOM_PERCENT = 0.0834
export const HITOBJECT_FADE_IN_MS = 400
const BROKEN_GAMEFIELD_ROUNDING_ALLOWANCE = 1.00041

export interface Point {
  readonly x: number
  readonly y: number
}

export interface PlayfieldTransform {
  readonly scale: number
  readonly offset: Point
  readonly size: Point
  readonly center: Point
}

// OsuGameRules.h:143-153. McOsu deliberately allows values outside 0..10.
export function mapDifficultyRange(value: number, min: number, mid: number, max: number): number {
  if (value > 5) return mid + ((max - mid) * (value - 5)) / 5
  if (value < 5) return mid - ((mid - min) * (5 - value)) / 5
  return mid
}

// Defaults from OsuGameRules.cpp:49-52; mapping in OsuGameRules.h:230-233.
export function approachTimeMS(approachRate: number): number {
  return mapDifficultyRange(
    approachRate,
    osuApproachTimeMin.getFloat(),
    osuApproachTimeMid.getFloat(),
    osuApproachTimeMax.getFloat(),
  )
}

// Defaults from OsuGameRules.cpp:54-66; mapping in OsuGameRules.h:251-284.
export function hitWindowsMS(overallDifficulty: number): Readonly<{
  hit300: number
  hit100: number
  hit50: number
  miss: number
}> {
  return {
    hit300: mapDifficultyRange(overallDifficulty, osuHitWindow300Min.getFloat(), osuHitWindow300Mid.getFloat(), osuHitWindow300Max.getFloat()),
    hit100: mapDifficultyRange(overallDifficulty, osuHitWindow100Min.getFloat(), osuHitWindow100Mid.getFloat(), osuHitWindow100Max.getFloat()),
    hit50: mapDifficultyRange(overallDifficulty, osuHitWindow50Min.getFloat(), osuHitWindow50Mid.getFloat(), osuHitWindow50Max.getFloat()),
    miss: osuHitWindowMiss.getFloat(),
  }
}

// OsuGameRules.h:363-375. This is an osu-coordinate radius, before screen scaling.
export function rawCircleRadius(circleSize: number): number {
  const scale = Math.max(
    0,
    ((1 - (0.7 * (circleSize - 5)) / 5) / 2) * BROKEN_GAMEFIELD_ROUNDING_ALLOWANCE,
  )
  return (scale * 128) / 2
}

export function fadeInProgress(currentTimeMS: number, objectTimeMS: number, approachMS: number): number {
  const visibleAt = objectTimeMS - approachMS
  return clamp((currentTimeMS - visibleAt) / HITOBJECT_FADE_IN_MS, 0, 1)
}

// OsuGameRules.h:287-295. McOsu requires half the stable rotations and compensates
// only speed multipliers above 1x.
export function spinnerSpinsPerSecond(overallDifficulty: number): number {
  return mapDifficultyRange(overallDifficulty, 3, 5, 7.5)
}

export function spinnerRequiredRotations(
  overallDifficulty: number,
  durationMS: number,
  speedMultiplier = 1,
): number {
  if (!(speedMultiplier > 0)) throw new Error('Speed multiplier must be greater than zero.')
  return Math.trunc(
    ((durationMS / 1_000) * spinnerSpinsPerSecond(overallDifficulty) * 0.5) *
      Math.min(1 / speedMultiplier, 1),
  )
}

// OsuGameRules.h:397-434. C++ truncates the border sizes and Y offset to ints.
export function getPlayfieldTransform(width: number, height: number): PlayfieldTransform {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const topBorder = Math.trunc(PLAYFIELD_BORDER_TOP_PERCENT * safeHeight)
  const bottomBorder = Math.trunc(PLAYFIELD_BORDER_BOTTOM_PERCENT * safeHeight)
  const usableHeight = safeHeight - topBorder - bottomBorder
  const scale = Math.min(safeWidth / OSU_COORD_WIDTH, usableHeight / OSU_COORD_HEIGHT)
  const size = { x: OSU_COORD_WIDTH * scale, y: OSU_COORD_HEIGHT * scale }
  const playfieldYOffset = Math.trunc(safeHeight / 2 - size.y / 2 - bottomBorder)
  const offset = {
    x: (safeWidth - size.x) / 2,
    y: (safeHeight - size.y) / 2 + playfieldYOffset,
  }
  return {
    scale,
    size,
    offset,
    center: {
      x: (OSU_COORD_WIDTH / 2) * scale + offset.x,
      y: (OSU_COORD_HEIGHT / 2) * scale + offset.y,
    },
  }
}

// OsuBeatmapStandard.cpp:1157-1186 with VR/mod transforms intentionally omitted.
export function osuCoords2Pixels(point: Point, transform: PlayfieldTransform): Point {
  return {
    x: point.x * transform.scale + transform.offset.x,
    y: point.y * transform.scale + transform.offset.y,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
