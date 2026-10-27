import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRun } from "../../../xf-holotable/src/recording";
import { createLiveSource } from "../../../xf-holotable/src/live";
import { FakeBridge, settle } from "../../../xf-holotable/tests/live-fake";
import { writeFixture } from "../../../xf-holotable/tests/fixture";
import { createHolotable } from "../src/features/holotable/service";
import type { HoloActorSample, HoloGap, HoloSession } from "../src/features/holotable/types";
import { ORBITS, peopleAt, project, trail } from "../src/features/holotable/view/projection";

const world = { provenance: null, areas: [], cells: [] };
const layers = { v: false, camera: false, people: true, events: false, gaps: false, areas: false, cells: false, solids: false };
const person = (t: number): HoloActorSample => ({ t, who: "a1", valid: true, entity: "42", position: [t - 1000, 0, 0] });
const scene = (s: HoloSession, t: number) => project(s, world, t, layers, ORBITS.tilt, 800, 500, null).primitives;
const markers = (s: HoloSession, t: number) => scene(s, t).filter(p => p.kind === "marker" && p.style === "people");
const lines = (s: HoloSession, t: number) => scene(s, t).filter(p => p.kind === "line" && p.style === "people");

for (const mode of ["replay", "live"] as const) test(`${mode}: a failed actors channel hides the dot immediately and never joins the recovered trail`, async () => {
  const rows = [1000, 1000.1, 1000.2].map((t, i) => ({ session: "abc123", run: 1, world_generation: 1,
    seq: i + 1, source_s: t, channel: "actors", valid: i !== 1,
    data: i === 1 ? { error: "sample_failed" } : { actors: [person(t)] } }));
  const fixture = mode === "replay" ? writeFixture() : undefined;
  const bridge = new FakeBridge(); bridge.recorder.channels = ["actors"];
  const source = createLiveSource(bridge, { clock: bridge.clock });
  try {
    let s: HoloSession;
    if (fixture) {
      const path = join(fixture.dir, "manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.channels = ["actors"]; writeFileSync(path, JSON.stringify(manifest));
      writeFileSync(join(fixture.dir, "chunk-1.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
      s = readRun(fixture.dir);
    } else {
      bridge.pages.push(bridge.page(rows.slice(0, 2)), bridge.page(rows.slice(2)));
      const { watch } = source.watch(); await settle();
      const update = source.poll(watch, undefined, "full");
      s = { meta: update.meta!, v: update.v, camera: update.camera, events: update.events, actors: update.actors, gaps: update.gaps };
      expect(markers(s, 1000.1)).toHaveLength(0); // Failure at the live tail, before recovery exists.
      await bridge.clock.advance(1000);
      const recovery = source.poll(watch, update.since, "full");
      s = { ...s, actors: [...s.actors!, ...recovery.actors], gaps: [...s.gaps, ...recovery.gaps] };
    }
    expect(markers(s, 1000)).toHaveLength(1);
    expect(markers(s, 1000.1)).toHaveLength(0);
    expect(peopleAt(s, 1000.1).get("a1")?.at(-1)?.valid).toBe(false);
    expect(markers(s, 1000.2)).toHaveLength(1);
    expect(lines(s, 1000.2)).toHaveLength(0);
    expect(s.meta.channels[0]).toMatchObject({ read: mode === "replay" ? 3 : 2, dropped: 1, reasons: { invalid: 1 } });
  } finally { source.close(); fixture?.dispose(); }
});

test("People gap work is indexed once and frames visit only recent intervals, with long past and future history", () => {
  let reads = 0;
  const counted = (from: number, to: number): HoloGap => ({ get from() { reads++; return from; },
    get to() { reads++; return to; }, reason: "sequence" });
  const recent: HoloGap[] = [{ from: 8990, to: 9002, reason: "missing" }, // Spans the window boundary.
    { from: 8999, to: 8999, reason: "sequence" }, // Nested: endpoint order alone cannot find the spanning interval.
    { from: 9004.05, to: 9004.15, reason: "sequence" }];
  const gaps = [...Array.from({ length: 8900 }, (_, i) => counted(i, i + 0.1)), ...recent,
    ...Array.from({ length: 8900 }, (_, i) => counted(10000 + i, 10000 + i + 0.1))];
  const actors = Array.from({ length: 51 }, (_, i) => Array.from({ length: 16 }, (_, who) => ({
    ...person(9000 + i / 10), who: `a${who}`, position: [i, who, 0] as const,
  }))).flat(); // 800 trail segments.
  const s: HoloSession = { meta: { session: "synthetic", run: 1, start: 0, end: 20000, from: 0, to: 20000,
    channels: [], complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 0, coverage: "synthetic", problems: [] },
    v: [], camera: [], events: [], actors, gaps };
  const expected = scene({ ...s, gaps: recent }, 9005);
  expect(scene(s, 9005)).toEqual(expected);
  expect(reads).toBeLessThan(4 * gaps.length); // One index build, not 800 history scans.
  reads = 0;
  for (const t of [9004.8, 9005, 9005.1]) expect(scene(s, t)).toEqual(scene({ ...s, gaps: recent }, t));
  expect(reads).toBe(0); // Subsequent frames never revisit the raw history.
});

test("actor-only invalidations leave V's trail intact, including a live append to the same gap array", () => {
  const gaps: HoloGap[] = [];
  const sample = (t: number) => ({ t, seq: t, position: [0, 0, 0] as const, yaw: 0, speed: 0, health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: "" });
  const s: HoloSession = { meta: {} as HoloSession["meta"], v: [sample(1000), sample(1000.1)], camera: [], events: [],
    actors: [person(1000)], gaps };
  expect(markers(s, 1000.1)).toHaveLength(1);
  gaps.push({ from: 1000.1, to: 1000.1, channel: "actors", reason: "invalid" });
  expect(markers(s, 1000.1)).toHaveLength(0);
  expect(trail(s, 1000.1)).toHaveLength(1);
});

test("hiding People clears its selection permanently and leaves selections from other layers alone", async () => {
  const ctl = new AbortController();
  const s: HoloSession = { meta: { session: "synthetic", run: 1, start: 1000, end: 1001, from: 1000, to: 1001,
    channels: [], complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 0, coverage: "synthetic", problems: [] },
    v: [], camera: [], actors: [person(1000)], events: [], gaps: [] };
  const service = createHolotable({ later: () => () => {}, transport: async method => ({ ok: true, status: 200, data: { ok: true,
    result: method === "runs.list" ? [{ session: "synthetic", run: 1, dir: "run", start: 1000, end: 1001 }]
      : method === "session.open" ? s : method === "layers.watch" ? { watch: "synthetic" } : world } }) }, ctl.signal);
  try {
    await service.dispatch({ kind: "holo.refresh" }); await service.dispatch({ kind: "holo.open", dir: "run" });
    await service.dispatch({ kind: "holo.layer", id: "people", on: true });
    await service.dispatch({ kind: "holo.select", id: "person:a1" });
    await service.dispatch({ kind: "holo.layer", id: "camera", on: false });
    expect(service.snapshot().selected).toBe("person:a1");
    await service.dispatch({ kind: "holo.layer", id: "people", on: false });
    expect(service.snapshot().selected).toBeNull();
    await service.dispatch({ kind: "holo.layer", id: "people", on: true });
    expect(service.snapshot().selected).toBeNull();
    await service.dispatch({ kind: "holo.select", id: "v" });
    await service.dispatch({ kind: "holo.layer", id: "people", on: false });
    expect(service.snapshot().selected).toBe("v");
  } finally { ctl.abort(); }
});
