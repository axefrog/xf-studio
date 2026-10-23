/**
 * How 0.1.0-alpha.2, the oldest published release, opens and writes a library file, vendored from the tag `v0.1.0-alpha.2`
 * (`9ae9280`): the constructors of `src/library/host/library-store.ts` (`LookLibrary`), `src/library/host/collection-store.ts` (`CollectionLibrary`) and
 * `src/library/host/part-preset-store.ts` (`PartPresetLibrary`), with their DDL, version checks and pragmas verbatim, and the positional
 * inserts their saves run. The release opens each store on its own connection; here one connection runs the three opening
 * sequences in the order the release's servers construct them. The collection step's carry-over of a version-1 library's
 * looks is left out (it needs the release's collection parser; the tests here only open version-0 or version-2 files with it).
 * Test-only: never import it from `src/`.
 */
import { Database } from "bun:sqlite";

/** `LookLibrary`'s version-0 step. */
export const ALPHA_2_LOOK_DDL = `
        CREATE TABLE looks (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE look_revisions (
          look_id TEXT NOT NULL REFERENCES looks(id), revision INTEGER NOT NULL,
          name TEXT NOT NULL, recipe_json TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY (look_id, revision)
        );
        PRAGMA user_version=1;
      `;
/** `CollectionLibrary`'s version-1 step (its tables; the carry-over of the looks is left out). */
export const ALPHA_2_COLLECTION_DDL = `CREATE TABLE collections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE collection_revisions (collection_id TEXT NOT NULL REFERENCES collections(id), revision INTEGER NOT NULL,
        collection_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(collection_id, revision));
        CREATE TABLE collection_preset_versions (collection_id TEXT NOT NULL REFERENCES collections(id), preset_id TEXT NOT NULL,
        revision INTEGER NOT NULL, preset_json TEXT NOT NULL, PRIMARY KEY(collection_id, preset_id, revision)); PRAGMA user_version=2;`;
/** `PartPresetLibrary`'s tables, created at every open. */
export const ALPHA_2_PART_PRESET_DDL = `CREATE TABLE IF NOT EXISTS part_presets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL,
      revision INTEGER NOT NULL, schema TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS part_presets_feature ON part_presets(feature, name);
      CREATE TABLE IF NOT EXISTS part_preset_sets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`;

const version = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;

/**
 * Opens `path` as 0.1.0-alpha.2 does, throwing its errors: `LookLibrary` refuses a version above 2 and makes version 1 from an
 * empty file; `CollectionLibrary` refuses anything but 1 or 2 and makes version 2 (the carry-over is left out, see above);
 * `PartPresetLibrary` creates its tables when missing.
 */
export function alpha2Open(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    // LookLibrary
    const looks = version(db);
    if (looks > 2) throw Error("This library needs a newer version of XF Studio.");
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    if (looks === 0) db.transaction(() => { db.exec(ALPHA_2_LOOK_DDL); })();
    // CollectionLibrary
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    const collections = version(db);
    if (collections !== 1 && collections !== 2) throw Error("Open the compatible look library before the collection library.");
    if (collections === 1) db.transaction(() => { db.exec(ALPHA_2_COLLECTION_DDL); }).immediate();
    // PartPresetLibrary
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    db.exec(ALPHA_2_PART_PRESET_DDL);
    return db;
  } catch (error) { db.close(); throw error; }
}

/** The release's positional inserts: a new look (holding `recipeJson`), a new part preset and a new set, as its saves write them. */
export function alpha2Writes(db: Database, id: (n: number) => string, recipeJson: string, now = new Date().toISOString()): void {
  db.query("INSERT INTO looks VALUES (?, ?)").run(id(1), now);
  db.query("INSERT INTO look_revisions VALUES (?, ?, ?, ?, ?)").run(id(1), 1, "Alpha look", recipeJson, now);
  db.query("INSERT INTO part_presets VALUES (?, ?, ?, 1, ?, ?, ?, ?)").run("expressions", id(2), "Alpha smile", "xfs/expression-part-1",
    JSON.stringify({ controls: { jaw_mid_open: 0.1 }, links: {} }), now, now);
  db.query("INSERT INTO part_preset_sets VALUES (?, ?, ?, 1, ?, ?, ?)").run("expressions", id(3), "Alpha set", JSON.stringify({ members: [id(2)] }), now, now);
}
