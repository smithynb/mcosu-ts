import assert from 'node:assert/strict'
import test from 'node:test'

import { OsuFile, OsuFileFormatError } from '../src/data/OsuFile.ts'

function bufferOf(bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

test('reads signed little-endian integers and booleans', () => {
  const bytes = new Uint8Array(17)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, 0xfe)
  view.setInt16(1, -12_345, true)
  view.setInt32(3, -123_456_789, true)
  view.setBigInt64(7, -9_007_199_254_740_991n, true)
  view.setUint8(15, 1)
  view.setUint8(16, 0)

  const reader = new OsuFile(bytes.buffer)
  assert.equal(reader.readByte(), 0xfe)
  assert.equal(reader.readShort(), -12_345)
  assert.equal(reader.readInt(), -123_456_789)
  assert.equal(reader.readLongLong(), -9_007_199_254_740_991n)
  assert.equal(reader.readBool(), true)
  assert.equal(reader.readBool(), false)
})

test('reads ULEB128 boundary values', () => {
  const reader = new OsuFile(bufferOf([0x00, 0x7f, 0x80, 0x01, 0xff, 0x01, 0x80, 0x80, 0x01]))
  assert.equal(reader.readULEB128(), 0n)
  assert.equal(reader.readULEB128(), 127n)
  assert.equal(reader.readULEB128(), 128n)
  assert.equal(reader.readULEB128(), 255n)
  assert.equal(reader.readULEB128(), 16_384n)
})

test('reads empty and UTF-8 strings', () => {
  const encoded = new TextEncoder().encode('café')
  const reader = new OsuFile(bufferOf([0x00, 0x0b, encoded.length, ...encoded]))
  assert.equal(reader.readString(), '')
  assert.equal(reader.readString(), 'café')
  assert.equal(reader.remaining, 0)
})

test('reads floating-point values and .NET DateTime ticks', () => {
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  view.setFloat32(0, 9.5, true)
  view.setFloat64(4, Math.PI, true)
  view.setBigInt64(12, 621_355_968_000_000_000n, true)

  const reader = new OsuFile(bytes.buffer)
  assert.equal(reader.readFloat(), 9.5)
  assert.equal(reader.readDouble(), Math.PI)
  assert.equal(reader.readDateTime().toISOString(), '1970-01-01T00:00:00.000Z')
})

test('skip helpers advance without interpreting values', () => {
  const reader = new OsuFile(bufferOf([0xaa, 0xbb, 0x00, 0x0b, 0x03, 0x66, 0x6f, 0x6f, 0xcc]))
  reader.skip(2)
  reader.skipString()
  reader.skipString()
  assert.equal(reader.readByte(), 0xcc)
})

test('rejects malformed strings, oversized ULEB128 values, and truncated reads', () => {
  assert.throws(() => new OsuFile(bufferOf([0x01])).readString(), OsuFileFormatError)
  assert.throws(
    () => new OsuFile(bufferOf([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80])).readULEB128(),
    OsuFileFormatError,
  )
  assert.throws(() => new OsuFile(bufferOf([0x01])).readInt(), RangeError)
})
