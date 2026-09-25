/**
 * CORE-30: the released 0.1.0-alpha.1 lists a collection library only while the latest revision of
 * every collection is `xfas/collection-1`. This build never writes another row into the library:
 * what it saves stays listable by the release's own `list()` (vendored from 60a60e9).
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLLECTION_2_LIBRARY_MESSAGE, CollectionLibrary } from "../src/collection-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { COLLECTION_2 } from "../src/platform/api";
import { parseRecipeFile } from "../src/recipe";
import { alphaList } from "./fixtures/alpha-0.1.0/collection-list";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { recipeOf } from "./fixtures/looks";
import { fixedId } from "./fixtures/workspace-v1-fixtures";

function library() {
  const dir = mkdtempSync(join(tmpdir(), "xfs-alpha-library-")), path = join(dir, "library.sqlite");
  new LookLibrary(path).close();
  return { path, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing. */ } } };
}

test("0.1.0-alpha.1 lists every collection this build saves, and a collection only collection-2 holds is never saved", () => {
  const temp = library(), store = new CollectionLibrary(temp.path, STUDIO_PARTS);
  try {
    const saved = COLLECTION_FIXTURES.map(path => store.save({ collection: STUDIO_PARTS.readCollection(readFixture(path)) }));
    // Edits (including one that no longer needs recipe-11) and a second revision stay collection-1.
    const first = store.get(saved[0].collection.id), edited = structuredClone(first.collection);
    recipeOf(edited.presets[0]).layers[0].opacity = 0.5;
    store.save({ collection: edited, revision: first.revision });
    // A look with a part only collection-2 holds is refused with a plain message; the library is unchanged.
    const mixed = structuredClone(store.get(saved[1].collection.id));
    mixed.collection.presets[0].parts.hair = { schema: "xfs/hair-part-3", body: {} };
    expect(() => store.save({ collection: mixed.collection, revision: mixed.revision })).toThrow(COLLECTION_2_LIBRARY_MESSAGE);
    const ours = store.list();
    const db = new Database(temp.path, { readonly: true });
    try {
      const alpha = alphaList(db, parseRecipeFile);
      expect(alpha.map(({ id, name, revision, count }) => ({ id, name, revision, count })))
        .toEqual(ours.map(({ id, name, revision, count }) => ({ id, name, revision, count })));
      expect(alpha.find(item => item.id === saved[0].collection.id)?.revision).toBe(2);
    } finally { db.close(); }
  } finally { store.close(); temp.cleanup(); }
});

test("one collection-2 row makes the release's whole list fail: the limit the library guard exists for", () => {
  const temp = library(), store = new CollectionLibrary(temp.path, STUDIO_PARTS);
  try {
    store.save({ collection: STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0])) });
    store.close();
    // A row as an unreleased step-2 build could write it, inserted directly.
    const raw = new Database(temp.path), now = new Date().toISOString();
    const row = { schema: COLLECTION_2, id: fixedId(900), name: "Newer", presets: [{ id: fixedId(901), name: "Look", revision: 1,
      parts: { hair: { schema: "xfs/hair-part-3", body: {} } } }] };
    raw.query("INSERT INTO collections VALUES (?, ?)").run(row.id, now);
    raw.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(row.id, JSON.stringify(row), now);
    try { expect(() => alphaList(raw, parseRecipeFile)).toThrow("Expected a named XF Studio collection"); }
    finally { raw.close(); }
    // This build still lists and reads it.
    const reopened = new CollectionLibrary(temp.path, STUDIO_PARTS);
    try { expect(reopened.list().map(item => item.name)).toContain("Newer"); } finally { reopened.close(); }
  } finally { temp.cleanup(); }
});
