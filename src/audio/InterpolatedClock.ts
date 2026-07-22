export interface AudioClockSource {
  getPositionMS(): number
  getLengthMS(): number
  isPlaying(): boolean
  getSpeed(): number
}

export type ClockTimeSource = () => number

const defaultNow: ClockTimeSource = () => performance.now()

/** Faithful non-SDL port of `OsuBeatmap::getMusicPositionMSInterpolated()`. */
export class InterpolatedClock {
  readonly #source: AudioClockSource
  readonly #now: ClockTimeSource
  #interpolatedPosition: number
  #lastAccurateAudioTime: number
  #lastRealTime: number
  #wasSeekFrame = false

  constructor(source: AudioClockSource, now: ClockTimeSource = defaultNow) {
    this.#source = source
    this.#now = now
    const initialTime = now()
    this.#interpolatedPosition = source.getPositionMS()
    this.#lastAccurateAudioTime = initialTime
    this.#lastRealTime = initialTime
  }

  markSeek(): void {
    this.#wasSeekFrame = true
  }

  reset(positionMS = this.#source.getPositionMS()): void {
    const realTime = this.#now()
    this.#interpolatedPosition = positionMS
    this.#lastAccurateAudioTime = realTime
    this.#lastRealTime = realTime
    this.#wasSeekFrame = false
  }

  update(isLoading = false): number {
    const rawPosition = this.#source.getPositionMS()
    const wasSeekFrame = this.#wasSeekFrame
    this.#wasSeekFrame = false

    const realTime = this.#now()
    // OsuBeatmap.cpp:2352-2353 bypasses all interpolation while loading.
    // Synchronize state too, so toggling the ConVar cannot create a stale jump.
    if (isLoading || !osuInterpolateMusicPos.getBool()) {
      this.#interpolatedPosition = rawPosition
      this.#lastAccurateAudioTime = realTime
      this.#lastRealTime = realTime
      return rawPosition
    }

    const speed = this.#source.getSpeed()

    // OsuBeatmap.cpp:2360-2376, non-SDL path: multiplier 1.0, a 1500 ms
    // accurate-set window, and 11/33 ms error limits.
    const interpolationMultiplier = 1.0
    const interpolationDelta = (realTime - this.#lastRealTime) * speed
    const interpolationDeltaLimit = (
      realTime - this.#lastAccurateAudioTime < 1_500 || speed < 1 ? 11 : 33
    ) * interpolationMultiplier

    let returnPosition: number
    if (this.#source.isPlaying() && !wasSeekFrame) {
      let newInterpolatedPosition = this.#interpolatedPosition + interpolationDelta
      let delta = newInterpolatedPosition - rawPosition

      // OsuBeatmap.cpp:2385-2405: ease by delta/8, snap beyond 2x the
      // limit, double undershoots, and halve overshoots.
      newInterpolatedPosition -= delta / 8 / interpolationMultiplier
      delta = newInterpolatedPosition - rawPosition

      if (Math.abs(delta) > interpolationDeltaLimit * 2) {
        this.#interpolatedPosition = rawPosition
      } else if (delta < -interpolationDeltaLimit) {
        this.#interpolatedPosition += interpolationDelta * 2
        this.#lastAccurateAudioTime = realTime
      } else if (delta < interpolationDeltaLimit) {
        this.#interpolatedPosition = newInterpolatedPosition
      } else {
        this.#interpolatedPosition += interpolationDelta / 2
        this.#lastAccurateAudioTime = realTime
      }

      returnPosition = Math.round(this.#interpolatedPosition)
    } else {
      // OsuBeatmap.cpp:2414-2419: seeks, pauses, and stopped audio snap and
      // establish a fresh accurate-audio timestamp.
      returnPosition = rawPosition
      this.#interpolatedPosition = returnPosition
      this.#lastAccurateAudioTime = realTime
    }

    // OsuBeatmap.cpp:2421 uses real time rather than frame time.
    this.#lastRealTime = realTime
    return Math.max(0, returnPosition)
  }
}

export const BeatmapClockState = {
  WAITING: 'WAITING',
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
  PAUSED: 'PAUSED',
} as const

export type BeatmapClockState = typeof BeatmapClockState[keyof typeof BeatmapClockState]

/** Virtual pre-song and post-song behavior from OsuBeatmap.cpp:467-566. */
export class BeatmapClock {
  readonly #source: AudioClockSource
  readonly #interpolated: InterpolatedClock
  readonly #now: ClockTimeSource
  #state: BeatmapClockState = BeatmapClockState.WAITING
  #waitUntil = 0
  #finishedAt = 0
  #finishedLength = 0
  #pausedFrom: Exclude<BeatmapClockState, 'PAUSED'> = BeatmapClockState.WAITING
  #pausedAt = 0
  #pausedPosition = 0

  constructor(
    source: AudioClockSource,
    interpolated: InterpolatedClock,
    now: ClockTimeSource = defaultNow,
  ) {
    this.#source = source
    this.#interpolated = interpolated
    this.#now = now
    this.#waitUntil = now()
  }

  get state(): BeatmapClockState {
    return this.#state
  }

  startWaiting(durationMS: number): void {
    this.#state = BeatmapClockState.WAITING
    this.#waitUntil = this.#now() + Math.max(0, durationMS)
  }

  startPlaying(): void {
    this.#state = BeatmapClockState.PLAYING
    this.#interpolated.markSeek()
  }

  finish(): void {
    if (this.#state === BeatmapClockState.FINISHED) return
    this.#state = BeatmapClockState.FINISHED
    this.#finishedAt = this.#now()
    this.#finishedLength = this.#source.getLengthMS()
  }

  pause(): number {
    // OsuBeatmap.cpp:1523-1595 pauses the audio-backed timeline as one unit.
    if (this.#state === BeatmapClockState.PAUSED) return this.#pausedPosition
    this.#pausedPosition = this.update()
    this.#pausedFrom = this.#state
    this.#pausedAt = this.#now()
    this.#state = BeatmapClockState.PAUSED
    return this.#pausedPosition
  }

  resume(): void {
    if (this.#state !== BeatmapClockState.PAUSED) return
    const pausedDuration = this.#now() - this.#pausedAt
    if (this.#pausedFrom === BeatmapClockState.WAITING) this.#waitUntil += pausedDuration
    else if (this.#pausedFrom === BeatmapClockState.FINISHED) this.#finishedAt += pausedDuration
    else this.#interpolated.markSeek()
    this.#state = this.#pausedFrom
  }

  update(isLoading = false): number {
    const realTime = this.#now()
    if (this.#state === BeatmapClockState.PAUSED) return this.#pausedPosition
    if (this.#state === BeatmapClockState.WAITING) {
      // OsuBeatmap.cpp:471-505 pins the wait origin while loading and scales
      // the negative virtual position by the gameplay speed.
      if (isLoading) this.#waitUntil = realTime
      return (realTime - this.#waitUntil) * this.#source.getSpeed()
    }
    if (this.#state === BeatmapClockState.FINISHED) {
      // OsuBeatmap.cpp:554-565 deliberately continues in real milliseconds,
      // without applying the speed multiplier.
      return this.#finishedLength + (realTime - this.#finishedAt)
    }
    return this.#interpolated.update(isLoading)
  }
}
import { osuInterpolateMusicPos } from '../core/ConVars.ts'
