import { afterEach, expect, test } from "bun:test";
import { createHolotable } from "../src/features/holotable/service";
import type { HoloLiveUpdate, HoloTransport, HoloSession } from "../src/features/holotable/types";

// A retained-data service fake: no game, pipe, files or browser.
const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); });
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const meta: HoloSession["meta"] = { session: "fake", run: 1, start: 100, end: 101, from: 100, to: 101, channels: ["v"], complete: false,
  dropped: 0, missedDeadlines: 0, largestGapS: 0, coverage: "synthetic", problems: [] };
const sample = (t: number) => ({ t, seq: Math.round((t - 100) * 10), position: [t - 100, 0, 0] as const, yaw: 0, speed: 1, health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: "" });
function setup() {
  let ms = 0, id = 0, recording = true, available = true;
  const jobs: { at: number; fn: () => void }[] = [], calls: { method: string; params: Record<string, unknown> }[] = [];
  const later = (delay: number, fn: () => void) => { const job = { at: ms + delay, fn }; jobs.push(job); return () => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); }; };
  const updates: HoloLiveUpdate[] = [];
  let nextPollGate: Promise<void> | undefined;
  const data = (t: number, phase: "watching" | "disconnected" = "watching"): HoloLiveUpdate => ({
    since: { epoch: 1, v: 1, camera: 0, events: 0, gaps: 0 }, reset: false, more: false, meta: { ...meta, end: t, to: t },
    state: { available, recording, watching: true, phase, behindS: 0, more: false, droppedBatches: 0, message: phase === "disconnected" ? "The game stopped sending. Showing what arrived; Holotable reconnects when the game is back." : "" },
    v: [sample(t)], camera: [], events: [], gaps: [],
  });
  const transport: HoloTransport = async (method, params, signal) => {
    signal.throwIfAborted(); calls.push({ method, params });
    const result = method === "live.status" ? { available, recording }
      : method === "runs.list" ? [{ session: "fake", run: 1, dir: "archive", start: 100, end: 101, bytes: 1, complete: true }]
      : method === "live.watch" ? { watch: `watch-${++id}` }
      : method === "live.poll" ? updates.shift() ?? data(101)
      : method === "session.open" ? { meta, v: [sample(100)], camera: [], events: [], gaps: [] }
      : method === "world.around" && params.watch ? { version: 1, world: null, cold: false, pending: false }
      : { provenance: null, areas: [], cells: [] };
    if (method === "live.poll" && nextPollGate) { const gate = nextPollGate; nextPollGate = undefined; await gate; }
    return { ok: true, status: 200, data: { ok: true, result } };
  };
  const ctl = new AbortController();
  const service = createHolotable({ transport, later, every: (delay, tick) => later(delay, tick) }, ctl.signal);
  disposals.push(() => { service.withdraw(); ctl.abort(); });
  async function advance(delta: number) {
    const end = ms + delta;
    for (let n = 0; n < 100; n++) { jobs.sort((a, b) => a.at - b.at); if (!jobs.length || jobs[0].at > end) break; const job = jobs.shift()!; ms = job.at; job.fn(); await settle(); }
    ms = end; await settle();
  }
  return { service, calls, updates, data, advance, recording: (v: boolean) => { recording = v; }, available: (v: boolean) => { available = v; },
    holdNextPoll() { let release!: () => void; nextPollGate = new Promise(resolve => { release = resolve; }); return release; } };
}
test("discovery is offered only while shown; Watch is disabled while recorder is off", async () => {
  const f = setup(); f.recording(false); expect(f.calls).toHaveLength(0);
  f.service.shown(); await settle();
  expect(f.service.snapshot().live.available).toBe(true);
  expect(f.service.capability({ kind: "holo.watch" })).toMatchObject({ available: false, reason: "The recorder is off. It runs during XF test sessions." });
  expect((await f.service.dispatch({ kind: "holo.watch" })).ok).toBe(false);
  f.recording(true); await f.advance(4999); expect(f.service.snapshot().live.recording).toBe(false);
  await f.advance(1); expect(f.service.capability({ kind: "holo.watch" }).available).toBe(true);
  f.service.withdraw(); const count = f.calls.length; await f.advance(30000); expect(f.calls).toHaveLength(count);
});
test("following takes newest samples; Pause and scrub freeze, Back to live jumps forward", async () => {
  const f = setup(); f.service.shown(); await settle(); await f.service.dispatch({ kind: "holo.watch" });
  expect(f.service.snapshot().t).toBe(101); expect(f.service.snapshot().live.following).toBe(true);
  f.updates.push(f.data(102)); await f.advance(1000); expect(f.service.snapshot().t).toBe(102);
  await f.service.dispatch({ kind: "holo.play", on: false });
  f.updates.push(f.data(103)); await f.advance(1000);
  expect(f.service.snapshot().live.following).toBe(false); expect(f.service.snapshot().t).toBe(102);
  await f.service.dispatch({ kind: "holo.follow" }); expect(f.service.snapshot().t).toBe(103);
  await f.service.dispatch({ kind: "holo.seek", t: 100.5 });
  expect(f.service.snapshot().t).toBe(100.5); expect(f.service.snapshot().live.following).toBe(false);
});
test("the behind readout includes retained rows the client has not received yet", async () => {
  const f = setup(); f.service.shown(); await settle();
  const delayed = f.data(101); f.updates.push({ ...delayed, meta: { ...meta, to: 104 }, state: { ...delayed.state, behindS: 2 } });
  await f.service.dispatch({ kind: "holo.watch" });
  expect(f.service.snapshot().live.behindS).toBe(5); expect(f.service.snapshot().t).toBe(101);
});
test("a disconnect keeps received data; reconnect follows quietly; opening a run stops watching", async () => {
  const f = setup(); f.service.shown(); await settle(); await f.service.dispatch({ kind: "holo.watch" });
  const lost = f.data(101, "disconnected"); f.updates.push({ ...lost, v: [] }); await f.advance(1000);
  expect(f.service.snapshot().open?.session.v).toHaveLength(1); expect(f.service.snapshot().message).toContain("The game stopped sending.");
  f.updates.push(f.data(104)); await f.advance(1000); expect(f.service.snapshot().t).toBe(104); expect(f.service.snapshot().message).toBe("");
  await f.service.dispatch({ kind: "holo.open", dir: "archive" });
  expect(f.calls.some(c => c.method === "live.stop")).toBe(true); expect(f.service.snapshot().live.watching).toBe(false);
  expect(f.service.snapshot().open?.dir).toBe("archive");
});
test("hiding stops the watch and all requests; showing resumes the live source", async () => {
  const f = setup(); f.service.shown(); await settle(); await f.service.dispatch({ kind: "holo.watch" });
  f.service.withdraw(); await settle(); const count = f.calls.length; await f.advance(30000); expect(f.calls).toHaveLength(count);
  f.service.shown(); await settle(); expect(f.calls.filter(c => c.method === "live.watch")).toHaveLength(2);
  expect(f.service.snapshot().live.following).toBe(true);
  expect(f.calls.filter(c => c.method === "live.poll").at(-1)?.params.since).toMatchObject({ epoch: 1, v: 1 });
});
test("level changes refetch events without rewinding track cursors and remove full words immediately", async () => {
  const f = setup(); f.service.shown(); await settle(); await f.service.dispatch({ kind: "holo.watch" });
  const full = f.data(102); f.updates.push({ ...full, events: [{ id: "e", kind: "line", t: 101, seq: 2, summary: "Subtitle requested", level: "full", detail: "secret", cite: "test" }] });
  await f.service.dispatch({ kind: "holo.level", level: "full" }); await settle();
  expect(JSON.stringify(f.service.snapshot().open)).toContain("secret");
  await f.service.dispatch({ kind: "holo.level", level: "structure" });
  expect(JSON.stringify(f.service.snapshot().open)).not.toContain("secret");
  expect(f.calls.filter(c => c.method === "live.poll").at(-1)?.params).toMatchObject({ level: "structure" });
  expect(f.calls.filter(c => c.method === "live.poll").at(-1)?.params.since).toMatchObject({ v: 1, events: 0 });
});
test("a late full-content response cannot restore words after the person hides them", async () => {
  const f = setup(); f.service.shown(); await settle(); await f.service.dispatch({ kind: "holo.watch" });
  const full = f.data(102);
  f.updates.push({ ...full, events: [{ id: "late", kind: "line", t: 101, seq: 2, summary: "Subtitle requested", level: "full", detail: "late private words", cite: "test" }] });
  const release = f.holdNextPoll();
  await f.service.dispatch({ kind: "holo.level", level: "full" }); await settle();
  await f.service.dispatch({ kind: "holo.level", level: "structure" }); await settle();
  release(); await settle();
  expect(f.service.snapshot().level).toBe("structure"); expect(JSON.stringify(f.service.snapshot().open)).not.toContain("late private words");
});
