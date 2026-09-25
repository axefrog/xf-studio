import { deflateSync, inflateSync } from "node:zlib";

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
  const parts = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(filtered, { level: 9, memLevel: 9, strategy: 0 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
