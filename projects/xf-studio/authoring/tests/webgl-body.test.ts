import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { BodyProbe } from "./webgl-body-probe-page";

/**
 * The V's body on a real GPU (knowledge/body-rendering.md; tests/webgl-body-probe-page.ts): the real scene host on a synthetic head with a
 * synthetic body record loaded through the host's detail loader. The body draws in the whole-body view with its own shape, the underwear
 * cover follows that shape and blends against the body skin, the rigid nails follow the rig, the toggle hides and shows it without
 * touching GPU memory, the depth range covers it while it shows, and switching V releases it. Needs a local Chrome; public CI has none and
 * skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "webgl-body-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("the body on a real GPU", () => {
  let probe: BodyProbe;
  beforeAll(async () => { probe = await runProbePage<BodyProbe>(PAGE, "", 120_000); }, 180_000);

  test("the body draws in the whole-body view, every program compiles, and nothing is left out", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.ok).toBe(true);
    expect(probe.drawn.differs).toBe(true);
    expect(probe.drawn.bodyPixels).toBeGreaterThan(200);
    expect(probe.drawn.slots).toEqual(["body", "body", "body"]);
    expect(probe.drawn.problems).toEqual([]);
    // The cover read the body skin under it (a linear fallback would say so), and the nails' missing skin is the one limit.
    expect(probe.drawn.notes.filter(note => /linear decal blend/.test(note))).toEqual([]);
    expect(probe.drawn.limits).toEqual([{ slot: "body", limit: "rigid-body-part" }]);
  });

  test("the body's own shape is on, and the underwear cover follows it as one more shape key", () => {
    expect(probe.shapes.body).toBe(1);
    expect(probe.shapes.coverKeys).toEqual(["xfs_body_shape"]);
    expect(probe.shapes.cover).toBe(1);
  });

  test("a rigid body part gets one bone at its centre that follows the rig", () => {
    expect(probe.rigid).toEqual({ bones: 1, follows: true });
  });

  test("hiding the body shows the empty stage again without releasing GPU memory; showing it restores the frame", () => {
    expect(probe.hidden).toEqual({ differsFromEmpty: false, memorySame: true, shownAgainSame: true });
  });

  test("while the body shows, the depth range covers it from the head's planes outwards", () => {
    const { depth } = probe;
    expect(depth.bodyNear).toBeLessThanOrEqual(depth.hiddenNear);
    expect(depth.bodyNear).toBeLessThan(depth.feetDistance);
    expect(depth.bodyFar).toBeGreaterThanOrEqual(Math.max(depth.hiddenFar, depth.feetDistance));
  });

  test("switching to a V without a body, back, and to none leaves the GPU memory where it was (dispose leak)", () => {
    const { memory } = probe;
    expect(memory.withBody.geometries).toBeGreaterThan(memory.empty.geometries);
    expect(memory.withBody.textures).toBeGreaterThan(memory.empty.textures);
    expect(memory.headOnly).toEqual(memory.empty);
    expect(memory.bodyAgain).toEqual(memory.withBody);
    expect(memory.none).toEqual(memory.empty);
  });
});
