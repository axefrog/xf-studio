import { afterEach, expect, test } from "bun:test";
import { createHolotable } from "../src/features/holotable/service";
import type { HoloLiveUpdate, HoloTransport, HoloSession, HoloWorld } from "../src/features/holotable/types";

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
  let geometry:HoloWorld={provenance:null,areas:[],cells:[],solids:[]};
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
      : method === "world.around" && params.center ? geometry
      : method === "world.around" && params.watch ? { version: 1, world: geometry, cold: false, pending: false }
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
  return { service, calls, updates, data, advance, geometry:(world:HoloWorld)=>{geometry=world;}, recording: (v: boolean) => { recording = v; }, available: (v: boolean) => { available = v; },
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

for (const mode of ["paused", "scrubbing", "following"] as const) test(`a reset puts ${mode} time inside the new run and removes a stale selection`, async () => {
  const f = setup(); f.service.shown(); await settle();
  const first: HoloLiveUpdate = { ...f.data(101), events: [{ id: "old-event", kind: "line", t: 101, seq: 1, summary: "Old event", level: "structure", cite: "test" }] };
  f.updates.push(first); await f.service.dispatch({ kind: "holo.watch" });
  await f.service.dispatch({ kind: "holo.select", id: "old-event" });
  if (mode === "paused") await f.service.dispatch({ kind: "holo.play", on: false });
  if (mode === "scrubbing") await f.service.dispatch({ kind: "holo.seek", t: 100.5 });
  const next: HoloLiveUpdate = { ...f.data(201), reset: true, since: { ...f.data(201).since, epoch: 2 },
    meta: { ...meta, run: 2, start: 200, from: 200, end: 201, to: 201 } };
  f.updates.push(next); await f.advance(1000);
  expect(f.service.snapshot().t).toBe(mode === "following" ? 201 : 200);
  expect(f.service.snapshot().selected).toBeNull();
  expect(f.service.snapshot().open?.session.v).toHaveLength(1);
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
  await f.service.dispatch({ kind: "holo.level", level: "structure" });
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
  await f.service.dispatch({ kind: "holo.level", level: "structure" });
  const full = f.data(102);
  f.updates.push({ ...full, events: [{ id: "late", kind: "line", t: 101, seq: 2, summary: "Subtitle requested", level: "full", detail: "late private words", cite: "test" }] });
  const release = f.holdNextPoll();
  await f.service.dispatch({ kind: "holo.level", level: "full" }); await settle();
  await f.service.dispatch({ kind: "holo.level", level: "structure" }); await settle();
  release(); await settle();
  expect(f.service.snapshot().level).toBe("structure"); expect(JSON.stringify(f.service.snapshot().open)).not.toContain("late private words");
});


test("live appends people and clears incident story payload immediately when hiding story", async () => {
  const f=setup(); f.service.shown(); await settle();
  const first=f.data(101);
  f.updates.push({...first,reset:true,actors:[{t:101,who:"a1",valid:true,entity:"one",position:[1,2,3],command_state:"Executing"}],events:[{id:"incident1",kind:"incident",t:101,seq:10,summary:"Incident observation",level:"full",cite:"recorder:fake:1:10",incident:{event:"witness.report",kind:"assault"}}]});
  await f.service.dispatch({kind:"holo.watch"});
  expect(f.service.snapshot().layers.people).toBe(false);
  expect(f.service.snapshot().open?.session.actors).toHaveLength(1);
  await f.service.dispatch({kind:"holo.level",level:"structure"});
  expect(f.service.snapshot().open?.session.events.every(e=>!e.incident)).toBe(true);
  expect(f.service.snapshot().open?.session.actors).toHaveLength(1);
});


test("following is always 1x and replay restores the remembered speed when paused or scrubbed",async()=>{
 const f=setup();f.service.shown();await settle();await f.service.dispatch({kind:"holo.watch"});
 expect(f.service.snapshot().speed).toBe(1);expect(f.service.capability({kind:"holo.speed",speed:16}).available).toBe(false);
 expect((await f.service.dispatch({kind:"holo.speed",speed:16})).ok).toBe(false);
 await f.service.dispatch({kind:"holo.play",on:false});expect(f.service.snapshot().speed).toBe(4);
 await f.service.dispatch({kind:"holo.speed",speed:16});await f.service.dispatch({kind:"holo.follow"});expect(f.service.snapshot().speed).toBe(1);
 await f.service.dispatch({kind:"holo.seek",t:100.5});expect(f.service.snapshot().speed).toBe(16);expect(f.service.snapshot().live.following).toBe(false);
});


test("last world-view lease releases live geometry while Details keeps polling, without refetching or republishing",async()=>{
 const f=setup(),view=new AbortController();f.service.shown();await settle();await f.service.dispatch({kind:"holo.watch"});
 const world:HoloWorld={provenance:null,areas:[],cells:[],solids:[{id:"live-solid",kind:"box",center:[0,0,0],size:[1,1,1],axes:[[1,0,0],[0,1,0],[0,0,1]]}]};
 f.geometry(world);f.service.context(view.signal).want([0,0,0],true);await f.advance(250);
 expect(f.service.snapshot().open!.world.solids).toHaveLength(1);
 // An active lease also receives refreshed geometry through its owner.
 await f.advance(1000);expect(f.calls.filter(call=>call.method==="world.around").length).toBeGreaterThan(1);
 view.abort();expect(f.service.snapshot().open!.world.solids).toEqual([]);
 const before=f.calls.filter(call=>call.method==="world.around").length, polls=f.calls.filter(call=>call.method==="live.poll").length;
 f.updates.push(f.data(103));await f.advance(3000);
 expect(f.calls.filter(call=>call.method==="live.poll").length).toBeGreaterThan(polls);
 expect(f.service.snapshot().live.watching).toBe(true);expect(f.service.snapshot().open!.session.v.some(v=>v.t===103)).toBe(true);
 expect(f.service.snapshot().open!.world.solids).toEqual([]);expect(f.calls.filter(call=>call.method==="world.around")).toHaveLength(before);
 expect(f.calls.filter(call=>call.method==="world.around").every(call=>call.params.center)).toBe(true);
});
