import assert from 'node:assert/strict'
import test from 'node:test'
import { StarRatingCache, starRatingKey } from '../src/core/StarRatingCache.ts'
import type { BeatmapEntry } from '../src/data/OsuDatabase.ts'

test('star cache de-duplicates in-flight and completed calculations', async () => {
  let calls = 0
  const cache = new StarRatingCache(async () => {
    calls += 1
    return 4.25
  }, async () => undefined)
  const entry = beatmap('ABC', 'Folder/Map.osu')
  const first = cache.get(entry)
  const second = cache.get(entry)
  assert.strictEqual(first, second)
  assert.equal(await first, 4.25)
  assert.equal(await cache.get(entry), 4.25)
  assert.equal(calls, 1)
})

test('star cache serializes work and yields before each calculation', async () => {
  const events: string[] = []
  const cache = new StarRatingCache(async (entry) => {
    events.push(`load:${entry.osuPath}`)
    return 1
  }, async () => { events.push('yield') })
  await Promise.all([
    cache.get(beatmap('', 'a.osu')),
    cache.get(beatmap('', 'b.osu')),
  ])
  assert.deepEqual(events, ['yield', 'load:a.osu', 'yield', 'load:b.osu'])
})

test('failed calculations are evicted so a later request can retry', async () => {
  let calls = 0
  const cache = new StarRatingCache(async () => {
    calls += 1
    if (calls === 1) throw new Error('temporary')
    return 2.5
  }, async () => undefined)
  const entry = beatmap('', 'retry.osu')
  await assert.rejects(cache.get(entry), /temporary/)
  assert.equal(await cache.get(entry), 2.5)
  assert.equal(calls, 2)
})

test('cache keys prefer normalized MD5 and fall back to normalized path', () => {
  assert.equal(starRatingKey(beatmap('ABCDEF', 'Ignored.osu')), 'md5:abcdef')
  assert.equal(starRatingKey(beatmap('', 'Folder\\Map.OSU')), 'path:folder/map.osu')
})

function beatmap(md5: string, osuPath: string): BeatmapEntry {
  return {
    artist: '', title: '', creator: '', difficultyName: '', audioFile: '', md5,
    osuPath, folder: '', ar: 5, cs: 5, hp: 5, od: 5, length: 0, mode: 0,
    localOffset: 0,
  }
}
