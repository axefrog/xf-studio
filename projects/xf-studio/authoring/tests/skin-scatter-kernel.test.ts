import { describe, expect, test } from "bun:test";
import { assignScatterSlots, fullKernel, packScatterTable, referenceScatter, SCATTER_ENTRIES, SCATTER_ROW, SCATTER_SLOTS, scatterFalloff,
  scatterSlot, scatterStrength, scatterTapPixels, storedKernel, type ScatterProfile } from "../src/platform/scene/skin-scatter-kernel";

/** `default.sp` (2.31): blur size 1.4, strength 255/255/255, falloff 255/178/165 (research/materials/shader-skin.md §6.5). */
const DEFAULT_SP: ScatterProfile = { blurSize: 1.4, diffuse: [255, 255, 255], falloff: [255, 178, 165] };
/** `customisation_teeth.sp`: zero falloff (clamped to 0.009). */
const TEETH_SP: ScatterProfile = { blurSize: 1.4, diffuse: [255, 255, 255], falloff: [0, 0, 0] };

/** §6.3.2's 25-sample table for `default.sp` (offsets before `blurSize`), computed from the decoded builder. */
const TABLE = {
  offset: [0, 0.021, 0.083, 0.188, 0.333, 0.521, 0.750, 1.021, 1.333, 1.688, 2.083, 2.521, 3.000],
  r: [0.0221, 0.0440, 0.0839, 0.1028, 0.0855, 0.0549, 0.0373, 0.0268, 0.0197, 0.0146, 0.0104, 0.0070, 0.0020],
  g: [0.0480, 0.0944, 0.1492, 0.1008, 0.0543, 0.0332, 0.0213, 0.0126, 0.0062, 0.0025, 0.0010, 0.0004, 0.0001],
  b: [0.0564, 0.1103, 0.1595, 0.0907, 0.0493, 0.0296, 0.0177, 0.0090, 0.0036, 0.0013, 0.0005, 0.0002, 0.0000],
};

describe("the game's scatter kernel (shader-skin.md §6.3.2)", () => {
  test("default.sp at High reproduces the documented 25-sample table to 1e-4", () => {
    const kernel = storedKernel(SCATTER_ENTRIES.high, scatterFalloff(DEFAULT_SP));
    expect(kernel).toHaveLength(13);
    kernel.forEach((entry, i) => {
      expect(Math.abs(entry.offset - TABLE.offset[i]!)).toBeLessThanOrEqual(5e-4 + 1e-12); // the table rounds to 3 decimals
      expect(Math.abs(entry.weight[0] - TABLE.r[i]!)).toBeLessThan(1e-4);
      expect(Math.abs(entry.weight[1] - TABLE.g[i]!)).toBeLessThan(1e-4);
      expect(Math.abs(entry.weight[2] - TABLE.b[i]!)).toBeLessThan(1e-4);
    });
  });

  test("each channel sums to one over the whole kernel: centre plus twice the stored positive entries", () => {
    for (const quality of ["low", "medium", "high"] as const) {
      const stored = storedKernel(SCATTER_ENTRIES[quality], scatterFalloff(DEFAULT_SP));
      for (let k = 0; k < 3; k++) expect(stored[0]!.weight[k]! + 2 * stored.slice(1).reduce((s, e) => s + e.weight[k]!, 0)).toBeCloseTo(1, 10);
      const all = fullKernel(SCATTER_ENTRIES[quality], scatterFalloff(DEFAULT_SP));
      expect(all).toHaveLength(2 * SCATTER_ENTRIES[quality] - 1);
      for (let k = 0; k < 3; k++) expect(all.reduce((s, e) => s + e.weight[k]!, 0)).toBeCloseTo(1, 10);
    }
  });

  test("offsets: dense near zero, range 3 above 20 samples and 2 below; symmetric pairs", () => {
    expect(storedKernel(13, [1, 1, 1]).at(-1)!.offset).toBeCloseTo(3, 12);
    expect(storedKernel(9, [1, 1, 1]).at(-1)!.offset).toBeCloseTo(2, 12);
    expect(storedKernel(6, [1, 1, 1]).at(-1)!.offset).toBeCloseTo(2, 12);
    const all = fullKernel(9, [1, 1, 1]);
    expect(all[0]!.offset).toBe(0);
    const negatives = all.filter(e => e.offset < 0).map(e => -e.offset).sort(), positives = all.filter(e => e.offset > 0).map(e => e.offset).sort();
    positives.forEach((x, i) => expect(x).toBeCloseTo(negatives[i]!, 12));
  });

  test("the teeth profile keeps its weight on the centre and sub-pixel taps", () => {
    const kernel = storedKernel(13, scatterFalloff(TEETH_SP));
    for (let k = 0; k < 3; k++) {
      expect(kernel[0]!.weight[k]!).toBeGreaterThan(0.9);
      expect(kernel.filter(e => e.offset > 0.2).reduce((s, e) => s + e.weight[k]!, 0)).toBeLessThan(1e-3);
    }
  });

  test("profile colours are sRGB-decoded and clamped; blur size scales offsets only", () => {
    expect(scatterStrength({ diffuse: [255, 128, 0] })).toEqual([1, expect.closeTo(0.2158605, 6), 0] as never);
    expect(scatterFalloff({ falloff: [0, 255, 178] })).toEqual([0.009, 1, expect.closeTo(0.4452, 3)] as never);
    const one = scatterSlot({ ...DEFAULT_SP, blurSize: 1 }, "high"), two = scatterSlot({ ...DEFAULT_SP, blurSize: 2 }, "high");
    one.entries.forEach((entry, i) => {
      expect(two.entries[i]!.offset).toBeCloseTo(2 * entry.offset, 12);
      expect(two.entries[i]!.weight).toEqual(entry.weight);
    });
  });

  test("the packed table: strength and count, then weights and offsets per slot; empty slots are zero", () => {
    const high = scatterSlot(DEFAULT_SP, "high"), low = scatterSlot(TEETH_SP, "low");
    const table = packScatterTable([high, null, low]);
    expect(table.length).toBe(SCATTER_SLOTS * SCATTER_ROW * 4);
    expect([...table.slice(0, 4)]).toEqual([1, 1, 1, 13]);
    expect(table[4 + 3]).toBe(0);
    expect(table[4 * 13 + 3]).toBeCloseTo(3 * 1.4, 6);
    expect([...table.slice(SCATTER_ROW * 4, 2 * SCATTER_ROW * 4)].every(v => v === 0)).toBe(true);
    expect(table[2 * SCATTER_ROW * 4 + 3]).toBe(6);
  });

  test("slots follow first-seen distinct profiles, up to eight; later ones fall back to slot 0 and are counted", () => {
    const profiles = Array.from({ length: 10 }, (_, i) => ({ ...DEFAULT_SP, blurSize: 1 + i }));
    const { slotOf, distinct, overflow } = assignScatterSlots([DEFAULT_SP, TEETH_SP, DEFAULT_SP, ...profiles]);
    expect(slotOf.slice(0, 3)).toEqual([0, 1, 0]);
    expect(distinct).toHaveLength(8);
    expect(overflow).toBe(4);
    expect(slotOf.at(-1)).toBe(0);
  });

  test("whole-pixel taps truncate toward zero and shrink with depth", () => {
    expect(scatterTapPixels(4.2, 1.2, 2469)).toBe(8);
    expect(scatterTapPixels(4.2, 2.4, 2469)).toBe(4);
    expect(scatterTapPixels(0.03, 1.2, 2469)).toBe(0);
  });
});

describe("reference blur (the GPU passes' oracle)", () => {
  const W = 24, H = 8;
  const image = (fill: (x: number, y: number) => number[]) => {
    const out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(fill(x, y), (y * W + x) * 3);
    return out;
  };
  const scalar = <T extends Float32Array | Uint8Array>(make: new (n: number) => T, fill: (x: number, y: number) => number) => {
    const out = new make(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = fill(x, y);
    return out;
  };
  // A lit half and a dark half (a hard terminator at x = 12) on a class-1 strip from x = 2 to 21.
  const base = () => ({
    width: W, height: H, focalPixels: 2000,
    irradiance: image(x => x < 12 ? [1, 1, 1] : [0, 0, 0]), albedo: image(() => [0.5, 0.4, 0.3]),
    classOne: scalar(Uint8Array, x => x >= 2 && x <= 21 ? 1 : 0), depth: scalar(Float32Array, () => 1),
    metalness: scalar(Float32Array, () => 0), slot: scalar(Uint8Array, () => 0), slots: [scatterSlot(DEFAULT_SP, "high")],
  });

  test("light spreads into the unlit side, red furthest; nothing outside class 1", () => {
    const delta = referenceScatter(base());
    const at = (x: number, k: number) => delta[(4 * W + x) * 3 + k]!;
    expect(at(12, 0)).toBeGreaterThan(0);
    expect(at(12, 0) / 0.5).toBeGreaterThan(at(12, 1) / 0.4);
    for (let x = 0; x < W; x++) if (x < 2 || x > 21) for (let k = 0; k < 3; k++) expect(at(x, k)).toBe(0);
  });

  test("energy is conserved across a hard edge, and the result is continuous as the shadow's light goes to zero", () => {
    // A wide class-1 strip: what the unlit side gains the lit side loses (per channel), with E = 0 and E = 1e-4 in the shadow alike.
    const wide = (dark: number, redGate = false) => {
      const w = 120, h = 3, n = w * h;
      const irradiance = new Float32Array(n * 3);
      for (let p = 0; p < n; p++) for (let k = 0; k < 3; k++) irradiance[p * 3 + k] = p % w < 60 ? 1 : dark;
      const delta = referenceScatter({ width: w, height: h, irradiance, albedo: new Float32Array(n * 3).fill(1), classOne: new Uint8Array(n).fill(1),
        depth: new Float32Array(n).fill(1), metalness: new Float32Array(n), slot: new Uint8Array(n),
        slots: [scatterSlot({ blurSize: 2.5, diffuse: [255, 255, 255], falloff: [255, 155, 119] }, "high")], focalPixels: 4000, redGate });
      return (k: number) => Array.from({ length: w }, (_, x) => delta[(w + x) * 3 + k]!);
    };
    for (let k = 0; k < 3; k++) {
      const zero = wide(0)(k), tiny = wide(1e-4)(k);
      expect(Math.abs(zero.slice(20, 100).reduce((s, v) => s + v, 0))).toBeLessThan(5e-3); // against +16 with the red test
      expect(Math.max(...zero.map((v, x) => Math.abs(v - tiny[x]!)))).toBeLessThan(1e-3);
      expect(zero[59]!).toBeLessThan(0);
      expect(zero[60]!).toBeGreaterThan(0);
    }
    // The decoded red > 0 test, which the preview leaves out, is discontinuous there: at exactly zero it adds most of the lit red.
    expect(wide(0, true)(0)[60]!).toBeGreaterThan(0.8);
    expect(wide(1e-4, true)(0)[60]!).toBeLessThan(0.5);
  });

  test("the centre's metalness above 0.1 gates the pixel off", () => {
    const input = base();
    input.metalness[4 * W + 12] = 0.2;
    expect([...referenceScatter(input).slice((4 * W + 12) * 3, (4 * W + 12) * 3 + 3)]).toEqual([0, 0, 0]);
  });

  test("a distant face collapses to the centre (whole-pixel taps)", () => {
    const input = base();
    input.depth.fill(1000);
    // Every tap lands on the centre, so B equals E up to the renormaliser's 1e-5.
    expect(referenceScatter(input).every(v => Math.abs(v) < 1e-4)).toBe(true);
  });
});
