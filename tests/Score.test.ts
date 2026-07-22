import assert from 'node:assert/strict'
import test from 'node:test'
import { Score } from '../src/core/Score.ts'

test('score v1, combo, counts, and accuracy match McOsu arithmetic', () => {
  const score = new Score({
    circleSize: 4,
    drainRate: 6,
    overallDifficulty: 8,
    objectCount: 100,
    playableLengthMS: 100_000,
  })

  // OsuScore.cpp:178-182: round(((4+6+8+8)/38)*5) = 3.
  assert.equal(score.difficultyMultiplier, 3)
  score.addJudgment('300')
  score.addJudgment('100')
  score.addJudgment('50')
  score.addComboEnd('geki')
  score.addComboEnd('katu')
  assert.deepEqual(score.snapshot(), {
    // Third result: 50 + floor(50 * (combo 2 - 1) * 3 / 25) = 56.
    score: 456,
    combo: 3,
    maxCombo: 3,
    // OsuScore.cpp:184-194: (1 + 2/6 + 1/6) / 3 = 0.5.
    accuracy: 0.5,
    count300: 1,
    count100: 1,
    count50: 1,
    countMiss: 0,
    countGeki: 1,
    countKatu: 1,
  })

  score.sliderBreak()
  score.addJudgment('miss')
  assert.equal(score.snapshot().combo, 0)
  assert.equal(score.snapshot().maxCombo, 3)
  assert.equal(score.snapshot().countMiss, 1)
})

test('slider and spinner bonus points do not affect accuracy counts', () => {
  const score = new Score({ circleSize: 5, drainRate: 5, overallDifficulty: 5, objectCount: 1, playableLengthMS: 1_000 })
  score.addSliderElement(30, true)
  score.addSliderElement(10, true)
  score.addSpinnerRotation(false)
  score.addSpinnerRotation(true)
  assert.equal(score.snapshot().score, 1_240)
  assert.equal(score.snapshot().combo, 2)
  assert.equal(score.snapshot().accuracy, 1)
})
