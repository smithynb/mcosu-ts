import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGameplayBeatmap } from '../src/data/GameplayLoader.ts'

const SYNTHETIC_OSU = `osu file format v14

[General]
Mode:0
StackLeniency:0.6

[Difficulty]
HPDrainRate:6
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,1,100,1,0

[Events]
2,2200,2400

[HitObjects]
64,192,1000,1,0,0:0:0:0:
256,192,1500,22,0,B|300:200|350:150,2,200
256,192,3000,8,0,4000
`

test('decodes hit objects into a parser-independent gameplay boundary', () => {
  const beatmap = parseGameplayBeatmap(SYNTHETIC_OSU)
  assert.deepEqual(
    {
      ar: beatmap.approachRate,
      cs: beatmap.circleSize,
      od: beatmap.overallDifficulty,
      hp: beatmap.drainRate,
      counts: [beatmap.circles.length, beatmap.sliders.length, beatmap.spinners.length],
      playableLengthMS: beatmap.playableLengthMS,
      stackLeniency: beatmap.stackLeniency,
    },
    { ar: 9, cs: 4, od: 8, hp: 6, counts: [1, 1, 1], playableLengthMS: 3_000, stackLeniency: 0.6 },
  )

  assert.deepEqual(beatmap.circles[0], {
    kind: 'circle',
    time: 1_000,
    position: { x: 64, y: 192 },
    hitSound: 0,
    samples: [{ sampleSet: 'soft', hitSound: 'normal', customIndex: 1, volume: 100, filename: '' }],
    newCombo: false,
    comboOffset: 0,
    comboColorOffset: 0,
    comboNumber: 1,
    comboIndex: 1,
    comboColorIndex: 1,
  })

  const slider = beatmap.sliders[0]
  assert.equal(slider.time, 1_500)
  assert.equal(slider.repeats, 1)
  assert.equal(slider.spans, 2)
  assert.equal(slider.pixelLength, 200)
  assert.equal(slider.curveType, 'B')
  assert.equal(slider.newCombo, true)
  assert.equal(slider.comboOffset, 1)
  assert.equal(slider.comboColorOffset, 1)
  assert.equal(slider.comboNumber, 1)
  assert.equal(slider.comboIndex, 2)
  assert.equal(slider.comboColorIndex, 2)
  // osu-parsers normalizes raw file coordinates to offsets from the slider head.
  assert.deepEqual(slider.controlPoints, [
    { x: 0, y: 0, type: 'B' },
    { x: 44, y: 8, type: null },
    { x: 94, y: -42, type: null },
  ])
  assert.deepEqual(slider.absoluteControlPoints, [
    { x: 256, y: 192 },
    { x: 300, y: 200 },
    { x: 350, y: 150 },
  ])
  assert.ok(Math.abs(slider.spanDuration - (500 * 200) / (1.4 * 100)) < 1e-9)
  assert.deepEqual(slider.tickPercentages, [0.7])
  assert.equal(slider.nodeSamples.length, 3)
  assert.equal(beatmap.spinners[0]?.endTime, 4_000)
  assert.deepEqual(beatmap.breaks, [{ startTime: 2_200, endTime: 2_400 }])
})
