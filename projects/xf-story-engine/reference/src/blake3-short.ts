// BLAKE3 of a short message (one chunk, up to 1,024 bytes), for the hashes of the model. Every Id, every keyed draw and every sampled noise
// is the first 128 bits of BLAKE3 over a few dozen bytes, asked for millions of times in a run, and the general-purpose implementation
// spends much of that time making its hasher object. This one keeps its state in fixed arrays, allocates nothing, and can start from a
// chaining value that was worked out once for the fixed head of a message. It is the same function: the tests compare it with the library
// over random messages of every length, and a message longer than a chunk goes to the library.

const IV = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1;
const CHUNK_END = 2;
const ROOT = 8;

/** The longest message handled here: one chunk of sixteen blocks. */
export const SHORT_MAX = 1024;

/** The order in which each of the seven rounds reads the sixteen words of a block (the permutation applied round after round). */
const SCHED = (() => {
  const out = new Uint8Array(7 * 16);
  let order = Array.from({ length: 16 }, (_, n) => n);
  for (let r = 0; r < 7; r++) {
    for (let n = 0; n < 16; n++) out[r * 16 + n] = order[n]!;
    order = order.map((_, n) => order[PERM[n]!]!);
  }
  return out;
})();

const s = new Uint32Array(16);
const m = new Uint32Array(16);
const cv = new Uint32Array(8);
const result = new Uint8Array(16);
const resultView = new DataView(result.buffer);

/** Read the block at `off` into `m`: `avail` bytes are there (a full block when 64 or more), the words after them are zero. */
function loadBlock(view: DataView, off: number, avail: number): void {
  const n = avail >= 64 ? 64 : avail;
  const whole = n >> 2;
  for (let w = 0; w < whole; w++) m[w] = view.getUint32(off + 4 * w, true);
  let w = whole;
  const rest = n & 3;
  if (rest !== 0) {
    let v = 0;
    for (let k = rest - 1; k >= 0; k--) v = (v << 8) | view.getUint8(off + 4 * w + k);
    m[w++] = v >>> 0;
  }
  for (; w < 16; w++) m[w] = 0;
}

function g(a: number, b: number, c: number, d: number, mx: number, my: number): void {
  let sa = s[a]!;
  let sb = s[b]!;
  let sc = s[c]!;
  let sd = s[d]!;
  sa = (sa + sb + mx) >>> 0;
  sd = (sd ^ sa) >>> 0;
  sd = ((sd >>> 16) | (sd << 16)) >>> 0;
  sc = (sc + sd) >>> 0;
  sb = (sb ^ sc) >>> 0;
  sb = ((sb >>> 12) | (sb << 20)) >>> 0;
  sa = (sa + sb + my) >>> 0;
  sd = (sd ^ sa) >>> 0;
  sd = ((sd >>> 8) | (sd << 24)) >>> 0;
  sc = (sc + sd) >>> 0;
  sb = (sb ^ sc) >>> 0;
  sb = ((sb >>> 7) | (sb << 25)) >>> 0;
  s[a] = sa;
  s[b] = sb;
  s[c] = sc;
  s[d] = sd;
}

/** One compression at chunk counter 0: the chaining value `cvIn` and the block in `m`; the folded state is left in `s`. */
function compress(cvIn: Uint32Array, blockLen: number, flags: number): void {
  for (let n = 0; n < 8; n++) s[n] = cvIn[n]!;
  s[8] = IV[0]!;
  s[9] = IV[1]!;
  s[10] = IV[2]!;
  s[11] = IV[3]!;
  s[12] = 0;
  s[13] = 0;
  s[14] = blockLen;
  s[15] = flags;
  for (let r = 0; r < 7; r++) {
    const o = r * 16;
    g(0, 4, 8, 12, m[SCHED[o]!]!, m[SCHED[o + 1]!]!);
    g(1, 5, 9, 13, m[SCHED[o + 2]!]!, m[SCHED[o + 3]!]!);
    g(2, 6, 10, 14, m[SCHED[o + 4]!]!, m[SCHED[o + 5]!]!);
    g(3, 7, 11, 15, m[SCHED[o + 6]!]!, m[SCHED[o + 7]!]!);
    g(0, 5, 10, 15, m[SCHED[o + 8]!]!, m[SCHED[o + 9]!]!);
    g(1, 6, 11, 12, m[SCHED[o + 10]!]!, m[SCHED[o + 11]!]!);
    g(2, 7, 8, 13, m[SCHED[o + 12]!]!, m[SCHED[o + 13]!]!);
    g(3, 4, 9, 14, m[SCHED[o + 14]!]!, m[SCHED[o + 15]!]!);
  }
  for (let n = 0; n < 8; n++) {
    s[n] = s[n]! ^ s[n + 8]!;
    s[n + 8] = s[n + 8]! ^ cvIn[n]!;
  }
}

/** The first 128 bits of the root output, in the shared `result`. */
function rootOutput(): Uint8Array {
  resultView.setUint32(0, s[0]!, true);
  resultView.setUint32(4, s[1]!, true);
  resultView.setUint32(8, s[2]!, true);
  resultView.setUint32(12, s[3]!, true);
  return result;
}

/**
 * The blocks of a chunk from `first` on, chained from `start`, the last of them the root. `skipped` is the number of whole blocks that
 * came before `view` begins (only the very first block of the chunk carries CHUNK_START).
 */
function chunk(view: DataView, len: number, start: Uint32Array, skipped: number): Uint8Array {
  const blocks = len === 0 ? 1 : (len + 63) >> 6;
  cv.set(start);
  for (let b = 0; b < blocks; b++) {
    const off = b * 64;
    const avail = len - off;
    loadBlock(view, off, avail);
    const last = b === blocks - 1;
    compress(cv, avail >= 64 ? 64 : avail, (skipped === 0 && b === 0 ? CHUNK_START : 0) | (last ? CHUNK_END | ROOT : 0));
    if (!last) for (let n = 0; n < 8; n++) cv[n] = s[n]!;
  }
  return rootOutput();
}

/**
 * The first 128 bits of BLAKE3 of the first `len` bytes of `view` (at most `SHORT_MAX`), as 16 bytes. The array is shared: the next call
 * overwrites it, so a caller reads it at once.
 */
export function blake3Short(view: DataView, len: number): Uint8Array {
  return chunk(view, len, IV, 0);
}

/**
 * Messages that share a head. The head's whole blocks are compressed once, here; `hash` then takes what follows them (`tailLen` bytes
 * at the start of `tail`, at least one) and returns the same 16 bytes as hashing the whole message, or `undefined` when the message
 * would be longer than a chunk, which the caller hashes whole another way. `tailStart` is where the tail of the head itself begins, so a
 * caller writes the head's remaining bytes there and its own bytes after them.
 */
export function blake3Headed(head: Uint8Array): {
  tailStart: Uint8Array;
  hash: (tail: DataView, tailLen: number) => Uint8Array | undefined;
} {
  const skipped = head.length >> 6;
  const chain = new Uint32Array(8);
  chain.set(IV);
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  for (let b = 0; b < skipped; b++) {
    loadBlock(headView, b * 64, 64);
    compress(chain, 64, b === 0 ? CHUNK_START : 0);
    for (let n = 0; n < 8; n++) chain[n] = s[n]!;
  }
  return {
    tailStart: head.slice(skipped * 64),
    hash(tail: DataView, tailLen: number): Uint8Array | undefined {
      if (tailLen < 1 || skipped * 64 + tailLen > SHORT_MAX) return undefined;
      return chunk(tail, tailLen, chain, skipped);
    },
  };
}
