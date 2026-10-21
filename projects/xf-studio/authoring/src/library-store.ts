import type { Recipe } from "./engines/layered-makeup/recipe";
import { readRecipe as parseRecipe, recipeFile } from "./recipe-schema";
import { hostFailure } from "./diagnostics/host-log";
import type { LibraryDatabase } from "./platform/persistence/library-database";

export type LookSummary = { id: string; name: string; revision: number; updatedAt: string };
export type StoredLook = LookSummary & { recipe: Recipe };
export class LibraryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/**
 * Local editable source library. Exported game resources are separate build artifacts. Its tables are the library file's
 * `looks-1` step (library-migrations.ts); the file's owner (`LibraryDatabase`) holds the connection.
 */
export class LookLibrary {
  constructor(private readonly db: LibraryDatabase) {}
  list(): LookSummary[] {
    return this.db.read(db => db.query(`SELECT look_id AS id, name, revision, created_at AS updatedAt
      FROM look_revisions r WHERE revision=(SELECT MAX(revision) FROM look_revisions WHERE look_id=r.look_id)
      ORDER BY created_at DESC, look_id`).all() as LookSummary[]);
  }
  get(id: string, revision?: number): StoredLook {
    const row = this.db.read(db => db.query(`SELECT look_id AS id, name, revision, created_at AS updatedAt, recipe_json
      FROM look_revisions WHERE look_id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1`)
      .get(id, revision ?? null, revision ?? null) as (LookSummary & { recipe_json: string }) | null);
    if (!row) throw new LibraryError("Look not found.", 404);
    const { recipe_json, ...summary } = row;
    return { ...summary, recipe: parseRecipe(JSON.parse(recipe_json)) };
  }
  save(value: unknown, id?: string): StoredLook {
    const input = value as { name?: unknown; recipe?: unknown; revision?: unknown } | null;
    if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)
      throw new LibraryError("Give the look a name (1–120 characters).");
    let recipe: Recipe;
    try { recipe = parseRecipe(input.recipe); }
    catch { throw new LibraryError("Invalid makeup recipe; nothing was saved."); }
    if (id && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1))
      throw new LibraryError("A revision is required to update a look.");
    const name = input.name.trim();
    return this.db.write(db => {
      const lookId = id ?? crypto.randomUUID();
      let revision = 1;
      if (id) {
        const current = this.get(id);
        if (current.revision !== input.revision)
          throw new LibraryError("This look changed in another window. Open it again or save a copy.", 409);
        revision = current.revision + 1;
      }
      const now = new Date().toISOString();
      if (!id) db.query("INSERT INTO looks VALUES (?, ?)").run(lookId, now);
      db.query("INSERT INTO look_revisions VALUES (?, ?, ?, ?, ?)")
        // Rows hold a recipe file in the oldest schema that holds it, which older builds read.
        .run(lookId, revision, name, JSON.stringify(recipeFile(recipe) ?? recipe), now);
      return { id: lookId, name, revision, updatedAt: now, recipe };
    });
  }
}

export async function libraryRequest(request: Request, library: LookLibrary, prefix: string): Promise<Response> {
  const url = new URL(request.url);
  const json = (value: unknown, status = 200) => Response.json(value, {
    status, headers: { "Cache-Control": "no-store" },
  });
  const origin = request.headers.get("Origin");
  if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
    return json({ error: "Local studio requests only." }, 403);
  const suffix = url.pathname.slice(prefix.length);
  if (suffix && !/^\/[0-9a-f-]{36}$/.test(suffix)) return json({ error: "Not found." }, 404);
  const id = suffix.slice(1);
  try {
    if (request.method === "GET") return json(id ? library.get(id) : library.list());
    if (request.method !== (id ? "PUT" : "POST")) return json({ error: "Method not allowed." }, 405);
    if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ error: "Use the local studio to save looks." }, 403);
    const body = await request.text();
    if (body.length > 1_000_000) return json({ error: "Recipe is too large." }, 413);
    let data: unknown;
    try { data = JSON.parse(body); } catch { return json({ error: "Invalid JSON." }, 400); }
    return json(library.save(data, id || undefined), id ? 200 : 201);
  } catch (error) {
    if (error instanceof LibraryError) return json({ error: error.message }, error.status);
    hostFailure("library", "library_request_failed", "The library couldn't be read or written.", error);
    return json({ error: "Library could not be accessed. Your browser draft is still available." }, 500);
  }
}
