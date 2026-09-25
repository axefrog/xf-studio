/**
 * Per-look "not editable in this version" (feature-module platform step 5): a look holding a newer build's
 * data (a part schema or layer model this build does not know) is kept verbatim and locked, instead of
 * making the whole workspace read-only. Editing it is refused through capabilities with a plain reason;
 * every other look stays editable; every writer puts it back exactly as it came; the library never takes
 * it and the mod export leaves it out, saying why.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import { CollectionSession, type EditorSnapshot } from "../src/collection-session";
import { CollectionLibrary } from "../src/collection-store";
import { collectionDraft, emptyMemory, NEWER_LOOKS_LIBRARY_MESSAGE } from "../src/collection-workspace";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { COLLECTION_2, isNewerData, NEWER_LOOK_MESSAGE, type LookCollection } from "../src/platform/api";
import { eyeMakeupCollection, NEWER_LOOK_REASON } from "../src/preset-collection";
import { initialRecipe, parseRecipe } from "../src/recipe";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createStudioPresentation } from "../src/studio-presentation";
import { freshWorkspace, loadWorkspace, serializeWorkspace, workspaceKeys } from "../src/workspace-state";

const EYE = "eye-makeup";
const ID = { collection: "00000000-0000-4000-8000-00000000c011", a: "00000000-0000-4000-8000-00000000000a",
  b: "00000000-0000-4000-8000-00000000000b", c: "00000000-0000-4000-8000-00000000000c" };
/** B: a part schema from a newer build, with its newer Undo history; C: a part-2 recipe using a layer model this build lacks. */
const NEWER_B = { schema: "xfs/eye-makeup-part-9", body: { layers: [{ id: "future", brush: "ribbon-3" }], uv: "gltf-uv0-top-left" } };
const MEMORY_B = { [EYE]: { editor: { active: 0, selected: 0, ribbon: 2 }, partSchema: "xfs/eye-makeup-part-9", history: [{ layers: [] }] } };
const newerModelC = () => {
  const recipe = parseRecipe(initialRecipe());
  recipe.layers[0] = { ...recipe.layers[0], finish: "glitter", flakes: { model: "uv-cell-direct-9", sparkle: 4 } as never };
  return { schema: "xfs/eye-makeup-part-2", body: recipe };
};

/** A stored workspace whose collection holds A (this build's), B and C (a newer build's). */
function storedWorkspace() {
  const state = freshWorkspace();
  state.collections = collectionDraft({ schema: COLLECTION_2, id: ID.collection, name: "Looks", presets: [
    { id: ID.a, name: "A", revision: 1, parts: { [EYE]: { schema: "xfs/eye-makeup-part-2", body: initialRecipe() } } }] }, STUDIO_DOCUMENTS);
  state.collections.selected = ID.a;
  const stored = JSON.parse(JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)));
  stored.collections.collection.presets.push({ id: ID.b, name: "B", revision: 3, parts: { [EYE]: structuredClone(NEWER_B) } },
    { id: ID.c, name: "C", revision: 2, parts: { [EYE]: newerModelC() } });
  stored.collections.memory[ID.b] = structuredClone(MEMORY_B);
  return JSON.parse(JSON.stringify(stored));
}
const storage = (value: unknown) => ({ getItem: (key: string) => key === workspaceKeys(false).workspace ? JSON.stringify(value) : null });
const ids = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; };

function session() {
  const stored = storedWorkspace(), loaded = loadWorkspace(storage(stored), false, STUDIO_DOCUMENTS);
  expect(loaded).toMatchObject({ writable: true });
  const core = createTrustedAuthoringCore(loaded.state, { resetStack: () => {}, selectedCollection: () => "draft", newId: ids() },
    STUDIO_COMPOSITION);
  const draft = new CollectionSession(STUDIO_DOCUMENTS, loaded.state.collections!, () => core.document.export(),
    editor => core.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), ids());
  return { stored, loaded, core, draft };
}
const find = (collection: LookCollection, id: string) => collection.presets.find(look => look.id === id)!;

test("a newer look opens locked while the rest of the workspace stays editable", () => {
  const { loaded, core, draft } = session();
  const collection = loaded.state.collections!.collection;
  expect(collection.presets.map(look => look.locked)).toEqual([undefined, NEWER_LOOK_MESSAGE, NEWER_LOOK_MESSAGE]);
  // Its parts and memory are the stored ones, untouched; nothing of it is read.
  expect(find(collection, ID.b).parts[EYE]).toEqual(NEWER_B);
  expect(find(collection, ID.c).parts[EYE]).toEqual(newerModelC());
  // A (this build's) is selected and editable.
  expect(core.app.featureEditable(EYE)).toEqual({ available: true });
  const layer = core.document.recipe.layers[0].id;
  expect(core.app.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: .3 })).toMatchObject({ ok: true });
  // Selecting B shows nothing to edit and refuses every edit, with the plain reason.
  draft.select(ID.b);
  expect([core.document.locked, core.document.recipe.layers.length, core.document.undoDepth]).toEqual([NEWER_LOOK_MESSAGE, 0, 0]);
  const refused = { available: false as const, code: "unavailable" as const, reason: NEWER_LOOK_MESSAGE };
  expect(core.app.featureEditable(EYE)).toEqual(refused);
  // The presentation reads it on the eye-makeup facade (the Layers view shows the notice from it).
  const port = createStudioPresentation({ authoring: core.app, editor: core.presentation, library: {} as never, files: {} as never,
    viewport: {} as never, preferences: {} as never, previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} } });
  expect(port.feature("eye-makeup").editable()).toEqual(refused);
  expect(core.app.capability({ kind: "layer.edit", command: { kind: "add" } })).toEqual(refused);
  expect(core.app.dispatch({ kind: "layer.edit", command: { kind: "add" } })).toMatchObject({ ok: false, code: "unavailable" });
  expect(core.app.canBeginGesture("uv", "any")).toEqual(refused);
  expect(core.app.controlBegin("opacity", "any")).toBe(false);
  expect(core.app.transaction({ label: "Reset look", actionKind: "look.reset" }, [EYE], () => 1)).toMatchObject({ ok: false, code: "unavailable" });
  // Its recipe and masks are not exported as if it were empty.
  expect(core.app.fileCapability({ kind: "recipe.export" })).toEqual(refused);
  expect(core.app.fileCapability({ kind: "mask.export" })).toEqual(refused);
  // Collection edits (rename, copy, move, remove and restore) still work on it.
  draft.edit({ kind: "rename", id: ID.b, name: "B renamed" });
  draft.edit({ kind: "copy", id: ID.b });
  draft.edit({ kind: "move", id: ID.c, to: 0 });
  draft.edit({ kind: "remove", id: ID.c });
  draft.edit({ kind: "restore" });
  const after = draft.snapshot().collection;
  expect(after.presets.map(look => [look.name, !!look.locked])).toEqual([["C", true], ["A", false], ["B renamed", true], ["B renamed (copy)", true]]);
  expect(after.presets.filter(look => look.locked).map(look => look.parts[EYE])).toEqual([newerModelC(), NEWER_B, NEWER_B]);
  // Back in A: editing and Undo carry on; the lock goes with B.
  draft.select(ID.a);
  expect(core.document.locked).toBeUndefined();
  expect(core.document.recipe.layers[0].opacity).toBe(.3);
  expect(core.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
});

test("every writer puts a locked look back exactly as it came", () => {
  const { stored, loaded, core, draft } = session();
  draft.select(ID.b); draft.select(ID.c); draft.select(ID.a);
  core.app.dispatch({ kind: "layer.setOpacity", layerId: core.document.recipe.layers[0].id, opacity: .6 });
  const state = { ...loaded.state, collections: draft.snapshot() };
  // The stored workspace: parts and memory byte for byte (B's newer Undo history included).
  const written = JSON.parse(JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)));
  for (const id of [ID.b, ID.c]) {
    expect(find(written.collections.collection, id)).toEqual(find(stored.collections.collection, id));
    expect(written.collections.memory[id]).toEqual(stored.collections.memory[id]);
  }
  // A collection file: `xfs/collection-2`, the locked parts verbatim; a build that cannot read them refuses cleanly.
  const file = STUDIO_PARTS.writeMinimal(state.collections!.collection);
  expect(file.schema).toBe(COLLECTION_2);
  expect((file as LookCollection).presets.map(look => look.parts[EYE])).toEqual(
    [(file as LookCollection).presets[0].parts[EYE], NEWER_B, newerModelC()]);
  expect(JSON.stringify(file)).not.toContain("locked");
  // Importing that file keeps them locked; the strict reader (the library) refuses it as newer data.
  const imported = STUDIO_PARTS.readCollection(JSON.parse(JSON.stringify(file)), false, "keep");
  expect(imported.presets.map(look => !!look.locked)).toEqual([false, true, true]);
  let error: unknown;
  try { STUDIO_PARTS.readCollection(JSON.parse(JSON.stringify(file))); } catch (caught) { error = caught; }
  expect(isNewerData(error)).toBe(true);
});

test("the mod export leaves a locked look out and says why; the library never takes it", async () => {
  const { draft } = session();
  const collection = draft.snapshot().collection;
  const view = eyeMakeupCollection(collection);
  expect(view.presets.map(preset => preset.id)).toEqual([ID.a]);
  expect(view.omitted).toEqual([{ presetId: ID.b, presetName: "B", reason: NEWER_LOOK_REASON },
    { presetId: ID.c, presetName: "C", reason: NEWER_LOOK_REASON }]);
  // The library store refuses it with the plain message and writes nothing.
  const dir = mkdtempSync(join(tmpdir(), "xfs-locked-library-")), path = join(dir, "library.sqlite");
  new LookLibrary(path).close();
  const store = new CollectionLibrary(path, STUDIO_PARTS);
  try {
    const before = store.list();
    expect(() => store.save({ collection: JSON.parse(JSON.stringify(STUDIO_PARTS.writeMinimal(collection))) })).toThrow(NEWER_LOOKS_LIBRARY_MESSAGE);
    expect(store.list()).toEqual(before);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing. */ } }
  // The draft's Save is refused up front with the same words; Export collection stays available.
  let editor: EditorSnapshot = { recipe: initialRecipe(), ...emptyMemory() };
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("none"); },
    save: async () => { throw Error("The library must not be asked."); }, package: async () => { throw Error("none"); } };
  const service = new CollectionService(STUDIO_DOCUMENTS, { ...collectionDraft(collection, STUDIO_DOCUMENTS), selected: ID.a },
    { selected: "", name: "" }, () => editor, value => editor = value, transport);
  await service.execute({ kind: "initialize" });
  // The presets list marks the locked looks.
  expect(service.summary().draft!.presets.map(preset => preset.locked)).toEqual([undefined, true, true]);
  expect(service.capability({ kind: "save" })).toEqual({ available: false, code: "unavailable", reason: NEWER_LOOKS_LIBRARY_MESSAGE });
  expect(service.capability({ kind: "exportCollection" })).toEqual({ available: true });
  const exported = await service.execute({ kind: "exportCollection" });
  expect(exported).toMatchObject({ ok: true });
});
