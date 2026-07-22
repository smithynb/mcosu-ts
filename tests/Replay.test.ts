import assert from 'node:assert/strict'
import test from 'node:test'
import { ReplayPlayer, ReplayRecorder, normalizeLegacyFrames } from '../src/core/Replay.ts'
import { modsFromLegacy } from '../src/core/Mods.ts'

test('normalizes seed/sentinel frames and masks non-gameplay keys', () => {
  const frames = normalizeLegacyFrames([
    { interval: -12_345, mouseX: 0, mouseY: 0, buttonState: 0 },
    { interval: 0, mouseX: 256, mouseY: -500, buttonState: 0 },
    { interval: 10, mouseX: 100, mouseY: 200, buttonState: 1 | 16 },
  ])
  assert.deepEqual(frames, [{ delta: 10, x: 100, y: 200, keys: 1 }])
})

test('replay player accumulates deltas and emits clicks only on rising edges', () => {
  const player = new ReplayPlayer([
    { delta: 100, x: 10, y: 20, keys: 4 },
    { delta: 20, x: 11, y: 21, keys: 4 },
    { delta: 20, x: 12, y: 22, keys: 0 },
    { delta: 10, x: 13, y: 23, keys: 1 | 8 },
  ])
  assert.equal(player.inputAt(99).clicks.length, 0)
  assert.deepEqual(player.inputAt(100).clicks.map((click) => [click.musicTime, click.input]), [[100, 'KeyZ']])
  assert.equal(player.inputAt(120).clicks.length, 0)
  assert.deepEqual(player.inputAt(150).clicks.map((click) => click.input), ['MouseLeft', 'KeyX'])
  assert.deepEqual(player.inputAt(150).position, { x: 13, y: 23 })
})

test('stable M1+K1 duplicate bits collapse to one keyboard-preferred click', () => {
  const player = new ReplayPlayer([
    { delta: 100, x: 100, y: 200, keys: 5 },
    { delta: 10, x: 101, y: 201, keys: 5 },
  ])
  const pressed = player.inputAt(100)
  assert.deepEqual(pressed.clicks.map((click) => click.input), ['KeyZ'])
  assert.deepEqual(pressed.heldInputs, ['KeyZ'])
  assert.equal(pressed.held, true)
  assert.equal(player.inputAt(110).clicks.length, 0)
})

test('alternating stable duplicate pairs emit one logical click per side', () => {
  const player = new ReplayPlayer([
    { delta: 100, x: 100, y: 200, keys: 5 },
    { delta: 10, x: 101, y: 201, keys: 10 },
    { delta: 10, x: 102, y: 202, keys: 0 },
    { delta: 10, x: 103, y: 203, keys: 5 },
  ])
  assert.deepEqual(player.inputAt(100).clicks.map((click) => click.input), ['KeyZ'])
  assert.deepEqual(player.inputAt(110).clicks.map((click) => click.input), ['KeyX'])
  assert.equal(player.inputAt(120).held, false)
  assert.deepEqual(player.inputAt(130).clicks.map((click) => click.input), ['KeyZ'])
})

test('recorder preserves click taps, releases, cursor state, and compatible deltas', () => {
  const recorder = new ReplayRecorder()
  recorder.record(100, {
    position: { x: 20, y: 30 }, held: false, heldInputs: [],
    clicks: [{ musicTime: 95, position: { x: 19, y: 29 }, input: 'KeyZ' }],
  })
  recorder.record(220, { position: { x: 21, y: 31 }, held: true, heldInputs: ['KeyX'], clicks: [] })
  assert.deepEqual(recorder.frames(), [
    { delta: 95, x: 19, y: 29, keys: 4 },
    { delta: 5, x: 20, y: 30, keys: 0 },
    { delta: 120, x: 21, y: 31, keys: 8 },
  ])
})

test('legacy replay mods map to supported gameplay mods', () => {
  assert.deepEqual(modsFromLegacy(1 | 8 | 16 | 512 | 64), {
    NF: true, EZ: false, HD: true, HR: true, DT: false, NC: true, HT: false, Auto: false,
  })
})
