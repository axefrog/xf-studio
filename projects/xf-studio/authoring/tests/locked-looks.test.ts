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
import { consequenceOf } from "../src/action-consequences";
import { CollectionService, EVERY_LOOK_NEWER_MESSAGE, NO_EDITABLE_EYE_MAKEUP_MESSAGE, type CollectionTransport } from "../src/collection-service";
import { CollectionSession, type EditorSnapshot } from "../src/collection-session";
import { CollectionLibrary } from "../src/collection-store";
import { collectionDraft, emptyMemory, NEWER_LOOKS_LIBRARY_MESSAGE } from "../src/collection-workspace";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { COLLECTION_2, isNewerData, NEWER_LOOK_MESSAGE, type LookCollection } from "../src/platform/api";
import { eyeMakeupCollection, NEWER_LOOK_REASON, planCollection } from "../src/preset-collection";
import { initialRecipe, parseRecipe } from "../src/engines/layered-makeup/recipe";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createStudioPresentation } from "../src/studio-presentation";
import { fitWorkspace } from "../src/workspace-budget";
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

/** A collection file of A (this build's) and B, whose preset carries `extra` and whose eye makeup is `body`. */
const importedFile = (extra: Record<string, unknown>, body: unknown) => ({ schema: COLLECTION_2, id: ID.collection, name: "Imported", presets: [
  { id: ID.a, name: "A", revision: 1, parts: { [EYE]: { schema: "xfs/eye-makeup-part-2", body: initialRecipe() } } },
  { id: ID.b, name: "B", revision: 1, ...extra, parts: { [EYE]: { schema: "xfs/eye-makeup-part-2", body } } }] });
const refusalOf = (read: () => unknown) => { try { read(); return "accepted"; } catch (error) { return (error as Error).message; } };

test("a locked key from outside the app is never trusted: a damaged look is refused with it as without it (CORE-45)", async () => {
  const withKey = importedFile({ locked: "anything" }, "not a recipe"), without = importedFile({}, "not a recipe");
  const refused = refusalOf(() => STUDIO_PARTS.readCollection(without, false, "keep"));
  expect(refused).not.toBe("accepted");
  expect(refusalOf(() => STUDIO_PARTS.readCollection(withKey, false, "keep"))).toBe(refused);
  // Through the import request too: the same refusal, and the draft is not replaced.
  const service = await serviceOver(collectionDraft(importedFile({}, initialRecipe()), STUDIO_DOCUMENTS));
  const text = JSON.stringify(withKey);
  expect(await service.execute({ kind: "import", text, bytes: text.length })).toMatchObject({ ok: false, code: "invalid_collection", message: refused });
  expect(service.summary().draft!.name).toBe("Imported");
  // A stored workspace carrying the key reads the same way: its readable look opens editable.
  const stored = storedWorkspace();
  stored.collections.collection.presets[0].locked = "anything";
  const loaded = loadWorkspace(storage(stored), false, STUDIO_DOCUMENTS);
  expect(loaded.state.collections!.collection.presets.map(look => !!look.locked)).toEqual([false, true, true]);
});

test("a readable look carrying a locked key opens editable (CORE-45)", () => {
  const read = STUDIO_PARTS.readCollection(importedFile({ locked: NEWER_LOOK_MESSAGE }, initialRecipe()), false, "keep");
  expect(read.presets.map(look => look.locked)).toEqual([undefined, undefined]);
  expect(JSON.stringify(read)).not.toContain("locked");
});

test("a look locked by its newer Undo history stays locked through collection edits in the session (CORE-45)", () => {
  // B's parts read; only its memory holds a newer build's history.
  const stored = storedWorkspace();
  stored.collections.collection.presets[1].parts = { [EYE]: { schema: "xfs/eye-makeup-part-2", body: initialRecipe() } };
  const loaded = loadWorkspace(storage(stored), false, STUDIO_DOCUMENTS);
  expect(find(loaded.state.collections!.collection, ID.b).locked).toBe(NEWER_LOOK_MESSAGE);
  const core = createTrustedAuthoringCore(loaded.state, { resetStack: () => {}, selectedCollection: () => "draft", newId: ids() }, STUDIO_COMPOSITION);
  const draft = new CollectionSession(STUDIO_DOCUMENTS, loaded.state.collections!, () => core.document.export(),
    editor => core.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), ids());
  draft.edit({ kind: "rename", id: ID.b, name: "B renamed" });
  draft.renameCollection("Renamed looks");
  expect(find(draft.snapshot().collection, ID.b).locked).toBe(NEWER_LOOK_MESSAGE);
  // The stored form still carries no key; the next restore locks it again from its memory.
  const written = JSON.parse(JSON.stringify(serializeWorkspace({ ...loaded.state, collections: draft.snapshot() }, STUDIO_DOCUMENTS)));
  expect(JSON.stringify(written)).not.toContain("\"locked\"");
  expect(find(loadWorkspace(storage(written), false, STUDIO_DOCUMENTS).state.collections!.collection, ID.b).locked).toBe(NEWER_LOOK_MESSAGE);
});

test("the eye-makeup facade says a look is locked explicitly (UI-53)", () => {
  const { core, draft } = session();
  const port = createStudioPresentation({ authoring: core.app, editor: core.presentation, library: {} as never, files: {} as never,
    viewport: {} as never, preferences: {} as never, previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} } });
  expect(port.feature("eye-makeup").locked()).toBeUndefined();
  draft.select(ID.b);
  expect(port.feature("eye-makeup").locked()).toBe(NEWER_LOOK_MESSAGE);
  draft.select(ID.a);
  expect(port.feature("eye-makeup").locked()).toBeUndefined();
});

/** A collection service over `state`, whose library and package host must never be asked. */
async function serviceOver(state: ReturnType<typeof collectionDraft> & { previous?: ReturnType<typeof collectionDraft> }) {
  let editor: EditorSnapshot = { recipe: initialRecipe(), ...emptyMemory() };
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("none"); },
    save: async () => { throw Error("The library must not be asked."); }, package: async () => { throw Error("The package host must not be asked."); } };
  const service = new CollectionService(STUDIO_DOCUMENTS, state, { selected: "", name: "" }, () => editor, value => editor = value, transport);
  await service.execute({ kind: "initialize" });
  return service;
}

test("a collection whose only eye makeup is locked offers no build, with a plain reason (PIPE-44)", async () => {
  const { draft } = session();
  const locked = draft.snapshot().collection.presets.filter(look => look.locked);
  // Every look locked.
  const all = await serviceOver({ ...collectionDraft({ ...draft.snapshot().collection, presets: locked }, STUDIO_DOCUMENTS), selected: ID.b });
  for (const request of [{ kind: "exportPlan" as const }, { kind: "package" as const, action: "check" as const }, { kind: "package" as const, action: "build" as const }])
    expect(all.capability(request)).toEqual({ available: false, code: "invalid_value", reason: EVERY_LOOK_NEWER_MESSAGE });
  expect(all.capability({ kind: "exportCollection" })).toEqual({ available: true });
  // A look without eye makeup beside them: the reason names the locked ones.
  const mixed = await serviceOver({ ...collectionDraft({ ...draft.snapshot().collection, presets: [
    { id: ID.a, name: "A", revision: 1, parts: {} }, ...locked] }, STUDIO_DOCUMENTS), selected: ID.b });
  expect(mixed.capability({ kind: "exportPlan" })).toEqual({ available: false, code: "invalid_value", reason: NO_EDITABLE_EYE_MAKEUP_MESSAGE });
});

test("the Export plan names what it leaves out and lists it in the file (PIPE-45)", async () => {
  const { draft } = session();
  const service = await serviceOver({ ...collectionDraft(draft.snapshot().collection, STUDIO_DOCUMENTS), selected: ID.a });
  const exported = await service.execute({ kind: "exportPlan" });
  expect(exported).toMatchObject({ ok: true, result: { kind: "export", name: "xfs.build-plan.json" } });
  const plan = JSON.parse((exported as { result: { json: string } }).result.json);
  expect(plan.schema).toBe("xfas/export-plan-1");
  expect(plan.presets.map((preset: { id: string }) => preset.id)).toEqual([ID.a]);
  expect(plan.omitted).toEqual([{ presetId: ID.b, presetName: "B", reason: NEWER_LOOK_REASON },
    { presetId: ID.c, presetName: "C", reason: NEWER_LOOK_REASON }]);
  const message = service.summary().progress!.message;
  expect(message).toContain("Not in the plan: “B”, “C”, made with a newer version of XF Studio.");
  expect(message).not.toContain("exported exactly as it came");
  // A collection the plan holds whole carries no `omitted` key, as before.
  expect("omitted" in planCollection(eyeMakeupCollection({ ...draft.snapshot().collection,
    presets: draft.snapshot().collection.presets.filter(look => !look.locked) }))).toBe(false);
});

test("discarding a recovery draft that holds a locked look says so and offers to export it (CORE-49)", async () => {
  const { draft } = session();
  const earlier = { ...collectionDraft({ ...draft.snapshot().collection, id: "00000000-0000-4000-8000-0000000c0de1", name: "Earlier" },
    STUDIO_DOCUMENTS), selected: ID.a };
  const current = collectionDraft({ schema: COLLECTION_2, id: ID.collection, name: "Current", presets: [
    { id: ID.a, name: "A", revision: 1, parts: { [EYE]: { schema: "xfs/eye-makeup-part-2", body: initialRecipe() } } }] }, STUDIO_DOCUMENTS);
  const service = await serviceOver({ ...current, previous: earlier });
  const summary = service.summary().draft!;
  expect(summary.oldestRecoverable).toEqual({ id: earlier.collection.id, name: "Earlier", locked: true });
  // At the queue's limit, opening another collection discards it: the consequence carries its ID and the lock.
  const full = { ...summary, recoveryCount: summary.recoveryLimit };
  expect(consequenceOf({ request: { kind: "import", text: "", bytes: 0 } }, { draft: full, history: { depth: 0, redoDepth: 0 },
    undoLimit: 100, removedLimit: 20 }).discards).toEqual([{ kind: "recovery-draft", label: "Earlier", id: earlier.collection.id, locked: true }]);
  // Export collection for that draft writes it as it is, unsaved; the current draft is unchanged.
  expect(service.capability({ kind: "exportCollection", draft: "00000000-0000-4000-8000-00000000dead" }))
    .toMatchObject({ available: false, code: "missing_target" });
  const exported = await service.execute({ kind: "exportCollection", draft: earlier.collection.id });
  expect(exported).toMatchObject({ ok: true, result: { kind: "export", name: "xfs.collection.json" } });
  const file = JSON.parse((exported as { result: { json: string } }).result.json);
  expect([file.schema, file.id, file.name]).toEqual([COLLECTION_2, earlier.collection.id, "Earlier"]);
  expect(file.presets.map((look: LookCollection["presets"][number]) => look.parts[EYE])).toEqual(
    [file.presets[0].parts[EYE], NEWER_B, newerModelC()]);
  expect(service.summary().draft!.id).toBe(ID.collection);
  expect(service.summary().progress!.message).toContain("Exported the earlier draft “Earlier”");
});

test("an over-budget workspace drops locked looks' kept memory, recovery drafts first, parts verbatim (CORE-47)", () => {
  const bigHistory = Array.from({ length: 200 }, (_, i) => ({ layers: [{ id: `l${i}`, pad: "x".repeat(2000) }] }));
  const stored = storedWorkspace();
  stored.collections.memory[ID.b] = { [EYE]: { editor: {}, partSchema: "xfs/eye-makeup-part-9", history: bigHistory } };
  // In the current draft only the last resort drops it, and the workspace then fits.
  const loaded = loadWorkspace(storage(stored), false, STUDIO_DOCUMENTS);
  const size = JSON.stringify(stored).length, budget = Math.floor(size / 2);
  const fitted = fitWorkspace(loaded.state, STUDIO_DOCUMENTS, budget);
  expect([fitted.overBudget, fitted.plan.kept, fitted.trimmed]).toEqual([false, "everywhere", true]);
  const written = JSON.parse(fitted.encoded);
  expect(find(written.collections.collection, ID.b)).toEqual(find(stored.collections.collection, ID.b));
  expect(written.collections.memory[ID.b]).toBeUndefined();
  const again = loadWorkspace(storage(written), false, STUDIO_DOCUMENTS);
  expect([again.writable, find(again.state.collections!.collection, ID.b).locked]).toEqual([true, NEWER_LOOK_MESSAGE]);
  // Within the budget nothing changes: the standard form keeps it whole.
  expect(fitWorkspace(loaded.state, STUDIO_DOCUMENTS, size * 2).plan.kept).toBeUndefined();
  // In a recovery draft its kept memory goes before the current draft's, and the draft itself is kept.
  const recovering = storedWorkspace();
  recovering.collections.previous = { ...structuredClone(stored.collections), collection: { ...structuredClone(stored.collections.collection),
    id: "00000000-0000-4000-8000-0000000c0de1" } };
  const restored = loadWorkspace(storage(recovering), false, STUDIO_DOCUMENTS);
  const whole = fitWorkspace(restored.state, STUDIO_DOCUMENTS).size;
  const outside = fitWorkspace(restored.state, STUDIO_DOCUMENTS, whole - 1000);
  expect([outside.overBudget, outside.plan.kept, outside.plan.recovery]).toEqual([false, "outside", Infinity]);
  const kept = JSON.parse(outside.encoded).collections;
  expect(find(kept.previous.collection, ID.b)).toEqual(find(stored.collections.collection, ID.b));
  expect(kept.previous.memory[ID.b]).toBeUndefined();
  expect(kept.memory[ID.b]).toEqual(MEMORY_B);
});
