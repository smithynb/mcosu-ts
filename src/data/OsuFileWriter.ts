const LITTLE_ENDIAN = true

/** Minimal little-endian counterpart to `OsuFile` for database exports. */
export class OsuFileWriter {
  readonly #bytes: number[] = []

  writeByte(value: number): void { this.#bytes.push(value & 0xff) }

  writeShort(value: number): void { this.#writeNumber(2, (view) => view.setInt16(0, value, LITTLE_ENDIAN)) }

  writeInt(value: number): void { this.#writeNumber(4, (view) => view.setInt32(0, value, LITTLE_ENDIAN)) }

  writeUnsignedLongLong(value: bigint): void {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError(`Unsigned 64-bit value out of range: ${value}`)
    this.#writeNumber(8, (view) => view.setBigUint64(0, value, LITTLE_ENDIAN))
  }

  writeFloat(value: number): void {
    if (!Number.isFinite(value)) throw new RangeError(`Float must be finite: ${value}`)
    this.#writeNumber(4, (view) => view.setFloat32(0, value, LITTLE_ENDIAN))
  }

  writeString(value: string): void {
    if (value.length === 0) {
      this.writeByte(0)
      return
    }
    const encoded = new TextEncoder().encode(value)
    this.writeByte(0x0b)
    this.writeULEB128(BigInt(encoded.length))
    for (const byte of encoded) this.#bytes.push(byte)
  }

  writeULEB128(value: bigint): void {
    if (value < 0n) throw new RangeError('ULEB128 cannot encode a negative value.')
    do {
      let byte = Number(value & 0x7fn)
      value >>= 7n
      if (value !== 0n) byte |= 0x80
      this.writeByte(byte)
    } while (value !== 0n)
  }

  toUint8Array(): Uint8Array { return Uint8Array.from(this.#bytes) }

  #writeNumber(length: number, write: (view: DataView) => void): void {
    const buffer = new ArrayBuffer(length)
    write(new DataView(buffer))
    for (const byte of new Uint8Array(buffer)) this.#bytes.push(byte)
  }
}
