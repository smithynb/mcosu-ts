import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeMcOsuScoresDatabase, parseMcOsuScoresDatabase, type LocalScore } from '../src/data/ScoresDatabase.ts'

test('McOsu custom writer round-trips browser plays grouped by beatmap', () => {
  const first = score('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 100_000n, true)
  const second = score('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2, 90_000n, false)
  const third = score('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 3, 80_000n, false)
  const ignored = { ...third, source: 'stable' as const }
  const encoded = encodeMcOsuScoresDatabase([first, second, third, ignored])
  const decoded = parseMcOsuScoresDatabase(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength))
  assert.equal(decoded.version, 20210110)
  assert.equal(decoded.declaredBeatmapCount, 2)
  assert.equal(decoded.scores.length, 3)
  assert.deepEqual(decoded.scores.map((item) => [item.md5, item.playerName, item.score, item.perfect]), [
    [first.md5, 'Player 1', 100_000n, true],
    [second.md5, 'Player 2', 90_000n, false],
    [third.md5, 'Player 3', 80_000n, false],
  ])
  assert.deepEqual(decoded.scores.map((item) => item.pp), [101, 102, 103])
})

test('empty export is valid and invalid browser hashes are rejected', () => {
  assert.equal(parseMcOsuScoresDatabase(encodeMcOsuScoresDatabase([]).buffer).declaredBeatmapCount, 0)
  assert.throws(() => encodeMcOsuScoresDatabase([{ ...score('bad', 1, 1n, false) }]), /invalid beatmap MD5/)
})

function score(md5: string, index: number, value: bigint, perfect: boolean): LocalScore {
  return {
    source: 'browser', md5, version: 1, playerName: `Player ${index}`,
    count300: 10 + index, count100: index, count50: 0, countGeki: index,
    countKatu: 0, countMiss: perfect ? 0 : 1, score: value, maxCombo: 20 + index,
    perfect, modsLegacy: index === 1 ? 8 : 0, modAcronyms: index === 1 ? 'HD' : 'NM',
    accuracy: 0.9, grade: 'A', playedAt: new Date(`2026-07-2${index}T12:00:00Z`),
    pp: 100 + index, sliderBreaks: index, speedMultiplier: 1,
    importedLegacy: false, sourceOrder: index,
  }
}
