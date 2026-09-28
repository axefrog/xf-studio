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

// The scene host has the same hazard one level up: its `idles` getter reads the rig's catalogue, and the host returned `{ ...api, … }`,
// which read it once while the head was built. Both must hand on the live object (the WebGL probe can't reach a late face, so the
// source is checked).
test("neither the rig nor the scene host copies its motion getters", async () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
  const [host, rig] = await Promise.all([read("../src/platform/scene/scene-host.ts"), read("../src/platform/scene/head-rig.ts")]);
  expect(host).toContain("get idles() { return motion.idles; }");
  expect(host).not.toMatch(/return\s*\{\s*\.\.\.api\b/);
  expect(host).toMatch(/return Object\.assign\(api, invalidating\(api,/);
  expect(rig).not.toMatch(/motion:\s*\{\s*\.\.\.motion\b/);
});
