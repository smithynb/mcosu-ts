import assert from 'node:assert/strict'
import test from 'node:test'
import { NO_MODS, type GameplayMods } from '../src/core/Mods.ts'
import {
  createStandardPerformance,
  modsToAcronyms,
} from '../src/core/StandardPerformance.ts'

const MAP = `osu file format v14

[General]
Mode:0

[Metadata]
Title:Performance Test
Artist:Codex
Creator:Tests
Version:Normal

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:7
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,1,100,1,0

[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,96,1500,1,0,0:0:0:0:
320,288,2000,1,0,0:0:0:0:
448,192,2500,1,0,0:0:0:0:
256,192,3000,1,0,0:0:0:0:
`

test('gameplay mods map to one compatible stable-ruleset combination', () => {
  assert.equal(modsToAcronyms(mods('NF', 'HD', 'HR', 'DT')), 'NFHRHDDT')
  assert.equal(modsToAcronyms(mods('EZ', 'HR', 'NC', 'DT', 'HT')), 'EZNC')
  assert.equal(modsToAcronyms(mods('Auto')), '')
})

test('difficulty and performance calculations are deterministic and finite', () => {
  const context = createStandardPerformance(MAP, NO_MODS)
  assert.ok(context.starRating > 0)
  assert.equal(context.maxCombo, 5)
  const perfect = context.calculate({
    maxCombo: 5, accuracy: 1,
    count300: 5, count100: 0, count50: 0, countMiss: 0,
  })
  const missed = context.calculate({
    maxCombo: 2, accuracy: 0.8,
    count300: 4, count100: 0, count50: 0, countMiss: 1,
  })
  assert.ok(Number.isFinite(perfect.pp) && perfect.pp > 0)
  assert.ok(Number.isFinite(missed.pp) && missed.pp >= 0)
  assert.ok(perfect.pp > missed.pp)

  const doubleTime = createStandardPerformance(MAP, mods('HD', 'DT'))
  assert.ok(Number.isFinite(doubleTime.starRating) && doubleTime.starRating > 0)
})

test('live empty state and Auto report zero pp', () => {
  const empty = createStandardPerformance(MAP, NO_MODS).calculate({
    maxCombo: 0, accuracy: 1,
    count300: 0, count100: 0, count50: 0, countMiss: 0,
  })
  assert.equal(empty.pp, 0)

  const auto = createStandardPerformance(MAP, mods('Auto')).calculate({
    maxCombo: 5, accuracy: 1,
    count300: 5, count100: 0, count50: 0, countMiss: 0,
  })
  assert.equal(auto.pp, 0)
})

function mods(...enabled: readonly (keyof GameplayMods)[]): GameplayMods {
  const result = { ...NO_MODS }
  for (const mod of enabled) result[mod] = true
  return result
}
