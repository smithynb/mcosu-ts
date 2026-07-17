import { HitType, type PathType } from 'osu-classes'
import { BeatmapDecoder, SlidableObject, SpinnableObject } from 'osu-parsers'
import type { BeatmapEntry } from './OsuDatabase.ts'
import type { OsuFileSystem } from '../fs/osuFileSystem.ts'
import { relativeControlPointsToAbsolute } from '../core/SliderCurves.ts'
import { generateSliderTickPercentages } from '../core/SliderTicks.ts'

export interface GameplayPoint {
  readonly x: number
  readonly y: number
}

export interface GameplayCombo {
  readonly newCombo: boolean
  readonly comboOffset: number
  readonly comboColorOffset: number
  readonly comboNumber: number
  readonly comboIndex: number
  readonly comboColorIndex: number
}

interface GameplayObjectBase extends GameplayCombo {
  readonly time: number
  readonly position: GameplayPoint
  readonly hitSound: number
  readonly samples: readonly GameplaySample[]
}

export interface GameplaySample {
  readonly sampleSet: string
  readonly hitSound: string
  readonly customIndex: number
  readonly volume: number
  readonly filename: string
}

export interface GameplayCircle extends GameplayObjectBase {
  readonly kind: 'circle'
}

export interface GameplaySliderControlPoint extends GameplayPoint {
  /** Curve type starts a new path segment; null continues the preceding segment. */
  readonly type: PathType | null
}

export interface GameplaySlider extends GameplayObjectBase {
  readonly kind: 'slider'
  readonly endTime: number
  readonly repeats: number
  readonly spans: number
  readonly pixelLength: number
  readonly curveType: PathType
  /** osu-parsers exposes SliderPath control points relative to the slider head. */
  readonly controlPoints: readonly GameplaySliderControlPoint[]
  /** Absolute, truncated points expected by McOsu's curve constructors. */
  readonly absoluteControlPoints: readonly GameplayPoint[]
  readonly spanDuration: number
  readonly tickPercentages: readonly number[]
  readonly nodeSamples: readonly (readonly GameplaySample[])[]
}

export interface GameplaySpinner extends GameplayObjectBase {
  readonly kind: 'spinner'
  readonly endTime: number
}

export type GameplayObject = GameplayCircle | GameplaySlider | GameplaySpinner

export interface GameplayBeatmap {
  readonly fileVersion: number
  readonly approachRate: number
  readonly circleSize: number
  readonly overallDifficulty: number
  readonly drainRate: number
  readonly sliderMultiplier: number
  readonly sliderTickRate: number
  readonly playableLengthMS: number
  readonly breakLengthMS: number
  readonly circles: readonly GameplayCircle[]
  readonly sliders: readonly GameplaySlider[]
  readonly spinners: readonly GameplaySpinner[]
  readonly objects: readonly GameplayObject[]
}

export async function loadGameplayBeatmap(
  fileSystem: Pick<OsuFileSystem, 'getFile'>,
  entry: BeatmapEntry,
): Promise<GameplayBeatmap> {
  const file = await fileSystem.getFile(`Songs/${entry.osuPath}`)
  return parseGameplayBeatmap(await file.text())
}

export function parseGameplayBeatmap(text: string): GameplayBeatmap {
  const decoded = new BeatmapDecoder().decodeFromString(text, { parseStoryboard: false })
  if (decoded.originalMode !== 0 && decoded.mode !== 0) {
    throw new Error(`Only osu!standard beatmaps are supported (decoded mode ${decoded.mode}).`)
  }

  const circles: GameplayCircle[] = []
  const sliders: GameplaySlider[] = []
  const spinners: GameplaySpinner[] = []
  const objects: GameplayObject[] = []
  let comboNumber = 1
  let colorCounter = 1
  let colorOffset = 0
  let nonSpinnerCount = 0

  for (const object of decoded.hitObjects) {
    const comboData = object as typeof object & { isNewCombo?: unknown; comboOffset?: unknown }
    const newCombo = comboData.isNewCombo === true
    const comboOffset =
      typeof comboData.comboOffset === 'number' && Number.isFinite(comboData.comboOffset)
        ? comboData.comboOffset
        : 0
    const isSpinner = object instanceof SpinnableObject || (object.hitType & HitType.Spinner) !== 0
    if (!isSpinner) nonSpinnerCount += 1
    // OsuDatabaseBeatmap.cpp:367-376: spinners and the first non-spinner do not
    // advance the raw colour counter; combo skips accumulate separately.
    if (newCombo) {
      comboNumber = 1
      if (!isSpinner && nonSpinnerCount > 1) colorCounter += 1
      colorOffset += comboOffset
    }

    const base = {
      time: object.startTime,
      position: { x: object.startPosition.x, y: object.startPosition.y },
      hitSound: object.hitSound,
      samples: object.samples.map((sample) => toGameplaySample(sample, decoded.controlPoints.samplePointAt(object.startTime))),
      newCombo,
      comboOffset,
      comboColorOffset: colorOffset,
      comboNumber,
      comboIndex: colorCounter,
      comboColorIndex: colorCounter,
    }

    if (object instanceof SlidableObject || (object.hitType & HitType.Slider) !== 0) {
      const slider = object as SlidableObject
      const controlPoints = slider.path.controlPoints.map((point) => ({
        x: point.position.x,
        y: point.position.y,
        type: point.type,
      }))
      const absoluteControlPoints = relativeControlPointsToAbsolute(base.position, controlPoints)
      const timingPoint = decoded.controlPoints.timingPointAt(slider.startTime)
      const difficultyPoint = decoded.controlPoints.difficultyPointAt(slider.startTime)
      const gameplayObject: GameplaySlider = {
        ...base,
        kind: 'slider',
        endTime: slider.endTime,
        repeats: slider.repeats,
        spans: slider.spans,
        pixelLength: slider.path.expectedDistance,
        curveType: slider.path.curveType,
        controlPoints,
        absoluteControlPoints,
        spanDuration: slider.spanDuration,
        tickPercentages: generateSliderTickPercentages({
          beatmapVersion: decoded.fileFormat,
          pixelLength: slider.path.expectedDistance,
          sliderMultiplier: decoded.difficulty.sliderMultiplier,
          sliderTickRate: decoded.difficulty.sliderTickRate,
          velocity: slider.velocity,
          baseBeatLength: timingPoint.beatLengthUnlimited,
          generateTicks: difficultyPoint.generateTicks,
        }),
        nodeSamples: slider.nodeSamples.map((samples, nodeIndex) => {
          const nodeTime = slider.startTime + nodeIndex * slider.spanDuration
          const samplePoint = decoded.controlPoints.samplePointAt(nodeTime)
          return samples.map((sample) => toGameplaySample(sample, samplePoint))
        }),
      }
      sliders.push(gameplayObject)
      objects.push(gameplayObject)
      comboNumber += 1
    } else if (object instanceof SpinnableObject || (object.hitType & HitType.Spinner) !== 0) {
      const gameplayObject: GameplaySpinner = {
        ...base,
        kind: 'spinner',
        endTime: (object as SpinnableObject).endTime,
      }
      spinners.push(gameplayObject)
      objects.push(gameplayObject)
    } else if ((object.hitType & HitType.Normal) !== 0) {
      const gameplayObject: GameplayCircle = { ...base, kind: 'circle' }
      circles.push(gameplayObject)
      objects.push(gameplayObject)
      comboNumber += 1
    }
  }

  return {
    fileVersion: decoded.fileFormat,
    approachRate: decoded.difficulty.approachRate,
    circleSize: decoded.difficulty.circleSize,
    overallDifficulty: decoded.difficulty.overallDifficulty,
    drainRate: decoded.difficulty.drainRate,
    sliderMultiplier: decoded.difficulty.sliderMultiplier,
    sliderTickRate: decoded.difficulty.sliderTickRate,
    // OsuBeatmap.cpp:1794-1799 defines playable length from first object start
    // through the final object's end; OsuScore.cpp subtracts break duration.
    playableLengthMS: objects.length === 0
      ? 0
      : objectEndTime(objects.at(-1)!) - objects[0]!.time,
    breakLengthMS: decoded.events.breaks.reduce((total, event) => total + event.duration, 0),
    circles,
    sliders,
    spinners,
    objects,
  }
}

function objectEndTime(object: GameplayObject): number {
  return object.kind === 'circle' ? object.time : object.endTime
}

function toGameplaySample(sample: {
  sampleSet: string
  hitSound: string
  customIndex: number
  volume: number
  filename: string
}, fallback: { sampleSet: string; customIndex: number; volume: number }): GameplaySample {
  return {
    sampleSet: (sample.sampleSet.toLowerCase() === 'none' ? fallback.sampleSet : sample.sampleSet).toLowerCase(),
    hitSound: sample.hitSound.toLowerCase(),
    customIndex: sample.customIndex > 0 ? sample.customIndex : fallback.customIndex,
    volume: sample.volume > 0 ? sample.volume : fallback.volume,
    filename: sample.filename,
  }
}
