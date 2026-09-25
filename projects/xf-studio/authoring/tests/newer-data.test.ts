/**
 * CORE-27: data from a newer XF Studio (a part schema or layer model this build does not know) is
 * never dropped as damage. Wherever it sits in a workspace (the current draft, recovery drafts,
 * removed presets, Undo histories), the workspace opens read-only and is never written back;
 * Undo histories are written in the oldest part schema that holds them, so older builds read them.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DesktopWorkspaceStore, desktopWorkspaceStartFresh } from "../desktop/workspace-store";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { EYE_MAKEUP, eyeMakeupPartCodec } from "../src/features/eye-makeup";
import { EYE_MAKEUP_LAYER_MODELS, LayerModelRegistry } from "../src/layer-models";
import { isNewerData, type PartCodec } from "../src/platform/api";
import { PartRegistry } from "../src/platform/core/document";
import { initialRecipe, parseRecipe, type Recipe } from "../src/recipe";
import { EYE_MAKEUP_PART_1, parseEyeMakeupPart, recipeFile } from "../src/recipe-schema";
import { WorkspacePersistence } from "../src/workspace-persistence";
import { loadWorkspace, NEWER_WORKSPACE_MESSAGE, parseWorkspace, serializeWorkspace, workspaceKeys,
  type WorkspaceState } from "../src/workspace-state";
import { restore } from "./fixtures/workspace-observable";
import { fixedId, smallWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";

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

test("newer data anywhere opens the workspace read-only with its current draft, and nothing is dropped as damage", () => {
  const baseline = loadWorkspace(storage(stored()), false, STUDIO_DOCUMENTS);
  expect(baseline).toMatchObject({ writable: true });
  for (const [name, change] of cases) {
    const value = stored(); change(value);
    // Strict and tolerant reads both refuse it with the typed error; neither treats it as damage.
    let error: unknown;
    try { parseWorkspace(structuredClone(value), STUDIO_DOCUMENTS, []); } catch (caught) { error = caught; }
    expect(isNewerData(error), name).toBe(true);
    const loaded = loadWorkspace(storage(value), false, STUDIO_DOCUMENTS);
    expect({ name, writable: loaded.writable, newer: loaded.newer, error: loaded.error, warning: loaded.warning })
      .toEqual({ name, writable: false, newer: true, error: NEWER_WORKSPACE_MESSAGE, warning: undefined });
    // The current draft is shown as it was stored.
    expect(loaded.state.recipe, name).toEqual(baseline.state.recipe);
    expect(loaded.state.collections!.collection, name).toEqual(baseline.state.collections!.collection);
    // The read-only state is never written: autosave reports protected and leaves storage alone.
    let writes = 0;
    const persistence = new WorkspacePersistence({ storage: { setItem: () => { writes++; } }, key: workspaceKeys(false).workspace,
      writable: loaded.writable, restoreError: loaded.error, capture: () => loaded.state, model: STUDIO_DOCUMENTS });
    const statuses: string[] = [];
    persistence.subscribe(status => statuses.push(status.kind));
    persistence.activate(); persistence.flush();
    expect({ name, writes, statuses }).toEqual({ name, writes: 0, statuses: ["protected"] });
  }
});

test("a newer current draft falls back to a fresh read-only draft; damage elsewhere is still dropped with a note", () => {
  const value = stored(); newer(value.collections.collection.presets[0]);
  const loaded = loadWorkspace(storage(value), false, STUDIO_DOCUMENTS);
  expect(loaded).toMatchObject({ writable: false, newer: true, error: NEWER_WORKSPACE_MESSAGE });
  expect(loaded.state.collections).toBeUndefined();
  // Damage (not newer data) keeps the old tolerant behaviour: dropped with a warning, still writable.
  const damaged = stored(); damaged.collections.removed[0].preset.parts[EYE].body = { layers: "broken" };
  const repaired = loadWorkspace(storage(damaged), false, STUDIO_DOCUMENTS);
  expect(repaired).toMatchObject({ writable: true, warning: expect.stringContaining("removed preset") });
  expect(repaired.newer).toBeUndefined();
});

test("desktop loads a workspace whose current draft is readable, never replaces newer data and never sets that draft aside", () => {
  const dir = resolve(root, "desktop"), store = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS), file = resolve(dir, store.fileName(false));
  store.save(false, JSON.stringify(stored()));
  const value = stored(); value.collections.memory[value.collections.selected][EYE].partSchema = NEWER_PART;
  const text = JSON.stringify(value);
  writeFileSync(file, text);
  // GET answers with the file (no 409): the renderer opens it read-only.
  expect(store.load(false)).toBe(text);
  // A save never replaces it; posting the unchanged text back (the update flush) is not a change.
  const fresh = JSON.stringify(serializeWorkspace(restore(smallWorkspaceV1()).state, STUDIO_DOCUMENTS));
  expect(() => store.save(false, fresh)).toThrow("newer XF Studio");
  store.save(false, text);
  expect(readFileSync(file, "utf8")).toBe(text);
  // Start fresh keeps the good draft in place.
  const response = desktopWorkspaceStartFresh(new Request("http://127.0.0.1/", { method: "POST" }), store, false);
  return response.json().then(body => {
    expect(body).toEqual({ keptAs: null });
    expect(readFileSync(file, "utf8")).toBe(text);
    // Only a current draft this build cannot show is refused, and then set aside (never deleted).
    const unreadable = stored(); newer(unreadable.collections.collection.presets[0]);
    writeFileSync(file, JSON.stringify(unreadable));
    expect(() => store.load(false)).toThrow();
    const kept = store.setAside(false)!;
    expect(existsSync(resolve(dir, kept))).toBe(true);
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
    const recipes = (value: WorkspaceState) => ({ recipe: value.recipe, history: value.history,
      looks: value.collections!.collection.presets.map(look => look.parts[EYE].body),
      histories: Object.values(value.collections!.memory).map(memory => memory[EYE].history),
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
