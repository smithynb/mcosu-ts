import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HITOBJECT_FADE_IN_MS,
  approachTimeMS,
  fadeInProgress,
  getPlayfieldTransform,
  hitWindowsMS,
  osuCoords2Pixels,
  rawCircleRadius,
  spinnerRequiredRotations,
  spinnerSpinsPerSecond,
} from '../src/core/GameRules.ts'

test('approach time follows both McOsu AR branches', () => {
  // OsuGameRules.cpp:50-52 + .h:143-153: 1800 -> 1200 -> 450 ms.
  assert.equal(approachTimeMS(0), 1_800)
  assert.equal(approachTimeMS(5), 1_200)
  assert.equal(approachTimeMS(9), 600)
  assert.equal(approachTimeMS(10), 450)
})

test('hit windows match McOsu OD constants', () => {
  // OsuGameRules.cpp:54-66: at OD10 the 300/100/50 windows are 20/60/100 ms.
  assert.deepEqual(hitWindowsMS(10), { hit300: 20, hit100: 60, hit50: 100, miss: 400 })
  assert.deepEqual(hitWindowsMS(5), { hit300: 50, hit100: 100, hit50: 150, miss: 400 })
})

test('CS4 raw radius includes stable replay rounding allowance', () => {
  // OsuGameRules.h:363-375: (((1 - .7*(4-5)/5)/2)*1.00041*128)/2.
  assert.ok(Math.abs(rawCircleRadius(4) - 36.4949568) < 1e-9)
})

test('fade and spinner requirements use McOsu defaults', () => {
  assert.equal(HITOBJECT_FADE_IN_MS, 400)
  assert.equal(fadeInProgress(800, 1_000, 600), 1)
  assert.equal(fadeInProgress(600, 1_000, 600), 0.5)
  assert.equal(spinnerSpinsPerSecond(10), 7.5)
  // OsuGameRules.h:291-295: truncate(2 s * 7.5 * .5) = 7 at 1x, 5 at 1.5x.
  assert.equal(spinnerRequiredRotations(10, 2_000, 1), 7)
  assert.equal(spinnerRequiredRotations(10, 2_000, 1.5), 5)
})

test('playfield transform preserves McOsu border truncation and coordinate mapping', () => {
  // At 1280x720: top=84, bottom=60, scale=1.5, offset=(256,84).
  const transform = getPlayfieldTransform(1_280, 720)
  assert.equal(transform.scale, 1.5)
  assert.deepEqual(transform.offset, { x: 256, y: 84 })
  assert.deepEqual(transform.center, { x: 640, y: 372 })
  assert.deepEqual(osuCoords2Pixels({ x: 0, y: 0 }, transform), { x: 256, y: 84 })
  assert.deepEqual(osuCoords2Pixels({ x: 512, y: 384 }, transform), { x: 1_024, y: 660 })
})
