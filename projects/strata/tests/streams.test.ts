/** Event sourcing over a store (design §2.8, G1): persistence, snapshots, time, pins, compaction, purge, upcasting, recovery. */
import { expect, test } from "bun:test";
import { Aborter, createGraph, fold, MemoryStore, pathKey } from "strata";
import type { Entry, NodeRef } from "strata";
import { checkConsistentCut, checkSnapshots, sampleEntry, Scheduler, seededRandom, simClock, SimStore, SYNTHETIC_RULES, SYNTHETIC_TYPES } from "strata/testing";
import { create, drive, harness, ok } from "./helpers";
import { ITEM, itemType } from "../src/testing/synthetic";

test("commits reach the store in order; a new graph loads the same values from snapshots and tails", async () => {
  const h = harness({ store: true, extra: { snapshotEvery: 3 } });
  await drive(h.scheduler, h.graph.load());
  const a = create(h.graph, ITEM, { title: "a" });
  for (let i = 0; i < 7; i++) ok(h.graph.commit([{ op: "set", node: a, path: ["tags", `k${i}`], value: i }]));
  expect(h.graph.pending().length).toBe(8);
  await drive(h.scheduler, h.graph.flush());
  expect(h.graph.pending()).toEqual([]);
  await drive(h.scheduler, h.graph.snapshotAll());
  expect(checkSnapshots(h.memory!, SYNTHETIC_TYPES)).toEqual([]);
  expect(h.memory!.snapshotOf(a)?.seq).toBe(8);
  const again = createGraph({ types: SYNTHETIC_TYPES, rules: SYNTHETIC_RULES, sources: { clock: simClock(h.scheduler), random: seededRandom("again") }, store: h.store });
  const loaded = await drive(h.scheduler, again.load());
  expect(loaded.entries).toBe(0);   // everything came from the snapshot
  expect(again.resolve(a)).toEqual(h.graph.resolve(a));
  // History before the snapshot loads on demand.
  expect((await drive(h.scheduler, again.history(a))).length).toBe(8);
});

test("a view at T is a consistent cut: it equals replaying every stream from empty to T", async () => {
  const h = harness({ store: true });
  await drive(h.scheduler, h.graph.load());
  const a = create(h.graph, ITEM, { title: "a" });
  const b = ok(h.graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: a } }])).created.b;
  ok(h.graph.commit([{ op: "feed", node: b, from: create(h.graph, ITEM, { tags: { f: 1 } }), paths: [["tags"]] }]));
  ok(h.graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }, { op: "set", node: b, path: ["tags", "z"], value: 9 }]));
  await drive(h.scheduler, h.graph.flush());
  const entries = h.memory!.allEntries();
  for (const pos of [1, 2, 3, entries.length - 1, entries.length]) {
    expect(await drive(h.scheduler, checkConsistentCut(h.graph, SYNTHETIC_TYPES, entries, pos))).toEqual([]);
  }
  const past = await drive(h.scheduler, h.graph.at(1));
  expect(past.resolve(a, ["title"])).toBe("a");
  expect(past.exists(b)).toBe(false);
});

test("a fork pinned to an entry ignores its base's later entries; unpinning follows live again", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "v1" });
  ok(graph.commit([{ op: "set", node: base, path: ["title"], value: "v2" }]));
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: base, at: 1 } }])).created.p;
  ok(graph.commit([{ op: "set", node: base, path: ["title"], value: "v3" }]));
  expect(graph.resolve(pinned, ["title"])).toBe("v1");
  ok(graph.commit([{ op: "rebase", node: pinned, base }]));
  expect(graph.resolve(pinned, ["title"])).toBe("v3");
});

test("compaction keeps the latest and every referenced entry, rolls up the rest, and leaves folds unchanged", async () => {
  const h = harness({ store: true });
  await drive(h.scheduler, h.graph.load());
  const a = create(h.graph, ITEM, { title: "t0" });
  for (let i = 1; i <= 40; i++) {
    ok(h.graph.commit([{ op: "set", node: a, path: ["title"], value: `t${i}` }]));
    h.scheduler.now += 100;   // ten commits a second
  }
  ok(h.graph.commit([{ op: "tag", node: a, label: "Keep this version", entries: [{ node: a, seq: 12 }] }]));
  const pinner = ok(h.graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 25 } }])).created.p;
  const referrer = create(h.graph, ITEM, { link: a });
  await drive(h.scheduler, h.graph.flush());
  const before = [...h.memory!.readStreamNow(a)];
  const foldAt = (entries: readonly Entry[], seq: number) => fold(null, entries.filter(entry => entry.seq <= seq), itemType);
  // This session's undo stack would keep its commits; compaction here is about references only.
  h.graph.forgetHistory();
  const result = await drive(h.scheduler, h.graph.compact(a));
  expect(result).toMatchObject({ ok: true, before: 42 });
  const after = h.memory!.readStreamNow(a);
  const seqs = after.map(entry => entry.seq);
  expect(seqs).toContain(12);   // tagged
  expect(seqs).toContain(25);   // pinned
  expect(seqs).toContain(42);   // latest (the tag)
  expect(after.length).toBeLessThan(15);
  for (const seq of seqs) expect(foldAt(after, seq)).toEqual(foldAt(before, seq));
  expect(h.graph.resolve(pinner, ["title"])).toBe("t24");
  expect(h.graph.resolve(referrer, ["link"])).toEqual(a);
  expect(h.memory!.compactions.map(item => item.node.id)).toEqual([a.id]);
});

test("inline collapse happens only when exactly one entry references the stream", async () => {
  const h = harness({ store: true });
  await drive(h.scheduler, h.graph.load());
  const session = create(h.graph, ITEM, { title: "recording" });
  const host = create(h.graph, ITEM, { title: "host", link: session });
  const second = create(h.graph, ITEM, { title: "second", link: session });
  const refused = await drive(h.scheduler, h.graph.collapseInline(session));
  expect(refused).toMatchObject({ ok: false });
  ok(h.graph.commit([{ op: "reset", node: second, path: ["link"] }]));
  await drive(h.scheduler, h.graph.flush());
  // The reset entry doesn't reference it, but second's create entry still does: two referrers.
  expect(await drive(h.scheduler, h.graph.collapseInline(session))).toMatchObject({ ok: false });
  await drive(h.scheduler, h.graph.purge(second));
  const collapsed = await drive(h.scheduler, h.graph.collapseInline(session));
  expect(collapsed).toMatchObject({ ok: true, host: { node: host } });
  expect(h.memory!.readStreamNow(session)).toEqual([]);
  expect(h.graph.resolve(session, ["title"])).toBe("recording");
  expect(h.memory!.readStreamNow(host)[0].inlined?.[0].node).toEqual(session);
});

test("purge leaves no row naming the node; references to it read as missing", async () => {
  const h = harness({ store: true, extra: { snapshotEvery: 1 } });
  await drive(h.scheduler, h.graph.load());
  const a = create(h.graph, ITEM, { title: "a" });
  const b = create(h.graph, ITEM, { link: a });
  await drive(h.scheduler, h.graph.flush());
  await drive(h.scheduler, h.graph.snapshotAll());
  expect(await drive(h.scheduler, h.graph.purge(a))).toEqual({ ok: true });
  // No row of the node remains; other streams keep referring to it by ID only.
  expect(h.memory!.allEntries().filter(entry => entry.node.id === a.id)).toEqual([]);
  expect(h.memory!.listNow().map(row => row.ref.id)).toEqual([b.id]);
  expect(h.memory!.snapshotOf(a)).toBeUndefined();
  expect(h.graph.conflicts(b).map(item => item.rule)).toEqual(["missing-ref"]);
});

test("a stream written in an older schema upcasts on read and folds to its recorded values", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore();
  const node: NodeRef = { type: ITEM, id: "00000000-0000-4000-8000-000000000123" };
  // A fixture stream of schema 1 (the title was called `name`), then one entry of schema 2.
  const v1 = (seq: number, op: Entry["op"]) => sampleEntry(node, seq, `c${seq}`, { schema: "1", op });
  memory.appendNow({ commit: "c1", expect: [[node.id, 0]], entries: [v1(1, { kind: "create", state: { name: "Old", own: { [pathKey(["name"])]: "first" }, layers: [], trashed: false, retracted: false } })] });
  memory.appendNow({ commit: "c2", expect: [[node.id, 1]], entries: [v1(2, { kind: "set", path: ["name"], value: "second" })] });
  memory.appendNow({ commit: "c3", expect: [[node.id, 2]], entries: [sampleEntry(node, 3, "c3", { op: { kind: "set", path: ["tags", "n"], value: 1 } })] });
  const graph = createGraph({ types: SYNTHETIC_TYPES, sources: { clock: simClock(scheduler), random: seededRandom("u") }, store: new SimStore(memory, scheduler) });
  await drive(scheduler, graph.load());
  expect(graph.resolve(node)).toEqual({ title: "second", tags: { base: 1, n: 1 }, meta: {} });
  // Stored entries are never rewritten.
  expect(memory.readStreamNow(node).map(entry => entry.schema)).toEqual(["1", "1", "2"]);
});

test("a commit another window made stale is rolled back and kept as rejected; a restart recovers pending work", async () => {
  const h = harness({ store: true });
  await drive(h.scheduler, h.graph.load());
  const a = create(h.graph, ITEM, { title: "a" });
  await drive(h.scheduler, h.graph.flush());
  const other = createGraph({ types: SYNTHETIC_TYPES, sources: { clock: simClock(h.scheduler), random: seededRandom("other") }, store: h.store });
  await drive(h.scheduler, other.load());
  ok(other.commit([{ op: "set", node: a, path: ["title"], value: "theirs" }]));
  await drive(h.scheduler, other.flush());
  ok(h.graph.commit([{ op: "set", node: a, path: ["title"], value: "mine" }]));
  await drive(h.scheduler, h.graph.flush());
  expect(h.graph.rejected().map(item => item.reason)).toEqual(["stale"]);
  expect(h.graph.resolve(a, ["title"])).toBe("a");
  await drive(h.scheduler, h.graph.sync());
  expect(h.graph.resolve(a, ["title"])).toBe("theirs");

  // A crash with work pending: the recovery copy brings it back.
  let recovery: readonly import("strata").PendingCommit[] = [];
  const life = new Aborter();
  h.graph.subscribePending(pending => { recovery = pending; }, { signal: life.signal });
  ok(h.graph.commit([{ op: "set", node: a, path: ["tags", "late"], value: 1 }]));
  expect(recovery.length).toBe(1);
  h.life.abort("crash");
  h.scheduler.drop();
  const restarted = createGraph({ types: SYNTHETIC_TYPES, sources: { clock: simClock(h.scheduler), random: seededRandom("restart") }, store: h.store });
  await drive(h.scheduler, restarted.load());
  expect(restarted.recover(recovery)).toEqual({ applied: 1, skipped: 0, rejected: 0 });
  await drive(h.scheduler, restarted.flush());
  expect(h.memory!.readStreamNow(a).at(-1)!.op).toEqual({ kind: "set", path: ["tags", "late"], value: 1 });
});
