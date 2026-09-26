/**
 * Block-compressed texture decoding (BC1, BC3, BC4, BC5, BC7) into RGBA8, written from the format specifications: the Khronos Data
 * Format Specification 1.3, §18 (S3TC: BC1, BC3), §19 (RGTC: BC4, BC5) and §20.1 (BPTC: BC7), whose partition and anchor tables are
 * reproduced below. Pure; no allocation beyond the output image.
 *
 * A block is 4×4 texels. An image `width`×`height` holds ceil(width/4)×ceil(height/4) blocks row by row; texels of edge blocks past
 * the image are dropped. Every decoder writes all four channels of every texel it covers:
 *
 * - BC1 (8 bytes): RGB, alpha 255 (the three-colour mode's fourth colour is black with alpha 0).
 * - BC3 (16 bytes): a BC4-style alpha block, then a BC1 colour block (always four-colour).
 * - BC4 (8 bytes): one channel, written as grey (R = G = B), alpha 255, as WolvenKit's PNG of a one-channel map reads.
 * - BC5 (16 bytes): two BC4 blocks, red then green; blue 0, alpha 255 (no Z reconstruction: the preview's shaders rebuild Z from XY,
 *   and WolvenKit's PNGs of BC5 maps carry blue 0 as well).
 * - BC7 (16 bytes): RGBA, exact integer arithmetic as the specification defines it.
 *
 * All of them interpolate in single precision; BC1, BC3 and BC5 round to nearest and a lone BC4 channel truncates, which is what
 * WolvenKit's PNG export (through DirectXTex) yields. A decoder with other rounding differs by at most one level in interpolated values. The oracle comparison and
 * its measured error are recorded in knowledge/archive-format.md §10.
 */
import { NativeMalformedError } from "./native-errors";

export type BlockFormat = "bc1" | "bc3" | "bc4" | "bc5" | "bc7";

/** Bytes per 4×4 block. */
export const BLOCK_BYTES: Readonly<Record<BlockFormat, number>> = { bc1: 8, bc3: 16, bc4: 8, bc5: 16, bc7: 16 };

/** Bytes a `width`×`height` image takes in `format`. */
export function blockImageBytes(format: BlockFormat, width: number, height: number): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * BLOCK_BYTES[format];
}

const f32 = Math.fround;
const THIRD = f32(1 / 3), TWO_THIRDS = f32(2 / 3), HALF = f32(0.5);
/** A float in [0, 1] to an 8-bit level: saturate, scale, round half to even (SSE `cvtps2dq`). */
function unorm8(value: number): number {
  const scaled = f32(f32(Math.min(1, Math.max(0, value))) * 255);
  const floor = Math.floor(scaled), fraction = scaled - floor;
  return fraction > 0.5 || (fraction === 0.5 && (floor & 1)) ? floor + 1 : floor;
}
/** `a + t × (b − a)` in single precision (DirectXMath `XMVectorLerp`). */
const lerp = (a: number, b: number, t: number) => f32(a + f32(t * f32(b - a)));

const R5 = Array.from({ length: 32 }, (_, v) => f32(v * f32(1 / 31)));
const G6 = Array.from({ length: 64 }, (_, v) => f32(v * f32(1 / 63)));
const U8 = Array.from({ length: 256 }, (_, v) => f32(v * f32(1 / 255)));

/** The four colours of a BC1-style block (RGBA, 16 levels), `opaque` forcing the four-colour mode (BC3). */
function colourPalette(bytes: Uint8Array, at: number, opaque: boolean, out: Uint8Array): void {
  const c0 = bytes[at]! | bytes[at + 1]! << 8, c1 = bytes[at + 2]! | bytes[at + 3]! << 8;
  const r0 = R5[c0 >> 11]!, g0 = G6[c0 >> 5 & 63]!, b0 = R5[c0 & 31]!;
  const r1 = R5[c1 >> 11]!, g1 = G6[c1 >> 5 & 63]!, b1 = R5[c1 & 31]!;
  out[0] = unorm8(r0); out[1] = unorm8(g0); out[2] = unorm8(b0); out[3] = 255;
  out[4] = unorm8(r1); out[5] = unorm8(g1); out[6] = unorm8(b1); out[7] = 255;
  if (opaque || c0 > c1) {
    out[8] = unorm8(lerp(r0, r1, THIRD)); out[9] = unorm8(lerp(g0, g1, THIRD)); out[10] = unorm8(lerp(b0, b1, THIRD)); out[11] = 255;
    out[12] = unorm8(lerp(r0, r1, TWO_THIRDS)); out[13] = unorm8(lerp(g0, g1, TWO_THIRDS)); out[14] = unorm8(lerp(b0, b1, TWO_THIRDS)); out[15] = 255;
  } else {
    out[8] = unorm8(lerp(r0, r1, HALF)); out[9] = unorm8(lerp(g0, g1, HALF)); out[10] = unorm8(lerp(b0, b1, HALF)); out[11] = 255;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 0;
  }
}

/**
 * The eight levels of a BC4-style block (unsigned), interpolated in single precision. `truncate` (a lone BC4 channel): the weighted sum
 * is scaled by the reciprocal of 7 or 5 and the level truncated, which is what WolvenKit's PNGs of BC4 maps hold (all 94,696 distinct
 * endpoint and index combinations of three real maps agree); otherwise divided and rounded to nearest (BC3 alpha, BC5).
 */
function channelPalette(bytes: Uint8Array, at: number, out: Uint8Array, truncate = false): void {
  const e0 = bytes[at]!, e1 = bytes[at + 1]!, a = U8[e0]!, b = U8[e1]!;
  out[0] = e0; out[1] = e1;
  const level = (w0: number, w1: number, d: number) => truncate
    ? Math.floor(f32(f32(f32(f32(a * w0) + f32(b * w1)) * RECIPROCAL[d]!) * 255))
    : unorm8(f32(f32(f32(a * w0) + f32(b * w1)) / d));
  if (e0 > e1) {
    for (let i = 1; i < 7; i++) out[i + 1] = level(7 - i, i, 7);
  } else {
    for (let i = 1; i < 5; i++) out[i + 1] = level(5 - i, i, 5);
    out[6] = 0; out[7] = 255;
  }
}
const RECIPROCAL: Readonly<Record<number, number>> = { 5: f32(1 / 5), 7: f32(1 / 7) };

/** The 3-bit index of texel `i` (0..15) of a BC4-style block starting at `at`. */
function channelIndex(bytes: Uint8Array, at: number, i: number): number {
  const bit = 16 + i * 3, byte = at + (bit >> 3), shift = bit & 7;
  return ((bytes[byte]! | (bytes[byte + 1] ?? 0) << 8) >> shift) & 7;
}

function checkSize(format: BlockFormat, bytes: Uint8Array, width: number, height: number): void {
  if (!(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height))) throw new NativeMalformedError(`A ${width}×${height} texture has no texels.`);
  const need = blockImageBytes(format, width, height);
  if (bytes.length < need) throw new NativeMalformedError(`A ${width}×${height} ${format.toUpperCase()} image needs ${need} bytes; ${bytes.length} are there.`);
}

/**
 * Decodes one row of blocks (four texel rows) at a time, so an image never has to be whole in memory: `row(by)` fills `rows`, four
 * texel rows of `width` RGBA8 texels (rows past the image's bottom edge hold the block's padding).
 */
export class BlockRowDecoder {
  readonly rows: Uint8Array;
  private readonly texels = new Uint8Array(64);
  private readonly colours = new Uint8Array(16);
  private readonly levels = new Uint8Array(8);
  private readonly levels2 = new Uint8Array(8);
  private readonly bc7: Bc7Block | null;
  readonly blocksWide: number;
  readonly blocksHigh: number;
  constructor(readonly format: BlockFormat, private readonly bytes: Uint8Array, readonly width: number, readonly height: number) {
    checkSize(format, bytes, width, height);
    this.blocksWide = Math.ceil(width / 4); this.blocksHigh = Math.ceil(height / 4);
    this.rows = new Uint8Array(width * 16);
    this.bc7 = format === "bc7" ? new Bc7Block() : null;
  }

  /** Decode block `bx`, `by` into `texels` (16 RGBA texels, row by row). */
  block(bx: number, by: number, texels = this.texels): Uint8Array {
    const { format, bytes, colours, levels, levels2 } = this;
    const at = (by * this.blocksWide + bx) * BLOCK_BYTES[format];
    switch (format) {
      case "bc1": case "bc3": {
        const colourAt = format === "bc1" ? at : at + 8;
        colourPalette(bytes, colourAt, format === "bc3", colours);
        const bits = (bytes[colourAt + 4]! | bytes[colourAt + 5]! << 8 | bytes[colourAt + 6]! << 16 | bytes[colourAt + 7]! << 24) >>> 0;
        for (let i = 0; i < 16; i++) {
          const index = (bits >>> (i * 2)) & 3;
          texels[i * 4] = colours[index * 4]!; texels[i * 4 + 1] = colours[index * 4 + 1]!;
          texels[i * 4 + 2] = colours[index * 4 + 2]!; texels[i * 4 + 3] = colours[index * 4 + 3]!;
        }
        if (format === "bc3") {
          channelPalette(bytes, at, levels);
          for (let i = 0; i < 16; i++) texels[i * 4 + 3] = levels[channelIndex(bytes, at, i)]!;
        }
        break;
      }
      case "bc4": case "bc5": {
        channelPalette(bytes, at, levels, format === "bc4");
        if (format === "bc5") channelPalette(bytes, at + 8, levels2);
        for (let i = 0; i < 16; i++) {
          const red = levels[channelIndex(bytes, at, i)]!;
          texels[i * 4] = red;
          texels[i * 4 + 1] = format === "bc5" ? levels2[channelIndex(bytes, at + 8, i)]! : red;
          texels[i * 4 + 2] = format === "bc5" ? 0 : red; texels[i * 4 + 3] = 255;
        }
        break;
      }
      case "bc7": this.bc7!.decode(bytes, at, texels); break;
    }
    return texels;
  }

  /** Decode block row `by` into `rows`. */
  row(by: number): Uint8Array {
    const { width, rows, texels } = this;
    for (let bx = 0; bx < this.blocksWide; bx++) {
      this.block(bx, by);
      const x0 = bx * 4, w = Math.min(4, width - x0);
      for (let y = 0; y < 4; y++) rows.set(texels.subarray(y * 16, y * 16 + w * 4), (y * width + x0) * 4);
    }
    return rows;
  }

  /**
   * Whether any texel's alpha is below 255, decided per block from what can carry alpha: BC1's three-colour blocks, BC3's alpha
   * palette, BC7's modes 4 to 7 (decoded); BC4 and BC5 are opaque.
   */
  hasAlpha(): boolean {
    const { format, bytes, levels } = this;
    if (format === "bc4" || format === "bc5") return false;
    const size = BLOCK_BYTES[format], texels = new Uint8Array(64);
    for (let by = 0; by < this.blocksHigh; by++) for (let bx = 0; bx < this.blocksWide; bx++) {
      const at = (by * this.blocksWide + bx) * size;
      const w = Math.min(4, this.width - bx * 4), h = Math.min(4, this.height - by * 4);
      const inside = (i: number) => (i & 3) < w && (i >> 2) < h;
      if (format === "bc1") {
        const c0 = bytes[at]! | bytes[at + 1]! << 8, c1 = bytes[at + 2]! | bytes[at + 3]! << 8;
        if (c0 > c1) continue;
        const bits = (bytes[at + 4]! | bytes[at + 5]! << 8 | bytes[at + 6]! << 16 | bytes[at + 7]! << 24) >>> 0;
        for (let i = 0; i < 16; i++) if (inside(i) && ((bits >>> (i * 2)) & 3) === 3) return true;
      } else if (format === "bc3") {
        channelPalette(bytes, at, levels);
        for (let i = 0; i < 16; i++) if (inside(i) && levels[channelIndex(bytes, at, i)]! < 255) return true;
      } else {
        // Modes 0 to 3 carry no alpha (255); the mode is the number of zero bits below the first one bit.
        const low = bytes[at]!;
        if (low & 0x0f) continue;
        this.block(bx, by, texels);
        for (let i = 0; i < 16; i++) if (inside(i) && texels[i * 4 + 3]! < 255) return true;
      }
    }
    return false;
  }
}

/** Decode `width`×`height` texels of `format` blocks into a new RGBA8 array. */
export function decodeBlocks(format: BlockFormat, bytes: Uint8Array, width: number, height: number): Uint8Array {
  const decoder = new BlockRowDecoder(format, bytes, width, height), out = new Uint8Array(width * height * 4);
  for (let by = 0; by < decoder.blocksHigh; by++) {
    const rows = decoder.row(by), h = Math.min(4, height - by * 4);
    out.set(rows.subarray(0, h * width * 4), by * 4 * width * 4);
  }
  return out;
}

// --- BC7 (BPTC unorm) -------------------------------------------------------------------------------------------------------------

/** Per mode: subsets, partition bits, rotation bits, index-selection bit, colour bits, alpha bits, per-endpoint p-bits, shared p-bits, index bits, secondary index bits (Khronos DFS 1.3 Table 109). */
const MODES: readonly (readonly [number, number, number, number, number, number, number, number, number, number])[] = [
  [3, 4, 0, 0, 4, 0, 1, 0, 3, 0],
  [2, 6, 0, 0, 6, 0, 0, 1, 3, 0],
  [3, 6, 0, 0, 5, 0, 0, 0, 2, 0],
  [2, 6, 0, 0, 7, 0, 1, 0, 2, 0],
  [1, 0, 2, 1, 5, 6, 0, 0, 2, 3],
  [1, 0, 2, 0, 7, 8, 0, 0, 2, 2],
  [1, 0, 0, 0, 7, 7, 1, 0, 4, 0],
  [2, 6, 0, 0, 5, 5, 1, 0, 2, 0],
];
const WEIGHTS: Readonly<Record<number, readonly number[]>> = {
  2: [0, 21, 43, 64],
  3: [0, 9, 18, 27, 37, 46, 55, 64],
  4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
};
/** Two-subset partitions (Table 114): bit i is the subset of texel i. */
const PARTITIONS_2 = Uint16Array.from([
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000,
  0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
  0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660,
  0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22,
]);
/** Three-subset partitions (Table 115): 2 bits per texel, texel i at bits 2i..2i+1. */
const PARTITIONS_3 = Uint32Array.from([
  0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050, 0xaa550000, 0xaa555500, 0xaaaa5500, 0x90909090,
  0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250, 0xa5945040, 0x0a425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040, 0xa4a45000, 0x1a1a0500,
  0x0050a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200, 0xa9a58000, 0x5090a0a8, 0xa8a09050, 0x24242424,
  0x00aa5500, 0x24924924, 0x24499224, 0x50a50a50, 0x500aa550, 0xaaaa4444, 0x66660000, 0xa5a0a5a0, 0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600,
  0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414, 0x96960000, 0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000,
  0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254,
]);
/** Anchor texel of subset 1 in two-subset partitions (Table 118), and of subsets 1 and 2 in three-subset ones (Tables 116 and 117). */
const ANCHOR_2 = Uint8Array.from([
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
]);
const ANCHOR_3_2 = Uint8Array.from([
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
]);
const ANCHOR_3_3 = Uint8Array.from([
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
]);

/** The subset of texel `i` in partition `p` of an `subsets`-subset mode. */
export function bc7Subset(subsets: number, p: number, i: number): number {
  return subsets === 1 ? 0 : subsets === 2 ? (PARTITIONS_2[p]! >> i) & 1 : (PARTITIONS_3[p]! >>> (i * 2)) & 3;
}
/** Whether texel `i` is an anchor (its index is stored with one bit fewer). */
function isAnchor(subsets: number, p: number, i: number): boolean {
  return i === 0 || (subsets === 2 && i === ANCHOR_2[p]) || (subsets === 3 && (i === ANCHOR_3_2[p] || i === ANCHOR_3_3[p]));
}

/** One BC7 block's decoder, reusing its scratch arrays across blocks. */
class Bc7Block {
  private readonly words = new Uint32Array(4);
  private position = 0;
  /** Endpoints: [subset][endpoint][channel], 8-bit. */
  private readonly endpoints = new Uint8Array(3 * 2 * 4);
  private readonly raw = new Uint8Array(3 * 2 * 4);

  private bits(count: number): number {
    let value = 0;
    for (let taken = 0; taken < count;) {
      const word = this.position >>> 5, shift = this.position & 31, n = Math.min(count - taken, 32 - shift);
      value |= ((this.words[word]! >>> shift) & (n === 32 ? 0xffffffff : (1 << n) - 1)) << taken;
      taken += n; this.position += n;
    }
    return value >>> 0;
  }

  decode(bytes: Uint8Array, at: number, texels: Uint8Array): void {
    for (let w = 0; w < 4; w++) this.words[w] = (bytes[at + w * 4]! | bytes[at + w * 4 + 1]! << 8 | bytes[at + w * 4 + 2]! << 16 | bytes[at + w * 4 + 3]! << 24) >>> 0;
    this.position = 0;
    let mode = 0;
    while (mode < 8 && this.bits(1) === 0) mode++;
    if (mode === 8) { texels.fill(0); return; } // Reserved: every channel of every texel is 0 (DFS §20.1).
    const [subsets, partitionBits, rotationBits, selectionBits, colourBits, alphaBits, endpointP, sharedP, indexBits, index2Bits] = MODES[mode]!;
    const partition = this.bits(partitionBits), rotation = this.bits(rotationBits), selection = this.bits(selectionBits);
    const raw = this.raw, ends = subsets * 2;
    for (let c = 0; c < 3; c++) for (let e = 0; e < ends; e++) raw[e * 4 + c] = this.bits(colourBits);
    for (let e = 0; e < ends; e++) raw[e * 4 + 3] = alphaBits ? this.bits(alphaBits) : 0;
    // P-bits sit below the stored bits; then the value is widened to 8 bits by repeating its top bits.
    const pbits = new Array<number>(ends).fill(0);
    if (endpointP) for (let e = 0; e < ends; e++) pbits[e] = this.bits(1);
    if (sharedP) for (let s = 0; s < subsets; s++) { const bit = this.bits(1); pbits[s * 2] = bit; pbits[s * 2 + 1] = bit; }
    const pb = endpointP || sharedP ? 1 : 0;
    for (let e = 0; e < ends; e++) for (let c = 0; c < 4; c++) {
      if (c === 3 && !alphaBits) { this.endpoints[e * 4 + 3] = 255; continue; }
      const precision = (c === 3 ? alphaBits : colourBits) + pb;
      let value = (raw[e * 4 + c]! << pb) | (pb ? pbits[e]! : 0);
      value <<= 8 - precision;
      this.endpoints[e * 4 + c] = value | (value >> precision);
    }
    // Primary indices, then secondary (modes 4 and 5); an anchor texel's index has one bit fewer.
    const primary = new Uint8Array(16), secondary = new Uint8Array(16);
    for (let i = 0; i < 16; i++) primary[i] = this.bits(isAnchor(subsets, partition, i) ? indexBits - 1 : indexBits);
    if (index2Bits) for (let i = 0; i < 16; i++) secondary[i] = this.bits(i === 0 ? index2Bits - 1 : index2Bits);
    const colourWeights = WEIGHTS[index2Bits && selection ? index2Bits : indexBits]!;
    const alphaWeights = WEIGHTS[index2Bits ? (selection ? indexBits : index2Bits) : indexBits]!;
    for (let i = 0; i < 16; i++) {
      const s = bc7Subset(subsets, partition, i), e0 = s * 8, e1 = s * 8 + 4;
      const colourIndex = index2Bits && selection ? secondary[i]! : primary[i]!;
      const alphaIndex = index2Bits ? (selection ? primary[i]! : secondary[i]!) : primary[i]!;
      const wc = colourWeights[colourIndex]!, wa = alphaWeights[alphaIndex]!;
      const o = i * 4, ep = this.endpoints;
      texels[o] = ((64 - wc) * ep[e0]! + wc * ep[e1]! + 32) >> 6;
      texels[o + 1] = ((64 - wc) * ep[e0 + 1]! + wc * ep[e1 + 1]! + 32) >> 6;
      texels[o + 2] = ((64 - wc) * ep[e0 + 2]! + wc * ep[e1 + 2]! + 32) >> 6;
      texels[o + 3] = ((64 - wa) * ep[e0 + 3]! + wa * ep[e1 + 3]! + 32) >> 6;
      if (rotation) {
        const channel = rotation - 1, alpha = texels[o + 3]!;
        texels[o + 3] = texels[o + channel]!; texels[o + channel] = alpha;
      }
    }
  }
}
