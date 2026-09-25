import { expect, test } from "bun:test";
import { AuthoringControlEdits } from "../src/authoring-control-edits";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGestures } from "../src/authoring-gestures";
import { CollectionApplication } from "../src/collection-application";
import { CollectionServiceError, type CollectionTransport } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { eyeMakeupPort } from "../src/authoring-eye-makeup";
import { looks } from "./fixtures/looks";
import type { PresetCollection } from "../src/preset-collection";
import { RecipeActions } from "../src/recipe-actions";
import { StudioApplication } from "../src/studio-application";
import { StudioFileOperations } from "../src/studio-file-operations";
import { freshWorkspace } from "../src/workspace-state";

function fixture() {
  const workspace = freshWorkspace(), document = new AuthoringDocument(workspace);
  const undo = () => { const prior = document.undoRecipe(); if (!prior) return false;
    document.recipe = prior; return true; };
  const recipe = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "draft");
  const gestures = new AuthoringGestures(document, recipe, undo);
  const controls = new AuthoringControlEdits(document, action => recipe.dispatch(action), undo);
  const app = new StudioApplication({ document, eyeMakeup: eyeMakeupPort(document, recipe), gestures, controls, undo });
  const collection: PresetCollection = { schema: "xfas/collection-1", id: crypto.randomUUID(),
    name: "Current", presets: [{ id: crypto.randomUUID(), name: "Look", revision: 1,
      recipe: structuredClone(document.recipe) }] };
  const other: PresetCollection = structuredClone(collection); other.id = crypto.randomUUID(); other.name = "Other";
  let saves = 0, restored = 0, packageInput: PresetCollection | undefined;
  const transport: CollectionTransport = {
    list: async () => [collection, other].map(c => ({ id: c.id, name: c.name, count: 1, revision: 1, updatedAt: "now" })),
    get: async id => ({ collection: looks(id === other.id ? other : collection), revision: 1, updatedAt: "now" }),
    save: async c => { saves++; return { collection: structuredClone(c), revision: 2, updatedAt: "now" }; },
    package: async (_action, c) => { packageInput = c; return { ready: true, collectionId: c.id,
      namespace: "xfs_test", modName: "XF Eye Artistry", selectorLabel: "XF Eye Artistry", originalPresetCount: 1, omissions: [], packagedCollectionSha256: "hash",
      presets: [{ id: c.presets[0].id, revision: 1, appearance: "xfs_test" }] }; },
  };
  let bootstrap!: CollectionApplication;
  const files = new StudioFileOperations({ pick: async () => undefined, download: () => {},
    bakeMask: async () => new Blob() }, {
    recipe: () => document.recipe, selectedLayer: () => document.recipe.layers[document.active],
    importRecipe: (value, name) => bootstrap.importRecipe(value, name),
    hasSavedV: () => false, savedV: () => undefined, loadSavedV: () => ({}), savedVReady: () => false,
    executeCollection: request => app.execute(request), recoverCollection: () => bootstrap.recover(),
  });
  bootstrap = new CollectionApplication(collectionDraft(collection, 1), workspace.library, document,
    () => { restored++; }, transport, app, files);
  return { bootstrap, collection, other, document, app, files, transport,
    saves: () => saves, restored: () => restored, packageInput: () => packageInput };
}

test("collection bootstrap attaches a detached view and switches per-preset editor state through trusted bridge", async () => {
  const f = fixture(); await f.bootstrap.initialize();
  const view = f.bootstrap.view();
  expect(view.draft?.collection.id).toBe(f.collection.id);
  (view.draft as any).collection.name = "outside";
  expect(f.bootstrap.view().draft?.collection.name).toBe("Current");
  let events = 0; const unsubscribe = f.bootstrap.subscribe(() => events++);
  expect(f.bootstrap.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(f.bootstrap.view().draft?.collection.presets).toHaveLength(2);
  expect(f.document.recipe.layers).toHaveLength(0);
  expect(f.bootstrap.currentLayerCount()).toBe(0);
  expect(f.bootstrap.dispatch({ kind: "preset.select", id: f.collection.presets[0].id }).ok).toBe(true);
  expect(f.document.recipe.layers).toHaveLength(4);
  expect(f.restored()).toBeGreaterThan(0);
  expect(events).toBeGreaterThan(0);
  unsubscribe();
});

test("bootstrap retains unsaved recipe edits in package snapshot without saving a revision", async () => {
  const f = fixture(); await f.bootstrap.initialize();
  f.document.recipe.layers[0].color = "#123456";
  const outcome = await f.bootstrap.execute({ kind: "package", action: "check" });
  expect(outcome.ok && outcome.result.kind).toBe("packageCheck");
  expect(f.packageInput()?.presets[0].recipe.layers[0].color).toBe("#123456");
  expect(f.saves()).toBe(0);
  expect(f.bootstrap.workspaceSnapshot()?.revision).toBe(1);
  expect(f.files.snapshot().package?.kind).toBe("packageCheck");
});

test("save conflict preserves draft and undo-open recovers previous editor after collection switch", async () => {
  const f = fixture(); await f.bootstrap.initialize();
  f.document.recipe.layers[0].color = "#abcdef";
  f.transport.save = async () => { throw new CollectionServiceError("conflict", "Revision conflict."); };
  expect(await f.bootstrap.execute({ kind: "save" })).toMatchObject({ ok: false, code: "conflict" });
  expect(f.document.recipe.layers[0].color).toBe("#abcdef");
  expect(f.bootstrap.view().draft?.collection.id).toBe(f.collection.id);
  expect((await f.bootstrap.execute({ kind: "open", id: f.other.id })).ok).toBe(true);
  expect(f.bootstrap.view().draft?.collection.id).toBe(f.other.id);
  expect(f.bootstrap.fileCapability({ kind: "collection.recover" }).available).toBe(true);
  expect((await f.bootstrap.fileExecute({ kind: "collection.recover" })).ok).toBe(true);
  expect(f.bootstrap.view().draft?.collection.id).toBe(f.collection.id);
  expect(f.document.recipe.layers[0].color).toBe("#abcdef");
});
