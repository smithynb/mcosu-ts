import assert from 'node:assert/strict'
import test from 'node:test'

import { parseOsuDatabase } from '../src/data/OsuDatabase.ts'

class Bytes {
  readonly values: number[] = []

  byte(value: number): void { this.values.push(value & 0xff) }
  bool(value: boolean): void { this.byte(value ? 1 : 0) }
  short(value: number): void { this.number(2, (view) => view.setInt16(0, value, true)) }
  int(value: number): void { this.number(4, (view) => view.setInt32(0, value, true)) }
  long(value = 0n): void { this.number(8, (view) => view.setBigInt64(0, value, true)) }
  float(value: number): void { this.number(4, (view) => view.setFloat32(0, value, true)) }
  double(value: number): void { this.number(8, (view) => view.setFloat64(0, value, true)) }

  string(value: string): void {
    if (value.length === 0) {
      this.byte(0)
      return
    }
    const encoded = new TextEncoder().encode(value)
    assert.ok(encoded.length < 128, 'fixture strings use one-byte ULEB128 lengths')
    this.byte(0x0b)
    this.byte(encoded.length)
    this.values.push(...encoded)
  }

  buffer(): ArrayBuffer { return Uint8Array.from(this.values).buffer }

  private number(size: number, write: (view: DataView) => void): void {
    const bytes = new Uint8Array(size)
    write(new DataView(bytes.buffer))
    this.values.push(...bytes)
  }
}

function databaseFixture(version: number, options: { mode?: number; extraByte?: boolean } = {}): ArrayBuffer {
  const out = new Bytes()
  out.int(version)
  out.int(1)
  out.bool(true)
  out.long()
  out.string('player')
  out.int(1)

  if (version < 20191107) out.int(0)
  for (const value of ['Artist', '', 'Title', '', 'Mapper', 'Hard', 'audio.mp3', 'hash', 'map.osu']) out.string(value)
  out.byte(4)
  out.short(10)
  out.short(20)
  out.short(1)
  out.long()
  out.float(9)
  out.float(4)
  out.float(6)
  out.float(8)
  out.double(1.4)

  out.int(1)
  out.byte(0x08)
  out.int(0)
  out.byte(version >= 20250108 ? 0x0c : 0x0d)
  if (version >= 20250108) out.float(5.25)
  else out.double(5.25)
  out.int(0)
  out.int(0)
  out.int(0)

  out.int(90)
  out.int(123_456)
  out.int(12_345)
  out.int(0)
  out.int(-1)
  out.int(-1)
  out.int(0)
  out.byte(0)
  out.byte(0)
  out.byte(0)
  out.byte(0)
  out.short(0)
  out.float(0.7)
  out.byte(options.mode ?? 0)
  out.string('Source')
  out.string('tags')
  out.short(0)
  out.string('')
  out.bool(false)
  out.long()
  out.bool(false)
  out.string('123 Artist - Title\\nested')
  out.long()
  for (let index = 0; index < 5; index += 1) out.bool(false)
  out.int(0)
  out.byte(0)
  out.int(0) // permissions trailer, ignored by McOsu
  if (options.extraByte) out.byte(0xff)
  return out.buffer()
}

for (const version of [20170222, 20191114, 20250108, 20251231]) {
  test(`parses osu!.db layout for version ${version}`, () => {
    const result = parseOsuDatabase(databaseFixture(version))
    assert.equal(result.version, version)
    assert.equal(result.beatmaps.length, 1)
    assert.deepEqual(result.beatmaps[0], {
      artist: 'Artist',
      title: 'Title',
      creator: 'Mapper',
      difficultyName: 'Hard',
      audioFile: 'audio.mp3',
      md5: 'hash',
      osuPath: '123 Artist - Title/nested/map.osu',
      folder: '123 Artist - Title/nested',
      ar: 9,
      cs: 4,
      hp: 6,
      od: 8,
      starRating: 5.25,
      length: 123_456,
      mode: 0,
      localOffset: 0,
    })
  })
}

test('rejects an invalid mode as entry misalignment', () => {
  assert.throws(() => parseOsuDatabase(databaseFixture(20250108, { mode: 9 })), /entry 1.*misaligned.*mode 9/i)
})

test('rejects unexpected trailing bytes instead of returning garbage', () => {
  assert.throws(() => parseOsuDatabase(databaseFixture(20250108, { extraByte: true })), /trailing bytes/i)
})
