import assert from 'node:assert/strict'
import test from 'node:test'
import type { GameplayCircle, GameplayObject, GameplaySlider } from '../src/data/GameplayLoader.ts'
import { calculateStackIndices, STACK_LENIENCE, STACK_OFFSET_MULTIPLIER } from '../src/core/Stacking.ts'

test('modern reverse stacking produces a hand-derived overlap chain', () => {
  // OsuBeatmapStandard.cpp:2076-2128: each earlier coincident circle is one
  // stack above the current object.
  const objects = [circle(1_000), circle(1_050), circle(1_100)]
  assert.deepEqual(calculateStackIndices(objects, 14, 5, 0.7), [2, 1, 0])
  assert.equal(STACK_LENIENCE, 3)
  assert.equal(STACK_OFFSET_MULTIPLIER, 0.05)
})

test('modern slider-tail special case assigns a negative stack', () => {
  // OsuBeatmapStandard.cpp:2091-2104: a circle on a preceding slider tail is
  // pulled below the base stack instead of stacked above its head.
  const objects: GameplayObject[] = [slider(1_000, 1_400), circle(1_400, 200, 100)]
  assert.deepEqual(calculateStackIndices(objects, 14, 5, 0.7), [0, -1])
})

test('legacy forward stacking keeps the pre-v6 index layout', () => {
  // OsuBeatmapStandard.cpp:2136-2181 legacy branch increments the first object.
  assert.deepEqual(calculateStackIndices([circle(1_000), circle(1_050), circle(1_100)], 5, 5, 0.7), [2, 1, 0])
})

function circle(time: number, x = 100, y = 100): GameplayCircle {
  return {
    kind: 'circle', time, position: { x, y }, hitSound: 0, samples: [],
    newCombo: false, comboOffset: 0, comboColorOffset: 0,
    comboNumber: 1, comboIndex: 0, comboColorIndex: 0,
  }
}

function slider(time: number, endTime: number): GameplaySlider {
  return {
    ...circle(time), kind: 'slider', endTime, repeats: 0, spans: 1,
    pixelLength: 100, curveType: 'Linear', spanDuration: endTime - time,
    controlPoints: [{ x: 0, y: 0, type: 'Linear' }, { x: 100, y: 0, type: null }],
    absoluteControlPoints: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    tickPercentages: [], nodeSamples: [],
  }
}
