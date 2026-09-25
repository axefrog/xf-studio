/**
 * CORE-28: whether the last package result still describes the draft is asked on every repaint.
 * It compares version keys (content counter, collection identity and revision, selected look, live
 * editor revision): no snapshot, no copy, and never a write of the live editor into the draft.
 */
import { expect, test } from "bun:test";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import type { EditorSnapshot } from "../src/collection-session";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import type { PackageCheck } from "../src/package-action";
import { eyeMakeupCollection, parseCollection } from "../src/preset-collection";
import { StudioFileOperations } from "../src/studio-file-operations";
import { restore } from "./fixtures/workspace-observable";
import { largeWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";

const median = (run: () => void, n = 21) => {
  const times: number[] = [];
  for (let i = 0; i < n; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  return times.sort((a, b) => a - b)[n >> 1];
};

function fixture() {
  const state = restore(largeWorkspaceV1(16, 80)).state;
  let editor: EditorSnapshot = { recipe: state.recipe, active: state.active, selected: state.selected, history: state.history,
    fieldSelection: state.fieldSelection };
  let revision = 0;
  const check = (collection: { id: string; presets: { id: string; revision: number }[] }): PackageCheck => ({ ready: true,
    collectionId: collection.id, namespace: "xfs_test", modName: "XF Eye Artistry", selectorLabel: "XF Eye Artistry",
    originalPresetCount: collection.presets.length, omissions: [], packagedCollectionSha256: "hash",
    presets: collection.presets.map(p => ({ id: p.id, revision: p.revision, appearance: "xfs_test" })) });
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("unused"); },
    save: async () => { throw Error("unused"); }, package: async (_action, collection) => check(collection) };
  const service = new CollectionService(STUDIO_DOCUMENTS, state.collections, state.library, () => editor,
    value => { editor = value; revision++; }, transport, () => ({ recipe: editor.recipe, revision }));
  const files = new StudioFileOperations({ pick: async () => undefined, download: () => {}, bakeMask: async () => new Blob() }, {
    recipe: () => editor.recipe, selectedLayer: () => undefined, importRecipe: () => {}, hasSavedV: () => false,
    savedV: () => undefined, loadSavedV: () => ({}), savedVReady: () => false,
    executeCollection: request => service.execute(request), recoverCollection: () => {} });
  files.attachCollection(service);
  return { service, files, edit: () => { editor = { ...editor, recipe: { ...editor.recipe,
    layers: editor.recipe.layers.map((layer, i) => i ? layer : { ...layer, opacity: 0.42 }) } }; revision++; } };
}

test("a package result's freshness costs a key comparison per repaint, not a snapshot (large fixture)", async () => {
  const f = fixture();
  expect((await f.files.execute({ kind: "package.check" })).ok).toBe(true);
  expect(f.files.snapshot().package?.freshness).toBe("current");
  // What every repaint paid before: stash, snapshot and the package view of the whole draft.
  const before = median(() => JSON.stringify(parseCollection(eyeMakeupCollection(f.service.snapshot()!.collection))), 7);
  const after = median(() => f.files.snapshot());
  console.log(`package freshness per repaint: ${before.toFixed(1)} ms before, ${after.toFixed(3)} ms after (file snapshot included)`);
  expect(after).toBeLessThan(5);
  expect(after).toBeLessThan(before / 10);
});

test("an edit, a preset change or a new draft makes the result stale; a new Check makes it current; reads never stash", async () => {
  const f = fixture();
  await f.files.execute({ kind: "package.check" });
  const draft = JSON.stringify(f.service.view().draft);
  f.edit();
  // Reading freshness never writes the live editor into the draft.
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  expect(JSON.stringify(f.service.view().draft)).toBe(draft);
  await f.files.execute({ kind: "package.check" });
  expect(f.files.snapshot().package?.freshness).toBe("current");
  const other = f.service.summary().draft!.presets.find(preset => preset.id !== f.service.summary().draft!.selected)!;
  f.service.dispatch({ kind: "preset.select", id: other.id });
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  await f.files.execute({ kind: "package.check" });
  f.service.dispatch({ kind: "collection.rename", name: "Renamed" });
  expect(f.files.snapshot().package?.freshness).toBe("stale");
});
