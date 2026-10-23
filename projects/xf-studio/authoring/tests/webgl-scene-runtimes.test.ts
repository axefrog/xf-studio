import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { SceneRuntimesProbe } from "./webgl-scene-runtimes-probe-page";

/**
 * The S2 gate table in its final form (profiles phase 4a-vi, experiments/043-scene-runtimes §13; spike S2's rows, experiment 039), the T2
 * tier: synthetic heads, a real GPU in a fresh headless Chrome (a cold program cache), one renderer device, `SceneResidency` with the
 * production ports' shape. Each row is read from the one probe page that covers it (tests/webgl-scene-runtimes-probe-page.ts):
 *
 * | Row | Gate |
 * |---|---|
 * | Warm switch | want to first presented frame ≤ 100 ms |
 * | Cancel | a superseded preparation, and a superseded body switch's build, stop ≤ 100 ms after the superseding want |
 * | No stray frames | nothing built, prepared or superseded draws a frame before it is shown; the shown V's pixels don't change meanwhile |
 * | No late result | a build that comes back after it was superseded is disposed, never shown |
 * | Last choice | female, male, then female 150 ms later shows female; the male build stops and is never built |
 * | No first-draw stall | the first shown frame links and makes no program (a cold V, a warm switch, a warm V whose authored makeup changed while it was warm, a V shown again with its on-head editor under a setup prepared while it was shown); no presentation gap over 100 ms while preparing; no task of 50 ms or more (with KHR_parallel_shader_compile) |
 * | Warm residency | a hidden runtime holds none of its frame-sized targets (display, skin scatter, contact shadows), and switching back and forth leaves the live GL objects flat |
 * | Memory returned | closing a subject (`close(scene)`) and closing everything leave the GPU objects and Three's programs at the baseline |
 * | One output | every program the page's runtimes build writes one output into one colour attachment, as the driver is asked |
 * | Look switch (P2-iii) | between warm runtimes showing different looks: ≤ 100 ms to the first presented frame, no raster, no composite draw, no link; eviction releases the kept makeup |
 *
 * The page's other steps are 4a-v's and its reviews' (preparation, the lighting change on the shown V, context loss in the middle of GPU
 * work): a cold V prepared while another is shown keeps the page's thread free and draws nothing until it is shown; a lighting setup never
 * drawn, asked of the shown V, is prepared while the setup before stays drawn and takes over with nothing left to link; every warm-up is
 * drawn in pieces; a context lost part-way recovers. The same page runs again without the extension (the fallback), which must stay chunked
 * and still report progress; its page tasks are recorded, not gated. Public CI has no GPU and skips; XFS_REQUIRE_ORACLES=1 turns the skip
 * into a failure. XFS_PROBE_PRINT=1 prints the gate table and both probes. The table's real-data half is G3 (`measure.ts` in experiment 043).
 */
const PAGE = resolve(import.meta.dir, "webgl-scene-runtimes-probe-page.ts");
const ORDER = ["core", "build", "details", "programs", "textures", "warm-up"];

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("scene runtimes: the S2 gate table, and preparing before showing", () => {
  let parallel: SceneRuntimesProbe, fallback: SceneRuntimesProbe;
  beforeAll(async () => {
    parallel = await runProbePage<SceneRuntimesProbe>(PAGE, "", 420_000);
    fallback = await runProbePage<SceneRuntimesProbe>(PAGE, "?parallel=off", 420_000);
    if (process.env.XFS_PROBE_PRINT === "1") console.log(JSON.stringify({ table: gateTable(parallel), parallel, fallback }, null, 1));
  }, 900_000);

  test("the S2 gate table: every row passes (the rows' detail is in the tests below)", () => {
    const table = gateTable(parallel);
    expect(Object.fromEntries(Object.entries(table).map(([row, value]) => [row, value.pass]))).toEqual(Object.fromEntries(Object.keys(table).map(row => [row, true])));
  });

  test("S2 gate, last choice: female, male, then female 150 ms later shows female; the male build stops within 100 ms and is never built or shown", () => {
    for (const probe of [parallel, fallback]) {
      const { supersede } = probe;
      expect({ superseded: supersede.superseded, back: supersede.back, shown: supersede.shown })
        .toEqual({ superseded: "AbortError", back: "shown", shown: "s1|v1|female|studio" });
      expect(supersede.cancelMs).toBeGreaterThanOrEqual(0);
      expect(supersede.cancelMs).toBeLessThanOrEqual(100);
      expect(supersede.canvasUnchanged).toBe(true);
    }
  });

  test("S2 gate, no late result: a build that comes back after it was superseded is disposed, having drawn nothing, and never shown", () => {
    for (const probe of [parallel, fallback]) {
      const { supersede } = probe;
      expect(supersede.late).toEqual({ outcome: "AbortError", built: true, disposed: true, frames: 0 });
      // Only what was wanted last at each step was ever shown: neither the superseded male V nor the late one.
      expect(supersede.shownKeys).toEqual(["s1|v1|female|studio", "s1|v1|male|studio", "s1|v2|female|studio"]);
      expect(supersede.built.filter(key => key === "s1|v1|male|studio")).toHaveLength(1);
    }
  });

  test("residency: the least recently shown runtime is evicted past the budget (4a-iv, moved from the renderer device probe)", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.supersede.warm).toEqual(["s1|v1|female|studio:warm", "s1|v1|male|studio:shown"]);
      expect(probe.supersede.evicted).toEqual(["s1|v1|female|studio"]);
      expect(probe.supersede.residents).toEqual(["s1|v1|male|studio:warm", "s1|v2|female|studio:shown"]);
    }
  });

  test("S2 gate, memory returned: a subject in a scene of its own, opened and closed, leaves the GPU objects and Three's programs where they were", () => {
    for (const probe of [parallel, fallback]) {
      const close = probe.closeSubject;
      expect(close.opened.gl.texture).toBeGreaterThan(close.before.gl.texture);
      expect(close.after.gl).toEqual(close.before.gl);
      expect(close.after.programs).toEqual(close.before.programs);
      expect(close.shownAfter).toBe(false);
    }
  });

  test("the morph-target texture is made ahead in steps under 50 ms each, the first on a renderer too, byte for byte Three's, and the draw that follows builds none (4a-vi)", () => {
    for (const probe of [parallel, fallback]) {
      const { morph } = probe;
      expect(morph.patched).toBe(true);
      expect(morph.handed).toBe(true);
      expect(morph.identical).toBe(true);
      expect(morph.steps).toBeGreaterThan(2);
      expect(morph.stepMaxMs).toBeLessThan(50);
      // The draw that follows builds nothing: far cheaper than Three's own build at the draw.
      expect(morph.drawMs).toBeLessThan(morph.threeDrawMs);
    }
    expect(parallel.morph.tasksOver50).toBe(0);
  });

  test("S2 gate, one output: every fragment shader the page's runtimes gave the driver writes one output, into one colour attachment", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.singleOutput.fragments).toBeGreaterThan(20);
      expect(probe.singleOutput.attachments).toBeGreaterThan(10);
      expect(probe.singleOutput.issues).toEqual([]);
    }
  });

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

  test("nothing of it is drawn before it is shown: the shown V's pixels stay as they were, and it was warmed up hidden, in pieces", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.cold.framesBeforeShown).toBe(0);
      expect(probe.cold.warmUps).toBeGreaterThanOrEqual(2);
      expect(probe.cold.canvasUnchanged).toBe(true);
    }
  });

  test("a warm-up is drawn in pieces with frames presented between them, so the shown V and the progress line keep drawing (4a-v-b)", () => {
    for (const probe of [parallel, fallback]) for (const warmUp of [{ pieces: probe.cold.warmUps, frames: probe.cold.warmUpFrames },
      { pieces: probe.setup.warmUps, frames: probe.setup.warmUpFrames }]) {
      expect(warmUp.pieces).toBeGreaterThanOrEqual(2);
      // At least one presented frame after each piece but the last (each piece waits for the GPU a frame at a time).
      expect(warmUp.frames).toBeGreaterThanOrEqual(warmUp.pieces - 1);
    }
  });

  test("no presentation gap over 100 ms while a cold V or a setup never drawn is prepared: no program builds a shader at its first draw (4a-v-c)", () => {
    // ANGLE builds a program that writes several outputs, or reads integers into a float input, again at its first draw, on the GPU
    // process's main thread, presenting nothing meanwhile (13.9 s and 4.0 s here before 4a-v-c, experiment 043 §12). With
    // KHR_parallel_shader_compile the page's own tasks stay under 50 ms too, so a frame is presented at least every 100 ms.
    expect({ cold: parallel.cold.frameGapMs <= 100, setup: parallel.setup.frameGapMs <= 100 }).toEqual({ cold: true, setup: true });
    // The fallback's page tasks are long (recorded, not gated), but no warm-up piece holds the GPU process for long either.
    for (const probe of [parallel, fallback]) expect({ cold: probe.cold.warmUpFrameGapMs <= 100, setup: probe.setup.warmUpFrameGapMs <= 100 })
      .toEqual({ cold: true, setup: true });
  });

  test("a lighting setup never drawn, asked of the shown V: staged, prepared while the setup before stays drawn, then taken over with nothing to link (4a-v-b)", () => {
    for (const probe of [parallel, fallback]) {
      const { setup } = probe;
      expect(setup.staged).toBe(true);
      expect(setup.tookOverMs).toBeGreaterThan(0);
      // The setup before, pixel for pixel, until the new one takes over; then the new one.
      expect(setup.checks).toBeGreaterThan(0);
      expect(setup.unchangedUntilTakeover).toBe(true);
      expect(setup.changedAfter).toBe(true);
      expect({ links: setup.firstFrame.links, programs: setup.firstFrame.programs }).toEqual({ links: 0, programs: 0 });
      expect(setup.firstFrame.frames).toBeGreaterThanOrEqual(1);
      expect(setup.prepared).toBe(true);
      // Its progress says it is a change of the V shown, and moves forward only.
      expect(setup.progress.length).toBeGreaterThan(0);
      expect(setup.progress.every(state => state.change === "shown")).toBe(true);
      for (let i = 1; i < setup.progress.length; i++) {
        expect(setup.progress[i]!.fraction).toBeGreaterThanOrEqual(setup.progress[i - 1]!.fraction);
        expect(ORDER.indexOf(setup.progress[i]!.stage)).toBeGreaterThanOrEqual(ORDER.indexOf(setup.progress[i - 1]!.stage));
      }
      // A newer setup asked while one is prepared replaces it: only the newest is ever drawn.
      expect(setup.replaced).toEqual({ adopted: ["y"], final: "y" });
      // The setup drawn asked again stops the preparation at once and changes nothing.
      expect(setup.back).toMatchObject({ staged: false, source: "drawn", preparing: false });
      expect(setup.back.stoppedMs).toBeLessThanOrEqual(100);
    }
    // With KHR_parallel_shader_compile the page's thread stays free throughout.
    expect(parallel.setup.tasksOver50).toBe(0);
    expect(parallel.setup.longestTaskMs).toBeLessThan(50);
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

  test("S2 gate, warm switch: a switch to a warm, prepared V draws its first frame within 100 ms, with no build and no preparation", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.warm.switchesMs.length).toBe(8);
      expect(Math.max(...probe.warm.switchesMs)).toBeLessThanOrEqual(100);
      expect({ builds: probe.warm.builds, preparations: probe.warm.preparations }).toEqual({ builds: 0, preparations: 0 });
      // Its frame-sized targets, let go when it was hidden, come back at the show without a link, and its first frame uploads only what a
      // later frame does (its bones): the allocation happens as it is shown, not in the frame.
      expect(probe.warm.links).toEqual(Array(8).fill(0));
      expect(probe.warm.programs).toEqual(Array(8).fill(0));
      expect(probe.warm.firstUploads).toEqual(probe.warm.laterUploads);
    }
  });

  test("warm residency: a hidden runtime holds none of its frame-sized targets, the shown one holds its own, and switching leaves the GL objects flat", () => {
    for (const probe of [parallel, fallback]) {
      for (const { shown, hidden } of probe.warm.targets) {
        expect(hidden).toEqual([0, 0, 0]);
        expect(shown[0]).toBeGreaterThan(0);
      }
      // Each body shown again holds exactly what it held the time before: nothing grows from switch to switch.
      for (let i = 2; i < probe.warm.gl.length; i++) expect(probe.warm.gl[i]).toEqual(probe.warm.gl[i - 2]!);
    }
  });

  test("a warm V whose authored makeup changed while it was warm is prepared again before it is shown, and its first shown frame links nothing (final review)", () => {
    for (const probe of [parallel, fallback]) {
      const stale = probe.staleMakeup;
      expect({ before: stale.preparedBefore, after: stale.preparedAfterChange }).toEqual({ before: true, after: false });
      expect(stale.preparations).toBe(1);
      expect(stale.clearcoat).toBe(1);
      expect(stale.firstFrame).toEqual({ links: 0, programs: 0 });
      expect(stale.made).toEqual([]);
      // Back the other way: the V shown when the layer changed holds it, so it is prepared again in turn.
      expect(stale.back).toEqual({ preparations: 1, firstFrame: { links: 0, programs: 0 } });
    }
  });

  test("a V shown again with its on-head editor, under a setup prepared while it was shown, links nothing: the guides draw with the head's own materials (G3)", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.editorRemount.editors).toBe(1);
      expect(probe.editorRemount.firstFrame).toEqual({ links: 0, programs: 0 });
      expect(probe.editorRemount.window).toEqual({ links: 0, programs: 0 });
      expect(probe.editorRemount.made).toEqual([]);
    }
  });

  test("S2 gate, cancel: a preparation superseded while it compiles stops within 100 ms, draws nothing and leaves the GPU objects where they were", () => {
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

  test("a context lost while a cold V's programs link: the preparation starts again after the restore, and the V is shown and draws (4a-v review 2)", () => {
    for (const probe of [parallel, fallback]) {
      const loss = probe.contextLoss;
      expect(loss.stage).toBe("programs");
      expect(loss.events).toEqual(["lost", "restored"]);
      expect(loss.restarts).toBeGreaterThanOrEqual(1);
      expect(loss.outcome).toBe("shown");
      expect(loss.frames).toBeGreaterThan(0);
    }
  });

  test("P2-iii: a look switch between warm runtimes takes ≤ 100 ms with no makeup redraw (no raster, no composite draw) and no link; eviction releases the kept makeup", () => {
    for (const probe of [parallel, fallback]) {
      const { cold, switches, evicted, evictedLookKept, before, after } = probe.lookSwitch;
      // The cold look was rastered afresh (nothing held it); every warm switch took its look back from the warm runtime's hold.
      expect(cold.adopted).toBe(false);
      expect(switches).toHaveLength(8);
      for (const item of switches) {
        expect(item.adopted).toBe(true);
        expect(item.ms).toBeLessThanOrEqual(100);
        expect([item.links, item.programs, item.rasters, item.compositeDraws]).toEqual([0, 0, 0, 0]);
        expect(item.firstFrame).toEqual({ links: 0, programs: 0 });
      }
      // The least recently shown runtime went with its look's makeup; once everything closed the GPU objects and programs are as before.
      expect([evicted, evictedLookKept]).toEqual(["s3|v1|female|studio", false]);
      expect(after.gl).toEqual(before.gl);
      expect(after.programs).toEqual(before.programs);
    }
  });

  test("closing everything returns the GPU objects and Three's programs to the baseline (4a-i's gate holds with preparation); no fence outlives its preparation", () => {
    for (const probe of [parallel, fallback]) {
      expect(probe.closed.gl).toEqual(probe.baseline.gl);
      expect(probe.closed.programs).toEqual(probe.baseline.programs);
      expect([probe.baseline.gl.sync, probe.closed.gl.sync]).toEqual([0, 0]);
    }
  });

  test("a banded upload lost part-way starts again after the restore, from its bitmap: every texel is the bitmap's, no GL error (4a-v-b review 3)", () => {
    for (const probe of [parallel, fallback]) {
      const { bands } = probe.recovery;
      expect(bands.before).toBe(3);
      // Its storage and four bands of 512 rows again after the restore, done only after the last.
      expect(bands.after).toBe(5);
      expect(bands.texels).toEqual([bands.expected, bands.expected, bands.expected]);
      expect(bands.error).toBe(0);
      expect(bands.closed).toBe(true);
    }
  });

  test("a V's details lost while they wait for a link slot stop with the context's generation, before the restore, and the V is shown after it (4a-v-b review 2)", () => {
    expect(parallel.recovery.admission).toMatchObject({ trigger: "admission", viaAdmit: true });
    expect(fallback.recovery.admission.trigger).toBe("compile");
    for (const probe of [parallel, fallback]) {
      const { admission } = probe.recovery;
      expect(admission.stopMs).toBeGreaterThanOrEqual(0);
      expect(admission.stopMs).toBeLessThanOrEqual(100);
      expect(admission.restoredAfterStop).toBe(true);
      expect(admission.outcome).toBe("shown");
      expect(admission.frames).toBeGreaterThan(0);
    }
  });

  test("a lighting change lost while prepared on the shown V takes over after the restore with nothing to link; a setup prepared before the loss is prepared again, never drawn at once (4a-v-b review 5)", () => {
    for (const probe of [parallel, fallback]) {
      const { staged } = probe.recovery;
      expect(staged.stage).toBe("programs");
      expect(staged.restarts).toBeGreaterThanOrEqual(1);
      expect(staged.tookOver).toBe(true);
      expect(staged.prepared).toBe(true);
      expect(staged.firstFrame).toEqual({ links: 0, programs: 0 });
      expect(staged.before).toEqual({ staged: true, tookOver: true, firstFrame: { links: 0, programs: 0 } });
      // A setup prepared in this generation, asked in the task the context is lost in (its event still queued): staged, not drawn at once.
      expect(staged.queued).toEqual({ staged: true, tookOver: true, firstFrame: { links: 0, programs: 0 } });
    }
  });
});

/** The S2 gate table's rows from the probe with KHR_parallel_shader_compile (the browsers the Studio runs in): each row's figures and verdict. */
function gateTable(probe: SceneRuntimesProbe) {
  const { cold, warm, cancel, supersede, setup, closeSubject, staleMakeup, editorRemount } = probe;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const warmMax = Math.max(...warm.switchesMs);
  return {
    "warm switch": { value: `${Math.round(warmMax * 10) / 10} ms (worst of ${warm.switchesMs.length})`, pass: warmMax <= 100 && warm.builds === 0 },
    cancel: { value: `${Math.round(cancel.cancelMs * 10) / 10} ms (preparation), ${Math.round(supersede.cancelMs * 10) / 10} ms (body switch)`,
      pass: cancel.cancelMs >= 0 && cancel.cancelMs <= 100 && supersede.cancelMs >= 0 && supersede.cancelMs <= 100 },
    "no stray frames": { value: `cold ${cold.framesBeforeShown}, cancelled ${cancel.drawn}, late ${supersede.late.frames}`,
      pass: cold.framesBeforeShown === 0 && cold.canvasUnchanged && cancel.drawn === 0 && cancel.canvasUnchanged && supersede.late.frames === 0 && supersede.canvasUnchanged },
    "no late result": { value: supersede.late.outcome, pass: supersede.late.disposed && !supersede.shownKeys.includes("s1|v9|male|studio") },
    "last choice": { value: supersede.shown, pass: supersede.superseded === "AbortError" && supersede.shown === "s1|v1|female|studio" },
    "no first-draw stall": { value: `links ${cold.firstFrame.links} (cold), ${Math.max(...warm.links)} (warm), ${staleMakeup.firstFrame.links} (makeup changed while warm), `
      + `${editorRemount.firstFrame.links} (editor shown again); gaps ${Math.round(cold.frameGapMs)} / ${Math.round(setup.frameGapMs)} ms, tasks ${cold.tasksOver50 + setup.tasksOver50}`,
      pass: cold.firstFrame.links === 0 && cold.firstFrame.programs === 0 && setup.firstFrame.links === 0 && cold.frameGapMs <= 100 && setup.frameGapMs <= 100
        && cold.tasksOver50 === 0 && setup.tasksOver50 === 0 && warm.links.every(links => links === 0) && same(staleMakeup.firstFrame, { links: 0, programs: 0 })
        && !staleMakeup.preparedAfterChange && same(editorRemount.firstFrame, { links: 0, programs: 0 }) },
    "warm residency": { value: `hidden targets ${warm.targets.map(entry => entry.hidden.reduce((sum, n) => sum + n, 0)).join("/")} px`,
      pass: warm.targets.every(entry => same(entry.hidden, [0, 0, 0])) && warm.gl.every((counts, i) => i < 2 || same(counts, warm.gl[i - 2])) },
    "memory returned": { value: `${closeSubject.after.programs.length} programs after closing a subject`,
      pass: same(closeSubject.after, closeSubject.before) && same(probe.closed.gl, probe.baseline.gl) && same(probe.closed.programs, probe.baseline.programs) },
    "look switch (P2-iii)": { value: `${Math.round(Math.max(...probe.lookSwitch.switches.map(item => item.ms)) * 10) / 10} ms (worst of ${probe.lookSwitch.switches.length}); `
      + `${probe.lookSwitch.switches.reduce((sum, item) => sum + item.rasters + item.compositeDraws + item.links, 0)} rasters, composite draws and links`,
      pass: probe.lookSwitch.switches.every(item => item.adopted && item.ms <= 100 && item.rasters === 0 && item.compositeDraws === 0 && item.links === 0 && item.programs === 0)
        && same(probe.lookSwitch.after.gl, probe.lookSwitch.before.gl) },
    "one output": { value: `${probe.singleOutput.fragments} fragment shaders, ${probe.singleOutput.attachments} attachments`, pass: probe.singleOutput.issues.length === 0 },
  };
}
