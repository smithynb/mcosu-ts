import type { GameplayBeatmap, GameplayObject } from '../data/GameplayLoader.ts'
import type { GameplayEvent } from './GameplaySession.ts'
import { approachTimeMS, spinnerSpinsPerSecond } from './GameRules.ts'
import type { GameplayMods } from './Mods.ts'
import {
  osuDrainKill,
  osuDrainStableBreakBefore,
  osuDrainStableBreakBeforeOld,
  osuDrainStableBreakAfter,
  osuDrainStableHpBarMaximum,
  osuDrainStablePassiveFail,
  osuDrainStableSpinnerNerf,
  osuDrainType,
} from './ConVars.ts'

export type HealthHit = '300' | '100' | '50' | 'miss' | 'sliderBreak' | 'slider10' |
  'slider30' | 'spinnerSpin' | 'spinnerBonus' | 'mu' | 'katu' | 'geki'

export interface StableDrainParameters {
  readonly drainPerSecond: number
  readonly normalMultiplier: number
  readonly comboEndMultiplier: number
}

export interface HealthSnapshot {
  readonly health: number
  readonly failed: boolean
  readonly countGeki: number
  readonly countKatu: number
}

/** OsuScore.cpp:415-531, stable drain branch. Result is normalized HP [0,1]. */
export function healthIncrease(
  hit: HealthHit,
  hp: number,
  normalMultiplier = 1,
  comboEndMultiplier = 1,
): number {
  const maximum = osuDrainStableHpBarMaximum.getFloat()
  const normal = normalMultiplier
  const combo = comboEndMultiplier
  let amount: number
  switch (hit) {
    case 'miss': amount = mapDifficulty(hp, -6, -25, -40); break
    case '50': amount = normal * mapDifficulty(hp, 3.2, 0.4, 0.4); break
    case '100': amount = normal * mapDifficulty(hp, 17.6, 2.2, 2.2); break
    case '300': amount = normal * 6; break
    case 'sliderBreak': amount = mapDifficulty(hp, -4, -15, -28); break
    case 'mu': amount = combo * 6; break
    case 'katu': amount = combo * 10; break
    case 'geki': amount = combo * 14; break
    case 'slider10': amount = normal * 3; break
    case 'slider30': amount = normal * 4; break
    case 'spinnerSpin': amount = normal * 1.7; break
    case 'spinnerBonus': amount = normal * 2; break
  }
  return amount / maximum
}

/** OsuBeatmapStandard.cpp:2197-2425 corrected osu!stable calibration loop. */
export function calculateStableDrain(beatmap: GameplayBeatmap): StableDrainParameters {
  const maximum = osuDrainStableHpBarMaximum.getFloat()
  if (beatmap.objects.length === 0 || maximum <= 0) return { drainPerSecond: 0, normalMultiplier: 1, comboEndMultiplier: 1 }
  const hp = beatmap.drainRate
  const lowestEver = mapDifficulty(hp, 195, 160, 60)
  const lowestCombo = mapDifficulty(hp, 198, 170, 80)
  const lowestEnd = mapDifficulty(hp, 198, 180, 80)
  const recoveryAvailable = mapDifficulty(hp, 8, 4, 0)
  let drop = 0.05
  let normal = 1
  let combo = 1
  let iterations = 0

  while (iterations++ < 10_000) {
    let health = maximum
    let uncapped = maximum
    let lowest = health
    let lastTime = beatmap.objects[0]!.time - approachTimeMS(beatmap.approachRate)
    let comboTooLow = 0
    let failed = false

    const add = (amount: number) => {
      uncapped = Math.max(0, uncapped + amount)
      health = clamp(health + amount, 0, maximum)
    }
    for (let index = 0; index < beatmap.objects.length; index += 1) {
      const object = beatmap.objects[index]!
      const breakTime = calibrationBreakTime(beatmap, lastTime, object.time)
      add(-drop * Math.max(0, object.time - lastTime - breakTime))
      lastTime = objectEndTime(object)
      lowest = Math.min(lowest, health)
      if (health <= lowestEver) {
        failed = true
        drop *= 0.96
        break
      }

      const longDrop = drop * Math.max(0, objectEndTime(object) - object.time)
      const maxLongDrop = Math.max(0, longDrop - health)
      add(-longDrop)
      if (object.kind === 'slider') {
        add(healthIncrease('slider30', hp, normal, combo) * maximum)
        const ticks = object.tickPercentages.length * object.spans
        for (let i = 0; i < ticks; i += 1) add(healthIncrease('slider10', hp, normal, combo) * maximum)
        for (let i = 0; i < object.spans - 1; i += 1) add(healthIncrease('slider30', hp, normal, combo) * maximum)
        add(healthIncrease('slider30', hp, normal, combo) * maximum)
      } else if (object.kind === 'spinner') {
        const rotations = Math.trunc(((object.endTime - object.time) / 1000) * spinnerSpinsPerSecond(beatmap.overallDifficulty))
        for (let i = 0; i < rotations; i += 1) add(healthIncrease('spinnerSpin', hp, normal, combo) * maximum)
      }
      if (maxLongDrop > 0 && health - maxLongDrop <= lowestEver) {
        failed = true
        drop *= 0.96
        break
      }
      add(healthIncrease('300', hp, normal, combo) * maximum)
      if (isComboEnd(beatmap.objects, index)) {
        add(healthIncrease('geki', hp, normal, combo) * maximum)
        if (health < lowestCombo && ++comboTooLow > 2) {
          combo *= 1.07
          normal *= 1.03
          failed = true
          break
        }
      }
    }
    if (!failed && health < lowestEnd) {
      failed = true
      drop *= 0.94
      combo *= 1.01
      normal *= 1.01
    }
    const recovery = (uncapped - maximum) / beatmap.objects.length
    if (!failed && recovery < recoveryAvailable) {
      failed = true
      drop *= 0.96
      combo *= 1.02
      normal *= 1.01
    }
    if (!failed) return { drainPerSecond: (drop / maximum) * 1000, normalMultiplier: normal, comboEndMultiplier: combo }
  }
  throw new Error('Stable HP calibration did not converge.')
}

export class HealthSystem {
  readonly #beatmap: GameplayBeatmap
  readonly #parameters: StableDrainParameters
  readonly #noFail: boolean
  readonly #drainBreaks: readonly { startTime: number; endTime: number }[]
  #health = 1
  #failed = false
  #lastPosition = Number.NaN
  #comboMask = 0
  #countGeki = 0
  #countKatu = 0

  constructor(beatmap: GameplayBeatmap, options: {
    mods?: Partial<GameplayMods>
    relax?: boolean
    parameters?: StableDrainParameters
  } = {}) {
    this.#beatmap = beatmap
    this.#parameters = options.parameters ?? (osuDrainType.getInt() === 2
      ? calculateStableDrain(beatmap)
      : { drainPerSecond: 0, normalMultiplier: 1, comboEndMultiplier: 1 })
    this.#noFail = options.mods?.NF === true || options.mods?.Auto === true || options.relax === true
    this.#drainBreaks = runtimeDrainBreaks(beatmap)
  }

  update(positionMS: number, events: readonly GameplayEvent[], _speedMultiplier = 1): HealthSnapshot {
    if (this.#failed) return this.snapshot()
    if (Number.isFinite(this.#lastPosition) && positionMS > this.#lastPosition) {
      const activeMS = drainWeightedDuration(this.#beatmap, this.#drainBreaks, this.#lastPosition, positionMS)
      // positionMS is already the speed-scaled music timeline; this is the
      // same effective delta as McOsu's frameTime * speedMultiplier.
      this.#apply(-this.#parameters.drainPerSecond * (activeMS / 1000), false)
    }
    this.#lastPosition = positionMS
    for (const event of events) {
      this.#applyEvent(event)
      if (this.#failed) break
    }
    return this.snapshot()
  }

  snapshot(): HealthSnapshot {
    return { health: this.#health, failed: this.#failed, countGeki: this.#countGeki, countKatu: this.#countKatu }
  }

  #applyEvent(event: GameplayEvent): void {
    if (event.type === 'spinner-rotation') {
      this.#applyGain(event.bonus ? 'spinnerBonus' : 'spinnerSpin')
      return
    }
    if (event.type === 'slider-element') {
      this.#applyGain(event.successful ? (event.element === 'tick' ? 'slider10' : 'slider30') : 'sliderBreak')
      return
    }
    this.#applyGain(event.result)
    if (event.result === 'miss' || event.result === '50') this.#comboMask |= 2
    else if (event.result === '100') this.#comboMask |= 1
    if (isComboEnd(this.#beatmap.objects, event.objectIndex)) {
      if (this.#comboMask === 0) {
        this.#countGeki += 1
        this.#applyGain('geki')
      } else if ((this.#comboMask & 2) === 0 && event.result !== 'miss') {
        this.#countKatu += 1
        this.#applyGain('katu')
      } else if (event.result !== 'miss') this.#applyGain('mu')
      this.#comboMask = 0
    }
  }

  #applyGain(hit: HealthHit): void {
    this.#apply(healthIncrease(hit, this.#beatmap.drainRate, this.#parameters.normalMultiplier, this.#parameters.comboEndMultiplier), true)
  }

  #apply(amount: number, fromHit: boolean): void {
    this.#health = clamp(this.#health + amount, 0, 1)
    if (this.#health <= 0 && !this.#noFail && osuDrainKill.getBool() && (fromHit || osuDrainStablePassiveFail.getBool())) {
      this.#failed = true
      this.#health = 0
    }
  }
}

/** Linear fail timeline from OsuBeatmap.cpp:1638-1665 (`osu_fail_time`). */
export class FailAnimation {
  readonly durationMS: number
  #startedAt: number | null = null

  constructor(durationMS: number) {
    this.durationMS = Math.max(0, durationMS)
  }

  start(nowMS: number): void {
    if (this.#startedAt === null) this.#startedAt = nowMS
  }

  progress(nowMS: number): number {
    if (this.#startedAt === null) return 0
    if (this.durationMS === 0) return 1
    return clamp((nowMS - this.#startedAt) / this.durationMS, 0, 1)
  }

  get active(): boolean { return this.#startedAt !== null }
}

function drainWeightedDuration(
  beatmap: GameplayBeatmap,
  breaks: readonly { startTime: number; endTime: number }[],
  start: number,
  end: number,
): number {
  if (beatmap.objects.length === 0) return 0
  const first = beatmap.objects[0]!.time
  const last = objectEndTime(beatmap.objects.at(-1)!)
  let segments: Array<[number, number]> = [[Math.max(start, first), Math.min(end, last)]]
  for (const event of breaks) segments = subtract(segments, event.startTime, event.endTime)
  let total = 0
  for (const [left, right] of segments) {
    if (right <= left) continue
    let weighted = right - left
    for (const spinner of beatmap.spinners) {
      const overlap = Math.max(0, Math.min(right, spinner.endTime) - Math.max(left, spinner.time))
      weighted -= overlap * (1 - osuDrainStableSpinnerNerf.getFloat())
    }
    total += weighted
  }
  return total
}

function runtimeDrainBreaks(beatmap: GameplayBeatmap): readonly { startTime: number; endTime: number }[] {
  return (beatmap.breaks ?? []).map((event) => {
    // OsuBeatmap.cpp:1062-1084 suppresses the entire between-object interval
    // around a break unless the corresponding edge ConVar opts back into drain.
    let previous: GameplayObject | undefined
    let next: GameplayObject | undefined
    for (const object of beatmap.objects) {
      if (objectEndTime(object) <= event.startTime) previous = object
      if (next === undefined && object.time >= event.endTime) next = object
    }
    const beforeEnabled = beatmap.fileVersion < 8
      ? osuDrainStableBreakBeforeOld.getBool()
      : osuDrainStableBreakBefore.getBool()
    return {
      startTime: beforeEnabled ? event.startTime : previous === undefined ? event.startTime : objectEndTime(previous),
      endTime: osuDrainStableBreakAfter.getBool() ? event.endTime : next?.time ?? event.endTime,
    }
  })
}

function subtract(segments: Array<[number, number]>, start: number, end: number): Array<[number, number]> {
  return segments.flatMap(([left, right]) => {
    if (end <= left || start >= right) return [[left, right]] as Array<[number, number]>
    const result: Array<[number, number]> = []
    if (start > left) result.push([left, Math.min(start, right)])
    if (end < right) result.push([Math.max(end, left), right])
    return result
  })
}

function calibrationBreakTime(beatmap: GameplayBeatmap, lastTime: number, objectTime: number): number {
  for (const event of beatmap.breaks ?? []) {
    if (event.startTime < lastTime || event.endTime > objectTime) continue
    if (beatmap.fileVersion < 8 && osuDrainStableBreakBeforeOld.getBool()) return event.endTime - event.startTime
    if (osuDrainStableBreakBefore.getBool()) return event.endTime - event.startTime
    return event.endTime - lastTime
  }
  return 0
}

function isComboEnd(objects: readonly GameplayObject[], index: number): boolean {
  return index === objects.length - 1 || objects[index + 1]?.newCombo === true
}

function objectEndTime(object: GameplayObject): number {
  return object.kind === 'circle' ? object.time : object.endTime
}

function mapDifficulty(value: number, minimum: number, middle: number, maximum: number): number {
  return value > 5 ? middle + (maximum - middle) * ((value - 5) / 5) : middle - (middle - minimum) * ((5 - value) / 5)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
