/**
 * Cost of the look history (migration step 4) on the large workspace fixture, through interfaces that
 * exist before and after it, so the same script runs on both checkouts:
 *   bun tests/fixtures/bench-look-history.ts
 * Prints medians in milliseconds and sizes in UTF-16 code units.
 */
import { CollectionActions } from "../../src/collection-actions";
import { copyWorkspace } from "../../src/collection-workspace";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../../src/trusted-authoring-core";
import { encodeWorkspaceAt } from "../../src/workspace-budget";
import { restore } from "./workspace-observable";
import { largeWorkspaceV1 } from "./workspace-v1-fixtures";

const median = (runs: number, work: () => void) => {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) { const start = performance.now(); work(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)] * 1000) / 1000;
};

const layers = Number(process.argv[2] ?? 16);
const fixture = largeWorkspaceV1(layers, 80);
const first = restore(fixture).state;
const stored = encodeWorkspaceAt(first, 0, STUDIO_DOCUMENTS).encoded;
const results: Record<string, number> = {};
results.storedSize = stored.length;
results.restore = median(15, () => restore(stored));
const state = restore(stored).state;
results.encode = median(15, () => encodeWorkspaceAt(state, 0, STUDIO_DOCUMENTS));
results.draftCopy = median(15, () => copyWorkspace(state.collections!));
results.draftUnits = JSON.stringify(state.collections).length;

// Every preset with a full in-session history: select each once so the live editor's history is kept per look.
const core = createTrustedAuthoringCore(state, { resetStack: () => {}, selectedCollection: () => "draft", newId: (() => { let n = 0; return () => `b${++n}`; })() },
  STUDIO_COMPOSITION);
const actions = new CollectionActions(STUDIO_DOCUMENTS, state.collections!, () => core.document.export(),
  editor => core.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }));
const presets = actions.summary().presets.map(preset => preset.id);
let turn = 0;
results.presetSwitch = median(21, () => actions.dispatch({ kind: "preset.select", id: presets[turn++ % presets.length] }));
actions.dispatch({ kind: "preset.select", id: presets[2] });
const layerId = core.document.recipe.layers[1].id;
let opacity = 0;
results.dispatchOpacity = median(51, () => core.app.dispatch({ kind: "layer.setOpacity", layerId, opacity: (opacity++ % 90) / 100 + .05 }));
results.gesture = median(51, () => {
  core.app.beginGesture("uv", layerId);
  const point = core.document.recipe.layers.find(layer => layer.id === layerId)!.points[0];
  core.app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: point.u + .0005 } });
  core.app.endGesture("uv");
});
results.undoRedo = median(51, () => { core.app.dispatch({ kind: "history.undo" }); core.app.dispatch({ kind: "history.redo" }); });
results.jump40 = median(11, () => {
  const steps = core.app.historyTimeline().steps;
  core.app.dispatch({ kind: "history.jumpTo", entryId: steps[steps.length - 41].id });
  core.app.dispatch({ kind: "history.jumpTo", entryId: core.app.historyTimeline().steps.at(-1)!.id });
});
results.snapshot = median(15, () => actions.snapshot());
console.log(JSON.stringify(results));
