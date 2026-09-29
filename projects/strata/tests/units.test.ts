/**
 * The pure parts, one behaviour per test: type declarations and field navigation, values a field accepts, folds and
 * upcasting, state differences, plain-data helpers, path masks, compaction primitives (references, keep sets,
 * rollups, inline collapse), the in-memory store's edges, sources and the job queue, trust and disagreement, and the
 * inspector's query language.
 */
import { expect, test } from "bun:test";
import { canonical, collapseInline, defineRule, defineSink, defineSource, defineType, entryReferences, equal, fold, JobQueue, keepSet, kindAt, MemoryStore,
  parseQuery, pathKey, resolveClaims, rollupDeltaStream, rollupValueStream, trustSelf, trustTable } from "strata";
import type { Entry, FieldKind, InspectorRow, Json, NodeRef, NodeState, Op, TypeSpec } from "strata";
import { sampleEntry } from "strata/testing";
import { copy, freeze, hash, isJson } from "../src/json";
import { covers, samePath, startsWith } from "../src/paths";
import { defaultAt, leafDepth, ownFromFields, valueProblem } from "../src/define";
import { diffStates, upcast } from "../src/fold";
import { nodeReferences } from "../src/compaction";
import { matches, page } from "../src/inspect";

const ref = (id: string, type = "item"): NodeRef => ({ type, id });
const state = (own: Record<string, Json> = {}, extra: Partial<NodeState> = {}): NodeState => ({ name: "", own, layers: [], trashed: false, retracted: false, ...extra });
let seq = 0;
const entry = (node: NodeRef, op: Op, extra: Partial<Entry> = {}): Entry =>
  ({ node, seq: ++seq, pos: seq, commit: `c${seq}`, actor: "local", actorSeq: seq, at: seq * 1000, schema: "1", op, ...extra });
const itemDef = defineType({ type: "item", owner: "t", schema: "1", fields: {
  title: { kind: "value" }, tags: { kind: "map", of: { kind: "value" } }, nested: { kind: "map", of: { kind: "map", of: { kind: "value" } } },
  link: { kind: "ref", to: "item", clone: "follow" }, list: { kind: "refs", to: ["item", "group"], clone: "share" }, any: { kind: "ref", to: "*", clone: "share" },
  pin: { kind: "entry" }, pins: { kind: "map", of: { kind: "entry" } },
} });

// ---------------------------------------------------------------------------------------------------------------
// Declarations and fields
// ---------------------------------------------------------------------------------------------------------------

test("a type declaration is checked: its name, owner and schema, its field names and kinds, map depth, reference targets and constants", () => {
  const fields = (kind: unknown) => ({ type: "t", owner: "o", schema: "1", fields: { f: kind as FieldKind } });
  expect(() => defineType({ ...fields({ kind: "value" }), type: "not a name" })).toThrow("not a plain identifier");
  expect(() => defineType({ ...fields({ kind: "value" }), owner: "" })).toThrow("needs an owner and a schema");
  expect(() => defineType({ ...fields({ kind: "value" }), schema: "" })).toThrow("needs an owner and a schema");
  expect(() => defineType({ type: "t", owner: "o", schema: "1", fields: { $f: { kind: "value" } } })).toThrow("may not start with $");
  expect(() => defineType(fields({ kind: "ref", to: "t", clone: "copy" }))).toThrow("clone must be follow or share");
  expect(() => defineType(fields({ kind: "refs", to: [], clone: "share" }))).toThrow("name the target types");
  expect(() => defineType(fields({ kind: "ref", to: 3, clone: "share" }))).toThrow("name the target types");
  expect(() => defineType(fields({ kind: "table" }))).toThrow("unknown field kind");
  let deep: FieldKind = { kind: "value" };
  for (let i = 0; i < 9; i++) deep = { kind: "map", of: deep };
  expect(() => defineType(fields(deep))).toThrow("nest at most 8 deep");
  let eight: FieldKind = { kind: "value" };
  for (let i = 0; i < 8; i++) eight = { kind: "map", of: eight };
  expect(defineType(fields(eight)).kind).toBe("strata/type");
  expect(() => defineType({ ...fields({ kind: "value" }), constants: [{ name: "c", label: "C", fields: {} }, { name: "c", label: "D", fields: {} }] })).toThrow("declares constant c twice");
  expect(() => defineRule({ id: "", owner: "o", subject: "*", severity: "notice", evaluate: () => [] })).toThrow();
  expect(() => defineRule({ id: "r", owner: "", subject: "*", severity: "notice", evaluate: () => [] })).toThrow();
});

test("field navigation: leaf paths, map levels, and paths that don't fit the type", () => {
  expect(kindAt(itemDef, [])).toBeNull();
  expect(kindAt(itemDef, ["nope"])).toBeNull();
  expect(kindAt(itemDef, ["title", "x"])).toBeNull();
  expect(kindAt(itemDef, ["tags", ""])).toBeNull();
  expect(kindAt(itemDef, ["tags", 3 as never])).toBeNull();
  expect(kindAt(itemDef, ["tags"])?.leaf).toBe(false);
  expect(kindAt(itemDef, ["nested", "a", "b"])?.leaf).toBe(true);
  expect(leafDepth(itemDef.fields.nested)).toBe(3);
  expect(leafDepth(itemDef.fields.title)).toBe(1);
  expect(defaultAt({ a: { b: 1 } }, ["a", "b"])).toBe(1);
  expect(defaultAt({ a: [1] }, ["a", "0"])).toBeUndefined();
  expect(defaultAt(undefined, ["a"])).toBeUndefined();
});

test("the values a field accepts", () => {
  const kinds = itemDef.fields as Record<string, FieldKind>;
  expect(valueProblem(kinds.title, 1)).toBeNull();
  expect(valueProblem(kinds.title, () => 1)).toBe("a plain JSON value");
  expect(valueProblem(kinds.pin, null)).toBeNull();
  expect(valueProblem(kinds.pin, { node: ref("a"), seq: 1 })).toBeNull();
  for (const bad of [{ node: ref("a"), seq: 0 }, { node: ref("a"), seq: 1.5 }, { node: ref("a"), seq: 1, extra: 1 }, { node: { id: "a" }, seq: 1 }, "x", [ref("a")]])
    expect(valueProblem(kinds.pin, bad)).toContain("entry reference");
  expect(valueProblem(kinds.link, null)).toBeNull();
  expect(valueProblem(kinds.link, ref("a"))).toBeNull();
  expect(valueProblem(kinds.link, ref("a", "group"))).toBe("a reference to item");
  expect(valueProblem(kinds.link, { type: "item", id: "a", more: 1 })).toBe("a reference to item");
  expect(valueProblem(kinds.link, [ref("a")])).toBe("a reference to item");
  expect(valueProblem(kinds.any, ref("a", "whatever"))).toBeNull();
  expect(valueProblem(kinds.list, [ref("a"), ref("b", "group")])).toBeNull();
  expect(valueProblem(kinds.list, [ref("a", "other")])).toBe("a list of references to item or group");
  expect(valueProblem(kinds.list, ref("a"))).toBe("a list of references to item or group");
  expect(valueProblem(kinds.tags, {})).toContain("keyed map");
  expect(ownFromFields(itemDef, { title: "t", tags: { a: 1, b: undefined }, nested: { x: { y: 2 } }, link: undefined })).toEqual({
    [pathKey(["title"])]: "t", [pathKey(["tags", "a"])]: 1, [pathKey(["nested", "x", "y"])]: 2 });
  expect(() => ownFromFields(itemDef, { tags: [1] })).toThrow("must be an object of keys");
  expect(() => ownFromFields(itemDef, { tags: null })).toThrow("must be an object of keys");
  expect(() => ownFromFields(itemDef, { link: 3 })).toThrow("must be a reference to item");
  expect(() => ownFromFields(itemDef, { nope: 1 })).toThrow("has no field nope");
});

// ---------------------------------------------------------------------------------------------------------------
// Folding, upcasting, differences
// ---------------------------------------------------------------------------------------------------------------

test("a fold ignores edits before creation, tags leave the state alone, and compensations and reverts apply their ops", () => {
  const node = ref("f");
  expect(fold(null, [entry(node, { kind: "set", path: ["title"], value: 1 }), entry(node, { kind: "compensate", reverses: [], ops: [{ kind: "trash" }] })])).toBeNull();
  const created = entry(node, { kind: "create", state: state({ [pathKey(["title"])]: "a" }) });
  const after = fold(null, [created, entry(node, { kind: "tag", label: "t", entries: [] }), entry(node, { kind: "untag", tag: 2 }),
    entry(node, { kind: "revert", to: { node, seq: 1 }, ops: [{ kind: "rename", name: "n" }, { kind: "retract" }] }),
    entry(node, { kind: "compensate", reverses: [], ops: [{ kind: "unretract" }, { kind: "trash" }, { kind: "restore" }, { kind: "tombstone", path: ["tags", "k"] }] })]);
  expect(after).toEqual({ name: "n", own: { [pathKey(["tags", "k"])]: { $strata: "tombstone" }, [pathKey(["title"])]: "a" }, layers: [], trashed: false, retracted: false });
  expect(Object.keys(after!.own)).toEqual([pathKey(["tags", "k"]), pathKey(["title"])]);
});

test("upcasting: a chain of steps, sets moved or dropped, compensations upcast inside, and states through both hooks", () => {
  const def: TypeSpec = { type: "u", owner: "t", schema: "3", fields: { title: { kind: "value" } }, upcasters: [
    { from: "1", to: "2", set: (path, value) => path[0] === "gone" ? null : { path: path[0] === "name" ? ["title"] : path, value } },
    { from: "2", to: "3", state: current => ({ ...current, name: `${current.name}!` }) },
  ] };
  const node = ref("u", "u");
  const set = (path: string[], schema = "1") => upcast(def, entry(node, { kind: "set", path, value: 1 }, { schema })).op;
  expect(set(["name"])).toEqual({ kind: "set", path: ["title"], value: 1 });
  expect(set(["gone"])).toEqual({ kind: "compensate", reverses: [], ops: [] });
  expect(upcast(def, entry(node, { kind: "rename", name: "x" }, { schema: "1" })).op).toEqual({ kind: "rename", name: "x" });
  expect(upcast(def, entry(node, { kind: "compensate", reverses: [], ops: [{ kind: "set", path: ["gone"], value: 1 }, { kind: "set", path: ["name"], value: 2 }, { kind: "trash" }] }, { schema: "1" })).op)
    .toEqual({ kind: "compensate", reverses: [], ops: [{ kind: "set", path: ["title"], value: 2 }, { kind: "trash" }] });
  const created = upcast(def, entry(node, { kind: "create", state: state({ [pathKey(["name"])]: "n", [pathKey(["gone"])]: 1 }, { name: "a" }) }, { schema: "1" }));
  expect(created.schema).toBe("3");
  expect((created.op as { state: NodeState }).state).toEqual(state({ [pathKey(["title"])]: "n" }, { name: "a!" }));
  // An entry of an unknown schema stops where the chain ends; the current schema and a type without upcasters pass through.
  expect(upcast(def, entry(node, { kind: "rename", name: "x" }, { schema: "0" })).schema).toBe("0");
  const current = entry(node, { kind: "rename", name: "x" }, { schema: "3" });
  expect(upcast(def, current)).toBe(current);
  expect(upcast({ ...def, upcasters: [] }, entry(node, { kind: "rename", name: "x" }))).toEqual(entry(node, { kind: "rename", name: "x" }, { seq, pos: seq, commit: `c${seq}`, actorSeq: seq, at: seq * 1000 }));
});

test("the ops between two states cover own values, layers, the name, trash and retraction both ways", () => {
  const layer = { from: ref("b"), role: "base" as const, paths: "*" as const };
  const k = (name: string) => pathKey([name]);
  expect(diffStates(state({ [k("a")]: 1, [k("b")]: 2 }), state({ [k("b")]: 3, [k("c")]: 4 }, { name: "n", layers: [layer], trashed: true, retracted: true }))).toEqual([
    { kind: "reset", path: ["a"] }, { kind: "set", path: ["b"], value: 3 }, { kind: "set", path: ["c"], value: 4 },
    { kind: "layers", layers: [layer] }, { kind: "rename", name: "n" }, { kind: "trash" }, { kind: "retract" }]);
  expect(diffStates(state({}, { trashed: true, retracted: true }), state())).toEqual([{ kind: "restore" }, { kind: "unretract" }]);
  expect(diffStates(state({ [k("a")]: 1 }), state({ [k("a")]: 1 }))).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Plain data and paths
// ---------------------------------------------------------------------------------------------------------------

test("plain data: canonical form, equality, copies, freezing, the plain-data test and the hash", () => {
  expect(() => canonical(Number.NaN)).toThrow("finite");
  expect(() => canonical({ a: [Infinity] })).toThrow("finite");
  expect(canonical(undefined)).toBe("null");
  expect(canonical({ b: 1, a: undefined, c: [undefined] })).toBe('{"b":1,"c":[null]}');
  expect(equal({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  expect(equal({ a: 1 }, { b: 1 })).toBe(false);
  expect(equal([1], { 0: 1 })).toBe(false);
  expect(equal([1, 2], [1])).toBe(false);
  expect(equal(null, {})).toBe(false);
  expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  const source = { a: [1, { b: 2 }], c: undefined, d: null };
  const copied = copy(source);
  expect(copied).toEqual({ a: [1, { b: 2 }], d: null } as never);
  expect("c" in copied).toBe(false);
  expect(copied.a).not.toBe(source.a);
  expect(copy(3)).toBe(3);
  expect(copy(null)).toBeNull();
  const frozen = freeze({ a: { b: [1] } });
  expect(Object.isFrozen(frozen.a.b)).toBe(true);
  expect(freeze(frozen)).toBe(frozen);
  expect(isJson({ a: [1, "x", true, null, { b: undefined }] })).toBe(true);
  expect(isJson(Object.create(null))).toBe(true);
  expect(isJson(new Date(0))).toBe(false);
  expect(isJson(() => 1)).toBe(false);
  expect(isJson(Number.POSITIVE_INFINITY)).toBe(false);
  expect(isJson("\udc00")).toBe(false);
  expect(isJson(undefined)).toBe(false);
  let deep: Json = 1;
  for (let i = 0; i < 70; i++) deep = [deep];
  expect(isJson(deep)).toBe(false);
  expect(hash("a")).toMatch(/^[0-9a-f]{14}$/);
  expect(hash("a")).not.toBe(hash("b"));
  expect(hash("a", 1)).not.toBe(hash("a"));
});

test("paths: prefixes, masks and sameness", () => {
  expect(startsWith(["a", "b"], ["a"])).toBe(true);
  expect(startsWith(["a"], ["a", "b"])).toBe(false);
  expect(startsWith(["a", "c"], ["a", "b"])).toBe(false);
  expect(covers("*", ["x"])).toBe(true);
  expect(covers([["a"], ["b", "c"]], ["b", "c", "d"])).toBe(true);
  expect(covers([["b", "c"]], ["b"])).toBe(false);
  expect(samePath(["a", "b"], ["a", "b"])).toBe(true);
  expect(samePath(["a"], ["a", "b"])).toBe(false);
  expect(samePath(["a", "c"], ["a", "b"])).toBe(false);
});

// ---------------------------------------------------------------------------------------------------------------
// Compaction primitives
// ---------------------------------------------------------------------------------------------------------------

test("the entries an entry references, and the nodes it references", () => {
  const a = ref("a"), b = ref("b");
  const pinLayer = { from: b, role: "base" as const, paths: "*" as const, at: { node: b, seq: 2 } };
  const created = entry(a, { kind: "create", state: state({ [pathKey(["pin"])]: { node: b, seq: 1 }, [pathKey(["pins", "x"])]: { node: b, seq: 3 },
    [pathKey(["title"])]: { node: b, seq: 9 }, [pathKey(["link"])]: b, [pathKey(["list"])]: [b, ref("c")], [pathKey(["nope"])]: 1 }, { layers: [pinLayer] }) });
  expect(entryReferences(created, itemDef).map(item => item.seq).sort()).toEqual([1, 2, 3]);
  expect(nodeReferences(created, itemDef).map(item => item.id).sort()).toEqual(["b", "b", "c"]);
  expect(entryReferences(entry(a, { kind: "set", path: ["pin"], value: { node: b, seq: 4 } }), itemDef)).toEqual([{ node: b, seq: 4 }]);
  expect(entryReferences(entry(a, { kind: "set", path: ["pin"], value: null }), itemDef)).toEqual([]);
  expect(entryReferences(entry(a, { kind: "set", path: ["title"], value: { node: b, seq: 4 } }), itemDef)).toEqual([]);
  expect(entryReferences(entry(a, { kind: "layers", layers: [pinLayer] }), undefined)).toEqual([{ node: b, seq: 2 }]);
  const compensation = entry(a, { kind: "compensate", reverses: [{ node: a, seq: 1 }], ops: [] });
  expect(entryReferences(compensation, itemDef)).toEqual([]);
  expect(entryReferences(compensation, itemDef, new Set([compensation.commit]))).toEqual([{ node: a, seq: 1 }]);
  expect(entryReferences(entry(a, { kind: "revert", to: { node: a, seq: 1 }, ops: [] }), itemDef)).toEqual([{ node: a, seq: 1 }]);
  const host = entry(a, { kind: "rename", name: "x" }, { inlined: [{ node: b, entries: [entry(b, { kind: "tag", label: "t", entries: [{ node: b, seq: 7 }] })] }] });
  expect(entryReferences(host, itemDef)).toEqual([{ node: b, seq: 7 }]);
  expect(nodeReferences(entry(a, { kind: "set", path: ["link"], value: b }), itemDef)).toEqual([b]);
  expect(nodeReferences(entry(a, { kind: "set", path: ["link"], value: null }), itemDef)).toEqual([]);
  expect(nodeReferences(entry(a, { kind: "set", path: ["list"], value: [b, 3] as never }), itemDef)).toEqual([b]);
  expect(nodeReferences(entry(a, { kind: "set", path: ["title"], value: b as never }), itemDef)).toEqual([]);
  expect(nodeReferences(entry(a, { kind: "set", path: ["link"], value: b }), undefined)).toEqual([]);
  expect(nodeReferences(entry(a, { kind: "rename", name: "x" }), itemDef)).toEqual([]);
  expect(nodeReferences(entry(a, { kind: "create", state: state({ [pathKey(["link"])]: b }) }), undefined)).toEqual([]);
});

test("keep sets: latest entries, live tags, undo reach, roots and references; rollups keep the fold at every kept entry", () => {
  const a = ref("ka"), b = ref("kb");
  const s = (node: NodeRef, n: number, op: Op, at = n * 1000) => entry(node, op, { seq: n, pos: n, at });
  const stream = [
    s(a, 1, { kind: "create", state: state({ [pathKey(["title"])]: 1 }) }),
    s(a, 2, { kind: "set", path: ["title"], value: 2 }, 1100),
    s(a, 3, { kind: "tag", label: "t", entries: [{ node: a, seq: 2 }] }, 1200),
    s(a, 4, { kind: "tag", label: "u", entries: [] }, 1300),
    s(a, 5, { kind: "untag", tag: 4 }, 5000),
    s(a, 6, { kind: "set", path: ["title"], value: 6 }, 6000),
    s(a, 7, { kind: "set", path: ["title"], value: 7 }, 6100),
    s(a, 8, { kind: "set", path: ["title"], value: 8 }, 9000),
  ];
  const keep = keepSet([{ ref: a, entries: stream }, { ref: b, entries: [] }], () => itemDef, { roots: [{ node: a, seq: 6 }], undoReach: new Set([stream[6].commit]) });
  expect([...keep].sort()).toEqual(["ka@2", "ka@3", "ka@6", "ka@7", "ka@8"]);
  expect([...keepSet([{ ref: a, entries: stream }], () => itemDef)].sort()).toEqual(["ka@2", "ka@3", "ka@8"]);
  expect(rollupValueStream(stream, new Set(["ka@3"])).map(item => item.seq)).toEqual([3, 8]);
  const rolled = rollupDeltaStream(itemDef, stream, new Set(["ka@3"]), 1000);
  // Before the kept tag, second 1's entries become one state; after it, the released tag and the untag change nothing
  // (their buckets emit nothing), and second 6's two sets become one state.
  expect(rolled.map(item => [item.seq, item.op.kind])).toEqual([[2, "state"], [3, "tag"], [7, "state"], [8, "set"]]);
  for (const kept of rolled) expect(fold(null, rolled.filter(item => item.seq <= kept.seq), itemDef)).toEqual(fold(null, stream.filter(item => item.seq <= kept.seq), itemDef));
  expect(rolled.every(item => item.op.kind !== "state" || !item.meta)).toBe(true);
  // The default bucket is a second; a type without a definition keeps each entry's schema.
  expect(rollupDeltaStream(itemDef, stream, new Set(["ka@3"]))).toEqual(rolled);
  expect(rollupDeltaStream(undefined, [stream[0], stream[1]], new Set())[0].schema).toBe("1");
});

test("inline collapse: refused without exactly one referrer or when an entry is referenced, carried by the one referrer otherwise", () => {
  const target = ref("t"), host = ref("h"), other = ref("o");
  const targetStream = { ref: target, entries: [entry(target, { kind: "create", state: state() })] };
  const refer = (node: NodeRef) => entry(node, { kind: "set", path: ["link"], value: target });
  expect(collapseInline([targetStream], () => itemDef, ref("absent"))).toEqual({ ok: false, referrers: 0, reason: "No such stream." });
  expect(collapseInline([targetStream], () => itemDef, target)).toEqual({ ok: false, referrers: 0, reason: "Nothing references it." });
  const two = collapseInline([targetStream, { ref: host, entries: [refer(host)] }, { ref: other, entries: [refer(other)] }], () => itemDef, target);
  expect(two.ok).toBe(false);
  const pinned = collapseInline([targetStream, { ref: host, entries: [refer(host), entry(host, { kind: "set", path: ["pin"], value: { node: target, seq: 1 } })] }], () => itemDef, target);
  expect(pinned).toEqual({ ok: false, referrers: 2, reason: "More than one entry references it." });
  const hostEntry = { ...refer(host), inlined: [{ node: other, entries: [] }] };
  const done = collapseInline([targetStream, { ref: host, entries: [hostEntry] }], () => itemDef, target);
  expect(done.ok && done.host.inlined!.map(item => item.node.id)).toEqual(["o", "t"]);
});

// ---------------------------------------------------------------------------------------------------------------
// The in-memory store's edges
// ---------------------------------------------------------------------------------------------------------------

test("the in-memory store: compacting an unknown stream does nothing, an empty compaction records seq 0, an older snapshot never replaces a newer, and purge drops the node's compaction records", async () => {
  const store = new MemoryStore();
  const a = ref("00000000-0000-4000-8000-00000000000a");
  await store.compact(ref("unknown"), [], 1);
  expect(store.compactions).toEqual([]);
  await store.append({ commit: "c1", entries: [sampleEntry(a, 1, "c1")], expect: [[a.id, 0]] });
  await store.append({ commit: "c2", entries: [sampleEntry(a, 2, "c2")], expect: [[a.id, 1]] });
  await store.compact(a, [], 5);
  expect(store.compactions.at(-1)).toEqual({ node: a, seq: 0, at: 5 });
  expect((await store.readStream(a)).length).toBe(2);
  const snapshot = { node: a, seq: 2, pos: 2, schema: "2", state: state({}, { name: "two" }) };
  await store.putSnapshot(snapshot);
  await store.putSnapshot({ ...snapshot, seq: 1, state: state({}, { name: "one" }) });
  expect(store.snapshotOf(a)?.seq).toBe(2);
  expect((await store.list())[0].name).toBe("two");
  await store.purge(a);
  expect(store.compactions).toEqual([]);
  expect(await store.list()).toEqual([]);
  // A stream whose entries were all purged lists nothing; an index row names a node with its head and no name when none is set.
  const b = ref("00000000-0000-4000-8000-00000000000b");
  await store.append({ commit: "c3", entries: [{ ...sampleEntry(b, 1, "c3"), op: { kind: "create", state: state() } }], expect: [[b.id, 0]] });
  expect((await store.list()).map(row => [row.headSeq, row.name])).toEqual([[1, ""]]);
});

// ---------------------------------------------------------------------------------------------------------------
// Sources, sinks and the job queue
// ---------------------------------------------------------------------------------------------------------------

test("sources and sinks are declared by plain names; a source keeps no ring unless asked", () => {
  expect(defineSource("clock-ticks")).toEqual({ kind: "strata/source", name: "clock-ticks", ring: 0 });
  expect(defineSource("input", { ring: 5 }).ring).toBe(5);
  expect(() => defineSource("not a name")).toThrow("not a plain identifier");
  expect(() => defineSource("1st")).toThrow("not a plain identifier");
  expect(defineSink("game", "*")).toEqual({ kind: "strata/sink", name: "game", types: "*" });
});

test("the job queue starts the person's jobs first, then background jobs in order, within its slots", () => {
  const queue = new JobQueue<string>();
  expect(queue.slots).toBe(1);
  expect(queue.take()).toBeUndefined();
  queue.push("b1", "background"); queue.push("b2", "background"); queue.push("u1", "user"); queue.push("u2", "user");
  expect(queue.take()).toBe("u1");
  expect(queue.take()).toBeUndefined();
  queue.done(); queue.done();
  expect(queue.running).toBe(0);
  expect([queue.take(), (queue.done(), queue.take()), (queue.done(), queue.take())]).toEqual(["u2", "b1", "b2"]);
  const wide = new JobQueue<string>(2);
  wide.push("x", "background"); wide.push("y", "background"); wide.push("z", "background");
  expect([wide.take(), wide.take(), wide.take()]).toEqual(["x", "y", undefined]);
  expect(wide.waiting.map(item => item.job)).toEqual(["z"]);
});

// ---------------------------------------------------------------------------------------------------------------
// Trust and disagreement
// ---------------------------------------------------------------------------------------------------------------

test("trust: self only by default; tables rank by kind or everything, fall back, and rank nobody else", () => {
  expect(trustSelf("me").rank("any", "me")).toBe(1);
  expect(trustSelf("me").rank("any", "you")).toBe(0);
  const table = trustTable({ hair: ["game", "studio"], "*": ["studio"] }, trustSelf("me"));
  expect([table.rank("hair", "game"), table.rank("hair", "studio"), table.rank("eyes", "studio"), table.rank("eyes", "game"), table.rank("hair", "me")]).toEqual([3, 2, 2, 0, 1]);
  const bare = trustTable({ hair: ["game"] });
  expect([bare.rank("eyes", "game"), bare.rank("hair", "nobody")]).toEqual([0, 0]);
});

test("resolving claims: the most trusted actor's latest claim, ties by ID, disagreement shown, and nothing when nobody is trusted", () => {
  const policy = trustTable({ "*": ["a", "b"] });
  const claim = (actor: string, value: Json, asOf: number) => ({ actor, value, asOf });
  const result = resolveClaims("f", [claim("b", 1, 5), claim("a", 2, 1), claim("a", 3, 2), claim("a", 4, 2)], policy);
  expect(result.value).toBe(4);
  expect(result.disagreement?.claims.map(item => item.actor)).toEqual(["a", "b"]);
  expect(result.disagreement?.trusted?.actor).toBe("a");
  expect(resolveClaims("f", [claim("a", 1, 1), claim("b", 1, 9)], policy).disagreement).toBeUndefined();
  // Equal ranks: the actor whose ID sorts first, whatever the order of the claims.
  const even = { rank: () => 1 };
  expect(resolveClaims("f", [claim("z", 1, 1), claim("m", 2, 1)], even).from?.actor).toBe("m");
  expect(resolveClaims("f", [claim("m", 2, 1), claim("z", 1, 1)], even).from?.actor).toBe("m");
  // Nobody trusted: no value; differing claims are still a disagreement, without a trusted one; agreeing ones are not.
  const none = { rank: () => 0 };
  const open = resolveClaims("f", [claim("x", 1, 1), claim("y", 2, 1)], none);
  expect(open.value).toBeUndefined();
  expect(open.disagreement && "trusted" in open.disagreement).toBe(false);
  expect(open.disagreement?.claims.map(item => item.actor)).toEqual(["x", "y"]);
  expect(resolveClaims("f", [claim("y", 1, 1), claim("x", 1, 1)], none).disagreement).toBeUndefined();
  expect(resolveClaims("f", [claim("x", 1, 1)], none)).toEqual({});
});

// ---------------------------------------------------------------------------------------------------------------
// The inspector's query language
// ---------------------------------------------------------------------------------------------------------------

test("inspector queries: words, facets, flags, severities and comparisons, with what isn't understood kept", () => {
  expect(parseQuery("  Red type:Item id:ab name:Hair is:TRASHED is:weird sev:warning sev:bad used:0 uses>2 depth>=3 depth<=4 used<9 uses=1 other:x a>b  ")).toEqual({
    words: ["red"], types: ["item"], ids: ["ab"], names: ["hair"], is: ["trashed"], severities: ["warning"],
    comparisons: [{ field: "used", op: "=", value: 0 }, { field: "uses", op: ">", value: 2 }, { field: "depth", op: ">=", value: 3 },
      { field: "depth", op: "<=", value: 4 }, { field: "used", op: "<", value: 9 }, { field: "uses", op: "=", value: 1 }],
    unknown: ["is:weird", "sev:bad", "other:x", "a>b"] });
  const row = (extra: Partial<InspectorRow>): InspectorRow => ({ ref: ref("abc"), name: "Red hair", constant: false, trashed: false, used: 0, uses: 1,
    layer: null, depth: 0, conflict: null, orphaned: false, seq: 1, ...extra });
  const hit = (text: string, extra: Partial<InspectorRow> = {}) => matches(row(extra), parseQuery(text));
  expect([hit("red"), hit("item"), hit("abc"), hit("blue")]).toEqual([true, true, true, false]);
  expect([hit("type:it"), hit("type:gr"), hit("id:ab"), hit("id:x"), hit("name:hair"), hit("name:eyes")]).toEqual([true, false, true, false, true, false]);
  expect([hit("is:trashed"), hit("is:trashed", { trashed: true }), hit("is:live"), hit("is:live", { trashed: true }), hit("is:constant"), hit("is:constant", { constant: true })])
    .toEqual([false, true, true, false, false, true]);
  expect([hit("is:forked"), hit("is:forked", { layer: "fork" }), hit("is:forked", { layer: "fork+fed" }), hit("is:fed", { layer: "fed" }), hit("is:fed", { layer: "fork+fed" }), hit("is:fed", { layer: "fork" })])
    .toEqual([false, true, true, true, true, false]);
  expect([hit("is:unused"), hit("is:unused", { used: 2 }), hit("is:orphaned"), hit("is:orphaned", { orphaned: true }), hit("is:conflicted"), hit("is:conflicted", { conflict: "notice" })])
    .toEqual([true, false, false, true, false, true]);
  expect([hit("sev:warning"), hit("sev:warning", { conflict: "warning" }), hit("sev:warning", { conflict: "blocking" })]).toEqual([false, true, false]);
  expect([hit("uses:1"), hit("uses>1"), hit("uses<2"), hit("uses>=1"), hit("uses<=0"), hit("depth:0")]).toEqual([true, false, true, true, false, true]);
  const rows = Array.from({ length: 5 }, (_, i) => row({ ref: ref(`n${i}`), name: `n${i}` }));
  const first = page(rows, "", 0, 2);
  expect([first.rows.length, first.total, first.next]).toEqual([2, 5, 2]);
  const last = page(rows, "", 4, 2);
  expect([last.rows.map(item => item.name), "next" in last]).toEqual([["n4"], false]);
  expect(page(rows, "n1").rows.map(item => item.name)).toEqual(["n1"]);
});

test("references in edge cases: unpinned layers, sets without a type, entry fields holding something else, and rollups of a stream not yet created", () => {
  const a = ref("ea"), b = ref("eb");
  expect(entryReferences(entry(a, { kind: "layers", layers: [{ from: b, role: "base", paths: "*" }] }), itemDef)).toEqual([]);
  expect(entryReferences(entry(a, { kind: "set", path: ["pin"], value: { node: b, seq: 2 } }), undefined)).toEqual([]);
  expect(entryReferences(entry(a, { kind: "create", state: state({ [pathKey(["pin"])]: null }) }), itemDef)).toEqual([]);
  // Entries before any creation fold to nothing: a rollup emits nothing for them and keeps what follows.
  const early = [entry(a, { kind: "set", path: ["title"], value: 1 }, { seq: 1, at: 0 }), entry(a, { kind: "set", path: ["title"], value: 2 }, { seq: 2, at: 10 }),
    entry(a, { kind: "create", state: state() }, { seq: 3, at: 5000 })];
  expect(rollupDeltaStream(itemDef, early, new Set()).map(item => [item.seq, item.op.kind])).toEqual([[3, "create"]]);
});

test("an actor's older claim listed after its newer one doesn't replace it", () => {
  const result = resolveClaims("f", [{ actor: "a", value: "new", asOf: 5 }, { actor: "a", value: "old", asOf: 2 }], trustSelf("a"));
  expect(result.value).toBe("new");
  const queue = new JobQueue<string>(1);
  queue.push("b1", "background"); queue.push("b2", "background");
  expect(queue.take()).toBe("b1");
});

test("values a field refuses at the edges, and a stored stream that doesn't begin with a creation", async () => {
  const kinds = itemDef.fields as Record<string, FieldKind>;
  expect(valueProblem(kinds.pin, undefined)).toContain("entry reference");
  expect(valueProblem(kinds.pin, 0)).toContain("entry reference");
  expect(valueProblem(kinds.list, [3])).toContain("list of references");
  const store = new MemoryStore();
  const n = ref("00000000-0000-4000-8000-00000000000c");
  await store.append({ commit: "c1", entries: [{ ...sampleEntry(n, 1, "c1"), op: { kind: "set", path: ["title"], value: 1 } }], expect: [[n.id, 0]] });
  expect((await store.list()).map(row => [row.headSeq, row.name, row.trashed])).toEqual([[1, "", false]]);
});
