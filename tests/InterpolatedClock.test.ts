import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BeatmapClock,
  BeatmapClockState,
  InterpolatedClock,
  type AudioClockSource,
} from '../src/audio/InterpolatedClock.ts'

class QuantizedAudio implements AudioClockSource {
  speed = 1
  playing = true
  rawOffset = 0
  length = 120_000
  readonly now: () => number
  readonly quantumMS: number

  constructor(now: () => number, quantumMS = 32) {
    this.now = now
    this.quantumMS = quantumMS
  }

  getPositionMS(): number {
    return this.rawOffset + Math.floor(this.now() / this.quantumMS) * this.quantumMS * this.speed
  }

  isPlaying(): boolean { return this.playing }
  getSpeed(): number { return this.speed }
  getLengthMS(): number { return this.length }
}

function drive(speed: number, frames = 180): { positions: number[]; expected: number } {
  let now = 0
  const audio = new QuantizedAudio(() => now)
  audio.speed = speed
  const clock = new InterpolatedClock(audio, () => now)
  clock.markSeek()
  clock.update()
  const positions: number[] = []

  for (let frame = 0; frame < frames; frame += 1) {
    now += 16
    positions.push(clock.update())
  }
  return { positions, expected: now * speed }
}

test('smooths a quantized raw clock monotonically and converges at 1x', () => {
  const { positions, expected } = drive(1)
  const deltas: number[] = []
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index]! >= positions[index - 1]!, `position went backwards at frame ${index}`)
    deltas.push(positions[index]! - positions[index - 1]!)
  }
  assert.ok(Math.abs(positions.at(-1)! - expected) <= 32)
  assert.ok(Math.min(...deltas) >= 8)
  assert.ok(Math.max(...deltas) <= 24)
})

for (const speed of [1.5, 0.75]) {
  test(`scales interpolated advancement at ${speed}x`, () => {
    const { positions, expected } = drive(speed)
    assert.ok(Math.abs(positions.at(-1)! - expected) <= 40)
    const averageDelta = (positions.at(-1)! - positions[0]!) / (positions.length - 1)
    assert.ok(Math.abs(averageDelta - 16 * speed) < 1)
  })
}

test('bypasses interpolation on a marked seek frame and resumes from the seek target', () => {
  let now = 0
  const audio = new QuantizedAudio(() => now)
  const clock = new InterpolatedClock(audio, () => now)
  now = 64
  clock.update()
  audio.rawOffset = 5_000
  clock.markSeek()
  assert.equal(clock.update(), audio.getPositionMS())
  now += 16
  assert.ok(clock.update() >= 5_000)
})

test('snaps to raw audio when delta exceeds twice the active limit', () => {
  let now = 0
  const audio = new QuantizedAudio(() => now)
  const clock = new InterpolatedClock(audio, () => now)
  clock.markSeek()
  clock.update()
  now += 16
  clock.update()
  audio.rawOffset = 50_000
  now += 16
  assert.equal(clock.update(), audio.getPositionMS())
})

test('returns raw audio directly while loading', () => {
  let now = 96
  const audio = new QuantizedAudio(() => now)
  const clock = new InterpolatedClock(audio, () => now)
  now += 17
  assert.equal(clock.update(true), audio.getPositionMS())
})

test('BeatmapClock exposes waiting, playing, and post-song virtual time', () => {
  let now = 1_000
  const audio = new QuantizedAudio(() => now)
  audio.speed = 1.5
  audio.length = 90_000
  const interpolated = new InterpolatedClock(audio, () => now)
  const clock = new BeatmapClock(audio, interpolated, () => now)

  clock.startWaiting(1_500)
  assert.equal(clock.state, BeatmapClockState.WAITING)
  assert.equal(clock.update(), -2_250)
  now += 500
  assert.equal(clock.update(), -1_500)

  clock.startPlaying()
  assert.equal(clock.state, BeatmapClockState.PLAYING)
  assert.equal(clock.update(), audio.getPositionMS())

  clock.finish()
  assert.equal(clock.state, BeatmapClockState.FINISHED)
  now += 250
  assert.equal(clock.update(), 90_250)
})
