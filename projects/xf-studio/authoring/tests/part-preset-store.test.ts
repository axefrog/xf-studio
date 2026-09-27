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
    expect(tables(after)).toEqual([...released, "part_presets"].sort());
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
