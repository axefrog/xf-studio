import { Database } from "bun:sqlite";
import { parseCollection } from "./preset-collection";
import { LibraryError } from "./library-store";
import { COLLECTION_1, COLLECTION_2, isNewerData, type Look, type LookCollection } from "./platform/api";
import { NEWER_LOOKS_LIBRARY_MESSAGE } from "./collection-workspace";
import type { PartRegistry } from "./platform/core/document";

/**
 * Why a save that needs `xfs/collection-2` is refused. The released 0.1.0-alpha.1 lists a library
 * only while the latest revision of every collection is `xfas/collection-1` (one other row makes
 * its whole list fail), and saves on top of a collection only while that revision is too; so no
 * row it cannot read is ever written into the shared library (CORE-30). Such collections still
 * live in the workspace and export to files.
 */
export const COLLECTION_2_LIBRARY_MESSAGE = "This collection has parts the released XF Studio 0.1.0-alpha.1 can't read, " +
  "so it isn't saved to the library, which that version also opens. Your draft is kept: export the collection to a file to keep a copy.";

/** A library revision: the collection as looks (`xfs/collection-2` in memory), whatever schema its row was written in. */
export type StoredCollection = { collection: LookCollection; revision: number; updatedAt: string };
export type CollectionSummary = { id: string; name: string; revision: number; count: number; updatedAt: string };
/**
 * The local collection library (SQLite v2; no DDL change for the look model). Rows describe their
 * own schema: rows written before the look model hold `xfas/collection-1` JSON and are never
 * rewritten. A save writes each new row in the oldest schema that holds it exactly, so a library
 * of eye-makeup looks stays readable by 0.1.0-alpha.1; a collection that needs `xfs/collection-2`
 * is refused rather than written where that release reads (`COLLECTION_2_LIBRARY_MESSAGE`).
 * Rows of either schema read (feature-module platform §2). The part registry is injected by the
 * server roots.
 */
export class CollectionLibrary {
  private db: Database;
  constructor(path: string, private parts: PartRegistry) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    const { user_version: version } = this.db.query("PRAGMA user_version").get() as { user_version: number };
    if (version !== 1 && version !== 2) { this.db.close(); throw Error("Open the compatible look library before the collection library."); }
    if (version === 1) this.db.transaction(() => {
      const looks = this.db.query(`SELECT look_id AS id, name, revision, recipe_json FROM look_revisions r
        WHERE revision=(SELECT MAX(revision) FROM look_revisions WHERE look_id=r.look_id) ORDER BY created_at, look_id`).all() as
        { id: string; name: string; revision: number; recipe_json: string }[];
      const collection = parseCollection({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Makeup collection",
        presets: looks.map(({ recipe_json, ...preset }) => ({ ...preset, recipe: JSON.parse(recipe_json) })) }, true);
      this.db.exec(`CREATE TABLE collections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE collection_revisions (collection_id TEXT NOT NULL REFERENCES collections(id), revision INTEGER NOT NULL,
        collection_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(collection_id, revision));
        CREATE TABLE collection_preset_versions (collection_id TEXT NOT NULL REFERENCES collections(id), preset_id TEXT NOT NULL,
        revision INTEGER NOT NULL, preset_json TEXT NOT NULL, PRIMARY KEY(collection_id, preset_id, revision)); PRAGMA user_version=2;`);
      const now = new Date().toISOString();
      this.db.query("INSERT INTO collections VALUES (?, ?)").run(collection.id, now);
      this.db.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(collection.id, JSON.stringify(collection), now);
      for (const preset of collection.presets) this.db.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)")
        .run(collection.id, preset.id, preset.revision, JSON.stringify(preset));
    }).immediate();
  }
  close() { this.db.close(); }
  list(): CollectionSummary[] {
    return (this.db.query(`SELECT collection_json, revision, created_at AS updatedAt FROM collection_revisions r
      WHERE revision=(SELECT MAX(revision) FROM collection_revisions WHERE collection_id=r.collection_id)
      ORDER BY (SELECT created_at FROM collections WHERE id=r.collection_id), collection_id`).all() as
      { collection_json: string; revision: number; updatedAt: string }[]).map(row => {
        // Identity only: listing never parses parts, so a collection with a newer build's parts still lists.
        const collection = this.parts.readIdentity(JSON.parse(row.collection_json));
        return { id: collection.id, name: collection.name, count: collection.count, revision: row.revision, updatedAt: row.updatedAt };
      });
  }
  get(id: string, revision?: number): StoredCollection {
    const row = this.db.query(`SELECT collection_json, revision, created_at AS updatedAt FROM collection_revisions
      WHERE collection_id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1`).get(id, revision ?? null, revision ?? null) as
      { collection_json: string; revision: number; updatedAt: string } | null;
    if (!row) throw new LibraryError("Collection not found.", 404);
    return { collection: this.parts.readCollection(JSON.parse(row.collection_json), true), revision: row.revision, updatedAt: row.updatedAt };
  }
  /** One stored preset row of either schema, as a look. */
  private readPresetRow(json: string): Look {
    const value = JSON.parse(json) as { parts?: unknown };
    return this.parts.readPreset(value, value && typeof value === "object" && "parts" in value ? COLLECTION_2 : COLLECTION_1);
  }
  /**
   * Save a new revision. A preset gets a new version only when its name or content changed;
   * content is compared canonically (parsed and serialized by its codecs, keys sorted), so a
   * row stored in an older schema or key order never counts as a change.
   */
  /**
   * Each part is parsed once: the input when it is read, an older preset row when it is compared.
   * Parsed parts are compared and written as they are (CORE-35); the previous revision is looked up
   * by number only.
   */
  save(value: unknown): StoredCollection {
    const input = value as { collection?: unknown; revision?: number };
    let collection: LookCollection;
    try { collection = this.parts.readCollection(input?.collection, true); }
    catch (error) {
      if (isNewerData(error)) throw new LibraryError(NEWER_LOOKS_LIBRARY_MESSAGE, 422);
      throw new LibraryError("Invalid collection; nothing was saved.");
    }
    // Every row this save writes must be one 0.1.0-alpha.1 reads (CORE-30).
    const stored = this.parts.writeMinimal(collection);
    if (stored.schema !== COLLECTION_1) throw new LibraryError(COLLECTION_2_LIBRARY_MESSAGE, 422);
    return this.db.transaction(() => {
      const latest = this.db.query("SELECT MAX(revision) AS revision FROM collection_revisions WHERE collection_id=?")
        .get(collection.id) as { revision: number | null } | null;
      const exists = this.db.query("SELECT id FROM collections WHERE id=?").get(collection.id);
      const previous = exists && latest?.revision ? latest.revision : undefined;
      if (previous !== undefined && previous !== input.revision)
        throw new LibraryError("This collection changed in another window. Open the saved version or save a separate copy.", 409);
      if (previous === undefined && input.revision !== undefined) throw new LibraryError("Collection revision does not exist.", 409);
      const revision = (previous ?? 0) + 1, updatedAt = new Date().toISOString();
      if (!exists) this.db.query("INSERT INTO collections VALUES (?, ?)").run(collection.id, updatedAt);
      collection.presets = collection.presets.map(p => {
        const row = this.db.query(`SELECT preset_json FROM collection_preset_versions WHERE collection_id=? AND preset_id=?
          ORDER BY revision DESC LIMIT 1`).get(collection.id, p.id) as { preset_json: string } | null;
        const old = row ? this.readPresetRow(row.preset_json) : undefined;
        const changed = old && (old.name !== p.name || this.parts.canonicalParts(old.parts) !== this.parts.canonicalParts(p.parts));
        const preset = { ...p, revision: old ? old.revision + (changed ? 1 : 0) : p.revision };
        if (!old || changed) this.db.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)")
          .run(collection.id, preset.id, preset.revision, JSON.stringify(this.parts.writePresetMinimal(preset)));
        return preset;
      });
      this.db.query("INSERT INTO collection_revisions VALUES (?, ?, ?, ?)")
        .run(collection.id, revision, JSON.stringify({ ...stored, presets: stored.presets.map((preset, index) =>
          ({ ...preset, revision: collection.presets[index].revision })) }), updatedAt);
      return { collection, revision, updatedAt };
    }).immediate();
  }
}

export async function collectionRequest(request: Request, library: CollectionLibrary, prefix: string): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get("Origin"), suffix = url.pathname.slice(prefix.length);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
  if (suffix && !/^\/[0-9a-f-]{36}$/.test(suffix)) return json({ error: "Not found." }, 404);
  try {
    if (request.method === "GET") return json(suffix ? library.get(suffix.slice(1)) : library.list());
    if (request.method !== "POST" || suffix) return json({ error: "Method not allowed." }, 405);
    if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ error: "Use the local studio to save collections." }, 403);
    const body = await request.text();
    if (body.length > 16_000_000) return json({ error: "Collection source exceeds the current 16 MB storage request budget." }, 413);
    let value: unknown;
    try { value = JSON.parse(body); } catch { return json({ error: "Invalid JSON." }, 400); }
    return json(library.save(value), 200);
  } catch (e) {
    if (e instanceof LibraryError) return json({ error: e.message }, e.status);
    console.error("Collection request failed", e);
    return json({ error: "Collection unavailable; your browser draft is still available." }, 500);
  }
}
