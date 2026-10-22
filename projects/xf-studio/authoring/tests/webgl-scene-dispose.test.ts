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
 * lookup texture (any physically based material) and the background plane it draws a textured scene background with (its geometry's
 * three buffers, vertex array and `BackgroundMaterial` program); and the layered-makeup engine's shared 1×1 blank textures (`NOTHING`,
 * `NEUTRAL_MAP` in plate-composite.ts; `FLAT_NORMAL` is not drawn here). Three counts the textures and the plane's geometry. Nothing a
 * scene made for its own materials belongs here (a full-skin shadow depth program once did, through a material nothing disposed).
 */
const RENDERER_LIFETIME = { gl: { texture: 3, buffer: 3, program: 1, vertexArray: 1 }, geometries: 1, textures: 3, programs: 1,
  uses: [{ name: "BackgroundMaterial", usedTimes: 1 }] };
const PAGE = resolve(import.meta.dir, "webgl-scene-dispose-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("scene host disposal on a shared renderer", () => {
  let probe: SceneDisposeProbe;
  beforeAll(async () => {
    // XFS_PROBE_STACKS=1 keeps the stack that made each GPU object, to trace a leak (with XFS_PROBE_PRINT=1 to see it).
    probe = await runProbePage<SceneDisposeProbe>(PAGE, process.env.XFS_PROBE_STACKS === "1" ? "?stacks" : "", 240_000);
    if (process.env.XFS_PROBE_PRINT === "1") console.log(JSON.stringify(probe, null, 1));
  }, 300_000);

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

  test("the cycles really differ: odd cycles' head has its own skin and full-skin shadow depth programs", () => {
    const depth = (cycle: SceneDisposeProbe["cycles"][number]) => cycle.shown.uses.filter(use => use.fullSkinDepth).map(use => use.key);
    const [even, odd] = probe.cycles;
    expect(even!.influenceSets).toBe(1); expect(odd!.influenceSets).toBe(2);
    expect(depth(even!).length).toBeGreaterThan(0);
    expect(depth(odd!).length).toBeGreaterThan(0);
    expect(depth(odd!).some(key => !depth(even!).includes(key))).toBe(true);
  });

  test("the first disposal leaves only what lives as long as the renderer", () => {
    const [first] = probe.cycles, { baseline } = probe;
    const left = Object.fromEntries(Object.entries(first!.disposed.gl).map(([kind, count]) => [kind, count - baseline.gl[kind as keyof typeof baseline.gl]])
      .filter(([, count]) => count !== 0));
    expect(left).toEqual(RENDERER_LIFETIME.gl);
    expect({ geometries: first!.disposed.geometries - baseline.geometries, textures: first!.disposed.textures - baseline.textures,
      programs: first!.disposed.programs - baseline.programs }).toEqual({ geometries: RENDERER_LIFETIME.geometries,
      textures: RENDERER_LIFETIME.textures, programs: RENDERER_LIFETIME.programs });
    // No program a scene made for its own materials stays, whatever its use count: only the renderer's own.
    expect(first!.disposed.uses.map(({ name, usedTimes }) => ({ name, usedTimes }))).toEqual(RENDERER_LIFETIME.uses);
  });

  test("every later disposal leaves exactly what the first did: the same objects, the same programs, each used as often", () => {
    const [first, ...later] = probe.cycles;
    for (const cycle of later) {
      expect(cycle.disposed.gl).toEqual(first!.disposed.gl);
      expect({ geometries: cycle.disposed.geometries, textures: cycle.disposed.textures, programs: cycle.disposed.programs })
        .toEqual({ geometries: first!.disposed.geometries, textures: first!.disposed.textures, programs: first!.disposed.programs });
      // A material that outlived its scene keeps its program's use count up even where no new program was made.
      expect(cycle.disposed.uses).toEqual(first!.disposed.uses);
    }
    // A scene shown again costs what the same scene did before: nothing of an earlier one is drawn or held beside it. Programs compare by
    // name and use count (a pass's own shader material gets a new cache key each time Three's shader cache sees its source afresh), and the
    // full-skin depth programs by key too (theirs is stable per variant).
    const profile = (cycle: SceneDisposeProbe["cycles"][number]) =>
      cycle.shown.uses.map(use => `${use.name}:${use.usedTimes}${use.fullSkinDepth ? `:${use.key}` : ""}`).sort();
    for (let i = 2; i < probe.cycles.length; i++) {
      expect(probe.cycles[i]!.shown.gl).toEqual(probe.cycles[i - 2]!.shown.gl);
      expect(profile(probe.cycles[i]!)).toEqual(profile(probe.cycles[i - 2]!));
    }
  });
});
