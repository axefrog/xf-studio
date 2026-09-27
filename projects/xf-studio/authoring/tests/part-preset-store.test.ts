/**
 * Part presets (research/authoring/editor-invariants.md "Part presets"): a table of their own in the library file, added forwards
 * without touching the released tables, so 0.1.0-alpha.1 still lists the library (CORE-30) and its version check still passes.
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionLibrary } from "../src/collection-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { LookLibrary } from "../src/library-store";
import { PartPresetLibrary, partPresetRequest } from "../src/part-preset-store";
import { alphaList } from "./fixtures/alpha-0.1.0/collection-list";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { parseRecipeFile } from "../src/recipe-schema";

const expression = (controls: Record<string, number>) => ({ schema: "xfs/expression-part-1", body: { controls, links: {} } });

function library() {
  const dir = mkdtempSync(join(tmpdir(), "xfs-part-presets-")), path = join(dir, "library.sqlite");
  new LookLibrary(path).close();
  return { path, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing. */ } } };
}

test("saving, renaming and deleting presets leaves the released tables, their version and alpha.1's list untouched", () => {
  const temp = library(), collections = new CollectionLibrary(temp.path, STUDIO_PARTS);
  const saved = collections.save({ collection: STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[0])) });
  const before = new Database(temp.path, { readonly: true });
  const version = (before.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  const tables = (db: Database) => (db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
  const released = tables(before);
  before.close();
  let n = 0;
  const presets = new PartPresetLibrary(temp.path, STUDIO_PARTS, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
  try {
    const smile = presets.save({ feature: "expressions", name: " Soft smile ", part: expression({ lips_l_corner_up: 0.3, lips_r_corner_up: 0.3 }) });
    presets.save({ feature: "expressions", name: "a slight frown", part: expression({ eye_l_brows_lower: 0.2 }) });
    expect(smile).toMatchObject({ name: "Soft smile", revision: 1, feature: "expressions" });
    // Listed by name (case-insensitive), each part parsed at its current schema (weights float32).
    const listed = presets.list("expressions");
    expect(listed.map(item => item.name)).toEqual(["a slight frown", "Soft smile"]);
    expect(listed[1]!.part.body).toEqual({ controls: { lips_l_corner_up: Math.fround(0.3), lips_r_corner_up: Math.fround(0.3) }, links: {} });
    expect(presets.rename(smile.id, { name: "Smile", revision: 1 })).toEqual({ id: smile.id, name: "Smile", revision: 2 });
    // A stale window can't overwrite or remove a newer change.
    expect(() => presets.rename(smile.id, { name: "Old", revision: 1 })).toThrow("changed in another window");
    expect(() => presets.delete(smile.id, 1)).toThrow("changed in another window");
    presets.delete(smile.id, 2);
    expect(presets.list("expressions").map(item => item.name)).toEqual(["a slight frown"]);
    // Refusals in plain words: a damaged part, a blank name, an unknown kind.
    expect(() => presets.save({ feature: "expressions", name: "Bad", part: expression({ jaw_mid_open: 2 }) })).toThrow("damaged");
    expect(() => presets.save({ feature: "expressions", name: "  ", part: expression({}) })).toThrow("Give the preset a name.");
    expect(() => presets.list("hair")).toThrow("isn't known");
  } finally { presets.close(); }
  const after = new Database(temp.path, { readonly: true });
  try {
    expect((after.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(version);
    expect(tables(after)).toEqual([...released, "part_preset_sets", "part_presets"].sort());
    // The release's own list reads the library exactly as before.
    const alpha = alphaList(after, parseRecipeFile);
    expect(alpha.map(({ id, name, revision, count }) => ({ id, name, revision, count })))
      .toEqual(collections.list().map(({ id, name, revision, count }) => ({ id, name, revision, count })));
    expect(alpha.map(item => item.id)).toContain(saved.collection.id);
  } finally { after.close(); collections.close(); temp.cleanup(); }
});

test("a row of a newer part schema is kept and left out of the list; the table is created only once", () => {
  const temp = library();
  const first = new PartPresetLibrary(temp.path, STUDIO_PARTS);
  first.save({ feature: "expressions", name: "Kept", part: expression({ jaw_mid_open: 0.1 }) });
  first.close();
  const raw = new Database(temp.path);
  raw.query("INSERT INTO part_presets VALUES ('expressions', '00000000-0000-4000-8000-000000000099', 'Newer', 1, 'xfs/expression-part-9', '{}', 'x', 'x')").run();
  raw.close();
  const again = new PartPresetLibrary(temp.path, STUDIO_PARTS);
  try {
    expect(again.list("expressions").map(item => item.name)).toEqual(["Kept"]);
    const db = new Database(temp.path, { readonly: true });
    expect((db.query("SELECT COUNT(*) AS n FROM part_presets").get() as { n: number }).n).toBe(2);
    db.close();
  } finally { again.close(); temp.cleanup(); }
});

test("the endpoint lists, saves, renames and deletes for the local studio only", async () => {
  const temp = library(), presets = new PartPresetLibrary(temp.path, STUDIO_PARTS);
  const base = "http://127.0.0.1:1/api/part-presets", origin = "http://127.0.0.1:1";
  const send = (method: string, path = "", body?: unknown, headers: Record<string, string> = { Origin: origin, "Content-Type": "application/json" }) =>
    partPresetRequest(new Request(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), presets, "/api/part-presets");
  try {
    const saved = await (await send("POST", "", { feature: "expressions", name: "Smile", part: expression({ lips_l_corner_up: 0.2 }) })).json() as { id: string };
    expect((await (await send("GET", "?feature=expressions", undefined, {})).json() as unknown[]).length).toBe(1);
    expect((await send("PATCH", `/${saved.id}`, { name: "Grin", revision: 1 })).status).toBe(200);
    expect((await send("DELETE", `/${saved.id}?revision=1`)).status).toBe(409);
    expect((await send("DELETE", `/${saved.id}?revision=2`)).status).toBe(200);
    expect((await send("POST", "", { feature: "expressions", name: "x", part: expression({}) }, { Origin: "http://evil.test", "Content-Type": "application/json" })).status).toBe(403);
    // JSON that isn't an object is refused plainly; a body over the limit is refused before it is read whole (CORE-106).
    expect((await send("POST", "", null)).status).toBe(400);
    expect((await send("POST", "", { feature: "expressions" }, { Origin: origin, "Content-Type": "application/json", "Content-Length": "9999999" })).status).toBe(413);
    expect((await send("POST", "", { feature: "expressions", name: "x".repeat(2_100_000) })).status).toBe(413);
  } finally { presets.close(); temp.cleanup(); }
});

test("the presets family's service lists on first ask, keeps names sorted and refuses in plain words", async () => {
  const { PartPresetService } = await import("../src/part-presets");
  const rows: { id: string; feature: string; name: string; revision: number; part: { schema: string; body: unknown }; updatedAt: string }[] = [];
  let n = 0;
  const service = new PartPresetService({
    list: async () => structuredClone(rows),
    save: async input => { const row = { ...input, id: `id-${++n}`, revision: 1, updatedAt: "now" }; rows.push(row); return row; },
    rename: async (id, input) => ({ id, name: input.name, revision: input.revision + 1 }),
    delete: async id => ({ id }),
    listSets: async () => [], createSet: async () => { throw Error("unused"); }, updateSet: async () => { throw Error("unused"); },
    deleteSet: async id => ({ id }),
  });
  expect(service.snapshot("expressions")).toEqual({ phase: "loading", items: [] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(service.snapshot("expressions")).toEqual({ phase: "ready", items: [] });
  expect(service.capability({ kind: "partPreset.save", feature: "expressions", name: " ", part: expression({}) })).toMatchObject({ available: false, code: "needs_input" });
  await service.execute({ kind: "partPreset.save", feature: "expressions", name: "zeta", part: expression({}) });
  await service.execute({ kind: "partPreset.save", feature: "expressions", name: "Alpha", part: expression({}) });
  expect(service.snapshot("expressions").items.map(item => item.name)).toEqual(["Alpha", "zeta"]);
  await service.execute({ kind: "partPreset.rename", feature: "expressions", id: "id-1", name: "Beta", revision: 1 });
  expect(service.snapshot("expressions").items.map(item => [item.name, item.revision])).toEqual([["Alpha", 1], ["Beta", 2]]);
  expect(service.capability({ kind: "partPreset.delete", feature: "expressions", id: "gone", revision: 1 })).toMatchObject({ available: false, code: "missing_target" });
  expect(await service.execute({ kind: "partPreset.delete", feature: "expressions", id: "id-2", revision: 1 })).toEqual({ ok: true });
  expect(service.snapshot("expressions").items.map(item => item.name)).toEqual(["Beta"]);
});

test("expression sets: created, renamed, filled, named for export and deleted, revision-guarded, beside the presets", async () => {
  const temp = library();
  let n = 0;
  const presets = new PartPresetLibrary(temp.path, STUDIO_PARTS, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
  try {
    const smile = presets.save({ feature: "expressions", name: "Smile", part: expression({ lips_l_corner_up: 0.3 }) });
    const frown = presets.save({ feature: "expressions", name: "Frown", part: expression({ eye_l_brows_lower: 0.2 }) });
    const set = presets.createSet({ feature: "expressions", name: "  Moody  " });
    expect(set).toMatchObject({ name: "Moody", revision: 1, members: [] });
    expect(() => presets.createSet({ feature: "expressions", name: " " })).toThrow("Give the set a name.");
    expect(() => presets.createSet({ feature: "nope", name: "x" })).toThrow();
    const filled = presets.updateSet(set.id, { revision: 1, members: [frown.id, smile.id] });
    expect(filled).toMatchObject({ revision: 2, members: [frown.id, smile.id] });
    // A stale window can't overwrite; a damaged or duplicated list is refused.
    expect(() => presets.updateSet(set.id, { revision: 1, name: "Late" })).toThrow("changed in another window");
    expect(() => presets.updateSet(set.id, { revision: 2, members: [smile.id, smile.id] })).toThrow("damaged");
    expect(() => presets.updateSet(set.id, { revision: 2, members: ["not-a-uuid"] })).toThrow("damaged");
    // The mod name and table: a folder-unsafe name is refused in plain words; an empty name goes back to the default.
    expect(() => presets.updateSet(set.id, { revision: 2, modName: "XF: Moody" })).toThrow("can't contain");
    const named = presets.updateSet(set.id, { revision: 2, modName: "XF Moody Faces", table: "sharing", name: "Moody faces" });
    expect(named).toMatchObject({ name: "Moody faces", modName: "XF Moody Faces", table: "sharing", revision: 3 });
    const cleared = presets.updateSet(set.id, { revision: 3, modName: "", table: "installed" });
    expect(cleared.modName).toBeUndefined(); expect(cleared.table).toBeUndefined();
    // Deleting a saved expression takes it out of its sets in the same step; restoring puts both back, at its old place.
    const removed = presets.delete(smile.id, 1);
    expect(presets.listSets("expressions")[0]).toMatchObject({ members: [frown.id], revision: 5 });
    expect(removed.restore!.memberships).toEqual([{ set: set.id, index: 1 }]);
    expect(presets.restore(removed.restore!)).toMatchObject({ id: smile.id, name: "Smile", revision: 1 });
    expect(presets.listSets("expressions")[0]).toMatchObject({ members: [frown.id, smile.id], revision: 6 });
    expect(() => presets.restore(removed.restore!)).toThrow("already back");
    // Renaming with a part replaces the part too (an expression's photo-mode name lives there).
    expect(presets.rename(smile.id, { name: "Smirk", revision: 1, part: expression({ lips_l_corner_up: 0.3 }) })).toMatchObject({ name: "Smirk", revision: 2 });
    // The request route: list and change through <prefix>/sets.
    const origin = "http://127.0.0.1:4999";
    const listed = await (await partPresetRequest(new Request(`${origin}/api/part-presets/sets?feature=expressions`), presets, "/api/part-presets")).json();
    expect(listed).toHaveLength(1);
    const patched = await partPresetRequest(new Request(`${origin}/api/part-presets/sets/${set.id}`, { method: "PATCH", headers: { Origin: origin,
      "Content-Type": "application/json" }, body: JSON.stringify({ revision: 6, members: [frown.id] }) }), presets, "/api/part-presets");
    expect(patched.status).toBe(200);
    const foreign = await partPresetRequest(new Request(`${origin}/api/part-presets/sets/${set.id}?revision=7`, { method: "DELETE", headers: { Origin: "http://evil" } }),
      presets, "/api/part-presets");
    expect(foreign.status).toBe(403);
    expect(presets.deleteSet(set.id, 7)).toEqual({ id: set.id });
    expect(presets.listSets("expressions")).toEqual([]);
  } finally { presets.close(); temp.cleanup(); }
});

test("a damaged set row never stops a preset's delete or restore: it is skipped and kept as it is (CORE-116)", () => {
  const temp = library();
  let n = 0;
  const presets = new PartPresetLibrary(temp.path, STUDIO_PARTS, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
  try {
    const smile = presets.save({ feature: "expressions", name: "Smile", part: expression({ lips_l_corner_up: 0.3 }) });
    const good = presets.createSet({ feature: "expressions", name: "Good", members: [smile.id] });
    const broken = presets.createSet({ feature: "expressions", name: "Broken", members: [smile.id] });
    const db = new Database(temp.path);
    db.query("UPDATE part_preset_sets SET body=? WHERE id=?").run("{damaged", broken.id);
    db.close();
    const removed = presets.delete(smile.id, 1);
    expect(removed.restore!.memberships).toEqual([{ set: good.id, index: 0 }]);
    const raw = new Database(temp.path);
    expect((raw.query("SELECT body FROM part_preset_sets WHERE id=?").get(broken.id) as { body: string }).body).toBe("{damaged");
    raw.close();
    // Restore goes back into the good set; one naming the damaged set skips it too.
    expect(presets.restore({ ...removed.restore!, memberships: [...removed.restore!.memberships, { set: broken.id, index: 0 }] })).toMatchObject({ id: smile.id });
    expect(presets.listSets("expressions").find(set => set.id === good.id)).toMatchObject({ members: [smile.id] });
  } finally { presets.close(); temp.cleanup(); }
});

test("a set exports as a package-only collection named for the mod, members in order, deleted ones left out", async () => {
  const { setCollection, defaultSetModName } = await import("../src/part-preset-sets");
  expect(defaultSetModName("expressions", "Moody: faces?")).toBe("XF Expressions - Moody faces");
  expect(defaultSetModName("expressions", "  ")).toBe("XF Expressions");
  expect(defaultSetModName("expressions", "x".repeat(200)).length).toBeLessThanOrEqual(80);
  const a = "00000000-0000-4000-8000-00000000000a", b = "00000000-0000-4000-8000-00000000000b", gone = "00000000-0000-4000-8000-00000000000c";
  const set = { id: "00000000-0000-4000-8000-0000000000ff", feature: "expressions", name: "Moody", revision: 3, members: [b, gone, a], updatedAt: "now" };
  const presets = [{ id: a, name: "A", revision: 1, part: expression({ jaw_mid_open: 0.5 }) }, { id: b, name: "B", revision: 2, part: expression({ eye_l_blink: 1 }) }];
  const collection = setCollection(set, presets);
  expect(collection.presets.map(look => look.id)).toEqual([b, a]);
  expect(collection.packagePlan).toEqual({ schema: "xfs/package-plan-1", products: [{ id: set.id, name: "XF Expressions - Moody", features: ["expressions"] }] });
  expect(collection.presetSet).toEqual({ table: "installed" });
  expect(setCollection({ ...set, table: "sharing", modName: "Mine" }, presets)).toMatchObject({ presetSet: { table: "sharing" },
    packagePlan: { products: [{ name: "Mine" }] } });
});

test("a set's Check and Build go through the package route with its package-only collection; reveal waits for a build", async () => {
  const { PartPresetService } = await import("../src/part-presets");
  const presetId = "00000000-0000-4000-8000-000000000001", setId = "00000000-0000-4000-8000-0000000000aa";
  const preset = { id: presetId, feature: "expressions", name: "Smile", revision: 1, part: expression({ jaw_mid_open: 0.2 }), updatedAt: "now" };
  const sets = [{ id: setId, feature: "expressions", name: "Moody", revision: 1, members: [] as string[], updatedAt: "now" }];
  const sent: unknown[] = [], revealed: string[] = [];
  const service = new PartPresetService({
    list: async () => [preset], save: async () => { throw Error("unused"); }, rename: async () => { throw Error("unused"); }, delete: async id => ({ id }),
    listSets: async () => structuredClone(sets), createSet: async () => { throw Error("unused"); }, deleteSet: async id => ({ id }),
    updateSet: async (id, input) => { Object.assign(sets[0]!, input, { revision: sets[0]!.revision + 1 }); return structuredClone(sets[0]!); },
  }, {
    package: async (action, collection) => { sent.push({ action, collection }); return { schema: action === "build" ? "xfs/package-build-2" : "xfs/package-check-2",
      products: [{ package: "C:/dist/xfs_c00-1", features: [] }], omissions: [], originalPresetCount: 1 } as never; },
    reveal: async id => { revealed.push(id); return { ok: true }; },
  });
  service.snapshot("expressions"); service.sets("expressions");
  await Bun.sleep(0);
  expect(service.capability({ kind: "partPresetSet.check", feature: "expressions", id: setId })).toMatchObject({ available: false, code: "needs_input" });
  expect(service.capability({ kind: "partPresetSet.reveal", feature: "expressions", id: setId })).toMatchObject({ available: false, code: "missing_target" });
  expect(await service.execute({ kind: "partPresetSet.setMembers", feature: "expressions", id: setId, members: [presetId], revision: 1 })).toMatchObject({ ok: true });
  expect(service.capability({ kind: "partPresetSet.setExport", feature: "expressions", id: setId, revision: 2, modName: "XF: bad" }))
    .toMatchObject({ available: false, code: "invalid_value" });
  expect(await service.execute({ kind: "partPresetSet.build", feature: "expressions", id: setId })).toEqual({ ok: true });
  expect(sent).toHaveLength(1);
  expect((sent[0] as { collection: { presetSet: unknown; presets: { id: string }[] } }).collection).toMatchObject({ presetSet: { table: "installed" },
    presets: [{ id: presetId }] });
  expect(service.exportState().results[setId]).toMatchObject({ kind: "build", revision: 2, missing: 0 });
  expect(await service.execute({ kind: "partPresetSet.reveal", feature: "expressions", id: setId })).toEqual({ ok: true });
  expect(revealed).toEqual(["xfs_c00-1"]);
});

test("a set's provisional Check runs again by itself, and Build says why while a current Check found nothing to package", async () => {
  const { PartPresetService } = await import("../src/part-presets");
  const presetId = "00000000-0000-4000-8000-000000000001", setId = "00000000-0000-4000-8000-0000000000aa";
  const preset = { id: presetId, feature: "expressions", name: "Smile", revision: 1, part: expression({ jaw_mid_open: 0.2 }), updatedAt: "now" };
  const sets = [{ id: setId, feature: "expressions", name: "Moody", revision: 1, members: [presetId], updatedAt: "now" }];
  let answers = 0, refuse = false;
  const service = new PartPresetService({
    list: async () => [preset], save: async () => { throw Error("unused"); }, delete: async id => ({ id }),
    rename: async (id, input) => ({ id, name: input.name, revision: input.revision + 1, ...(input.part ? { part: input.part } : {}) }),
    listSets: async () => structuredClone(sets), createSet: async () => { throw Error("unused"); }, deleteSet: async id => ({ id }),
    updateSet: async () => { throw Error("unused"); },
  }, {
    package: async () => {
      answers++;
      if (refuse) throw Object.assign(Error("Nothing in this set can become mod files yet."), { code: "no_exportable_content",
        omissions: [{ kind: "preset", presetId, presetName: "Smile", reason: "“Smile” is damaged, so XF Studio can't read it." }] });
      // The first two answers are provisional (the game files still being read), then a final one.
      return { schema: "xfs/package-check-2", ready: true, omissions: [], originalPresetCount: 1,
        products: [{ features: [{ details: answers <= 2 ? { provisional: true } : {}, presets: [], omissions: [], notes: [] }] }] } as never;
    },
    reveal: async () => ({ ok: true }),
  }, { recheckMs: 5 });
  service.snapshot("expressions"); service.sets("expressions");
  await Bun.sleep(0);
  await service.execute({ kind: "partPresetSet.check", feature: "expressions", id: setId });
  for (let i = 0; i < 40 && answers < 3; i++) await Bun.sleep(10);
  await Bun.sleep(30);
  expect(answers).toBe(3);
  refuse = true;
  expect(await service.execute({ kind: "partPresetSet.check", feature: "expressions", id: setId })).toMatchObject({ ok: false, code: "no_exportable_content" });
  expect(service.exportState().results[setId]).toMatchObject({ kind: "failed", omissions: [{ presetId }] });
  expect(service.capability({ kind: "partPresetSet.build", feature: "expressions", id: setId }))
    .toMatchObject({ available: false, code: "needs_input", reason: "Nothing in this set can become mod files yet. Fix what Check listed, then check again." });
  expect(service.capability({ kind: "partPresetSet.check", feature: "expressions", id: setId })).toEqual({ available: true });
  // Fixing the listed expression (a new revision of a member, the set itself unchanged) makes that result stale: Build may run (PIPE-120).
  expect(await service.execute({ kind: "partPreset.rename", feature: "expressions", id: presetId, name: "Smile", revision: 1, part: expression({ jaw_mid_open: 0.3 }) }))
    .toMatchObject({ ok: true });
  expect(service.capability({ kind: "partPresetSet.build", feature: "expressions", id: setId })).toEqual({ available: true });
});
