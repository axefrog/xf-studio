/**
 * The shadow filter's tent (src/shadow-filter.ts, PREV-136): simulated on the CPU as the GPU evaluates it, one axis at a time (the
 * weights are separable), with hardware bilinear comparison taps across a shadow edge.
 */
import { expect, test } from "bun:test";
import { creatorShadowMapSize, creatorShadowRadius } from "../src/creator-lighting";
import { SHADOW_TENT_MAX, shadowTentSize, tentTaps } from "../src/shadow-filter";

/** A shadow map row lit left of `edge` (texel centres at i + 0.5), read by one hardware-filtered comparison at `x` (texels). */
const bilinear = (x: number, edge: number) => {
  const left = Math.floor(x - 0.5), f = x - 0.5 - left, lit = (i: number) => i < edge ? 1 : 0;
  return lit(left) * (1 - f) + lit(left + 1) * f;
};
/** The filter's response at receiver position `uv` (texels): the shader's base texel, fraction and weighted taps. */
const tent = (size: 3 | 5 | 7, uv: number, edge: number) => {
  const base = Math.floor(uv + 0.5), s = uv + 0.5 - base, { offsets, weights, total } = tentTaps(size, s);
  return offsets.reduce((sum, offset, i) => sum + weights[i]! * bilinear(base - 0.5 + offset, edge), 0) / total;
};
/** The earlier filter: a fixed row of four taps spread over the radius, equal weights. */
const grid = (radius: number, uv: number, edge: number) =>
  [0, 1, 2, 3].reduce((sum, i) => sum + bilinear(uv + (i - 1.5) / 1.5 * radius, edge), 0) / 4;
/** The longest run (texels) inside the penumbra over which the response doesn't change: a staircase's flat tread. */
function longestTread(response: (uv: number) => number, edge: number) {
  let run = 0, longest = 0, previous = response(edge - 8);
  for (let uv = edge - 8; uv <= edge + 8; uv += 1 / 64) {
    const value = response(uv);
    if (value > 0.02 && value < 0.98 && Math.abs(value - previous) < 1e-9) longest = Math.max(longest, run += 1 / 64); else run = 0;
    previous = value;
  }
  return longest;
}

test("each tent's weights sum to its total, and the taps reach one texel apart at most", () => {
  for (const size of [3, 5, 7] as const) for (let s = 0; s < 1; s += 1 / 16) {
    const { offsets, weights, total } = tentTaps(size, s);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 12);
    // Consecutive taps each read two texels: gaps of at most two texels leave no texel unread.
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]! - offsets[i - 1]!).toBeLessThanOrEqual(2 + 1e-9);
  }
});

test("across a shadow edge the tent falls smoothly and monotonically, where the earlier 4 × 4 grid had flat treads", () => {
  const edge = 20;
  for (const size of [3, 5, 7] as const) {
    let previous = 1;
    for (let uv = edge - 8; uv <= edge + 8; uv += 1 / 64) {
      const value = tent(size, uv, edge);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      previous = value;
    }
    expect(tent(size, edge - size, edge)).toBeCloseTo(1, 9);
    expect(tent(size, edge + size, edge)).toBeCloseTo(0, 9);
    expect(tent(size, edge, edge)).toBeCloseTo(0.5, 9);
    expect(longestTread(uv => tent(size, uv, edge), edge), `tent ${size}`).toBeLessThan(0.05);
  }
  // The earlier grid at the 1K and 2K radii: taps 2.3 and 4.5 texels apart, so the penumbra stepped.
  for (const size of [1024, 2048]) expect(longestTread(uv => grid(creatorShadowRadius(size), uv, edge), edge)).toBeGreaterThan(1);
});

test("the tent follows the preview's penumbra radius, capped at seven texels", () => {
  expect([512, 1024, 2048].map(texture => shadowTentSize(creatorShadowRadius(creatorShadowMapSize(texture))))).toEqual([3, 7, 7]);
  expect(creatorShadowRadius(1024)).toBeCloseTo(3.41, 2);
  expect(shadowTentSize(1.9)).toBe(3);
  expect(shadowTentSize(2.5)).toBe(5);
  expect(SHADOW_TENT_MAX).toBe(7);
});
