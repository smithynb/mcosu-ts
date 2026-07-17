import assert from 'node:assert/strict'
import test from 'node:test'

import { parseOsuBeatmapMetadata } from '../src/data/OsuBeatmapMetadata.ts'

const standardMap = `osu file format v14

[General]
AudioFilename: song:mix.mp3
Mode: 0

[Metadata]
Title: A Title
Artist:DJ'TEKINA//SOMETHING
Creator: Mapper
Version: Insane

[Difficulty]
HPDrainRate:6
CircleSize:4
OverallDifficulty:8
// ApproachRate intentionally omitted

[HitObjects]
256,192,1000,1,0,0:0:0:0:
`

test('parses lightweight standard metadata and preserves colons and embedded slashes', () => {
  assert.deepEqual(parseOsuBeatmapMetadata(standardMap, '123 Set', 'map.osu'), {
    artist: "DJ'TEKINA//SOMETHING",
    title: 'A Title',
    creator: 'Mapper',
    difficultyName: 'Insane',
    audioFile: 'song:mix.mp3',
    md5: '',
    osuPath: '123 Set/map.osu',
    folder: '123 Set',
    ar: 8,
    cs: 4,
    hp: 6,
    od: 8,
    length: 0,
    mode: 0,
    localOffset: 0,
  })
})

test('uses safe defaults for malformed optional difficulty numbers', () => {
  const result = parseOsuBeatmapMetadata(standardMap.replace('CircleSize:4', 'CircleSize:nope'), 'set', 'map.osu')
  assert.equal(result?.cs, 5)
  assert.equal(result?.ar, 8)
})

test('filters non-standard modes and unusable metadata', () => {
  assert.equal(parseOsuBeatmapMetadata(standardMap.replace('Mode: 0', 'Mode: 3'), 'set', 'map.osu'), null)
  assert.equal(parseOsuBeatmapMetadata(standardMap.replace('Mode: 0', 'Mode: nope'), 'set', 'map.osu'), null)
  assert.equal(parseOsuBeatmapMetadata('[General]\nMode:0\n[Metadata]\n[Difficulty]\n', 'set', 'map.osu'), null)
})
