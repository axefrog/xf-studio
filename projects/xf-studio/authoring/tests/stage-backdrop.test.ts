import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  linearToSrgbByte, oklabToLinearSrgb, oklchToOklab, STAGE_GRADIENT, STAGE_TOKENS, stageBackdropPixels, stageColour,
  stageGradientPosition,
} from "../src/stage-backdrop";
import { bindStageTheme } from "../src/stage-theme-binding";
import type { StageTheme } from "../src/stage-backdrop";
import type { ThemePreference } from "../src/ui-preferences";

const srgb = (theme: StageTheme, t: number) => stageColour(theme, t).map(linearToSrgbByte);

test("the stage tokens and gradient geometry mirror --stage in studio.css", () => {
  const css = readFileSync(resolve(import.meta.dir, "../public/studio.css"), "utf8");
  const line = css.split("\n").find(l => l.trim().startsWith("--stage:"));
  expect(line).toBeDefined();
  const [geometry] = /radial-gradient\(([^,]+),/.exec(line!)!.slice(1);
  expect(geometry!.trim()).toBe(`${STAGE_GRADIENT.radiusX * 100}% ${STAGE_GRADIENT.radiusY * 100}% at ` +
    `${STAGE_GRADIENT.centreX * 100}% ${STAGE_GRADIENT.centreY * 100}%`);
  const pairs = [...line!.matchAll(/light-dark\(oklch\(([^)]+)\), oklch\(([^)]+)\)\)/g)]
    .map(m => [m[1], m[2]].map(v => v!.trim().split(/\s+/).map(Number)));
  expect(pairs).toHaveLength(2);
  expect(pairs[0]).toEqual([[...STAGE_TOKENS.light.centre], [...STAGE_TOKENS.dark.centre]]);
  expect(pairs[1]).toEqual([[...STAGE_TOKENS.light.edge], [...STAGE_TOKENS.dark.edge]]);
  expect(line).toContain(`${STAGE_GRADIENT.edgeStop * 100}%)`);
});

test("OKLCH conversion keeps neutral greys neutral and matches known sRGB values", () => {
  expect(oklabToLinearSrgb([1, 0, 0]).map(linearToSrgbByte)).toEqual([255, 255, 255]);
  expect(oklabToLinearSrgb([0, 0, 0]).map(linearToSrgbByte)).toEqual([0, 0, 0]);
  // oklch(0.6279 0.2577 29.23) is sRGB red.
  expect(oklabToLinearSrgb(oklchToOklab([0.62796, 0.25768, 29.2339])).map(linearToSrgbByte)).toEqual([255, 0, 0]);
  // The stage has a faint cool tint (hue 255): blue slightly above red, all channels close.
  for (const theme of ["light", "dark"] as const) for (const t of [0, 1]) {
    const [r, g, b] = srgb(theme, t);
    expect(b).toBeGreaterThanOrEqual(r);
    expect(b - r).toBeLessThanOrEqual(6);
    expect(g).toBeGreaterThanOrEqual(r);
  }
  expect(srgb("light", 0)[1]).toBeGreaterThan(srgb("light", 1)[1]);
  expect(srgb("dark", 0)[1]).toBeGreaterThan(srgb("dark", 1)[1]);
  expect(srgb("light", 1)[1]).toBeGreaterThan(srgb("dark", 0)[1]);
});

test("gradient position follows the CSS ellipse: centre at (50%, 38%), edge colour from 70% of the radii", () => {
  expect(stageGradientPosition(0.5, 0.38)).toBe(0);
  expect(stageGradientPosition(0.5 + STAGE_GRADIENT.radiusX * 0.35, 0.38)).toBeCloseTo(0.5, 9);
  expect(stageGradientPosition(0.5, 0.38 + STAGE_GRADIENT.radiusY * 0.7)).toBeCloseTo(1, 9);
  expect(stageGradientPosition(0, 1)).toBe(1);
});

test("backdrop pixels are opaque, bottom-up, brightest near the upper centre and differ by theme", () => {
  const size = 32, light = stageBackdropPixels("light", size, size), dark = stageBackdropPixels("dark", size, size);
  expect(light).toHaveLength(size * size * 4);
  for (let i = 3; i < light.length; i += 4) { expect(light[i]).toBe(255); expect(dark[i]).toBe(255); }
  const green = (pixels: Uint8Array, column: number, rowFromTop: number) => pixels[((size - 1 - rowFromTop) * size + column) * 4 + 1]!;
  const centreRow = Math.floor(0.38 * size);
  expect(green(light, 16, centreRow)).toBeGreaterThan(green(light, 16, size - 1));
  expect(green(light, 16, centreRow)).toBeGreaterThan(green(light, 0, 0));
  expect(green(light, 16, centreRow)).toBeGreaterThan(green(dark, 16, centreRow));
  expect(() => stageBackdropPixels("dark", 0, 4)).toThrow();
});

test("the stage binding applies the resolved theme once and follows preference and system changes", () => {
  const calls: StageTheme[] = [];
  let preference: ThemePreference = "system";
  const preferenceListeners = new Set<() => void>(), systemListeners = new Set<() => void>();
  const system = { matches: true, addEventListener: (_: "change", l: () => void) => systemListeners.add(l),
    removeEventListener: (_: "change", l: () => void) => systemListeners.delete(l) };
  const unbind = bindStageTheme({ setStage: theme => calls.push(theme) },
    { snapshot: () => ({ theme: preference }), subscribe: l => { preferenceListeners.add(l); return () => preferenceListeners.delete(l); } },
    system);
  expect(calls).toEqual(["dark"]);
  for (const l of preferenceListeners) l();
  expect(calls).toEqual(["dark"]);
  system.matches = false;
  for (const l of systemListeners) l();
  expect(calls).toEqual(["dark", "light"]);
  preference = "dark";
  for (const l of preferenceListeners) l();
  expect(calls).toEqual(["dark", "light", "dark"]);
  unbind();
  expect(preferenceListeners.size).toBe(0);
  expect(systemListeners.size).toBe(0);
});
