import { NativeWriteRefusal } from "./red-encoder";

/** An integer outside `[min, max]` is refused, never wrapped (NATIVE-73): a count or offset too big for its field is not written. */
function fits(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new NativeWriteRefusal(`${value} doesn't fit a ${field}.`);
  return value;
}
const U64_MAX = (1n << 64n) - 1n, I64_MIN = -(1n << 63n), I64_MAX = (1n << 63n) - 1n;

/** A growable little-endian byte buffer for the native writers. Every integer must fit its field. Pure. */
export class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(capacity = 256) {
    this.buffer = new Uint8Array(capacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  u8(value: number) { fits(value, 0, 0xff, "u8"); this.reserve(1); this.buffer[this.length++] = value; }
  i8(value: number) { fits(value, -0x80, 0x7f, "i8"); this.reserve(1); this.view.setInt8(this.length++, value); }
  u16(value: number) { fits(value, 0, 0xffff, "u16"); this.reserve(2); this.view.setUint16(this.length, value, true); this.length += 2; }
  i16(value: number) { fits(value, -0x8000, 0x7fff, "i16"); this.reserve(2); this.view.setInt16(this.length, value, true); this.length += 2; }
  u32(value: number) { fits(value, 0, 0xffffffff, "u32"); this.reserve(4); this.view.setUint32(this.length, value, true); this.length += 4; }
  i32(value: number) { fits(value, -0x80000000, 0x7fffffff, "i32"); this.reserve(4); this.view.setInt32(this.length, value, true); this.length += 4; }
  u64(value: bigint) {
    if (value < 0n || value > U64_MAX) throw new NativeWriteRefusal(`${value} doesn't fit a u64.`);
    this.reserve(8); this.view.setBigUint64(this.length, value, true); this.length += 8;
  }
  i64(value: bigint) {
    if (value < I64_MIN || value > I64_MAX) throw new NativeWriteRefusal(`${value} doesn't fit an i64.`);
    this.reserve(8); this.view.setBigInt64(this.length, value, true); this.length += 8;
  }
  f32(value: number) { this.reserve(4); this.view.setFloat32(this.length, value, true); this.length += 4; }
  f64(value: number) { this.reserve(8); this.view.setFloat64(this.length, value, true); this.length += 8; }
  bytes(data: Uint8Array) { this.reserve(data.length); this.buffer.set(data, this.length); this.length += data.length; }

  /** Overwrite a u32 already written at `at`. */
  patchU32(at: number, value: number) { this.view.setUint32(at, fits(value, 0, 0xffffffff, "u32"), true); }
  patchU16(at: number, value: number) { this.view.setUint16(at, fits(value, 0, 0xffff, "u16"), true); }

  /** The bytes written so far (a view; copy it before writing more if it must be kept). */
  view_(): Uint8Array { return this.buffer.subarray(0, this.length); }
  /** A copy of the bytes written. */
  toBytes(): Uint8Array { return this.buffer.slice(0, this.length); }
}
