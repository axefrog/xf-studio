/**
 * CORE-28: whether the last package result still describes the collection is asked on every repaint. It compares version keys (the
 * collection's structure, its looks' revisions, the shown look's editor revision): no snapshot, no copy, and never a write of the editor
 * into the look.
 */
import { expect, test } from "bun:test";
import { eyeMakeupCollection, parseCollection } from "../src/legacy/eye-makeup/export/preset-collection";
import { restore } from "./fixtures/workspace-observable";
import { largeWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { profileStudio } from "./fixtures/profile-studio";
import { livePart } from "../src/app/workspace/makeup-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { COLLECTION_2 } from "../src/platform/api";

const median = (run: () => void, n = 21) => {
  const times: number[] = [];
  for (let i = 0; i < n; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  return times.sort((a, b) => a - b)[n >> 1];
};

/** The large workspace fixture's looks (16 layers each) as the shown collection. */
async function fixture() {
  const state = restore(largeWorkspaceV1(16, 80)).state;
  const looks = state.collections!.collection.presets.map(look => ({ name: look.name, recipe: livePart(look, STUDIO_DOCUMENTS)! }));
  const studio = await profileStudio({ looks });
  await studio.collection.initialize();
  await studio.settle();
  const edit = () => studio.app.dispatch({ kind: "layer.setOpacity", layerId: studio.document.recipe.layers[0]!.id, opacity: 0.42 });
  return { ...studio, edit };
}

test("a package result's freshness costs a key comparison per repaint, not a snapshot (large fixture)", async () => {
  const f = await fixture();
  expect((await f.files.execute({ kind: "package.check" })).ok).toBe(true);
  expect(f.files.snapshot().package?.freshness).toBe("current");
  // What a comparison by content would pay every repaint: the package view of the whole collection.
  const collection = () => STUDIO_DOCUMENTS.parts.readCollection({ schema: COLLECTION_2, id: f.shown()!, name: "Current",
    presets: f.owner.looksOf(f.shown()!).map(look => ({ id: look.id, name: look.name, revision: 1, parts: look.parts })) });
  const before = median(() => JSON.stringify(parseCollection(eyeMakeupCollection(collection()))), 7);
  const after = median(() => f.files.snapshot());
  console.log(`package freshness per repaint: ${before.toFixed(1)} ms by content, ${after.toFixed(3)} ms by key (file snapshot included)`);
  expect(after).toBeLessThan(5);
  expect(after).toBeLessThan(before / 10);
});

test("an edit, a preset change or a rename makes the result stale; a new Check makes it current; reads never write the look", async () => {
  const f = await fixture();
  await f.files.execute({ kind: "package.check" });
  f.edit();
  // The edit is recorded as it is made; reading freshness writes nothing more into the look.
  const look = JSON.stringify(f.owner.look(f.scene.look()!));
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  expect(JSON.stringify(f.owner.look(f.scene.look()!))).toBe(look);
  await f.files.execute({ kind: "package.check" });
  expect(f.files.snapshot().package?.freshness).toBe("current");
  const other = f.service.summary().draft!.presets.find(preset => preset.id !== f.service.summary().draft!.selected)!;
  f.app.dispatch(f.choose(other.id));
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  await f.files.execute({ kind: "package.check" });
  f.service.dispatch({ kind: "collection.rename", collection: f.shown()!, name: "Renamed" });
  expect(f.files.snapshot().package?.freshness).toBe("stale");
});

test("editor selection keeps a package result current; a published in-place part edit makes it stale", async () => {
  const f = await fixture();
  await f.files.execute({ kind: "package.check" });
  const revision = f.document.version;
  f.document.active = 1; f.document.selected = 1;
  expect(f.document.version).toBe(revision);
  expect(f.files.snapshot().package?.freshness).toBe("current");
  f.document.recipe.layers[1].opacity = 0.17;
  f.document.gestureChanged(1);
  expect(f.document.version).toBeGreaterThan(revision);
  expect(f.files.snapshot().package?.freshness).toBe("stale");
});
