/**
 * CORE-123: the library writes each row in the oldest collection schema that holds it, and every row
 * it writes is one 0.1.0-alpha.2, the oldest published release, reads (its accepted schemas are
 * vendored from the tag in `fixtures/alpha-0.1.0-alpha.2/schemas.ts`). Ordinary eye-makeup
 * collections stay `xfas/collection-1`; a look with a tried expression saves as `xfs/collection-2`.
 * (The library used to refuse collection-2 rows for the unpublished 0.1.0-alpha.1, CORE-30.)
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import type { EditorSnapshot } from "../src/collection-session";
import { CollectionLibrary } from "../src/collection-store";
import { collectionDraft, emptyMemory } from "../src/collection-workspace";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { COLLECTION_1, COLLECTION_2, type LookCollection } from "../src/platform/api";
import { alpha2Unreadable } from "./fixtures/alpha-0.1.0-alpha.2/schemas";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { recipeOf } from "./fixtures/looks";

function library() {
  const dir = mkdtempSync(join(tmpdir(), "xfs-alpha-library-")), path = join(dir, "library.sqlite");
  new LookLibrary(path).close();
  return { path, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing. */ } } };
}

/** Every collection revision row in the library, parsed. */
function rows(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("SELECT collection_id AS id, revision, collection_json FROM collection_revisions ORDER BY rowid").all() as
      { id: string; revision: number; collection_json: string }[]).map(row => ({ id: row.id, revision: row.revision, json: JSON.parse(row.collection_json) }));
  } finally { db.close(); }
}

/** A tried expression, as the Expressions panel leaves it on a look (a start point, then an edit). */
const EXPRESSION = { schema: "xfs/expression-part-1", body: { label: "Warm smile", controls: { jaw_mid_open: 0.125, lips_l_corner_up: 0.5, lips_r_corner_up: 0.5 },
  links: {}, origin: { kind: "installed", clip: "warm_smile", set: "base\animations\facial\photomode.anims" } } };

/**
 * A collection service over the real library, editing the collection's first look; its expression, if any, is live in the
 * editor as the Expressions panel holds it.
 */
function serviceOver(store: CollectionLibrary, collection: LookCollection) {
  const transport: CollectionTransport = { list: async () => store.list(), get: async id => store.get(id),
    save: async (value, revision) => store.save({ collection: value, revision }), package: async () => { throw Error("unused"); } };
  const expression = collection.presets[0].parts.expressions?.body;
  let editor: EditorSnapshot = { recipe: structuredClone(recipeOf(collection.presets[0])), ...emptyMemory(),
    ...(expression ? { liveFeatures: { expressions: { part: structuredClone(expression) } } } : {}) };
  return new CollectionService(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS), { selected: "", name: "" },
    () => editor, value => editor = value, transport);
}

test("ordinary eye-makeup collections still save as collection-1 rows, all of which 0.1.0-alpha.2 reads", () => {
  const temp = library(), store = new CollectionLibrary(temp.path, STUDIO_PARTS);
  try {
    const saved = COLLECTION_FIXTURES.map(path => store.save({ collection: STUDIO_PARTS.readCollection(readFixture(path)) }));
    // Edits (including one that no longer needs recipe-11) and a second revision stay collection-1.
    const first = store.get(saved[0].collection.id), edited = structuredClone(first.collection);
    recipeOf(edited.presets[0]).layers[0].opacity = 0.5;
    store.save({ collection: edited, revision: first.revision });
    const written = rows(temp.path);
    expect(written.length).toBeGreaterThan(COLLECTION_FIXTURES.length);
    for (const row of written) {
      expect(row.json.schema).toBe(COLLECTION_1);
      expect(alpha2Unreadable(row.json)).toEqual([]);
    }
    expect(store.list().find(item => item.id === saved[0].collection.id)?.revision).toBe(2);
  } finally { store.close(); temp.cleanup(); }
});

test("Save keeps a look with a tried expression: a collection-2 revision 0.1.0-alpha.2 reads, expression intact (CORE-123)", async () => {
  const temp = library(), store = new CollectionLibrary(temp.path, STUDIO_PARTS);
  try {
    const collection = STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[1]));
    collection.presets[0].parts.expressions = STUDIO_PARTS.readCollection({ schema: COLLECTION_2, id: collection.id, name: collection.name,
      presets: [{ id: collection.presets[0].id, name: "Look", revision: 1, parts: { expressions: EXPRESSION } }] }).presets[0].parts.expressions;
    const service = serviceOver(store, collection);
    await service.execute({ kind: "initialize" });
    const save = await service.execute({ kind: "save" });
    expect(save).toMatchObject({ ok: true });
    expect(service.summary().draft?.revision).toBe(1);
    const [row] = rows(temp.path).filter(item => item.id === collection.id);
    expect(row.json.schema).toBe(COLLECTION_2);
    expect(alpha2Unreadable(row.json)).toEqual([]);
    expect(row.json.presets[0].parts.expressions).toEqual(EXPRESSION);
    // The rest of the looks keep eye makeup in its oldest part schema, carrying a recipe file alpha.2 reads.
    expect(row.json.presets.slice(1).every((look: { parts: Record<string, { schema: string }> }) =>
      Object.keys(look.parts).join() === "eye-makeup" && look.parts["eye-makeup"].schema === "xfs/eye-makeup-part-1")).toBe(true);
    // It lists and opens as saved; a second save of the unchanged draft adds a revision and no look versions.
    const opened = store.get(collection.id);
    expect(opened.collection.presets[0].parts.expressions).toEqual(EXPRESSION);
    expect(opened.collection.presets.some(look => look.locked)).toBe(false);
    const again = store.save({ collection: opened.collection, revision: opened.revision });
    expect(again.collection.presets.map(look => look.revision)).toEqual(opened.collection.presets.map(look => look.revision));
    // Taking the expression off goes back to collection-1.
    const plain = structuredClone(again.collection);
    delete plain.presets[0].parts.expressions;
    store.save({ collection: plain, revision: again.revision });
    expect(rows(temp.path).filter(item => item.id === collection.id).map(item => item.json.schema)).toEqual([COLLECTION_2, COLLECTION_2, COLLECTION_1]);
  } finally { store.close(); temp.cleanup(); }
});

test("export saves first whenever the library takes the collection, expressions included; a look from a newer build is exported unsaved (CORE-38)", async () => {
  const temp = library(), store = new CollectionLibrary(temp.path, STUDIO_PARTS);
  try {
    const file = readFixture(COLLECTION_FIXTURES[1]);
    // A look made with a newer XF Studio: kept exactly as it came, locked, and never saved to the library.
    const newer = STUDIO_PARTS.readCollection({ schema: COLLECTION_2, id: file.id, name: file.name, presets: file.presets.map(
      (preset: { id: string; name: string; revision: number; recipe: unknown }, i: number) => ({ id: preset.id, name: preset.name, revision: preset.revision,
        parts: { "eye-makeup": i === 1 ? { schema: "xfs/eye-makeup-part-9", body: { layers: [] } } : { schema: "xfs/eye-makeup-part-1", body: preset.recipe } } })) },
      false, "keep");
    expect(newer.presets.map(look => !!look.locked)).toEqual(newer.presets.map((_, i) => i === 1));
    const refused = serviceOver(store, newer), before = store.list();
    await refused.execute({ kind: "initialize" });
    for (const kind of ["exportCollection", "exportPlan"] as const) {
      expect(refused.capability({ kind })).toEqual({ available: true });
      const exported = await refused.execute({ kind });
      if (!exported.ok || exported.result.kind !== "export") throw Error(`${kind} failed: ${JSON.stringify(exported)}`);
      const json = JSON.parse(exported.result.json);
      if (kind === "exportCollection") {
        expect(json.schema).toBe(COLLECTION_2);
        expect(json.presets[1].parts["eye-makeup"]).toEqual({ schema: "xfs/eye-makeup-part-9", body: { layers: [] } });
      } else expect(json.presets.map((preset: { id: string }) => preset.id)).not.toContain(newer.presets[1].id);
      const message = refused.summary().progress!.message;
      expect(message).toContain("wasn't saved to your library: it has a look made with a newer version of XF Studio");
      expect(message).not.toContain("alpha");
    }
    // Nothing reached the library, and the draft still has no saved revision.
    expect(store.list()).toEqual(before);
    expect(refused.summary().draft?.revision).toBeUndefined();

    // A collection with a tried expression is saved first, then exported as collection-2.
    const withExpression = STUDIO_PARTS.readCollection(file);
    withExpression.presets[0].parts.expressions = STUDIO_PARTS.readCollection({ schema: COLLECTION_2, id: file.id, name: file.name,
      presets: [{ id: withExpression.presets[0].id, name: "Look", revision: 1, parts: { expressions: EXPRESSION } }] }).presets[0].parts.expressions;
    const expressive = serviceOver(store, withExpression);
    await expressive.execute({ kind: "initialize" });
    const exported = await expressive.execute({ kind: "exportCollection" });
    if (!exported.ok || exported.result.kind !== "export") throw Error(JSON.stringify(exported));
    const json = JSON.parse(exported.result.json);
    expect(json.schema).toBe(COLLECTION_2);
    expect(json.presets[0].parts.expressions).toEqual(EXPRESSION);
    expect(alpha2Unreadable(json)).toEqual([]);
    expect(expressive.summary().progress!.message).toContain("saved to your library");
    expect(store.list().find(item => item.id === withExpression.id)?.revision).toBe(1);
    expect(expressive.summary().draft?.revision).toBe(1);

    // An eye-makeup-only collection is saved first too, and exported as collection-1.
    const plainFile = readFixture(COLLECTION_FIXTURES[0]);
    const plain = serviceOver(store, STUDIO_PARTS.readCollection(plainFile));
    await plain.execute({ kind: "initialize" });
    const plainExport = await plain.execute({ kind: "exportCollection" });
    if (!plainExport.ok || plainExport.result.kind !== "export") throw Error(JSON.stringify(plainExport));
    expect(JSON.parse(plainExport.result.json).schema).toBe(COLLECTION_1);
    expect(store.list().find(item => item.id === plainFile.id)?.revision).toBe(1);
  } finally { store.close(); temp.cleanup(); }
});
