import assert from 'node:assert/strict'
import test from 'node:test'
import {
  indexScoresByMd5,
  modsFromLegacy,
  parseMcOsuScoresDatabase,
  parseScoresDatabase,
  parseStableScoresDatabase,
} from '../src/data/ScoresDatabase.ts'

const MD5 = '0123456789abcdef0123456789abcdef'
const WINDOWS_EPOCH_TICKS = 621_355_968_000_000_000n

test('parses osu!stable score gates, target payload, mode filter, and timestamp', () => {
  const writer = new Writer()
  writer.int(20250701).int(1).string(MD5).int(2)
  writeStableScore(writer, { mode: 0, version: 20131110, player: 'Alice', score: 987654, mods: 8 | 64 | 8_388_608 })
  writeStableScore(writer, { mode: 1, version: 20121008, player: 'Taiko', score: 123, mods: 0 })
  const result = parseStableScoresDatabase(writer.buffer())
  assert.equal(result.format, 'stable')
  assert.equal(result.scores.length, 1)
  const score = result.scores[0]!
  assert.equal(score.playerName, 'Alice')
  assert.equal(score.score, 987654n)
  assert.equal(score.modAcronyms, 'HDDT')
  assert.equal(score.grade, 'XH')
  assert.equal(score.speedMultiplier, 1.5)
  assert.equal(score.playedAt.toISOString(), '2024-01-01T00:00:00.000Z')
})

test('parses McOsu extended fields and imported-legacy flag semantics', () => {
  const writer = new Writer()
  writer.int(20210110).int(1).string(MD5).int(1)
  writeMcOsuScore(writer, { flags: 0xa9, version: 20200101, score: 5_000_000_000n, pp: 123.5 })
  const result = parseMcOsuScoresDatabase(writer.buffer())
  assert.equal(result.format, 'mcosu')
  const score = result.scores[0]!
  assert.equal(score.importedLegacy, true)
  assert.equal(score.score, 5_000_000_000n)
  assert.equal(score.pp, 123.5)
  assert.equal(score.sliderBreaks, 2)
  assert.equal(score.perfect, true)
  assert.equal(score.playedAt.toISOString(), '2024-01-01T00:00:00.000Z')
})

test('custom 20210103 reads the dedicated imported bool', () => {
  const writer = new Writer()
  writer.int(20210103).int(1).string(MD5).int(1)
  writeMcOsuScore(writer, { flags: 0, version: 20200101, importedBool: true })
  assert.equal(parseMcOsuScoresDatabase(writer.buffer()).scores[0]?.importedLegacy, true)
})

test('auto parser falls back to McOsu and score index sorts by exact score', () => {
  const writer = new Writer()
  writer.int(20210110).int(1).string(MD5).int(2)
  writeMcOsuScore(writer, { flags: 0, version: 20180101, score: 10n, player: 'Low' })
  writeMcOsuScore(writer, { flags: 0, version: 20180101, score: 20n, player: 'High' })
  const parsed = parseScoresDatabase(writer.buffer())
  assert.equal(parsed.format, 'mcosu')
  const indexed = indexScoresByMd5(parsed.scores)
  assert.deepEqual(indexed.get(MD5)?.map((score) => score.playerName), ['High', 'Low'])
})

test('rejects malformed hashes, unsupported custom versions, and trailing drift', () => {
  const badHash = new Writer().int(2025).int(1).string('short').int(0).buffer()
  assert.throws(() => parseStableScoresDatabase(badHash), /Invalid MD5/)

  const future = new Writer().int(20210111).int(0).buffer()
  assert.throws(() => parseMcOsuScoresDatabase(future), /newer than supported/)

  const trailing = new Writer().int(2025).int(0).byte(1).buffer()
  assert.throws(() => parseStableScoresDatabase(trailing), /trailing bytes/)
})

test('legacy mod labels collapse NC/DT and PF/SD pairs', () => {
  assert.equal(modsFromLegacy(64 | 512 | 32 | 16384), 'NCPF')
  assert.equal(modsFromLegacy(0), 'NM')
})

function writeStableScore(
  writer: Writer,
  options: { mode: number; version: number; player: string; score: number; mods: number },
): void {
  writer.byte(options.mode).int(options.version).string(MD5).string(options.player).string('replay')
  writer.short(10).short(0).short(0).short(0).short(0).short(0)
  writer.int(options.score).short(10).byte(1).int(options.mods).string('1|1').long(
    WINDOWS_EPOCH_TICKS + 1_704_067_200_000n * 10_000n,
  )
  writer.byteArray([1, 2, 3])
  if (options.version >= 20131110) writer.long(99n)
  else if (options.version >= 20121008) writer.int(99)
  if ((options.mods & 8_388_608) !== 0) writer.double(0.99)
}

function writeMcOsuScore(
  writer: Writer,
  options: {
    flags: number
    version: number
    score?: bigint
    pp?: number
    player?: string
    importedBool?: boolean
  },
): void {
  writer.byte(options.flags).int(options.version)
  if (options.importedBool !== undefined) writer.byte(options.importedBool ? 1 : 0)
  writer.ulong(1_704_067_200n).string(options.player ?? 'McOsu')
  writer.short(10).short(0).short(0).short(0).short(0).short(0)
  writer.ulong(options.score ?? 1_000n).short(10).int(8).short(2)
  writer.float(options.pp ?? 50).float(100).float(-2).float(3)
  writer.float(4).float(2).float(1).float(1.5)
  writer.float(4).float(9).float(8).float(6)
  if (options.version > 20180722) writer.int(10).int(10).int(10)
  writer.string('')
}

class Writer {
  readonly bytes: number[] = []

  byte(value: number): this { this.bytes.push(value & 0xff); return this }
  short(value: number): this { return this.number(2, (view) => view.setInt16(0, value, true)) }
  int(value: number): this { return this.number(4, (view) => view.setInt32(0, value, true)) }
  long(value: bigint): this { return this.number(8, (view) => view.setBigInt64(0, value, true)) }
  ulong(value: bigint): this { return this.number(8, (view) => view.setBigUint64(0, value, true)) }
  float(value: number): this { return this.number(4, (view) => view.setFloat32(0, value, true)) }
  double(value: number): this { return this.number(8, (view) => view.setFloat64(0, value, true)) }

  string(value: string): this {
    if (value.length === 0) return this.byte(0)
    const encoded = new TextEncoder().encode(value)
    this.byte(0x0b).uleb(encoded.length)
    this.bytes.push(...encoded)
    return this
  }

  byteArray(value: readonly number[]): this {
    this.int(value.length)
    this.bytes.push(...value)
    return this
  }

  uleb(value: number): this {
    let remaining = value
    do {
      let byte = remaining & 0x7f
      remaining >>>= 7
      if (remaining > 0) byte |= 0x80
      this.byte(byte)
    } while (remaining > 0)
    return this
  }

  buffer(): ArrayBuffer { return Uint8Array.from(this.bytes).buffer }

  private number(size: number, write: (view: DataView) => void): this {
    const buffer = new ArrayBuffer(size)
    write(new DataView(buffer))
    this.bytes.push(...new Uint8Array(buffer))
    return this
  }
}
