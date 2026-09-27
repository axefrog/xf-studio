// Swatch contrast enhancement (swatch-contrast.ts) and how a colour row's swatches are shown (cc-swatch-display.ts): a tightly clustered set
// is spread apart in OKLab with an adaptive gain, an already varied set is left alone, and the true colours stay available. Asset-free:
// the sets are sample colours shaped like the reference installation's (a brow pack over natural hair tones; vanilla hair gradients).
import { describe, expect, test } from "bun:test";
import { displaySwatches, SwatchDisplayMemo } from "../src/cc-swatch-display";
import { CONTRAST, contrastGain, enhanceSwatchSet, hexToOklab, oklabToHex, separationWeight } from "../src/swatch-contrast";

const CLUSTERED = [["#030303"], ["#534f46"], ["#210402"], ["#2d1208"], ["#090402"], ["#494339"], ["#3f3628"], ["#2c2420"], ["#2b1c09"], ["#4d4038"],
  ["#2a2725"], ["#540000"], ["#2b211a"], ["#460e18"], ["#3d3735"], ["#3e2117"], ["#3e2117"], ["#13100e"], ["#6c6664"], ["#231610"]];
const VARIED = [["#996600", "#e4deae", "#886b49", "#5f330f", "#653300"], ["#e4cca6", "#d8ccbc", "#e8d9c3", "#e9dac4", "#e9dbc5"],
  ["#aa7480", "#6a4d43", "#493828", "#372b1f", "#261f16"], ["#ffffcc", "#810202", "#fc9664", "#9f3900", "#ca6400"], ["#bababa", "#b0b0b0", "#a7a7a7", "#989797", "#706969"],
  ["#000000", "#000000", "#000000", "#000000", "#000000"], ["#623d1f", "#a56c78", "#897aba", "#64afc7", "#72c2ca"], ["#72777a", "#7c8084", "#adadb2", "#7a757c", "#857c86"]];
const L = (hex: string) => hexToOklab(hex)[0];
const hueOf = (hex: string) => { const [, a, b] = hexToOklab(hex); return Math.atan2(b, a) * 180 / Math.PI; };
const chromaOf = (hex: string) => { const [, a, b] = hexToOklab(hex); return Math.hypot(a, b); };

describe("the gain curve", () => {
  test("1 at or above the comfortable spread, rising as the spread shrinks, capped", () => {
    expect(contrastGain(0.3, 0.2)).toBe(1);
    expect(contrastGain(0.2, 0.2)).toBe(1);
    expect(contrastGain(0.1, 0.2)).toBeCloseTo(Math.SQRT2, 6);
    expect(contrastGain(0.001, 0.2)).toBe(CONTRAST.maxGain);
    // Monotone: a tighter set never gets less gain.
    const gains = [0.19, 0.15, 0.1, 0.05, 0.02].map(spread => contrastGain(spread, 0.2));
    expect(gains).toEqual([...gains].sort((a, b) => a - b));
    // The separation weight: all of it for a tight set, none for a comfortably separated one, smooth between.
    expect([separationWeight(0.05), separationWeight(CONTRAST.separated)]).toEqual([1, 0]);
    expect(separationWeight(CONTRAST.separated * 0.8)).toBeGreaterThan(0);
  });

  test("OKLab round-trips sRGB within a byte", () => {
    for (const hex of ["#000000", "#ffffff", "#3e2117", "#0f4a71", "#e565a6"]) {
      const [l, a, b] = hexToOklab(hex);
      const back = oklabToHex(l, Math.hypot(a, b), Math.atan2(b, a));
      for (let at = 1; at < 7; at += 2) expect(Math.abs(parseInt(back.slice(at, at + 2), 16) - parseInt(hex.slice(at, at + 2), 16))).toBeLessThanOrEqual(1);
    }
  });
});

describe("a set of swatches", () => {
  test("a tightly clustered set is spread apart in lightness, keeping order, identical colours identical, and every colour in gamut", () => {
    const result = enhanceSwatchSet(CLUSTERED);
    expect(result.enhanced).toBe(true);
    expect(result.lightness.gain).toBeGreaterThan(1.3);
    const before = CLUSTERED.map(([hex]) => L(hex!)), after = result.colours.map(([hex]) => L(hex!));
    const spread = (values: number[]) => { const mean = values.reduce((s, v) => s + v, 0) / values.length; return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length); };
    expect(spread(after)).toBeGreaterThan(spread(before) * 1.3);
    // Order along lightness is kept.
    const order = (values: number[]) => values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
    expect(order(after.map(v => Math.round(v * 1e4)))).toEqual(order(before.map(v => Math.round(v * 1e4))));
    // Two identical colours (#3e2117 twice) stay identical.
    expect(result.colours[15]).toEqual(result.colours[16]);
    for (const [hex] of result.colours) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("hue moves at most the cap and chroma at most its cap: a near-black maroon never turns vivid red, a brown stays brown", () => {
    const result = enhanceSwatchSet(CLUSTERED);
    CLUSTERED.forEach(([hex], i) => {
      const out = result.colours[i]![0]!;
      expect(chromaOf(out)).toBeLessThanOrEqual(chromaOf(hex!) * CONTRAST.maxChromaGain + 0.004);
      if (chromaOf(hex!) < CONTRAST.hueChromaFloor || chromaOf(out) < 0.01) return;
      const shift = Math.abs(((hueOf(out) - hueOf(hex!) + 540) % 360) - 180);
      // Gamut clipping at the same hue can add a little; the rotation itself is capped.
      expect(shift).toBeLessThanOrEqual(CONTRAST.maxHueShift + 2);
    });
  });

  test("an already varied set (hair gradients) is left alone, stop for stop", () => {
    const result = enhanceSwatchSet(VARIED);
    expect(result.enhanced).toBe(false);
    expect(result.colours).toEqual(VARIED);
    // One swatch, or none, is never touched.
    expect(enhanceSwatchSet([["#102030"]]).enhanced).toBe(false);
    expect(enhanceSwatchSet([]).colours).toEqual([]);
  });

  test("a gradient's stops move by one mapping, so the gradient keeps its shape", () => {
    const set = [["#201810", "#302418"], ["#221a12", "#2c2016"], ["#1e160e", "#342a1c"]];
    const result = enhanceSwatchSet(set);
    expect(result.enhanced).toBe(true);
    result.colours.forEach((stops, i) => expect(L(stops[1]!) > L(stops[0]!)).toBe(L(set[i]![1]!) > L(set[i]![0]!)));
  });
});

describe("a colour row's shown swatches", () => {
  const sheets = new Map([[0, { url: "sheet.png", columns: 2, rows: 1 }]]);
  const state = (swatches: string[], icons: string[] = []) => ({ swatches, icons, sheets, pending: false });
  const choice = (position: number, mod: number, off = false) => ({ position, mod, off });

  test("each maker group is its own set; the true colours stay in `truth`; icons and Off take no part; the replaced mark is kept", () => {
    const dark = CLUSTERED.slice(0, 6).map(([hex]) => `!${hex}`);
    const hair = VARIED.slice(0, 4).map(stops => stops.join(">"));
    // Position 0 Off; 1–6 a mod's clustered colours (group 2); 7–10 the game's varied ones (group 0), 7 drawn with its atlas icon.
    const swatches = ["", ...dark, ...hair];
    const icons = ["", "", "", "", "", "", "", "0:1", "", "", ""];
    const choices = [choice(0, -1, true), ...dark.map((_, i) => choice(1 + i, 0)), ...hair.map((_, i) => choice(7 + i, -1))];
    const shown = displaySwatches(state(swatches, icons), choices, { modGroups: [2] });
    expect(shown.truth).toEqual(swatches);
    expect([...shown.enhanced].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shown.swatches.slice(1, 7).every(text => text.startsWith("!"))).toBe(true);
    expect(shown.swatches.slice(1, 7)).not.toEqual(dark);
    // The game's varied group is untouched, and the icon position was never a member.
    expect(shown.swatches.slice(7)).toEqual(hair);
    expect([...shown.sets.keys()]).toEqual([2]);
  });

  test("a pooled group counts as one set with the others pooled with it; the memo recomputes only when its inputs change", () => {
    const swatches = ["#201810", "#221a12", "#1e160e", "#241b13"];
    const choices = [choice(0, 0), choice(1, 1), choice(2, 0), choice(3, 1)];
    const pooled = displaySwatches(state(swatches), choices, { modGroups: [3, 4], pooled: [3, 4] });
    expect(pooled.enhanced.size).toBe(4);
    expect(displaySwatches(state(swatches), choices, { modGroups: [3, 4] }).enhanced.size).toBe(4);
    const memo = new SwatchDisplayMemo(), input = state(swatches);
    const first = memo.get("row", input, choices, null);
    expect(memo.get("row", input, choices, null)).toBe(first);
    expect(memo.get("row", state(swatches), choices, null)).not.toBe(first);
  });
});
