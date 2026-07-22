/** A format-level failure: the bytes exist, but cannot represent an osu! value. */
export class OsuFileFormatError extends Error {
  readonly byteOffset: number

  constructor(message: string, byteOffset: number) {
    super(`${message} (at byte ${byteOffset})`)
    this.name = 'OsuFileFormatError'
    this.byteOffset = byteOffset
  }
}

export interface TimingPoint {
  readonly msPerBeat: number
  readonly offset: number
  readonly timingChange: boolean
}

const LITTLE_ENDIAN = true
const MAX_STRING_LENGTH = 4096
const DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000n
const TICKS_PER_MILLISECOND = 10_000n

/**
 * Bounds-checked, read-only port of McOsu's binary primitives.
 *
 * Ported from McOsu `OsuFile.cpp:163-339` and `OsuFile.h:57-70`. Unlike the
 * C++ reader, malformed/truncated input throws instead of returning zero, so a
 * corrupt entry cannot silently shift every field that follows it.
 */
export class OsuFile {
  readonly #view: DataView
  #offset = 0

  constructor(buffer: ArrayBuffer) {
    this.#view = new DataView(buffer)
  }

  get offset(): number {
    return this.#offset
  }

  get remaining(): number {
    return this.#view.byteLength - this.#offset
  }

  readByte(): number {
    this.#require(1)
    return this.#view.getUint8(this.#offset++)
  }

  readShort(): number {
    this.#require(2)
    const value = this.#view.getInt16(this.#offset, LITTLE_ENDIAN)
    this.#offset += 2
    return value
  }

  readInt(): number {
    this.#require(4)
    const value = this.#view.getInt32(this.#offset, LITTLE_ENDIAN)
    this.#offset += 4
    return value
  }

  readLongLong(): bigint {
    this.#require(8)
    const value = this.#view.getBigInt64(this.#offset, LITTLE_ENDIAN)
    this.#offset += 8
    return value
  }

  readUnsignedLongLong(): bigint {
    this.#require(8)
    const value = this.#view.getBigUint64(this.#offset, LITTLE_ENDIAN)
    this.#offset += 8
    return value
  }

  readULEB128(): bigint {
    const start = this.#offset
    let value = 0n

    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte()
      const payload = byte & 0x7f
      if (index === 9 && payload > 1) {
        throw new OsuFileFormatError('ULEB128 value exceeds 64 bits', start)
      }
      value |= BigInt(payload) << BigInt(index * 7)
      if ((byte & 0x80) === 0) return value
    }

    throw new OsuFileFormatError('ULEB128 value exceeds 10 bytes', start)
  }

  readFloat(): number {
    this.#require(4)
    const value = this.#view.getFloat32(this.#offset, LITTLE_ENDIAN)
    this.#offset += 4
    return value
  }

  readDouble(): number {
    this.#require(8)
    const value = this.#view.getFloat64(this.#offset, LITTLE_ENDIAN)
    this.#offset += 8
    return value
  }

  readBool(): boolean {
    return this.readByte() !== 0
  }

  readString(): string {
    const flagOffset = this.#offset
    const flag = this.readByte()
    if (flag === 0) return ''
    if (flag !== 0x0b) {
      throw new OsuFileFormatError(`Unknown string flag 0x${flag.toString(16)}`, flagOffset)
    }

    const encodedLength = this.readULEB128()
    if (encodedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new OsuFileFormatError('String length exceeds JavaScript safe integer range', this.#offset)
    }

    const length = Number(encodedLength)
    this.#require(length)
    // McOsu caps decoded strings while still consuming the complete value.
    const retainedLength = Math.min(length, MAX_STRING_LENGTH - 1)
    const bytes = new Uint8Array(
      this.#view.buffer,
      this.#view.byteOffset + this.#offset,
      retainedLength,
    )
    this.#offset += length
    return new TextDecoder('utf-8').decode(bytes)
  }

  /** Read a .NET DateTime tick count, as stored in the osu! database, as UTC. */
  readDateTime(): Date {
    const ticks = this.readLongLong()
    const milliseconds = Number((ticks - DOTNET_UNIX_EPOCH_TICKS) / TICKS_PER_MILLISECOND)
    const value = new Date(milliseconds)
    if (Number.isNaN(value.getTime())) {
      throw new OsuFileFormatError('DateTime ticks are outside the JavaScript Date range', this.#offset - 8)
    }
    return value
  }

  readTimingPoint(): TimingPoint {
    return {
      msPerBeat: this.readDouble(),
      offset: this.readDouble(),
      timingChange: this.readBool(),
    }
  }

  skip(byteCount: number): void {
    if (!Number.isSafeInteger(byteCount) || byteCount < 0) {
      throw new RangeError(`Invalid skip length: ${byteCount}`)
    }
    this.#require(byteCount)
    this.#offset += byteCount
  }

  skipString(): void {
    const flagOffset = this.#offset
    const flag = this.readByte()
    if (flag === 0) return
    if (flag !== 0x0b) {
      throw new OsuFileFormatError(`Unknown string flag 0x${flag.toString(16)}`, flagOffset)
    }
    const encodedLength = this.readULEB128()
    if (encodedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new OsuFileFormatError('String length exceeds JavaScript safe integer range', this.#offset)
    }
    this.skip(Number(encodedLength))
  }

  skipDateTime(): void {
    this.skip(8)
  }

  skipTimingPoint(): void {
    this.skip(17)
  }

  skipByteArray(maximumLength = 256 * 1024 * 1024): void {
    const lengthOffset = this.#offset
    const length = this.readInt()
    if (length < 0 || length > maximumLength) {
      throw new OsuFileFormatError(`Invalid byte-array length: ${length}`, lengthOffset)
    }
    this.skip(length)
  }

  #require(byteCount: number): void {
    if (byteCount > this.remaining) {
      throw new RangeError(
        `Unexpected end of file at byte ${this.#offset}: requested ${byteCount}, ${this.remaining} remaining`,
      )
    }
  }
}
