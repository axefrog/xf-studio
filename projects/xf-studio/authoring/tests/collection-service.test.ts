import { expect, test } from "bun:test";
import { CollectionService, CollectionServiceError, type CollectionTransport } from "../src/collection-service";
import { collectionDraft, emptyMemory } from "../src/collection-workspace";
import { initialRecipe } from "../src/recipe";
import { freshWorkspace, loadWorkspace, parseWorkspace } from "../src/workspace-state";
import type { EditorSnapshot } from "../src/collection-session";
import type { PresetCollection } from "../src/preset-collection";

function fixture() {
  const recipe = initialRecipe(), collection: PresetCollection = { schema: "xfas/collection-1",
    id: crypto.randomUUID(), name: "Library", presets: [{ id: crypto.randomUUID(), name: "Eye", revision: 1, recipe }] };
  let editor: EditorSnapshot = { recipe: structuredClone(recipe), ...emptyMemory() };
  const saved = { collection: structuredClone(collection), revision: 1, updatedAt: "now" };
  let saves = 0, packageInput: PresetCollection | undefined;
  const transport: CollectionTransport = {
    list: async () => [{ id: collection.id, name: collection.name, count: 1, revision: 1, updatedAt: "now" }],
    get: async () => saved,
    save: async (value, revision) => { saves++; return { collection: structuredClone(value), revision: (revision ?? 0) + 1, updatedAt: "now" }; },
    package: async (_action, value) => { packageInput = value; return { ready: true, collectionId: value.id,
      namespace: "xfs_test", modName: "XF Eye Artistry", selectorLabel: "XF Eye Artistry", originalPresetCount: 1, omissions: [], packagedCollectionSha256: "test",
      presets: [{ id: value.presets[0].id, revision: 1, appearance: "xfs_test" }] }; },
  };
  const service = new CollectionService(collectionDraft(collection, 1), { selected: "", name: "" },
    () => editor, value => editor = value, transport);
  return { service, collection, saved, transport, editor: () => editor, saves: () => saves,
    packageInput: () => packageInput };
}

test("an empty library initializes a saveable starter draft from the loaded workspace", async () => {
  const workspace = loadWorkspace({ getItem: () => null }, false).state;
  let editor: EditorSnapshot = { recipe: workspace.recipe, ...emptyMemory() };
  let saved: PresetCollection | undefined;
  const transport: CollectionTransport = {
    list: async () => [],
    get: async () => { throw Error("No saved collection"); },
    save: async value => { saved = structuredClone(value); return { collection: value, revision: 1, updatedAt: "now" }; },
    package: async () => { throw Error("Unused"); },
  };
  const service = new CollectionService(undefined, workspace.library, () => editor, value => editor = value, transport);
  expect((await service.execute({ kind: "initialize" })).ok).toBe(true);
  expect(service.snapshot()?.revision).toBeUndefined();
  expect(service.snapshot()?.collection.presets).toHaveLength(1);
  expect(service.snapshot()?.collection.presets[0].recipe).toEqual(workspace.recipe);
  editor.recipe.layers[0].color = "#abcdef";
  expect((await service.execute({ kind: "save" })).ok).toBe(true);
  expect(saved?.presets[0].recipe.layers[0].color).toBe("#abcdef");
});

test("async collection service preserves an unsaved draft in package snapshots without a SQLite save", async () => {
  const f = fixture();
  await f.service.execute({ kind: "initialize" });
  f.editor().recipe.layers[0].color = "#123456";
  const before = f.service.snapshot()!;
  const outcome = await f.service.execute({ kind: "package", action: "check" });
  expect(outcome.ok && outcome.result.kind).toBe("packageCheck");
  expect(f.packageInput()!.presets[0].recipe.layers[0].color).toBe("#123456");
  expect(f.saves()).toBe(0);
  expect(f.service.snapshot()!.revision).toBe(before.revision);
  const detached = f.service.view() as any;
  detached.draft.collection.presets[0].name = "Outside";
  expect(f.service.view().draft!.collection.presets[0].name).toBe("Eye");
});

test("successful partial check names omitted layers and whole presets in the Studio result", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  f.transport.package = async (_action, value) => ({ ready: true, collectionId: value.id,
    namespace: "xfs_test", modName: "XF Eye Artistry", selectorLabel: "XF Eye Artistry", originalPresetCount: 2, packagedCollectionSha256: "test",
    presets: [{ id: value.presets[0].id, revision: 1, appearance: "xfs_test" }],
    omissions: [
      { kind: "layer", presetId: value.presets[0].id, presetName: "Eye", layerId: "sparkle", layerName: "Sparkle",
        finish: "glitter", reason: "Active finish has no supported game-export adapter." },
      { kind: "preset", presetId: "other", presetName: "Glitter only", reason: "No active exportable layers remain." },
    ] });
  expect((await f.service.execute({ kind: "package", action: "check" })).ok).toBe(true);
  expect(f.service.view().progress?.message).toContain("omitted layer “Sparkle” (Glitter) from preset “Eye”");
  expect(f.service.view().progress?.message).toContain("omitted whole preset “Glitter only”");
});

test("save reconciliation retains edits made while the immutable request is in flight", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  let release!: (value: any) => void;
  f.transport.save = (collection) => new Promise(resolve => { release = resolve; });
  const pending = f.service.execute({ kind: "save" });
  expect(f.service.view().busy).toBe(true);
  expect(f.service.capability({ kind: "package", action: "check" }).available).toBe(false);
  f.editor().recipe.layers[0].color = "#abcdef";
  release({ collection: structuredClone(f.collection), revision: 2, updatedAt: "now" });
  expect((await pending).ok).toBe(true);
  expect(f.service.snapshot()!.collection.presets[0].recipe.layers[0].color).toBe("#abcdef");
  expect(f.service.snapshot()!.revision).toBe(2);
});

test("no-exportable-content errors retain a stable code and an actionable message", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  f.editor().recipe.layers[0].finish = "glitter";
  f.transport.package = async () => { throw new CollectionServiceError("no_exportable_content",
    "No mod files can be made: every preset has no active Matte, Satin or Metallic layer. Your collection is unchanged."); };
  const outcome = await f.service.execute({ kind: "package", action: "check" });
  expect(outcome).toMatchObject({ ok: false, code: "no_exportable_content" });
  expect(f.service.view().progress?.message).toContain("Your collection is unchanged");
  expect(f.service.view().busy).toBe(false);
  expect(f.service.snapshot()!.collection.presets[0].recipe.layers[0].finish).toBe("glitter");
});

test("loading a saved list does not replace a restored local draft", async () => {
  const f = fixture(); f.editor().recipe.layers[0].color = "#fedcba";
  const result = await f.service.execute({ kind: "initialize" });
  expect(result.ok).toBe(true);
  expect(f.service.snapshot()!.collection.presets[0].recipe.layers[0].color).toBe("#fedcba");
  expect(f.service.view().progress?.message).toContain("without replacing unsaved edits");
});

test("opening two saved collections keeps the earlier unsaved draft recoverable after reload", async () => {
  const source = fixture();
  const draft = source.collection, a = { ...structuredClone(draft), id: crypto.randomUUID(), name: "A" },
    b = { ...structuredClone(draft), id: crypto.randomUUID(), name: "B" };
  const saved = [a, b].map(collection => ({ collection, revision: 3, updatedAt: "now" }));
  source.transport.list = async () => saved.map(item => ({ id: item.collection.id,
    name: item.collection.name, count: 1, revision: item.revision, updatedAt: item.updatedAt }));
  source.transport.get = async id => saved.find(item => item.collection.id === id)!;
  await source.service.execute({ kind: "initialize" });
  source.editor().recipe.layers[0].color = "#fedcba";
  source.editor().history = [structuredClone(initialRecipe())];
  expect((await source.service.execute({ kind: "open", id: a.id })).ok).toBe(true);
  expect((await source.service.execute({ kind: "open", id: b.id })).ok).toBe(true);
  expect(source.service.summary().draft?.recoveryCount).toBe(2);

  const workspace = freshWorkspace(); workspace.collections = source.service.snapshot();
  const restored = parseWorkspace(JSON.parse(JSON.stringify(workspace)));
  let editor: EditorSnapshot = { recipe: restored.recipe, active: restored.active, selected: restored.selected,
    history: restored.history };
  const resumed = new CollectionService(restored.collections, { selected: "", name: "" },
    () => editor, value => editor = value, source.transport);
  await resumed.execute({ kind: "initialize" });
  resumed.dispatch({ kind: "collection.undoOpen" });
  expect(resumed.summary().draft).toMatchObject({ id: a.id, revision: 3, recoveryCount: 2 });
  resumed.dispatch({ kind: "collection.undoOpen" });
  expect(resumed.summary().draft).toMatchObject({ id: draft.id, revision: 1, recoveryCount: 2 });
  expect(editor.recipe.layers[0].color).toBe("#fedcba");
  expect(editor.history).toHaveLength(1);
  let savedColor: string | undefined, savedRevision: number | undefined;
  source.transport.save = async (value, revision) => {
    savedColor = value.presets[0].recipe.layers[0].color; savedRevision = revision;
    return { collection: structuredClone(value), revision: revision! + 1, updatedAt: "now" };
  };
  expect((await resumed.execute({ kind: "save" })).ok).toBe(true);
  expect(savedColor).toBe("#fedcba"); expect(savedRevision).toBe(1);
  expect(resumed.summary().draft?.revision).toBe(2);
  resumed.dispatch({ kind: "collection.undoOpen" });
  expect(resumed.summary().draft?.id).toBe(b.id); // The draft left during recovery remains reachable.
});

test("a revision conflict reports its code without replacing the local draft", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  f.editor().recipe.layers[0].color = "#13579b";
  f.transport.save = async () => { throw new CollectionServiceError("conflict",
    "This collection changed in another window. Your draft is safe; save a copy or reopen the latest revision."); };
  const outcome = await f.service.execute({ kind: "save" });
  expect(outcome).toMatchObject({ ok: false, code: "conflict" });
  expect(f.service.snapshot()!.revision).toBe(1);
  expect(f.service.snapshot()!.collection.presets[0].recipe.layers[0].color).toBe("#13579b");
});
