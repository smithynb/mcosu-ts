import assert from 'node:assert/strict'
import test from 'node:test'
import { ScoreDecoder } from 'osu-parsers'
import { LegacyReplayFrame } from 'osu-classes'
import { encodeReplay, replayFilename } from '../src/data/ReplayExport.ts'
import type { LocalScore } from '../src/data/ScoresDatabase.ts'

test('ScoreEncoder replay export round-trips metadata, mods, hash, and LZMA frames', async () => {
  const score = localScore()
  const encoded = await encodeReplay(score)
  assert.ok(encoded.length > 100)
  const decoded = await new ScoreDecoder().decodeFromBuffer(encoded, true)
  assert.equal(decoded.info.rulesetId, 0)
  assert.equal(decoded.info.beatmapHashMD5, score.md5)
  assert.equal(decoded.info.username, score.playerName)
  assert.equal(Number(decoded.info.rawMods), score.modsLegacy)
  assert.deepEqual(
    decoded.replay?.frames.filter((frame): frame is LegacyReplayFrame => frame instanceof LegacyReplayFrame)
      .map((frame) => [frame.interval, frame.mouseX, frame.mouseY, frame.buttonState]),
    score.replayFrames?.map((frame) => [frame.delta, frame.x, frame.y, frame.keys]),
  )
})

test('replay filename is filesystem-safe and missing frames are rejected', async () => {
  const score = localScore()
  assert.match(replayFilename({ ...score, playerName: 'A/B: C' }), /^A_B_ C_[0-9a-f]{8}_.*\.osr$/)
  await assert.rejects(() => encodeReplay({ ...score, replayFrames: undefined }), /does not contain/)
})

function localScore(): LocalScore {
  return {
    source: 'browser', md5: '0123456789abcdef0123456789abcdef', version: 1,
    playerName: 'Local Player', count300: 12, count100: 2, count50: 1,
    countGeki: 3, countKatu: 2, countMiss: 0, score: 123_456n,
    maxCombo: 42, perfect: false, modsLegacy: 72, modAcronyms: 'HDDT',
    accuracy: 0.95, grade: 'A', playedAt: new Date('2026-07-21T12:34:56.000Z'),
    pp: 123.4, speedMultiplier: 1.5, importedLegacy: false, sourceOrder: 0,
    replayFrames: [
      { delta: 0, x: 256, y: 192, keys: 0 },
      { delta: 16, x: 300.5, y: 180.25, keys: 4 },
      { delta: 17, x: 310, y: 170, keys: 0 },
    ],
  }
}
