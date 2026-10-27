import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { collectionRequest } from "../src/library/host/collection-store";
import { LookLibrary } from "../src/library/host/library-store";
import { LIBRARY_MIGRATIONS } from "../src/library/host/library-migrations";
import { hostClock } from "../src/platform/core/clock";
import { LibraryDatabase } from "../src/platform/persistence/library-database";
import { openTestLibrary, type TestLibrary } from "./fixtures/library-file";
import { emptyRecipe } from "../src/app/workspace/makeup-workspace";
import { parseCollection, planCollection } from "../src/legacy/eye-makeup/export/preset-collection";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { initialRecipe } from "./fixtures/eye-region";
import { profileStudio } from "./fixtures/profile-studio";
import { COLLECTION_2 } from "../src/platform/api";
import { tempDir } from "./temp-dir";

test("preset switching keeps each look's edits, selection and Undo; structural operations preserve export identity; a restart restores removals", async () => {
  const studio = await profileStudio({ name: "Looks", looks: [{ name: "Original", recipe: initialRecipe() }] });
  await studio.collection.initialize();
  const { app, document } = studio, original = studio.scene.look()!.look, collection = studio.shown()!;
  const ok = (action: Parameters<typeof app.dispatch>[0]) => expect(app.dispatch(action).ok).toBe(true);
  ok({ kind: "layer.select", layerId: document.recipe.layers[2]!.id });
  ok({ kind: "point.select", layerId: document.recipe.layers[2]!.id, index: 3 });
  ok({ kind: "layer.setColor", layerId: document.recipe.layers[0]!.id, color: "#123456" });
  ok({ kind: "preset.edit", command: { kind: "copy", id: original } });
  const copyId = studio.scene.look()!.look; expect(copyId).not.toBe(original);
  ok({ kind: "layer.setColor", layerId: document.recipe.layers[0]!.id, color: "#aabbcc" });
  ok(studio.choose(original));
  expect(document.recipe.layers[0]!.color).toBe("#123456"); expect(document.active).toBe(2); expect(document.selected).toBe(3);
  expect(app.history().depth).toBe(1);
  const plan = () => { const value = STUDIO_DOCUMENTS.parts.readCollection({ schema: COLLECTION_2, id: collection, name: "Looks",
    presets: studio.owner.looksOf(collection).map(look => ({ id: look.id, name: look.name, revision: 1, parts: look.parts })) }, true);
    return planCollection(value as never); };
  studio.lookEditor.commit();
  const before = plan();
  ok({ kind: "preset.edit", command: { kind: "rename", id: original, name: "Renamed" } });
  ok({ kind: "preset.edit", command: { kind: "move", id: original, to: 1 } });
  const after = plan();
  expect(after.presets[1].appAppearance).toBe(before.presets[0].appAppearance);
  ok({ kind: "preset.edit", command: { kind: "remove", id: original } }); ok({ kind: "preset.edit", command: { kind: "remove", id: copyId } });
  expect(document.recipe).toEqual(emptyRecipe()); expect(studio.collection.summary().draft!.presets).toHaveLength(0);
  expect(() => plan()).toThrow();
  // A restart restores the removals: the newest first, each with its own edits and selection.
  await studio.settle();
  const resumed = await profileStudio({ library: studio.library, show: { collection, look: original } });
  await resumed.collection.initialize();
  expect(resumed.service.summary().draft!.removed.map(item => item.id)).toEqual([original, copyId]);
  expect(resumed.app.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
  expect(resumed.document.recipe.layers[0]!.color).toBe("#aabbcc");
  expect(resumed.app.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
  expect(resumed.document.recipe.layers[0]!.color).toBe("#123456"); expect(resumed.document.active).toBe(2);
  expect(resumed.scene.look()!.look).toBe(original);
});

test("opening a collection replaces nothing and Undo open shows the one before; a recipe imports as a preset of its own", async () => {
  const studio = await profileStudio({ name: "A", looks: [{ name: "A1", recipe: initialRecipe() }] });
  await studio.collection.initialize();
  studio.app.dispatch({ kind: "layer.setColor", layerId: studio.document.recipe.layers[0]!.id, color: "#ffeedd" });
  const prior = studio.shown();
  const text = JSON.stringify({ schema: COLLECTION_2, id: crypto.randomUUID(), name: "B", presets: [
    { id: crypto.randomUUID(), name: "B1", revision: 1, parts: { "eye-makeup": STUDIO_DOCUMENTS.parts.envelope("eye-makeup", emptyRecipe()) } }] });
  expect((await studio.collection.execute({ kind: "import", text, bytes: text.length })).ok).toBe(true);
  expect(studio.document.recipe.layers).toHaveLength(0);
  expect(studio.collection.dispatch({ kind: "collection.undoOpen" }).ok).toBe(true);
  expect(studio.document.recipe.layers[0]!.color).toBe("#ffeedd"); expect(studio.shown()).toBe(prior);
  studio.collection.importRecipe(initialRecipe(), "Portable", studio.shown()!);
  expect(studio.collection.summary().draft!.presets.map(preset => preset.name)).toEqual(["A1", "Portable"]);
  void parseCollection;
});

test("SQLite migration preserves look revisions; collection saves are atomic, ordered and conflict-protected", () => {
  const dir = tempDir("xfs-collections-"), path = join(dir, "library.sqlite");
  // A version-1 library (looks only), as builds before the collection library left it.
  const v1 = LibraryDatabase.open(path, { clock: hostClock(), migrations: LIBRARY_MIGRATIONS.slice(0, 1), backups: null });
  let file: TestLibrary | undefined;
  try {
    const old = new LookLibrary(v1).save({ name: "Old look", recipe: initialRecipe() });
    v1.close();
    const raw = new Database(path), originalRows = raw.query("SELECT * FROM look_revisions").all();
    file = openTestLibrary(path);
    let db = file.collections;
    const initial = db.get(db.list()[0].id);
    expect(initial.collection.presets[0].id).toBe(old.id); expect(initial.revision).toBe(1);
    expect(raw.query("SELECT * FROM look_revisions").all()).toEqual(originalRows);
    const edited = structuredClone(initial.collection); edited.presets[0].name = "Revised";
    edited.presets.push({ ...structuredClone(edited.presets[0]), id: crypto.randomUUID(), name: "Second" });
    const second = db.save({ collection: edited, revision: 1 });
    expect(second.collection.presets[0].revision).toBe(2);
    expect(() => db!.save({ collection: initial.collection, revision: 1 })).toThrow("another window");
    expect(db.get(initial.collection.id)).toEqual(second);
    const reordered = { ...second.collection, presets: [...second.collection.presets].reverse() };
    const third = db.save({ collection: reordered, revision: 2 });
    expect(third.collection.presets[1].revision).toBe(2);
    const empty = db.save({ collection: { ...third.collection, presets: [] }, revision: 3 });
    expect(empty.collection.presets).toHaveLength(0);
    const recovered = db.save({ collection: initial.collection, revision: 4 });
    expect(recovered.collection.presets[0].revision).toBe(3); // Never reuse revision 1 after removal and older restoration.
    expect(db.get(initial.collection.id, 2)).toEqual(second);
    raw.close(); file.close();
    file = openTestLibrary(path); db = file.collections;
    expect(file.looks.get(old.id)).toEqual(old); expect(db.get(initial.collection.id)).toEqual(recovered);
    const separate = db.save({ collection: { ...edited, id: crypto.randomUUID() } });
    expect(separate.revision).toBe(1); expect(db.list()).toHaveLength(2);
    expect(() => db!.save({ collection: { ...edited, presets: [{ ...edited.presets[0],
      parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-1", body: {} } } }] }, revision: 5 })).toThrow("Invalid");
    expect(db.get(initial.collection.id)).toEqual(recovered);
  } finally { v1.close(); file?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("collection API preserves legacy looks and rejects foreign, stale and destructive requests", async () => {
  const dir = tempDir("xfs-collection-api-"), path = join(dir, "test.sqlite");
  const file = openTestLibrary(path), looks = file.looks, db = file.collections;
  const prefix = "/api/verification/collections", origin = "http://127.0.0.1:4317";
  const request = (suffix: string, method = "GET", value?: unknown, source = origin) => new Request(origin + prefix + suffix,
    { method, headers: { Origin: source, "Content-Type": "application/json" }, body: value ? JSON.stringify(value) : undefined });
  try {
    // A fresh library starts empty (no phantom collection, release-readiness-audit.md item 11); the first save makes version 1.
    expect(db.list()).toEqual([]);
    const initial = db.save({ collection: { schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Makeup collection", presets: [] } });
    const value = { collection: initial.collection, revision: initial.revision };
    expect((await collectionRequest(request("", "POST", value, "https://example.com"), db, prefix)).status).toBe(403);
    expect((await collectionRequest(request("", "POST", value), db, prefix)).status).toBe(200);
    expect((await collectionRequest(request("", "POST", value), db, prefix)).status).toBe(409);
    expect((await collectionRequest(request("/" + initial.collection.id, "DELETE"), db, prefix)).status).toBe(405);
    const got = await (await collectionRequest(request("/" + initial.collection.id), db, prefix)).json();
    expect(parseCollection(got.collection, true).id).toBe(initial.collection.id);
    expect(looks.list()).toHaveLength(0);
  } finally { file.close(); rmSync(dir, { recursive: true, force: true }); }
});
