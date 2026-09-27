// The Save Explorer's read model and service on a synthetic save (tests/fixtures/synthetic-save.ts): the node tree and its decode status,
// node and object inspections with names resolved by source, world objects paged and filtered, the generic mod-data view, and the
// service's actions, capabilities and stale-result handling over a fake device. No real save is read.
import { describe, expect, test } from "bun:test";
import { MAX_SAVE_BYTES, openExplorer, SaveExplorerActions, saveExplorerFacade, type SaveExplorerDevice, type SaveListing, type SaveTypeNames } from "../src/features/save-explorer";
import { fnv1a64 } from "../src/engines/red-object/hash";
import { EXPLORER_NAMES as NAMES, EXPLORER_TYPES as TYPES, manyEntriesSave, syntheticSave } from "./fixtures/synthetic-explorer-save";

describe("explorer read model", () => {
  test("the tree gives every node its encoding and size; packages and world objects are checked one node at a time", () => {
    const explorer = openExplorer(syntheticSave(), NAMES);
    const byName = Object.fromEntries(explorer.tree().map(row => [row.name, row]));
    expect(byName.TypeDatabase_v2).toMatchObject({ encoding: "type-database", status: "decoded" });
    expect(byName.inventory).toMatchObject({ encoding: "container", status: "decoded", children: [3] });
    expect(byName.itemData).toMatchObject({ encoding: "bespoke", status: "raw", depth: 1 });
    expect(byName.TimeSystem).toMatchObject({ encoding: "bespoke", status: "raw" });
    expect(byName.ScriptableSystemsContainer).toMatchObject({ encoding: "package", status: "checking" });
    expect(byName.PersistencySystem2).toMatchObject({ encoding: "persistency", status: "checking" });
    const pending = explorer.pending();
    expect(pending.sort()).toEqual([byName.PersistencySystem2!.id, byName.ScriptableSystemsContainer!.id, byName.StatsSystem!.id].sort());
    for (const id of pending) explorer.check(id);
    const after = Object.fromEntries(explorer.tree().map(row => [row.name, row]));
    expect(after.ScriptableSystemsContainer).toMatchObject({ status: "partial", detail: "2 objects, 1 fully read" });
    expect(after.StatsSystem).toMatchObject({ status: "decoded" });
    expect(after.PersistencySystem2).toMatchObject({ status: "partial", detail: "3 world objects, 66.6 % read" });
    expect(explorer.pending()).toEqual([]);
    expect(explorer.summary()).toMatchObject({ saveVersion: 269, gameVersion: 2310, nodes: 7, issues: [], types: { engineNames: true, scriptNames: true } });
  });

  test("node inspections: package objects, world-object statistics, the schema table and raw bytes", () => {
    const explorer = openExplorer(syntheticSave(), NAMES), id = (name: string) => explorer.save.find(name)[0]!.id;
    const pkg = explorer.node(id("ScriptableSystemsContainer"));
    expect(pkg).toMatchObject({ kind: "package", variant: "script systems (with CRUIDs)", decoded: 1, partial: 1, failed: 0, trailing: 0 });
    const plain = explorer.node(id("StatsSystem"));
    expect(plain).toMatchObject({ kind: "package", variant: "native system", trailing: 3 });
    const persistency = explorer.node(id("PersistencySystem2"));
    expect(persistency).toMatchObject({ kind: "persistency", entries: 4, filled: 3, walked: 2 });
    if (persistency?.kind === "persistency") {
      expect(persistency.classes).toEqual([{ type: "DoorControllerPS", count: 2 }, { type: "App.DynamicEntitySystemPS", count: 1 }]);
      expect(persistency.notWalked[0]!.reason).toMatch(/fixed arrays/);
    }
    const schema = explorer.node(id("TypeDatabase_v2"));
    expect(schema).toMatchObject({ kind: "type-database", types: TYPES.length, typesNamed: TYPES.length, properties: 3, propertiesNamed: 2 });
    const raw = explorer.node(id("TimeSystem"));
    expect(raw?.kind).toBe("bespoke");
    if (raw?.kind === "bespoke") expect(raw.hex.split("\n")[0]).toBe("000000  02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02");
    expect(explorer.node(999)).toBeUndefined();
  });

  test("objects: typed fields with handles as links, names by source, and what isn't read kept as bytes", () => {
    const explorer = openExplorer(syntheticSave(), NAMES), systemsId = explorer.save.find("ScriptableSystemsContainer")[0]!.id;
    const system = explorer.object({ node: systemsId, kind: "chunk", index: 0 })!;
    expect(system.fields[0]).toMatchObject({ name: "state", type: "handle:SomeMod.OutfitState", value: "→ SomeMod.OutfitState #1", link: { node: systemsId, kind: "chunk", index: 1 } });
    const state = explorer.object({ node: systemsId, kind: "chunk", index: 1 })!;
    expect(state.status).toBe("partial");
    expect(state.fields.map(field => [field.name, field.type, field.value])).toEqual([["mode", "SomeMod.Mode", "Wide"], ["name", "String", "Night out"],
      ["fixed", "[2]Int32", "8 bytes, not read"], ["count", "Int32", "2"]]);
    const worldId = explorer.save.find("PersistencySystem2")[0]!.id;
    const door = explorer.object({ node: worldId, kind: "entry", index: 0 })!;
    expect(door).toMatchObject({ title: "DoorControllerPS", status: "decoded" });
    expect(door.fields).toEqual([{ name: "isOpen", named: "scripts", type: "Bool", value: "true" }]);
    const stuck = explorer.object({ node: worldId, kind: "entry", index: 2 })!;
    expect(stuck.status).toBe("partial");
    expect(stuck.hex).toBeDefined();
    expect(explorer.object({ node: worldId, kind: "entry", index: 1 })).toBeUndefined();
    // Without installed script names the property shows as its hash, and the class too.
    const bare = openExplorer(syntheticSave(), {});
    expect(bare.object({ node: worldId, kind: "entry", index: 0 })!.fields[0]).toMatchObject({ name: `#${fnv1a64("isOpen").toString(16).padStart(16, "0")}`, named: "unnamed" });
    expect(bare.summary().types.scriptNames).toBe(false);
  });

  test("world objects page and filter by class", () => {
    const explorer = openExplorer(syntheticSave(), NAMES);
    expect(explorer.entries(0, 10).rows.map(row => [row.type, row.status])).toEqual([["DoorControllerPS", "decoded"], ["DoorControllerPS", "raw"], ["App.DynamicEntitySystemPS", "decoded"]]);
    expect(explorer.entries(0, 10, "dynamic").total).toBe(1);
    expect(explorer.entries(1, 1)).toMatchObject({ total: 3, offset: 1, rows: [{ id: "0000000000000066" }] });
  });

  test("mod data: namespaced classes from packages and world objects, grouped, with whether installed scripts define them", () => {
    const view = openExplorer(syntheticSave(), NAMES).modData();
    expect(view.namespaces.map(group => [group.namespace, group.classes.map(item => [item.type, item.objects.length, item.defined])])).toEqual([
      ["App", [["App.DynamicEntitySystemPS", 1, true]]], ["SomeMod", [["SomeMod.OutfitState", 1, true]]]]);
    const gone = openExplorer(syntheticSave(), { ...NAMES, scripts: ["DoorControllerPS"] }).modData();
    expect(gone.namespaces.find(group => group.namespace === "SomeMod")?.classes[0]?.defined).toBe(false);
    expect(openExplorer(syntheticSave(), {}).modData().scriptNames).toBe(false);
  });
});

describe("explorer service", () => {
  const listing: SaveListing[] = [{ folder: "QuickSave-0", kind: "quick", savedAt: "2026-09-26T19:19:32.000Z", location: "Watson", level: 6, lifePath: "Corporate",
    gameVersion: "2.31", saveVersion: 269, bytes: 1000, screenshot: true, modded: true }];
  const names: SaveTypeNames = { engine: NAMES.engine, scripts: { available: true, names: NAMES.scripts } };
  const picked = (name: string, bytes: Uint8Array, size = bytes.length) => ({ name, size, bytes: async () => bytes });
  const device = (overrides: Partial<SaveExplorerDevice> = {}): SaveExplorerDevice => ({
    list: async () => ({ available: true, saves: listing }), read: async () => syntheticSave(), pick: async () => picked("sav.dat", syntheticSave()),
    names: async () => names, thumbnail: folder => `/thumb/${folder}`, ...overrides });
  const now = () => Promise.resolve();

  test("lists, opens a listed save and fills in the tree's status, then closes", async () => {
    const service = new SaveExplorerActions(device(), now), facade = saveExplorerFacade(service);
    let changes = 0;
    const unsubscribe = facade.subscribe(() => changes++);
    expect(facade.capability({ kind: "saves.open", folder: "QuickSave-0" })).toMatchObject({ available: false, code: "missing_target" });
    expect(await facade.dispatch({ kind: "saves.refresh" })).toEqual({ ok: true });
    expect(facade.snapshot().listing).toMatchObject({ phase: "ready", available: true, saves: [{ folder: "QuickSave-0" }] });
    expect(facade.thumbnail("QuickSave-0")).toBe("/thumb/QuickSave-0");
    expect(facade.thumbnail("Elsewhere")).toBeNull();
    expect(await facade.dispatch({ kind: "saves.open", folder: "QuickSave-0" })).toEqual({ ok: true });
    const state = facade.snapshot();
    expect(state.open).toMatchObject({ phase: "ready", source: { kind: "listed", folder: "QuickSave-0" }, checking: false });
    expect(state.names).toMatchObject({ phase: "ready", scripts: true });
    expect(state.selection.node).toBe(0);
    expect(facade.tree().every(row => row.status !== "checking")).toBe(true);
    expect(await facade.dispatch({ kind: "saves.selectNode", node: 3 })).toEqual({ ok: true });
    expect(facade.node(3)?.kind).toBe("bespoke");
    const ref = { node: facade.tree().find(row => row.encoding === "persistency")!.id, kind: "entry" as const, index: 0 };
    expect(await facade.dispatch({ kind: "saves.inspect", ref })).toEqual({ ok: true });
    expect(facade.snapshot().selection.object).toEqual(ref);
    expect(facade.object(ref)?.title).toBe("DoorControllerPS");
    expect(facade.modData()?.namespaces).toHaveLength(2);
    expect(await facade.dispatch({ kind: "saves.setView", view: "mods" })).toEqual({ ok: true });
    expect(await facade.dispatch({ kind: "saves.close" })).toEqual({ ok: true });
    expect(facade.snapshot().open.phase).toBe("none");
    expect(facade.tree()).toEqual([]);
    expect(facade.capability({ kind: "saves.close" })).toMatchObject({ available: false, code: "missing_target" });
    expect(changes).toBeGreaterThan(5);
    unsubscribe();
  });

  test("a picked file opens the same way; a cancelled pick changes nothing; a non-save is refused plainly", async () => {
    const service = new SaveExplorerActions(device(), now);
    expect(await service.dispatch({ kind: "saves.openFile" })).toEqual({ ok: true });
    expect(service.snapshot().open).toMatchObject({ phase: "ready", source: { kind: "file", name: "sav.dat" } });
    const cancelled = new SaveExplorerActions(device({ pick: async () => undefined }), now);
    expect(await cancelled.dispatch({ kind: "saves.openFile" })).toMatchObject({ ok: true, message: "No file chosen." });
    expect(cancelled.snapshot().open.phase).toBe("none");
    const junk = new SaveExplorerActions(device({ pick: async () => picked("notes.txt", new Uint8Array(100)) }), now);
    expect(await junk.dispatch({ kind: "saves.openFile" })).toMatchObject({ ok: false, code: "invalid_value" });
    expect(junk.snapshot().open).toMatchObject({ phase: "failed", message: expect.stringMatching(/couldn't be opened as a Cyberpunk 2077 save/) });
  });

  test("a picked file larger than any save is refused by its size, before its bytes are read (SAVE-08)", async () => {
    let reads = 0;
    const huge = new SaveExplorerActions(device({ pick: async () => ({ name: "huge.dat", size: MAX_SAVE_BYTES + 1, bytes: async () => { reads++; return new Uint8Array(0); } }) }), now);
    expect(await huge.dispatch({ kind: "saves.openFile" })).toMatchObject({ ok: false, code: "limit" });
    expect(huge.snapshot().open).toMatchObject({ phase: "failed", source: { kind: "file", name: "huge.dat" }, message: expect.stringMatching(/larger than any/) });
    expect(reads).toBe(0);
  });

  test("the world objects are checked in bounded steps, yielding to the page between them (SAVE-06)", async () => {
    // Enough entries for several steps of the walk.
    let yields = 0;
    const service = new SaveExplorerActions(device({ read: async () => manyEntriesSave(2_000) }), () => { yields++; return Promise.resolve(); });
    await service.dispatch({ kind: "saves.refresh" });
    expect(await service.dispatch({ kind: "saves.open", folder: "QuickSave-0" })).toEqual({ ok: true });
    const row = service.tree().find(item => item.encoding === "persistency")!;
    expect(row).toMatchObject({ status: "decoded", detail: expect.stringMatching(/^2,000 world objects, 100.0 % read/) });
    expect(yields).toBeGreaterThan(3);
    const explorer = openExplorer(manyEntriesSave(2_000), {});
    let steps = 0;
    while (!explorer.checkStep(row.id)) steps++;
    expect(steps).toBeGreaterThan(1);
    // Inspecting the node before the walk ends takes one step and says it is still counting.
    const fresh = openExplorer(manyEntriesSave(2_000), {}), first = fresh.node(row.id);
    expect(first).toMatchObject({ kind: "persistency", complete: false });
    expect(fresh.tree().find(item => item.id === row.id)?.status).toBe("checking");
  });

  test("without name sources the save still opens; a failed listing says what to do; no device refuses every action", async () => {
    const service = new SaveExplorerActions(device({ names: async () => { throw Error("offline"); }, list: async () => { throw Error("offline"); } }), now);
    expect(await service.dispatch({ kind: "saves.refresh" })).toMatchObject({ ok: false, code: "unavailable" });
    expect(service.snapshot().listing).toMatchObject({ phase: "failed", message: expect.stringMatching(/Refresh/) });
    expect(await service.dispatch({ kind: "saves.openFile" })).toEqual({ ok: true });
    expect(service.snapshot()).toMatchObject({ open: { phase: "ready" }, names: { phase: "failed", scripts: false } });
    // Malformed host answers are refused by the validators, never used.
    const malformed = new SaveExplorerActions(device({ list: async () => ({ available: true, saves: [{ folder: 3 }] }) }), now);
    expect(await malformed.dispatch({ kind: "saves.refresh" })).toMatchObject({ ok: false });
    const none = new SaveExplorerActions(null, now);
    for (const action of [{ kind: "saves.refresh" }, { kind: "saves.openFile" }] as const)
      expect(none.capability(action)).toMatchObject({ available: false, code: "unavailable" });
    expect(none.capability({ kind: "saves.nope" } as never)).toMatchObject({ available: false, code: "invalid_value" });
  });

  test("a slower earlier open never publishes over a later one", async () => {
    let release!: () => void;
    const slow = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const service = new SaveExplorerActions(device({ read: async () => { if (first) { first = false; await slow; } return syntheticSave(); } }), now);
    await service.dispatch({ kind: "saves.refresh" });
    const earlier = service.dispatch({ kind: "saves.open", folder: "QuickSave-0" });
    await service.dispatch({ kind: "saves.close" });
    await service.dispatch({ kind: "saves.openFile" });
    release();
    await earlier;
    expect(service.snapshot().open.source).toEqual({ kind: "file", name: "sav.dat" });
  });
});
