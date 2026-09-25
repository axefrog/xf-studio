/**
 * The released 0.1.0-alpha.1's collection-library list and its collection reader, vendored from
 * the tagged commit `60a60e9` (`src/collection-store.ts` `CollectionLibrary.list()` and
 * `src/preset-collection.ts` `parseCollection()`), so tests can check what that release does with
 * a library this build writes (CORE-30). The code is as released; only the recipe parser is
 * passed in (the release's own `parseRecipe` reads the same recipe files: its per-schema gates
 * were checked exhaustively against the current ones in step 3), and the class shell is reduced
 * to the one query `list()` runs. Test-only: never import it from `src/`.
 */
import type { Database } from "bun:sqlite";

type Recipe = unknown;
export type AlphaPresetCollection = { schema: "xfas/collection-1"; id: string; name: string;
  presets: { id: string; name: string; revision: number; recipe: Recipe }[] };
export type AlphaCollectionSummary = { id: string; name: string; revision: number; count: number; updatedAt: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120;

/** 0.1.0-alpha.1 `parseCollection` (60a60e9), verbatim apart from the injected recipe parser. */
export function alphaParseCollection(value: unknown, allowEmpty: boolean, parseRecipe: (value: unknown) => Recipe): AlphaPresetCollection {
  const input = value as AlphaPresetCollection;
  if (!input || input.schema !== "xfas/collection-1" || !uuid.test(input.id ?? "") || !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
    throw Error("Expected a named XF Studio collection with a stable UUID and at least one preset.");
  const seen = new Set<string>();
  const presets = input.presets.map(p => {
    if (!p || !uuid.test(p.id ?? "") || seen.has(p.id) || !title(p.name) || !Number.isSafeInteger(p.revision) || p.revision < 1)
      throw Error("Preset identities must be unique UUIDs with a name and positive revision.");
    seen.add(p.id);
    return { id:p.id,name:p.name,revision:p.revision,recipe:parseRecipe(p.recipe) };
  });
  return { schema:input.schema,id:input.id,name:input.name,presets };
}

/** 0.1.0-alpha.1 `CollectionLibrary.list()` (60a60e9) over an open library database. */
export function alphaList(db: Database, parseRecipe: (value: unknown) => Recipe): AlphaCollectionSummary[] {
  return (db.query(`SELECT collection_json, revision, created_at AS updatedAt FROM collection_revisions r
    WHERE revision=(SELECT MAX(revision) FROM collection_revisions WHERE collection_id=r.collection_id)
    ORDER BY (SELECT created_at FROM collections WHERE id=r.collection_id), collection_id`).all() as
    { collection_json: string; revision: number; updatedAt: string }[]).map(row => {
      const collection = alphaParseCollection(JSON.parse(row.collection_json), true, parseRecipe);
      return { id: collection.id, name: collection.name, count: collection.presets.length, revision: row.revision, updatedAt: row.updatedAt };
    });
}
