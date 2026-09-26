/**
 * Feature-module platform step 2: the look/part document model and its parity gates (§2).
 * - workspace-1 fixtures restore exactly what the pre-migration code restored (golden), and
 *   keep doing so through the version-2 store at every budget level;
 * - every recipe schema and collection fixture reads the same through the old and the new path:
 *   identical recipes, byte-identical masks at 512/1K/2K, identical compiled maps and plans;
 * - a pre-migration SQLite library reads unchanged, old rows are never rewritten, unchanged
 *   presets never get a new revision, and new rows stay readable by 0.1.0-alpha.1;
 * - downgrade protection, and eye makeup's pure capability and apply in the registry.
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLLECTION_2_LIBRARY_MESSAGE, CollectionLibrary } from "../src/collection-store";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import type { EditorSnapshot } from "../src/collection-session";
import { collectionDraft, emptyMemory, parseCollectionWorkspace, readCollectionWorkspaceV1 } from "../src/collection-workspace";
import { LIVE_FEATURE, STUDIO_COMPOSITION, STUDIO_DOCUMENTS, STUDIO_PARTS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { defaultClusteredGlintFlakes, defaultDirectGlintFlakes } from "../src/engines/layered-makeup/direct-glint-settings";
import { packagePresetIdentities } from "../src/package-filter";
import { EYE_MAKEUP_FEATURE, recipeFile } from "../src/recipe-schema";
import { canonicalJson, COLLECTION_1, COLLECTION_2, NEWER_LOOK_MESSAGE, type FeatureActionSpec, type LookCollection } from "../src/platform/api";
import { PartRegistry } from "../src/platform/core/document";
import { eyeMakeupCollection, parseCollection, planCollection } from "../src/preset-collection";
import { type Recipe } from "../src/engines/layered-makeup/recipe";
import type { LayerChoices } from "../src/engines/layered-makeup/glitter-model";
import type { EyeMakeupState } from "../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { encodeWorkspaceAt } from "../src/workspace-budget";
import { loadWorkspace, parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { historiesAsRecipes, recipeOf, storedWorkspace } from "./fixtures/looks";
import { digest, observeRoundTrips, restore } from "./fixtures/workspace-observable";
import { contentDigest, recipeSchemaFixtures, withoutRecipeSchemas } from "./fixtures/part-2-parity";
import { damagedWorkspaceV1, fixedId, glitterRecipe, largeWorkspaceV1, looseWorkspaceV1, opticsRecipe, recipe3,
  smallWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { compilePreset, initialRecipe, raster, applyRecipeAction, freshWorkspace } from "./fixtures/eye-region";
import { readRecipe as parseRecipe } from "../src/recipe-schema";
import { preparePackageCollection } from "./fixtures/eye-exporter";

const golden = (name: string) => JSON.parse(readFileSync(new URL(`./golden/${name}`, import.meta.url), "utf8"));
const EYE = "eye-makeup";

// ---- Workspace-1: what the pre-migration code restored (tests/golden/workspace-v1-observable.json) ----

test("workspace-1 fixtures restore exactly what the pre-migration code restored, and keep it through version-2 storage", () => {
  // Step 2 matched `workspace-v1-observable.json` (captured from the step-1 code) exactly. Since part-2
  // the in-memory recipe has no schema tag, so the comparison is with the same observation of the step-2
  // code with recipe schema tags removed (`part-2-parity.json`): every other observable fact is equal.
  const expected = golden("part-2-parity.json").workspace;
  for (const [name, fixture] of [["small", smallWorkspaceV1], ["loose", looseWorkspaceV1], ["large", largeWorkspaceV1],
    ["damaged", damagedWorkspaceV1]] as const) {
    const result = observeRoundTrips(fixture());
    // `first` is the restore from workspace-1; each level is that state stored as workspace-2 and restored again.
    expect({ name, warning: result.warning, first: contentDigest(result.first), levels: result.levels.map(contentDigest) })
      .toEqual({ name, ...expected[name] });
  }
}, 60_000);

test("workspace-2 stores editor memory per feature and restores the live workspace losslessly", () => {
  const state = restore(smallWorkspaceV1()).state;
  const stored = serializeWorkspace(state, STUDIO_DOCUMENTS);
  expect(stored.schema).toBe("xfs/workspace-2");
  // With a collection, the selected look restores the editor: no loose copy is stored.
  expect(stored).not.toHaveProperty("look");
  expect(stored).not.toHaveProperty("recipe");
  expect(stored).not.toHaveProperty("glitterChoices");
  // The Glitter and Colour-shift memory is eye makeup's feature memory, verbatim (keys of presets not loaded included).
  expect((stored.features[EYE] as { choices: object }).choices).toEqual(state.glitterChoices);
  expect(Object.keys(state.glitterChoices)).toContain(`${fixedId(99)}/gone`);
  const collections = stored.collections!;
  expect(collections.collection.schema).toBe(COLLECTION_2);
  const p1 = collections.memory[fixedId(1)][EYE] as { editor: unknown; partSchema: string; history: unknown[]; historyTrimmed?: true };
  // History is written in the oldest part schema that holds every entry (CORE-27): part-1 recipe files here.
  expect(p1).toMatchObject({ editor: { active: 1, selected: 2, fieldSelection: { "a-shift": "a-shift-w2" } },
    partSchema: "xfs/eye-makeup-part-1", historyTrimmed: true });
  expect(p1.history).toHaveLength(3);
  for (const entry of p1.history) expect((entry as { schema?: string }).schema).toMatch(/^xfs\/recipe-(?:[7-9]|1[01])$/);
  expect(collections.removed[0].memory[EYE]).toMatchObject({ historyTrimmed: true });
  // Lossless: the stored form restores the same live state, field for field (Undo histories by the recipes they restore).
  expect(historiesAsRecipes(parseWorkspace(JSON.parse(JSON.stringify(stored)), STUDIO_DOCUMENTS))).toEqual(historiesAsRecipes(state));
  const loose = restore(looseWorkspaceV1()).state, looseStored = serializeWorkspace(loose, STUDIO_DOCUMENTS);
  expect(looseStored.look?.parts[EYE].schema).toBe("xfs/eye-makeup-part-1");
  expect(looseStored.look?.memory[EYE]).toMatchObject({ historyTrimmed: true, editor: { active: 2, selected: 3 } });
  expect(historiesAsRecipes(parseWorkspace(storedWorkspace(loose), STUDIO_DOCUMENTS))).toEqual(historiesAsRecipes(loose));
});

test("parts and memory of features this build does not register are carried unchanged", () => {
  const future = { schema: "xfs/hair-part-3", body: { strands: [1, 2, 3], nested: { z: 1, a: 2 } } };
  const state = restore(smallWorkspaceV1()).state;
  const stored = storedWorkspace(state);
  stored.collections.collection.presets[0].parts.hair = future;
  stored.collections.memory[fixedId(1)].hair = { editor: { brush: 4 }, partSchema: "xfs/hair-part-3", history: [{ strands: [] }] };
  stored.features.hair = { palette: ["#123456"] };
  const restored = parseWorkspace(stored, STUDIO_DOCUMENTS);
  expect(restored.collections!.collection.presets[0].parts.hair).toEqual(future);
  const again = storedWorkspace(restored);
  expect(again.collections.collection.presets[0].parts.hair).toEqual(future);
  expect(again.collections.memory[fixedId(1)].hair).toEqual(stored.collections.memory[fixedId(1)].hair);
  expect(again.features.hair).toEqual({ palette: ["#123456"] });
  // A loose look carries them too.
  const loose = storedWorkspace(restore(looseWorkspaceV1()).state);
  loose.look.parts.hair = future; loose.features.hair = { palette: [] };
  expect(storedWorkspace(parseWorkspace(loose, STUDIO_DOCUMENTS)).look.parts.hair).toEqual(future);
  // A collection file keeps them through import, the library and export.
  const file = { ...STUDIO_PARTS.write(STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[1]))) };
  file.presets[0].parts.hair = future;
  const read = STUDIO_PARTS.readCollection(JSON.parse(JSON.stringify(file)));
  expect(read.presets[0].parts.hair).toEqual(future);
  // The legacy format cannot hold it, so the collection stays version 2; the other looks alone would be version 1.
  expect(STUDIO_PARTS.writeMinimal(read).schema).toBe(COLLECTION_2);
  expect(STUDIO_PARTS.legacyPreset(read.presets[0])).toBeUndefined();
  expect(STUDIO_PARTS.legacyPreset(read.presets[1])).toMatchObject({ recipe: recipeOf(read.presets[1]) });
  // The eye-makeup package pipeline sees only eye-makeup parts.
  expect(eyeMakeupCollection(read).presets).toHaveLength(read.presets.length);
});

test("a workspace from a newer build stays protected; a newer look in a collection draft opens locked (step 5)", () => {
  const state = storedWorkspace(restore(smallWorkspaceV1()).state);
  const load = (value: unknown) => loadWorkspace({ getItem: key => key === "xfas.workspace.v1" ? JSON.stringify(value) : null }, false, STUDIO_DOCUMENTS);
  expect(load({ ...state, schema: "xfs/workspace-3" }).writable).toBe(false);
  const newerLook = load({ ...state, collections: { ...state.collections, collection: { ...state.collections.collection,
    presets: [{ ...state.collections.collection.presets[0], parts: { [EYE]: { schema: "xfs/eye-makeup-part-9", body: {} } } }] } } });
  expect(newerLook.writable).toBe(true);
  expect(newerLook.state.collections!.collection.presets[0].locked).toBe(NEWER_LOOK_MESSAGE);
  expect(() => STUDIO_PARTS.readPart(EYE, { schema: "xfs/eye-makeup-part-9", body: {} }))
    .toThrow("saved by a newer version of XF Studio (xfs/eye-makeup-part-9)");
});

// ---- Parity gate 1: every fixture schema through the old and the new path ----

test("every recipe schema reads to the same recipe and byte-identical masks at 512, 1K and 2K through a look", () => {
  const fixtures = recipeSchemaFixtures();
  expect(fixtures.map(([schema, recipe]) => [schema, (recipe as { schema: string }).schema]))
    .toEqual(fixtures.map(([schema]) => [schema, schema]));
  for (const [schema, file] of fixtures) {
    const old = parseRecipe(JSON.parse(JSON.stringify(file)));
    // New path: the bare file is lifted into a look, written as collection-2 and read back.
    const lifted = STUDIO_PARTS.feature(EYE)!.part.lift!(JSON.parse(JSON.stringify(file))) as Recipe;
    const look = { id: fixedId(1), name: schema, revision: 1, parts: { [EYE]: STUDIO_PARTS.envelope(EYE, lifted) } };
    const stored = JSON.parse(JSON.stringify(STUDIO_PARTS.write({ schema: COLLECTION_2, id: fixedId(2), name: "Parity", presets: [look] })));
    const recipe = recipeOf(STUDIO_PARTS.readCollection(stored).presets[0]);
    expect(recipe).toEqual(old);
    for (const size of [512, 1024, 2048]) for (const [i, layer] of old.layers.entries())
      expect(Buffer.from(raster(recipe.layers[i], size)).equals(Buffer.from(raster(layer, size))), `${schema} layer ${i} @${size}`).toBe(true);
  }
}, 120_000);

test("every collection fixture reads, plans and compiles identically through collection-1 and collection-2", () => {
  const plans = golden("collection-plans.json").fixtures, content = golden("part-2-parity.json").collections;
  for (const path of COLLECTION_FIXTURES) {
    const file = readFixture(path), old = parseCollection(file);
    const looks = STUDIO_PARTS.readCollection(file);
    const minimal = JSON.parse(JSON.stringify(STUDIO_PARTS.writeMinimal(looks)));
    const v2 = JSON.parse(JSON.stringify(STUDIO_PARTS.write(looks)));
    // Eye-makeup looks are written as collection-1, which 0.1.0-alpha.1 reads.
    expect(minimal.schema).toBe(COLLECTION_1);
    expect(v2.schema).toBe(COLLECTION_2);
    // The pre-migration results, captured from the step-1 code: collection-1 input is unchanged.
    expect({ path, parsed: digest(parseCollection(file)), plan: digest(planCollection(file)),
      packaged: digest(preparePackageCollection(file)) }).toEqual({ path, ...plans[path] });
    const diagnostic = "diagnostics" in file;
    // Through a look, each recipe is written in the oldest schema that holds it (part-2 keeps no pinned
    // schema): the same recipes apart from that tag, the same plan identities, the same packaged content.
    for (const [route, value] of [["minimal", minimal], ["collection-2", v2]] as const) {
      const read = parseCollection(value);
      expect(withoutRecipeSchemas(read.presets.map(preset => preset.recipe)), `${path} via ${route}`)
        .toEqual(withoutRecipeSchemas(old.presets.map(preset => preset.recipe)));
      for (const preset of read.presets) expect(preset.recipe.schema).toBe(recipeFile(preset.recipe)!.schema);
      expect(contentDigest(read)).toBe(content[path][route].parsed);
      // Diagnostic export knobs exist only in prepared experiment files (collection-1); a look collection has none.
      if (!diagnostic) {
        const plan = planCollection(value);
        expect(contentDigest(plan), `${path} plan via ${route}`).toBe(content[path][route].plan);
        expect(contentDigest(preparePackageCollection(value))).toBe(content[path][route].packaged);
        expect(packagePresetIdentities(plan)).toEqual(packagePresetIdentities(planCollection(file)));
      }
    }
    // Compiled maps of every exportable preset, and its masks at 512, match the old path byte for byte.
    const packaged = preparePackageCollection(file).packaged, again = preparePackageCollection(v2).packaged;
    for (const [i, preset] of packaged.presets.entries()) {
      const a = compilePreset(preset.recipe, 512), b = compilePreset(again.presets[i].recipe, 512);
      expect(a.route).toBe(b.route);
      for (const [name, map] of Object.entries(a.maps))
        expect(Buffer.from(map as Uint8Array).equals(Buffer.from((b.maps as Record<string, Uint8Array>)[name])), `${path} ${preset.name} ${name}`).toBe(true);
    }
    for (const [i, preset] of old.presets.entries()) for (const [j, layer] of preset.recipe.layers.entries())
      expect(Buffer.from(raster(recipeOf(looks.presets[i]).layers[j], 512)).equals(Buffer.from(raster(layer, 512)))).toBe(true);
  }
}, 120_000);

// ---- Parity gate 2: a SQLite library written before the look model ----

function legacyLibrary() {
  const rows = golden("library-v2-rows.json");
  const dir = mkdtempSync(join(tmpdir(), "xfs-library-v2-")), path = join(dir, "library.sqlite");
  const db = new Database(path, { create: true, strict: true });
  db.exec(`CREATE TABLE looks (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE look_revisions (look_id TEXT NOT NULL REFERENCES looks(id), revision INTEGER NOT NULL,
      name TEXT NOT NULL, recipe_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (look_id, revision));
    CREATE TABLE collections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE collection_revisions (collection_id TEXT NOT NULL REFERENCES collections(id), revision INTEGER NOT NULL,
      collection_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(collection_id, revision));
    CREATE TABLE collection_preset_versions (collection_id TEXT NOT NULL REFERENCES collections(id), preset_id TEXT NOT NULL,
      revision INTEGER NOT NULL, preset_json TEXT NOT NULL, PRIMARY KEY(collection_id, preset_id, revision));
    PRAGMA user_version=${rows.userVersion};`);
  for (const [table, list] of Object.entries(rows.rows) as [string, Record<string, unknown>[]][])
    for (const row of list) db.query(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`)
      .run(...Object.values(row) as never[]);
  db.close();
  const dump = () => { const raw = new Database(path, { readonly: true });
    const all = Object.fromEntries(Object.keys(rows.rows).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    raw.close(); return all as Record<string, Record<string, unknown>[]>; };
  return { rows, path, dump, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a pre-migration SQLite library lists and reads unchanged, and old rows are never rewritten", () => {
  const legacy = legacyLibrary();
  const library = new CollectionLibrary(legacy.path, STUDIO_PARTS);
  try {
    expect(library.list().map(({ updatedAt: _u, ...item }) => item)).toEqual(legacy.rows.list);
    // Every stored revision reads as looks whose eye-makeup view is the collection the old store returned.
    const revisions = legacy.rows.list.flatMap((item: { id: string; revision: number }) =>
      Array.from({ length: item.revision }, (_, i) => library.get(item.id, i + 1)));
    // The eye-makeup view writes each recipe in the oldest schema that holds it; apart from that tag
    // (a pinned schema is not kept since part-2), it is the collection the old store returned.
    expect(revisions.map(({ collection, revision }: { collection: LookCollection; revision: number }) =>
      canonicalJson(withoutRecipeSchemas({ collection: eyeMakeupCollection(collection), revision }))))
      .toEqual(legacy.rows.gets.map((stored: unknown) => canonicalJson(withoutRecipeSchemas(stored))));
    for (const { collection } of revisions as { collection: LookCollection }[])
      for (const preset of eyeMakeupCollection(collection).presets) expect(preset.recipe.schema).toBe(recipeFile(preset.recipe)!.schema);
    expect(legacy.dump()).toEqual(legacy.rows.rows);
  } finally { library.close(); legacy.cleanup(); }
});

test("saving an unchanged collection adds no preset revision; a change adds exactly one; old rows stay byte-unchanged", () => {
  const legacy = legacyLibrary();
  const library = new CollectionLibrary(legacy.path, STUDIO_PARTS);
  try {
    const editorId = legacy.rows.list[1].id, latest = library.get(editorId);
    const versions = () => legacy.dump().collection_preset_versions.length;
    const before = versions();
    // Unchanged presets whose rows were written in another key order and schema keep their revisions.
    const unchanged = library.save({ collection: latest.collection, revision: latest.revision });
    expect(unchanged.collection.presets.map(preset => preset.revision)).toEqual(latest.collection.presets.map(preset => preset.revision));
    expect(versions()).toBe(before);
    // The pre-migration store bumped every preset here (JSON key order after migration on read); canonical comparison does not.
    const edited = structuredClone(unchanged.collection);
    recipeOf(edited.presets[2]).layers[0].opacity = 0.25;
    const saved = library.save({ collection: edited, revision: unchanged.revision });
    expect(saved.collection.presets.map(preset => preset.revision))
      .toEqual(unchanged.collection.presets.map((preset, i) => preset.revision + (i === 2 ? 1 : 0)));
    const after = legacy.dump();
    expect(after.collection_preset_versions).toHaveLength(before + 1);
    // Old rows are untouched; new rows hold eye-makeup looks as collection-1, which 0.1.0-alpha.1 reads.
    for (const table of Object.keys(legacy.rows.rows))
      expect(after[table].slice(0, legacy.rows.rows[table].length)).toEqual(legacy.rows.rows[table]);
    const newest = after.collection_revisions.at(-1)!, preset = after.collection_preset_versions.at(-1)!;
    expect(JSON.parse(newest.collection_json as string).schema).toBe(COLLECTION_1);
    expect(JSON.parse(preset.preset_json as string)).toHaveProperty("recipe");
    expect(parseCollection(JSON.parse(newest.collection_json as string)).presets[2].recipe.layers[0].opacity).toBe(0.25);
    // Reopening compares canonically too.
    library.close();
    const reopened = new CollectionLibrary(legacy.path, STUDIO_PARTS);
    try {
      const again = reopened.save({ collection: reopened.get(editorId).collection, revision: saved.revision });
      expect(again.collection.presets.map(item => item.revision)).toEqual(saved.collection.presets.map(item => item.revision));
      expect(legacy.dump().collection_preset_versions).toHaveLength(before + 1);
    } finally { reopened.close(); }
  } finally { try { library.close(); } catch { /* already closed */ } legacy.cleanup(); }
});

test("a look the legacy format cannot hold is refused by the library, never written where 0.1.0-alpha.1 reads", () => {
  const legacy = legacyLibrary();
  const library = new CollectionLibrary(legacy.path, STUDIO_PARTS);
  try {
    const current = library.get(legacy.rows.list[2].id), edited = structuredClone(current.collection);
    edited.presets[0].parts.hair = { schema: "xfs/hair-part-3", body: { strands: 3 } };
    const before = legacy.dump();
    // The alpha lists a library only while every collection's latest row is collection-1 (CORE-30).
    expect(() => library.save({ collection: edited, revision: current.revision })).toThrow(COLLECTION_2_LIBRARY_MESSAGE);
    expect(legacy.dump()).toEqual(before);
    expect(library.list().find(item => item.id === current.collection.id)?.revision).toBe(current.revision);
    // The collection-2 writer still serves collection files (Export collection), which the alpha refuses cleanly.
    expect(STUDIO_PARTS.writeMinimal(edited).schema).toBe(COLLECTION_2);
  } finally { library.close(); legacy.cleanup(); }
});

test("draft persistence compares canonically: a library revision read from collection-1 rows is clean until edited", async () => {
  const legacy = legacyLibrary();
  const library = new CollectionLibrary(legacy.path, STUDIO_PARTS);
  try {
    const id = legacy.rows.list[1].id;
    const transport: CollectionTransport = { list: async () => library.list(), get: async key => library.get(key),
      save: async (collection, revision) => library.save({ collection, revision }), package: async () => { throw Error("unused"); } };
    const stored = library.get(id);
    let revision = 0;
    // The editor shows the selected (first) look, as a restored workspace does.
    let editor: EditorSnapshot = { recipe: structuredClone(recipeOf(stored.collection.presets[0])), ...emptyMemory() };
    const service = new CollectionService(STUDIO_DOCUMENTS, collectionDraft(stored.collection, STUDIO_DOCUMENTS, stored.revision), { selected: "", name: "" },
      () => editor, value => editor = value, transport, () => ({ recipe: editor.recipe, revision }));
    await service.execute({ kind: "initialize" });
    service.dispatch({ kind: "preset.select", id: service.summary().draft!.presets[1].id });
    service.dispatch({ kind: "preset.select", id: service.summary().draft!.presets[0].id });
    expect(service.persistence()).toMatchObject({ baseline: "known", dirty: false, dirtyPresets: [] });
    editor.recipe.layers[0].opacity = 0.123; revision++;
    expect(service.persistence()).toMatchObject({ dirty: true, dirtyPresets: [service.summary().draft!.presets[0].id] });
  } finally { library.close(); legacy.cleanup(); }
});

// ---- Portable files and the published alpha ----

test("export writes collection-1 for eye-makeup looks, and both collection schemas import", async () => {
  const file = readFixture(COLLECTION_FIXTURES[1]);
  let stored: { collection: LookCollection; revision: number } | undefined;
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("none"); },
    save: async (collection, revision) => (stored = { collection: structuredClone(collection), revision: (revision ?? 0) + 1 },
      { ...stored, updatedAt: "now" }), package: async () => { throw Error("unused"); } };
  let editor: EditorSnapshot = { recipe: parseRecipe(file.presets[0].recipe), ...emptyMemory() };
  const service = new CollectionService(STUDIO_DOCUMENTS, collectionDraft(file, STUDIO_DOCUMENTS), { selected: "", name: "" }, () => editor, value => editor = value, transport);
  await service.execute({ kind: "initialize" });
  const exported = await service.execute({ kind: "exportCollection" });
  const json = exported.ok && exported.result.kind === "export" ? JSON.parse(exported.result.json) : undefined;
  expect(json.schema).toBe(COLLECTION_1);
  expect(json.presets.map((preset: { recipe: unknown }) => preset.recipe)).toEqual(parseCollection(file).presets.map(preset => preset.recipe));
  // The alpha reads it: its reader is the collection-1 branch of parseCollection, unchanged.
  expect(parseCollection(json).presets).toHaveLength(file.presets.length);
  // A collection-2 file imports, and so does an old collection-1 export.
  const v2 = JSON.stringify(STUDIO_PARTS.write(STUDIO_PARTS.readCollection(file)));
  for (const text of [v2, JSON.stringify(file)]) {
    expect((await service.execute({ kind: "import", text, bytes: text.length })).ok).toBe(true);
    expect(service.summary().draft?.presets.map(preset => preset.layers)).toEqual(file.presets.map((preset: { recipe: { layers: unknown[] } }) => preset.recipe.layers.length));
  }
  expect(stored?.collection.schema).toBe(COLLECTION_2);
});

// ---- Eye makeup's pure capability and apply ----

test("the registry carries eye makeup's pure capability and apply for every one of its actions", () => {
  for (const kind of STUDIO_REGISTRY.kinds(EYE)) {
    const route = STUDIO_REGISTRY.route(kind);
    expect(route.ok && route.owner.owner).toBe("feature");
    const spec = (route as unknown as { spec: FeatureActionSpec<Recipe, unknown> }).spec;
    expect(typeof spec.capability).toBe("function");
    expect(typeof spec.apply).toBe("function");
  }
  for (const kind of [...STUDIO_REGISTRY.kinds("collection"), ...STUDIO_REGISTRY.kinds("history")])
    expect((STUDIO_REGISTRY.route(kind) as { spec: object }).spec).not.toHaveProperty("apply");
  expect(STUDIO_PARTS.features()).toEqual([EYE]);
  expect(LIVE_FEATURE as string).toBe(EYE); expect(EYE_MAKEUP_FEATURE as string).toBe(EYE);
});

test("apply is pure and matches the recipe service; the application dispatches through it", () => {
  const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
  const recipe = opticsRecipe("pure");
  const remembered: LayerChoices = { irregular: { model: "irregular-planar-1", count: 200000, radius: 0.00045, spread: 0.7, tilt: 0.35, seed: 5, color: "#d6b69e" } };
  const state: EyeMakeupState = deepFreeze({ part: parseRecipe(recipe), editor: { active: 2, selected: 1, fieldSelection: {},
    choices: { "pure-glit": remembered } } });
  const spec = (kind: string) => (STUDIO_REGISTRY.route(kind) as unknown as { spec: FeatureActionSpec<Recipe, EyeMakeupState["editor"]> }).spec;
  const actions = [
    { kind: "layer.setOpacity", layerId: "pure-gloss", opacity: 0.4 },
    { kind: "glitter.selectModel", layerId: "pure-glit", model: "irregular" },
    { kind: "layer.setFinish", layerId: "pure-shift", finish: "matte" },
    { kind: "layer.select", layerId: "pure-satin" },
    { kind: "layer.edit", command: { kind: "duplicate", id: "pure-gloss", newId: "pure-copy" } },
    { kind: "layer.setEnabled", id: "pure-satin", enabled: false },
  ] as const;
  for (const action of actions) {
    const result = spec(action.kind).apply(state, action as never);
    expect(result.changed).toBe(true);
    if (action.kind.startsWith("layer.edit") || action.kind === "layer.setEnabled") continue;
    // Same as the recipe service's own pure function, with the memory keyed by preset.
    const direct = applyRecipeAction({ recipe: state.part, active: 2, selected: 1, fieldSelection: {} }, action as never,
      { "p/pure-glit": remembered }, "p");
    expect(result.part).toEqual(direct.state.recipe);
    expect(result.editor.choices).toEqual(Object.fromEntries(Object.entries(direct.choices).map(([key, value]) => [key.slice(2), value])));
  }
  // The remembered irregular settings came back when the model was chosen again.
  const selected = spec("glitter.selectModel").apply(state, actions[1] as never);
  expect(selected.part.layers[2].flakes).toMatchObject({ seed: 5 });
  expect(spec("layer.setOpacity").capability(state, { kind: "layer.setOpacity", layerId: "gone", opacity: 1 } as never))
    .toMatchObject({ available: false, code: "missing_target" });

  // Through the application: the same result, one Undo step, the memory written back under the preset.
  const workspace = freshWorkspace(recipe);
  workspace.glitterChoices = { "preset-a/pure-glit": structuredClone(remembered) };
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "preset-a" }, STUDIO_COMPOSITION);
  expect(core.app.dispatch({ kind: "glitter.selectModel", layerId: "pure-glit", model: "irregular" }).ok).toBe(true);
  expect(core.document.recipe).toEqual(selected.part);
  expect(core.document.undoDepth).toBe(1);
  expect(workspace.glitterChoices["preset-a/pure-glit"].classic).toBeDefined();
  expect(core.app.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id: "pure-gloss" } }).ok).toBe(true);
  expect(core.document.recipe.layers).toHaveLength(5);
  expect(core.document.undoDepth).toBe(2);
});

// ---- Codec rules ----

test("the part registry reads identities without parts, refuses oversized parts and a second legacy claim", () => {
  const file = STUDIO_PARTS.write(STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[1])));
  const newer = { ...file, presets: [{ ...file.presets[0], parts: { [EYE]: { schema: "xfs/eye-makeup-part-9", body: {} } } }] };
  expect(STUDIO_PARTS.readIdentity(newer)).toEqual({ id: file.id, name: file.name, count: 1 });
  expect(() => STUDIO_PARTS.readCollection(newer)).toThrow("newer version");
  const eye = STUDIO_PARTS.feature(EYE)!;
  const tiny = new PartRegistry([{ ...eye, part: { ...eye.part, maxBytes: 100 } }]);
  expect(() => tiny.readCollection(file)).toThrow("limit for one part");
  expect(() => new PartRegistry([eye, { ...eye, id: "lips" as never }])).toThrow("both claim");
  expect(eye.part.lift!({ schema: "xfas/collection-1" })).toBeUndefined();
  expect(eye.part.lift!(recipe3("lift"))).toEqual(parseRecipe(recipe3("lift")));
  expect(eye.part.summary(initialRecipe())).toEqual({ layers: 4 });
});

test("workspace-1 collection drafts read through the generic reader match the workspace reader", () => {
  const v1 = smallWorkspaceV1().collections;
  const direct = readCollectionWorkspaceV1(v1, STUDIO_DOCUMENTS);
  expect(parseWorkspace(smallWorkspaceV1(), STUDIO_DOCUMENTS).collections).toEqual(direct);
  // In memory, a look's part is the parsed recipe of that preset; its memory is by feature.
  expect(recipeOf(direct.collection.presets[2])).toEqual(parseRecipe(recipe3("c")));
  expect(Object.keys(direct.memory[fixedId(3)])).toEqual([EYE]);
  expect(parseCollectionWorkspace(JSON.parse(JSON.stringify(direct)), STUDIO_DOCUMENTS)).toEqual(direct);
});

// ---- CORE-05: routine queries never copy the draft ----

test("target checks and context binding read the collection's identity without copying the draft (CORE-05)", async () => {
  const workspace = freshWorkspace();
  workspace.collections = collectionDraft(readFixture(COLLECTION_FIXTURES[1]), STUDIO_DOCUMENTS);
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "x" }, STUDIO_COMPOSITION);
  let editor: EditorSnapshot = { recipe: core.document.recipe, ...emptyMemory() };
  const service = new CollectionService(STUDIO_DOCUMENTS, workspace.collections, { selected: "", name: "" }, () => editor, value => editor = value,
    { list: async () => [], get: async () => { throw Error(); }, save: async () => { throw Error(); }, package: async () => { throw Error(); } });
  core.app.attach({ collection: service });
  let views = 0, snapshots = 0;
  const view = service.view.bind(service), snapshot = service.snapshot.bind(service);
  service.view = () => { views++; return view(); };
  service.snapshot = () => { snapshots++; return snapshot(); };
  const preset = service.summary().draft!.presets[1].id;
  expect(core.app.targetCapability({ kind: "preset", id: preset })).toEqual({ available: true });
  expect(core.app.targetCapability({ kind: "preset", id: "gone" })).toMatchObject({ code: "missing_target" });
  expect(core.app.targetCapability({ kind: "collection" })).toEqual({ available: true });
  const query = core.app.contextQuery({ kind: "preset", id: preset } as never);
  expect(query.context.collectionId).toBe(service.summary().draft!.id);
  expect(core.app.requestCapability({ kind: "exportCollection" })).toEqual({ available: true });
  expect(core.app.requestCapability({ kind: "package", action: "check" })).toEqual({ available: true });
  expect({ views, snapshots }).toEqual({ views: 0, snapshots: 0 });
  // An empty draft is still refused with the same message.
  service.dispatch({ kind: "preset.edit", command: { kind: "remove", id: service.summary().draft!.presets[0].id } });
  while (service.summary().draft!.presets.length)
    service.dispatch({ kind: "preset.edit", command: { kind: "remove", id: service.summary().draft!.presets[0].id } });
  expect(core.app.requestCapability({ kind: "exportCollection" })).toMatchObject({ available: false,
    reason: "Expected a named XF Studio collection with a stable UUID and at least one preset." });
});

test("the stored workspace grows only by the part envelopes", () => {
  const state = restore(largeWorkspaceV1()).state;
  const v2 = encodeWorkspaceAt(state, 0, STUDIO_DOCUMENTS).size;
  // Per look: one envelope and a partSchema per memory entry; a few hundred code units in total, against ~1.7M.
  expect(v2).toBeLessThan(2_000_000);
  expect(JSON.parse(encodeWorkspaceAt(state, 0, STUDIO_DOCUMENTS).encoded).schema).toBe("xfs/workspace-2");
});
