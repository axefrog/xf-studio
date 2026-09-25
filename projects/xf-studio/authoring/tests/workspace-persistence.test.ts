import { afterEach, expect, jest, test } from "bun:test";
import { createBrowserWorkspaceSession } from "../src/browser-workspace-device";
import { COLLECTION_RECOVERY_LIMIT, collectionDraft, REMOVED_PRESET_LIMIT, withLiveMemory, type CollectionDraft,
  type CollectionWorkspace } from "../src/collection-workspace";
import { RECIPE_HISTORY_LIMIT } from "../src/editor-actions";
import { editLayers } from "../src/layer-stack";
import { PresentationStatusSource, emptyPresentationStatus } from "../src/presentation-status";
import { initialRecipe, type Recipe } from "../src/recipe";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { encodeWorkspaceForStorage, fitWorkspace, PERSISTED_BACKGROUND_HISTORY, WORKSPACE_STORAGE_BUDGET } from "../src/workspace-budget";
import { SAVE_MESSAGES, WorkspacePersistence } from "../src/workspace-persistence";
import { freshWorkspace, loadWorkspace, parseWorkspace, serializeWorkspace, workspaceKeys, type WorkspaceState } from "../src/workspace-state";
import { historyRecipes, looks, memoryOf, recipeOf, storedWorkspace } from "./fixtures/looks";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

afterEach(() => { jest.useRealTimers(); });

const key = workspaceKeys(true).workspace;
function memoryStorage() {
  const stored = new Map<string, string>(); let writes = 0;
  return { stored, writes: () => writes, getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { writes++; stored.set(k, v); } };
}

/** The shape the composition root builds, including the status feedback that used to loop. */
function studioSession(storage: ReturnType<typeof memoryStorage>, options: { watchStatus?: boolean } = {}) {
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  let status = emptyPresentationStatus(true);
  const statusSource = new PresentationStatusSource(() => status);
  const events = Object.assign(new EventTarget(), { hidden: false });
  const session = createBrowserWorkspaceSession({ workspace, restored, verification: true, storage,
    capture: { editor: () => core.document.export(), uvView: () => workspace.uvView, savedV: () => undefined,
      collections: () => workspace.collections, quality: () => workspace.preview.textureSize,
      preview: () => undefined, motion: () => undefined },
    sources: [core.document], window: new EventTarget(), document: events,
    onStatus: save => { status = { ...status, workspace: save }; statusSource.changed(); }, model: STUDIO_DOCUMENTS });
  // A presentation-wide subscription also sees status changes; it must not keep saving.
  if (options.watchStatus) session.watch(statusSource);
  return { core, session, statusSource, status: () => status };
}

test("autosave stops when idle: a save's own status never schedules another write (CORE-01)", () => {
  jest.useFakeTimers();
  const storage = memoryStorage();
  const { core, session, status } = studioSession(storage, { watchStatus: true });
  session.activate();
  session.request();
  jest.advanceTimersByTime(200);
  expect(storage.writes()).toBe(1);
  expect(status().workspace.kind).toBe("saved");
  // Previously each save re-requested a save about every 180 ms, forever.
  jest.advanceTimersByTime(60_000);
  expect(storage.writes()).toBe(1);
  // Clicks and other coarse triggers without an edit do not rewrite identical content.
  session.request(); session.flush();
  expect(storage.writes()).toBe(1);
  // An edit resumes autosave, once.
  const layer = core.document.recipe.layers[0];
  expect(core.app.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .33 }).ok).toBe(true);
  jest.advanceTimersByTime(200);
  expect(storage.writes()).toBe(2);
  expect(JSON.parse(storage.stored.get(key)!).look.parts["eye-makeup"].body.layers[0].opacity).toBe(.33);
  jest.advanceTimersByTime(60_000);
  expect(storage.writes()).toBe(2);
});

test("save status is published only when it changes", () => {
  const storage = memoryStorage(), workspace = freshWorkspace();
  const writer = new WorkspacePersistence({ storage, key, writable: true, capture: () => workspace, model: STUDIO_DOCUMENTS });
  const seen: string[] = [];
  writer.subscribe(s => seen.push(s.kind));
  writer.activate();
  writer.flush();
  workspace.recipe.layers[0].opacity = .21; writer.flush();
  workspace.recipe.layers[0].opacity = .22; writer.flush();
  expect(storage.writes()).toBe(3);
  expect(seen).toEqual(["saved"]);
});

// ---- CORE-02: realistic scale ----

function eightLayerRecipe(): Recipe {
  let recipe = initialRecipe();
  while (recipe.layers.length < 8)
    recipe = editLayers(recipe, recipe.layers[0].id, { kind: "duplicate", id: recipe.layers.at(-1)!.id,
      newId: `layer-${recipe.layers.length + 1}` }).recipe;
  return recipe;
}
function variant(recipe: Recipe, i: number): Recipe {
  const next = structuredClone(recipe); next.layers[0].opacity = (i % 100) / 100; return next;
}
function fullHistory(recipe: Recipe) {
  return Array.from({ length: RECIPE_HISTORY_LIMIT }, (_, i) => variant(recipe, i));
}
function busyDraft(presets: number, recipe: Recipe): CollectionDraft {
  const draft = collectionDraft({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Looks",
    presets: Array.from({ length: presets }, (_, i) => ({ id: crypto.randomUUID(), name: `Look ${i + 1}`, revision: 1,
      recipe: variant(recipe, i) })) }, STUDIO_DOCUMENTS);
  for (const preset of draft.collection.presets)
    draft.memory[preset.id] = withLiveMemory(undefined, { active: 0, selected: 0, history: fullHistory(recipe) }, STUDIO_DOCUMENTS);
  draft.removed = Array.from({ length: REMOVED_PRESET_LIMIT }, (_, i) => ({ index: 0,
    preset: looks({ schema: "xfas/collection-1", id: draft.collection.id, name: "Looks", presets: [
      { id: crypto.randomUUID(), name: `Removed ${i + 1}`, revision: 1, recipe: variant(recipe, i) }] }).presets[0],
    memory: withLiveMemory(undefined, { active: 0, selected: 0, history: fullHistory(recipe) }, STUDIO_DOCUMENTS) }));
  draft.selected = draft.collection.presets[Math.min(2, presets - 1)].id;
  return draft;
}
/** 6 presets of 8 layers, 80 Undo entries each, 20 removed presets and 4 recovery drafts, all with histories. */
function realisticWorkspace(presets = 6): WorkspaceState {
  const recipe = eightLayerRecipe();
  const current = busyDraft(presets, recipe);
  const recovery = Array.from({ length: COLLECTION_RECOVERY_LIMIT }, () => busyDraft(presets, recipe));
  const collections: CollectionWorkspace = { ...current, previous: recovery[0], older: recovery.slice(1) };
  const selected = current.collection.presets.find(p => p.id === current.selected)!;
  // The live editor (top level) duplicates the selected preset and its history.
  return { ...freshWorkspace(recipeOf(selected)), history: memoryOf(current, selected.id).history, collections };
}

// Tests that encode realistic multi-megabyte workspaces take about 1 s each locally; slower CI runners
// (windows-2025 ran about 2.5 times slower) need more than bun's 5 s default.
const HEAVY_WORKSPACE_TIMEOUT_MS = 30_000;

test("a realistic workspace fits the storage budget with the standard policy and restores (CORE-02)", () => {
  const state = realisticWorkspace();
  expect(JSON.stringify(state.recipe).length).toBeGreaterThan(11_000);
  // Stored verbatim this exceeded the ~5M code-unit browser quota and autosave silently stopped.
  expect(JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)).length).toBeGreaterThan(5_000_000);
  const stored = encodeWorkspaceForStorage(state, STUDIO_DOCUMENTS);
  expect(stored.level).toBe(0);
  expect(stored.size).toBeLessThanOrEqual(WORKSPACE_STORAGE_BUDGET);

  const restored = parseWorkspace(JSON.parse(stored.encoded), STUDIO_DOCUMENTS);
  const collections = restored.collections!, selected = collections.selected!;
  // The selected preset keeps its full Undo history and is the editor recipe.
  expect(restored.recipe).toEqual(recipeOf(state.collections!.collection.presets.find(p => p.id === selected)!));
  expect(historyRecipes(restored.history)).toHaveLength(RECIPE_HISTORY_LIMIT);
  for (const preset of collections.collection.presets)
    expect(memoryOf(collections, preset.id).history).toHaveLength(preset.id === selected ? RECIPE_HISTORY_LIMIT : PERSISTED_BACKGROUND_HISTORY);
  // Removed presets and recovery drafts keep their looks, not their Undo histories.
  expect(collections.removed).toHaveLength(REMOVED_PRESET_LIMIT);
  expect(collections.removed.every(entry => STUDIO_DOCUMENTS.parts.lookHistory(entry.memory).entries.length === 0)).toBe(true);
  expect([collections.previous, ...collections.older!]).toHaveLength(COLLECTION_RECOVERY_LIMIT);
  expect(Object.values(collections.previous!.memory).every(memory => STUDIO_DOCUMENTS.parts.lookHistory(memory).entries.length === 0)).toBe(true);
  expect(collections.previous!.collection).toEqual(state.collections!.previous!.collection);
  expect(collections.previous!.removed).toEqual([]);
}, HEAVY_WORKSPACE_TIMEOUT_MS);

test("an oversized workspace is stored in the look-level form, then trims further and says so instead of silently failing", () => {
  jest.useFakeTimers();
  const state = realisticWorkspace(16), storage = memoryStorage();
  expect(fitWorkspace(state, STUDIO_DOCUMENTS, Infinity).size).toBeGreaterThan(WORKSPACE_STORAGE_BUDGET);
  // Its whole-part form is over budget; the look-level form keeps every step (CORE-39), so nothing is lost.
  const writer = new WorkspacePersistence({ storage, key, writable: true, capture: () => state, model: STUDIO_DOCUMENTS });
  writer.activate(); writer.flush();
  expect(storage.writes()).toBe(1);
  expect(writer.storedSize()).toBeLessThanOrEqual(WORKSPACE_STORAGE_BUDGET);
  expect(writer.snapshot()).toEqual({ kind: "saved", message: SAVE_MESSAGES.saved });
  const restored = parseWorkspace(JSON.parse(storage.stored.get(key)!), STUDIO_DOCUMENTS);
  expect(restored.collections!.collection.presets).toHaveLength(16);
  expect(historyRecipes(restored.history)).toHaveLength(RECIPE_HISTORY_LIMIT);
  // Under a budget that holds only part of that, older steps go and the status says so.
  const tight = memoryStorage();
  const trimming = new WorkspacePersistence({ storage: tight, key, writable: true, capture: () => state, model: STUDIO_DOCUMENTS,
    budget: Math.floor(writer.storedSize() * 0.6) });
  trimming.activate(); trimming.flush();
  expect(trimming.snapshot()).toEqual({ kind: "nearly-full", message: SAVE_MESSAGES.nearlyFull });
  expect(trimming.storedSize()).toBeLessThanOrEqual(Math.floor(writer.storedSize() * 0.6));
  expect(parseWorkspace(JSON.parse(tight.stored.get(key)!), STUDIO_DOCUMENTS).collections!.collection.presets).toHaveLength(16);
}, HEAVY_WORKSPACE_TIMEOUT_MS);

test("a storage quota refusal falls back to smaller forms, then reports that autosave stopped", () => {
  const state = realisticWorkspace(), stored = new Map<string, string>();
  let limit = 400_000;
  const quota = () => Object.assign(Error("The quota has been exceeded."), { name: "QuotaExceededError" });
  const storage = { setItem: (k: string, v: string) => { if (v.length > limit) throw quota(); stored.set(k, v); } };
  const writer = new WorkspacePersistence({ storage, key, writable: true, capture: () => state, model: STUDIO_DOCUMENTS });
  writer.activate(); writer.flush();
  expect(stored.get(key)!.length).toBeLessThanOrEqual(limit);
  expect(writer.snapshot().kind).toBe("nearly-full");
  limit = 10; state.recipe.layers[0].opacity = .77; recipeOf(state.collections!.collection.presets[2]).layers[0].opacity = .77;
  writer.flush();
  expect(writer.snapshot()).toEqual({ kind: "full", message: SAVE_MESSAGES.full });
  const blocked = new WorkspacePersistence({ storage: { setItem() { throw Error("SecurityError"); } }, key, writable: true,
    capture: () => state, model: STUDIO_DOCUMENTS });
  blocked.activate(); blocked.flush();
  expect(blocked.snapshot().kind).toBe("unavailable");
}, HEAVY_WORKSPACE_TIMEOUT_MS);

// ---- CORE-10: damaged non-current entries ----

test("a damaged recovery draft or removed preset is dropped with a warning; the draft still restores (CORE-10)", () => {
  const recipe = eightLayerRecipe();
  const current = busyDraft(2, recipe), previous = busyDraft(2, recipe), older = busyDraft(2, recipe);
  const state = { ...freshWorkspace(), collections: { ...current, previous, older: [older] } };
  const raw = storedWorkspace(state);
  raw.collections.previous.collection.presets[0].parts["eye-makeup"].body = { schema: "nope" };
  raw.collections.removed[3].preset.parts["eye-makeup"].body.layers = "broken";
  const storage = memoryStorage(); storage.stored.set(key, JSON.stringify(raw));
  const loaded = loadWorkspace(storage, true, STUDIO_DOCUMENTS);
  expect(loaded.writable).toBe(true);
  expect(loaded.error).toBeUndefined();
  expect(loaded.warning).toContain("could not be restored");
  const collections = loaded.state.collections!;
  expect(collections.collection).toEqual(current.collection);
  expect(collections.removed).toHaveLength(REMOVED_PRESET_LIMIT - 1);
  // The intact older draft takes the damaged one's place.
  expect(collections.previous!.collection).toEqual(older.collection);
  expect(collections.older).toEqual([]);

  const writer = new WorkspacePersistence({ storage, key, writable: loaded.writable, restoreWarning: loaded.warning,
    capture: () => loaded.state, model: STUDIO_DOCUMENTS });
  writer.activate(); writer.flush();
  expect(writer.snapshot().kind).toBe("repaired");
  expect(writer.snapshot().message).toContain("Draft autosaved.");

  // The current draft itself must parse: a damaged one keeps storage protected.
  raw.collections.collection.presets[0].parts["eye-makeup"].body = { schema: "nope" };
  storage.stored.set(key, JSON.stringify(raw));
  const damaged = loadWorkspace(storage, true, STUDIO_DOCUMENTS);
  expect(damaged.writable).toBe(false);
  expect(damaged.error).toContain("Workspace could not be restored");
}, HEAVY_WORKSPACE_TIMEOUT_MS);
