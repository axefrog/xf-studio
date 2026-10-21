/**
 * The library's first-run and housekeeping behaviour for the beta (release-readiness-audit.md items 11–13), on the profile services: a
 * library with no collection starts with a starter collection, Add preset starts from the starter look, Save as new collection names itself
 * uniquely, the saved list is read quietly, and a recent draft is picked from its list.
 */
import { expect, setSystemTime, test } from "bun:test";
import { uniqueCollectionName } from "../src/library/collection-service";
import { profileStudio } from "./fixtures/profile-studio";

async function library(options: Parameters<typeof profileStudio>[0] = { looks: [] }) {
  const studio = await profileStudio(options);
  let lists = 0;
  const list = studio.transport.list;
  studio.transport.list = () => { lists++; return list(); };
  return { ...studio, db: studio.library.collections, get lists() { return lists; } };
}

test("a library with no collection starts with the starter collection, not saved yet (item 11)", async () => {
  const lib = await library();
  expect(lib.db.list()).toEqual([]);
  expect(await lib.service.execute({ kind: "initialize" })).toMatchObject({ ok: true });
  const draft = lib.service.summary().draft!;
  expect(draft).toMatchObject({ name: "My collection" });
  expect(draft.revision).toBeUndefined();
  expect(draft.presets.map(preset => preset.name)).toEqual(["Preset 1"]);
  expect(lib.service.persistence()).toMatchObject({ baseline: "none" });
});

test("Add preset starts from the starter look, one layer like the first preset (item 12)", async () => {
  const lib = await library();
  await lib.service.execute({ kind: "initialize" });
  lib.service.dispatch({ kind: "preset.edit", command: { kind: "add" } });
  const draft = lib.service.summary().draft!;
  expect(draft.presets.map(preset => preset.name)).toEqual(["Preset 1", "Preset 2"]);
  expect(lib.document.recipe.layers).toHaveLength(1);
  // Check has something to build from it straight away.
  expect(Object.keys(lib.owner.look(lib.scene.look()!)!.parts)).toEqual(["eye-makeup"]);
});

test("Save as new collection names the copy uniquely, and the shown collection is the copy (item 12)", async () => {
  expect(uniqueCollectionName("Looks", [])).toBe("Looks");
  expect(uniqueCollectionName("Looks", ["looks"])).toBe("Looks 2");
  expect(uniqueCollectionName("Looks 2", ["Looks", "Looks 2", "Looks 3"])).toBe("Looks 4");
  expect(uniqueCollectionName("x".repeat(120), ["x".repeat(120)]).length).toBeLessThanOrEqual(120);
  const lib = await library();
  await lib.service.execute({ kind: "initialize" });
  expect(await lib.service.execute({ kind: "save" })).toMatchObject({ ok: true });
  expect(await lib.service.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
  // Saves in the same millisecond are ordered by save order (LIB-01); this scenario checks unique names.
  expect(lib.db.list().map(item => item.name).sort()).toEqual(["My collection", "My collection 2"]);
  expect(lib.service.summary().draft).toMatchObject({ name: "My collection 2", revision: 1 });
  expect(lib.service.persistence()).toMatchObject({ baseline: "known", dirty: false });
  expect(await lib.service.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
  expect(lib.db.list().map(item => item.name).sort()).toEqual(["My collection", "My collection 2", "My collection 3"]);
});

test("the saved list is read quietly: never busy, no progress line, and only a change repaints (item 13)", async () => {
  const lib = await library();
  await lib.service.execute({ kind: "initialize" });
  await lib.service.execute({ kind: "save" });
  const progress = lib.service.summary().progress;
  let events = 0; lib.service.subscribe(() => events++);
  const reading = lib.service.execute({ kind: "refresh" });
  expect(lib.service.isBusy()).toBe(false);
  expect(await reading).toMatchObject({ ok: true, result: { kind: "list" } });
  expect(lib.service.summary().progress).toEqual(progress);
  expect(events).toBe(0);
  // Another window saved a collection: the next read shows it.
  const other = lib.db.get(lib.shown()!).collection;
  lib.db.save({ collection: { ...structuredClone(other), id: crypto.randomUUID(), name: "From another window" } });
  await lib.service.execute({ kind: "refresh" });
  expect(events).toBe(1);
  expect(lib.service.summary().summaries.map(item => item.name)).toContain("From another window");
});

test("collections saved in the same millisecond list in the order they were saved, whatever their IDs (LIB-01)", async () => {
  const lib = await library();
  try {
    await lib.service.execute({ kind: "initialize" });
    await lib.service.execute({ kind: "save" });
    const draft = lib.db.get(lib.shown()!).collection;
    // IDs that sort against the save order: a tie-break on the ID would list them backwards.
    const ids = ["ffffffff-0000-4000-8000-000000000000", "88888888-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000000"];
    setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    for (const [n, id] of ids.entries()) lib.db.save({ collection: { ...structuredClone(draft), id, name: `Same instant ${n + 1}` } });
    setSystemTime();
    expect(lib.db.list().filter(item => ids.includes(item.id)).map(item => item.id)).toEqual(ids);
  } finally { setSystemTime(); }
});

test("Recent drafts: the library's other working copies never saved as a version, newest first, each opened by name (item 13)", async () => {
  const lib = await library();
  await lib.service.execute({ kind: "initialize" });
  const first = lib.shown()!;
  const imported = async (name: string) => {
    const text = JSON.stringify({ schema: "xfs/collection-2", id: crypto.randomUUID(), name, presets: [
      { id: crypto.randomUUID(), name: "Gift", revision: 1, parts: lib.owner.look(lib.scene.look()!)!.parts }] });
    expect(await lib.service.execute({ kind: "import", text, bytes: text.length })).toMatchObject({ ok: true });
    return lib.shown()!;
  };
  const a = await imported("A"), b = await imported("B");
  expect(lib.service.summary().draft!.recovery.map(entry => entry.id)).toEqual([a, first]);
  expect(lib.service.summary().draft!.recovery[0]).toMatchObject({ name: "A", presets: 1, saved: "never" });
  // Pick the older one directly: it is shown, and the one that was open is first in the list.
  lib.service.dispatch({ kind: "collection.undoOpen", draft: first });
  expect(lib.shown()).toBe(first);
  expect(lib.service.summary().draft!.recovery.map(entry => entry.id)).toEqual([b, a]);
  // A collection saved as a version is a saved collection, not a recent draft.
  await lib.service.execute({ kind: "save" });
  lib.service.dispatch({ kind: "collection.undoOpen", draft: a });
  expect(lib.service.summary().draft!.recovery.map(entry => entry.id)).toEqual([b]);
  expect(lib.service.actionCapability({ kind: "collection.undoOpen", draft: "no-such-draft" }))
    .toMatchObject({ available: false, reason: "That earlier draft is no longer in the list." });
});

test("Save as new collection reads the names now: a collection saved from another window meanwhile counts (CORE-141)", async () => {
  const lib = await library();
  await lib.service.execute({ kind: "initialize" });
  await lib.service.execute({ kind: "save" });
  // Another window saves "My collection 2"; this window's list isn't refreshed.
  const other = lib.db.get(lib.shown()!).collection;
  lib.db.save({ collection: { ...structuredClone(other), id: crypto.randomUUID(), name: "My collection 2" } });
  expect(lib.service.summary().summaries.map(item => item.name)).not.toContain("My collection 2");
  expect(await lib.service.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
  expect(lib.service.summary().draft).toMatchObject({ name: "My collection 3" });
});
