import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { ScenePreparationProbe } from "./webgl-scene-preparation-probe-page";

/**
 * Scene runtimes prepared before they are shown (profiles phase 4a-v, experiments/043-scene-runtimes §11, the 4a-v T2 gates), on synthetic
 * heads in a fresh headless Chrome (a cold program cache): a cold V prepared while another is shown keeps the page's thread free (no task
 * over 50 ms with KHR_parallel_shader_compile), draws nothing and leaves the shown V's pixels as they were until it is shown, and its first
 * shown frame links and uploads nothing; a warm switch draws its first frame within 100 ms; a superseded preparation stops within 100 ms
 * and leaves nothing behind; progress only moves forward; closing everything returns the GPU objects to the baseline. The same page runs
 * again without the extension (the fallback), which must stay chunked and still report progress; its numbers are recorded, not gated.
 * Public CI has no GPU and skips; XFS_REQUIRE_ORACLES=1 turns the skip into a failure. XFS_PROBE_PRINT=1 prints both probes.
 */
const PAGE = resolve(import.meta.dir, "webgl-scene-preparation-probe-page.ts");
const ORDER = ["core", "build", "details", "programs", "textures", "warm-up"];

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("scene runtimes prepared before they are shown", () => {
  let parallel: ScenePreparationProbe, fallback: ScenePreparationProbe;
  beforeAll(async () => {
    parallel = await runProbePage<ScenePreparationProbe>(PAGE, "", 240_000);
    fallback = await runProbePage<ScenePreparationProbe>(PAGE, "?parallel=off", 240_000);
    if (process.env.XFS_PROBE_PRINT === "1") console.log(JSON.stringify({ parallel, fallback }, null, 1));
  }, 540_000);

  test("both pages ran without a shader error, one with KHR_parallel_shader_compile and one without", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.failure).toBeUndefined();
      expect(probe.errors).toEqual([]);
    }
    expect([parallel.parallel, fallback.parallel]).toEqual([true, false]);
  });

  test("a cold V prepared while another is shown: no main-thread task over 50 ms from the want to 1 s after it is shown", () => {
    expect(parallel.cold.result?.parallel).toBe(true);
    expect(parallel.cold.result!.programs).toBeGreaterThan(0);
    expect(parallel.cold.tasksOver50).toBe(0);
    expect(parallel.cold.longestTaskMs).toBeLessThan(50);
  });

  test("nothing of it is drawn before it is shown: the shown V's pixels stay as they were, and it was warmed up hidden once", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.cold.framesBeforeShown).toBe(0);
      expect(probe.cold.warmUps).toBe(1);
      expect(probe.cold.canvasUnchanged).toBe(true);
    }
  });

  test("its first shown frame links no program and uploads no map: only what every frame sends (its bones), as a later frame does", () => {
    for (const probe of [parallel, fallback]) {
      expect({ links: probe.cold.firstFrame.links, programs: probe.cold.firstFrame.programs }).toEqual({ links: 0, programs: 0 });
      expect(probe.steadyUploads).toBeGreaterThanOrEqual(0);
      expect(probe.cold.firstFrame.uploads).toBe(probe.steadyUploads);
      // No warm-up linked a program either, the very first on the renderer included: everything it drew was compiled ahead.
      expect(probe.warmUpPrograms).toEqual([]);
      expect(probe.timings.warmUpLinks.length).toBeGreaterThanOrEqual(3);
      expect(probe.timings.warmUpLinks.every(links => links === 0)).toBe(true);
    }
  });

  test("a switch to a warm, prepared V draws its first frame within 100 ms, with no build and no preparation", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.warm.switchesMs.length).toBe(8);
      expect(Math.max(...probe.warm.switchesMs)).toBeLessThanOrEqual(100);
      expect({ builds: probe.warm.builds, preparations: probe.warm.preparations }).toEqual({ builds: 0, preparations: 0 });
    }
  });

  test("a preparation superseded while it compiles stops within 100 ms, draws nothing and leaves the GPU objects where they were", () => {
    for (const probe of [parallel, fallback]) {
      const { cancel } = probe;
      expect(cancel.superseded).toBe("AbortError");
      expect(cancel.stage).toBe("programs");
      expect(cancel.cancelMs).toBeGreaterThanOrEqual(0);
      expect(cancel.cancelMs).toBeLessThanOrEqual(100);
      expect(cancel.drawn).toBe(0);
      expect(cancel.canvasUnchanged).toBe(true);
      expect(cancel.disposed).toBe(true);
      expect(cancel.after.gl).toEqual(cancel.before.gl);
      expect(cancel.after.programs).toEqual(cancel.before.programs);
    }
  });

  test("progress moves forward only: stages in order, fractions never decreasing, ending in the warm-up; the fallback still reports steps", () => {
    for (const probe of [parallel, fallback]) for (const [key, states] of Object.entries(probe.progress)) {
      for (let i = 1; i < states.length; i++) {
        expect({ key, at: i, fraction: states[i]!.fraction >= states[i - 1]!.fraction }).toEqual({ key, at: i, fraction: true });
        expect({ key, at: i, stage: ORDER.indexOf(states[i]!.stage) >= ORDER.indexOf(states[i - 1]!.stage) }).toEqual({ key, at: i, stage: true });
      }
    }
    for (const probe of [parallel, fallback]) {
      const cold = Object.entries(probe.progress).find(([key]) => key.includes("|male|"))![1];
      expect(cold.at(-1)!.stage).toBe("warm-up");
      // Chunked: the programs stage reported more than one step on its way.
      expect(new Set(cold.filter(state => state.stage === "programs").map(state => state.fraction)).size).toBeGreaterThan(1);
    }
  });

  test("closing everything returns the GPU objects and Three's programs to the baseline (4a-i's gate holds with preparation)", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.closed.gl).toEqual(probe.baseline.gl);
      expect(probe.closed.programs).toEqual(probe.baseline.programs);
    }
  });
});
