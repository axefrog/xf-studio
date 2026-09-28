import { expect, test } from "bun:test";
import { defaultFlakes, type LegacyFlakes } from "../src/engines/layered-makeup/finish";
import { createHash } from "node:crypto";
import { bakeShimmerGrain, createShimmerGrainJob, grainAt, grainCellsPerTexel, grainPitch, grainSettings, grainVariance, previewGrainGrid,
  sinRad, SHIMMER_GRAIN, turn } from "../src/engines/layered-makeup/shimmer-grain";
import { plateUvWindow } from "../src/engines/layered-makeup/plate-uv-window";
import { EYE_MAKEUP_REGION } from "./fixtures/eye-region";

const unorm = (b: number) => b / 255 * 2 - 1;
const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
/** NormalsBlendingMode 1's weight for a decoded tangent normal. */
const gate = (x: number, y: number) => Math.max(0, Math.min(1, 50 - 50 * Math.sqrt(Math.max(0, 1 - x * x - y * y))));

test("grain: deterministic, seeded, the set share tilted, and every tilted grain clears the mode-1 gate", () => {
  const p = defaultFlakes(), size = 256, a = bakeShimmerGrain(p, size, size, { u0: 0, u1: size / 4096, v0: 0, v1: size / 4096 });
  expect(bakeShimmerGrain(p, size, size, { u0: 0, u1: size / 4096, v0: 0, v1: size / 4096 })).toEqual(a);
  const tiny = { u0: 0, u1: 64 / 4096, v0: 0, v1: 64 / 4096 };
  expect(bakeShimmerGrain({ ...p, seed: 1 }, 64, 64, tiny).normal).not.toEqual(bakeShimmerGrain(p, 64, 64, tiny).normal);
  const { low, high, share } = grainSettings(p);
  let tilted = 0;
  for (let t = 0; t < size * size; t++) {
    const x = unorm(a.normal[t * 2]), y = unorm(a.normal[t * 2 + 1]);
    expect(Array.from(a.surface.subarray(t * 2, t * 2 + 2))).toEqual([byte(SHIMMER_GRAIN.roughness), byte(SHIMMER_GRAIN.metalness)]);
    if (a.normal[t * 2] === 128 && a.normal[t * 2 + 1] === 128) continue;
    tilted++;
    const sine = Math.hypot(x, y);
    expect(sine).toBeGreaterThan(Math.sin(low) - .006); expect(sine).toBeLessThan(Math.sin(high) + .006);
    expect(gate(x, y)).toBe(1);
  }
  expect(Math.abs(tilted / (size * size) - share)).toBeLessThan(.01);
  expect(share).toBeCloseTo(.26, 10);
});

test("grain: no lattice, no discs — tilt is uncorrelated between neighbouring and distant cells", () => {
  const p: LegacyFlakes = { cells: 64, density: .8, tilt: 1, seed: 2078 }, n = 384;
  const field = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const [gx, gy] = grainAt(x, y, p); field[y * n + x] = Math.hypot(gx, gy); }
  const mean = field.reduce((a, b) => a + b, 0) / field.length, variance = field.reduce((a, b) => a + (b - mean) ** 2, 0) / field.length;
  const correlation = (dx: number, dy: number) => {
    let s = 0, k = 0;
    for (let y = 0; y + dy < n; y++) for (let x = 0; x + dx < n; x++) { s += (field[y * n + x] - mean) * (field[(y + dy) * n + x + dx] - mean); k++; }
    return s / k / variance;
  };
  for (let lag = 1; lag <= 40; lag++) for (const [dx, dy] of [[lag, 0], [0, lag], [lag, lag]]) expect(Math.abs(correlation(dx, dy))).toBeLessThan(.03);
});

test("grain scale: one cell per plate-window texel; head maps hold their cells' mean, widening roughness by what they hide", () => {
  expect(grainCellsPerTexel(4096, 4096)).toEqual({ u: 1, v: 1 });
  expect(grainCellsPerTexel(2048, 2048)).toEqual({ u: 2, v: 2 });
  const p = { ...defaultFlakes(), density: 1, tilt: .5 }, fine = bakeShimmerGrain(p, 2048, 2048, { u0: 0, u1: .5, v0: 0, v1: .5 });
  const coarse = bakeShimmerGrain(p, 1024, 1024, { u0: 0, u1: .5, v0: 0, v1: .5 }), alpha2 = SHIMMER_GRAIN.roughness ** 4;
  for (let y = 0; y < 1024; y += 37) for (let x = 0; x < 1024; x += 41) {
    let sx = 0, sy = 0, s2 = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const [gx, gy] = grainAt(2 * x + i, 2 * y + j, p); sx += gx; sy += gy; s2 += gx * gx + gy * gy; }
    const mx = sx / 4, my = sy / 4, t = y * 1024 + x;
    expect([coarse.normal[t * 2], coarse.normal[t * 2 + 1]]).toEqual([byte(mx * .5 + .5), byte(my * .5 + .5)]);
    expect(coarse.surface[t * 2]).toBe(byte((alpha2 + Math.max(0, s2 / 4 - mx * mx - my * my)) ** .25));
    // The coarse texel's mean is the mean of the fine map's decoded normals, to byte rounding.
    const fx = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => unorm(fine.normal[((2 * y + j) * 2048 + 2 * x + i) * 2]));
    expect(Math.abs(fx.reduce((a, b) => a + b, 0) / 4 - unorm(coarse.normal[t * 2]))).toBeLessThan(.01);
  }
  // From 16 cells per texel (a 1024 head-UV diagnostic) a texel is written flat with the full expected variance.
  const analytic = bakeShimmerGrain(p, 1024);
  expect(grainCellsPerTexel(1024, 1024)).toEqual({ u: 4, v: 4 });
  for (let t = 0; t < 1024 * 1024; t += 4099) {
    expect(Array.from(analytic.normal.subarray(t * 2, t * 2 + 2))).toEqual([128, 128]);
    expect(analytic.surface[t * 2]).toBe(byte((alpha2 + grainVariance(p)) ** .25));
  }
  // The expected variance matches the drawn grains.
  let s2 = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const [gx, gy] = grainAt(x, y, p); s2 += gx * gx + gy * gy; }
  expect(s2 / 65536 / grainVariance(p)).toBeCloseTo(1, 1);
});

test("grain jobs: sliced output equals the synchronous bake; bad settings refused", () => {
  const p = { ...defaultFlakes(), seed: 7 }, job = createShimmerGrainJob(p, 64, 32);
  for (const chunk of [1, 3, 17, 255]) { job.advance(chunk); if (job.done) break; }
  while (!job.done) job.advance(97);
  const sync = bakeShimmerGrain(p, 64, 32);
  expect(job.normal).toEqual(sync.normal); expect(job.surface).toEqual(sync.surface);
  expect(job.advance(1)).toBe(true);
  expect(() => job.advance(0)).toThrow(); expect(() => job.advance(.5)).toThrow();
  expect(() => createShimmerGrainJob({ ...p, density: 2 }, 64)).toThrow();
  expect(() => createShimmerGrainJob({ ...p, seed: -1 }, 64)).toThrow();
  expect(() => createShimmerGrainJob(p, 8192)).toThrow();
});

test("seeds: neighbouring seeds draw unrelated streams, not one stream shifted by a draw (PREV-185)", () => {
  const n = 64, tiny = { u0: 0, u1: n / 4096, v0: 0, v1: n / 4096 };
  const tilted = (seed: number) => {
    const g = bakeShimmerGrain({ ...defaultFlakes(), seed }, n, n, tiny).normal;
    return Array.from({ length: n * n }, (_, t) => g[t * 2] !== 128 || g[t * 2 + 1] !== 128);
  };
  const agreement = (a: boolean[], b: boolean[]) => a.filter((v, i) => v === b[i]).length / a.length;
  // Independent fields at share s agree on s² + (1 − s)² of cells (0.62 at the default 0.26); a shared stream agrees far more.
  for (const seed of [0, 1, 2076, 2077, 40000]) {
    const a = tilted(seed), b = tilted(seed + 1);
    expect(agreement(a, b)).toBeLessThan(.7);
  }
  // Under the old key (seed + salt), seed s + 1 drew its tilt from seed s's azimuth draw: the tilt of s + 1 was a function of the
  // azimuth of s wherever both tilted (correlation 1). Now the two are unrelated.
  for (const seed of [0, 2076, 2077]) {
    const p = { ...defaultFlakes(), density: 1 }, a: number[] = [], b: number[] = [];
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const [ax, ay] = grainAt(x, y, { ...p, seed }), [bx, by] = grainAt(x, y, { ...p, seed: seed + 1 });
      if ((ax || ay) && (bx || by)) { a.push((Math.atan2(ay, ax) + 2 * Math.PI) % (2 * Math.PI)); b.push(Math.hypot(bx, by)); }
    }
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length, ma = mean(a), mb = mean(b);
    const r = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
    expect(a.length).toBeGreaterThan(1000);
    expect(Math.abs(r)).toBeLessThan(.1);
  }
});

test("determinism: the byte path uses exact IEEE operations only, and the default grain's bytes are pinned (PREV-186)", () => {
  // The polynomial sine and turn agree with the platform's to a few units in the last place, but never call it.
  for (let k = 0; k <= 1000; k++) {
    const x = k / 1000 * Math.PI / 2;
    expect(Math.abs(sinRad(x) - Math.sin(x))).toBeLessThan(1e-15);
    const t = k / 1001, [c, s] = turn(t);
    expect(Math.abs(c - Math.cos(2 * Math.PI * t))).toBeLessThan(1e-15);
    expect(Math.abs(s - Math.sin(2 * Math.PI * t))).toBeLessThan(1e-15);
  }
  expect(() => sinRad(-.1)).toThrow(); expect(() => sinRad(2)).toThrow();
  // The built-in plate window's default grain, as Build lays it: these digests were taken before the change and must never move.
  const window = plateUvWindow({ uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 });
  const g = bakeShimmerGrain(defaultFlakes(), 2048, 512, window), sha = (a: Uint8Array) => createHash("sha256").update(a).digest("hex").slice(0, 16);
  expect(sha(g.normal)).toBe("5f38f9d6460ae113");
  expect(sha(g.surface)).toBe("7c5adbbb5f47446e");
  const coarse = bakeShimmerGrain({ ...defaultFlakes(), density: 1, tilt: .5 }, 1024);
  expect([sha(coarse.normal), sha(coarse.surface)]).toEqual(["e303b22f75fb4f8b", "80ad25c9d7d6f585"]);
});

test("pitch and the preview grid: the real grains per unit of UV, and a grain-aligned power-of-two preview window (PIPE-124, PREV-182)", () => {
  const window = plateUvWindow({ uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 });
  const pitch = grainPitch(2048, 512, window);
  // One grain per texel of the built-in plate window: its pitch is the texel's, not the nominal 4096.
  expect(grainCellsPerTexel(2048, 512, window)).toEqual({ u: 1, v: 1 });
  expect(Math.round(pitch.u)).toBe(4376); expect(Math.round(pitch.v)).toBe(3420);
  expect(grainPitch(4096, 4096)).toEqual({ u: 4096, v: 4096 });
  // Eye makeup's optics window holds the grain at its true 4096 per unit, and covers the built-in plate's window.
  const grid = previewGrainGrid(EYE_MAKEUP_REGION.opticsWindow), o = EYE_MAKEUP_REGION.opticsWindow;
  expect(grid).toEqual({ width: 2048, height: 1024, window: o });
  expect(grid.width * grid.height).toBeLessThanOrEqual(SHIMMER_GRAIN.previewMaxTexels);
  expect(grainCellsPerTexel(grid.width, grid.height, grid.window)).toEqual({ u: 1, v: 1 });
  expect(o.u0 <= window.u0 && o.u1 >= window.u1 && o.v0 <= window.v0 && o.v1 >= window.v1).toBe(true);
  // Off-grid, non-power-of-two or oversized windows are refused.
  expect(() => previewGrainGrid({ u0: .2501, u1: .75, v0: .125, v1: .375 })).toThrow();
  expect(() => previewGrainGrid({ u0: .25, u1: .7, v0: .125, v1: .375 })).toThrow();
  expect(() => previewGrainGrid({ u0: 0, u1: 1, v0: 0, v1: .5 })).toThrow();
});
