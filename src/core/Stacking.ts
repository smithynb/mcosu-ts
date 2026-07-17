import type {
  GameplayBeatmap,
  GameplayObject,
  GameplayPoint,
  GameplaySlider,
  GameplaySliderControlPoint,
} from '../data/GameplayLoader.ts'
import { approachTimeMS, rawCircleRadius } from './GameRules.ts'
import {
  osuStacking,
  osuStackingArOverride,
  osuStackingLeniencyOverride,
} from './ConVars.ts'

// OsuBeatmapStandard.cpp:2059 and 2175.
export const STACK_LENIENCE = 3
export const STACK_OFFSET_MULTIPLIER = 0.05

export interface StackOptions {
  readonly approachRate?: number
  readonly stackLeniency?: number
  readonly hardRock?: boolean
}

/** Port of OsuBeatmapStandard::calculateStacks() (lines 2045-2194). */
export function calculateStackIndices(
  objects: readonly GameplayObject[],
  fileVersion: number,
  approachRate: number,
  stackLeniency: number,
): number[] {
  const stacks = objects.map(() => 0)
  const stackWindow = approachTimeMS(approachRate) * stackLeniency

  if (fileVersion > 5) {
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      let objectI = objects[i]!
      if (stacks[i] !== 0 || objectI.kind === 'spinner') continue
      if (objectI.kind === 'circle') {
        let currentIndex = i
        for (let n = i - 1; n >= 0; n -= 1) {
          const objectN = objects[n]!
          if (objectN.kind === 'spinner') continue
          if (objectI.time - stackWindow > objectEndTime(objectN)) break
          if (objectN.kind === 'slider' && near(objectEndPosition(objectN), objectI.position)) {
            const offset = stacks[currentIndex]! - stacks[n]! + 1
            for (let j = n + 1; j <= i; j += 1) {
              if (near(objectEndPosition(objectN), objects[j]!.position)) stacks[j]! -= offset
            }
            break
          }
          if (near(objectN.position, objectI.position)) {
            stacks[n] = stacks[currentIndex]! + 1
            currentIndex = n
            objectI = objectN
          }
        }
      } else {
        let currentIndex = i
        for (let n = i - 1; n >= 0; n -= 1) {
          const objectN = objects[n]!
          if (objectN.kind === 'spinner') continue
          if (objectI.time - stackWindow > objectN.time) break
          if (near(objectEndPosition(objectN), objectI.position)) {
            stacks[n] = stacks[currentIndex]! + 1
            currentIndex = n
            objectI = objectN
          }
        }
      }
    }
  } else {
    for (let i = 0; i < objects.length; i += 1) {
      const objectI = objects[i]!
      if (stacks[i] !== 0 && objectI.kind !== 'slider') continue
      let startTime = objectEndTime(objectI)
      let sliderStack = 0
      for (let j = i + 1; j < objects.length; j += 1) {
        const objectJ = objects[j]!
        if (objectJ.time - stackWindow > startTime) break
        if (near(objectJ.position, objectI.position)) {
          stacks[i]! += 1
          startTime = objectEndTime(objectJ)
        } else if (near(objectJ.position, objectEndPosition(objectI))) {
          sliderStack += 1
          stacks[j] = -sliderStack
          startTime = objectEndTime(objectJ)
        }
      }
    }
  }
  return stacks
}

/** Applies McOsu's raw-diameter*0.05 stack displacement and the HR Y transform. */
export function applyStacking(beatmap: GameplayBeatmap, options: StackOptions = {}): GameplayBeatmap {
  const approachRate = options.approachRate ?? beatmap.approachRate
  const configuredAR = osuStackingArOverride.getFloat()
  const stackAR = configuredAR >= 0 ? configuredAR : approachRate
  const configuredLeniency = osuStackingLeniencyOverride.getFloat()
  const leniency = configuredLeniency >= 0
    ? configuredLeniency
    : (options.stackLeniency ?? beatmap.stackLeniency)
  const stacks = osuStacking.getBool()
    ? calculateStackIndices(beatmap.objects, beatmap.fileVersion, stackAR, leniency)
    : beatmap.objects.map(() => 0)
  const stackOffset = rawCircleRadius(beatmap.circleSize) * 2 * STACK_OFFSET_MULTIPLIER
  const objects = beatmap.objects.map((object, index) => transformObject(
    object,
    stacks[index]! * stackOffset,
    options.hardRock === true,
  ))
  return {
    ...beatmap,
    objects,
    circles: objects.filter((object) => object.kind === 'circle'),
    sliders: objects.filter((object) => object.kind === 'slider'),
    spinners: objects.filter((object) => object.kind === 'spinner'),
  }
}

function transformObject(object: GameplayObject, offset: number, hardRock: boolean): GameplayObject {
  const position = transformPoint(object.position, offset, hardRock)
  if (object.kind === 'circle') return { ...object, position }
  if (object.kind === 'spinner') return { ...object, position }
  const absoluteControlPoints = object.absoluteControlPoints.map((point) => transformPoint(point, offset, hardRock))
  const controlPoints: GameplaySliderControlPoint[] = absoluteControlPoints.map((point, index) => ({
    x: point.x - position.x,
    y: point.y - position.y,
    type: object.controlPoints[index]?.type ?? null,
  }))
  return { ...object, position, absoluteControlPoints, controlPoints } satisfies GameplaySlider
}

function transformPoint(point: GameplayPoint, offset: number, hardRock: boolean): GameplayPoint {
  return { x: point.x - offset, y: (hardRock ? 384 - point.y : point.y) - offset }
}

function objectEndTime(object: GameplayObject): number {
  return object.kind === 'circle' ? object.time : object.endTime
}

function objectEndPosition(object: GameplayObject): GameplayPoint {
  if (object.kind !== 'slider') return object.position
  return object.absoluteControlPoints.at(-1) ?? object.position
}

function near(left: GameplayPoint, right: GameplayPoint): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) < STACK_LENIENCE
}
