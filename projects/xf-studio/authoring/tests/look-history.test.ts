/**
 * The look history (feature-module platform §3, migration step 4): chunk store, part and look steps,
 * Redo, the limit, its data forms (in memory, whole parts, `xfs/look-history-1`), what older builds do
 * with them, the platform transaction, `fitWorkspace` budgets and the async families (CORE-36).
 */
import { expect, test } from "bun:test";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS, STUDIO_PARTS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import { collectionDraft, withLiveMemory, type CollectionWorkspace, type DocumentModel } from "../src/collection-workspace";
import { editLayers } from "../src/layer-stack";
import { featureId, isNewerData, LOOK_HISTORY_1, LOOK_MEMORY, type AnyFeatureModule, type LookHistoryData, type PartCodec } from "../src/platform/api";
import { ChunkStore } from "../src/platform/core/chunk-store";
import { PartRegistry } from "../src/platform/core/document";
import { CONTROL_TRANSACTION, GESTURE_TRANSACTION, HistoryTransaction, type TransactionHost } from "../src/platform/core/history-transaction";
import { LookHistory, lookHistoryBodies, trimLookHistory } from "../src/platform/core/look-history";
import { initialRecipe, MAX_LAYERS, type Recipe } from "../src/recipe";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { encodeWorkspacePlan, fitWorkspace, MIN_SELECTED_HISTORY, PERSISTED_BACKGROUND_HISTORY, STANDARD_PLAN, WORKSPACE_STORAGE_BUDGET } from "../src/workspace-budget";
import { WorkspacePersistence } from "../src/workspace-persistence";
import { freshWorkspace, loadWorkspace, parseWorkspace, type WorkspaceState } from "../src/workspace-state";
import { historyRecipes, memoryOf } from "./fixtures/looks";
import { PartRegistry as PreStep4Registry } from "./fixtures/pre-step4/platform/core/document";

const EYE = "eye-makeup";

/** A second, synthetic feature: a hair part of strands, one chunk per strand. */
type Hair = { colour: string; strands: number[] };
const hairCodec: PartCodec<Hair> = {
  current: "xfs/hair-part-1", accepts: ["xfs/hair-part-1"],
  parse: envelope => {
    const body = envelope.body as Hair;
    if (!body || typeof body.colour !== "string" || !Array.isArray(body.strands)) throw Error("Damaged hair.");
    return { colour: body.colour, strands: [...body.strands] };
  },
  serialize: part => ({ schema: "xfs/hair-part-1", body: part }),
  empty: () => ({ colour: "#000000", strands: [] }), starter: () => ({ colour: "#000000", strands: [1] }),
  summary: part => ({ strands: part.strands.length }), maxBytes: 100_000,
  chunks: part => [{ colour: part.colour, strands: part.strands.length }, ...part.strands],
  join: chunks => ({ colour: (chunks[0] as { colour: string }).colour, strands: chunks.slice(1) as number[] }),
};
const HAIR: AnyFeatureModule = { id: featureId("hair"), label: "Hair", part: hairCodec as PartCodec<unknown>,
  editor: { empty: () => ({ brush: 1 }), parse: value => ({ brush: (value as { brush?: number } | undefined)?.brush ?? 1 }),
    serialize: value => value } };
const twoFeatures = new PartRegistry([EYE_MAKEUP, HAIR]);

function wideRecipe(layers: number): Recipe {
  let recipe = initialRecipe();
  while (recipe.layers.length < layers) recipe = editLayers(recipe, recipe.layers[0].id, { kind: "duplicate", id: recipe.layers.at(-1)!.id,
    newId: `wide-${recipe.layers.length}` }).recipe;
  return recipe;
}

// ---- Chunk store ----

test("the chunk store keeps equal text once, counts references and never lets a collision share an address", () => {
  const store = new ChunkStore();
  const a = store.put("{\"a\":1}"), again = store.put("{\"a\":1}"), b = store.put("{\"b\":2}");
  expect(again).toBe(a);
  expect(b).not.toBe(a);
  expect(store.stats()).toEqual({ chunks: 2, units: 14 });
  store.release(a);
  expect(store.text(a)).toBe("{\"a\":1}");
  store.release(a);
  expect(() => store.text(a)).toThrow("missing");
  // Every text hashes to the same address: content still decides identity.
  const colliding = new ChunkStore(() => "same");
  const x = colliding.put("x"), y = colliding.put("y"), x2 = colliding.put("x");
  expect([x, y, x2]).toEqual(["same", "same~1", "same"]);
  expect([colliding.text(x), colliding.text(y)]).toEqual(["x", "y"]);
});

// ---- Part and look steps ----

test("a gesture on one layer of a 32-layer look stores one layer chunk per step", () => {
  const workspace = freshWorkspace(wideRecipe(MAX_LAYERS));
  const { app, document } = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const id = document.recipe.layers[5].id;
  const drag = (du: number) => {
    expect(app.beginGesture("uv", id)).toBe(true);
    const point = document.recipe.layers[5].points[0];
    expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: point.u + du } })).toBe(true);
    app.endGesture("uv");
  };
  drag(.001);
  const first = document.historyStats();
  expect(first.chunks).toBe(MAX_LAYERS + 1);   // the header and every layer, once
  drag(.001); drag(.001);
  expect(document.historyStats().chunks).toBe(first.chunks + 2);
  expect(document.undoDepth).toBe(3);
});

test("look steps record several parts at once; Undo and Redo restore them together with their identity", () => {
  const look: Record<string, unknown> = { [EYE]: initialRecipe(), hair: { colour: "#112233", strands: [1, 2, 3] } };
  const read = (feature: string) => look[feature];
  const history = new LookHistory(twoFeatures);
  const part = history.checkpoint(read, [EYE], { label: { label: "Opacity", actionKind: "layer.setOpacity" } })!;
  (look[EYE] as Recipe) = { ...(look[EYE] as Recipe), layers: (look[EYE] as Recipe).layers.map((layer, i) => i ? layer : { ...layer, opacity: .2 }) };
  const whole = history.checkpoint(read, [EYE, "hair"], { label: { label: "Reset look", actionKind: "look.reset" } })!;
  expect(history.list().map(step => step.id)).toEqual([part, whole]);
  look[EYE] = { uv: "gltf-uv0-top-left", layers: [] }; look.hair = undefined;
  // Undo the look step: both parts come back, and the hair part exists again.
  const undone = history.undo(read, 1)!;
  expect((undone.parts[EYE] as Recipe).layers[0].opacity).toBe(.2);
  expect(undone.parts.hair).toEqual({ colour: "#112233", strands: [1, 2, 3] });
  Object.assign(look, undone.parts);
  expect(history.redoSteps().map(step => [step.id, step.label.label])).toEqual([[whole, "Reset look"]]);
  // Redo puts it back with its identity; the hair part is absent again.
  const redone = history.redo(read, 1)!;
  expect(redone.parts).toEqual({ [EYE]: { uv: "gltf-uv0-top-left", layers: [] }, hair: undefined });
  expect(history.list().map(step => step.id)).toEqual([part, whole]);
  // The data keeps the scope and the absent part; whole parts cannot hold it.
  const data = history.data();
  expect(data.entries.map(entry => entry.scope)).toEqual(["part", "look"]);
  expect(data.entries[1].before.hair).not.toBeNull();
  expect(lookHistoryBodies(data, twoFeatures)).toBeUndefined();
  expect(LookHistory.fromData(twoFeatures, data).data()).toEqual(data);
});

test("at the limit a new step displaces the oldest, and discarding or undoing it brings that one back", () => {
  const history = new LookHistory(twoFeatures, 3);
  let n = 0;
  const read = () => ({ colour: "#000000", strands: [n] });
  for (; n < 3; n++) history.checkpoint(read, ["hair"]);
  expect(history.trimmed).toBe(false);
  const fourth = history.checkpoint(read, ["hair"])!;
  expect([history.depth, history.trimmed]).toEqual([3, true]);
  expect(history.discard(fourth)).toBe(true);
  expect([history.depth, history.trimmed, (history.stepParts(0)!.hair as Hair).strands]).toEqual([3, false, [0]]);
  // Chunks only dropped steps used are freed.
  const before = history.stats().chunks;
  for (n = 10; n < 20; n++) history.checkpoint(read, ["hair"]);
  expect(history.stats().chunks).toBeLessThanOrEqual(before + 4);
});

test("trimming keeps the latest steps, drops their unused chunks and records it", () => {
  const history = LookHistory.fromBodies(twoFeatures, "hair", Array.from({ length: 12 }, (_, i) => ({ colour: "#000000", strands: [i] })));
  const data = history.data(), trimmed = trimLookHistory(data, 5);
  expect(trimmed.entries).toHaveLength(5);
  expect(trimmed.trimmed).toBe(true);
  expect(Object.keys(trimmed.chunks)).toHaveLength(6);   // one shared header and five strands
  expect(trimLookHistory(data, 12)).toBe(data);
});

// ---- Stored forms and older builds ----

test("a one-feature history is stored as whole parts (older builds read it); a look history as xfs/look-history-1 (older builds open it read-only)", () => {
  const recipe = initialRecipe();
  const steps = [0.1, 0.2, 0.3].map(opacity => ({ ...recipe, layers: recipe.layers.map((layer, i) => i ? layer : { ...layer, opacity }) }));
  const memory = withLiveMemory(undefined, { active: 1, selected: 2, history: steps, historyTrimmed: true }, STUDIO_DOCUMENTS);
  expect(Object.keys(memory)).toEqual([EYE, LOOK_MEMORY]);
  const stored = STUDIO_PARTS.writeMemory(memory);
  expect(stored).toEqual({ [EYE]: { editor: { active: 1, selected: 2 }, partSchema: "xfs/eye-makeup-part-1",
    history: steps.map(step => ({ schema: "xfs/recipe-7", ...step })), historyTrimmed: true } });
  // The code before the look history reads that form fully.
  const previous = new PreStep4Registry([EYE_MAKEUP as never]);
  const old = previous.readMemory(JSON.parse(JSON.stringify(stored)), undefined);
  expect(old[EYE].history).toHaveLength(3);
  expect(old[EYE].historyTrimmed).toBe(true);
  // This build reads it back to the same history.
  expect(historyRecipes(STUDIO_PARTS.lookHistory(STUDIO_PARTS.readMemory(stored, undefined)))).toEqual(steps);

  // A look step touching two features needs the look-level form.
  const history = new LookHistory(twoFeatures), look = { [EYE]: recipe, hair: { colour: "#445566", strands: [4, 5] } };
  history.checkpoint(feature => look[feature as keyof typeof look], [EYE, "hair"]);
  const both = twoFeatures.withLookHistory({ [EYE]: { editor: { active: 0, selected: 0 } }, hair: { editor: { brush: 3 } } }, history.data());
  const levels = twoFeatures.writeMemory(both);
  expect(levels[EYE]).toMatchObject({ partSchema: LOOK_HISTORY_1, history: [LOOK_MEMORY] });
  expect(levels.hair).toMatchObject({ partSchema: LOOK_HISTORY_1, history: [LOOK_MEMORY] });
  expect((levels[LOOK_MEMORY].editor as LookHistoryData).schema).toBe(LOOK_HISTORY_1);
  const again = twoFeatures.readMemory(JSON.parse(JSON.stringify(levels)), undefined);
  expect(twoFeatures.lookHistory(again)).toEqual(history.data());
  // An older build refuses it as newer data (its workspace opens read-only), never as damage.
  let error: unknown;
  try { new PreStep4Registry([EYE_MAKEUP as never, HAIR as never]).readMemory(JSON.parse(JSON.stringify(levels)), undefined); }
  catch (caught) { error = caught; }
  expect((error as { code?: string }).code).toBe("newer_data");
  // A build without the hair feature cannot apply that history: newer data too, and it is kept out of a read-only view.
  expect(() => STUDIO_PARTS.readMemory(JSON.parse(JSON.stringify(levels)), undefined)).toThrow();
  try { STUDIO_PARTS.readMemory(JSON.parse(JSON.stringify(levels)), undefined); } catch (caught) { expect(isNewerData(caught)).toBe(true); }
  expect(STUDIO_PARTS.lookHistory(STUDIO_PARTS.readMemory(JSON.parse(JSON.stringify(levels)), undefined, "omit")))
    .toMatchObject({ entries: [], trimmed: true });
});

test("a damaged look-level step is skipped like a damaged whole-part entry; the rest restores", () => {
  const history = LookHistory.fromBodies(twoFeatures, "hair", [{ colour: "#000001", strands: [1] }, { colour: "#000002", strands: [2] },
    { colour: "#000003", strands: [3] }]);
  const data = history.data();
  // Step 1's header loses its colour (its codec refuses it); step 2 names a chunk the data lacks.
  const header = data.entries[0].before.hair![0];
  const damaged: LookHistoryData = { ...data, chunks: { ...data.chunks, [header]: { strands: 1 } },
    entries: data.entries.map((entry, i) => i === 1 ? { ...entry, before: { hair: ["missing"] } } : { ...entry, scope: "look" as const }) };
  const stored = JSON.parse(JSON.stringify(twoFeatures.writeMemory(twoFeatures.withLookHistory({ hair: { editor: {} } }, damaged))));
  const read = twoFeatures.lookHistory(twoFeatures.readMemory(stored, undefined));
  expect(read.entries).toHaveLength(1);
  expect((LookHistory.fromData(twoFeatures, read).stepParts(0)!.hair as Hair).colour).toBe("#000003");
});

// ---- The platform transaction ----

test("the platform transaction: one step named by the first change, empty ones leave no trace, Escape never creates Redo", () => {
  let content = "a", steps: string[] = [];
  const reverted: string[] = [];
  // Steps are "content:label"; a checkpoint equal to the top step's content adds nothing, as the look history's.
  const host: TransactionHost<number> = {
    checkpoint: () => { if (steps.at(-1)?.split(":")[0] === content) return undefined; steps.push(content); return steps.length; },
    top: () => steps.length || undefined,
    relabel: (step, label) => { steps[step - 1] = `${steps[step - 1].split(":")[0]}:${label.label}`; },
    discard: step => steps.length === step ? (steps.pop(), true) : false,
    revert: step => { reverted.push(content); content = (step === undefined ? steps.at(-1)! : steps.pop()!).split(":")[0]; },
    content: () => content,
  };
  const gesture = HistoryTransaction.open(host, GESTURE_TRANSACTION, () => true);
  content = "b"; gesture.applied(true, () => ({ label: "Move point", actionKind: "gesture.point.replace" }));
  content = "a"; gesture.applied(true, () => ({ label: "Later", actionKind: "x" }));
  gesture.commit();
  // A gesture that changed something keeps its step even when it moved back.
  expect(steps).toEqual(["a:Move point"]);
  steps = [];
  const control = HistoryTransaction.open(host, CONTROL_TRANSACTION, () => true);
  content = "c"; control.applied(true, () => ({ label: "Opacity", actionKind: "layer.setOpacity" }));
  content = "a"; control.commit();
  // A form control back at its start leaves no step.
  expect(steps).toEqual([]);
  const cancelled = HistoryTransaction.open(host, CONTROL_TRANSACTION, () => true);
  content = "d"; cancelled.applied(true, () => ({ label: "Opacity", actionKind: "layer.setOpacity" }));
  cancelled.cancel();
  expect([content, steps, reverted]).toEqual(["a", [], ["d"]]);

  // CORE-42: the top step already holds the start (a gesture moved a point and back), so a checkpoint adds nothing.
  steps = ["a:Move point"];
  const again = HistoryTransaction.open(host, GESTURE_TRANSACTION, () => true);
  expect(again.checkpoint).toBeUndefined();
  content = "e"; again.applied(true, () => ({ label: "Move point", actionKind: "gesture.point.replace" }));
  // Escape restores the start and takes off no step it did not add.
  again.cancel();
  expect([content, steps]).toEqual(["a", ["a:Move point"]]);
  // A kept change is undone by that top step, which takes its name.
  const opacity = HistoryTransaction.open(host, CONTROL_TRANSACTION, () => true);
  content = "f"; opacity.applied(true, () => ({ label: "Opacity", actionKind: "layer.setOpacity" }));
  opacity.commit();
  expect(steps).toEqual(["a:Opacity"]);
  // Undone back to the start, a control without its own step that returns to the start renames nothing.
  content = "a";
  const back = HistoryTransaction.open(host, CONTROL_TRANSACTION, () => true);
  expect(back.checkpoint).toBeUndefined();
  content = "g"; back.applied(true, () => ({ label: "Colour", actionKind: "layer.setColor" }));
  content = "a"; back.commit();
  expect(steps).toEqual(["a:Opacity"]);
});

test("a gesture moved and back, then an opacity edit, then an Escape-cancelled gesture: steps keep their names and Escape removes none (CORE-42)", () => {
  const { app, document } = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const layerId = document.recipe.layers[0].id, u0 = document.recipe.layers[0].points[0].u, start = JSON.stringify(document.recipe);
  const steps = () => app.historyTimeline().steps.map(step => `${step.label}:${step.state}`);
  const gesture = (moves: number[], cancel = false) => {
    app.beginGesture("uv", layerId);
    for (const u of moves) app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u } });
    app.endGesture("uv", cancel);
  };
  // A gesture that changed something keeps its step, even back at its start.
  gesture([u0 + 0.01, u0]);
  expect(steps()).toEqual(["Move point:done"]);
  // Another gesture from there adds no checkpoint (the top step holds the start); Escape keeps that step.
  gesture([u0 + 0.03], true);
  expect(steps()).toEqual(["Move point:done"]);
  expect(JSON.stringify(document.recipe)).toBe(start);
  // An opacity edit is undone by that step, so the step is named after it.
  app.dispatch({ kind: "layer.setOpacity", layerId, opacity: 0.42 });
  expect(steps()).toEqual(["Opacity:done"]);
  expect(app.history().undo?.label).toBe("Opacity");
  app.dispatch({ kind: "recipe.undo" });
  expect(JSON.stringify(document.recipe)).toBe(start);
  expect(steps()).toEqual(["Opacity:undone"]);
  // An Escape-cancelled gesture after the Undo restores the start and leaves Redo available.
  gesture([u0 + 0.02], true);
  expect(document.recipe.layers[0].points[0].u).toBe(u0);
  expect(steps()).toEqual(["Opacity:undone"]);
  expect(app.capability({ kind: "recipe.redo" }).available).toBe(true);
  app.dispatch({ kind: "recipe.redo" });
  expect(document.recipe.layers[0].opacity).toBe(0.42);
});

// ---- Budgets ----

function busyWorkspace(presets: number, depth: number, layers = 8): WorkspaceState {
  const recipe = wideRecipe(layers);
  const variant = (i: number) => ({ ...recipe, layers: recipe.layers.map((layer, l) => l === i % layers ? { ...layer, opacity: (i % 97) / 100 } : layer) });
  const draft = collectionDraft({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Looks",
    presets: Array.from({ length: presets }, (_, i) => ({ id: crypto.randomUUID(), name: `Look ${i + 1}`, revision: 1, recipe: variant(i) })) },
    STUDIO_DOCUMENTS);
  for (const preset of draft.collection.presets) draft.memory[preset.id] = withLiveMemory(undefined,
    { active: 0, selected: 0, history: Array.from({ length: depth }, (_, i) => variant(i)) }, STUDIO_DOCUMENTS);
  draft.selected = draft.collection.presets[0].id;
  const collections: CollectionWorkspace = { ...draft, previous: structuredClone(draft), older: [structuredClone(draft)] };
  return { ...freshWorkspace(recipe), collections };
}

const restoreStored = (encoded: string) => parseWorkspace(JSON.parse(encoded), STUDIO_DOCUMENTS);
/** Each current preset's kept Undo steps after a store and restore. */
const depthOf = (fitted: { encoded: string }) => {
  const collections = restoreStored(fitted.encoded).collections!;
  return collections.collection.presets.map(preset => memoryOf(collections, preset.id).history.length);
};
/** The schemas the stored form keeps the current presets' histories in. */
const historyForms = (encoded: string) => new Set(Object.values(JSON.parse(encoded).collections.memory as
  Record<string, Record<string, { partSchema?: string }>>).flatMap(memory => Object.values(memory).map(entry => entry.partSchema).filter(Boolean)));

test("fitWorkspace keeps the standard form when it fits, switches to the look-level form before dropping steps, then trims in order", () => {
  const state = busyWorkspace(4, 80);
  const standard = fitWorkspace(state, STUDIO_DOCUMENTS);
  expect(standard).toMatchObject({ trimmed: false, overBudget: false, plan: STANDARD_PLAN });
  expect(depthOf(standard)).toEqual([80, PERSISTED_BACKGROUND_HISTORY, PERSISTED_BACKGROUND_HISTORY, PERSISTED_BACKGROUND_HISTORY]);
  expect(historyForms(standard.encoded)).toEqual(new Set(["xfs/eye-makeup-part-1"]));
  // 0 (CORE-39): a little over the whole-part form stores every step in the look-level form instead.
  const levelled = fitWorkspace(state, STUDIO_DOCUMENTS, standard.size - 1);
  expect(levelled).toMatchObject({ trimmed: false, overBudget: false, plan: { ...STANDARD_PLAN, lookLevel: true } });
  expect(depthOf(levelled)).toEqual(depthOf(standard));
  expect(historyForms(levelled.encoded)).toEqual(new Set([LOOK_HISTORY_1]));
  expect(levelled.size).toBeLessThan(standard.size / 2);
  // Both restore to the same histories.
  const recipes = (encoded: string) => { const collections = restoreStored(encoded).collections!;
    return collections.collection.presets.map(preset => historyRecipes(STUDIO_PARTS.lookHistory(collections.memory[preset.id]))); };
  expect(recipes(levelled.encoded)).toEqual(recipes(standard.encoded));
  // 1–2: a little over that gives up other presets' steps first, oldest first, still in the look-level form.
  const tight = fitWorkspace(state, STUDIO_DOCUMENTS, levelled.size - 1);
  expect(tight).toMatchObject({ trimmed: true, overBudget: false, plan: { selected: Infinity, lookLevel: true } });
  expect(tight.plan.background).toBeLessThan(PERSISTED_BACKGROUND_HISTORY);
  // 3: then the selected look's oldest steps, never below the floor while the looks leave room.
  const atFloor = encodeWorkspacePlan(state, { background: 0, selected: MIN_SELECTED_HISTORY, recovery: Infinity, removed: Infinity,
    lookLevel: true }, STUDIO_DOCUMENTS).length;
  const floor = fitWorkspace(state, STUDIO_DOCUMENTS, atFloor + 500);
  expect(floor.plan).toMatchObject({ background: 0, recovery: Infinity, lookLevel: true });
  expect(depthOf(floor)[0]).toBeGreaterThanOrEqual(MIN_SELECTED_HISTORY);
  expect(depthOf(floor)[0]).toBeLessThan(80);
  // Below that, recovery copies go first; the floor holds.
  const noRecovery = fitWorkspace(state, STUDIO_DOCUMENTS, atFloor - 2_000);
  expect(noRecovery.plan).toMatchObject({ background: 0, selected: MIN_SELECTED_HISTORY });
  expect(noRecovery.plan.recovery).toBeLessThan(2);
  // 4–5: recovery copies and removed presets go before the floor; the looks themselves always stay.
  const smallest = fitWorkspace(state, STUDIO_DOCUMENTS, 1);
  expect(smallest).toMatchObject({ minimal: true, overBudget: true, plan: { background: 0, selected: 0, recovery: 0, removed: 0 } });
  expect(restoreStored(smallest.encoded).collections!.collection.presets).toHaveLength(4);
});

test("a search that starts from the previous save's plan finds the same plan as a cold search (CORE-41)", () => {
  const state = busyWorkspace(4, 80);
  const levelled = fitWorkspace(state, STUDIO_DOCUMENTS, fitWorkspace(state, STUDIO_DOCUMENTS).size - 1).size;
  const atFloor = encodeWorkspacePlan(state, { background: 0, selected: MIN_SELECTED_HISTORY, recovery: Infinity, removed: Infinity,
    lookLevel: true }, STUDIO_DOCUMENTS).length;
  const budgets = [levelled - 1, levelled - 3_000, atFloor + 20_000, atFloor + 500, atFloor - 2_000, atFloor - 60_000, 1];
  const plans = budgets.map(budget => fitWorkspace(state, STUDIO_DOCUMENTS, budget).plan);
  for (const budget of budgets) {
    const cold = fitWorkspace(state, STUDIO_DOCUMENTS, budget);
    for (const from of plans) expect(fitWorkspace(state, STUDIO_DOCUMENTS, budget, from)).toEqual(cold);
  }
});

test("a heavy look whose whole-part history cannot keep 10 steps keeps them all in the look-level form (CORE-39)", () => {
  // One 32-layer look with 80 one-layer steps: only the look-level form holds the floor under this budget.
  const state = busyWorkspace(1, 80, 32);
  const floorWhole = encodeWorkspacePlan(state, { background: 0, selected: MIN_SELECTED_HISTORY, recovery: 0, removed: 0 },
    STUDIO_DOCUMENTS).length;
  const fitted = fitWorkspace(state, STUDIO_DOCUMENTS, floorWhole - 1);
  expect(fitted).toMatchObject({ overBudget: false, plan: { lookLevel: true } });
  expect(depthOf(fitted)).toEqual([80]);
  expect(historyForms(fitted.encoded)).toEqual(new Set([LOOK_HISTORY_1]));
  // The code before the look history refuses that form as newer data, so it opens the workspace read-only.
  const stored = JSON.parse(fitted.encoded), selected = stored.collections.selected;
  let error: unknown;
  try { new PreStep4Registry([EYE_MAKEUP as never]).readMemory(stored.collections.memory[selected], undefined); }
  catch (caught) { error = caught; }
  expect((error as { code?: string }).code).toBe("newer_data");
});

test("a reload under budget pressure keeps at least 10 Undo steps of the selected look (gate)", () => {
  const state = busyWorkspace(6, 80, 16);
  const standard = fitWorkspace(state, STUDIO_DOCUMENTS);
  // A budget that holds the looks and a little history in the smaller, look-level form: the older
  // fixed levels kept none of the selected look's steps here, and the whole-part form cannot keep 10.
  const floor = encodeWorkspacePlan(state, { background: 0, selected: MIN_SELECTED_HISTORY, recovery: 0, removed: 0, lookLevel: true },
    STUDIO_DOCUMENTS).length;
  const budget = floor + 2_000;
  expect(budget).toBeLessThan(standard.size / 2);
  expect(encodeWorkspacePlan(state, { background: 0, selected: MIN_SELECTED_HISTORY, recovery: 0, removed: 0 }, STUDIO_DOCUMENTS).length)
    .toBeGreaterThan(budget);
  const storage = new Map<string, string>();
  const writer = new WorkspacePersistence({ storage: { setItem: (key, value) => storage.set(key, value) }, key: "k", writable: true,
    capture: () => state, budget, model: STUDIO_DOCUMENTS });
  writer.activate(); writer.flush();
  expect(writer.snapshot().kind).toBe("nearly-full");
  expect(writer.storedSize()).toBeLessThanOrEqual(budget);
  const loaded = loadWorkspace({ getItem: key => storage.get(key === "xfas.workspace.v1" ? "k" : "none") ?? null }, false, STUDIO_DOCUMENTS);
  expect(loaded.writable).toBe(true);
  const { app } = createTrustedAuthoringCore(loaded.state, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const timeline = app.historyTimeline();
  expect(timeline.steps.length).toBeGreaterThanOrEqual(MIN_SELECTED_HISTORY);
  expect(timeline.trimmed).toBe(true);
  let undone = 0;
  while (app.capability({ kind: "recipe.undo" }).available) { app.dispatch({ kind: "recipe.undo" }); undone++; }
  expect(undone).toBe(timeline.steps.length);
});

test("size benchmark: six presets of 16 layers with 80 steps each stay far under budget in memory and in storage", () => {
  const state = busyWorkspace(6, 80, 16);
  // In memory: every look's history is chunks, not 80 whole recipes.
  const collections = state.collections!;
  const whole = collections.collection.presets.reduce((sum, preset) =>
    sum + memoryOf(collections, preset.id).history.reduce((n, recipe) => n + JSON.stringify(recipe).length, 0), 0);
  const chunked = collections.collection.presets.reduce((sum, preset) =>
    sum + JSON.stringify(STUDIO_PARTS.lookHistory(collections.memory[preset.id])).length, 0);
  expect(chunked).toBeLessThan(whole * .15);
  // Stored in its standard form it fits the browser budget.
  expect(fitWorkspace(state, STUDIO_DOCUMENTS).size).toBeLessThanOrEqual(WORKSPACE_STORAGE_BUDGET);
});

// ---- Async families (CORE-36) ----

test("library requests and file workflows are registered families routed by owner, beside the synchronous table", () => {
  expect(STUDIO_REGISTRY.routeAsync("save")).toMatchObject({ ok: true, qualified: "library/save" });
  expect(STUDIO_REGISTRY.routeAsync("package.build")).toMatchObject({ ok: true, qualified: "files/package.build" });
  expect(STUDIO_REGISTRY.route("save")).toMatchObject({ ok: false, code: "unknown_action" });
  expect(STUDIO_REGISTRY.routeAsync("layer.setColor")).toMatchObject({ ok: false });
  const { app } = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  // Before a library and files exist, both answer as their services would ("still loading").
  expect(app.requestCapability({ kind: "save" })).toMatchObject({ available: false, code: "not_ready" });
  expect(app.fileCapability({ kind: "recipe.export" })).toMatchObject({ available: false, code: "not_ready" });
  // A kind of the other family, or a synchronous kind, is not a request.
  expect(app.requestCapability({ kind: "recipe.export" } as never)).toMatchObject({ available: false, reason: "Unknown command." });
  expect(app.capability({ kind: "save" } as never)).toMatchObject({ available: false, reason: "Unknown command." });
});

test("the document model keeps sparse looks: a look without history stores no look memory", () => {
  const model: DocumentModel = STUDIO_DOCUMENTS;
  expect(withLiveMemory(undefined, { active: 0, selected: 0, history: [] }, model)).toEqual({ [EYE]: { editor: { active: 0, selected: 0 } } });
});

test("every feature action and gesture names its Undo step through the registry (spec.label)", () => {
  for (const [kind, spec] of Object.entries(EYE_MAKEUP.actions)) expect(typeof spec.label, kind).toBe("function");
  expect(EYE_MAKEUP.actions["layer.setOpacity"].label({ kind: "layer.setOpacity", layerId: "l", opacity: .5 }))
    .toEqual({ label: "Opacity", actionKind: "layer.setOpacity", layerId: "l" });
  expect(EYE_MAKEUP.gestures!.label!({ kind: "point.replace", layerId: "l" } as never)).toMatchObject({ label: "Move point" });
  expect(Object.keys(EYE_MAKEUP.gestures!.descriptors!)).toEqual(["shape.replace", "point.replace", "field.replace", "path.replacePoints"]);
});
