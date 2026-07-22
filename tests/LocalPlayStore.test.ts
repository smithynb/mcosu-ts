import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalPlayStore, type StorageLike } from '../src/data/LocalPlayStore.ts'
import { NO_MODS } from '../src/core/Mods.ts'

class MemoryStorage implements StorageLike {
  value: string | null = null
  getItem() { return this.value }
  setItem(_key: string, value: string) { this.value = value }
}

test('browser plays round-trip, de-duplicate by run id, and sort by score', () => {
  const storage = new MemoryStorage()
  const store = new LocalPlayStore(storage, 'test')
  store.add(play('one', 100))
  store.add(play('one', 100))
  store.add(play('two', 200))
  const restored = new LocalPlayStore(storage, 'test')
  const scores = restored.scores()
  assert.equal(scores.length, 2)
  assert.equal(scores[0]?.source, 'browser')
  assert.deepEqual(scores[0]?.replayFrames, [{ delta: 100, x: 20, y: 30, keys: 4 }])
  assert.deepEqual(restored.mergedIndex([]).get('0123456789abcdef0123456789abcdef')?.map((score) => score.score), [200n, 100n])
})

test('malformed storage is ignored without preventing later writes', () => {
  const storage = new MemoryStorage()
  storage.value = '{bad'
  const store = new LocalPlayStore(storage, 'test')
  assert.deepEqual(store.scores(), [])
  store.add(play('valid', 300))
  assert.equal(store.scores().length, 1)
})

test('older entries remain readable and malformed replay frames are discarded only', () => {
  const storage = new MemoryStorage()
  const store = new LocalPlayStore(storage, 'test')
  store.add(play('legacy', 400))
  const stored = JSON.parse(storage.value!) as Array<Record<string, unknown>>
  delete stored[0]!.replayFrames
  storage.value = JSON.stringify(stored)
  assert.equal(new LocalPlayStore(storage, 'test').scores()[0]?.replayFrames, undefined)

  stored[0]!.replayFrames = [{ delta: -1, x: 20, y: 30, keys: 4 }]
  storage.value = JSON.stringify(stored)
  const score = new LocalPlayStore(storage, 'test').scores()[0]
  assert.equal(score?.score, 400n)
  assert.equal(score?.replayFrames, undefined)
})

function play(id: string, score: number) {
  return {
    id, md5: '0123456789abcdef0123456789abcdef', playerName: 'Player',
    score: { score, combo: 1, maxCombo: 1, accuracy: 1, count300: 1, count100: 0, count50: 0, countMiss: 0, countGeki: 1, countKatu: 0 },
    pp: score / 10, mods: NO_MODS, playedAt: new Date('2026-07-21T00:00:00Z'),
    replayFrames: [{ delta: 100, x: 20, y: 30, keys: 4 }],
  }
}
