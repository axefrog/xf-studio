import { expect, test } from "bun:test";
import { blinkAssetsPresent, LASH_SKIN_AGREEMENT, measureBlink, weightAgreement } from "../tools/verify_blink";

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
  // Lashes stay on the lid when they are skinned like the lid skin they sit on (vanilla, and a mod rigged the same way); the synthetic
  // study left them behind by about 6 mm. A lash mesh rigged to other lid joints than the skin under it (its roots' weights share less
  // than LASH_SKIN_AGREEMENT with that skin) leaves the lid when it closes in any renderer that skins it the engine's way: that is the
  // mod's rigging, reported plainly for an in-game check, not a preview drift.
  const agreement = neutral.upperLashRootSkinAgreement as Record<string, number>;
  for (const [component, drift] of Object.entries(neutral.solved100.upperLashRootDrift as Record<string, { medianMm: number }>)) {
    expect(Number.isFinite(drift.medianMm), component).toBe(true);
    if (agreement[component]! < LASH_SKIN_AGREEMENT) {
      console.warn(`${component}: its lash roots follow other lid joints than the lid skin under them (weight agreement ${agreement[component]}), ` +
        `so at full closure they leave the lid by ${drift.medianMm.toFixed(2)} mm (median). That is the mesh's own rigging; check it in game.`);
      continue;
    }
    expect(drift.medianMm, component).toBeLessThan(1);
    expect((neutral.synthetic.upperLashRootDrift as Record<string, { medianMm: number }>)[component]!.medianMm).toBeGreaterThan(4);
  }
  expect(neutral.solved100.plateDrift.maxMm).toBeLessThan(1e-6);
  expect(neutral.solved100.browDrift.maxMm).toBeLessThan(0.5);
}, 300_000);

test("lash skin agreement: the share of two vertices' skin weight on the same joints", () => {
  const lid = new Map([["l_J_eye_lid_up_rowA_1_JNT", 0.7], ["l_J_eye_lid_up_rowA_2_JNT", 0.3]]);
  // A lash root weighted like the lid skin under it (its lash joint already folded into that lid joint) agrees fully.
  expect(weightAgreement(new Map([["l_J_eye_lid_up_rowA_1_JNT", 0.7], ["l_J_eye_lid_up_rowA_2_JNT", 0.3]]), lid)).toBeCloseTo(1, 6);
  // One weighted mostly to a row above the margin and to the corner (the way a mod may rig it) shares little.
  expect(weightAgreement(new Map([["l_J_eye_lid_up_rowB_0_JNT", 0.6], ["l_J_eye_lid_up_rowA_3_JNT", 0.3], ["l_J_eye_lid_up_rowA_1_JNT", 0.1]]), lid))
    .toBeCloseTo(0.1, 6);
  expect(weightAgreement(new Map(), lid)).toBe(0);
  expect(LASH_SKIN_AGREEMENT).toBe(0.5);
});
