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
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import type { EditorSnapshot } from "../src/collection-session";
import { COLLECTION_2_LIBRARY_MESSAGE, CollectionLibrary } from "../src/collection-store";
import { collectionDraft, emptyMemory } from "../src/collection-workspace";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { COLLECTION_2, type LookCollection } from "../src/platform/api";
import { parseRecipeFile } from "../src/engines/layered-makeup/recipe";
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

test("export works for a collection the library refuses: its draft is exported unsaved, and a storable one is saved first (CORE-38)", async () => {
  const temp = library(), store = new CollectionLibrary(temp.path, STUDIO_PARTS);
  const transport: CollectionTransport = { list: async () => store.list(), get: async id => store.get(id),
    save: async (collection, revision) => store.save({ collection, revision }), package: async () => { throw Error("unused"); } };
  const service = (collection: LookCollection) => {
    let editor: EditorSnapshot = { recipe: structuredClone(recipeOf(collection.presets[0])), ...emptyMemory() };
    return new CollectionService(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS), { selected: "", name: "" },
      () => editor, value => editor = value, transport);
  };
  try {
    const file = readFixture(COLLECTION_FIXTURES[1]);
    // A look with a part only collection-2 holds.
    const mixed = STUDIO_PARTS.readCollection(file);
    mixed.presets[0].parts.hair = { schema: "xfs/hair-part-3", body: { style: "x" } };
    const refused = service(mixed), before = store.list();
    await refused.execute({ kind: "initialize" });
    const save = await refused.execute({ kind: "save" });
    expect(save).toMatchObject({ ok: false, message: COLLECTION_2_LIBRARY_MESSAGE });
    for (const kind of ["exportCollection", "exportPlan"] as const) {
      expect(refused.capability({ kind })).toEqual({ available: true });
      const exported = await refused.execute({ kind });
      if (!exported.ok || exported.result.kind !== "export") throw Error(`${kind} failed: ${JSON.stringify(exported)}`);
      const json = JSON.parse(exported.result.json);
      if (kind === "exportCollection") {
        expect(json.schema).toBe(COLLECTION_2);
        expect(json.presets[0].parts.hair).toEqual({ schema: "xfs/hair-part-3", body: { style: "x" } });
        expect(STUDIO_PARTS.readCollection(json).presets.map(look => look.id)).toEqual(mixed.presets.map(look => look.id));
      } else expect(json.presets.map((preset: { id: string }) => preset.id)).toEqual(mixed.presets.map(look => look.id));
      const message = refused.summary().progress!.message;
      expect(message).toContain("wasn't saved to your library");
      expect(message).not.toContain("export the collection to a file");
    }
    // Nothing reached the library, and the draft still has no saved revision.
    expect(store.list()).toEqual(before);
    expect(refused.summary().draft?.revision).toBeUndefined();

    // A collection the library takes is saved first, as before, and exported as collection-1.
    const plain = service(STUDIO_PARTS.readCollection(file));
    await plain.execute({ kind: "initialize" });
    const exported = await plain.execute({ kind: "exportCollection" });
    if (!exported.ok || exported.result.kind !== "export") throw Error(JSON.stringify(exported));
    expect(JSON.parse(exported.result.json).schema).toBe("xfas/collection-1");
    expect(plain.summary().progress!.message).toContain("saved to your library");
    expect(store.list().find(item => item.id === mixed.id)?.revision).toBe(1);
    expect(plain.summary().draft?.revision).toBe(1);
  } finally { store.close(); temp.cleanup(); }
});
