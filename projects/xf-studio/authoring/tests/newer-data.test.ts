/**
 * CORE-27 and step 5: data from a newer XF Studio (a part schema or layer model this build does not
 * know) is never dropped as damage. In a collection draft (the current draft, recovery drafts, removed
 * presets, Undo histories) it locks only the look holding it, which is kept verbatim and written back
 * exactly while the rest stays editable; anywhere else (the loose editor, a newer workspace) the
 * workspace opens read-only and is never written back. Undo histories are written in the oldest part
 * schema that holds them, so older builds read them.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DesktopWorkspaceStore, desktopWorkspaceStartFresh } from "../desktop/workspace-store";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { EYE_MAKEUP, eyeMakeupPartCodec } from "../src/features/eye-makeup";
import { isNewerData, NEWER_LOOK_MESSAGE, type PartCodec } from "../src/platform/api";
import { PartRegistry } from "../src/platform/core/document";
import { type Recipe } from "../src/engines/layered-makeup/recipe";
import { EYE_MAKEUP_PART_1, parseEyeMakeupPart, recipeFile } from "../src/recipe-schema";
import { WorkspacePersistence } from "../src/workspace-persistence";
import { loadWorkspace, NEWER_WORKSPACE_MESSAGE, parseWorkspace, serializeWorkspace, workspaceKeys,
  type WorkspaceState } from "../src/workspace-state";
import { restore } from "./fixtures/workspace-observable";
import { historyRecipes } from "./fixtures/looks";
import { fixedId, smallWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { EYE_MAKEUP_LAYER_MODELS, RecipeModelRegistry as LayerModelRegistry, readRecipe as parseRecipe } from "../src/recipe-schema";
import { initialRecipe } from "./fixtures/eye-region";

const EYE = "eye-makeup", NEWER_PART = "xfs/eye-makeup-part-9";
const root = mkdtempSync(resolve(tmpdir(), "xfs-newer-data-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The small fixture as this build stores it (workspace-2), through JSON. */
const stored = () => JSON.parse(JSON.stringify(serializeWorkspace(restore(smallWorkspaceV1()).state, STUDIO_DOCUMENTS)));
const storage = (value: unknown) => ({ getItem: (key: string) => key === workspaceKeys(false).workspace ? JSON.stringify(value) : null });
/** A look's eye-makeup part as a newer build would write it. */
const newer = (look: { parts: Record<string, unknown> }) => { look.parts[EYE] = { schema: NEWER_PART, body: { anything: true } }; };
/** A part-2 recipe body with a layer model this build does not register (from a newer build). */
const newerModelBody = () => {
  const recipe = parseRecipe(initialRecipe());
  recipe.layers[0] = { ...recipe.layers[0], finish: "glitter", flakes: { model: "uv-cell-direct-9" } as never };
  return recipe;
};

const cases: [string, (value: any) => void][] = [
  ["a recovery draft's look", value => newer(value.collections.previous.collection.presets[0])],
  ["a removed preset", value => newer(value.collections.removed[0].preset)],
  ["the selected look's Undo history (newer part schema)", value => {
    value.collections.memory[value.collections.selected][EYE].partSchema = NEWER_PART; }],
  ["another look's Undo history (a newer layer model in one entry)", value => {
    const memory = value.collections.memory[fixedId(1)][EYE];
    memory.partSchema = "xfs/eye-makeup-part-2"; memory.history = [newerModelBody(), ...memory.history.map((body: unknown) =>
      parseEyeMakeupPart({ schema: EYE_MAKEUP_PART_1, body }))]; }],
  ["a recovery draft's history", value => {
    const draft = value.collections.previous, id = draft.collection.presets[0].id;
    draft.memory[id][EYE].partSchema = NEWER_PART; draft.memory[id][EYE].history = [{ from: "newer" }]; }],
];

/** Where each case's newer data sits: the draft holding it and the locked look's ID (or the removed entry). */
type Place = { draft: (value: any) => any; look: (draft: any) => string; removed?: true };
const places: Record<string, Place> = {
  "a recovery draft's look": { draft: value => value.collections.previous, look: draft => draft.collection.presets[0].id },
  "a removed preset": { draft: value => value.collections, look: draft => draft.removed[0].preset.id, removed: true },
  "the selected look's Undo history (newer part schema)": { draft: value => value.collections, look: draft => draft.selected },
  "another look's Undo history (a newer layer model in one entry)": { draft: value => value.collections, look: () => fixedId(1) },
  "a recovery draft's history": { draft: value => value.collections.previous, look: draft => draft.collection.presets[0].id },
};
/** A look's stored parts and memory in a stored draft (or its removed entry). */
function storedLook(draft: any, id: string, removed?: true) {
  if (removed) { const entry = draft.removed.find((item: any) => item.preset.id === id); return { preset: entry.preset, memory: entry.memory }; }
  return { preset: draft.collection.presets.find((look: any) => look.id === id), memory: draft.memory[id] };
}

test("newer data in a collection draft locks only that look; the workspace stays writable and writes it back exactly (step 5)", () => {
  const baseline = loadWorkspace(storage(stored()), false, STUDIO_DOCUMENTS);
  expect(baseline).toMatchObject({ writable: true });
  for (const [name, change] of cases) {
    const value = stored(); change(value);
    // The strict reader still refuses it with the typed error; it is never treated as damage.
    let error: unknown;
    try { parseWorkspace(structuredClone(value), STUDIO_DOCUMENTS, []); } catch (caught) { error = caught; }
    expect(isNewerData(error), name).toBe(true);
    const loaded = loadWorkspace(storage(value), false, STUDIO_DOCUMENTS);
    expect({ name, writable: loaded.writable, newer: loaded.newer, error: loaded.error, warning: loaded.warning })
      .toEqual({ name, writable: true, newer: undefined, error: undefined, warning: undefined });
    // Exactly that look is locked, with the plain reason; every other look reads as before.
    const place = places[name], id = place.look(place.draft(value));
    const draft = place.draft({ collections: loaded.state.collections });
    const look = place.removed ? draft.removed.find((entry: any) => entry.preset.id === id).preset
      : draft.collection.presets.find((item: any) => item.id === id);
    expect(look.locked, name).toBe(NEWER_LOOK_MESSAGE);
    const lockedIds = [loaded.state.collections!, loaded.state.collections!.previous!].flatMap(item => [...item.collection.presets,
      ...item.removed.map(entry => entry.preset)]).filter(item => item.locked).map(item => item.id);
    expect(lockedIds, name).toEqual([id]);
    if (place.draft(value) === value.collections && !place.removed && id === value.collections.selected)
      expect([loaded.state.liveLocked, loaded.state.recipe.layers.length], name).toEqual([NEWER_LOOK_MESSAGE, 0]);
    else expect(loaded.state.recipe, name).toEqual(baseline.state.recipe);
    // Autosave writes, and the look's parts and memory come back exactly as they were stored.
    const autosave = (state: WorkspaceState) => {
      let written: string | undefined;
      const persistence = new WorkspacePersistence({ storage: { setItem: (_key: string, text: string) => { written = text; } },
        key: workspaceKeys(false).workspace, writable: true, capture: () => state, model: STUDIO_DOCUMENTS });
      persistence.activate(); persistence.flush();
      return written!;
    };
    const written = autosave(loaded.state), again = JSON.parse(written);
    expect(storedLook(place.draft(again), id, place.removed), name).toEqual(storedLook(place.draft(value), id, place.removed));
    // Loaded again and autosaved again, it is the same text: a locked look round-trips exactly.
    const reloaded = loadWorkspace(storage(again), false, STUDIO_DOCUMENTS);
    expect(reloaded.writable, name).toBe(true);
    expect(autosave(reloaded.state), name).toBe(written);
  }
});

test("a newer look in the current draft opens locked; a newer loose editor still falls back to a fresh read-only draft", () => {
  const value = stored(); newer(value.collections.collection.presets[0]);
  const loaded = loadWorkspace(storage(value), false, STUDIO_DOCUMENTS);
  expect(loaded).toMatchObject({ writable: true });
  expect(loaded.state.collections!.collection.presets[0]).toMatchObject({ locked: NEWER_LOOK_MESSAGE,
    parts: { [EYE]: { schema: NEWER_PART, body: { anything: true } } } });
  // The loose editor (no collection draft) cannot hold a locked look: the workspace stays protected as before.
  const loose = stored(); delete loose.collections;
  loose.look = { parts: { [EYE]: { schema: NEWER_PART, body: {} } }, memory: {} };
  expect(loadWorkspace(storage(loose), false, STUDIO_DOCUMENTS)).toMatchObject({ writable: false, newer: true, error: NEWER_WORKSPACE_MESSAGE });
  // Damage (not newer data) keeps the old tolerant behaviour: dropped with a warning, still writable.
  const damaged = stored(); damaged.collections.removed[0].preset.parts[EYE].body = { layers: "broken" };
  const repaired = loadWorkspace(storage(damaged), false, STUDIO_DOCUMENTS);
  expect(repaired).toMatchObject({ writable: true, warning: expect.stringContaining("removed preset") });
  expect(repaired.newer).toBeUndefined();
});

test("desktop saves a workspace with a locked look and keeps it exactly; newer data it cannot keep is never replaced", () => {
  const dir = resolve(root, "desktop"), store = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS), file = resolve(dir, store.fileName(false));
  store.save(false, JSON.stringify(stored()));
  const value = stored(); value.collections.memory[value.collections.selected][EYE].partSchema = NEWER_PART;
  const text = JSON.stringify(value);
  writeFileSync(file, text);
  expect(store.load(false)).toBe(text);
  // The renderer opens it with that look locked and writes it back: the store takes it and keeps the look exactly.
  const loaded = loadWorkspace(storage(value), false, STUDIO_DOCUMENTS);
  store.save(false, JSON.stringify(serializeWorkspace(loaded.state, STUDIO_DOCUMENTS)));
  const saved = JSON.parse(readFileSync(file, "utf8")), id = value.collections.selected;
  expect(storedLook(saved.collections, id)).toEqual(storedLook(value.collections, id));
  // A workspace whose newer data cannot be kept per look (a newer loose editor) is never replaced.
  const loose = stored(); delete loose.collections;
  loose.look = { parts: { [EYE]: { schema: NEWER_PART, body: {} } }, memory: {} };
  writeFileSync(file, JSON.stringify(loose));
  const fresh = JSON.stringify(serializeWorkspace(restore(smallWorkspaceV1()).state, STUDIO_DOCUMENTS));
  expect(() => store.load(false)).toThrow();
  expect(() => store.save(false, fresh)).toThrow();
  expect(readFileSync(file, "utf8")).toBe(JSON.stringify(loose));
  // Start fresh sets that unreadable workspace aside (never deleted).
  const response = desktopWorkspaceStartFresh(new Request("http://127.0.0.1/", { method: "POST" }), store, false);
  return response.json().then(body => {
    expect(body.keptAs).toBeString();
    expect(existsSync(resolve(dir, body.keptAs))).toBe(true);
    expect(readdirSync(dir)).not.toContain(store.fileName(false));
  });
});

test("Undo histories and workspace looks are written in the oldest part schema that holds them", () => {
  const state = restore(smallWorkspaceV1()).state;
  const written = serializeWorkspace(state, STUDIO_DOCUMENTS);
  const memories = Object.values(written.collections!.memory).map(memory => (memory as Record<string, { partSchema: string }>)[EYE]);
  expect(memories.every(memory => memory.partSchema === EYE_MAKEUP_PART_1)).toBe(true);
  expect(written.collections!.collection.presets.every(look => look.parts[EYE].schema === EYE_MAKEUP_PART_1)).toBe(true);
  // One entry only part-2 holds (a model no recipe schema has) makes that history part-2, as the collection writers do.
  const partTwoOnly = partTwoOnlyRegistry();
  const memory = partTwoOnly.parts.writeMemory({ [EYE]: { editor: { active: 0, selected: 0 },
    history: [partTwoOnly.plain, partTwoOnly.recipe] } });
  expect(memory[EYE].partSchema).toBe("xfs/eye-makeup-part-2");
  const plainOnly = partTwoOnly.parts.writeMemory({ [EYE]: { editor: { active: 0, selected: 0 }, history: [partTwoOnly.plain] } });
  expect(plainOnly[EYE].partSchema).toBe(EYE_MAKEUP_PART_1);
  expect(plainOnly[EYE].history).toEqual([recipeFile(partTwoOnly.plain)]);
});

test("step-2 code paths read what this build writes: a registry that knows only part-1 restores it exactly", () => {
  // Step-2 builds registered eye makeup with part-1 only (current and accepted), and refuse anything newer.
  const partOne: PartCodec<Recipe> = { ...eyeMakeupPartCodec(), current: EYE_MAKEUP_PART_1, accepts: [EYE_MAKEUP_PART_1],
    parse: envelope => { if (envelope.schema !== EYE_MAKEUP_PART_1) throw Error("newer"); return parseRecipe(envelope.body); },
    serialize: recipe => ({ schema: EYE_MAKEUP_PART_1, body: recipeFile(recipe)! }), downgrade: () => undefined };
  const stepTwo = { parts: new PartRegistry([{ ...EYE_MAKEUP, part: partOne }]), live: EYE };
  for (const fixture of [smallWorkspaceV1()]) {
    const state = restore(fixture).state;
    const text = JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS));
    const read = parseWorkspace(JSON.parse(text), stepTwo, []);
    const recipes = (value: WorkspaceState) => ({ recipe: value.recipe, history: historyRecipes(value.history),
      looks: value.collections!.collection.presets.map(look => look.parts[EYE].body),
      histories: Object.values(value.collections!.memory).map(memory => historyRecipes(STUDIO_DOCUMENTS.parts.lookHistory(memory))),
      removed: value.collections!.removed.map(entry => entry.preset.parts[EYE].body),
      recovery: value.collections!.previous?.collection.presets.map(look => look.parts[EYE].body) });
    // Part-1 bodies read back through the step-2 path are the same recipes (their file schemas aside).
    const strip = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => key === "schema" ? undefined : item));
    expect(strip(recipes(read))).toEqual(strip(recipes(state)));
  }
  // The same registry refuses a history only part-2 holds, as a newer build's, instead of dropping it.
  const partTwoOnly = partTwoOnlyRegistry();
  const memory = partTwoOnly.parts.writeMemory({ [EYE]: { editor: {}, history: [partTwoOnly.recipe] } });
  expect(() => stepTwo.parts.readMemory(memory, undefined)).toThrow();
});

/** A registry with a Glitter model no recipe schema holds (so only part-2 holds a recipe using it). */
function partTwoOnlyRegistry() {
  const models = new LayerModelRegistry([...EYE_MAKEUP_LAYER_MODELS,
    { slot: "flakes", id: "uv-cell-direct-4", valid: (value: unknown, finish) => finish === "glitter" &&
      !!value && typeof value === "object" && (value as { model?: unknown }).model === "uv-cell-direct-4" }]);
  const part = eyeMakeupPartCodec(models);
  const parts = new PartRegistry([{ ...EYE_MAKEUP, part }]);
  const recipe = initialRecipe();
  recipe.layers[1] = { ...recipe.layers[1], finish: "glitter", flakes: { model: "uv-cell-direct-4" } as never };
  return { parts, recipe: parseRecipe(recipe, models), plain: parseRecipe(initialRecipe(), models) };
}
