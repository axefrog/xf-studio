/**
 * The library file's one owner (`platform/persistence/library-database.ts`) and its migrations (`library-migrations.ts`).
 *
 * Lossless opening: for every historical shape of the file, every table's rows (`SELECT * ORDER BY rowid`) and DDL are the
 * same after this build opens it, apart from the tables it adds; `user_version` never goes above 2; the readers vendored from
 * the released tags still read it, and 0.1.0-alpha.2 still opens and writes it. A file with nothing pending is not written at
 * all (its bytes are unchanged). Then: a newer build's file is refused, the ledger is backfilled and tolerates newer IDs, writes
 * nest and report once, a row-rewriting migration is copied first, and a backup restores through the owner.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { libraryStores, openLibraryFiles } from "../src/library-files";
import { LIBRARY_MIGRATIONS } from "../src/library-migrations";
import { readRecipe, recipeFile } from "../src/recipe-schema";
import { hostClock } from "../src/platform/core/clock";
import { LibraryBackups } from "../src/platform/persistence/backups";
import { LibraryDatabase, LibraryTooNewError, RELEASED_LIBRARY_VERSION, type LibraryMigration } from "../src/platform/persistence/library-database";
import { alphaList } from "./fixtures/alpha-0.1.0/collection-list";
import { alpha2Open, alpha2Writes, ALPHA_2_COLLECTION_DDL, ALPHA_2_LOOK_DDL, ALPHA_2_PART_PRESET_DDL } from "./fixtures/alpha-0.1.0-alpha.2/library-ddl";
import { alpha2Unreadable } from "./fixtures/alpha-0.1.0-alpha.2/schemas";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { initialRecipe } from "./fixtures/eye-region";
import { openTestLibrary } from "./fixtures/library-file";

const folders: string[] = [];
function folder(): string { const dir = mkdtempSync(join(tmpdir(), "xfs-library-db-")); folders.push(dir); return dir; }
afterEach(() => { for (const dir of folders.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing */ } });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-09-27T10:00:00.000Z";
const LEDGER = "xfs_migrations";

/** Every table's DDL and rows, by name. */
function dump(path: string): Record<string, { sql: string; rows: unknown[] }> {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string; sql: string }[];
    return Object.fromEntries(tables.map(({ name, sql }) => [name, { sql, rows: db.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() }]));
  } finally { db.close(); }
}
const userVersion = (path: string) => {
  const db = new Database(path, { readonly: true });
  try { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; } finally { db.close(); }
};
const ledger = (path: string) => (dump(path)[LEDGER]?.rows ?? []) as { id: string; applied_at: string }[];
const bytes = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

/** Every table that was there before is there after, with the same DDL and rows; returns the tables opening added. */
function expectLossless(before: ReturnType<typeof dump>, after: ReturnType<typeof dump>, shape: string): string[] {
  for (const [name, table] of Object.entries(before)) {
    expect(after[name], `${shape}: ${name} kept`).toBeDefined();
    expect(after[name].sql, `${shape}: ${name}'s DDL`).toBe(table.sql);
    expect(after[name].rows, `${shape}: ${name}'s rows`).toEqual(table.rows);
  }
  return Object.keys(after).filter(name => !(name in before)).sort();
}

/** What the released builds do with the file: alpha.1's list reads it, and alpha.2 opens it and writes to it (on a copy). */
function expectReleasesRead(path: string, shape: string) {
  expect(userVersion(path), shape).toBe(RELEASED_LIBRARY_VERSION);
  const db = new Database(path, { readonly: true });
  try {
    expect(() => alphaList(db, value => readRecipe(value)), shape).not.toThrow();
    for (const row of db.query("SELECT collection_json FROM collection_revisions").all() as { collection_json: string }[])
      expect(alpha2Unreadable(JSON.parse(row.collection_json)), shape).toEqual([]);
  } finally { db.close(); }
  const copy = join(folder(), "alpha-2.sqlite");
  const source = new Database(path, { readonly: true });
  try { source.query("VACUUM INTO ?").run(copy); } finally { source.close(); }
  const alpha = alpha2Open(copy);
  try { alpha2Writes(alpha, n => uuid(900 + n), recipeJson()); } finally { alpha.close(); }
  // This build reads what alpha.2 wrote there.
  const after = openTestLibrary(copy);
  try {
    expect(after.looks.get(uuid(901)).name).toBe("Alpha look");
    expect(after.partPresets.list("expressions").map(item => item.name)).toContain("Alpha smile");
    expect(after.partPresets.listSets("expressions").map(item => item.name)).toContain("Alpha set");
  } finally { after.close(); }
}

/** A recipe file row, as the look library stores it. */
const recipeJson = () => JSON.stringify(recipeFile(initialRecipe()));
/** The development builds' graph tables (`platform/graph-adapters/sqlite-store.ts` `GRAPH_TABLES` at 5146d39, before the engine was retired). */
const DEVELOPMENT_GRAPH_TABLES = `
  CREATE TABLE IF NOT EXISTS library_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (pos INTEGER PRIMARY KEY AUTOINCREMENT, node TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    commit_id TEXT NOT NULL, actor TEXT NOT NULL, actor_seq INTEGER NOT NULL, at INTEGER NOT NULL, schema TEXT NOT NULL,
    op TEXT NOT NULL, extra TEXT, UNIQUE (node, seq));
  CREATE INDEX IF NOT EXISTS events_commit ON events (commit_id);
  CREATE TABLE IF NOT EXISTS snapshots (node TEXT PRIMARY KEY, type TEXT NOT NULL, seq INTEGER NOT NULL, pos INTEGER NOT NULL,
    schema TEXT NOT NULL, value TEXT NOT NULL, made_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS compactions (node TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS node_index (node TEXT PRIMARY KEY, type TEXT NOT NULL, head_seq INTEGER NOT NULL, name TEXT NOT NULL,
    trashed INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS export_ids (id TEXT PRIMARY KEY, kind TEXT NOT NULL, node TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS save_backups (save TEXT NOT NULL, taken_at INTEGER NOT NULL, sha256 TEXT NOT NULL, file TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS purge_pending (node TEXT PRIMARY KEY, at INTEGER NOT NULL);`;

/** A 0.1.0-alpha.2 library with looks, a collection, part presets and a set, written as that release writes them. */
function alpha2Library(path: string) {
  const db = alpha2Open(path);
  try {
    alpha2Writes(db, uuid, recipeJson(), NOW);
    const collection = STUDIO_PARTS.writeMinimal(STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0])));
    db.query("INSERT INTO collections VALUES (?, ?)").run(collection.id, NOW);
    db.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(collection.id, JSON.stringify(collection), NOW);
    for (const preset of collection.presets) db.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)")
      .run(collection.id, preset.id, preset.revision, JSON.stringify(preset));
  } finally { db.close(); }
}

const SHAPES: { name: string; make(path: string): void; added: string[] }[] = [
  { name: "version 1: looks only (before the collection library)", added: ["collection_preset_versions", "collection_revisions", "collections", "documents", "part_preset_sets", "part_presets", LEDGER],
    make(path) {
      const db = new Database(path, { create: true, strict: true });
      try {
        db.exec("PRAGMA journal_mode=WAL;");
        db.transaction(() => db.exec(ALPHA_2_LOOK_DDL))();
        for (const n of [1, 2]) {
          db.query("INSERT INTO looks VALUES (?, ?)").run(uuid(n), NOW);
          db.query("INSERT INTO look_revisions VALUES (?, ?, ?, ?, ?)").run(uuid(n), 1, `Look ${n}`, recipeJson(), NOW);
        }
        db.query("INSERT INTO look_revisions VALUES (?, ?, ?, ?, ?)").run(uuid(1), 2, "Look 1 renamed", recipeJson(), NOW);
      } finally { db.close(); }
    } },
  { name: "version 2 before part presets (the captured pre-migration library)", added: ["documents", "part_preset_sets", "part_presets", LEDGER],
    make(path) {
      const golden = JSON.parse(readFileSync(join(import.meta.dir, "golden", "library-v2-rows.json"), "utf8")) as { rows: Record<string, Record<string, unknown>[]> };
      const db = new Database(path, { create: true, strict: true });
      try {
        db.exec("PRAGMA journal_mode=WAL;");
        db.exec(ALPHA_2_LOOK_DDL); db.exec(ALPHA_2_COLLECTION_DDL);
        for (const [table, rows] of Object.entries(golden.rows)) for (const row of rows)
          db.query(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row) as never[]);
      } finally { db.close(); }
    } },
  { name: "0.1.0-alpha.2 with looks, a collection, part presets and a set", added: ["documents", LEDGER], make: alpha2Library },
  { name: "a development library with the retired graph's tables", added: ["documents", LEDGER],
    make(path) {
      alpha2Library(path);
      const db = new Database(path, { strict: true });
      try {
        db.exec(DEVELOPMENT_GRAPH_TABLES);
        db.query("INSERT INTO library_info VALUES ('graph.counter', '2')").run();
        db.query("INSERT INTO events (node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra) VALUES ('n1', 'pointer', 1, 'c1', 'a', 1, 1, '1', ?, NULL)")
          .run(JSON.stringify({ kind: "create", state: { own: {}, trashed: false, retracted: false } }));
        db.query("INSERT INTO node_index VALUES ('n1', 'pointer', 1, '', 0)").run();
        db.query("INSERT INTO snapshots VALUES ('n1', 'pointer', 1, 1, '1', '{}', 1)").run();
      } finally { db.close(); }
    } },
];

test("a fresh library gets every step, user_version 2, and a ledger naming them; the released builds open it", () => {
  const path = join(folder(), "library.sqlite");
  const file = openTestLibrary(path);
  file.close();
  expect(userVersion(path)).toBe(2);
  expect(Object.keys(dump(path)).sort()).toEqual(["collection_preset_versions", "collection_revisions", "collections", "documents", "look_revisions", "looks",
    "part_preset_sets", "part_presets", LEDGER]);
  expect(ledger(path).map(row => row.id)).toEqual(LIBRARY_MIGRATIONS.map(step => step.id));
  expect(ledger(path).every(row => /^\d{4}-\d{2}-\d{2}T/.test(row.applied_at))).toBe(true);
  // A fresh library starts empty: no phantom collection (release-readiness-audit.md item 11).
  expect(dump(path).collections.rows).toEqual([]);
  expectReleasesRead(path, "fresh");
});

for (const shape of SHAPES) test(`opening is lossless: ${shape.name}`, () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  shape.make(path);
  const before = dump(path), version = userVersion(path);
  // The hosts' composition: both files, every store, and the one-time copy of development data.
  const files = openLibraryFiles(dir, { clock: hostClock(), parts: STUDIO_PARTS, isolated: true });
  files.close();
  const after = dump(path);
  expect(expectLossless(before, after, shape.name)).toEqual(shape.added);
  expect(userVersion(path)).toBe(Math.max(version, RELEASED_LIBRARY_VERSION));
  // Steps an earlier build made are backfilled into the ledger; the ones this build ran carry their time.
  const rows = ledger(path);
  expect(rows.map(row => row.id).sort()).toEqual(LIBRARY_MIGRATIONS.map(step => step.id).sort());
  for (const row of rows) expect(row.applied_at === "before-ledger", `${shape.name}: ${row.id}`).toBe(!shape.added.includes(stepTable(row.id)));
  expectReleasesRead(path, shape.name);
  // Opening again writes nothing.
  const settled = bytes(path);
  openTestLibrary(path).close();
  expect(bytes(path)).toBe(settled);
});

/** The table each step adds (its ledger row is "before-ledger" exactly when the table was there already). */
function stepTable(id: string): string {
  return ({ "looks-1": "looks", "collections-2": "collections", "part-presets-1": "part_presets", "documents-1": "documents" } as Record<string, string>)[id];
}

test("version 1's looks become one collection; looks and their revisions are untouched", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  SHAPES[0].make(path);
  const file = openTestLibrary(path);
  try {
    const [summary] = file.collections.list();
    expect(summary).toMatchObject({ name: "Makeup collection", count: 2, revision: 1 });
    expect(file.collections.get(summary.id).collection.presets.map(look => [look.id, look.name, look.revision]))
      .toEqual([[uuid(1), "Look 1 renamed", 2], [uuid(2), "Look 2", 1]]);
  } finally { file.close(); }
});

test("a library with the documents table and no ledger (the build before this one) opens without writing a byte", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  alpha2Library(path);
  // The previous build's document store: its table beside the released ones, and a document in it; no ledger.
  const db = new Database(path, { strict: true });
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
      value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, id));`);
    db.query("INSERT INTO documents VALUES ('experiment-flags', 'preferences', 1, '{\"flags\":{}}', 1, 1)").run();
  } finally { db.close(); }
  const before = bytes(path), rows = dump(path);
  const files = openLibraryFiles(dir, { clock: hostClock(), parts: STUDIO_PARTS, isolated: true });
  try { expect(files.main.documents.get("experiment-flags", "preferences")?.revision).toBe(1); } finally { files.close(); }
  expect(existsSync(`${path}-wal`)).toBe(false);
  expect(bytes(path)).toBe(before);
  expect(dump(path)).toEqual(rows);
});

test("a newer build's library is refused before anything is written, and the file is left as it was", () => {
  const path = join(folder(), "library.sqlite");
  openTestLibrary(path).close();
  const db = new Database(path);
  db.exec("PRAGMA user_version=3;");
  db.close();
  const before = bytes(path);
  expect(() => openTestLibrary(path)).toThrow(LibraryTooNewError);
  expect(() => openTestLibrary(path)).toThrow("needs a newer version of XF Studio");
  expect(bytes(path)).toBe(before);
});

test("ledger IDs from a newer build are kept and allowed; a step this build knows runs once", () => {
  const path = join(folder(), "library.sqlite");
  openTestLibrary(path).close();
  const db = new Database(path);
  db.query(`INSERT INTO ${LEDGER} VALUES ('a-newer-step-9', 'later')`).run();
  db.close();
  let runs = 0;
  const extra: LibraryMigration = { id: "test-table-1", applied: () => false, apply: raw => { runs++; raw.exec("CREATE TABLE test_table (n INTEGER)"); } };
  for (let i = 0; i < 2; i++)
    LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, extra], backups: null }).close();
  expect(runs).toBe(1);   // the ledger, not its own check, says it ran
  expect(ledger(path).map(row => row.id)).toEqual([...LIBRARY_MIGRATIONS.map(step => step.id), "a-newer-step-9", "test-table-1"]);
});

test("a step runs with its ledger row in one transaction: a failing step changes nothing, and none may raise user_version", () => {
  const path = join(folder(), "library.sqlite");
  openTestLibrary(path).close();
  const before = dump(path);
  const failing: LibraryMigration = { id: "test-failing-1", applied: () => false,
    apply: raw => { raw.exec("CREATE TABLE half_done (n INTEGER)"); throw Error("disk full"); } };
  expect(() => LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, failing], backups: null })).toThrow("disk full");
  expect(dump(path)).toEqual(before);
  const raising: LibraryMigration = { id: "test-raising-1", applied: () => false, apply: raw => raw.exec("PRAGMA user_version=3") };
  expect(() => LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, raising], backups: null })).toThrow("raised the library version");
  expect(userVersion(path)).toBe(2);
  expect(dump(path)).toEqual(before);
});

test("a step that rewrites rows runs only after a copy of the file; if the copy fails, it doesn't run", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const file = openTestLibrary(path), look = file.looks.save({ name: "Before", recipe: initialRecipe() });
  file.close();
  const rename: LibraryMigration = { id: "test-rename-1", rewritesRows: true, applied: () => false,
    apply: raw => { raw.query("UPDATE look_revisions SET name = 'After'").run(); } };
  // The copy can't be made: the step doesn't run and nothing changes.
  const broken = new LibraryBackups(path, () => Date.UTC(2026, 9, 21));
  broken.beforeMigration = () => { throw Error("no space for the copy"); };
  const before = dump(path);
  expect(() => LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, rename], backups: broken })).toThrow("no space");
  expect(dump(path)).toEqual(before);
  // With the copy: it is taken first (holding the rows as they were), then the step runs.
  const backups = new LibraryBackups(path, () => Date.UTC(2026, 9, 21));
  const database = LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, rename], backups });
  try { expect(libraryStores(database, STUDIO_PARTS).looks.get(look.id).name).toBe("After"); } finally { database.close(); }
  const copies = backups.list().filter(item => item.kind === "pre-migration");
  expect(copies).toHaveLength(1);
  expect(copies[0].file.split(/[\\/]/).at(-1)).toMatch(/^library\.pre-migration\.2026-10-21\.test-rename-1\.\d+-[0-9a-f]{8}\.sqlite$/);
  const names = (file: string) => { const db = new Database(file, { readonly: true }); try { return db.query("SELECT name FROM look_revisions").all(); } finally { db.close(); } };
  expect(names(copies[0].file)).toEqual([{ name: "Before" }]);
  // Pre-migration copies are never pruned with the daily ones.
  backups.prune();
  expect(backups.list().some(item => item.kind === "pre-migration")).toBe(true);
  // The same step again (its ledger row removed) the same day: a second copy beside the first, which is never replaced.
  const raw = new Database(path);
  raw.query(`DELETE FROM ${LEDGER} WHERE id = 'test-rename-1'`).run();
  raw.query("UPDATE look_revisions SET name = 'Between'").run();
  raw.close();
  LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, rename], backups }).close();
  const again = backups.list().filter(item => item.kind === "pre-migration");
  expect(again).toHaveLength(2);
  expect(names(copies[0].file)).toEqual([{ name: "Before" }]);
  expect(names(again.find(item => item.file !== copies[0].file)!.file)).toEqual([{ name: "Between" }]);
});

test("a step another opener ran meanwhile is seen inside the write lock: no copy is taken and it doesn't run again", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  openTestLibrary(path).close();
  const backups = new LibraryBackups(path, () => Date.UTC(2026, 9, 21));
  let checks = 0, runs = 0;
  // Pending at the first look; by the time this opener holds the lock, another one has made it.
  const raced: LibraryMigration = { id: "test-raced-1", rewritesRows: true, applied: () => ++checks > 1, apply: () => { runs++; } };
  LibraryDatabase.open(path, { clock: hostClock(), migrations: [...LIBRARY_MIGRATIONS, raced], backups }).close();
  expect(runs).toBe(0);
  expect(backups.list()).toEqual([]);
  expect(ledger(path).map(row => row.id)).not.toContain("test-raced-1");
});

test("writes nest as savepoints of one transaction and report once; a refused or no-op write reports nothing", () => {
  let writes = 0;
  const file = openTestLibrary(":memory:", { writes: { wrote: () => { writes++; } } });
  try {
    writes = 0;
    // A store calling another store inside a write: one commit, one report.
    file.database.write(() => {
      file.looks.save({ name: "Inside", recipe: initialRecipe() });
      file.documents.put("sample", "a", 1, 0);
    });
    expect(writes).toBe(1);
    expect(file.looks.list().map(look => look.name)).toEqual(["Inside"]);
    // A nested write that fails rolls back to its savepoint; the outer write commits the rest.
    file.database.write(() => {
      file.documents.put("sample", "b", 1, 0);
      expect(() => file.database.write(() => { file.documents.put("sample", "c", 1, 0); throw Error("refused"); })).toThrow("refused");
    });
    expect(writes).toBe(2);
    expect(file.documents.list("sample").map(item => item.id)).toEqual(["a", "b"]);
    // An outer write that fails rolls back its nested writes too, and reports nothing.
    expect(() => file.database.write(() => { file.documents.put("sample", "d", 1, 0); throw Error("outer"); })).toThrow("outer");
    expect(file.documents.get("sample", "d")).toBeNull();
    // A stale document write commits no row.
    expect(file.documents.put("sample", "a", 2, 0).ok).toBe(false);
    expect(writes).toBe(2);
  } finally { file.close(); }
  file.close();   // idempotent
  expect(() => file.looks.list()).toThrow("closed");
});

test("a backup restores through the owner: the stores keep working on the restored file, and another connection refuses it", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const backups = new LibraryBackups(path, () => Date.UTC(2026, 9, 21));
  const database = LibraryDatabase.open(path, { clock: hostClock(), migrations: LIBRARY_MIGRATIONS, backups, writes: { wrote() {} } });
  const stores = libraryStores(database, STUDIO_PARTS);
  try {
    stores.documents.put("sample", "a", "kept", 0);
    const copy = backups.daily()!;
    stores.documents.put("sample", "a", "changed since", 1);
    // Another window has the file open: refused, and this one carries on with the current file.
    const other = new Database(path);
    other.exec("PRAGMA journal_mode=WAL;");
    other.query("SELECT COUNT(*) FROM documents").get();
    expect(() => database.restore(copy)).toThrow("other windows");
    other.close();
    expect(stores.documents.get("sample", "a")?.value).toBe("changed since");
    const kept = database.restore(copy);
    expect(existsSync(kept)).toBe(true);
    expect(stores.documents.get("sample", "a")?.value).toBe("kept");
    expect(stores.documents.put("sample", "a", "after", 1).ok).toBe(true);
    expect(readdirSync(join(dir, "backups")).some(name => name.includes("pre-restore"))).toBe(true);
  } finally { database.close(); }
  expect(() => openTestLibrary(path).close()).not.toThrow();
});
