/** Scalar sampling of one fibre bake, followed by a declared monotone distribution curve. No independent noise. */
import type { AtlasRect } from "./textures";
export type StrandIdSampling = { size: number; background: number };
type Sample = { width: number; height: number; alpha: Uint8Array; id: Uint8Array };
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const visible = (alpha: number, cutoff: number) => clamp((clamp((alpha - cutoff) / (1 - cutoff)) - .008843138) / (.16535948 * 5));

/** Mutates only derived ID bytes in a cell. Returns visibility-weighted 16-bin total variation. */
export function filterStrandId(map: Sample, cell: AtlasRect, content: AtlasRect, cutoff: number,
  sampling: StrandIdSampling, target?: readonly number[], signal?: AbortSignal): number {
  signal?.throwIfAborted();
  const validRect = (r: AtlasRect) => Object.values(r).every(Number.isInteger) && r.x >= 0 && r.y >= 0
    && r.width > 0 && r.height > 0 && r.x + r.width <= map.width && r.y + r.height <= map.height;
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1
    || map.alpha.length !== map.width * map.height || map.id.length !== map.alpha.length || !validRect(cell) || !validRect(content)
    || content.x < cell.x || content.y < cell.y || content.x + content.width > cell.x + cell.width || content.y + content.height > cell.y + cell.height
    || !Number.isFinite(cutoff) || cutoff < 0 || cutoff >= 1 || !Number.isInteger(sampling.size) || sampling.size < 1 || sampling.size > 16
    || !Number.isFinite(sampling.background) || sampling.background < 0 || sampling.background > 1
    || target && (target.length !== 16 || target.some(v => !Number.isFinite(v) || v < 0 || v > 1) || target.reduce((a, b) => a + b, 0) <= 0))
    throw Error("Invalid strand ID sampling description.");
  const size = sampling.size, width = Math.ceil(cell.width / size), height = Math.ceil(cell.height / size), baked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    if (y % 32 === 0) signal?.throwIfAborted();
    for (let x = 0; x < width; x++) {
      let sum = 0, area = 0;
      for (let dy = 0; dy < size && y * size + dy < cell.height; dy++) for (let dx = 0; dx < size && x * size + dx < cell.width; dx++) {
        const k = (cell.y + y * size + dy) * map.width + cell.x + x * size + dx, a = map.alpha[k]! / 255;
        sum += a * map.id[k]! + (1 - a) * sampling.background * 255; area++;
      }
      baked[y * width + x] = Math.round(sum / area);
    }
  }
  for (let y = 0; y < cell.height; y++) {
    if (y % 32 === 0) signal?.throwIfAborted();
    for (let x = 0; x < cell.width; x++) {
      const bx = (x + .5) / size - .5, by = (y + .5) / size - .5, ix = Math.floor(bx), iy = Math.floor(by), fx = bx - ix, fy = by - iy;
      let value = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) value += baked[
        Math.max(0, Math.min(height - 1, iy + dy)) * width + Math.max(0, Math.min(width - 1, ix + dx))]!
        * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      map.id[(cell.y + y) * map.width + cell.x + x] = Math.round(value);
    }
  }
  if (!target) return 0;
  const histogram = new Float64Array(256); let total = 0;
  for (let y = content.y; y < content.y + content.height; y++) for (let x = content.x; x < content.x + content.width; x++) {
    const k = y * map.width + x, w = visible(map.alpha[k]! / 255, cutoff); histogram[map.id[k]!]! += w; total += w;
  }
  const sum = target.reduce((a, b) => a + b, 0), lookup = new Uint8Array(256); let prefix = 0;
  for (let i = 0; i < 256; i++) {
    const u = (prefix + histogram[i]! / 2) / (total || 1); let c = 0, bin = 0;
    for (; bin < 15; bin++) { if (u <= c + target[bin]! / sum) break; c += target[bin]! / sum; }
    lookup[i] = Math.round(255 * (bin + clamp((u - c) / (target[bin]! / sum || 1))) / 16);
    prefix += histogram[i]!;
  }
  const actual = new Float64Array(16);
  for (let i = 0; i < 256; i++) actual[Math.min(15, Math.floor(lookup[i]! * 16 / 255))]! += histogram[i]! / (total || 1);
  for (let y = cell.y; y < cell.y + cell.height; y++) for (let x = cell.x; x < cell.x + cell.width; x++) {
    const k = y * map.width + x; map.id[k] = lookup[map.id[k]!]!;
  }
  return actual.reduce((error, v, i) => error + Math.abs(v - target[i]! / sum), 0) / 2;
}
