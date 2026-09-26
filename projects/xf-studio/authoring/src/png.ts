import { createInflate, deflate, deflateSync, inflateSync } from "node:zlib";

/**
 * Small, dependency-free PNG codec for host-side asset derivation: 8-bit, non-interlaced
 * greyscale, grey+alpha, RGB and RGBA in, RGB or RGBA out. Encoding is deterministic for
 * a given zlib build (fixed filter per row and fixed compression settings).
 */
export type RgbaImage = { width: number; height: number; data: Uint8Array };

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array, begin = 0, end = bytes.length): number {
  let value = 0xffffffff;
  for (let index = begin; index < end; index++) value = CRC_TABLE[(value ^ bytes[index]!) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const MAX_PIXELS = 8192 * 8192;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode to tightly packed RGBA8. Rejects anything outside the supported subset. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const { width, height, channels, data } = pngFrame(bytes);
  const stride = width * channels, expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  if (raw.length !== expected) throw Error("PNG image data has the wrong length.");
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!, source = row * (stride + 1) + 1, target = row * stride, previous = target - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x]!;
      const left = x >= channels ? pixels[target + x - channels]! : 0;
      const up = row ? pixels[previous + x]! : 0;
      const corner = row && x >= channels ? pixels[previous + x - channels]! : 0;
      pixels[target + x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up :
        filter === 3 ? value + ((left + up) >> 1) : filter === 4 ? value + paeth(left, up, corner) :
        (() => { throw Error("Invalid PNG row filter."); })()) & 255;
    }
  }
  if (channels === 4) return { width, height, data: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const from = pixel * channels, to = pixel * 4;
    if (channels === 1 || channels === 2) rgba[to] = rgba[to + 1] = rgba[to + 2] = pixels[from]!;
    else { rgba[to] = pixels[from]!; rgba[to + 1] = pixels[from + 1]!; rgba[to + 2] = pixels[from + 2]!; }
    rgba[to + 3] = channels === 2 ? pixels[from + 1]! : 255;
  }
  return { width, height, data: rgba };
}

/** A PNG's checked frame: its size, channels and compressed image data. Rejects anything outside the supported subset. */
function pngFrame(bytes: Uint8Array): { width: number; height: number; channels: number; data: Uint8Array[] } {
  if (bytes.length < 33 || !SIGNATURE.every((value, index) => bytes[index] === value)) throw Error("Not a PNG file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, channels = 0, seenHeader = false, ended = false;
  const data: Uint8Array[] = [];
  while (offset + 12 <= bytes.length && !ended) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > bytes.length) throw Error("A PNG chunk runs past the end of the file.");
    if (crc32(bytes, offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)) throw Error(`PNG ${type} chunk CRC mismatch.`);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (seenHeader || length !== 13) throw Error("Invalid PNG header.");
      seenHeader = true;
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      const [depth, colour, compression, filter, interlace] = body.subarray(8, 13);
      channels = CHANNELS[colour!] ?? 0;
      if (depth !== 8 || !channels || compression || filter || interlace) throw Error("Unsupported PNG format (8-bit non-interlaced only).");
      if (!width || !height || width * height > MAX_PIXELS) throw Error("Unsupported PNG dimensions.");
    } else if (type === "IDAT") data.push(body);
    else if (type === "PLTE") throw Error("Palette PNGs are not supported.");
    else if (type === "IEND") ended = true;
    offset = end;
  }
  if (!seenHeader || !ended || !data.length) throw Error("Incomplete PNG file.");
  return { width, height, channels, data };
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** Encode an RGBA8 image as RGB (`alpha: false`) or RGBA PNG with the Up filter on every row. */
export function encodePng(image: RgbaImage, options: { alpha: boolean }): Uint8Array {
  const { filtered, header } = filterForPng(image, options);
  return assemblePng(header, deflateSync(filtered, DEFLATE_OPTIONS));
}
/**
 * `encodePng` with the compression on zlib's thread pool, so a large image never holds the host's event loop (PREV-107). The same zlib
 * and settings over the same bytes: the output is byte-identical to `encodePng`'s.
 */
export async function encodePngAsync(image: RgbaImage, options: { alpha: boolean }): Promise<Uint8Array> {
  const { filtered, header } = filterForPng(image, options);
  return assemblePng(header, await new Promise<Uint8Array>((resolve, reject) =>
    deflate(filtered, DEFLATE_OPTIONS, (error, out) => error ? reject(error) : resolve(out))));
}

/**
 * Decode a PNG and halve it by 2×2 box means of its bytes until both sides are at most `max` (the same arithmetic as repeated
 * `halveImage` calls: odd edges repeat their last texel, a one-texel side stays one), streaming (PREV-107): the image data is inflated on
 * zlib's thread pool a piece at a time, each row is unfiltered and folded into the halving stages as it arrives, and only the finished
 * image (at most `max`² texels) is ever whole in memory. An 8K map never costs its 256 MB decoded, and the event loop runs between pieces.
 */
export async function decodePngHalved(bytes: Uint8Array, max: number): Promise<RgbaImage> {
  const { width, height, channels, data } = pngFrame(bytes);
  const sizes: [number, number][] = [[width, height]];
  while (sizes.at(-1)![0] > max || sizes.at(-1)![1] > max) { const [w, h] = sizes.at(-1)!; sizes.push([Math.max(1, w >> 1), Math.max(1, h >> 1)]); }
  const [outWidth, outHeight] = sizes.at(-1)!;
  const out = new Uint8Array(outWidth * outHeight * 4);
  let outRows = 0;
  // One stage per halving: it holds the even row until its odd partner arrives, then passes their means to the next stage.
  const stages = sizes.slice(0, -1).map(([w, h], level) => ({ w, h, pending: null as Uint8Array | null, seen: 0, level }));
  const push = (level: number, row: Uint8Array) => {
    if (level === stages.length) { if (outRows < outHeight) out.set(row, outRows++ * outWidth * 4); return; }
    const stage = stages[level]!;
    const index = stage.seen++;
    if (index % 2 === 0) {
      stage.pending = row;
      // A one-row image halves its row against itself.
      if (stage.h === 1) push(level + 1, meanRow(row, row, stage.w));
      return;
    }
    push(level + 1, meanRow(stage.pending!, row, stage.w));
    stage.pending = null;
  };
  const stride = width * channels, rowBytes = stride + 1;
  let previous = new Uint8Array(stride), current = new Uint8Array(stride);
  const raw = new Uint8Array(rowBytes);
  let filled = 0, rows = 0;
  const take = (piece: Uint8Array) => {
    let at = 0;
    while (at < piece.length) {
      if (rows >= height) throw Error("PNG image data has the wrong length.");
      const n = Math.min(rowBytes - filled, piece.length - at);
      raw.set(piece.subarray(at, at + n), filled);
      filled += n; at += n;
      if (filled < rowBytes) continue;
      unfilterRow(raw, current, rows ? previous : null, channels);
      push(0, toRgbaRow(current, width, channels));
      [previous, current] = [current, previous];
      filled = 0; rows++;
    }
  };
  await new Promise<void>((resolve, reject) => {
    const inflater = createInflate();
    inflater.on("data", (piece: Buffer) => { try { take(piece); } catch (error) { inflater.destroy(); reject(error); } });
    inflater.on("error", reject);
    inflater.on("end", () => resolve());
    for (const part of data) inflater.write(part);
    inflater.end();
  });
  if (rows !== height || filled) throw Error("PNG image data has the wrong length.");
  return { width: outWidth, height: outHeight, data: out };
}

/** One output row of 2×2 means of two input rows `w` texels wide (`halveImage`'s arithmetic). */
function meanRow(a: Uint8Array, b: Uint8Array, w: number): Uint8Array {
  const width = Math.max(1, w >> 1), out = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const x0 = Math.min(w - 1, x * 2) * 4, x1 = Math.min(w - 1, x * 2 + 1) * 4;
    for (let k = 0; k < 4; k++) out[x * 4 + k] = (a[x0 + k]! + a[x1 + k]! + b[x0 + k]! + b[x1 + k]! + 2) >> 2;
  }
  return out;
}
/** Undo a row's PNG filter in place into `into` (the row above is `above`, or none for the first row). */
function unfilterRow(raw: Uint8Array, into: Uint8Array, above: Uint8Array | null, channels: number) {
  const filter = raw[0]!, stride = into.length;
  for (let x = 0; x < stride; x++) {
    const value = raw[x + 1]!;
    const left = x >= channels ? into[x - channels]! : 0, up = above ? above[x]! : 0, corner = above && x >= channels ? above[x - channels]! : 0;
    into[x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1)
      : filter === 4 ? value + paeth(left, up, corner) : (() => { throw Error("Invalid PNG row filter."); })()) & 255;
  }
}
/** A decoded row as RGBA8. */
function toRgbaRow(row: Uint8Array, width: number, channels: number): Uint8Array {
  if (channels === 4) return row.slice();
  const out = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const from = x * channels, to = x * 4;
    if (channels === 1 || channels === 2) out[to] = out[to + 1] = out[to + 2] = row[from]!;
    else { out[to] = row[from]!; out[to + 1] = row[from + 1]!; out[to + 2] = row[from + 2]!; }
    out[to + 3] = channels === 2 ? row[from + 1]! : 255;
  }
  return out;
}

const DEFLATE_OPTIONS = { level: 9, memLevel: 9, strategy: 0 } as const;
/** An RGBA8 image packed and Up-filtered for PNG, with its header. */
function filterForPng(image: RgbaImage, options: { alpha: boolean }): { filtered: Uint8Array; header: Uint8Array } {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) throw Error("Image data does not match its dimensions.");
  const channels = options.alpha ? 4 : 3, stride = width * channels;
  const packed = new Uint8Array(stride * height);
  for (let pixel = 0; pixel < width * height; pixel++)
    for (let k = 0; k < channels; k++) packed[pixel * channels + k] = data[pixel * 4 + k]!;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    const target = row * (stride + 1), source = row * stride;
    filtered[target] = 2;
    for (let x = 0; x < stride; x++) filtered[target + 1 + x] = (packed[source + x]! - (row ? packed[source - stride + x]! : 0)) & 255;
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header.set([8, options.alpha ? 6 : 2, 0, 0, 0], 8);
  return { filtered, header };
}
/** The PNG file of a header and its compressed image data. */
function assemblePng(header: Uint8Array, compressed: Uint8Array): Uint8Array {
  const parts = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
