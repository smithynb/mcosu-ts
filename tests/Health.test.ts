import assert from 'node:assert/strict'
import test from 'node:test'
import type { GameplayBeatmap, GameplayCircle, GameplaySpinner } from '../src/data/GameplayLoader.ts'
import { calculateStableDrain, FailAnimation, HealthSystem, healthIncrease } from '../src/core/Health.ts'

test('stable health gains match OsuScore.cpp constants', () => {
  assert.equal(healthIncrease('300', 5), 6 / 200)
  assert.equal(healthIncrease('100', 5), 2.2 / 200)
  assert.equal(healthIncrease('50', 5), 0.4 / 200)
  assert.equal(healthIncrease('miss', 5), -25 / 200)
  assert.equal(healthIncrease('slider10', 5), 3 / 200)
  assert.equal(healthIncrease('slider30', 5), 4 / 200)
  assert.equal(healthIncrease('spinnerSpin', 5), 1.7 / 200)
  assert.equal(healthIncrease('geki', 5), 14 / 200)
})

test('stable drain calibration is deterministic and finite', () => {
  const map = beatmap([circle(1_000), circle(2_000), circle(3_000)])
  const first = calculateStableDrain(map)
  assert.deepEqual(calculateStableDrain(map), first)
  assert.ok(first.drainPerSecond > 0)
  assert.ok(Number.isFinite(first.normalMultiplier))
  assert.ok(Number.isFinite(first.comboEndMultiplier))
})

test('passive zero waits for a negative judgment while NF and Auto suppress failure', () => {
  const map = beatmap([circle(1_000), circle(120_000)])
  const parameters = { drainPerSecond: 1, normalMultiplier: 1, comboEndMultiplier: 1 }
  const health = new HealthSystem(map, { parameters })
  health.update(1_000, [])
  health.update(119_999, [])
  assert.equal(health.snapshot().health, 0)
  assert.equal(health.snapshot().failed, false)
  health.update(120_000, [{ type: 'judgment', objectIndex: 1, result: 'miss', delta: 200, position: { x: 0, y: 0 } }])
  assert.equal(health.snapshot().failed, true)

  for (const mods of [{ NF: true }, { Auto: true }]) {
    const protectedHealth = new HealthSystem(map, { mods, parameters })
    protectedHealth.update(1_000, [])
    protectedHealth.update(119_999, [])
    protectedHealth.update(120_000, [{ type: 'judgment', objectIndex: 1, result: 'miss', delta: 200, position: { x: 0, y: 0 } }])
    assert.equal(protectedHealth.snapshot().failed, false)
  }
})

test('breaks stop passive drain and spinner intervals use the 0.25 multiplier', () => {
  const base = beatmap([circle(1_000), circle(11_000)])
  const withBreak = { ...base, breaks: [{ startTime: 2_000, endTime: 10_000 }], breakLengthMS: 8_000 }
  const spinner: GameplaySpinner = { ...circle(1_000), kind: 'spinner', endTime: 11_000 }
  const withSpinner = beatmap([spinner])
  const parameters = { drainPerSecond: 0.2, normalMultiplier: 1, comboEndMultiplier: 1 }
  const plain = new HealthSystem(base, { parameters })
  const broken = new HealthSystem(withBreak, { parameters })
  const spun = new HealthSystem(withSpinner, { parameters })
  for (const system of [plain, broken, spun]) system.update(1_000, [])
  plain.update(10_999, [])
  broken.update(10_999, [])
  spun.update(10_999, [])
  assert.ok(broken.snapshot().health > plain.snapshot().health)
  assert.ok(spun.snapshot().health > plain.snapshot().health)
})

test('fail animation is a bounded 2.25 second linear timeline', () => {
  const animation = new FailAnimation(2_250)
  animation.start(100)
  assert.equal(animation.progress(100), 0)
  assert.equal(animation.progress(1_225), 0.5)
  assert.equal(animation.progress(2_350), 1)
  assert.equal(animation.progress(9_000), 1)
})

function circle(time: number): GameplayCircle {
  return { kind: 'circle', time, position: { x: 100, y: 100 }, hitSound: 0, samples: [], newCombo: false, comboOffset: 0, comboColorOffset: 0, comboNumber: 1, comboIndex: 0, comboColorIndex: 0 }
}

function beatmap(objects: GameplayBeatmap['objects']): GameplayBeatmap {
  return {
    fileVersion: 14, stackLeniency: 0.7, approachRate: 5, circleSize: 4,
    overallDifficulty: 5, drainRate: 5, sliderMultiplier: 1.4, sliderTickRate: 1,
    playableLengthMS: objects.length < 2 ? 10_000 : objects.at(-1)!.time - objects[0]!.time,
    breakLengthMS: 0, breaks: [], objects,
    circles: objects.filter((object): object is GameplayCircle => object.kind === 'circle'),
    sliders: [], spinners: objects.filter((object): object is GameplaySpinner => object.kind === 'spinner'),
  }
}
