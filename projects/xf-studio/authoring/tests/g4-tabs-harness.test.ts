import { describe, expect, test } from "bun:test";
import { analyse, type Run, type Row } from "../../../../experiments/044-profile-tabs/measure-tabs";
import { TAB_PROBE } from "../../../../experiments/044-profile-tabs/measure-tabs-probe";
import { GL_PROBE } from "../tools/gl-probe";

/** These synthetic records test the gates, never pretend to be browser measurements. */
function run(): Run {
  const before: Run["before"] = { at: 0, tab: "a", drawn: "va", onCanvas: "va", phase: "ready", frames: 2,
    detailComponents: 3, key: "sa|ca|female", scene: "sa", preparation: null, residents: [{ scene: "sa", key: "sa|ca|female", state: "shown" },
      { scene: "sb", key: "sb|ca|female", state: "warm" }], progress: "", canvasVisible: true, hash: 10 };
  return { t0: 1, before, ticks: [before, { ...before, at: 17 }, { ...before, at: 33, tab: "b", drawn: "vb", onCanvas: "vb", scene: "sb", frames: 3 },
    { ...before, at: 50, tab: "b", drawn: "vb", onCanvas: "vb", scene: "sb", frames: 4 },
    { ...before, at: 1050, tab: "b", drawn: "vb", onCanvas: "vb", scene: "sb", frames: 4 }],
    target: { tab: "b", view: "vb", scene: "sb" }, sent: [{ tab: "b", at: 1 }], errors: [], shown: 33, presented: 50,
    links: [], creates: [], long: [], rasters: [], draws: [{ at: 30, view: "vb" }] };
}
describe("G4 fail-closed gate analysis (no GPU)", () => {
  test("the combined pre-navigation probes parse as browser JavaScript", () => {
    expect(() => new Function(GL_PROBE + TAB_PROBE)).not.toThrow();
  });
  test("warm first-frame window includes takeover but excludes earlier preparation", () => {
    const r = run(); r.links.push({ linkAt: 5, name: "prepared" }); r.creates.push(5);
    expect(analyse("T-b", r)).toMatchObject({ pass: true, firstFrameLinks: 0, firstFramePrograms: 0, clickToFirstPresentedMs: 49 });
    r.links.push({ linkAt: 30, name: "late" }); r.creates.push(30);
    expect(analyse("T-b", r)).toMatchObject({ pass: false, firstFrameLinks: 1, firstFramePrograms: 1 });
  });
  test("missing presentation fails every gate, including shell smoke", () => {
    const r = run(); r.shown = null; r.presented = null;
    for (const row of ["T-a", "T-b", "T-c", "T-d", "T-e", "T-f", "T-g", "T-h"] as Row[]) expect(analyse(row, r).pass).toBe(false);
    expect(analyse("T-g", r, true).pass).toBe(false);
  });
  test("warm residency, bodies and raster requests are preconditions", () => {
    const r = run(); r.before.residents = [];
    expect(analyse("T-b", r).failures).toContain("Destination was not warm before the click");
    expect(analyse("T-c", run()).failures).toContain("Different-body setup not established");
    const d = run(); d.rasters.push({ at: 2 });
    expect(analyse("T-d", d).failures).toContain("Warm look requested a raster");
  });
  test("T-g includes a 50 ms task overlapping the click and excludes tasks starting after one second", () => {
    const r = run(); r.long.push([1020, 60]);
    expect(analyse("T-g", r).pass).toBe(true);
    r.long.push([-10, 50]); expect(analyse("T-g", r)).toMatchObject({ pass: false, longTasks50: 1 });
  });
  test("cold progress cannot pass on absent samples or a blank pane", () => {
    const r = run(); r.before.residents = [];
    r.shown = 300; r.presented = 316; r.ticks[2]!.at = 300; r.ticks[3]!.at = 316;
    r.ticks[1] = { ...r.ticks[1]!, at: 151, progress: "Preparing V", preparation: { stage: "programs" } };
    expect(analyse("T-e", r).progressWithinMs).toBe(150);
    r.ticks[1]!.canvasVisible = false; r.ticks[1]!.progress = "";
    expect(analyse("T-e", r).failures).toContain("Blank pane before takeover");
    r.ticks[1]!.progress = "Preparing V"; r.ticks[1]!.at = 152;
    expect(analyse("T-e", r).failures).toContain("No preparation progress within 150 ms");
  });
  test("rapid switch detects a superseded draw even if frame samples never saw it", () => {
    const r = run(); r.target = { tab: "a", view: "va", scene: "sa" };
    r.ticks = r.ticks.map(t => ({ ...t, tab: "a", onCanvas: "va", key: r.before.key }));
    r.sent = [{ tab: "a", at: 1 }, { tab: "b", at: 91 }, { tab: "c", at: 181 }, { tab: "a", at: 271 }];
    r.draws = []; expect(analyse("T-f", r).pass).toBe(true);
    r.draws.push({ at: 200, view: "vb" }); expect(analyse("T-f", r)).toMatchObject({ pass: false, supersededDraws: 1 });
    r.draws = []; r.ticks.at(-1)!.key = "late"; expect(analyse("T-f", r).pass).toBe(false);
  });
  test("close requires baseline, runtime disposal, GL return and available OS counters", () => {
    const r = run(), memory = { live: { texture: 5, program: 2 }, heapMB: 100, residents: [] as Run["before"]["residents"] };
    const os = { privateMB: 500, dedicatedMB: 100, sharedMB: 0, processes: 4 };
    const closure = { before: memory, after: structuredClone(memory), osBefore: os, osAfter: { ...os }, scene: "sb" };
    expect(analyse("T-h", r).pass).toBe(false);
    expect(analyse("T-h", r, false, closure).pass).toBe(true);
    closure.after.live.texture++; expect(analyse("T-h", r, false, closure).pass).toBe(false);
    closure.after.live.texture--; closure.osAfter.dedicatedMB = 120;
    expect(analyse("T-h", r, false, closure).pass).toBe(false);
    closure.osAfter = { ...os }; closure.after.residents.push({ scene: "sb", key: "sb|c|female", state: "warm" });
    expect(analyse("T-h", r, false, closure).pass).toBe(false);
    const missing = { ...closure, after: memory, osAfter: { ...os, dedicatedMB: null } };
    expect(analyse("T-h", r, false, missing).failures).toContain("OS / GPU memory counters unavailable");
  });
  test("a shell smoke never passes the real-data gate", () => {
    expect(analyse("T-g", run(), true)).toMatchObject({ pass: true, realDataPass: false });
  });
});
