/**
 * The library's first-run and housekeeping behaviour for the beta (release-readiness-audit.md items 11–13): a fresh library starts
 * empty, Add preset starts from the starter look, Save as new collection names itself uniquely, the saved list is read quietly, and
 * an earlier draft is picked from the recent-drafts list.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionLibrary } from "../src/collection-store";
import { CollectionService, uniqueCollectionName, type CollectionTransport } from "../src/collection-service";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "./fixtures/eye-region";

function coreFixture() {
  const workspace = freshWorkspace();
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  return { workspace, document: core.document };
}

function library() {
  const dir = mkdtempSync(join(tmpdir(), "xfs-beta-library-")), path = join(dir, "library.sqlite");
  const looks = new LookLibrary(path), db = new CollectionLibrary(path, STUDIO_PARTS);
  let lists = 0;
  const transport: CollectionTransport = {
    list: async () => { lists++; return db.list(); },
    get: async id => db.get(id),
    save: async (collection, revision) => db.save({ collection, revision }),
    package: async () => { throw Error("not used"); },
  };
  const fixture = coreFixture();
  const service = new CollectionService(STUDIO_DOCUMENTS, undefined, fixture.workspace.library, () => fixture.document.export(),
    editor => fixture.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), transport,
    () => ({ recipe: fixture.document.recipe, revision: fixture.document.geometryVersion.revision }));
  return { db, service, fixture, get lists() { return lists; },
    close() { db.close(); looks.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a fresh library is empty, so the first draft is the starter collection, not saved yet (item 11)", async () => {
  const lib = library();
  try {
    expect(lib.db.list()).toEqual([]);
    expect(await lib.service.execute({ kind: "initialize" })).toMatchObject({ ok: true });
    const draft = lib.service.summary().draft!;
    expect(draft).toMatchObject({ name: "My collection", revision: undefined });
    expect(draft.presets.map(preset => preset.name)).toEqual(["Preset 1"]);
    expect(lib.service.persistence()).toMatchObject({ baseline: "none" });
  } finally { lib.close(); }
});

test("Add preset starts from the starter look, one layer like the first preset (item 12)", async () => {
  const lib = library();
  try {
    await lib.service.execute({ kind: "initialize" });
    lib.service.dispatch({ kind: "preset.edit", command: { kind: "add" } });
    const draft = lib.service.summary().draft!;
    expect(draft.presets.map(preset => preset.name)).toEqual(["Preset 1", "Preset 2"]);
    expect(lib.fixture.document.recipe.layers).toHaveLength(1);
    // Check has something to build from it straight away.
    const look = lib.service.view().draft!.collection.presets[1]!;
    expect(Object.keys(look.parts)).toEqual(["eye-makeup"]);
  } finally { lib.close(); }
});

test("Save as new collection names the copy uniquely, and the draft takes the name (item 12)", async () => {
  expect(uniqueCollectionName("Looks", [])).toBe("Looks");
  expect(uniqueCollectionName("Looks", ["looks"])).toBe("Looks 2");
  expect(uniqueCollectionName("Looks 2", ["Looks", "Looks 2", "Looks 3"])).toBe("Looks 4");
  expect(uniqueCollectionName("x".repeat(120), ["x".repeat(120)]).length).toBeLessThanOrEqual(120);
  const lib = library();
  try {
    await lib.service.execute({ kind: "initialize" });
    expect(await lib.service.execute({ kind: "save" })).toMatchObject({ ok: true });
    expect(await lib.service.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
    expect(lib.db.list().map(item => item.name)).toEqual(["My collection", "My collection 2"]);
    expect(lib.service.summary().draft).toMatchObject({ name: "My collection 2", revision: 1 });
    expect(lib.service.persistence()).toMatchObject({ baseline: "known", dirty: false });
    expect(await lib.service.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
    expect(lib.db.list().map(item => item.name)).toEqual(["My collection", "My collection 2", "My collection 3"]);
  } finally { lib.close(); }
});

test("the saved list is read quietly: never busy, no progress line, and only a change repaints (item 13)", async () => {
  const lib = library();
  try {
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
    const other = lib.service.view().draft!.collection;
    lib.db.save({ collection: { ...structuredClone(other), id: crypto.randomUUID(), name: "From another window" } });
    await lib.service.execute({ kind: "refresh" });
    expect(events).toBe(1);
    expect(lib.service.summary().summaries.map(item => item.name)).toContain("From another window");
  } finally { lib.close(); }
});

test("Recent drafts: any earlier draft is picked by name, and the open one becomes the newest (item 13)", async () => {
  const lib = library();
  try {
    await lib.service.execute({ kind: "initialize" });
    const first = lib.service.summary().draft!;
    await lib.service.execute({ kind: "save" });
    await lib.service.execute({ kind: "saveCopy" });
    await lib.service.execute({ kind: "saveCopy" });
    const [a, b, c] = lib.db.list();
    // Open each saved collection in turn: every open keeps the draft that was open in the queue.
    for (const item of [a!, b!]) await lib.service.execute({ kind: "open", id: item.id });
    const current = lib.service.summary().draft!;
    expect(current.id).toBe(b!.id);
    expect(current.recovery.map(entry => entry.id)).toEqual([a!.id, c!.id]);
    // Each draft says how it stands against its saved version (readiness gate fix 1): both are as saved.
    expect(current.recovery[0]).toMatchObject({ name: a!.name, revision: 1, presets: 1, saved: "same" });
    expect(current.recovery[1]).toMatchObject({ saved: "same" });
    expect(first.recovery).toEqual([]);
    // Pick the older one directly: it comes back, and the draft that was open is first in the list.
    lib.service.dispatch({ kind: "collection.undoOpen", draft: c!.id });
    const after = lib.service.summary().draft!;
    expect(after.id).toBe(c!.id);
    expect(after.recovery.map(entry => entry.id)).toEqual([b!.id, a!.id]);
    expect(lib.service.actionCapability({ kind: "collection.undoOpen", draft: "no-such-draft" }))
      .toMatchObject({ available: false, reason: "That earlier draft is no longer in the recovery list." });
  } finally { lib.close(); }
});


test("Recent drafts say when a draft was edited since its saved version, or never saved", async () => {
  const lib = library();
  try {
    await lib.service.execute({ kind: "initialize" });
    await lib.service.execute({ kind: "save" });
    lib.service.dispatch({ kind: "collection.rename", name: "Edited draft" });
    const [saved] = lib.db.list();
    await lib.service.execute({ kind: "saveCopy" });
    await lib.service.execute({ kind: "open", id: saved!.id });
    // The copy was saved as it stood: the same. Now edit the reopened one and open the copy: it's edited since its version.
    lib.service.dispatch({ kind: "preset.edit", command: { kind: "add" } });
    await lib.service.execute({ kind: "open", id: lib.db.list()[1]!.id });
    const recovery = lib.service.summary().draft!.recovery;
    expect(recovery[0]).toMatchObject({ id: saved!.id, saved: "edited" });
    expect(recovery.map(entry => entry.saved)).toContain("same");
  } finally { lib.close(); }
});

test("a fresh workspace beside a non-empty library never names two presets alike (CORE-126)", async () => {
  const first = library();
  try {
    await first.service.execute({ kind: "initialize" });
    await first.service.execute({ kind: "save" });
    // A second session with a fresh workspace over the same library (a verification workspace, cleared browser storage).
    const again = new CollectionService(STUDIO_DOCUMENTS, undefined, coreFixture().workspace.library, () => first.fixture.document.export(),
      editor => first.fixture.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), {
        list: async () => first.db.list(), get: async id => first.db.get(id),
        save: async (collection, revision) => first.db.save({ collection, revision }), package: async () => { throw Error("not used"); } });
    await again.execute({ kind: "initialize" });
    const names = again.summary().draft!.presets.map(preset => preset.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  } finally { first.close(); }
});
test("Save as new collection reads the names now: a collection saved from another window meanwhile counts (CORE-141)", async () => {
  const lib = library();
  try {
    await lib.service.execute({ kind: "initialize" });
    await lib.service.execute({ kind: "save" });
    // Another window saves "My collection 2"; this window's list isn't refreshed.
    const other = lib.service.view().draft!.collection;
    lib.db.save({ collection: { ...structuredClone(other), id: crypto.randomUUID(), name: "My collection 2" } });
    expect(lib.service.summary().summaries.map(item => item.name)).not.toContain("My collection 2");
    expect(await lib.service.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
    expect(lib.service.summary().draft).toMatchObject({ name: "My collection 3" });
  } finally { lib.close(); }
});

test("a recent draft's verdict is judged again once its saved version is loaded, without waiting for an edit (CORE-140)", async () => {
  const lib = library();
  try {
    await lib.service.execute({ kind: "initialize" });
    await lib.service.execute({ kind: "save" });
    lib.service.dispatch({ kind: "collection.rename", name: "Edited draft" });
    const [saved] = lib.db.list();
    // Opening the saved version queues the edited draft among the recent drafts.
    await lib.service.execute({ kind: "open", id: saved!.id });
    expect(lib.service.summary().draft!.recovery[0]).toMatchObject({ id: saved!.id, saved: "edited" });
    // After a reload (no saved version known yet), the draft is unknown until the restored draft's version loads.
    const transport: CollectionTransport = { list: async () => lib.db.list(), get: async id => lib.db.get(id),
      save: async (collection, revision) => lib.db.save({ collection, revision }), package: async () => { throw Error("not used"); } };
    const reloaded = new CollectionService(STUDIO_DOCUMENTS, lib.service.snapshot(), lib.fixture.workspace.library, () => lib.fixture.document.export(),
      editor => lib.fixture.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), transport,
      () => ({ recipe: lib.fixture.document.recipe, revision: lib.fixture.document.geometryVersion.revision }));
    expect(reloaded.summary().draft!.recovery[0]).toMatchObject({ saved: "unknown" });
    await reloaded.execute({ kind: "initialize" });
    expect(reloaded.summary().draft!.recovery[0]).toMatchObject({ saved: "edited" });
  } finally { lib.close(); }
});
