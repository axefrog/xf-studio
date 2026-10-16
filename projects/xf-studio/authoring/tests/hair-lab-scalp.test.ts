import { expect, test } from "bun:test";
import { constrainDensity, densityCoverage, densityMask, projectCapDensity, coveragePattern, fitCapSurface } from "../src/features/hair-lab/scalp";
import { surfaceProjector } from "../src/features/hair-lab/contact";
import { dot, sub } from "../src/features/hair-lab/types";
import { sphereSurface } from "./hair-lab-domain.test";

test("generated coverage rejects a painted face, ears and neck before the cap material can draw it", () => {
  const head = sphereSurface(), unsafe = head.positions.map((_, i) => i % 3 === 0 ? 1 : 0).slice(0, head.positions.length / 3).fill(1);
  expect(densityCoverage(head, unsafe).passed).toBe(false);
  const density = constrainDensity(head, unsafe);
  expect(densityCoverage(head, density)).toEqual({ ears: 0, face: 0, forehead: 0, neck: 0, nonScalp: 0, passed: true });
  const mask = densityMask(head, density, 64);
  expect(mask.values.some(v => v > 0)).toBe(true);
  expect(mask.values.filter(v => v === 0).length).toBeGreaterThan(1000);
});
test("cap seed samples its UV mask and projects onto head topology instead of using cap vertices as roots", () => {
  const head = sphereSurface(), values = new Uint8Array(16 * 16).fill(255);
  const density = projectCapDensity({ ...head, cap: { source: "synthetic-cap", points: head.positions, indices: head.indices, uv: head.uv, mask: { width: 16, height: 16, values } } })!;
  expect(density).toHaveLength(head.positions.length / 3);
  expect(densityCoverage(head, density).passed).toBe(true);
  expect(density.some(v => v > .9)).toBe(true);
  values.fill(0);
  expect(projectCapDensity({ ...head, cap: { source: "empty-cap", points: head.positions, indices: head.indices, uv: head.uv, mask: { width: 16, height: 16, values } } })!.every(v => v === 0)).toBe(true);
});

test("cap fitting clears the surface between coarse vertices and preserves cap UV topology", () => {
  const head = sphereSurface(), cap = { positions: [0, .1, 0, .08, .06, 0, 0, .06, .08], indices: [0, 2, 1], uv: [0, 0, 1, 0, 0, 1] };
  const fitted = fitCapSurface(head, cap), project = surfaceProjector(head.positions, head.indices);
  expect(fitted.indices).toEqual(cap.indices); expect(fitted.uv).toEqual(cap.uv);
  for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8 - a; b++) {
    const weights = [a / 8, b / 8, 1 - (a + b) / 8];
    const p = [0, 1, 2].map(k => weights.reduce((sum, w, i) => sum + w * fitted.positions[i * 3 + k], 0)) as [number, number, number];
    const hit = project(p); expect(dot(sub(p, hit.point), hit.normal)).toBeGreaterThan(.0002);
  }
});

test("coverage diagnostics distinguish a repeated hole lattice from smooth density", () => {
  const width = 64, values = new Uint8Array(width * width).fill(230);
  expect(coveragePattern({ width, height: width, values }).periodic).toBe(false);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (x % 8 < 3 && y % 8 < 3) values[y * width + x] = 0;
  expect(coveragePattern({ width, height: width, values }).periodic).toBe(true);
});
