import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { RendererDeviceProbe } from "./webgl-renderer-device-probe-page";

/**
 * Scene runtimes on one renderer device (profiles phase 4a-ii, experiments/043-scene-runtimes §3, the 4a-ii T2 gates): builds aborted at
 * each step leave nothing behind; a runtime built and prepared while another is shown draws no frame and leaves the canvas unchanged;
 * A, then B, then A draws A byte-identically (each draw sets its own renderer state); camera input reaches only the shown runtime; and
 * disposing runtimes never touches the device. Synthetic heads, a real GPU in a local headless Chrome; public CI has none and skips, and
 * XFS_REQUIRE_ORACLES=1 turns the skip into a failure. XFS_PROBE_PRINT=1 prints the probe.
 */
const PAGE = resolve(import.meta.dir, "webgl-renderer-device-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("scene runtimes on one renderer device", () => {
  let probe: RendererDeviceProbe;
  beforeAll(async () => {
    probe = await runProbePage<RendererDeviceProbe>(PAGE, "", 240_000);
    if (process.env.XFS_PROBE_PRINT === "1") console.log(JSON.stringify(probe, null, 1));
  }, 300_000);

  test("the page ran without a shader error", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
  });

  test("a build aborted before it starts, in the core head (also one failing after the abort), in the rig's motion or among the feature renderers rejects with the abort and leaves nothing behind", () => {
    expect(probe.aborts.map(abort => abort.step)).toEqual(["before", "core", "core-failing", "motion", "features"]);
    for (const abort of probe.aborts) {
      expect({ step: abort.step, error: abort.error }).toEqual({ step: abort.step, error: "AbortError" });
      expect({ step: abort.step, gl: abort.after.gl }).toEqual({ step: abort.step, gl: probe.warm.gl });
      expect({ step: abort.step, programs: abort.after.programs }).toEqual({ step: abort.step, programs: probe.warm.programs });
    }
  });

  test("a runtime built, given a V, its parts and its makeup composite prepared while another is shown draws no frame and leaves the canvas as it was", () => {
    const { hidden } = probe;
    expect([...hidden.drawnB].sort()).toEqual(["eyes", "face", "skin"]);
    // The composite really ran on the shared renderer while B was hidden.
    expect(hidden.composite[1]).toBeGreaterThan(hidden.composite[0]);
    expect(hidden.framesB).toBe(0);
    expect(hidden.framesA[1]).toBe(hidden.framesA[0]);
    expect(hidden.canvasAfter).toBe(hidden.canvasBefore);
  });

  test("A, then B, then A: A's pixels are byte-identical, and only the shown runtime draws", () => {
    const { aba } = probe;
    expect(aba.bytes).toBeGreaterThan(0);
    // B really draws something else (another V under another exposure), so the comparison can fail.
    expect(aba.b).not.toBe(aba.a);
    expect(aba.identical).toBe(true);
    expect(aba.aAgain).toBe(aba.a);
    expect(aba.framesBWhileHidden).toBe(0);
    expect(aba.framesAWhileB).toBe(0);
  });

  test("camera input reaches only the shown runtime's camera", () => {
    expect(probe.input).toEqual({ shownA: { a: true, b: false }, shownB: { a: false, b: true } });
  });

  test("a context lost and restored while a runtime is built reaches it: shown, it draws as one built on an undisturbed context", () => {
    const { restoredWhileBuilding: restored } = probe;
    expect(restored.events).toEqual(["lost", "restored"]);
    expect(restored.identical).toBe(true);
    expect(restored.built).toBe(restored.reference);
  });

  test("disposing runtimes never touches the device: its canvas stays (hidden), the context lives, it draws the next runtime", () => {
    expect(probe.disposed).toMatchObject({ canvases: 1, hidden: true, lost: false, drawsAgain: true });
    // Two runtimes resident at once, then both disposed: the GPU objects are back where the first disposal left them.
    expect(probe.disposed.counts.gl).toEqual(probe.warm.gl);
    expect(probe.disposed.counts.programs).toEqual(probe.warm.programs);
  });
});
