/**
 * The library file's schema, as the steps `LibraryDatabase` runs when it opens (platform/persistence/library-database.ts). Each
 * store's DDL lives here, unchanged from the store that used to run it, so the file every build makes is the file
 * 0.1.0-alpha.2 (the oldest published release) makes and reads:
 *
 * - `looks-1` and `collections-2` keep the released `user_version` steps (0 → 1 → 2); `collections-2` carries the looks of a
 *   version-1 library into one collection, as it always did.
 * - `part-presets-1` and `documents-1` are tables beside them (`CREATE TABLE IF NOT EXISTS`) that leave `user_version` alone.
 *
 * Later steps add tables or rows and are recorded in the ledger only: never raise `user_version` and never alter, rename or
 * drop a released table (`looks`, `look_revisions`, `collections`, `collection_revisions`, `collection_preset_versions`,
 * `part_presets`, `part_preset_sets`), nor the development builds' `events`, `snapshots` and `node_index`.
 */
import type { Database } from "bun:sqlite";
import { parseCollection } from "../../legacy/eye-makeup/export/preset-collection";
import type { LibraryMigration } from "../../platform/persistence/library-database";

const version = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
const has = (db: Database, type: "table" | "index", name: string) =>
  !!db.query("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);

/** The look library's tables (`LookLibrary`). */
const LOOKS_1: LibraryMigration = {
  id: "looks-1",
  applied: db => version(db) >= 1,
  apply: db => db.exec(`
        CREATE TABLE looks (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE look_revisions (
          look_id TEXT NOT NULL REFERENCES looks(id), revision INTEGER NOT NULL,
          name TEXT NOT NULL, recipe_json TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY (look_id, revision)
        );
        PRAGMA user_version=1;
      `),
};

/** The collection library's tables (`CollectionLibrary`); a version-1 library's looks become one collection. */
const COLLECTIONS_2: LibraryMigration = {
  id: "collections-2",
  applied: db => version(db) >= 2,
  apply: db => {
    const looks = db.query(`SELECT look_id AS id, name, revision, recipe_json FROM look_revisions r
      WHERE revision=(SELECT MAX(revision) FROM look_revisions WHERE look_id=r.look_id) ORDER BY created_at, look_id`).all() as
      { id: string; name: string; revision: number; recipe_json: string }[];
    const collection = parseCollection({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Makeup collection",
      presets: looks.map(({ recipe_json, ...preset }) => ({ ...preset, recipe: JSON.parse(recipe_json) })) }, true);
    db.exec(`CREATE TABLE collections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE collection_revisions (collection_id TEXT NOT NULL REFERENCES collections(id), revision INTEGER NOT NULL,
        collection_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(collection_id, revision));
        CREATE TABLE collection_preset_versions (collection_id TEXT NOT NULL REFERENCES collections(id), preset_id TEXT NOT NULL,
        revision INTEGER NOT NULL, preset_json TEXT NOT NULL, PRIMARY KEY(collection_id, preset_id, revision)); PRAGMA user_version=2;`);
    // A fresh library has no looks to carry over: it starts empty, so a first run shows the starter draft as "Not saved yet"
    // rather than a phantom saved "Makeup collection" with no presets (release-readiness-audit.md item 11).
    if (!looks.length) return;
    const now = new Date().toISOString();
    db.query("INSERT INTO collections VALUES (?, ?)").run(collection.id, now);
    db.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(collection.id, JSON.stringify(collection), now);
    for (const preset of collection.presets) db.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)")
      .run(collection.id, preset.id, preset.revision, JSON.stringify(preset));
  },
};

/** Named part presets and their sets (`PartPresetLibrary`). 0.1.0-alpha.2 inserts into both positionally: never add a column. */
const PART_PRESETS_1: LibraryMigration = {
  id: "part-presets-1",
  applied: db => has(db, "table", "part_presets") && has(db, "table", "part_preset_sets") && has(db, "index", "part_presets_feature"),
  apply: db => db.exec(`CREATE TABLE IF NOT EXISTS part_presets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL,
      revision INTEGER NOT NULL, schema TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS part_presets_feature ON part_presets(feature, name);
      CREATE TABLE IF NOT EXISTS part_preset_sets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`),
};

/** Typed documents (`DocumentStore`). */
const DOCUMENTS_1: LibraryMigration = {
  id: "documents-1",
  applied: db => has(db, "table", "documents"),
  apply: db => db.exec(`CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
      value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, id));`),
};

/** Every step, in the order they run. Append new ones; never edit or reorder a released one. */
export const LIBRARY_MIGRATIONS: readonly LibraryMigration[] = [LOOKS_1, COLLECTIONS_2, PART_PRESETS_1, DOCUMENTS_1];
