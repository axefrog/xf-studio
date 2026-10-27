import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActorSample, Incident } from "../src/model.ts";
import { readRun } from "../src/recording.ts";
import { sessionAtLevel } from "../src/query.ts";
import { createLiveSource, LIVE_BOUNDS } from "../src/live.ts";
import { FakeBridge, settle } from "./live-fake.ts";
import { writeFixture, type Fixture } from "./fixture.ts";
let fixture: Fixture | undefined;
afterEach(() => { fixture?.dispose(); fixture = undefined; });
const actor: Omit<ActorSample, "t"> = { who: "a1", valid: true, entity: "42", position: [1,2,3], yaw: 45, command_state: "Executing", prepared: true };
const incident: Incident = { event: "witness.report", schema: "xfb/witness-1", incident: "inc-1", kind: "assault", place: { position: [1,2,3], first: [1,2,3], last: [1,2,3], district_v: "Test" }, declared: { id: "private-story", kind: "private-kind", roles: { a1: "secret-role" }, at: [1,2,3], ttl_s: 10 } };
function rows() {
  return [
    { channel: "actors", valid: false, data: { actors: [actor, { who: "a2", valid: false }] } },
    { channel: "incidents", data: incident },
    { channel: "incidents", data: { event: "witness.unwitnessed", declared: incident.declared, reason: "no_view" } },
    { channel: "incidents", data: { event: "witness.gap", kind: "gunfire", reason: "report_queue_full" } },
    { channel: "incidents", data: { event: "incident.coverage", open: 2, declared: 1 } },
    { channel: "face", data: { event: "face.requested" } },
    { channel: "v", valid: false, data: {} },
  ].map((r,i) => ({ session: "abc123", run: 1, world_generation: 1, seq: i+1, source_s: 1000+i/10, valid: true, ...r }));
}
test("recordings preserve source fields, typed incidents and all declared channel counts", () => {
  fixture = writeFixture();
  const manifestPath = join(fixture.dir,"manifest.json"), manifest = JSON.parse(readFileSync(manifestPath,"utf8"));
  manifest.channels = ["actors", "incidents", "face", "v", "ui"];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(fixture.dir,"chunk-1.jsonl"), rows().map(r=>JSON.stringify(r)).join("\n")+"\n");
  const s = readRun(fixture.dir);
  expect(s.actors).toEqual([{ t: 1000, ...actor }, { t:1000, who:"a2", valid:false }]);
  expect(s.events.map(e=>e.kind)).toEqual(Array(4).fill("incident"));
  expect(s.events[0]).toMatchObject({ at:[1,2,3], cite:"recorder:abc123:1:2", incident });
  expect(s.events[3].incident).toMatchObject({event:"incident.coverage",declared:1});
  expect(s.events[1].at).toEqual([1,2,3]); expect(s.events[2].at).toBeUndefined();
  expect(s.meta.channels).toEqual([
    { name:"actors", read:1, kept:1, dropped:0, reasons:{} }, { name:"incidents", read:4, kept:4, dropped:0, reasons:{} },
    { name:"face", read:1, kept:0, dropped:1, reasons:{"not mapped":1} }, { name:"v", read:1, kept:0, dropped:1, reasons:{invalid:1} },
    { name:"ui", read:0, kept:0, dropped:0, reasons:{} },
  ]);
  const hidden = sessionAtLevel(s,"structure");
  expect(hidden.events.every(e=>!e.incident)).toBe(true);
  expect(JSON.stringify(hidden)).not.toContain("private-story");
});
test("live actors and incidents are incremental, budgeted and disclosure-filtered", async () => {
  const bridge = new FakeBridge(); bridge.recorder.channels = ["actors", "incidents", "face", "v", "ui"];
  bridge.pages.push(bridge.page(rows()));
  const source = createLiveSource(bridge,{clock:bridge.clock});
  try {
    const {watch} = source.watch(); await settle();
    const first = source.poll(watch,undefined,"structure");
    expect(first.actors).toHaveLength(2); expect(first.events).toHaveLength(4);
    expect(first.events.every(e=>!e.incident)).toBe(true);
    expect(source.poll(watch,first.since,"full").actors).toEqual([]);
    expect(source.poll(watch,{...first.since,events:0},"full").events[0].incident).toEqual(incident);
    expect(first.meta!.channels.find(c=>c.name==="face")?.reasons).toEqual({"not mapped":1});
  } finally { source.close(); }
});
test("actor tracks share live row budgets and reset with the epoch", async () => {
  const bridge = new FakeBridge();
  const many = Array.from({length:300},(_,i)=>({...rows()[0],seq:i+1,source_s:1000+i/100,data:{actors:[actor]}}));
  bridge.pages.push(bridge.page(many));
  const source = createLiveSource(bridge,{clock:bridge.clock});
  try {
    const {watch}=source.watch(); await settle(); const a=source.poll(watch,undefined,"full");
    expect(a.actors).toHaveLength(LIVE_BOUNDS.pollRows); expect(a.more).toBe(true);
    const b=source.poll(watch,a.since,"full"); expect(b.actors).toHaveLength(44); expect(b.more).toBe(false);
    expect(source.poll(watch,{...b.since,epoch:-1},"full").reset).toBe(true);
  } finally {source.close();}
});

const actorRow = (seq: number, t: number) => ({ session: "abc123", run: 1, world_generation: 1,
  channel: "actors", seq, source_s: t, valid: true, data: { actors: [actor] } });
const failedActors = { ...actorRow(2, 1000.1), valid: false, data: { error: "sample_failed" } };
test("replay keeps a failed actors read as channel invalidation and counts it as invalid", () => {
  fixture = writeFixture();
  const path = join(fixture.dir, "manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.channels = ["actors"]; writeFileSync(path, JSON.stringify(manifest));
  writeFileSync(join(fixture.dir, "chunk-1.jsonl"), [actorRow(1, 1000), failedActors, actorRow(3, 1000.2)].map(r => JSON.stringify(r)).join("\n") + "\n");
  const s = readRun(fixture.dir);
  expect(s.actors?.map(a => a.t)).toEqual([1000, 1000.2]);
  expect(s.gaps).toEqual([{ from: 1000.1, to: 1000.1, fromSeq: 2, toSeq: 2, channel: "actors", reason: "invalid" }]);
  expect(s.meta.channels).toEqual([{ name: "actors", read: 3, kept: 2, dropped: 1, reasons: { invalid: 1 } }]);
});
test("live publishes a failed actors read at the tail, before recovery and without V", async () => {
  const bridge = new FakeBridge(); bridge.recorder.channels = ["actors"];
  bridge.pages.push(bridge.page([actorRow(1, 1000)]), bridge.page([failedActors]), bridge.page([actorRow(3, 1000.2)]));
  const source = createLiveSource(bridge, { clock: bridge.clock });
  try {
    const { watch } = source.watch(); await settle();
    const first = source.poll(watch, undefined, "full");
    await bridge.clock.advance(1000);
    const failure = source.poll(watch, first.since, "full");
    expect(failure.actors).toEqual([]);
    expect(failure.gaps).toMatchObject([{ from: 1000.1, to: 1000.1, channel: "actors", reason: "invalid" }]);
    expect(failure.meta!.channels).toEqual([{ name: "actors", read: 2, kept: 1, dropped: 1, reasons: { invalid: 1 } }]);
    await bridge.clock.advance(1000);
    const recovery = source.poll(watch, failure.since, "full");
    expect(recovery.actors).toHaveLength(1); expect(recovery.gaps).toEqual([]);
    expect(recovery.meta!.channels[0]).toMatchObject({ read: 3, kept: 2, dropped: 1 });
  } finally { source.close(); }
});
for (const invalidV of [false, true]) test(`live sequence breaks precede actors on ${invalidV ? "invalid-V" : "actors-only"} pages`, async () => {
  const bridge = new FakeBridge(); bridge.recorder.channels = invalidV ? ["actors", "v"] : ["actors"];
  bridge.pages.push(bridge.page([actorRow(1, 1000)]), bridge.page([
    ...(invalidV ? [{ ...actorRow(3, 1000.1), channel: "v", valid: false, data: {} }] : []),
    actorRow(invalidV ? 4 : 3, 1000.2),
  ]));
  const source = createLiveSource(bridge, { clock: bridge.clock });
  try {
    const { watch } = source.watch(); await settle(); const first = source.poll(watch, undefined, "full");
    await bridge.clock.advance(1000); const next = source.poll(watch, first.since, "full");
    expect(next.v).toEqual([]); expect(next.actors).toHaveLength(1);
    expect(next.gaps).toMatchObject([{ from: 1000, to: 1000.2, channel: "actors", reason: "sequence" }]);
  } finally { source.close(); }
});
test("actor breaks cannot be bypassed by actor deltas under the poll row budget", async () => {
  const bridge = new FakeBridge(); bridge.recorder.channels = ["actors"];
  bridge.pages.push(bridge.page(Array.from({ length: 300 }, (_, i) => actorRow(2 * i + 1, 1000 + i / 100))));
  const source = createLiveSource(bridge, { clock: bridge.clock });
  try {
    const { watch } = source.watch(); await settle();
    const first = source.poll(watch, undefined, "full");
    expect(first.gaps).toHaveLength(LIVE_BOUNDS.pollRows); expect(first.actors).toEqual([]);
    const second = source.poll(watch, first.since, "full");
    expect(first.gaps.length + second.gaps.length).toBe(299);
    expect(second.actors.length).toBeGreaterThan(0);
    expect(second.gaps.length + second.actors.length).toBe(LIVE_BOUNDS.pollRows);
  } finally { source.close(); }
});
