/**
 * Feature-module platform step 3 (CORE-09): `xfs/eye-makeup-part-2` with the per-layer model
 * registry. The in-memory recipe has no recipe-level schema; each layer's optical models are
 * validated by their own IDs; writers use the oldest recipe (and part) schema that holds the
 * content, so the published alpha keeps reading what this build writes.
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionLibrary } from "../src/collection-store";
import { EYE_MAKEUP_FEATURE, STUDIO_PARTS } from "../src/compose/studio-registry";
import { defaultClusteredGlintFlakes, defaultDirectGlintFlakes, defaultFineSpeckleFlakes } from "../src/direct-glint-settings";
import { EYE_MAKEUP, EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2, eyeMakeupPartCodec } from "../src/features/eye-makeup";
import { defaultFlakes } from "../src/finish";
import { defaultStudioIrregularFlakes } from "../src/flake-field";
import { selectGlitterModel } from "../src/glitter-model";
import { EYE_MAKEUP_LAYER_MODELS, LAYER_MODELS, LayerModelRegistry, RECIPE_FILE_SCHEMAS, schemaRank,
  type RecipeFileSchema } from "../src/layer-models";
import { canonicalJson, COLLECTION_1, COLLECTION_2, type LookCollection } from "../src/platform/api";
import { PartRegistry } from "../src/platform/core/document";
import { eyeMakeupCollection } from "../src/preset-collection";
import { initialRecipe, newLayerTemplate, parseRecipe, parseRecipeFile, parseRecipePart, RECIPE_FILE_MESSAGE,
  type Layer, type Recipe, type RecipeFile } from "../src/recipe";
import { applyRecipeAction, type RecipeAction } from "../src/recipe-actions";
import { portableRecipe, readPortableRecipe, recipeFile } from "../src/recipe-schema";
import { loadWorkspace } from "../src/workspace-state";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { recipeOf, storedWorkspace } from "./fixtures/looks";
import { glitterFixtures, part2Observation, recipeSchemaFixtures } from "./fixtures/part-2-parity";
import { restore } from "./fixtures/workspace-observable";
import { fixedId, opticsRecipe, smallWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";

const EYE = "eye-makeup";
const golden = JSON.parse(readFileSync(new URL("./golden/part-2-parity.json", import.meta.url), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// ---- Parity: what the step-2 code rendered, read and restored ----

test("every recipe schema, Glitter fixture, collection and workspace renders and reads as the step-2 code did", () => {
  const { capturedFrom: _from, ...expected } = golden;
  const observed = part2Observation();
  // Separately first, for a readable failure.
  for (const key of Object.keys(expected.recipes)) expect(observed.recipes[key], `recipe ${key}`).toEqual(expected.recipes[key]);
  for (const key of Object.keys(expected.glitter)) expect(observed.glitter[key], `Glitter ${key}`).toEqual(expected.glitter[key]);
  for (const key of Object.keys(expected.collections)) expect(observed.collections[key], key).toEqual(expected.collections[key]);
  expect(observed).toEqual(expected);
}, 120_000);

test("the Glitter fixtures cover every model beside a Glossy layer and actually change the recipe", () => {
  const steps = golden.glitter as Record<string, { action: string; changed?: boolean }[]>;
  expect(Object.values(steps).flat().filter(step => step.changed === false)).toEqual([]);
  const models = new Set(glitterFixtures().flatMap(fixture => fixture.actions)
    .flatMap(action => action.kind === "glitter.selectModel" ? [action.model] : []));
  expect([...models].sort()).toEqual(["classic", "clustered", "direct", "fine", "irregular"]);
});

// ---- Recipe files read exactly as before: the per-schema gates come from the model registry ----

/** The model gate recipe files had before part-2, verbatim from the step-2 `parseRecipe`. */
function oldGate(schema: string, finish: Layer["finish"], flakes: unknown, optics: unknown): boolean {
  const f = flakes as Record<string, unknown> | undefined, num = (x: unknown, a: number, b: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= a && x <= b;
  if (f !== undefined) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return false;
    if ("model" in f) {
      const irregular = ["xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"].includes(schema) &&
        f.model === "irregular-planar-1";
      const direct = ["xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"].includes(schema) &&
        // isDirectGlint: one of the three direct models, with valid settings (the fixtures' are).
        ["uv-cell-direct-1", "uv-cell-direct-2", "uv-cell-direct-3"].includes(f.model as string) && (f.model === "uv-cell-direct-1" ||
        (f.model === "uv-cell-direct-2" && schema !== "xfs/recipe-8") || schema === "xfs/recipe-10" || schema === "xfs/recipe-11");
      if (finish !== "glitter" || !(irregular || direct)) return false;
    } else if (!Number.isInteger(f.cells) || !num(f.cells, 32, 256) || !num(f.density, 0, 1) || !num(f.tilt, 0, 1) ||
      !Number.isInteger(f.seed) || !num(f.seed, 0, 2147483647)) return false;
  }
  if (optics !== undefined) {
    const o = optics as { model?: unknown; shift?: unknown };
    if (schema !== "xfs/recipe-11" || !o || typeof o !== "object" || o.model !== "game-matched-1" ||
      !["glossy", "shimmer", "iridescent"].includes(finish)) return false;
    if ((finish === "iridescent") !== ("shift" in o)) return false;
  }
  return true;
}

test("every recipe schema holds exactly the layer models it always held, with the same messages", () => {
  const base = newLayerTemplate();
  const flakes: [string, unknown][] = [["none", undefined], ["classic", defaultFlakes()], ["classic-invalid", { ...defaultFlakes(), cells: 8 }],
    ["irregular", defaultStudioIrregularFlakes()], ["direct", defaultDirectGlintFlakes()], ["clustered", defaultClusteredGlintFlakes()],
    ["fine", defaultFineSpeckleFlakes()], ["unknown", { ...defaultDirectGlintFlakes(), model: "uv-cell-direct-9" }], ["array", []]];
  const optics: [string, unknown][] = [["none", undefined], ["game", { model: "game-matched-1" }],
    ["game-shift", { model: "game-matched-1", shift: { color: "#12ab34", strength: 0.5 } }], ["unknown", { model: "game-matched-9" }]];
  let checked = 0;
  for (const schema of RECIPE_FILE_SCHEMAS) for (const finish of ["matte", "glitter", "glossy", "iridescent"] as const)
    for (const [fname, f] of flakes) for (const [oname, o] of optics) {
      // Older schemas stored older layer forms; the model gate is independent of them, so use each schema's own form.
      const layer: Record<string, unknown> = { ...base, id: "l", finish, ...(f === undefined ? {} : { flakes: f }), ...(o === undefined ? {} : { optics: o }) };
      if (schemaRank(schema) < schemaRank("xfs/recipe-6")) { delete layer.softness; layer.points = base.points.map(({ feather: _f, handles: _h, ...p }) => p); layer.pathMode = "catmull-rom"; }
      if (schemaRank(schema) < schemaRank("xfs/recipe-5")) delete layer.pathMode;
      if (schemaRank(schema) < schemaRank("xfs/recipe-4")) delete layer.strength;
      if (schemaRank(schema) < schemaRank("xfs/recipe-3")) { delete layer.fields; layer.field = { u: 0.34, v: 0.22, du: 0, dv: 0, radius: 0.07 }; }
      const layers = schema === "eye-artistry/recipe-1" ? [0, 1, 2, 3].map(i => ({ ...layer, id: `l${i}` })) : [layer];
      const file = { schema, uv: "gltf-uv0-top-left", layers };
      const expected = oldGate(schema, finish, f, o);
      let message: string | undefined;
      try { parseRecipeFile(file); } catch (error) { message = (error as Error).message; }
      expect({ schema, finish, fname, oname, ok: message === undefined, message }).toEqual({ schema, finish, fname, oname, ok: expected, message });
      if (message) expect(["Invalid flake settings.", "Invalid experimental Glitter settings.", "Invalid game-matched finish settings."])
        .toContain(message);
      if (message && f && !Array.isArray(f) && typeof f === "object" && !("model" in f))
        expect(message === "Invalid flake settings." || message === "Invalid game-matched finish settings.").toBe(true);
      checked++;
    }
  expect(checked).toBe(RECIPE_FILE_SCHEMAS.length * 4 * flakes.length * optics.length);
});

test("a recipe file keeps its migrated schema, and the in-memory recipe is the same without it", () => {
  for (const [schema, file] of recipeSchemaFixtures()) {
    const read = parseRecipeFile(clone(file)), recipe = parseRecipe(clone(file)) as Recipe;
    const { schema: kept, ...rest } = read;
    expect(kept as string).toBe(schemaRank(schema as RecipeFileSchema) >= schemaRank("xfs/recipe-8") ? schema : "xfs/recipe-7");
    expect(recipe).toEqual(rest);
    expect(recipe).not.toHaveProperty("schema");
    // A part-2 body reads back as itself; files and bodies are told apart by the schema key alone.
    expect(parseRecipePart(clone(recipe))).toEqual(recipe);
    expect(() => parseRecipePart(clone(file))).toThrow(RECIPE_FILE_MESSAGE);
    expect(() => parseRecipeFile(clone(recipe))).toThrow(RECIPE_FILE_MESSAGE);
  }
});

// ---- Round trips through part-2 and back ----

test("part-1 reads into part-2 and downgrades to the oldest recipe schema that holds it; part-2 round-trips exactly", () => {
  const part = STUDIO_PARTS.feature(EYE)!.part;
  expect(part.current).toBe(EYE_MAKEUP_PART_2);
  expect(part.accepts).toEqual([EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2]);
  for (const [schema, file] of recipeSchemaFixtures()) {
    const stored = parseRecipeFile(clone(file));
    const recipe = part.parse({ schema: EYE_MAKEUP_PART_1, body: clone(stored) }) as Recipe;
    const down = part.downgrade!(recipe, EYE_MAKEUP_PART_1)!;
    // Content is identical; only a pinned schema tag moves down to the oldest that holds the layers.
    const minimal = LAYER_MODELS.minimalSchema(recipe.layers)!;
    expect(down).toEqual({ schema: EYE_MAKEUP_PART_1, body: { ...stored, schema: minimal } });
    expect(schemaRank(minimal)).toBeLessThanOrEqual(schemaRank(stored.schema));
    if (stored.schema === minimal) expect(canonicalJson(down.body)).toBe(canonicalJson(stored));
    // Part-2 → part-1 → part-2, and part-2 → stored → part-2, are exact.
    expect(part.parse(clone(down))).toEqual(recipe);
    const envelope = part.serialize(recipe);
    expect(envelope.schema).toBe(EYE_MAKEUP_PART_2);
    expect(part.parse(clone(envelope))).toEqual(recipe);
    expect(STUDIO_PARTS.readPart(EYE, clone(envelope))).toEqual(envelope);
    expect(part.downgrade!(recipe, EYE_MAKEUP_PART_2)).toEqual(envelope);
    expect(part.downgrade!(recipe, "xfs/eye-makeup-part-0")).toBeUndefined();
    expect(schema).toBeTruthy();
  }
});

test("a pinned recipe-11 row and its part-2 form compare equal, so no preset gets a new revision", () => {
  // Board 5 of the finish board: stored as recipe-11, holding only what recipe-7 holds.
  const pinned = readFixture("016-finish-board/finish-board.collection.json").presets[4].recipe;
  expect(pinned.schema).toBe("xfs/recipe-11");
  expect(recipeFile(parseRecipe(pinned))!.schema).toBe("xfs/recipe-7");
  const v1 = STUDIO_PARTS.canonicalParts({ [EYE]: { schema: EYE_MAKEUP_PART_1, body: pinned } });
  const v2 = STUDIO_PARTS.canonicalParts({ [EYE]: STUDIO_PARTS.envelope(EYE, parseRecipe(pinned)) });
  expect(v1).toBe(v2);
});

test("saving a library whose rows hold pinned part-1 recipes adds no revision; an edit adds one, written minimally", () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-part-2-library-")), path = join(dir, "library.sqlite");
  new Database(path, { create: true }).exec(`CREATE TABLE looks (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE look_revisions (look_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, recipe_json TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (look_id, revision)); PRAGMA user_version=1;`);
  let library = new CollectionLibrary(path), raw: Database | undefined;
  try {
    // Rows as the step-2 build wrote them: collection-1 with a pinned recipe-11, and collection-2 with a part-1 body.
    const file = readFixture("016-finish-board/finish-board.collection.json");
    const hair = { schema: "xfs/hair-part-3", body: { strands: 3 } };
    const v2 = { schema: COLLECTION_2, id: fixedId(700), name: "Mixed", presets: file.presets.slice(0, 3).map((preset: { id: string; name: string; revision: number; recipe: unknown }, i: number) =>
      ({ id: preset.id, name: preset.name, revision: preset.revision, parts: { [EYE]: { schema: EYE_MAKEUP_PART_1, body: preset.recipe }, ...(i === 0 ? { hair } : {}) } })) };
    library.close();
    raw = new Database(path);
    const now = new Date().toISOString();
    for (const collection of [file, v2]) {
      raw.query("INSERT INTO collections VALUES (?, ?)").run(collection.id, now);
      raw.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(collection.id, JSON.stringify(collection), now);
      for (const preset of collection.presets) raw.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)")
        .run(collection.id, preset.id, preset.revision, JSON.stringify(preset));
    }
    const count = () => (raw!.query("SELECT COUNT(*) AS n FROM collection_preset_versions").get() as { n: number }).n;
    const rowsBefore = raw.query("SELECT * FROM collection_preset_versions ORDER BY rowid").all();
    const before = count();
    library = new CollectionLibrary(path);
    for (const id of [file.id, v2.id]) {
      const current = library.get(id);
      const saved = library.save({ collection: current.collection, revision: current.revision });
      expect(saved.collection.presets.map(p => p.revision)).toEqual(current.collection.presets.map(p => p.revision));
    }
    expect(count()).toBe(before);
    // An edit adds exactly one version, in the oldest schema that holds it.
    const current = library.get(v2.id), edited = structuredClone(current.collection);
    recipeOf(edited.presets[0]).layers[0].opacity = 0.25;
    library.save({ collection: edited, revision: current.revision });
    expect(count()).toBe(before + 1);
    const row = JSON.parse((raw.query("SELECT preset_json FROM collection_preset_versions ORDER BY rowid DESC LIMIT 1").get() as { preset_json: string }).preset_json);
    expect(row.parts.hair).toEqual(hair);
    expect(row.parts[EYE].schema).toBe(EYE_MAKEUP_PART_1);
    expect(row.parts[EYE].body.schema).toBe(recipeFile(recipeOf(edited.presets[0]))!.schema);
    const collectionRow = JSON.parse((raw.query("SELECT collection_json FROM collection_revisions WHERE collection_id=? ORDER BY revision DESC LIMIT 1")
      .get(v2.id) as { collection_json: string }).collection_json);
    expect(collectionRow.schema).toBe(COLLECTION_2);
    expect(Object.values(collectionRow.presets).every((p: any) => p.parts[EYE].schema === EYE_MAKEUP_PART_1)).toBe(true);
    // Old rows are never rewritten.
    expect(raw.query("SELECT * FROM collection_preset_versions ORDER BY rowid").all().slice(0, rowsBefore.length)).toEqual(rowsBefore);
  } finally { library.close(); raw?.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing on Windows. */ } }
});

// ---- Writers: the oldest schema that holds the content ----

/** A registry with one more Glitter model that no recipe schema holds, and eye makeup's codecs over it. */
function withPartTwoOnlyModel() {
  const models = new LayerModelRegistry([...EYE_MAKEUP_LAYER_MODELS,
    { slot: "flakes", id: "uv-cell-direct-4", valid: (value: unknown, finish) => finish === "glitter" &&
      !!value && typeof value === "object" && (value as { model?: unknown }).model === "uv-cell-direct-4" }]);
  const part = eyeMakeupPartCodec(models);
  const parts = new PartRegistry([{ ...EYE_MAKEUP, part }]);
  const recipe = initialRecipe();
  recipe.layers[1] = { ...recipe.layers[1], finish: "glitter", flakes: { model: "uv-cell-direct-4" } as never };
  return { models, part, parts, recipe: parseRecipe(recipe, models) };
}

test("the minimal writers keep collection-1 whenever every look is eye makeup a recipe schema holds", () => {
  for (const path of COLLECTION_FIXTURES) {
    const looks = STUDIO_PARTS.readCollection(readFixture(path));
    const minimal = STUDIO_PARTS.writeMinimal(looks) as unknown as { schema: string; presets: { recipe: RecipeFile }[] };
    expect(minimal.schema).toBe(COLLECTION_1);
    for (const preset of minimal.presets) expect(preset.recipe.schema).toBe(LAYER_MODELS.minimalSchema(preset.recipe.layers)!);
    // What 0.1.0-alpha.1 reads: its collection-1 reader is the unchanged branch of parseCollection.
    expect(eyeMakeupCollection(STUDIO_PARTS.readCollection(clone(minimal))).presets.map(p => p.recipe))
      .toEqual(minimal.presets.map(p => p.recipe));
  }
  // A look with another feature's part: collection-2, and eye makeup's part is still part-1 there.
  const looks = STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[1]));
  looks.presets[0].parts.hair = { schema: "xfs/hair-part-3", body: {} };
  const mixed = STUDIO_PARTS.writeMinimal(looks) as LookCollection;
  expect(mixed.schema).toBe(COLLECTION_2);
  expect(mixed.presets.map(p => p.parts[EYE].schema)).toEqual(looks.presets.map(() => EYE_MAKEUP_PART_1));
  expect(mixed.presets[0].parts.hair).toEqual({ schema: "xfs/hair-part-3", body: {} });
  expect(STUDIO_PARTS.readCollection(clone(mixed))).toEqual(looks);
});

test("a layer model no recipe schema holds is written as part-2 in collection-2, and read back exactly", () => {
  const { models, part, parts, recipe } = withPartTwoOnlyModel();
  expect(models.minimalSchema(recipe.layers)).toBeUndefined();
  expect(part.downgrade!(recipe, EYE_MAKEUP_PART_1)).toBeUndefined();
  // The build's own registry refuses it, naming a newer version.
  expect(() => parseRecipe(recipe)).toThrow("newer version of XF Studio (uv-cell-direct-4)");
  const plain = { id: fixedId(2), name: "Plain", revision: 1, parts: { [EYE]: part.serialize(parseRecipe(initialRecipe(), models)) } };
  const newer = { id: fixedId(1), name: "Newer", revision: 1, parts: { [EYE]: part.serialize(recipe) } };
  const collection: LookCollection = { schema: COLLECTION_2, id: fixedId(3), name: "Models", presets: [newer, plain] };
  const written = parts.writeMinimal(collection) as LookCollection;
  expect(written.schema).toBe(COLLECTION_2);
  expect(written.presets.map(p => p.parts[EYE].schema)).toEqual([EYE_MAKEUP_PART_2, EYE_MAKEUP_PART_1]);
  expect(parts.readCollection(clone(written))).toEqual(collection);
  expect(parts.writePresetMinimal(plain)).toHaveProperty("recipe");
  expect(parts.writePresetMinimal(newer)).toEqual(newer);
  // Without it the same collection is collection-1.
  expect(parts.writeMinimal({ ...collection, presets: [plain] }).schema).toBe(COLLECTION_1);
  // "Export recipe" writes the part itself, and "Import recipe" reads it back.
  const exported = portableRecipe(recipe, models);
  expect(exported).toEqual({ schema: EYE_MAKEUP_PART_2, body: recipe });
  expect(readPortableRecipe(clone(exported), models)).toEqual(recipe);
  expect(part.lift!(clone(exported))).toEqual(recipe);
});

test("Export recipe writes the oldest recipe schema that holds the recipe", () => {
  const cases: [string, (recipe: Recipe) => void, string][] = [
    ["matte", () => {}, "xfs/recipe-7"],
    ["classic Glitter", r => { r.layers[0].finish = "glitter"; r.layers[0].flakes = defaultFlakes(); }, "xfs/recipe-7"],
    ["irregular", r => { r.layers[0].finish = "glitter"; r.layers[0].flakes = defaultStudioIrregularFlakes(); }, "xfs/recipe-7"],
    ["direct", r => { r.layers[0].finish = "glitter"; r.layers[0].flakes = defaultDirectGlintFlakes(); }, "xfs/recipe-8"],
    ["clustered", r => { r.layers[0].finish = "glitter"; r.layers[0].flakes = defaultClusteredGlintFlakes(); }, "xfs/recipe-9"],
    ["fine", r => { r.layers[0].finish = "glitter"; r.layers[0].flakes = defaultFineSpeckleFlakes(); }, "xfs/recipe-10"],
    ["game-matched Glossy", r => { r.layers[2].finish = "glossy"; r.layers[2].optics = { model: "game-matched-1" }; }, "xfs/recipe-11"],
  ];
  for (const [name, change, schema] of cases) {
    const recipe = initialRecipe(); change(recipe);
    const exported = portableRecipe(parseRecipe(recipe));
    expect({ name, schema: exported.schema as string }).toEqual({ name, schema });
    // The file reads back to the same recipe, here and (by its schema gate) in older builds.
    expect(readPortableRecipe(clone(exported))).toEqual(parseRecipe(recipe));
    expect(parseRecipeFile(clone(exported))).toEqual(exported as RecipeFile);
  }
  // A recipe stored pinned at recipe-11 exports as recipe-7 when nothing in it needs more.
  const pinned = readFixture("016-finish-board/finish-board.collection.json").presets[4].recipe;
  expect(portableRecipe(parseRecipe(pinned)).schema).toBe("xfs/recipe-7");
  expect(readPortableRecipe({ schema: "xfas/collection-1" })).toBeUndefined();
  expect(readPortableRecipe(initialRecipe())).toBeUndefined();
});

// ---- Actions never touch a schema ----

test("selecting Glitter models and every recipe action leave the recipe without a schema", () => {
  const choices = {};
  let recipe = parseRecipe(opticsRecipe("s"));
  for (const model of ["direct", "clustered", "fine", "irregular", "classic"] as const) {
    recipe = selectGlitterModel(recipe, "s-glit", model, choices);
    expect(recipe).not.toHaveProperty("schema");
    expect(recipe.layers[0].optics).toEqual({ model: "game-matched-1" });
  }
  for (const { file, actions } of glitterFixtures()) {
    let state = { recipe: parseRecipe(clone(file)), active: 0, selected: 0, fieldSelection: {} };
    for (const action of actions as RecipeAction[]) {
      state = applyRecipeAction(state, action, {}, "p").state;
      expect(state.recipe).not.toHaveProperty("schema");
      expect(parseRecipePart(clone(state.recipe))).toEqual(state.recipe);
    }
  }
});

// ---- A newer part schema or layer model stays refused (decision recorded in the design) ----

test("a newer eye-makeup part schema or unknown layer model is refused on read and the workspace stays protected", () => {
  const unknownModel = parseRecipe(initialRecipe()) as unknown as { layers: Record<string, unknown>[] };
  unknownModel.layers[0] = { ...unknownModel.layers[0], finish: "glitter", flakes: { model: "uv-cell-direct-9" } };
  const envelopes = [{ schema: "xfs/eye-makeup-part-3", body: parseRecipe(initialRecipe()) },
    { schema: EYE_MAKEUP_PART_2, body: unknownModel }];
  expect(() => STUDIO_PARTS.readPart(EYE, envelopes[0])).toThrow("saved by a newer version of XF Studio (xfs/eye-makeup-part-3)");
  expect(() => STUDIO_PARTS.readPart(EYE, envelopes[1])).toThrow("newer version of XF Studio (uv-cell-direct-9)");
  const state = storedWorkspace(restore(smallWorkspaceV1()).state);
  for (const envelope of envelopes) {
    const value = clone(state);
    value.collections.collection.presets[0].parts[EYE] = envelope;
    const loaded = loadWorkspace({ getItem: key => key === "xfas.workspace.v1" ? JSON.stringify(value) : null }, false);
    expect(loaded.writable).toBe(false);
  }
  // A library still lists such a collection by identity.
  const file = STUDIO_PARTS.write(STUDIO_PARTS.readCollection(readFixture(COLLECTION_FIXTURES[1])));
  expect(STUDIO_PARTS.readIdentity({ ...file, presets: [{ ...file.presets[0], parts: { [EYE]: envelopes[1] } }] }).count).toBe(1);
});

// ---- The registry ----

test("each layer model is registered once with the oldest recipe schema that holds it", () => {
  const registered = EYE_MAKEUP_LAYER_MODELS.map(model => [model.slot, model.id ?? "(classic)", model.recipeSchema]);
  expect(registered).toEqual([["flakes", "(classic)", "eye-artistry/recipe-1"], ["flakes", "irregular-planar-1", "xfs/recipe-7"],
    ["flakes", "uv-cell-direct-1", "xfs/recipe-8"], ["flakes", "uv-cell-direct-2", "xfs/recipe-9"],
    ["flakes", "uv-cell-direct-3", "xfs/recipe-10"], ["optics", "game-matched-1", "xfs/recipe-11"]]);
  expect(() => new LayerModelRegistry([...EYE_MAKEUP_LAYER_MODELS, EYE_MAKEUP_LAYER_MODELS[2]])).toThrow("registered twice");
  expect(() => new LayerModelRegistry([{ slot: "optics", valid: () => true }])).toThrow("Only classic flakes");
  // A named "classic" or empty model is never the classic model.
  expect(LAYER_MODELS.of("flakes", { ...defaultFlakes(), model: "" })).toBeUndefined();
  expect(LAYER_MODELS.of("flakes", defaultFlakes())?.id).toBeUndefined();
  // One layer's model decides only its own schema; the recipe takes the newest any layer needs.
  const layers = parseRecipe(opticsRecipe("m")).layers;
  expect(layers.map(layer => LAYER_MODELS.layerSchema(layer))).toEqual(["xfs/recipe-11", "xfs/recipe-11", "xfs/recipe-7", "xfs/recipe-7"]);
  expect(LAYER_MODELS.minimalSchema(layers.slice(2))).toBe("xfs/recipe-7");
  expect(LAYER_MODELS.minimalSchema([])).toBe("xfs/recipe-7");
});

test("the look-model package view is recipe files, whichever collection schema it came from", () => {
  const file = readFixture(COLLECTION_FIXTURES[2]);
  const view = eyeMakeupCollection(STUDIO_PARTS.readCollection(file));
  expect(view.presets.every(p => p.recipe.schema === LAYER_MODELS.minimalSchema(p.recipe.layers))).toBe(true);
  expect(EYE_MAKEUP_FEATURE as string).toBe(EYE);
});
