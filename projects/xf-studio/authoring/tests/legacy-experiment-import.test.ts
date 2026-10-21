/**
 * The one-time copy of development data (`platform/persistence/legacy-experiment-import.ts`). The fixture is the old event
 * log's on-disk schema, written with plain SQL: rows as development builds left them, including an undone edit, a snapshot
 * followed by later entries, a removed value, a trashed groom and another module's document.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "../src/platform/persistence/document-store";
import { importLegacyExperiments, LEGACY_HAIR_GROOM_KIND } from "../src/platform/persistence/legacy-experiment-import";
import { HAIR_GROOM_KIND } from "../src/features/hair-lab/service";
import { EXPERIMENT_FLAGS } from "../src/platform/api/experiments";

const folders: string[] = [];
function library(): string { const dir = mkdtempSync(join(tmpdir(), "xfs-legacy-")); folders.push(dir); return join(dir, "library.sqlite"); }
afterEach(() => { for (const dir of folders.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { /* closing */ } });

/** The old log's tables, as development libraries have them. */
const OLD_TABLES = `
  CREATE TABLE library_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE events (pos INTEGER PRIMARY KEY AUTOINCREMENT, node TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    commit_id TEXT NOT NULL, actor TEXT NOT NULL, actor_seq INTEGER NOT NULL, at INTEGER NOT NULL, schema TEXT NOT NULL,
    op TEXT NOT NULL, extra TEXT, UNIQUE (node, seq));
  CREATE INDEX events_commit ON events (commit_id);
  CREATE TABLE snapshots (node TEXT PRIMARY KEY, type TEXT NOT NULL, seq INTEGER NOT NULL, pos INTEGER NOT NULL,
    schema TEXT NOT NULL, value TEXT NOT NULL, made_at INTEGER NOT NULL);
  CREATE TABLE node_index (node TEXT PRIMARY KEY, type TEXT NOT NULL, head_seq INTEGER NOT NULL, name TEXT NOT NULL, trashed INTEGER NOT NULL);`;

const created = (own: Record<string, unknown>) => ({ kind: "create", state: { name: "", own, layers: [], trashed: false, retracted: false } });
const set = (path: string[], value: unknown) => ({ kind: "set", path, value });
const length = (value: number) => ({ op: "constant", unit: "m", chart: "scalp", value });
const GROOM = { schema: "xfs/hair-groom-part-1", name: "Loose waves", population: { seed: 1, count: 60000 },
  scalp: { resource: "core-head:head:1", topology: "1:2:3", densitySeed: { method: "cap-projected", source: "base", revision: "r" } },
  graph: { root: "root", nodes: {} }, fields: { length: length(.55), waves: length(.01), spread: length(.02) }, solver: { samples: 1 } };

/** Writes the fixture: each record's ops in order (and an optional snapshot), with the index the old store kept. */
function writeFixture(path: string, records: { node: string; type: string; ops: object[]; trashed?: boolean; snapshot?: { seq: number; state: object } }[]) {
  const db = new Database(path, { create: true });
  try {
    db.exec(OLD_TABLES);
    let pos = 0;
    for (const record of records) {
      record.ops.forEach((op, index) => db.query("INSERT INTO events (node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra) VALUES (?, ?, ?, ?, 'studio-experiments', ?, ?, '1', ?, NULL)")
        .run(record.node, record.type, index + 1, `commit-${++pos}`, pos, 1_792_211_757_932 + pos, JSON.stringify(op)));
      db.query("INSERT INTO node_index VALUES (?, ?, ?, '', ?)").run(record.node, record.type, record.ops.length, record.trashed ? 1 : 0);
      if (record.snapshot) db.query("INSERT INTO snapshots VALUES (?, ?, ?, 0, '1', ?, 0)").run(record.node, record.type, record.snapshot.seq, JSON.stringify(record.snapshot.state));
    }
    db.query("INSERT INTO library_info VALUES ('graph.counter', ?)").run(String(pos));
  } finally { db.close(); }
}

/** Every old table's rows, to show the import never changes them. */
function oldRows(path: string): string {
  const db = new Database(path, { readonly: true });
  try { return JSON.stringify(["library_info", "events", "snapshots", "node_index"].map(table => db.query(`SELECT * FROM ${table} ORDER BY rowid`).all())); }
  finally { db.close(); }
}

const FIXTURE = [
  { node: "xfs-experimental-preferences", type: "experimental-features",
    ops: [created({}), set(["flags", "hair-lab"], true), set(["flags", "other"], true), { kind: "reset", path: ["flags", "other"] }] },
  // Edited twice, the second edit undone (the old log recorded Undo as a compensation).
  { node: "groom-1", type: "experiment-document",
    ops: [created({ '["module"]': "hair-lab", '["document"]': GROOM }), set(["values", "length"], length(.29)), set(["values", "waves"], length(.026)),
      { kind: "compensate", reverses: [{ node: "groom-1", seq: 3 }], ops: [{ kind: "reset", path: ["values", "waves"] }] }] },
  // A snapshot, then later entries: one edit, and a value removed with a tombstone.
  { node: "groom-2", type: "experiment-document", snapshot: { seq: 1, state: { name: "", own: { '["module"]': "hair-lab", '["document"]': { ...GROOM, name: "Second" },
    '["values","spread"]': length(.05) }, layers: [], trashed: false, retracted: false } },
    ops: [{ kind: "create", state: { name: "", own: {}, layers: [], trashed: false, retracted: false } }, set(["values", "length"], length(.7)),
      { kind: "tombstone", path: ["values", "spread"] }] },
  { node: "groom-trashed", type: "experiment-document", trashed: true, ops: [created({ '["module"]': "hair-lab", '["document"]': GROOM }), { kind: "trash" }] },
  { node: "other-module", type: "experiment-document", ops: [created({ '["module"]': "elsewhere", '["document"]': { a: 1 } })] },
  { node: "unrelated", type: "pointer", ops: [created({})] },
];

test("the latest preference and Hair Lab grooms are copied into the document store; the old tables are left exactly as they were", () => {
  const path = library();
  writeFixture(path, FIXTURE);
  const before = oldRows(path), logged: string[] = [];
  const store = new DocumentStore(path);
  try {
    expect(importLegacyExperiments(store, message => logged.push(message))).toEqual({ flags: true, grooms: 2 });
    expect(store.list(EXPERIMENT_FLAGS.kind).map(item => item.value)).toEqual([{ schema: EXPERIMENT_FLAGS.schema, flags: { "hair-lab": true } }]);
    const grooms = store.list<typeof GROOM>(HAIR_GROOM_KIND);
    expect(grooms.map(item => [item.id, item.revision])).toEqual([["groom-1", 1], ["groom-2", 1]]);
    expect(grooms[0].value).toEqual({ ...GROOM, fields: { ...GROOM.fields, length: length(.29) } });
    expect(grooms[1].value).toEqual({ ...GROOM, name: "Second", fields: { ...GROOM.fields, length: length(.7) } });
    expect(logged).toEqual(["Copied earlier experiment data into the document store: the experimental-features preference, 2 Hair Lab grooms."]);
  } finally { store.close(); }
  expect(oldRows(path)).toBe(before);
});

test("the import is idempotent: a second run copies nothing and never overwrites a document changed since", () => {
  const path = library();
  writeFixture(path, FIXTURE);
  const store = new DocumentStore(path);
  try {
    importLegacyExperiments(store);
    store.put(HAIR_GROOM_KIND, "groom-1", { edited: true }, 1);
    store.put(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id, { schema: EXPERIMENT_FLAGS.schema, flags: { "hair-lab": false } }, 1);
    const logged: string[] = [];
    expect(importLegacyExperiments(store, message => logged.push(message))).toEqual({ flags: false, grooms: 0 });
    expect(logged).toEqual([]);
    expect(store.get(HAIR_GROOM_KIND, "groom-1")).toMatchObject({ revision: 2, value: { edited: true } });
    expect(store.get(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id)).toMatchObject({ revision: 2, value: { flags: { "hair-lab": false } } });
  } finally { store.close(); }
});

test("a library without the old log (every released build's) imports nothing", () => {
  const path = library(), store = new DocumentStore(path);
  try {
    expect(importLegacyExperiments(store)).toEqual({ flags: false, grooms: 0 });
    expect(store.list(HAIR_GROOM_KIND)).toEqual([]);
  } finally { store.close(); }
});

test("the import writes Hair Lab's own document kind", () => {
  expect(LEGACY_HAIR_GROOM_KIND).toBe(HAIR_GROOM_KIND);
});
