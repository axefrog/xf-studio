/**
 * Captures `tests/golden/library-v2-rows.json`: every row of a SQLite library written by the
 * pre-migration stores (a v1 look library upgraded to the v2 collection tables, then several
 * saves), plus what `list()` and `get()` returned. It was run once on the pre-migration code
 * (commit 9dbf576); the migrated store must read these rows unchanged and never rewrite them.
 *   bun tests/fixtures/capture-library-golden.ts
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionLibrary } from "../../src/collection-store";
import { LookLibrary } from "../../src/library-store";
import { recipe3 } from "./workspace-v1-fixtures";
import { STUDIO_PARTS } from "../../src/compose/studio-registry";

const experiments = new URL("../../../../../experiments/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, experiments), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "xfs-library-golden-")), path = join(dir, "library.sqlite");
try {
  const looks = new LookLibrary(path);
  const first = looks.save({ name: "Legacy look", recipe: recipe3("legacy") });
  looks.save({ name: "Legacy look renamed", recipe: recipe3("legacy"), revision: first.revision }, first.id);
  looks.save({ name: "Second legacy look", recipe: read("005-preset-collection/collection.json").presets[0].recipe });
  looks.close();
  const library = new CollectionLibrary(path, STUDIO_PARTS);
  const editor = read("005-preset-collection/editor-collection.json");
  const saved = library.save({ collection: editor });
  const changed = structuredClone(saved.collection);
  // Written for the pre-migration store (presets held `recipe`); the migrated store holds looks with parts.
  const recipeOf = (preset: unknown) => (preset as { recipe?: { layers: { opacity: number }[] } }).recipe ??
    (preset as { parts: Record<string, { body: { layers: { opacity: number }[] } }> }).parts["eye-makeup"].body;
  recipeOf(changed.presets[1]).layers[0].opacity = 0.5;
  changed.presets[2].name = "Renamed preset";
  const second = library.save({ collection: changed, revision: saved.revision });
  library.save({ collection: second.collection, revision: second.revision });
  library.save({ collection: read("016-finish-board/finish-board.collection.json") });
  const list = library.list().map(({ updatedAt: _u, ...item }) => item);
  const gets = list.flatMap(item => Array.from({ length: item.revision }, (_, i) => {
    const { updatedAt: _u, ...stored } = library.get(item.id, i + 1);
    return stored;
  }));
  library.close();
  const db = new Database(path, { readonly: true });
  const rows = Object.fromEntries(["looks", "look_revisions", "collections", "collection_revisions", "collection_preset_versions"]
    .map(table => [table, db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  db.close();
  writeFileSync(new URL("../golden/library-v2-rows.json", import.meta.url), JSON.stringify({
    capturedFrom: process.argv[2] ?? "working tree", userVersion: version, rows, list, gets }) + "\n");
  console.log(`${Object.values(rows).reduce((sum, table) => sum + table.length, 0)} rows; ${gets.length} revisions`);
} finally { rmSync(dir, { recursive: true, force: true }); }
