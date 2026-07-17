import { hitWindowsMS, rawCircleRadius, spinnerRequiredRotations, type Point } from './GameRules.ts'
import { createSliderCurve, type SliderCurve } from './SliderCurves.ts'
import { Score, type HitResult, type ScoreSnapshot } from './Score.ts'
import type { GameplayBeatmap, GameplayObject, GameplaySlider } from '../data/GameplayLoader.ts'
import type { ModdedGameplayBeatmap } from './Mods.ts'
import {
  osuNoteBlocking,
  osuNotelockStableTolerance2B,
  osuNotelockType,
  osuSliderEndInsideCheckOffset,
  osuSliderFollowCircleSizeMultiplier,
} from './ConVars.ts'


export interface GameplayClick {
  readonly musicTime: number
  readonly position: Point
  readonly input?: string
}

export interface GameplayFrameInput {
  readonly position: Point
  readonly held: boolean
  readonly heldInputs?: readonly string[]
  readonly clicks: readonly GameplayClick[]
}

export interface JudgmentEvent {
  readonly type: 'judgment'
  readonly objectIndex: number
  readonly result: HitResult
  readonly delta: number
  readonly position: Point
}

export interface SliderElementEvent {
  readonly type: 'slider-element'
  readonly objectIndex: number
  readonly element: 'head' | 'tick' | 'repeat' | 'tail'
  readonly successful: boolean
  readonly position: Point
  readonly sampleIndex: number
}

export interface SpinnerRotationEvent {
  readonly type: 'spinner-rotation'
  readonly objectIndex: number
  readonly bonus: boolean
  readonly position: Point
}

export type GameplayEvent = JudgmentEvent | SliderElementEvent | SpinnerRotationEvent

export interface GameplaySnapshot {
  readonly score: ScoreSnapshot
  readonly finished: boolean
  readonly objectResults: readonly (HitResult | null)[]
  readonly events: readonly GameplayEvent[]
}

interface CircleState {
  readonly kind: 'circle'
  result: HitResult | null
}

interface SliderElement {
  readonly time: number
  readonly type: 'tick' | 'repeat'
  readonly progress: number
  readonly sampleIndex: number
  finished: boolean
  successful: boolean
}

interface SliderState {
  readonly kind: 'slider'
  readonly curve: SliderCurve
  readonly elements: SliderElement[]
  headResult: HitResult | null
  result: HitResult | null
  cursorLeft: boolean
  heldAtTailCheck: boolean
  tailCheckFinished: boolean
  downChannel: 0 | 1 | 2
}

interface SpinnerState {
  readonly kind: 'spinner'
  result: HitResult | null
  lastAngle: number
  rotations: number
  wholeRotations: number
  readonly storedDeltaAngles: number[]
  deltaAngleIndex: number
  sumDeltaAngle: number
}

type ObjectState = CircleState | SliderState | SpinnerState

export class GameplaySession {
  readonly #beatmap: GameplayBeatmap
  readonly #states: ObjectState[]
  readonly #score: Score
  readonly #radius: number
  readonly #autoplay: boolean
  #speedMultiplier: number
  #previousPositionMS = Number.NEGATIVE_INFINITY
  #events: GameplayEvent[] = []

  constructor(beatmap: GameplayBeatmap, options: { autoplay?: boolean; speedMultiplier?: number } = {}) {
    this.#beatmap = beatmap
    this.#autoplay = (options.autoplay ?? false) || (beatmap as Partial<ModdedGameplayBeatmap>).mods?.Auto === true
    this.#speedMultiplier = options.speedMultiplier ?? 1
    this.#radius = rawCircleRadius(beatmap.circleSize)
    this.#score = new Score({
      circleSize: beatmap.circleSize,
      drainRate: beatmap.drainRate,
      overallDifficulty: beatmap.overallDifficulty,
      objectCount: beatmap.objects.length,
      playableLengthMS: beatmap.playableLengthMS,
      breakLengthMS: beatmap.breakLengthMS,
      modMultiplier: (beatmap as Partial<ModdedGameplayBeatmap>).scoreMultiplier,
    })
    this.#states = beatmap.objects.map((object) => this.#createState(object))
  }

  update(positionMS: number, input: GameplayFrameInput): GameplaySnapshot {
    this.#events = []
    const effective = this.#autoplay ? this.#autoplayInput(positionMS, input.position) : input
    const clicks = [...effective.clicks]
    let blockNextNotes = false

    for (let index = 0; index < this.#beatmap.objects.length; index += 1) {
      const object = this.#beatmap.objects[index]!
      const state = this.#states[index]!
      this.#updateObject(index, object, state, positionMS, effective)

      // OsuBeatmap.cpp:682-728, default osu!stable notelock. Spinners are
      // transparent; circles and unhit slider heads block later objects.
      const blocked = blockNextNotes
      if (osuNoteBlocking.getBool() && osuNotelockType.getInt() !== 0 && !this.#isFinished(state) && state.kind !== 'spinner') {
        blockNextNotes = true
        if (state.kind === 'slider' && object.kind === 'slider' && state.headResult !== null) {
          const next = this.#beatmap.objects[index + 1]
          if (next !== undefined && next.time <= object.endTime + osuNotelockStableTolerance2B.getInt()) {
            blockNextNotes = false
          }
        }
      }

      const sliderHeadBefore = state.kind === 'slider' ? state.headResult : null
      if (!blocked && clicks.length > 0) this.#consumeClick(index, object, state, clicks)
      if (state.kind === 'circle' && state.result !== null) blockNextNotes = false
      if (state.kind === 'slider' && object.kind === 'slider' && sliderHeadBefore === null && state.headResult !== null) {
        const next = this.#beatmap.objects[index + 1]
        if (next !== undefined && next.time <= object.endTime + osuNotelockStableTolerance2B.getInt()) {
          blockNextNotes = false
        }
      }
    }

    this.#previousPositionMS = positionMS
    return this.snapshot()
  }

  snapshot(): GameplaySnapshot {
    return {
      score: this.#score.snapshot(),
      finished: this.#states.every((state) => this.#isFinished(state)),
      objectResults: this.#states.map((state) => state.kind === 'slider' ? state.result : state.result),
      events: this.#events,
    }
  }

  setSpeedMultiplier(speedMultiplier: number): void {
    if (speedMultiplier > 0 && Number.isFinite(speedMultiplier)) this.#speedMultiplier = speedMultiplier
  }

  #createState(object: GameplayObject): ObjectState {
    if (object.kind === 'circle') return { kind: 'circle', result: null }
    if (object.kind === 'spinner') {
      const duration = object.endTime - object.time
      // OsuSpinner.cpp:38-47: 12 samples at <=2s, 48 at >=5s.
      const sampleCount = Math.trunc(clamp(((duration - 2_000) * 36) / 3_000 + 12, 12, 48))
      return {
        kind: 'spinner',
        result: null,
        lastAngle: 0,
        rotations: 0,
        wholeRotations: 0,
        storedDeltaAngles: Array.from({ length: sampleCount }, () => 0),
        deltaAngleIndex: 0,
        sumDeltaAngle: 0,
      }
    }
    const curve = createSliderCurve(object.curveType, object.absoluteControlPoints, object.pixelLength)
    return {
      kind: 'slider',
      curve,
      elements: createSliderElements(object),
      headResult: null,
      result: null,
      cursorLeft: true,
      heldAtTailCheck: false,
      tailCheckFinished: false,
      downChannel: 0,
    }
  }

  #updateObject(
    index: number,
    object: GameplayObject,
    state: ObjectState,
    positionMS: number,
    input: GameplayFrameInput,
  ): void {
    if (state.kind === 'circle' && object.kind === 'circle') {
      // OsuCircle.cpp:980-986: an untouched circle misses after hitwindow50.
      if (state.result === null && positionMS - object.time > this.#windows.hit50) {
        this.#finishJudgment(index, state, 'miss', positionMS - object.time, object.position)
      }
      return
    }
    if (state.kind === 'slider' && object.kind === 'slider') {
      this.#updateSlider(index, object, state, positionMS, input)
      return
    }
    if (state.kind === 'spinner' && object.kind === 'spinner') {
      this.#updateSpinner(index, object, state, positionMS, input)
    }
  }

  #consumeClick(index: number, object: GameplayObject, state: ObjectState, clicks: GameplayClick[]): void {
    const click = clicks[0]
    if (click === undefined || state.kind === 'spinner') return
    if (state.kind === 'circle' && object.kind === 'circle' && state.result === null) {
      if (distance(click.position, object.position) >= this.#radius) return
      const delta = click.musicTime - object.time
      const result = judgeDelta(delta, this.#windows)
      if (result === null) return
      clicks.shift()
      this.#finishJudgment(index, state, result, delta, object.position)
      return
    }
    if (state.kind === 'slider' && object.kind === 'slider' && state.headResult === null) {
      const head = state.curve.getPointAt(0)
      if (distance(click.position, head) >= this.#radius) return
      const delta = click.musicTime - object.time
      const result = judgeDelta(delta, this.#windows)
      if (result === null) return
      clicks.shift()
      state.headResult = result
      state.downChannel = inputChannel(click.input)
      const successful = result !== 'miss'
      this.#score.addSliderElement(30, successful)
      this.#events.push({ type: 'slider-element', objectIndex: index, element: 'head', successful, position: head, sampleIndex: 0 })
    }
  }

  get #windows(): ReturnType<typeof hitWindowsMS> {
    return hitWindowsMS(this.#beatmap.overallDifficulty)
  }

  #updateSlider(
    index: number,
    slider: GameplaySlider,
    state: SliderState,
    positionMS: number,
    input: GameplayFrameInput,
  ): void {
    if (state.result !== null) return
    if (state.headResult === null && positionMS - slider.time > this.#windows.hit50) {
      state.headResult = 'miss'
      this.#score.addSliderElement(30, false)
      this.#events.push({ type: 'slider-element', objectIndex: index, element: 'head', successful: false, position: slider.position, sampleIndex: 0 })
    }

    const heldChannels = new Set((input.heldInputs ?? []).map(inputChannel).filter((channel) => channel > 0))
    // OsuSlider.cpp:1502-1507, 2328-2335: preserve the starting key only
    // while the opposite key remains held; after it is released, any key counts.
    if ((state.downChannel === 2 && !heldChannels.has(1)) || (state.downChannel === 1 && !heldChannels.has(2))) {
      state.downChannel = 0
    }
    const clickHeld = state.downChannel === 0 ? input.held : heldChannels.has(state.downChannel)
    const progress = sliderProgress(slider, positionMS)
    const ball = state.curve.getPointAt(progress)
    // OsuSlider.cpp:1509-1514 and OsuGameRules.cpp:35. Re-enter within one
    // circle radius; once retained, the follow radius is 2.4 circle radii.
    const followRadius = state.cursorLeft ? this.#radius : this.#radius * osuSliderFollowCircleSizeMultiplier.getFloat()
    const cursorInside = distance(input.position, ball) < followRadius
    state.cursorLeft = !cursorInside
    const tracking = clickHeld && cursorInside

    const tailCheckTime = Math.max(
      slider.time + (slider.endTime - slider.time) / 2,
      slider.endTime - osuSliderEndInsideCheckOffset.getInt(),
    )
    // OsuSlider.cpp:1636-1665: latch the first frame at/after the check time.
    if (!state.tailCheckFinished && positionMS >= tailCheckTime) {
      state.tailCheckFinished = true
      state.heldAtTailCheck = tracking
    }

    for (const element of state.elements) {
      if (element.finished || positionMS < element.time) continue
      element.finished = true
      element.successful = tracking
      const position = state.curve.getPointAt(element.progress)
      this.#score.addSliderElement(element.type === 'tick' ? 10 : 30, element.successful)
      this.#events.push({
        type: 'slider-element',
        objectIndex: index,
        element: element.type,
        successful: element.successful,
        position,
        sampleIndex: element.sampleIndex,
      })
    }

    if (positionMS < slider.endTime) return
    if (state.headResult === null) {
      state.headResult = 'miss'
      this.#score.addSliderElement(30, false)
    }
    const successfulParts = Number(state.headResult !== 'miss') + Number(state.heldAtTailCheck) +
      state.elements.filter((element) => element.successful).length
    const totalParts = 2 + state.elements.length
    const completion = successfulParts / totalParts
    const result: HitResult = completion >= 0.999 ? '300' : completion >= 0.5 ? '100' : completion > 0 ? '50' : 'miss'
    state.result = result
    this.#score.addJudgment(result, { increaseCombo: state.heldAtTailCheck })
    const tail = state.curve.getPointAt(slider.spans % 2 === 0 ? 0 : 1)
    this.#events.push({ type: 'slider-element', objectIndex: index, element: 'tail', successful: state.heldAtTailCheck, position: tail, sampleIndex: slider.spans })
    this.#events.push({ type: 'judgment', objectIndex: index, result, delta: 0, position: tail })
  }

  #updateSpinner(
    index: number,
    spinner: Extract<GameplayObject, { kind: 'spinner' }>,
    state: SpinnerState,
    positionMS: number,
    input: GameplayFrameInput,
  ): void {
    if (state.result !== null) return
    const angle = Math.atan2(input.position.y - spinner.position.y, input.position.x - spinner.position.x)
    let delta = angle - state.lastAngle
    if (Math.abs(delta) > 0.001) state.lastAngle = angle
    else delta = 0
    if (delta < -Math.PI) delta += Math.PI * 2
    else if (delta > Math.PI) delta -= Math.PI * 2

    if (positionMS >= spinner.time && positionMS < spinner.endTime) {
      const storedDelta = input.held ? delta : 0
      state.sumDeltaAngle -= state.storedDeltaAngles[state.deltaAngleIndex]!
      state.sumDeltaAngle += storedDelta
      state.storedDeltaAngles[state.deltaAngleIndex] = storedDelta
      state.deltaAngleIndex = (state.deltaAngleIndex + 1) % state.storedDeltaAngles.length
      // OsuSpinner.cpp:385-407: rotations use the moving-window average,
      // not the raw per-frame cursor angle.
      const rotationAngle = state.sumDeltaAngle / state.storedDeltaAngles.length
      const previousWhole = Math.floor(state.rotations)
      state.rotations += Math.abs(rotationAngle) / (Math.PI * 2)
      const newWhole = Math.floor(state.rotations)
      const required = spinnerRequiredRotations(
        this.#beatmap.overallDifficulty,
        spinner.endTime - spinner.time,
        this.#speedMultiplier,
      )
      for (let rotation = previousWhole + 1; rotation <= newWhole; rotation += 1) {
        const bonus = rotation > Math.trunc(required) + 1
        this.#score.addSpinnerRotation(bonus)
        this.#events.push({ type: 'spinner-rotation', objectIndex: index, bonus, position: spinner.position })
      }
      state.wholeRotations = newWhole
    }
    if (positionMS < spinner.endTime) return
    const required = spinnerRequiredRotations(this.#beatmap.overallDifficulty, spinner.endTime - spinner.time, this.#speedMultiplier)
    const ratio = required <= 0 ? 1 : state.rotations / required
    const result: HitResult = ratio >= 1 ? '300' : ratio >= 0.9 ? '100' : ratio >= 0.75 ? '50' : 'miss'
    state.result = result
    this.#score.addJudgment(result)
    this.#events.push({ type: 'judgment', objectIndex: index, result, delta: 0, position: spinner.position })
  }

  #finishJudgment(index: number, state: CircleState, result: HitResult, delta: number, position: Point): void {
    state.result = result
    this.#score.addJudgment(result)
    this.#events.push({ type: 'judgment', objectIndex: index, result, delta, position })
  }

  #autoplayInput(positionMS: number, fallback: Point): GameplayFrameInput {
    const clicks: GameplayClick[] = []
    let position = fallback
    let held = false
    for (let index = 0; index < this.#beatmap.objects.length; index += 1) {
      const object = this.#beatmap.objects[index]!
      const state = this.#states[index]!
      if (object.kind === 'circle' && state.kind === 'circle' && state.result === null && crossed(this.#previousPositionMS, positionMS, object.time)) {
        clicks.push({ musicTime: object.time, position: object.position })
        position = object.position
      } else if (object.kind === 'slider' && state.kind === 'slider') {
        if (state.headResult === null && crossed(this.#previousPositionMS, positionMS, object.time)) {
          clicks.push({ musicTime: object.time, position: object.position })
        }
        if (positionMS >= object.time && positionMS <= object.endTime) {
          held = true
          position = state.curve.getPointAt(sliderProgress(object, positionMS))
        }
      } else if (object.kind === 'spinner' && state.kind === 'spinner' && positionMS >= object.time && positionMS <= object.endTime) {
        held = true
        // OsuSpinner.cpp:314-325 AUTO_MULTIPLIER = 1/20 radians per ms.
        const angle = positionMS * 0.05
        position = { x: object.position.x + Math.cos(angle) * 100, y: object.position.y + Math.sin(angle) * 100 }
      }
    }
    return { position, held, clicks }
  }

  #isFinished(state: ObjectState): boolean {
    return state.result !== null
  }
}

function createSliderElements(slider: GameplaySlider): SliderElement[] {
  const result: SliderElement[] = []
  for (let span = 0; span < slider.spans; span += 1) {
    const spanStart = slider.time + span * slider.spanDuration
    for (const percentage of slider.tickPercentages) {
      result.push({
        time: spanStart + percentage * slider.spanDuration,
        type: 'tick',
        progress: span % 2 === 0 ? percentage : 1 - percentage,
        sampleIndex: span,
        finished: false,
        successful: false,
      })
    }
    if (span < slider.spans - 1) {
      result.push({
        time: spanStart + slider.spanDuration,
        type: 'repeat',
        progress: span % 2 === 0 ? 1 : 0,
        sampleIndex: span + 1,
        finished: false,
        successful: false,
      })
    }
  }
  return result.sort((left, right) => left.time - right.time)
}

function judgeDelta(delta: number, windows: ReturnType<typeof hitWindowsMS>): HitResult | null {
  const absolute = Math.abs(delta)
  if (absolute <= windows.hit300) return '300'
  if (absolute <= windows.hit100) return '100'
  if (absolute <= windows.hit50) return '50'
  if (absolute <= windows.miss) return 'miss'
  return null
}

function sliderProgress(slider: GameplaySlider, positionMS: number): number {
  const total = clamp((positionMS - slider.time) / Math.max(1, slider.endTime - slider.time), 0, 1)
  const spanFloat = total * slider.spans
  const span = Math.min(slider.spans - 1, Math.floor(spanFloat))
  const local = spanFloat - span
  return span % 2 === 0 ? local : 1 - local
}

function crossed(previous: number, current: number, target: number): boolean {
  return previous < target && current >= target
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function inputChannel(input: string | undefined): 0 | 1 | 2 {
  if (input === 'KeyZ' || input === 'MouseLeft') return 1
  if (input === 'KeyX' || input === 'MouseRight') return 2
  return 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
