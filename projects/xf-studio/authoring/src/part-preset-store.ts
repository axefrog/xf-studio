import { BodyTooLargeError, readBodyText } from "./request-body";
import { Database } from "bun:sqlite";
import { isNewerData, modNameIssue, type PartEnvelope } from "./platform/api";
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
 * is left as it is, so the collection and look tables, their rows and the library version are untouched: a build without this table
 * (0.1.0-alpha.1, never published) lists the library exactly as before and never reads it; 0.1.0-alpha.2, the oldest published
 * release, has this same table. Each row's part is stored in its
 * feature's current part schema; a row of a schema this build doesn't read (a newer build's) is kept and left out of lists, never
 * rewritten or dropped. Rename and delete take the revision they were shown, so a stale window can't overwrite a newer change.
 */
export type PartPresetSummary = { id: string; feature: string; name: string; revision: number; part: PartEnvelope; updatedAt: string };
/**
 * Which photo-mode expression table a set's mod carries (expression-editor-design.md §6.3): the player's installed one, so it works beside
 * the expression mods they have, or the game's own, for a mod to share.
 */
export type PartPresetSetTable = "installed" | "sharing";
/**
 * A named, ordered set of a feature's saved presets (an expression set: expression-editor-design.md §6.4), exported as one mod. Members are
 * preset IDs; one whose preset is gone stays listed until the person removes it (export reports it). `modName` is the person's name for
 * the mod (absent: the default); `table` is absent for the default ("installed").
 */
export type PartPresetSetSummary = { id: string; feature: string; name: string; revision: number; members: string[]; modName?: string;
  table?: PartPresetSetTable; updatedAt: string };
/** Most members of one set. */
export const PART_PRESET_SET_MEMBERS = 500;
/** What putting a deleted preset back needs: the preset as it was and where it sat in each set. */
export type PartPresetRestore = { feature: string; id: string; name: string; part: PartEnvelope; createdAt: string;
  memberships: { set: string; index: number }[] };

/** Longest preset name. */
export const PART_PRESET_NAME_LIMIT = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A set row's body, or null (logged as a warning, the row kept as it is) when it is damaged (CORE-116). */
function setBody(set: SetRow): Record<string, unknown> | null {
  try {
    const body = JSON.parse(set.body) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
    throw Error("not an object");
  } catch (error) {
    hostFailure("library", "part_preset_set_unreadable", "A saved set couldn't be read; it is kept as it is.", error, "warn");
    return null;
  }
}

export class PartPresetLibrary {
  private db: Database;
  constructor(path: string, private parts: PartRegistry, private newId: () => string = () => crypto.randomUUID()) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS part_presets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL,
      revision INTEGER NOT NULL, schema TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS part_presets_feature ON part_presets(feature, name);
      CREATE TABLE IF NOT EXISTS part_preset_sets (feature TEXT NOT NULL, id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
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
  /**
   * Rename a preset, guarded by its revision. With `part` (in any schema its feature reads) the preset's part is replaced too, in the same
   * step: an expression's photo-mode name lives in its part, so renaming what photo mode shows changes both.
   */
  rename(id: string, value: unknown): { id: string; name: string; revision: number; part?: PartEnvelope } {
    const input = value as { name?: unknown; revision?: unknown; part?: unknown } | null;
    const name = this.name(input?.name);
    return this.db.transaction(() => {
      const row = this.current(id, input?.revision), revision = row.revision + 1, now = new Date().toISOString();
      if (input?.part === undefined) {
        this.db.query("UPDATE part_presets SET name=?, revision=?, updated_at=? WHERE id=?").run(name, revision, now, id);
        return { id, name, revision };
      }
      let part: PartEnvelope;
      try { part = this.parts.readPart(row.feature, input.part); }
      catch (error) { throw new LibraryError(isNewerData(error) ? "That preset was made with a newer version of XF Studio." : "That preset is damaged; nothing was saved.", 422); }
      this.db.query("UPDATE part_presets SET name=?, revision=?, schema=?, body=?, updated_at=? WHERE id=?").run(name, revision, part.schema, JSON.stringify(part.body), now, id);
      return { id, name, revision, part };
    }).immediate();
  }
  /**
   * Delete a preset, guarded by its revision, and take it out of every set of its feature in the same step. The answer carries what
   * `restore` needs to put both back (the Undo a person gets right after deleting).
   */
  delete(id: string, revision: unknown): { id: string; restore?: PartPresetRestore } {
    return this.db.transaction(() => {
      this.current(id, revision);
      const row = this.db.query("SELECT feature, name, schema, body, created_at AS createdAt FROM part_presets WHERE id=?").get(id) as
        { feature: string; name: string; schema: string; body: string; createdAt: string };
      const memberships: { set: string; index: number }[] = [];
      for (const set of this.db.query("SELECT id, feature, name, revision, body, updated_at AS updatedAt FROM part_preset_sets WHERE feature=?").all(row.feature) as SetRow[]) {
        // A damaged set is skipped and kept as it is (CORE-116): it never stops a delete.
        const body = setBody(set);
        if (!body) continue;
        const members = Array.isArray(body.members) ? body.members as unknown[] : [];
        const index = members.indexOf(id);
        if (index < 0) continue;
        memberships.push({ set: set.id, index });
        body.members = members.filter(member => member !== id);
        this.db.query("UPDATE part_preset_sets SET revision=?, body=?, updated_at=? WHERE id=?").run(set.revision + 1, JSON.stringify(body), new Date().toISOString(), set.id);
      }
      this.db.query("DELETE FROM part_presets WHERE id=?").run(id);
      // A damaged preset is deleted all the same; only its Undo is lost.
      let body: unknown;
      try { body = JSON.parse(row.body); } catch { return { id }; }
      return { id, restore: { feature: row.feature, id, name: row.name, part: { schema: row.schema, body }, createdAt: row.createdAt, memberships } };
    }).immediate();
  }
  /** Put a deleted preset back under its own ID, and back in the sets it was in (where they still exist), at its old places. */
  restore(value: unknown): PartPresetSummary {
    const input = value as Partial<PartPresetRestore> | null;
    const feature = this.registered(input?.feature), name = this.name(input?.name);
    if (typeof input?.id !== "string" || !UUID.test(input.id) || !Array.isArray(input.memberships)) throw new LibraryError("That preset can't be restored.", 422);
    let part: PartEnvelope;
    try { part = this.parts.readPart(feature, input.part); }
    catch { throw new LibraryError("That preset can't be restored.", 422); }
    const id = input.id, now = new Date().toISOString(), created = typeof input.createdAt === "string" ? input.createdAt : now;
    return this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM part_presets WHERE id=?").get(id)) throw new LibraryError("That preset is already back.", 409);
      this.db.query("INSERT INTO part_presets VALUES (?, ?, ?, 1, ?, ?, ?, ?)").run(feature, id, name, part.schema, JSON.stringify(part.body), created, now);
      for (const membership of input.memberships!) {
        const set = this.db.query("SELECT id, feature, name, revision, body, updated_at AS updatedAt FROM part_preset_sets WHERE id=? AND feature=?")
          .get(String(membership?.set ?? ""), feature) as SetRow | null;
        const body = set ? setBody(set) : null;
        if (!set || !body) continue;
        const members = (Array.isArray(body.members) ? body.members as unknown[] : []).filter(member => member !== id);
        if (members.length >= PART_PRESET_SET_MEMBERS) continue;
        members.splice(Math.max(0, Math.min(members.length, Number(membership.index) || 0)), 0, id);
        body.members = members;
        this.db.query("UPDATE part_preset_sets SET revision=?, body=?, updated_at=? WHERE id=?").run(set.revision + 1, JSON.stringify(body), now, set.id);
      }
      return { id, feature, name, revision: 1, part, updatedAt: now };
    }).immediate();
  }

  // ---- Sets: named, ordered lists of a feature's presets (an expression set exports as one mod) ----

  private setName(value: unknown): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name) throw new LibraryError("Give the set a name.");
    if (name.length > PART_PRESET_NAME_LIMIT) throw new LibraryError(`A set name is at most ${PART_PRESET_NAME_LIMIT} characters.`);
    return name;
  }
  private members(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > PART_PRESET_SET_MEMBERS || value.some(id => typeof id !== "string" || !UUID.test(id)) ||
        new Set(value).size !== value.length)
      throw new LibraryError("That set's list of presets is damaged; nothing was changed.", 422);
    return [...value] as string[];
  }
  /** A set as stored: members, and the mod name and table when the person chose them. Unknown body fields are kept (a newer build's). */
  private readSet(row: SetRow): PartPresetSetSummary {
    const body = JSON.parse(row.body) as { members?: unknown; modName?: unknown; table?: unknown };
    const members = Array.isArray(body.members) ? body.members.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [];
    return { id: row.id, feature: row.feature, name: row.name, revision: row.revision, members,
      ...(typeof body.modName === "string" && !modNameIssue(body.modName) ? { modName: body.modName } : {}),
      ...(body.table === "sharing" ? { table: "sharing" as const } : {}), updatedAt: row.updatedAt };
  }
  /** A feature's sets, by name. */
  listSets(featureValue: unknown): PartPresetSetSummary[] {
    const feature = this.registered(featureValue);
    const rows = this.db.query("SELECT id, feature, name, revision, body, updated_at AS updatedAt FROM part_preset_sets WHERE feature=? ORDER BY name COLLATE NOCASE, id")
      .all(feature) as SetRow[];
    return rows.flatMap(row => {
      try { return [this.readSet(row)]; }
      catch (error) { hostFailure("library", "part_preset_set_unreadable", "A saved set couldn't be read; it is kept as it is.", error, "warn"); return []; }
    });
  }
  /** A new set of `feature` named `name`, holding `members` (default none). */
  createSet(value: unknown): PartPresetSetSummary {
    const input = value as { feature?: unknown; name?: unknown; members?: unknown } | null;
    const feature = this.registered(input?.feature), name = this.setName(input?.name);
    const members = input?.members === undefined ? [] : this.members(input.members);
    const id = this.newId(), now = new Date().toISOString();
    this.db.query("INSERT INTO part_preset_sets VALUES (?, ?, ?, 1, ?, ?, ?)").run(feature, id, name, JSON.stringify({ members }), now, now);
    return { id, feature, name, revision: 1, members, updatedAt: now };
  }
  /**
   * Change a set, guarded by the revision it was shown: its `name`, `members` (the whole ordered list), `modName` (an empty string goes
   * back to the default) and `table` ("installed" is the default). Fields it doesn't name stay as they are.
   */
  updateSet(id: string, value: unknown): PartPresetSetSummary {
    const input = value as { revision?: unknown; name?: unknown; members?: unknown; modName?: unknown; table?: unknown } | null;
    const name = input?.name === undefined ? undefined : this.setName(input.name);
    const members = input?.members === undefined ? undefined : this.members(input.members);
    let modName: string | null | undefined;
    if (input?.modName !== undefined) {
      if (typeof input.modName !== "string") throw new LibraryError("That mod name can't be used.", 422);
      const trimmed = input.modName.trim(), issue = trimmed ? modNameIssue(trimmed) : undefined;
      if (issue) throw new LibraryError(issue, 422);
      modName = trimmed || null;
    }
    if (input?.table !== undefined && input.table !== "installed" && input.table !== "sharing") throw new LibraryError("That table choice isn't known.", 422);
    return this.db.transaction(() => {
      const row = this.currentSet(id, input?.revision);
      const body = JSON.parse(row.body) as Record<string, unknown>;
      if (members) body.members = members;
      if (modName === null) delete body.modName; else if (modName !== undefined) body.modName = modName;
      if (input?.table === "installed") delete body.table; else if (input?.table === "sharing") body.table = "sharing";
      const revision = row.revision + 1, now = new Date().toISOString(), text = JSON.stringify(body);
      this.db.query("UPDATE part_preset_sets SET name=?, revision=?, body=?, updated_at=? WHERE id=?").run(name ?? row.name, revision, text, now, id);
      return this.readSet({ ...row, name: name ?? row.name, revision, body: text, updatedAt: now });
    }).immediate();
  }
  deleteSet(id: string, revision: unknown): { id: string } {
    return this.db.transaction(() => {
      this.currentSet(id, revision);
      this.db.query("DELETE FROM part_preset_sets WHERE id=?").run(id);
      return { id };
    }).immediate();
  }
  private currentSet(id: string, revision: unknown): SetRow {
    if (!UUID.test(id)) throw new LibraryError("Not found.", 404);
    const row = this.db.query("SELECT id, feature, name, revision, body, updated_at AS updatedAt FROM part_preset_sets WHERE id=?").get(id) as SetRow | null;
    if (!row) throw new LibraryError("That set no longer exists.", 404);
    if (row.revision !== revision) throw new LibraryError("That set changed in another window. Look again, then try once more.", 409);
    return row;
  }
}
type SetRow = { id: string; feature: string; name: string; revision: number; body: string; updatedAt: string };

/** `GET <prefix>/sets?feature=` lists sets, `POST <prefix>/sets` creates, `PATCH <prefix>/sets/<id>` changes, `DELETE …?revision=` removes. */
async function setRequest(request: Request, library: PartPresetLibrary, rest: string, url: URL, origin: string | null,
  json: (value: unknown, status?: number) => Response): Promise<Response> {
  if (request.method === "GET" && !rest) return json(library.listSets(url.searchParams.get("feature")));
  if (origin !== url.origin) return json({ error: "Use the local studio to change sets." }, 403);
  if (request.method === "DELETE" && rest) return json(library.deleteSet(rest.slice(1), Number(url.searchParams.get("revision"))));
  if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio to change sets." }, 403);
  let value: unknown;
  try { value = JSON.parse(await readBodyText(request, PART_PRESET_BODY_BYTES)); }
  catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: "That set is too large to save." }, 413);
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "Invalid JSON." }, 400);
  if (request.method === "POST" && !rest) return json(library.createSet(value));
  if (request.method === "PATCH" && rest) return json(library.updateSet(rest.slice(1), value));
  return json({ error: "Method not allowed." }, 405);
}

/** Most bytes of one saved preset's request body. */
export const PART_PRESET_BODY_BYTES = 2_000_000;
/**
 * `GET <prefix>?feature=<id>` lists, `POST <prefix>` saves `{feature, name, part}`, `PATCH <prefix>/<id>` renames `{name, revision}`
 * and `DELETE <prefix>/<id>?revision=<n>` removes. Same-origin local requests only, as the collection library.
 */
export async function partPresetRequest(request: Request, library: PartPresetLibrary, prefix: string): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get("Origin"), suffix = url.pathname.slice(prefix.length);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
  const sets = suffix === "/sets" || suffix.startsWith("/sets/"), rest = sets ? suffix.slice(5) : suffix;
  const restoring = suffix === "/restore";
  if (rest && !restoring && !/^\/[0-9a-f-]{36}$/.test(rest)) return json({ error: "Not found." }, 404);
  try {
    if (sets) return await setRequest(request, library, rest, url, origin, json);
    if (request.method === "GET" && !suffix) return json(library.list(url.searchParams.get("feature")));
    if (origin !== url.origin) return json({ error: "Use the local studio to change presets." }, 403);
    if (request.method === "DELETE" && suffix) return json(library.delete(suffix.slice(1), Number(url.searchParams.get("revision"))));
    if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio to change presets." }, 403);
    // Read within the limit, never whole first; JSON that isn't an object is refused plainly (CORE-106).
    let value: unknown;
    try { value = JSON.parse(await readBodyText(request, PART_PRESET_BODY_BYTES)); }
    catch (error) {
      if (error instanceof BodyTooLargeError) return json({ error: "That preset is too large to save." }, 413);
      return json({ error: "Invalid JSON." }, 400);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "Invalid JSON." }, 400);
    if (request.method === "POST" && !suffix) return json(library.save(value));
    if (request.method === "POST" && restoring) return json(library.restore(value));
    if (request.method === "PATCH" && suffix) return json(library.rename(suffix.slice(1), value));
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof LibraryError) return json({ error: error.message }, error.status);
    hostFailure("library", "part_preset_request_failed", "Saved presets couldn't be read or written.", error);
    return json({ error: "Saved presets are unavailable right now; your work in the Studio is kept." }, 500);
  }
}
