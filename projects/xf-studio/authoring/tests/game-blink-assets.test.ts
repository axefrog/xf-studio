import { expect, test } from "bun:test";
import { blinkAssetsPresent, measureBlink } from "../tools/verify_blink";

/**
 * The numeric closure check on the real head, eye, plate, brows and lashes. It needs the local assets made from the
 * player's own game files (the derived preview and tools/bake_game_blink.py), so it is skipped where they are absent (CI).
 * The full four-shape report is `bun tools/verify_blink.ts` (evidence/game-blink-offline-check.json).
 */
test.skipIf(!blinkAssetsPresent())("on the real head the solved blink closes the lids where the synthetic study pushed through them", async () => {
  const report = await measureBlink(["neutral"]);
  expect(report.nonFiniteSamples).toBe(0);
  expect(report.restoreError).toBe(0);
  expect(report.unmapped).toBe(0);
  const neutral = report.shapes.neutral as Record<string, any>;
  for (const side of ["l", "r"]) {
    // The solved closure meets the lower lid: no eyeball left in view from the front, and at most about half a
    // millimetre of overlap; the synthetic study also hid the eye, but by driving the upper lid 3 mm past the lower one.
    expect(neutral.solved100.exposedFraction[side]).toBe(0);
    expect(neutral.solved100.lidGap[side].crossingMm).toBeLessThan(1);
    expect(neutral.synthetic.lidGap[side].crossingMm).toBeGreaterThan(3);
    expect(neutral.solved100.lidGap[side].medianMm).toBeLessThan(neutral.solved50.lidGap[side].medianMm);
  }
  // Lashes (vanilla and any resolved lash mesh) stay on the lid; the synthetic study left them behind by about 6 mm.
  for (const [component, drift] of Object.entries(neutral.solved100.upperLashRootDrift as Record<string, { medianMm: number }>)) {
    expect(drift.medianMm, component).toBeLessThan(1);
    expect((neutral.synthetic.upperLashRootDrift as Record<string, { medianMm: number }>)[component]!.medianMm).toBeGreaterThan(4);
  }
  expect(neutral.solved100.plateDrift.maxMm).toBeLessThan(1e-6);
  expect(neutral.solved100.browDrift.maxMm).toBeLessThan(0.5);
}, 300_000);
