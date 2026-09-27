import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { PreviewProbe } from "./webgl-choice-preview-probe-page";

/**
 * The choice preview renderer's channel encoding on a real GPU (tests/webgl-choice-preview-probe-page.ts; choice-previews-design.md §3.3):
 * a synthetic feature over a synthetic subject comes back as R = feature × light, G = subject × light, B = feature fraction, A = coverage.
 * Needs a local Chrome; public CI has none and skips.
 */
const PAGE = resolve(import.meta.dir, "webgl-choice-preview-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("choice preview channels on a real GPU", () => {
  let probe: PreviewProbe;
  beforeAll(async () => { probe = await runProbePage<PreviewProbe>(PAGE); }, 120_000);

  test("renders and encodes a WebP", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.ok).toBe(true);
    expect(probe.size).toBe(256);
    expect(probe.webpBytes).toBeGreaterThan(40);
  });
  test("full coverage: all feature, lit, fully covered", () => {
    const [r, g, b, a] = probe.full as [number, number, number, number];
    expect(a).toBeGreaterThan(252);
    expect(b).toBeGreaterThan(252);
    expect(g).toBeLessThan(3);
    expect(r).toBeGreaterThan(0.18 * 255);
  });
  test("half coverage over the subject: covered everywhere, half of it feature, the rest subject at the same light", () => {
    const [r, g, b, a] = probe.half as [number, number, number, number];
    expect(a).toBeGreaterThan(252);
    expect(Math.abs(b - 127.5)).toBeLessThan(4);
    // R = f·l and G = (1 − f)·l with f ≈ ½: equal within rounding.
    expect(Math.abs(r - g)).toBeLessThan(4);
  });
  test("the turntable strip: frames side by side, frame 0 is the still, and from behind the subject hides the feature", () => {
    const strip = probe.strip!;
    expect(strip.width).toBe(24 * 256);
    expect(strip.height).toBe(256);
    expect(strip.frame0Diff).toBeLessThanOrEqual(1);
    const [, g, b, a] = strip.behind as [number, number, number, number];
    expect(a).toBeGreaterThan(252);
    expect(b).toBeLessThan(8);
    expect(g).toBeGreaterThan(0.18 * 255);
    expect(strip.webpBytes).toBeGreaterThan(40);
  });
  test("a chunk not in the source draws nothing, and the ground is empty", () => {
    expect(probe.unlisted[3]).toBe(0);
    expect(probe.ground[3]).toBe(0);
  });
});
