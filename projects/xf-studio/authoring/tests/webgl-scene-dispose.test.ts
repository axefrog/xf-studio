import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { SceneDisposeProbe } from "./webgl-scene-dispose-probe-page";

/**
 * Disposal that frees everything without the context being lost (profiles phase 4a-i, experiments/043-scene-runtimes): the real scene
 * host built five times on one renderer it doesn't own, each time showing a synthetic V with makeup layers under the creator rig and a
 * studio setup, then disposed. Every GPU object the context holds (counted at the driver, tests/webgl-gl-objects.ts) and Three's own
 * counts are back where they were after each disposal, apart from what lives as long as the renderer (`RENDERER_LIFETIME`, made by the
 * first scene and never again). Needs a local Chrome; public CI has none and skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a
 * failure. A leak shows here as a count that grows from one cycle to the next; XFS_PROBE_STACKS=1 XFS_PROBE_PRINT=1 prints the stack
 * that made each object left behind.
 */
/**
 * What the first scene leaves on the renderer for good, shared by every later scene and freed only with the renderer: Three's own DFG
 * lookup texture (any physically based material), its shadow pass's depth program, and the background plane it draws a textured scene
 * background with (its geometry's three buffers, vertex array and program); and the layered-makeup engine's shared 1×1 blank textures
 * (`NOTHING`, `NEUTRAL_MAP` in plate-composite.ts; `FLAT_NORMAL` is not drawn here). Three counts the textures and the plane's geometry.
 */
const RENDERER_LIFETIME = { gl: { texture: 3, buffer: 3, program: 2, vertexArray: 1 }, geometries: 1, textures: 3, programs: 2 };
const PAGE = resolve(import.meta.dir, "webgl-scene-dispose-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("scene host disposal on a shared renderer", () => {
  let probe: SceneDisposeProbe;
  beforeAll(async () => {
    // XFS_PROBE_STACKS=1 keeps the stack that made each GPU object, to trace a leak (with XFS_PROBE_PRINT=1 to see it).
    probe = await runProbePage<SceneDisposeProbe>(PAGE, process.env.XFS_PROBE_STACKS === "1" ? "?stacks" : "", 120_000);
    if (process.env.XFS_PROBE_PRINT === "1") console.log(JSON.stringify(probe, null, 1));
  }, 180_000);

  test("five hosts built and disposed on one renderer, each drawing its V, with no shader error", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.cycles).toHaveLength(5);
    for (const cycle of probe.cycles) {
      expect(cycle.framesDrawn).toBeGreaterThan(0);
      expect([...cycle.drawn].sort()).toEqual(["eyes", "face", "skin"]);
      // The V really used the GPU: textures and programs beyond the empty renderer's.
      expect(cycle.shown.gl.texture).toBeGreaterThan(probe.baseline.gl.texture);
      expect(cycle.shown.gl.program).toBeGreaterThan(probe.baseline.gl.program);
    }
    // The host never removes the renderer's canvas.
    expect(probe.canvases).toBe(1);
  });

  test("the first disposal leaves only what lives as long as the renderer", () => {
    const [first] = probe.cycles, { baseline } = probe;
    const left = Object.fromEntries(Object.entries(first!.disposed.gl).map(([kind, count]) => [kind, count - baseline.gl[kind as keyof typeof baseline.gl]])
      .filter(([, count]) => count !== 0));
    expect(left).toEqual(RENDERER_LIFETIME.gl);
    expect({ geometries: first!.disposed.geometries - baseline.geometries, textures: first!.disposed.textures - baseline.textures,
      programs: first!.disposed.programs - baseline.programs }).toEqual({ geometries: RENDERER_LIFETIME.geometries,
      textures: RENDERER_LIFETIME.textures, programs: RENDERER_LIFETIME.programs });
  });

  test("every later disposal returns each kind of GPU object, and Three's counts, to exactly where the first left them", () => {
    const [first, ...later] = probe.cycles;
    for (const cycle of later) {
      expect(cycle.disposed.gl).toEqual(first!.disposed.gl);
      expect({ geometries: cycle.disposed.geometries, textures: cycle.disposed.textures, programs: cycle.disposed.programs })
        .toEqual({ geometries: first!.disposed.geometries, textures: first!.disposed.textures, programs: first!.disposed.programs });
      // A scene shown again costs what the first did: nothing of an earlier one is drawn beside it.
      expect(cycle.shown.gl).toEqual(first!.shown.gl);
    }
  });
});
