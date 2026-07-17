import assert from 'node:assert/strict'
import test from 'node:test'
import type { GameplayBeatmap } from '../src/data/GameplayLoader.ts'
import {
  applyDifficultyMods,
  hiddenAlpha,
  modPitchPreserved,
  modSpeed,
  musicPositionWithOffsets,
  NO_MODS,
  scoreMultiplier,
  type GameplayMods,
} from '../src/core/Mods.ts'
import { osuLocalOffset, osuUniversalOffset } from '../src/core/ConVars.ts'

test('HR and EZ use McOsu difficulty factors and HR flips Y', () => {
  // Osu.cpp:1956-1977: HR AR/OD/HP=1.4, CS=1.3; EZ=0.5.
  const hr = applyDifficultyMods(beatmap(), mods('HR'))
  assert.equal(hr.approachRate, 10)
  assert.ok(Math.abs(hr.overallDifficulty - 9.8) < 1e-12)
  assert.ok(Math.abs(hr.drainRate - 8.4) < 1e-12)
  assert.equal(hr.circleSize, 5.2)
  assert.equal(hr.objects[0]!.position.y, 284)
  const ez = applyDifficultyMods(beatmap(), mods('EZ'))
  assert.deepEqual([ez.approachRate, ez.overallDifficulty, ez.drainRate, ez.circleSize], [4.5, 3.5, 3, 2])
})

test('speed, pitch, and score multipliers match McOsu scoreV1', () => {
  // Osu.cpp:1980-2022: NF/EZ .5, HT .3, HR/HD 1.06, DT/NC 1.12.
  const selected = { ...NO_MODS, NF: true, HR: true, HD: true, NC: true }
  assert.equal(scoreMultiplier(selected), 0.5 * 1.06 * 1.12 * 1.06)
  assert.equal(modSpeed(selected), 1.5)
  assert.equal(modPitchPreserved(selected), false)
  assert.equal(modSpeed(mods('HT')), 0.75)
})

test('offset sign and HD percentages follow the C++ update/draw paths', () => {
  osuUniversalOffset.setValue(12)
  osuLocalOffset.setValue(3)
  try {
    // OsuBeatmap.cpp:581-587: music + universal*speed - dbLocal - userLocal.
    assert.equal(musicPositionWithOffsets(1_000, 1.5, 5), 1_010)
  } finally {
    osuUniversalOffset.reset()
    osuLocalOffset.reset()
  }
  assert.equal(hiddenAlpha(0, 1_000, 1_000), 0)
  assert.equal(hiddenAlpha(400, 1_000, 1_000), 1)
  assert.equal(hiddenAlpha(700, 1_000, 1_000), 0)
})

function mods(...enabled: readonly (keyof GameplayMods)[]): GameplayMods {
  const result = { ...NO_MODS }
  for (const mod of enabled) result[mod] = true
  return result
}

function beatmap(): GameplayBeatmap {
  const object = {
    kind: 'circle' as const, time: 1_000, position: { x: 100, y: 100 },
    hitSound: 0, samples: [], newCombo: false, comboOffset: 0,
    comboColorOffset: 0, comboNumber: 1, comboIndex: 0, comboColorIndex: 0,
  }
  return {
    fileVersion: 14, stackLeniency: 0.7, approachRate: 9, circleSize: 4,
    overallDifficulty: 7, drainRate: 6, sliderMultiplier: 1.4,
    sliderTickRate: 1, playableLengthMS: 0, breakLengthMS: 0,
    circles: [object], sliders: [], spinners: [], objects: [object],
  }
}
