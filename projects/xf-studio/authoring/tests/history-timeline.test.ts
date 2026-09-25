import { expect, test } from "bun:test";
import { HISTORY_START_ID } from "../src/authoring-history";
import { collectionDraft, parseCollectionWorkspace, withLiveMemory } from "../src/collection-workspace";
import { memoryOf } from "./fixtures/looks";
import { RECIPE_HISTORY_LIMIT, RecipeHistory } from "../src/editor-actions";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { encodeWorkspaceForStorage, PERSISTED_BACKGROUND_HISTORY } from "../src/workspace-budget";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";

// The History panel's read model and its single jump action (history.jumpTo).

function fixture(history = freshWorkspace().history) {
  const workspace = { ...freshWorkspace(), history };
  let resets = 0;
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => { resets++; }, selectedCollection: () => "draft" });
  return { ...core, resets: () => resets };
}
/** Three labelled edits: Colour, Opacity, Rename layer. Returns the look after each one. */
function threeEdits(core: ReturnType<typeof fixture>) {
  const { app, document } = core, id = document.recipe.layers[0].id;
  const looks = [JSON.stringify(document.recipe)];
  expect(app.dispatch({ kind: "layer.setColor", layerId: id, color: "#112233" }).ok).toBe(true);
  looks.push(JSON.stringify(document.recipe));
  expect(app.dispatch({ kind: "layer.setOpacity", layerId: id, opacity: .3 }).ok).toBe(true);
  looks.push(JSON.stringify(document.recipe));
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "rename", id, name: "Wing" } }).ok).toBe(true);
  looks.push(JSON.stringify(document.recipe));
  return { id, looks };
}

test("the history snapshot lists labelled steps oldest first with stable ids and the current position", () => {
  const core = fixture(), { app } = core;
  expect(app.historyTimeline()).toEqual({ startId: HISTORY_START_ID, steps: [], current: -1, redoCount: 0, trimmed: false });
  const { id } = threeEdits(core);
  const timeline = app.historyTimeline();
  expect(timeline.steps.map(step => [step.label, step.actionKind, step.state])).toEqual([
    ["Colour", "layer.setColor", "done"], ["Opacity", "layer.setOpacity", "done"], ["Rename layer", "layer.edit.rename", "done"]]);
  expect(timeline.steps.every(step => step.layerId === id && typeof step.at === "number")).toBe(true);
  expect(new Set(timeline.steps.map(step => step.id)).size).toBe(3);
  expect(timeline.steps.every(step => typeof step.id === "string" && step.id !== HISTORY_START_ID)).toBe(true);
  expect(timeline).toMatchObject({ current: 2, redoCount: 0, trimmed: false });
  // Detached and recipe-free.
  expect(JSON.stringify(timeline)).not.toContain("layers");
  timeline.steps[0].label = "Changed";
  expect(app.historyTimeline().steps[0].label).toBe("Colour");
  // Single Undo/Redo keep each step's identity; undone steps follow the current one.
  const ids = timeline.steps.map(step => step.id);
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(app.historyTimeline()).toMatchObject({ current: 1, redoCount: 1 });
  expect(app.historyTimeline().steps.map(step => [step.id, step.state])).toEqual([[ids[0], "done"], [ids[1], "done"], [ids[2], "undone"]]);
  expect(app.dispatch({ kind: "recipe.redo" }).ok).toBe(true);
  expect(app.historyTimeline().steps.map(step => step.id)).toEqual(ids);
  expect(app.historyTimeline().steps[2].at).toBe(timeline.steps[2].at);
});

test("jumping to an earlier step undoes the steps after it as one change", () => {
  const core = fixture(), { app, document } = core, { looks } = threeEdits(core);
  const ids = app.historyTimeline().steps.map(step => step.id), before = core.resets();
  const changes: string[] = [];
  document.subscribe(change => changes.push(change));
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[0] })).toEqual({ ok: true, result: true });
  expect(JSON.stringify(document.recipe)).toBe(looks[1]);
  // One recipe publication and one renderer reset for the whole jump.
  expect(changes.filter(change => change === "recipe")).toHaveLength(1);
  expect(core.resets() - before).toBe(1);
  const timeline = app.historyTimeline();
  expect(timeline).toMatchObject({ current: 0, redoCount: 2 });
  expect(timeline.steps.map(step => [step.id, step.state])).toEqual([[ids[0], "done"], [ids[1], "undone"], [ids[2], "undone"]]);
  expect(app.history()).toMatchObject({ undo: { label: "Colour" }, redo: { label: "Opacity" }, depth: 1, redoDepth: 2 });
  // Single Redo continues from there.
  expect(app.dispatch({ kind: "recipe.redo" }).ok).toBe(true);
  expect(JSON.stringify(document.recipe)).toBe(looks[2]);
});

test("jumping to a later step redoes up to it, and the start id undoes everything kept", () => {
  const core = fixture(), { app, document } = core, { looks } = threeEdits(core);
  const ids = app.historyTimeline().steps.map(step => step.id);
  expect(app.dispatch({ kind: "history.jumpTo", entryId: HISTORY_START_ID }).ok).toBe(true);
  expect(JSON.stringify(document.recipe)).toBe(looks[0]);
  expect(app.historyTimeline()).toMatchObject({ current: -1, redoCount: 3 });
  expect(app.capability({ kind: "recipe.undo" }).available).toBe(false);
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[1] }).ok).toBe(true);
  expect(JSON.stringify(document.recipe)).toBe(looks[2]);
  expect(app.historyTimeline().steps.map(step => [step.id, step.state])).toEqual([[ids[0], "done"], [ids[1], "done"], [ids[2], "undone"]]);
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[2] }).ok).toBe(true);
  expect(JSON.stringify(document.recipe)).toBe(looks[3]);
  expect(app.historyTimeline()).toMatchObject({ current: 2, redoCount: 0 });
  // Undo walks the same steps back in order.
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(JSON.stringify(document.recipe)).toBe(looks[2]);
  expect(app.consequences({ action: { kind: "history.jumpTo", entryId: ids[0] } }))
    .toEqual({ replaces: "layer-content", discards: [], recoverableBy: "recipe.redo", confirm: false });
  expect(app.consequences({ action: { kind: "history.jumpTo", entryId: ids[2] } }).recoverableBy).toBe("recipe.undo");
});

test("jumps are refused for the current step, unknown ids and during an open adjustment", () => {
  const core = fixture(), { app, document } = core, { id } = threeEdits(core);
  const ids = app.historyTimeline().steps.map(step => step.id), look = JSON.stringify(document.recipe);
  expect(app.capability({ kind: "history.jumpTo", entryId: ids[2] })).toMatchObject({ available: false, code: "invalid_value" });
  expect(app.capability({ kind: "history.jumpTo", entryId: "step-999999" })).toMatchObject({ available: false, code: "missing_target" });
  expect(app.capability({ kind: "history.jumpTo" } as never)).toMatchObject({ available: false, code: "needs_input" });
  expect(app.dispatch({ kind: "history.jumpTo", entryId: "nope" }).ok).toBe(false);
  // A form transaction owns the history while it is open.
  expect(app.controlBegin("opacity", id)).toBe(true);
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .8 }).ok).toBe(true);
  expect(app.capability({ kind: "history.jumpTo", entryId: ids[0] })).toMatchObject({ available: false, code: "busy" });
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[0] }).ok).toBe(false);
  app.controlCancel("opacity");
  expect(JSON.stringify(document.recipe)).toBe(look);
  // So does a pointer gesture.
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.capability({ kind: "history.jumpTo", entryId: ids[0] })).toMatchObject({ available: false, code: "busy" });
  app.endGesture("uv", true);
  expect(app.capability({ kind: "history.jumpTo", entryId: ids[0] }).available).toBe(true);
});

test("a new edit after a jump back discards the undone steps, as Redo does", () => {
  const core = fixture(), { app } = core, { id } = threeEdits(core);
  const ids = app.historyTimeline().steps.map(step => step.id);
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[0] }).ok).toBe(true);
  expect(app.dispatch({ kind: "layer.setSymmetry", layerId: id, symmetry: false }).ok).toBe(true);
  const timeline = app.historyTimeline();
  expect(timeline.steps.map(step => step.label)).toEqual(["Colour", "Mirroring"]);
  expect(timeline).toMatchObject({ current: 1, redoCount: 0 });
  expect(app.capability({ kind: "history.jumpTo", entryId: ids[2] })).toMatchObject({ available: false, code: "missing_target" });
  expect(app.capability({ kind: "recipe.redo" }).available).toBe(false);
});

test("a preset switch or restore gives a fresh history whose ids never match the old ones", () => {
  const core = fixture(), { app, document } = core;
  threeEdits(core);
  const old = app.historyTimeline().steps.map(step => step.id);
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  document.restore(document.export());
  const fresh = app.historyTimeline();
  // Restored entries have no session labels, times or Redo.
  expect(fresh.steps.map(step => [step.label, step.at])).toEqual([["Earlier change", undefined], ["Earlier change", undefined]]);
  expect(fresh.redoCount).toBe(0);
  expect(fresh.steps.some(step => old.includes(step.id))).toBe(false);
  for (const entryId of old) expect(app.capability({ kind: "history.jumpTo", entryId }).available).toBe(false);
});

test("the trimmed flag follows the history limit and survives the workspace's budget trimming", () => {
  const base = freshWorkspace();
  const full = Array.from({ length: RECIPE_HISTORY_LIMIT }, (_, i) => {
    const recipe = structuredClone(base.recipe); recipe.layers[0].opacity = (i + 1) / 200; return recipe;
  });
  const core = fixture(full), { app, document } = core, id = document.recipe.layers[0].id;
  expect(app.historyTimeline()).toMatchObject({ trimmed: false, current: RECIPE_HISTORY_LIMIT - 1 });
  expect(app.dispatch({ kind: "layer.setColor", layerId: id, color: "#445566" }).ok).toBe(true);
  expect(app.historyTimeline()).toMatchObject({ trimmed: true, current: RECIPE_HISTORY_LIMIT - 1 });
  expect(document.export().historyTrimmed).toBe(true);
  // Undoing the step that pushed the oldest out brings it back.
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(app.historyTimeline().trimmed).toBe(false);
  expect("historyTrimmed" in document.export()).toBe(false);
  // Redo at the limit displaces it again; a multi-step jump behaves like the same single steps.
  expect(app.dispatch({ kind: "recipe.redo" }).ok).toBe(true);
  expect(app.historyTimeline().trimmed).toBe(true);
  const steps = app.historyTimeline().steps;
  expect(app.dispatch({ kind: "history.jumpTo", entryId: steps[steps.length - 4].id }).ok).toBe(true);
  expect(app.historyTimeline()).toMatchObject({ trimmed: false, redoCount: 3 });
  expect(app.dispatch({ kind: "history.jumpTo", entryId: app.historyTimeline().steps.at(-1)!.id }).ok).toBe(true);
  expect(app.historyTimeline()).toMatchObject({ trimmed: true, redoCount: 0, current: RECIPE_HISTORY_LIMIT - 1 });

  // More than the limit, or an explicit flag, restores as trimmed.
  expect(new RecipeHistory([...full, base.recipe]).trimmed).toBe(true);
  expect(new RecipeHistory(full.slice(0, 3), true).trimmed).toBe(true);
  expect(new RecipeHistory(full).trimmed).toBe(false);
});

test("stored copies mark presets whose Undo history the budget shortened", () => {
  const base = freshWorkspace(), recipe = base.recipe;
  const history = Array.from({ length: 12 }, (_, i) => { const r = structuredClone(recipe); r.layers[0].opacity = (i + 1) / 20; return r; });
  const draft = collectionDraft({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Looks",
    presets: ["A", "B"].map(name => ({ id: crypto.randomUUID(), name, revision: 1, recipe })) });
  const [a, b] = draft.collection.presets;
  draft.selected = a.id;
  draft.memory[a.id] = withLiveMemory(undefined, { active: 0, selected: 0, history });
  draft.memory[b.id] = withLiveMemory(undefined, { active: 0, selected: 0, history });
  const restored = parseWorkspace(JSON.parse(encodeWorkspaceForStorage({ ...base, history, collections: draft }).encoded));
  // The selected preset keeps everything; the other keeps the latest few and says so.
  expect(restored.historyTrimmed).toBeUndefined();
  expect(memoryOf(restored.collections!, a.id)).not.toHaveProperty("historyTrimmed");
  expect(memoryOf(restored.collections!, b.id)).toMatchObject({ historyTrimmed: true });
  expect(memoryOf(restored.collections!, b.id).history).toHaveLength(PERSISTED_BACKGROUND_HISTORY);
  // Switching to it in a new session shows "Older steps were not kept".
  const core = fixture();
  core.document.restore({ recipe, ...memoryOf(restored.collections!, b.id), fieldSelection: {} });
  expect(core.app.historyTimeline()).toMatchObject({ trimmed: true, current: PERSISTED_BACKGROUND_HISTORY - 1 });
  // The flag is tolerant: anything but true reads as not trimmed.
  const eye = draft.memory[a.id]["eye-makeup"];
  const parsed = parseCollectionWorkspace({ ...draft, memory: { [a.id]: { "eye-makeup": { ...eye, historyTrimmed: "yes" } },
    [b.id]: draft.memory[b.id] } });
  expect(memoryOf(parsed, a.id)).not.toHaveProperty("historyTrimmed");
});

test("the presentation port publishes the timeline without the live history", async () => {
  const { createStudioPresentation } = await import("../src/studio-presentation");
  const core = fixture();
  threeEdits(core);
  const port = createStudioPresentation({ authoring: core.app, library: {} as never, files: {} as never,
    viewport: {} as never, preferences: {} as never, previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} } });
  const timeline = port.authoring.historyTimeline();
  expect(timeline.steps).toHaveLength(3);
  (timeline.steps as { label: string }[]).length = 0;
  expect(port.authoring.historyTimeline().steps).toHaveLength(3);
  expect(port.authoring.dispatch({ kind: "history.jumpTo", entryId: timeline.startId }).ok).toBe(true);
  expect(port.authoring.historyTimeline()).toMatchObject({ current: -1, redoCount: 3 });
});

test("an adjustment cancelled with Escape keeps the undone steps; reading history never discards them", () => {
  const core = fixture(), { app, document } = core, { id, looks } = threeEdits(core);
  const ids = app.historyTimeline().steps.map(step => step.id);
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[0] }).ok).toBe(true);
  expect(app.controlBegin("opacity", id)).toBe(true);
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .9 }).ok).toBe(true);
  // While the adjustment is open its own entry is current and nothing can be redone.
  expect(app.historyTimeline()).toMatchObject({ redoCount: 0 });
  expect(app.history().redoDepth).toBe(0);
  app.controlCancel("opacity");
  expect(JSON.stringify(document.recipe)).toBe(looks[1]);
  expect(app.historyTimeline().steps.map(step => [step.id, step.state])).toEqual([[ids[0], "done"], [ids[1], "undone"], [ids[2], "undone"]]);
  expect(app.dispatch({ kind: "history.jumpTo", entryId: ids[2] }).ok).toBe(true);
  expect(JSON.stringify(document.recipe)).toBe(looks[3]);
  // A committed adjustment is a new step and discards them for good.
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(app.controlBegin("opacity", id)).toBe(true);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .9 });
  app.controlCommit("opacity");
  expect(app.historyTimeline().steps.map(step => step.label)).toEqual(["Colour", "Opacity", "Opacity"]);
  expect(app.historyTimeline().redoCount).toBe(0);
  expect(app.capability({ kind: "history.jumpTo", entryId: ids[2] })).toMatchObject({ code: "missing_target" });
});
