import { expect, test } from "bun:test";
import { withRigMotion, type RigMotionAssets } from "../src/platform/scene/head-rig";
import { BUILT_IN_CATALOGUE, type IdleCatalogue } from "../src/idle-catalogue";

// Installed desktop acceptance, 29 September: the idle's faces arrive after the head is built (PREV-174), and the eyes section joins the
// catalogue only then. The rig kept a spread copy of the loader's motion, which froze the catalogue and faceError at build time, so the
// Motion panel never offered "Creator close-up, eyes section" on a first run.
test("the rig's motion keeps the loader's catalogue and face reason live", () => {
  let catalogue: IdleCatalogue = BUILT_IN_CATALOGUE;
  const loaded: RigMotionAssets = { idleError: "", blinkError: "", faceError: "Reading V's face…", get idles() { return catalogue; } };
  const rig = { name: "composed" };
  const motion = withRigMotion(loaded, rig);
  expect(motion.rig).toBe(rig);
  expect(motion.idles?.idles.map(entry => entry.id)).toEqual(BUILT_IN_CATALOGUE.idles.map(entry => entry.id));
  // The faces arrive: the catalogue gains the eyes section and the face reason clears.
  const eyes = { ...BUILT_IN_CATALOGUE.idles[0]!, id: "closeup-eyes", label: "Creator close-up, eyes section" };
  catalogue = { ...BUILT_IN_CATALOGUE, idles: [...BUILT_IN_CATALOGUE.idles, eyes] };
  loaded.faceError = "";
  expect(motion.idles?.idles.map(entry => entry.id)).toContain("closeup-eyes");
  expect(motion.faceError).toBe("");
});
