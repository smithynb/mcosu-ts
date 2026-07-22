import assert from 'node:assert/strict'
import test from 'node:test'
import { indexCollectionHashes, mergeCollections, parseCollectionsDatabase } from '../src/data/CollectionsDatabase.ts'

test('parses stable and custom collection layouts', () => {
  const stable = parseCollectionsDatabase(database(20250701, [
    ['Favorites', [hash('a'), hash('b')]], ['Empty', []],
  ]), 'stable')
  assert.equal(stable.version, 20250701)
  assert.deepEqual(stable.collections[0], { name: 'Favorites', hashes: [hash('a'), hash('b')], sources: ['stable'] })
  assert.deepEqual(stable.collections[1]?.hashes, [])
  const custom = parseCollectionsDatabase(database(20220110, [['Mine', [hash('c')]]]), 'mcosu')
  assert.equal(custom.collections[0]?.sources[0], 'mcosu')
})

test('merges same-name collections and de-duplicates hashes', () => {
  const stable = parseCollectionsDatabase(database(20250701, [['Same', [hash('a'), hash('b')]]]), 'stable')
  const custom = parseCollectionsDatabase(database(20220110, [['Same', [hash('b'), hash('c')]]]), 'mcosu')
  const merged = mergeCollections([stable.collections, custom.collections])
  assert.deepEqual(merged, [{ name: 'Same', hashes: [hash('a'), hash('b'), hash('c')], sources: ['stable', 'mcosu'] }])
  assert.equal(indexCollectionHashes(merged).get('Same')?.has(hash('c')), true)
})

test('skips malformed hashes while retaining the collection', () => {
  const parsed = parseCollectionsDatabase(database(20220110, [['Mixed', [hash('a'), 'nope', hash('b')]]]), 'mcosu')
  assert.deepEqual(parsed.collections, [{ name: 'Mixed', hashes: [hash('a'), hash('b')], sources: ['mcosu'] }])
})

test('rejects unsupported custom versions, malformed counts, truncation, and trailing drift', () => {
  assert.throws(() => parseCollectionsDatabase(database(20220111, []), 'mcosu'), /newer than supported/)
  const negative = new BinaryWriter().int(20220110).int(-1).buffer()
  assert.throws(() => parseCollectionsDatabase(negative, 'mcosu'), /Invalid collection count/)
  const valid = new Uint8Array(database(20220110, [['A', [hash('a')]]]))
  assert.throws(() => parseCollectionsDatabase(valid.slice(0, -1).buffer, 'mcosu'), /Unexpected end/)
  const trailing = new Uint8Array(valid.length + 1)
  trailing.set(valid)
  assert.throws(() => parseCollectionsDatabase(trailing.buffer, 'mcosu'), /trailing/)
})

function database(version: number, collections: readonly (readonly [string, readonly string[]])[]): ArrayBuffer {
  const writer = new BinaryWriter().int(version).int(collections.length)
  for (const [name, hashes] of collections) {
    writer.string(name).int(hashes.length)
    for (const value of hashes) writer.string(value)
  }
  return writer.buffer()
}

function hash(character: string): string { return character.repeat(32) }

class BinaryWriter {
  readonly bytes: number[] = []
  int(value: number): this {
    const data = new Uint8Array(4)
    new DataView(data.buffer).setInt32(0, value, true)
    this.bytes.push(...data)
    return this
  }
  string(value: string): this {
    const data = new TextEncoder().encode(value)
    this.bytes.push(0x0b, data.length, ...data)
    return this
  }
  buffer(): ArrayBuffer { return Uint8Array.from(this.bytes).buffer }
}
