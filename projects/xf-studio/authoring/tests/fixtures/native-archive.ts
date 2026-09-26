/**
 * Synthetic RDAR archives for the native reader's tests (no game data). Layout as in src/native/rdar-archive.ts. Compressed
 * segments use a stand-in codec (`fakeCompress`/`fakeDecompress`: bytes XOR 0x5A) behind a real `KARK` header, so the tests
 * exercise the container logic without the game's Oodle library.
 */
import { depotHash } from "../../src/depot-path";
import { NativeDecompressError } from "../../src/native/native-errors";

export const fakeCompress = (raw: Uint8Array) => raw.map(byte => byte ^ 0x5a);
/** The stand-in codec's decoder; like the real one it refuses a stream it cannot decode with `NativeDecompressError`. */
export const fakeDecompress = (stored: Uint8Array, size: number) => {
  if (stored.length !== size) throw new NativeDecompressError("fake codec: size mismatch");
  return stored.map(byte => byte ^ 0x5a);
};
/** A decoder that spins for three seconds first (for the worker's time budget). */
export const slowDecompress = (stored: Uint8Array, size: number) => {
  const until = Date.now() + 3000;
  while (Date.now() < until) { /* spin */ }
  return fakeDecompress(stored, size);
};

export interface SyntheticFile {
  path: string;
  /** The body, then any buffers; `compress` stores a segment behind a KARK header. */
  segments: { bytes: Uint8Array; compress?: boolean }[];
  dependencies?: string[];
  inlineBuffers?: number;
}

export const kark = (raw: Uint8Array) => {
  const out = new Uint8Array(8 + raw.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x4b52414b, true); view.setUint32(4, raw.length, true);
  out.set(fakeCompress(raw), 8);
  return out;
};

/** An archive holding `files`, optionally with an `LXRS` name block (stored raw) listing their paths. */
export function syntheticArchive(files: SyntheticFile[], options: { names?: boolean; gap?: boolean } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let cursor = 0x1000;
  const segments: { offset: number; stored: number; size: number }[] = [];
  const entries: { hash: bigint; start: number; end: number; depStart: number; depEnd: number; inline: number }[] = [];
  const dependencies: bigint[] = [];
  for (const file of files) {
    const start = segments.length;
    file.segments.forEach(segment => {
      const stored = segment.compress ? kark(segment.bytes) : segment.bytes;
      segments.push({ offset: cursor, stored: stored.length, size: segment.bytes.length });
      chunks.push(stored); cursor += stored.length;
      if (options.gap) { chunks.push(new Uint8Array(3)); cursor += 3; }
    });
    const depStart = dependencies.length;
    for (const path of file.dependencies ?? []) dependencies.push(BigInt(depotHash(path)));
    entries.push({ hash: BigInt(depotHash(file.path)), start, end: segments.length, depStart, depEnd: dependencies.length, inline: file.inlineBuffers ?? 0 });
  }
  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const indexSize = 28 + entries.length * 56 + segments.length * 16 + dependencies.length * 8;
  const indexOffset = cursor;
  const total = indexOffset + indexSize;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x52414452, true); view.setUint32(4, 12, true);
  view.setBigUint64(8, BigInt(indexOffset), true); view.setUint32(16, indexSize, true);
  view.setBigUint64(32, BigInt(total), true);
  if (options.names) {
    const text = new TextEncoder().encode(files.map(file => `${file.path}\0`).join(""));
    const block = new Uint8Array(20 + text.length);
    const blockView = new DataView(block.buffer);
    blockView.setUint32(0, 0x4c585253, true); blockView.setUint32(4, 1, true);
    blockView.setUint32(8, text.length, true); blockView.setUint32(12, text.length, true); blockView.setUint32(16, files.length, true);
    block.set(text, 20);
    view.setUint32(40, block.length, true);
    out.set(block, 172);
  }
  let at = 0x1000;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  const index = indexOffset;
  view.setUint32(index, 8, true); view.setUint32(index + 4, indexSize - 8, true);
  view.setUint32(index + 16, entries.length, true); view.setUint32(index + 20, segments.length, true); view.setUint32(index + 24, dependencies.length, true);
  entries.forEach((entry, i) => {
    const o = index + 28 + i * 56;
    view.setBigUint64(o, entry.hash, true); view.setBigInt64(o + 8, 1n, true);
    view.setUint32(o + 16, entry.inline, true); view.setUint32(o + 20, entry.start, true); view.setUint32(o + 24, entry.end, true);
    view.setUint32(o + 28, entry.depStart, true); view.setUint32(o + 32, entry.depEnd, true);
  });
  const segmentsAt = index + 28 + entries.length * 56;
  segments.forEach((segment, i) => {
    view.setBigUint64(segmentsAt + i * 16, BigInt(segment.offset), true);
    view.setUint32(segmentsAt + i * 16 + 8, segment.stored, true); view.setUint32(segmentsAt + i * 16 + 12, segment.size, true);
  });
  const dependenciesAt = segmentsAt + segments.length * 16;
  dependencies.forEach((hash, i) => view.setBigUint64(dependenciesAt + i * 8, hash, true));
  return out;
}
