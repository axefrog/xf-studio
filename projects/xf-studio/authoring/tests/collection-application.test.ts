import { expect, test } from "bun:test";
import { profileStudio } from "./fixtures/profile-studio";
import { freshWorkspace } from "./fixtures/eye-region";

async function fixture() {
  const f = await profileStudio({ looks: [{ name: "Look", recipe: freshWorkspace().recipe }] });
  await f.collection.initialize();
  return f;
}

test("the collection application hands views a detached summary and switches the editor between looks", async () => {
  const f = await fixture();
  const view = f.collection.view();
  expect(view.draft?.id).toBe(f.shown());
  (view.draft as { name: string }).name = "outside";
  expect(f.collection.view().draft?.name).toBe("Current");
  let events = 0; const unsubscribe = f.collection.subscribe(() => events++);
  const first = f.scene.look()!.look;
  expect(f.collection.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(f.collection.view().draft?.presets).toHaveLength(2);
  // A new preset starts like the first one, with the starter layer (release-readiness-audit.md item 12).
  expect(f.document.recipe.layers).toHaveLength(1);
  expect(f.collection.currentLayerCount()).toBe(1);
  expect(f.app.dispatch(f.choose(first)).ok).toBe(true);
  expect(f.document.recipe.layers).toHaveLength(4);
  expect(events).toBeGreaterThan(0);
  unsubscribe();
});

test("a Check sends the look as edited and saves no version", async () => {
  const f = await fixture();
  f.app.dispatch({ kind: "layer.setColor", layerId: f.document.recipe.layers[0]!.id, color: "#123456" });
  const outcome = await f.collection.execute({ kind: "package", action: "check" });
  expect(outcome.ok && outcome.result.kind).toBe("packageCheck");
  expect(JSON.stringify(f.packageInput())).toContain("#123456");
  expect(f.library.collections.list()).toEqual([]);
  expect(f.collection.summary().draft?.revision).toBeUndefined();
  expect(f.files.snapshot().package?.kind).toBe("packageCheck");
});

test("a failed Save version keeps the look; Undo open (Recover) shows the collection shown before an open", async () => {
  const f = await profileStudio({ looks: [{ name: "Look", recipe: freshWorkspace().recipe }],
    versions: () => ({ save: async () => { throw Error("Revision conflict."); } }) });
  await f.collection.initialize();
  f.app.dispatch({ kind: "layer.setColor", layerId: f.document.recipe.layers[0]!.id, color: "#abcdef" });
  expect(await f.collection.execute({ kind: "save" })).toMatchObject({ ok: false, message: "Revision conflict." });
  expect(f.document.recipe.layers[0]!.color).toBe("#abcdef");
  const before = f.shown();
  // Another collection saved in the library, opened here: its working copy is made from it.
  const other = crypto.randomUUID();
  f.library.collections.save({ collection: { schema: "xfs/collection-2", id: other, name: "Other", presets: [
    { id: crypto.randomUUID(), name: "Look", revision: 1, parts: f.owner.look(f.scene.look()!)!.parts }] } });
  await f.collection.execute({ kind: "refresh" });
  expect((await f.collection.execute({ kind: "open", id: other })).ok).toBe(true);
  expect(f.shown()).toBe(other);
  expect(f.collection.fileCapability({ kind: "collection.recover" }).available).toBe(true);
  expect((await f.collection.fileExecute({ kind: "collection.recover" })).ok).toBe(true);
  expect(f.shown()).toBe(before);
  expect(f.document.recipe.layers[0]!.color).toBe("#abcdef");
});
