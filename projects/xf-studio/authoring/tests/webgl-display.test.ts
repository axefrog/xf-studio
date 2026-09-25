import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { LayeredProbe, PlateProbe } from "./webgl-probe-page";

/**
 * Real-GPU checks in headless Chrome (tests/webgl-probe-page.ts): every renderer material variant compiles and draws in
 * WebGL 2 (PREV-56), and the studio display blends in linear light, so a face decal shows the colour of the game's
 * square-root-space blend in both lighting presets (PREV-50), and the authored makeup plate blends in square-root space and is lit
 * once, with the skin's light, as the G-buffer lights the blended surface (plate-blend.ts: experiment 016's Board 5 steps, a stacked
 * pair against the export, and the lit plate against the blended surface drawn opaque). The same page runs again with both half-float
 * render extensions hidden (PREV-59). Needs a local Chrome; public CI has none and skips, and XFS_REQUIRE_ORACLES=1 turns the skip
 * into a failure.
 */
type Probe = { ok: boolean; linear: boolean; renderer: string; errors: string[]; programs: string[]; failure?: string;
  blends: { name: string; target: number[]; studio: number[]; creator: number[]; creatorTarget: number[]; direct: number[] }[];
  opaque: { studio: number[]; direct: number[] }; backdrop: { studio: number[]; direct: number[] }; plate?: PlateProbe; layered?: LayeredProbe;
  display: { path: string; creatorTarget: string }; environment: string };
const PAGE = resolve(import.meta.dir, "webgl-probe-page.ts");
const gap = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((value, k) => Math.abs(value - b[k]!)));
/** Largest relative difference per channel. */
const relative = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((value, k) => Math.abs(value / b[k]! - 1)));

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("renderer shaders on a real GPU", () => {
  let probe: Probe, hidden: Probe;
  beforeAll(async () => {
    probe = await runProbePage<Probe>(PAGE);
    hidden = await runProbePage<Probe>(PAGE, "?hide=half-float");
  }, 180_000);

  test("every decal family variant (plain, double diffuse, gradient recolour), the brows, skin, eyes and display passes compile and draw", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.ok).toBe(true);
    expect(probe.errors).toEqual([]);
    expect(probe.programs.length).toBeGreaterThanOrEqual(10);
    expect(probe.display).toEqual({ path: "linear", creatorTarget: "half-float" });
    expect(probe.environment).toBe("pmrem");
  });

  test("without a renderable half-float buffer everything still draws: the creator preset through an 8-bit sRGB target, the room as a light probe (PREV-59)", () => {
    expect(hidden.failure).toBeUndefined();
    expect(hidden.ok).toBe(true);
    expect(hidden.linear).toBe(false);
    // No incomplete framebuffers (the prefilter's and the display's half-float targets were the silent failures).
    expect(hidden.errors).toEqual([]);
    expect(hidden.display).toEqual({ path: "direct", creatorTarget: "srgb8" });
    expect(hidden.environment).toBe("probe");
    // The creator preset still shows the game's square-root blend, within 8-bit rounding, and is not black.
    for (const blend of hidden.blends) {
      expect(gap(blend.creator, blend.creatorTarget)).toBeLessThanOrEqual(2);
      expect(Math.max(...blend.creatorTarget)).toBeGreaterThan(20);
      // The same picture as the half-float target within 8-bit rounding: nothing here comes near the clip at one.
      expect(gap(blend.creatorTarget, probe.blends.find(item => item.name === blend.name)!.creatorTarget)).toBeLessThanOrEqual(2);
    }
  });

  test("the studio stage shows a decal as the game's square-root blend, within rounding, as the creator preset does (PREV-50)", () => {
    expect(probe.linear).toBe(true);
    for (const blend of probe.blends) {
      expect(gap(blend.studio, blend.target)).toBeLessThanOrEqual(2);
      expect(gap(blend.creator, blend.creatorTarget)).toBeLessThanOrEqual(2);
    }
    // Drawn straight to the canvas (the old studio path) the blend happens after tone mapping and encoding: the liner is far off.
    expect(gap(probe.blends.find(blend => blend.name === "dark liner")!.direct, probe.blends[0]!.target)).toBeGreaterThan(10);
  });

  test("Board 5 on the authored plate: black Matte at 25/50/75 % leaves (1 − a)² of the skin (0.56, 0.25, 0.06), not 1 − a", () => {
    const plate = probe.plate!;
    expect(plate).toBeDefined();
    const predicted = [0.56, 0.25, 0.06];
    plate.steps.forEach((step, i) => {
      for (const value of step.sqrt) {
        expect(Math.abs(value - (1 - step.coverage) ** 2)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(value - predicted[i]!)).toBeLessThanOrEqual(0.015);
      }
      // Without the skin under the plate, the old linear blend: 0.75, 0.5, 0.25.
      for (const value of step.linear) expect(Math.abs(value - (1 - step.coverage))).toBeLessThanOrEqual(0.01);
    });
  });

  test("two overlapping layers on the plate show the export's merged decal over the skin", () => {
    const { preview, target, linear } = probe.plate!.stack;
    preview.forEach((value, k) => expect(Math.abs(value / target[k]! - 1)).toBeLessThanOrEqual(0.02));
    // The linear blend was measurably lighter.
    expect(Math.max(...linear.map((value, k) => value / target[k]! - 1))).toBeGreaterThan(0.05);
    expect(probe.errors).toEqual([]);
  });

  test("the plate is lit once, with the skin's light, as the G-buffer lights the blended surface: stacked, Glossy, Metallic either side of 0.1", () => {
    const { once } = probe.plate!;
    expect(once).toHaveLength(5);
    for (const item of once) {
      expect(item.skinLight).toBe(true);
      expect(relative(item.preview, item.truth)).toBeLessThanOrEqual(0.015);
    }
    // The engine's SSS switch sits on the blended metalness.
    expect(once[2]!.metalness).toBeLessThan(0.1);
    expect(once[3]!.metalness).toBeGreaterThan(0.1);
  });

  test("for a surface as rough as the skin, the plate and the face decals' pass agree; for Glossy the plate matches the lit blend", () => {
    const { parity, glossy } = probe.plate!;
    expect(relative(parity.plate, parity.decal)).toBeLessThanOrEqual(0.015);
    expect(relative(glossy.plate, glossy.truth)).toBeLessThanOrEqual(0.015);
  });

  test("every plate route compiles and draws, with and without the skin light", () => {
    expect(probe.plate!.routes).toEqual(["faceted", "fresnel", "flat+1 own", "faceted", "fresnel", "flat+1 own"]);
    expect(probe.errors).toEqual([]);
  });

  test("the layered bake compiles on the GPU and matches its CPU reference: front-to-back coverage, levels, colour mask, microblend, RNM", () => {
    const layered = probe.layered!;
    expect(layered).toBeDefined();
    expect(layered.error).toBeUndefined();
    expect(layered.state).toBe("baked");
    expect(layered.drawn).toEqual([2, 1, 0]);
    // Packed 8-bit maps (PREV-63): within one byte of the reference, after half-float accumulation.
    expect(gap(layered.gpu.colour, layered.cpu.colour)).toBeLessThanOrEqual(1);
    expect(gap(layered.gpu.normal, layered.cpu.normal)).toBeLessThanOrEqual(1);
    // Two packed 8-bit maps with mips at 8 texels square: 8 bytes a texel and a third more for the mips.
    expect(layered.bytes).toBe(Math.round(8 * 8 * 8 * 4 / 3));
    expect(probe.errors).toEqual([]);
  });

  test("the lit material reads roughness and metalness from the packed maps' alpha: it matches a plain material of the same surface", () => {
    const { lit } = probe.layered!;
    expect(lit).toBeDefined();
    expect(Math.max(...lit!.plain)).toBeGreaterThan(0.01);
    // Close to the plain material (8-bit maps and the normal map's shading frame account for a few per cent)...
    expect(relative(lit!.baked, lit!.plain)).toBeLessThanOrEqual(0.08);
    // ...and far from the same maps read the default way (roughness from G, metalness from B), which is what the packing must avoid.
    expect(relative(lit!.naive, lit!.plain)).toBeGreaterThan(0.25);
  });

  test("with non-constant maps the bake reads them where the game does: tiling, offset, the mask orientation, sRGB colour", () => {
    const { parity } = probe.layered!;
    expect(parity.error).toBeUndefined();
    expect(parity.texels).toBe(256);
    expect(parity.colour).toBeLessThanOrEqual(1);
    expect(parity.normal).toBeLessThanOrEqual(1);
  });

  test("opaque surfaces and the stage backdrop keep the pixels they had when drawn straight to the canvas", () => {
    expect(gap(probe.opaque.studio, probe.opaque.direct)).toBeLessThanOrEqual(1);
    expect(probe.backdrop.studio).toEqual(probe.backdrop.direct);
  });
});
