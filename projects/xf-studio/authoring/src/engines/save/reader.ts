/**
 * A bounded little-endian cursor over save bytes (knowledge/save-files.md §1). Pure. Every read checks the bytes left, VLQs and strings
 * are capped, and counts are refused past a caller's limit, so a hostile save can't make a read run past its buffer or allocate much.
 * The save's strings are signed-VLQ lengths: positive for UTF-16 code units, negative for UTF-8 bytes [source: WolvenKit
 * `CyberpunkSaveReader` at 11720772; studied only].
 */
export class Reader {
  pos = 0;
  view: DataView;
  constructor(public bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.bytes.length) throw Error("Truncated or invalid save data");
    const b = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  u8() { return this.take(1)[0]!; }
  u16() { const p = this.pos; this.take(2); return this.view.getUint16(p, true); }
  u32() { const p = this.pos; this.take(4); return this.view.getUint32(p, true); }
  i32() { const p = this.pos; this.take(4); return this.view.getInt32(p, true); }
  /** A u64 as its decimal text (exact). */
  u64() { const p = this.pos; this.take(8); return this.view.getBigUint64(p, true).toString(); }
  bool() {
    const b = this.u8();
    if (b > 1) throw Error("Invalid boolean");
    return b === 1;
  }
  vlq() {
    const b = this.u8(), negative = !!(b & 128);
    let n = b & 63, more = !!(b & 64), shift = 6;
    while (more) {
      if (shift > 27) throw Error("Invalid VLQ");
      const q = this.u8();
      n += (q & 127) * 2 ** shift;
      more = !!(q & 128);
      shift += 7;
    }
    if (n > 0x7fffffff) throw Error("VLQ overflow");
    return negative ? -n : n;
  }
  text() {
    const n = this.vlq();
    if (Math.abs(n) > 65536) throw Error("Save string too long");
    const bytes = this.take(Math.abs(n) * (n > 0 ? 2 : 1));
    // A string that doesn't decode is bad save data like any other, not a decoder failure (SAVE-09).
    try { return new TextDecoder(n > 0 ? "utf-16le" : "utf-8", { fatal: true }).decode(bytes); } catch { throw Error("Invalid save string"); }
  }
  count(max = 4096) {
    const n = this.u32();
    if (n > max) throw Error("Save collection exceeds supported size");
    return n;
  }
}
