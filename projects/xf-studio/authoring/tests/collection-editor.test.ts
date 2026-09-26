import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionLibrary, collectionRequest } from "../src/collection-store";
import { LookLibrary } from "../src/library-store";
import { CollectionSession, type EditorSnapshot } from "../src/collection-session";
import { COLLECTION_RECOVERY_LIMIT, collectionDraft, emptyMemory, emptyRecipe } from "../src/collection-workspace";
import { historyRecipes } from "./fixtures/looks";
import { parseCollection, planCollection } from "../src/preset-collection";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { recipeOf } from "./fixtures/looks";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { initialRecipe, freshWorkspace } from "./fixtures/eye-region";

test("preset switching retains unsaved recipes, selections and Undo; structural operations preserve export identity", () => {
  const id = crypto.randomUUID(), original = { id: crypto.randomUUID(), name: "Original", revision: 1, recipe: initialRecipe() };
  let editor: EditorSnapshot = { recipe: original.recipe, active: 2, selected: 3, history: [initialRecipe()] };
  const session = new CollectionSession(STUDIO_DOCUMENTS, collectionDraft({ schema: "xfas/collection-1", id, name: "Looks", presets: [original] }, STUDIO_DOCUMENTS),
    () => editor, e => editor = e);
  editor.recipe.layers[0].color = "#123456";
  session.edit({ kind: "copy", id: original.id });
  const copyId = session.state.selected!; expect(copyId).not.toBe(original.id);
  editor.recipe.layers[0].color = "#aabbcc";
  session.select(original.id);
  expect(editor.recipe.layers[0].color).toBe("#123456"); expect(editor.active).toBe(2); expect(editor.selected).toBe(3);
  expect(historyRecipes(editor.history)).toHaveLength(1);
  const before = planCollection(session.snapshot().collection);
  session.edit({ kind: "rename", id: original.id, name: "Renamed" });
  session.edit({ kind: "move", id: original.id, to: 1 });
  const after = planCollection(session.snapshot().collection);
  expect(after.presets[1].appAppearance).toBe(before.presets[0].appAppearance);
  session.edit({ kind: "remove", id: original.id }); session.edit({ kind: "remove", id: copyId });
  expect(editor.recipe).toEqual(emptyRecipe()); expect(session.state.collection.presets).toHaveLength(0);
  expect(() => planCollection(session.state.collection)).toThrow();
  const workspace = freshWorkspace(); workspace.collections = session.snapshot();
  // Sidebar-shell disclosure state saved by earlier builds is ignored on restore.
  const stored = serializeWorkspace(workspace, STUDIO_DOCUMENTS);
  const restored = parseWorkspace(JSON.parse(JSON.stringify({ ...stored,
    collections: { ...stored.collections, filesOpen: true, expanded: false } })), STUDIO_DOCUMENTS);
  expect(restored.collections!.removed).toHaveLength(2); expect(restored.recipe.layers).toHaveLength(0);
  expect(restored.collections).not.toHaveProperty("filesOpen");
  expect(restored.collections).not.toHaveProperty("expanded");
  const resumed = new CollectionSession(STUDIO_DOCUMENTS, restored.collections!, () => editor, e => editor = e);
  resumed.edit({ kind: "restore" }); expect(editor.recipe.layers[0].color).toBe("#aabbcc");
  resumed.edit({ kind: "restore" }); expect(editor.recipe.layers[0].color).toBe("#123456"); expect(editor.active).toBe(2);
  expect(resumed.state.selected).toBe(original.id);
});

test("opening collections is recoverable and save completion never overwrites edits made in flight", () => {
  const a = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name: "A", presets: [
    { id: crypto.randomUUID(), name: "A1", revision: 1, recipe: initialRecipe() }] };
  let editor: EditorSnapshot = { recipe: a.presets[0].recipe, ...emptyMemory() };
  const session = new CollectionSession(STUDIO_DOCUMENTS, collectionDraft(a, STUDIO_DOCUMENTS), () => editor, e => editor = e);
  const sent = session.snapshot().collection;
  editor.recipe.layers[0].color = "#ffeedd";
  session.saved({ collection: { ...sent, id: crypto.randomUUID() }, revision: 1, updatedAt: "now" }, a.id);
  expect(recipeOf(session.snapshot().collection.presets[0]).layers[0].color).toBe("#ffeedd");
  const priorId = session.state.collection.id;
  session.open({ ...a, id: crypto.randomUUID(), presets: [] });
  expect(editor.recipe.layers).toHaveLength(0);
  const ws = freshWorkspace(); ws.collections = session.snapshot();
  const restored = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(ws, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS);
  const next = new CollectionSession(STUDIO_DOCUMENTS, restored.collections!, () => editor, e => editor = e);
  next.undoOpen(); expect(editor.recipe.layers[0].color).toBe("#ffeedd"); expect(next.state.collection.id).toBe(priorId);
  next.importRecipe(initialRecipe(), "Portable"); expect(next.state.collection.presets).toHaveLength(2);
  expect(next.state.collection.presets[1].name).toBe("Portable");
});

test("recovery is bounded and follows the opened drafts in order", () => {
  const collection = (name: string) => ({ schema: "xfas/collection-1" as const,
    id: crypto.randomUUID(), name, presets: [] });
  const first = collection("First");
  let editor: EditorSnapshot = { recipe: emptyRecipe(), ...emptyMemory() };
  const session = new CollectionSession(STUDIO_DOCUMENTS, collectionDraft(first, STUDIO_DOCUMENTS), () => editor, value => editor = value);
  for (let n = 0; n < COLLECTION_RECOVERY_LIMIT + 1; n++) session.open(collection(`Open ${n}`));
  expect(session.state.previous?.collection.name).toBe(`Open ${COLLECTION_RECOVERY_LIMIT - 1}`);
  expect(session.state.older?.map(draft => draft.collection.name)).toEqual(
    Array.from({ length: COLLECTION_RECOVERY_LIMIT - 1 }, (_, index) => `Open ${COLLECTION_RECOVERY_LIMIT - 2 - index}`));
  for (let n = COLLECTION_RECOVERY_LIMIT - 1; n >= 0; n--) {
    session.undoOpen();
    expect(session.state.collection.name).toBe(`Open ${n}`);
  }
  expect(session.state.previous?.collection.name).toBe(`Open ${COLLECTION_RECOVERY_LIMIT}`);
  expect(session.state.older).toHaveLength(COLLECTION_RECOVERY_LIMIT - 1);
});

test("SQLite migration preserves look revisions; collection saves are atomic, ordered and conflict-protected", () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-collections-")), path = join(dir, "library.sqlite");
  let looks = new LookLibrary(path), db: CollectionLibrary | undefined;
  try {
    const old = looks.save({ name: "Old look", recipe: initialRecipe() });
    const raw = new Database(path), originalRows = raw.query("SELECT * FROM look_revisions").all();
    db = new CollectionLibrary(path, STUDIO_PARTS);
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
    raw.close(); db.close(); looks.close();
    looks = new LookLibrary(path); db = new CollectionLibrary(path, STUDIO_PARTS);
    expect(looks.get(old.id)).toEqual(old); expect(db.get(initial.collection.id)).toEqual(recovered);
    const separate = db.save({ collection: { ...edited, id: crypto.randomUUID() } });
    expect(separate.revision).toBe(1); expect(db.list()).toHaveLength(2);
    expect(() => db!.save({ collection: { ...edited, presets: [{ ...edited.presets[0],
      parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-1", body: {} } } }] }, revision: 5 })).toThrow("Invalid");
    expect(db.get(initial.collection.id)).toEqual(recovered);
  } finally { db?.close(); looks.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("collection API preserves legacy looks and rejects foreign, stale and destructive requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-collection-api-")), path = join(dir, "test.sqlite");
  const looks = new LookLibrary(path), db = new CollectionLibrary(path, STUDIO_PARTS);
  const prefix = "/api/verification/collections", origin = "http://127.0.0.1:4317";
  const request = (suffix: string, method = "GET", value?: unknown, source = origin) => new Request(origin + prefix + suffix,
    { method, headers: { Origin: source, "Content-Type": "application/json" }, body: value ? JSON.stringify(value) : undefined });
  try {
    const initial = db.get(db.list()[0].id);
    const value = { collection: initial.collection, revision: initial.revision };
    expect((await collectionRequest(request("", "POST", value, "https://example.com"), db, prefix)).status).toBe(403);
    expect((await collectionRequest(request("", "POST", value), db, prefix)).status).toBe(200);
    expect((await collectionRequest(request("", "POST", value), db, prefix)).status).toBe(409);
    expect((await collectionRequest(request("/" + initial.collection.id, "DELETE"), db, prefix)).status).toBe(405);
    const got = await (await collectionRequest(request("/" + initial.collection.id), db, prefix)).json();
    expect(parseCollection(got.collection, true).id).toBe(initial.collection.id);
    expect(looks.list()).toHaveLength(0);
  } finally { db.close(); looks.close(); rmSync(dir, { recursive: true, force: true }); }
});
