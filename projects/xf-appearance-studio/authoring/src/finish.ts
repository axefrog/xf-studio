/** Deterministic, UV-anchored flake study shared by preview and texture export.
 * These are material inputs, not baked light or animated emissive sparkle.
 * Game normal encoding/blend calibration and subpixel variance filtering remain pending.
 */
export type Finish =
  | "matte"
  | "regular"
  | "shimmer"
  | "glitter"
  | "satin"
  | "metallic"
  | "glossy"
  | "iridescent";
export type LegacyFlakes = {
  cells: number;
  density: number;
  tilt: number;
  seed: number;
};
export type Flakes = LegacyFlakes;
export const isIrregular = (flakes: Flakes | import("./flake-field").IrregularFlakes | undefined): flakes is import("./flake-field").IrregularFlakes =>
  !!flakes && "model" in flakes && flakes.model === "irregular-planar-1";
export const defaultFlakes = (): LegacyFlakes => ({
  cells: 128,
  density: 0.65,
  tilt: 0.65,
  seed: 2077,
});
export function canonicalFinish(finish: Finish) {
  return finish === "satin" ? "regular" : finish;
}
export function finishLabel(finish: Finish) {
  const name = canonicalFinish(finish);
  return name === "regular" ? "satin" : name === "iridescent" ? "colour-shifting" : name;
}
export function finishDescription(finish: Finish) {
  return {
    matte: "Soft colour with little shine.",
    regular: "A smooth, gentle sheen without individual sparkles.",
    metallic: "A continuous metallic sheen without separate flakes.",
    glossy: "A smooth, wet-looking shine over colour — experimental gloss preview.",
    iridescent: "Colour changes with viewing and lighting angle. Experimental preview for the duochrome / multichrome family; specific colour shifts are still to come.",
    shimmer: "Fine reflective texture — an experimental shimmer approximation.",
    glitter:
      "Distinct reflective flakes — an experimental glitter approximation.",
  }[canonicalFinish(finish)];
}
function random(x: number, y: number, seed: number) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export type FlakeMaps = {size: number; normal: Uint8Array<ArrayBuffer>; surface: Uint8Array<ArrayBuffer>};

/** Bounded cooperative work; each cell setup and each written pixel costs one
 * budget unit, including empty cells when the cell grid exceeds resolution. */
export function createFlakeJob(size: number, finish: "shimmer" | "glitter", p: LegacyFlakes) {
  if (!Number.isInteger(size) || size < 32 || size > 4096 ||
    (finish !== "shimmer" && finish !== "glitter") || !p ||
    !Number.isInteger(p.cells) || p.cells < 32 || p.cells > 256 ||
    !Number.isFinite(p.density) || p.density < 0 || p.density > 1 ||
    !Number.isFinite(p.tilt) || p.tilt < 0 || p.tilt > 1 ||
    !Number.isInteger(p.seed) || p.seed < 0 || p.seed > 2147483647)
    throw Error("Invalid flake bake settings");
  p = {...p};
  const normal = new Uint8Array(size * size * 4), surface = new Uint8Array(normal.length);
  const dense = finish === "shimmer", cells = p.cells * (dense ? 2 : 1), cellSize = size / cells;
  let cx = 0, cy = 0, done = false;
  let cell: {x: number; y: number; x0: number; x1: number; y1: number; occupied: boolean; px: number; py: number; radius: number; nx: number; ny: number; nz: number} | undefined;
  return {size, normal, surface, get done() {return done;},
    advance(maxWork: number) {
      if (!(maxWork > 0) || (!Number.isInteger(maxWork) && maxWork !== Infinity)) throw Error("Invalid flake slice size.");
      let work = 0;
      while (!done && work++ < maxWork) {
        if (!cell) {
          if (cy >= cells) {done = true; break;}
          const occupied = random(cx, cy, p.seed) < p.density;
          const px = (cx + 0.5 + (random(cx, cy, p.seed + 1) - 0.5) * 0.3) * cellSize;
          const py = (cy + 0.5 + (random(cx, cy, p.seed + 2) - 0.5) * 0.3) * cellSize;
          const radius = cellSize * (dense ? 0.39 : 0.21 + random(cx, cy, p.seed + 3) * 0.09);
          const azimuth = random(cx, cy, p.seed + 4) * Math.PI * 2;
          const angle = Math.sqrt(random(cx, cy, p.seed + 5)) * p.tilt * (dense ? 0.4 : 1.1);
          const nx = Math.sin(angle) * Math.cos(azimuth), ny = Math.sin(angle) * Math.sin(azimuth), nz = Math.cos(angle);
          const x0 = Math.ceil(cx * cellSize), x1 = Math.min(size, Math.ceil((cx + 1) * cellSize));
          const y0 = Math.ceil(cy * cellSize), y1 = Math.min(size, Math.ceil((cy + 1) * cellSize));
          if (++cx >= cells) {cx = 0; cy++;}
          if (x0 < x1 && y0 < y1) cell = {x:x0,y:y0,x0,x1,y1,occupied,px,py,radius,nx,ny,nz};
          else if (cy >= cells) done = true;
          continue;
        }
        // Arithmetic and traversal match the original synchronous baker exactly.
        const {x,y,occupied,px,py,radius,nx,ny,nz} = cell, i = (y * size + x) * 4;
        const a = occupied ? Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x + 0.5 - px, y + 0.5 - py))) : 0;
        const vx = nx * a, vy = ny * a, vz = 1 + (nz - 1) * a, len = Math.hypot(vx, vy, vz);
        normal[i] = Math.round(((vx / len) * 0.5 + 0.5) * 255);
        normal[i + 1] = Math.round(((vy / len) * 0.5 + 0.5) * 255);
        normal[i + 2] = Math.round(((vz / len) * 0.5 + 0.5) * 255);
        normal[i + 3] = 255;
        surface[i] = Math.round(a * 255);
        surface[i + 1] = Math.round(((dense ? 0.48 : 0.7) * (1 - a) + (dense ? 0.32 : 0.2) * a) * 255);
        surface[i + 2] = Math.round(a * (dense ? 0.35 : 0.95) * 255);
        surface[i + 3] = 255;
        if (++cell.x >= cell.x1) {cell.x = cell.x0; if (++cell.y >= cell.y1) {cell = undefined; if (cy >= cells) done = true;}}
      }
      return done;
    },
  };
}

/** Synchronous export callers retain identical normal/surface byte output. */
export function bakeFlakes(size: number, finish: "shimmer" | "glitter", p: LegacyFlakes | import("./flake-field").IrregularFlakes): FlakeMaps {
  if (isIrregular(p)) throw Error("Irregular glitter requires the separate field bake.");
  const job = createFlakeJob(size,finish,p);
  job.advance(Infinity);
  return {size: job.size, normal: job.normal, surface: job.surface};
}
