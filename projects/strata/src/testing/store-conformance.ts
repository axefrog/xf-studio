/**
 * The store conformance suite (SPEC §19): the cases every `GraphStore` passes, the in-memory store and an app's
 * adapter alike. Framework-free: each case throws on failure; a test file runs them.
 */
import { canonical, equal } from "../json";
import type { GraphStore } from "../store";
import type { Entry, NodeRef, Snapshot } from "../types";

export type StoreCase = { readonly name: string; run(make: () => Promise<GraphStore>): Promise<void> };

const A: NodeRef = { type: "item", id: "00000000-0000-4000-8000-00000000000a" };
const B: NodeRef = { type: "item", id: "00000000-0000-4000-8000-00000000000b" };
const state = (title: string) => ({ name: title, own: { [JSON.stringify(["title"])]: title }, layers: [], trashed: false, retracted: false });

let counter = 0;
/** An entry as a graph would send it (the store assigns `pos`). */
export function sampleEntry(node: NodeRef, seq: number, commit: string, extra: Partial<Entry> = {}): Entry {
  return { node, seq, pos: 0, commit, actor: "local", actorSeq: ++counter, at: 1_767_225_600_000 + seq, schema: "2",
    op: seq === 1 ? { kind: "create", state: state(`${node.id.slice(-1)}${seq}`) } : { kind: "set", path: ["title"], value: `${node.id.slice(-1)}${seq}` },
    ...extra };
}

const fail = (message: string): never => { throw new Error(message); };
const same = (a: unknown, b: unknown, what: string) => { if (!equal(a, b)) fail(`${what}: got ${canonical(a)}, expected ${canonical(b)}`); };
const strip = (entry: Entry) => { const { pos: _pos, ...rest } = entry; return rest; };

async function appendOk(store: GraphStore, commit: string, entries: Entry[], expect: [string, number][]) {
  const result = await store.append({ commit, entries, expect });
  if (!result.ok) fail(`append ${commit} was refused`);
  return (result as { positions: readonly number[] }).positions;
}

export const STORE_CASES: readonly StoreCase[] = [
  { name: "appends assign increasing positions in order, and entries round-trip exactly", async run(make) {
    const store = await make();
    const rich = sampleEntry(A, 1, "c1", { meta: { label: "Make", basis: [[A.id, 0]], scope: "default" },
      provenance: { actor: "game", actorSeq: 7, at: 5, kind: "hair" } });
    const p1 = await appendOk(store, "c1", [rich, sampleEntry(B, 1, "c1")], [[A.id, 0], [B.id, 0]]);
    const p2 = await appendOk(store, "c2", [sampleEntry(A, 2, "c2")], [[A.id, 1]]);
    if (!(p1[0] < p1[1] && p1[1] < p2[0])) fail(`positions ${canonical([...p1, ...p2])} are not increasing`);
    const stream = await store.readStream(A);
    same(stream.map(strip), [strip(rich), strip(sampleEntry(A, 2, "c2", { actorSeq: stream[1].actorSeq }))], "stream A");
    same(stream.map(entry => entry.pos), [p1[0], p2[0]], "positions of A");
    same((await store.readStream(A, 1)).map(entry => entry.seq), [2], "stream A after 1");
  } },
  { name: "a stale append is refused whole, and nothing is written", async run(make) {
    const store = await make();
    await appendOk(store, "c1", [sampleEntry(A, 1, "c1")], [[A.id, 0]]);
    const before = await store.counter();
    const result = await store.append({ commit: "c2", entries: [sampleEntry(A, 2, "c2"), sampleEntry(B, 1, "c2")], expect: [[A.id, 0], [B.id, 0]] });
    same(result, { ok: false, reason: "stale", nodes: [A.id] }, "stale result");
    same((await store.readStream(B)).length, 0, "B untouched");
    same(await store.counter(), before, "counter untouched");
  } },
  { name: "appends are idempotent by commit ID", async run(make) {
    const store = await make();
    const first = await appendOk(store, "c1", [sampleEntry(A, 1, "c1")], [[A.id, 0]]);
    const again = await store.append({ commit: "c1", entries: [sampleEntry(A, 1, "c1")], expect: [[A.id, 0]] });
    same(again.ok && again.positions, first, "positions of the repeated commit");
    same((await store.readStream(A)).length, 1, "entries after a repeat");
  } },
  { name: "changes since a position come in position order", async run(make) {
    const store = await make();
    const [p1] = await appendOk(store, "c1", [sampleEntry(A, 1, "c1")], [[A.id, 0]]);
    await appendOk(store, "c2", [sampleEntry(B, 1, "c2")], [[B.id, 0]]);
    await appendOk(store, "c3", [sampleEntry(A, 2, "c3")], [[A.id, 1]]);
    const changes = await store.changesSince(p1);
    same(changes.entries.map(entry => entry.commit), ["c2", "c3"], "changes");
    same(changes.head, changes.entries[1].pos, "head");
  } },
  { name: "load returns each node's latest snapshot and the entries after it", async run(make) {
    const store = await make();
    await appendOk(store, "c1", [sampleEntry(A, 1, "c1")], [[A.id, 0]]);
    const [p2] = await appendOk(store, "c2", [sampleEntry(A, 2, "c2")], [[A.id, 1]]);
    await appendOk(store, "c3", [sampleEntry(A, 3, "c3")], [[A.id, 2]]);
    const snapshot: Snapshot = { node: A, seq: 2, pos: p2, schema: "2", state: state("a2") };
    await store.putSnapshot(snapshot);
    const loaded = await store.load();
    const node = loaded.nodes.find(item => item.ref.id === A.id)!;
    same(node.snapshot, snapshot, "snapshot");
    same(node.tail.map(entry => entry.seq), [3], "tail");
    await store.dropSnapshots(A);
    same((await store.load()).nodes.find(item => item.ref.id === A.id)!.tail.length, 3, "tail without a snapshot");
  } },
  { name: "compaction replaces entries up to the last given, keeps later ones and drops snapshots", async run(make) {
    const store = await make();
    for (let seq = 1; seq <= 4; seq++) await appendOk(store, `c${seq}`, [sampleEntry(A, seq, `c${seq}`)], [[A.id, seq - 1]]);
    const stream = await store.readStream(A);
    await store.putSnapshot({ node: A, seq: 3, pos: stream[2].pos, schema: "2", state: state("a3") });
    const rolled: Entry = { ...stream[2], op: { kind: "state", state: state("a3") } };
    await store.compact(A, [rolled], 99);
    same((await store.readStream(A)).map(entry => [entry.seq, entry.op.kind]), [[3, "state"], [4, "set"]], "compacted stream");
    same((await store.load()).nodes.find(item => item.ref.id === A.id)!.snapshot, undefined, "snapshot after compaction");
  } },
  { name: "purge removes the stream, its snapshot and its index row", async run(make) {
    const store = await make();
    await appendOk(store, "c1", [sampleEntry(A, 1, "c1"), sampleEntry(B, 1, "c1")], [[A.id, 0], [B.id, 0]]);
    await store.putSnapshot({ node: A, seq: 1, pos: 1, schema: "2", state: state("a1") });
    const before = await store.counter();
    await store.purge(A);
    same((await store.readStream(A)).length, 0, "purged stream");
    same((await store.list()).map(row => row.ref.id), [B.id], "index");
    same((await store.load()).nodes.map(node => node.ref.id), [B.id], "load");
    same((await store.changesSince(0)).entries.map(entry => entry.node.id), [B.id], "changes");
    if (!((await store.counter()) > before)) fail("the counter didn't move on purge");
  } },
  { name: "positions are never reissued: after a purge of the newest entries, appends continue above them and the head never falls", async run(make) {
    const store = await make();
    await appendOk(store, "c1", [sampleEntry(B, 1, "c1")], [[B.id, 0]]);
    const [a1, a2] = await appendOk(store, "c2", [sampleEntry(A, 1, "c2"), sampleEntry(A, 2, "c2")], [[A.id, 0]]);
    const headBefore = (await store.changesSince(0)).head;
    same(headBefore, a2, "head before the purge");
    await store.purge(A);
    const after = await store.changesSince(0);
    if (after.head < headBefore) fail(`the head fell from ${headBefore} to ${after.head} after a purge`);
    if ((await store.load()).head < headBefore) fail("load's head fell after a purge");
    const [b2] = await appendOk(store, "c3", [sampleEntry(B, 2, "c3")], [[B.id, 1]]);
    if (!(b2 > a2)) fail(`position ${b2} was reissued (the purged entries had ${a1} and ${a2})`);
    // A window that had read up to the purged entries still sees the new one.
    same((await store.changesSince(a2)).entries.map(entry => entry.commit), ["c3"], "changes since the purged head");
    same((await store.changesSince(a1)).entries.map(entry => entry.commit), ["c3"], "changes since a purged position");
  } },
  { name: "the index lists each node's head seq, name and trash state", async run(make) {
    const store = await make();
    await appendOk(store, "c1", [sampleEntry(A, 1, "c1")], [[A.id, 0]]);
    await appendOk(store, "c2", [sampleEntry(A, 2, "c2", { op: { kind: "rename", name: "Renamed" } }), sampleEntry(A, 3, "c2", { op: { kind: "trash" } })], [[A.id, 1]]);
    same((await store.list()).map(row => [row.ref.id, row.headSeq, row.name, row.trashed]), [[A.id, 3, "Renamed", true]], "index row");
  } },
];
