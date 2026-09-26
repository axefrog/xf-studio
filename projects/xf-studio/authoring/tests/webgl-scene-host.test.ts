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
    expect(probe.features).toEqual(["eye-makeup", "cheek-makeup"]);
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
    for (const shown of [character.a, character.b]) expect([...(shown as { drawn: string[] }).drawn].sort()).toEqual(["eyes", "face"]);
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

  test("disposing the host removes its canvas and every feature renderer", () => {
    expect(probe.disposed).toEqual({ canvases: 0, features: 0 });
  });
});
