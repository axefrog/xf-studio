import { expect, test } from "bun:test";
import { defaultFlakes, type LegacyFlakes } from "../src/engines/layered-makeup/finish";
import { bakeShimmerGrain, createShimmerGrainJob, grainAt, grainCellsPerTexel, grainSettings, grainVariance, SHIMMER_GRAIN }
  from "../src/engines/layered-makeup/shimmer-grain";

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
    const x = unorm(a.normal[t * 4]), y = unorm(a.normal[t * 4 + 1]);
    expect(Array.from(a.surface.subarray(t * 4 + 1, t * 4 + 4))).toEqual([byte(SHIMMER_GRAIN.roughness), byte(SHIMMER_GRAIN.metalness), 255]);
    if (a.normal[t * 4] === 128 && a.normal[t * 4 + 1] === 128) continue;
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
    expect([coarse.normal[t * 4], coarse.normal[t * 4 + 1]]).toEqual([byte(mx * .5 + .5), byte(my * .5 + .5)]);
    expect(coarse.surface[t * 4 + 1]).toBe(byte((alpha2 + Math.max(0, s2 / 4 - mx * mx - my * my)) ** .25));
    // The coarse texel's mean is the mean of the fine map's decoded normals, to byte rounding.
    const fx = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => unorm(fine.normal[((2 * y + j) * 2048 + 2 * x + i) * 4]));
    expect(Math.abs(fx.reduce((a, b) => a + b, 0) / 4 - unorm(coarse.normal[t * 4]))).toBeLessThan(.01);
  }
  // From 16 cells per texel (the default 1024 preview) a texel is written flat with the full expected variance.
  const analytic = bakeShimmerGrain(p, 1024);
  expect(grainCellsPerTexel(1024, 1024)).toEqual({ u: 4, v: 4 });
  for (let t = 0; t < 1024 * 1024; t += 4099) {
    expect(Array.from(analytic.normal.subarray(t * 4, t * 4 + 4))).toEqual([128, 128, 255, 255]);
    expect(analytic.surface[t * 4 + 1]).toBe(byte((alpha2 + grainVariance(p)) ** .25));
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
