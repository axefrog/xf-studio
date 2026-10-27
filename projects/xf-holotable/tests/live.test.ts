import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLiveSource, LIVE_BOUNDS, type LiveUpdate } from "../src/live.ts";
import { createLiveBridge, mapRecorderStatus } from "../src/live-bridge.ts";
import { createService, LIVE_WORLD_IDLE_MS } from "../src/service.ts";
import { emptySolids } from "../src/solid-source.ts";
import { readRun } from "../src/recording.ts";
import { trailUntil } from "../src/query.ts";
import { writeFixture, type Fixture } from "./fixture.ts";
import { emptyRecorderStatus, FakeBridge, settle } from "./live-fake.ts";

let fixture: Fixture | undefined;
const closes: (() => void)[] = [];
afterEach(() => { for (const close of closes.splice(0)) close(); fixture?.dispose(); fixture = undefined; });
function setup() {
  fixture = writeFixture();
  const rows = readFileSync(join(fixture.dir, "chunk-1.jsonl"), "utf8").trim().split("\n").map(x => JSON.parse(x));
  const bridge = new FakeBridge(), source = createLiveSource(bridge, { clock: bridge.clock }); closes.push(() => source.close());
  return { bridge, source, rows };
}
const sig = () => new AbortController().signal;

describe("live source", () => {
  test("a stopped recorder drains retained pages before waiting, then stops catch-up", async () => {
    const { bridge, source, rows } = setup();
    for (let i = 0; i < 8; i++) {
      const page = bridge.page(rows.slice(i * 2, i * 2 + 2), { more: i < 7 });
      page.source.active = i < 5; bridge.pages.push(page);
    }
    const { watch } = source.watch(); await settle(); await bridge.clock.advance(4000);
    bridge.recorder.active = false; await bridge.clock.advance(1000);
    expect(source.poll(watch, undefined, "structure").state.phase).toBe("watching");
    expect(source.session()!.v).toHaveLength(6);
    await bridge.clock.advance(2000);
    expect(source.poll(watch, undefined, "structure").state).toMatchObject({ phase: "waiting", more: false, recording: false });
    expect(source.session()!.v).toHaveLength(8);
    expect(bridge.inputs.map(x => x.at)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    await bridge.clock.advance(5000); expect(bridge.inputs).toHaveLength(8);
  });
  test("stopping discovers the final tail even when the previous page had no backlog", async () => {
    const { bridge, source, rows } = setup(); bridge.pages.push(bridge.page(rows.slice(0, 2)));
    const { watch } = source.watch(); await settle(); await bridge.clock.advance(4000);
    bridge.recorder.active = false;
    const tail = bridge.page(rows.slice(2, 4)); tail.source.active = false; bridge.pages.push(tail);
    await bridge.clock.advance(3000);
    expect(source.poll(watch, undefined, "structure").state.phase).toBe("waiting");
    expect(source.session()!.v).toHaveLength(2);
  });
  for (const many of [false, true]) test(`bounded deltas publish ${many ? "more than one poll of gaps" : "a known gap"} before split samples`, async () => {
    const { bridge, source, rows } = setup();
    bridge.pages.push(bridge.page(Array.from({ length: many ? 600 : 400 }, (_, i) => ({ ...rows[0], seq: i + 1, source_s: 1000 + i / 10,
      valid: many ? i % 2 === 0 : i !== 100, data: { ...rows[0].data, position: [i, 0, 0] } }))));
    const { watch } = source.watch(); await settle();
    const received = { ...source.session()!, v: [] as NonNullable<ReturnType<typeof source.session>>["v"], gaps: [] as NonNullable<ReturnType<typeof source.session>>["gaps"] };
    let since: LiveUpdate["since"] | undefined;
    for (let i = 0; i < 10; i++) {
      const page = source.poll(watch, since, "structure"); since = page.since;
      expect(page.v.length + page.camera.length + page.events.length + page.gaps.length).toBeLessThanOrEqual(LIVE_BOUNDS.pollRows);
      received.v.push(...page.v); received.gaps.push(...page.gaps);
      const reached = source.session()!.gaps.filter(g => g.to <= (received.v.at(-1)?.t ?? -Infinity));
      expect(reached.every(g => received.gaps.some(r => r.to === g.to))).toBe(true);
      expect(trailUntil(received, Infinity)).toHaveLength(received.v.length ? reached.length + 1 : 0);
      if (!page.more) break;
      if (i === 9) throw Error("Live test failed to drain bounded updates");
    }
    expect(received.v).toHaveLength(many ? 300 : 399);
  });
  test("request cancellation reaches discovery and a late result cannot be cached", async () => {
    const { bridge, source } = setup();
    let received: AbortSignal | undefined, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    bridge.discover = async signal => { received = signal; await held; return { available: true, recorder: bridge.recorder }; };
    const requester = new AbortController(), pending = source.status(requester.signal).then(() => false, () => true);
    await settle(); requester.abort();
    const cancelled = received!.aborted; release(); expect(await pending).toBe(true);
    expect(cancelled).toBe(true);
    let retries = 0;
    bridge.discover = async signal => { signal.throwIfAborted(); retries++; return { available: true, recorder: bridge.recorder }; };
    await source.status(sig()); expect(retries).toBe(1);
  });
  test("replays recorded pages through the same model, preserving an opaque cursor verbatim", async () => {
    const { bridge, source, rows } = setup();
    const first = bridge.page(rows.slice(0, 40), { more: true, now: 1004.9 });
    bridge.pages.push(first, bridge.page(rows.slice(40)));
    const { watch } = source.watch(); await settle();
    const a = source.poll(watch, undefined, "structure");
    expect(a.state.more).toBe(true); expect(a.gaps).toEqual([]); expect(a.state.behindS).toBeGreaterThan(2);
    await bridge.clock.advance(1000);
    expect((bridge.inputs[1].input as any).cursor).toEqual(first.cursor);
    expect((bridge.inputs[0].input as any)).toEqual({ run: 1, now: false, detail: true });
    const live = source.session()!, replay = readRun(fixture!.dir);
    expect(live.v).toEqual(replay.v); expect(live.camera).toEqual(replay.camera); expect(live.events).toEqual(replay.events);
    expect(live.gaps).toEqual([]);
    const b = source.poll(watch, a.since, "structure");
    expect(b.v.length + a.v.length).toBe(50); expect(b.reset).toBe(false);
    expect(JSON.stringify(b)).not.toContain("A secret line");
    expect(JSON.stringify(source.poll(watch, undefined, "full"))).toContain("A secret line");
  });
  test("invalid samples, sequence loss and missed deadlines break the trail; backlog alone does not", async () => {
    const { bridge, source, rows } = setup();
    bridge.pages.push(bridge.page(rows.slice(0, 10), { more: true }), bridge.page(rows.slice(14, 30), { gaps: ["source_coverage_incomplete"] }));
    const { watch } = source.watch(); await settle();
    expect(source.session()?.gaps).toEqual([]);
    await bridge.clock.advance(1000); source.poll(watch, undefined, "structure");
    expect(source.session()!.gaps.length).toBeGreaterThan(0);
    expect(trailUntil(source.session()!, Infinity).length).toBe(2);
  });
  test("an invalid V sample breaks the trail at the next valid sample", async () => {
    const { bridge, source, rows } = setup();
    bridge.pages.push(bridge.page(rows.slice(0, 8).map((r, i) => i === 4 ? { ...r, valid: false } : r)));
    const { watch } = source.watch(); await settle();
    expect(source.poll(watch, undefined, "structure").gaps).toMatchObject([{ from: rows[2].source_s, to: rows[6].source_s, reason: "invalid" }]);
    expect(trailUntil(source.session()!, Infinity)).toHaveLength(2);
  });
  test("disconnect preserves samples, reconnects after five seconds, and never joins a different world", async () => {
    const { bridge, source, rows } = setup();
    bridge.pages.push(bridge.page(rows.slice(0, 4)), Error("disconnect"));
    const { watch } = source.watch(); await settle(); await bridge.clock.advance(1000);
    expect(source.poll(watch, undefined, "structure").state.phase).toBe("disconnected");
    expect(source.session()!.v).toHaveLength(2);
    bridge.pages.push(bridge.page(rows.slice(4, 8)));
    await bridge.clock.advance(4999); expect(bridge.inputs).toHaveLength(2);
    await bridge.clock.advance(1); expect(bridge.inputs).toHaveLength(3); expect(source.session()!.v).toHaveLength(4);
    bridge.recorder.world = 2; bridge.recorder.run = 2;
    const newWorld = bridge.page(rows.slice(0, 4).map(r => ({ ...r, run: 2, world_generation: 2 })));
    bridge.pages.push(newWorld, newWorld);
    await bridge.clock.advance(6000);
    const next = source.poll(watch, { epoch: 1, v: 4, camera: 4, events: 0, gaps: 0 }, "structure");
    expect(next.reset).toBe(true); expect(next.meta?.worldGeneration).toBe(2); expect(next.v).toHaveLength(2);
  });
  test("last watcher stops reads; stale clients expire; two clients share one read", async () => {
    const { bridge, source, rows } = setup(); bridge.pages.push(bridge.page(rows));
    const a = source.watch(), b = source.watch(); await settle();
    expect(bridge.inputs).toHaveLength(1); source.stop(a.watch);
    await bridge.clock.advance(1000); expect(bridge.inputs).toHaveLength(2);
    source.stop(b.watch); const count = bridge.inputs.length;
    await bridge.clock.advance(30000); expect(bridge.inputs).toHaveLength(count);
    const c = source.watch(); await settle(); await bridge.clock.advance(20000);
    expect(() => source.poll(c.watch, undefined, "structure")).toThrow(/expired/);
    expect(bridge.closed).toBeGreaterThan(0);
  });
  test("oversized batches advance the exact cursor and disclose the gap", async () => {
    const { bridge, source, rows } = setup();
    const tooBig = bridge.page(Array.from({ length: LIVE_BOUNDS.rowsPerSecond + 1 }, (_, i) => ({ ...rows[0], seq: i + 10 })), { record: 4000 });
    bridge.pages.push(bridge.page(rows.slice(0, 2)), tooBig, bridge.page([{ ...rows[2], seq: 4001, source_s: 1000.2 }]));
    const { watch } = source.watch(); await settle(); await bridge.clock.advance(2000);
    expect((bridge.inputs[2].input as any).cursor).toEqual(tooBig.cursor);
    const update = source.poll(watch, undefined, "structure");
    expect(update.state.droppedBatches).toBe(1); expect(update.gaps.some(g => g.reason === "missing")).toBe(true);
  });
  test("client deltas are bounded and invalid cursors are refused", async () => {
    const { bridge, source, rows } = setup();
    bridge.pages.push(bridge.page(Array.from({ length: 700 }, (_, i) => ({ ...rows[0], seq: i + 1, source_s: 1000 + i / 10 }))));
    const { watch } = source.watch(); await settle();
    const a = source.poll(watch, undefined, "structure"); expect(a.v).toHaveLength(256); expect(a.more).toBe(true);
    const b = source.poll(watch, a.since, "structure"); expect(b.v).toHaveLength(256);
    expect(JSON.stringify(a).length).toBeLessThan(LIVE_BOUNDS.pollBytes + 8192);
    expect(() => source.poll(watch, { ...a.since, v: 9999 }, "structure")).toThrow(/cursor/);
  });
  test("empty reads back off and a byte-budget drop is disclosed independently of the row budget", async () => {
    const { bridge, source, rows } = setup();
    bridge.pages.push(bridge.page(rows.slice(0, 2)));
    const { watch } = source.watch(); await settle();
    await bridge.clock.advance(7000);
    expect(bridge.inputs.map(x => x.at)).toEqual([0, 1000, 3000, 7000]);
    source.poll(watch, undefined, "structure");
    bridge.pages.push(bridge.page([{ ...rows[2], seq: 500, data: { padding: "x".repeat(LIVE_BOUNDS.bytesPerSecond) } }], { more: true, record: 500 }),
      bridge.page([{ ...rows[4], seq: 501 }]));
    await bridge.clock.advance(5000);
    expect(source.poll(watch, undefined, "structure").state).toMatchObject({ droppedBatches: 1, more: true });
    await bridge.clock.advance(1000);
    expect(source.session()!.gaps.some(g => g.reason === "missing")).toBe(true);
  });
  test("a late cancelled read publishes nothing and a new watcher still resumes", async () => {
    const { bridge, source, rows } = setup();
    let release!: (page: Record<string, any>) => void;
    const held = new Promise<Record<string, any>>(resolve => { release = resolve; });
    const original = bridge.catchup.bind(bridge); let first = true;
    bridge.catchup = async (input, signal) => { if (first) { first = false; return held; } return original(input, signal); };
    const a = source.watch(); await settle(); source.stop(a.watch);
    const b = source.watch(); release(bridge.page(rows)); await settle();
    expect(source.poll(b.watch, undefined, "structure").v).toHaveLength(0);
    bridge.pages.push(bridge.page(rows)); await bridge.clock.advance(1000);
    expect(source.poll(b.watch, undefined, "structure").v).toHaveLength(50);
  });
});
test("maps exactly the 0.8.23 discovery contract and empty recorder", () => {
  const empty = emptyRecorderStatus();
  expect(mapRecorderStatus(empty)).toEqual({ active: false, run: null, session: "abc123", world: null, channels: [], start: null, latest: null, stopReason: null });
  expect(() => mapRecorderStatus({ ...empty, session: null, channels: null })).toThrow();
  expect(() => mapRecorderStatus({ ...empty, ack: 0 })).toThrow();
  expect(mapRecorderStatus({ active: true, run: 1, session: "s", world: 2, channels: ["v"], start: { s: 12, at: "2026-10-27T00:00:00Z" }, latest: 4, stop_reason: "duration" })).toMatchObject({ start: 12, stopReason: "duration" });
  const fake = new FakeBridge(); fake.beforeFirstRun();
  expect(fake.recorder).toEqual(mapRecorderStatus(empty));
});
test("the adapter always selects a reader, hides old bridges and permits only status and detailed catch-up", async () => {
  const calls: { name: string; input: unknown }[] = [];
  let old = true, closed = false;
  const adapter = createLiveBridge(options => {
    expect(options.readOnly).toBe(true);
    return {
      async callBridge(name, input) {
        calls.push({ name, input });
        return old ? { ok: false, error: { code: "unknown_method", message: "Unknown" } } : { ok: true, result: emptyRecorderStatus() };
      },
      async run(name, input) { calls.push({ name, input }); return { ok: true, command: name, cid: "fake", result: { records: [] } }; },
      close() { closed = true; },
    };
  });
  expect((await adapter.discover(sig())).available).toBe(false); old = false;
  expect((await adapter.discover(sig())).available).toBe(true);
  const cursor = { opaque: { extra: [1, 2] } };
  await adapter.catchup({ cursor, now: false, detail: true }, sig());
  expect(calls.map(c => c.name)).toEqual(["recorder.status", "recorder.status", "game.catchup"]);
  expect(calls[2].input).toEqual({ cursor, now: false, detail: true }); adapter.close(); expect(closed).toBe(true);
});
test("session events use source seconds and optional data.world_generation, with words hidden at structure", async () => {
  const { bridge, source, rows } = setup();
  bridge.pages.push(bridge.page(rows.slice(0, 4), { events: [
    { seq: 1, kind: "note", source_s: 999, text: "before run" },
    { seq: 2, kind: "note", source_s: 1000.1, data: { text: "private note" } },
    { seq: 3, kind: "note", source_s: 1000.1, data: { world_generation: 9 } },
  ] }));
  const { watch } = source.watch(); await settle();
  const a = source.poll(watch, undefined, "structure"); expect(a.events).toHaveLength(1);
  expect(a.events[0].cite).toBe("event:abc123:2"); expect(JSON.stringify(a)).not.toContain("private note");
  expect(JSON.stringify(source.poll(watch, undefined, "full"))).toContain("private note");
});
test("a malformed page publishes no partial samples and does not advance its cursor", async () => {
  const { bridge, source, rows } = setup(); const first = bridge.page(rows.slice(0, 4));
  bridge.pages.push(first, bridge.page([rows[4], { ...rows[5], session: "other" }]), bridge.page(rows.slice(4, 8)));
  const { watch } = source.watch(); await settle(); await bridge.clock.advance(1000);
  expect(source.poll(watch, undefined, "structure").v).toHaveLength(2);
  await bridge.clock.advance(5000);
  expect((bridge.inputs[2].input as any).cursor).toEqual(first.cursor); expect(source.session()!.v).toHaveLength(4);
});
test("service polls never wait for live solids, and hiding cancels their want", async () => {
  const { bridge, rows } = setup(); bridge.pages.push(bridge.page(rows));
  let shapeSignal: AbortSignal | undefined;
  const service = createService({ recordingsRoot: fixture!.root, worldPackPath: join(fixture!.root, "none"), liveBridge: bridge, liveClock: bridge.clock,
    solidSource: { around: async (_p, _m, signal) => { shapeSignal = signal; return new Promise(resolve => signal.addEventListener("abort", () => resolve(emptySolids()), { once: true })); } } });
  closes.push(() => service.close());
  const { watch } = await service.handlers["live.watch"]({}, sig()) as { watch: string }; await settle();
  await new Promise(resolve => setImmediate(resolve));
  const update = await service.handlers["live.poll"]({ watch }, sig()) as LiveUpdate;
  expect(update.v).toHaveLength(50); expect(shapeSignal).toBeUndefined();
  const geometry = await service.handlers["world.around"]({ watch }, sig()) as any;
  expect(geometry.pending).toBe(true); expect(geometry.world).toBeNull();
  await new Promise(resolve=>setImmediate(resolve));expect(shapeSignal?.aborted).toBe(false);
  await service.handlers["live.stop"]({ watch }, sig()); expect(shapeSignal?.aborted).toBe(true);
});

test("a new world withdraws old geometry before its first V sample", async () => {
  const { bridge, rows } = setup(); bridge.pages.push(bridge.page(rows));
  const service = createService({ recordingsRoot: fixture!.root, worldPackPath: join(fixture!.root, "none"), liveBridge: bridge, liveClock: bridge.clock,
    solidSource: { around: async () => emptySolids() } });
  closes.push(() => service.close());
  const { watch } = await service.handlers["live.watch"]({}, sig()) as { watch: string }; await settle();
  await new Promise(resolve => setImmediate(resolve)); await settle();
  const pending = await service.handlers["world.around"]({ watch }, sig()) as any;expect(pending.pending).toBe(true);
  await new Promise(resolve=>setImmediate(resolve));await settle();
  const first = await service.handlers["world.around"]({ watch }, sig()) as any;
  expect(first.world).not.toBeNull();
  for(let i=0;i<4;i++){await bridge.clock.advance(1000);await service.handlers["world.around"]({watch},sig());}
  bridge.recorder.run = 2; bridge.recorder.world = 2; bridge.recorder.start = 2000;
  bridge.pages.push(bridge.page([], { now: 2000 })); await bridge.clock.advance(3000);
  const next = await service.handlers["world.around"]({ watch, since: first.version }, sig()) as any;
  expect(next.version).toBeGreaterThan(first.version); expect(next.world).toBeNull();
  expect(service.live.session()?.v).toHaveLength(0);
});


test("Details-only live watching and polling never starts solid work",async()=>{
 const {bridge,rows}=setup();bridge.pages.push(bridge.page(rows));let reads=0,status=0;
 const service=createService({recordingsRoot:fixture!.root,worldPackPath:"",liveBridge:bridge,liveClock:bridge.clock,solidSource:{status:async()=>{status++;return{cold:false};},around:async()=>{reads++;return emptySolids();}}});closes.push(()=>service.close());
 const {watch}=await service.handlers["live.watch"]({},sig()) as {watch:string};await settle();
 for(let i=0;i<6;i++){
  await bridge.clock.advance(1000);await service.handlers["live.poll"]({watch},sig());await new Promise(resolve=>setImmediate(resolve));
 }
 expect(service.live.session()!.v.length).toBeGreaterThan(0);expect(reads).toBe(0);expect(status).toBe(0);
});

test("legacy live world wants share work; cancellation is per watch and late geometry cannot republish",async()=>{
 const {bridge,rows}=setup();bridge.pages.push(bridge.page(rows));
 const reads:{signal:AbortSignal;resolve:(value:ReturnType<typeof emptySolids>)=>void}[]=[];
 const service=createService({recordingsRoot:fixture!.root,worldPackPath:"",liveBridge:bridge,liveClock:bridge.clock,solidSource:{around:async(_p,_m,signal)=>new Promise(resolve=>reads.push({signal,resolve}))}});closes.push(()=>service.close());
 const one=await service.handlers["live.watch"]({},sig()) as {watch:string},two=await service.handlers["live.watch"]({},sig()) as {watch:string};await settle();
 const a=new AbortController(),b=new AbortController();
 const first=await service.handlers["world.around"](one,a.signal) as any;await service.handlers["world.around"](two,b.signal);await new Promise(resolve=>setImmediate(resolve));
 expect(first.pending).toBe(true);expect(reads).toHaveLength(1);
 a.abort();expect(reads[0].signal.aborted).toBe(false);b.abort();expect(reads[0].signal.aborted).toBe(true);
 reads[0].resolve({...emptySolids(),solids:[{id:"late",kind:"box",center:[0,0,0],size:[1,1,1],axes:[[1,0,0],[0,1,0],[0,0,1]]}]});await settle();
 const latest=new AbortController(),old=new AbortController();
 const next=await service.handlers["world.around"](one,old.signal) as any;expect(next.world).toBeNull();
 await service.handlers["world.around"](one,latest.signal);await new Promise(resolve=>setImmediate(resolve));expect(reads).toHaveLength(2);
 old.abort();expect(reads[1].signal.aborted).toBe(false);latest.abort();expect(reads[1].signal.aborted).toBe(true);reads[1].resolve(emptySolids());
});

test("legacy world idle timeout drops retained geometry and stops warming while live polling continues",async()=>{
 const {bridge,rows}=setup();bridge.pages.push(bridge.page(rows));let reads=0;
 const service=createService({recordingsRoot:fixture!.root,worldPackPath:"",liveBridge:bridge,liveClock:bridge.clock,solidSource:{around:async()=>{reads++;return emptySolids();}}});closes.push(()=>service.close());
 const {watch}=await service.handlers["live.watch"]({},sig()) as {watch:string};await settle();
 await service.handlers["world.around"]({watch},sig());await new Promise(resolve=>setImmediate(resolve));await settle();
 let ready=await service.handlers["world.around"]({watch},sig()) as any;expect(ready.world).not.toBeNull();expect(reads).toBe(1);
 const position=rows.find(r=>r.channel==="v"&&r.valid)!;
 bridge.pages.push(bridge.page([{...position,seq:999,source_s:1010,data:{...position.data,position:[1000,1000,0]}}],{record:999}));
 await bridge.clock.advance(1000);await new Promise(resolve=>setImmediate(resolve));await settle();expect(reads).toBe(2);
 ready=await service.handlers["world.around"]({watch},sig()) as any;
 await bridge.clock.advance(LIVE_WORLD_IDLE_MS+1);await service.handlers["live.poll"]({watch},sig());
 bridge.pages.push(bridge.page([{...position,seq:1000,source_s:1020,data:{...position.data,position:[2000,2000,0]}}],{record:1000}));
 await bridge.clock.advance(1000);await new Promise(resolve=>setImmediate(resolve));expect(reads).toBe(2);
 const renewed=await service.handlers["world.around"]({watch,since:ready.version},sig()) as any;
 expect(renewed.world).toBeNull();expect(renewed.pending).toBe(true);expect(renewed.version).toBeGreaterThan(ready.version);
});
