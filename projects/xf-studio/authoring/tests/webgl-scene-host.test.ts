import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { SceneHostProbe } from "./webgl-scene-host-probe-page";

/**
 * The scene host on a real GPU (feature-module platform step 7; tests/webgl-scene-host-probe-page.ts): the real host with eye makeup's
 * renderer and a synthetic second feature on a synthetic head. An idle viewport draws nothing, every request draws one frame, and the
 * feature renderers prepare only on drawn frames; `renderer.info.memory` returns to where it was after V switches loaded through the
 * host's detail loader, and after makeup layers are cleared. Needs a local Chrome; public CI has none and skips, and
 * XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "webgl-scene-host-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("the scene host on a real GPU", () => {
  let probe: SceneHostProbe;
  beforeAll(async () => { probe = await runProbePage<SceneHostProbe>(PAGE, "", 120_000); }, 180_000);

  test("the host starts on a synthetic head with both feature renderers, and every program compiles", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.ok).toBe(true);
    expect(probe.features).toEqual(["eye-makeup", "cheek-makeup", "faulty"]);
    // Each draws in its own band: eye makeup's 32 layer slots from 10, then the cheek plate's (PREV-91).
    expect(probe.bands).toEqual({ "eye-makeup": { first: 10, slots: 32 }, "cheek-makeup": { first: 42, slots: 2 }, faulty: { first: 44, slots: 0 } });
  });

  test("render on demand: an idle viewport draws nothing, a request or a burst draws one frame, the idle draws only while it plays", () => {
    const { frames } = probe;
    expect(frames.settled).toBe(true);
    expect(frames.idleWindow).toBe(0);
    expect(frames.oneRequest).toBe(1);
    expect(frames.burst).toBe(1);
    expect(frames.layerChange).toBe(1);
    // About 60 frames a second while the idle plays (a loose floor: the headless page may throttle).
    expect(frames.idlePlaying).toBeGreaterThan(5);
    expect(frames.idlePaused).toBe(0);
    expect(frames.idleOff).toBe(0);
    // A feature renderer prepares once per drawn frame, and only then.
    expect(frames.beforeDrawPerFrame).toBe(true);
    expect(frames.cheekFrames).toBeGreaterThan(frames.idlePlaying - 1);
  });

  test("V switches through the host's detail loader leave the GPU memory where it was (dispose leak)", () => {
    const { memory, limits, character } = probe;
    // Each V draws its eyes and a face decal, with a geometry and a texture each.
    expect(limits.a).toMatchObject({ problems: [] });
    expect(limits.b).toMatchObject({ problems: [] });
    for (const shown of [character.a, character.b]) expect([...(shown as { drawn: string[] }).drawn].sort()).toEqual(["eyes", "face", "skin"]);
    expect(memory.a.geometries).toBeGreaterThan(memory.empty.geometries);
    expect(memory.a.textures).toBeGreaterThan(memory.empty.textures);
    // Switching V releases the previous one: B costs what A did, A again costs what A did, and no V costs nothing.
    expect(memory.b).toEqual(memory.a);
    expect(memory.aAgain).toEqual(memory.a);
    expect(character.none).toEqual({ drawn: [] });
    expect(memory.none).toEqual(memory.empty);
    // Makeup layers release their textures when the stack is cleared.
    expect(memory.layers.textures).toBeGreaterThan(memory.empty.textures);
    expect(memory.layersCleared).toEqual(memory.empty);
  });

  test("the resolved skin goes on the core head and lights eye makeup's plate; no V brings the default skin back (PREV-98)", () => {
    expect(probe.skin.mode).toBe("core-head");
    expect(probe.skin.plateSkinLight).toBe(true);
    expect(probe.skin.defaultAfter).toBe("default");
  });

  test("a renderer that throws is reported once per method and the host and other features draw on (PREV-94)", () => {
    expect(probe.faulty.reports).toEqual(["faulty.beforeDraw: lost its target", "faulty.setNormals: no normals"]);
    expect(probe.faulty.evidence).toEqual({ error: "no evidence" });
    expect(probe.faulty.framesDrawn).toBeGreaterThan(10);
  });

  test("a lost and restored WebGL context: the host draws again and eye makeup's composite redraws (PREV-98)", () => {
    expect(probe.context.events).toEqual(["lost", "restored"]);
    expect(probe.context.framesAfter).toBe(1);
    expect(probe.context.compositeDrawsAfter).toBeGreaterThan(probe.context.compositeDrawsBefore);
    expect(probe.context.plateDrawn).toBe(true);
    expect([...(probe.skin.drawn as string[])].sort()).toEqual(["eyes", "face", "skin"]);
  });

  test("disposing the host removes its canvas and every feature renderer", () => {
    expect(probe.disposed).toEqual({ canvases: 0, features: 0 });
  });
});
