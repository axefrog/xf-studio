import { Database } from "bun:sqlite";
import { isNewerData, type PartEnvelope } from "./platform/api";
import type { PartRegistry } from "./platform/core/document";
import { LibraryError } from "./library-store";
import { hostFailure } from "./diagnostics/host-log";

/**
 * Named part presets in the local library (research/authoring/editor-invariants.md "Part presets"): one feature's part saved on its
 * own, without a look, so a person can keep favourites (an expression today; poses and other feature presets later) and start new
 * work from them. The rows live in the same SQLite file as the look and collection libraries, in a table of their own:
 *
 *     part_presets(feature, id, name, revision, schema, body, created_at, updated_at)
 *
 * **Forward-only, beside the released tables.** The table is created when missing (`CREATE TABLE IF NOT EXISTS`) and `user_version`
 * is left as it is, so the collection and look tables, their rows and the library version 0.1.0-alpha.1 checks are untouched: that
 * release lists the library exactly as before and never reads this table (CORE-30 stays intact). Each row's part is stored in its
 * feature's current part schema; a row of a schema this build doesn't read (a newer build's) is kept and left out of lists, never
 * rewritten or dropped. Rename and delete take the revision they were shown, so a stale window can't overwrite a newer change.
 */
export type PartPresetSummary = { id: string; feature: string; name: string; revision: number; part: PartEnvelope; updatedAt: string };

/** Longest preset name. */
export const PART_PRESET_NAME_LIMIT = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class PartPresetLibrary {
  private db: Database;
  constructor(path: string, private parts: PartRegistry, private newId: () => string = () => crypto.randomUUID()) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS part_presets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL,
      revision INTEGER NOT NULL, schema TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS part_presets_feature ON part_presets(feature, name);`);
  }
  close() { this.db.close(); }

  private registered(feature: unknown): string {
    if (typeof feature !== "string" || !this.parts.feature(feature)) throw new LibraryError("That kind of preset isn't known to this version of XF Studio.");
    return feature;
  }
  private name(value: unknown): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name) throw new LibraryError("Give the preset a name.");
    if (name.length > PART_PRESET_NAME_LIMIT) throw new LibraryError(`A preset name is at most ${PART_PRESET_NAME_LIMIT} characters.`);
    return name;
  }

  /** A feature's readable presets, by name. Rows this build can't read (a newer build's part schema) are left out and kept. */
  list(featureValue: unknown): PartPresetSummary[] {
    const feature = this.registered(featureValue);
    const rows = this.db.query("SELECT id, name, revision, schema, body, updated_at AS updatedAt FROM part_presets WHERE feature=? ORDER BY name COLLATE NOCASE, id")
      .all(feature) as { id: string; name: string; revision: number; schema: string; body: string; updatedAt: string }[];
    return rows.flatMap(row => {
      try { return [{ id: row.id, feature, name: row.name, revision: row.revision, part: this.parts.readPart(feature, { schema: row.schema, body: JSON.parse(row.body) }), updatedAt: row.updatedAt }]; }
      catch (error) {
        if (!isNewerData(error)) hostFailure("library", "part_preset_unreadable", "A saved preset couldn't be read; it is kept as it is.", error, "warn");
        return [];
      }
    });
  }

  /** Save a new preset of `feature` holding `part` (an envelope in any schema the feature reads). */
  save(value: unknown): PartPresetSummary {
    const input = value as { feature?: unknown; name?: unknown; part?: unknown } | null;
    const feature = this.registered(input?.feature), name = this.name(input?.name);
    let part: PartEnvelope;
    try { part = this.parts.readPart(feature, input?.part); }
    catch (error) { throw new LibraryError(isNewerData(error) ? "That preset was made with a newer version of XF Studio." : "That preset is damaged; nothing was saved.", 422); }
    const id = this.newId(), now = new Date().toISOString();
    this.db.query("INSERT INTO part_presets VALUES (?, ?, ?, 1, ?, ?, ?, ?)").run(feature, id, name, part.schema, JSON.stringify(part.body), now, now);
    return { id, feature, name, revision: 1, part, updatedAt: now };
  }

  private current(id: string, revision: unknown) {
    if (!UUID.test(id)) throw new LibraryError("Not found.", 404);
    const row = this.db.query("SELECT feature, revision FROM part_presets WHERE id=?").get(id) as { feature: string; revision: number } | null;
    if (!row) throw new LibraryError("That preset no longer exists.", 404);
    if (row.revision !== revision) throw new LibraryError("That preset changed in another window. Look again, then try once more.", 409);
    return row;
  }
  rename(id: string, value: unknown): { id: string; name: string; revision: number } {
    const input = value as { name?: unknown; revision?: unknown } | null;
    const name = this.name(input?.name);
    return this.db.transaction(() => {
      const row = this.current(id, input?.revision), revision = row.revision + 1;
      this.db.query("UPDATE part_presets SET name=?, revision=?, updated_at=? WHERE id=?").run(name, revision, new Date().toISOString(), id);
      return { id, name, revision };
    }).immediate();
  }
  delete(id: string, revision: unknown): { id: string } {
    return this.db.transaction(() => {
      this.current(id, revision);
      this.db.query("DELETE FROM part_presets WHERE id=?").run(id);
      return { id };
    }).immediate();
  }
}

/**
 * `GET <prefix>?feature=<id>` lists, `POST <prefix>` saves `{feature, name, part}`, `PATCH <prefix>/<id>` renames `{name, revision}`
 * and `DELETE <prefix>/<id>?revision=<n>` removes. Same-origin local requests only, as the collection library.
 */
export async function partPresetRequest(request: Request, library: PartPresetLibrary, prefix: string): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get("Origin"), suffix = url.pathname.slice(prefix.length);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
  if (suffix && !/^\/[0-9a-f-]{36}$/.test(suffix)) return json({ error: "Not found." }, 404);
  try {
    if (request.method === "GET" && !suffix) return json(library.list(url.searchParams.get("feature")));
    if (origin !== url.origin) return json({ error: "Use the local studio to change presets." }, 403);
    if (request.method === "DELETE" && suffix) return json(library.delete(suffix.slice(1), Number(url.searchParams.get("revision"))));
    if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio to change presets." }, 403);
    const text = await request.text();
    if (text.length > 2_000_000) return json({ error: "That preset is too large to save." }, 413);
    let value: unknown;
    try { value = JSON.parse(text); } catch { return json({ error: "Invalid JSON." }, 400); }
    if (request.method === "POST" && !suffix) return json(library.save(value));
    if (request.method === "PATCH" && suffix) return json(library.rename(suffix.slice(1), value));
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof LibraryError) return json({ error: error.message }, error.status);
    hostFailure("library", "part_preset_request_failed", "Saved presets couldn't be read or written.", error);
    return json({ error: "Saved presets are unavailable right now; your work in the Studio is kept." }, 500);
  }
}
