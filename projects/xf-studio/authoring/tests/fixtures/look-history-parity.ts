/**
 * What a person can observe of Undo, Redo and History (feature-module platform §3, migration step 4),
 * read only through interfaces that exist before and after the look history: `loadWorkspace`,
 * `createTrustedAuthoringCore` and its application (dispatch, form controls, gestures, the timeline),
 * the collection command boundary and the standard stored form (`encodeWorkspaceAt` level 0).
 *
 * `tests/golden/look-history-parity.json` was captured with this observer from the code before the
 * look history (`0885ba6`, by `capture-look-history-golden.ts`); the look history must match it.
 * Step IDs are opaque, so they are compared by first appearance; times are session clocks and are
 * compared only for presence.
 */
import { CollectionActions } from "../../src/collection-actions";
import type { HistorySnapshot } from "../../src/authoring-history";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../../src/trusted-authoring-core";
import { encodeWorkspaceAt } from "../../src/workspace-budget";
import type { WorkspaceState } from "../../src/workspace-state";
import { digest, restore } from "./workspace-observable";

type Core = ReturnType<typeof createTrustedAuthoringCore>;

/** A trusted core over a restored workspace, with its collection boundary wired as the app wires it. */
export function studio(state: WorkspaceState) {
  let n = 0;
  const core = createTrustedAuthoringCore(state, { resetStack: () => {}, selectedCollection: () => "draft",
    newId: () => `step4-${++n}` }, STUDIO_COMPOSITION);
  const actions = state.collections ? new CollectionActions(STUDIO_DOCUMENTS, state.collections, () => core.document.export(),
    editor => core.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} })) : undefined;
  return { core, actions };
}

/** Step IDs by first appearance, so two runs compare although IDs are session-unique. */
export class Ids {
  private seen = new Map<string, number>();
  of(id: string) { if (!this.seen.has(id)) this.seen.set(id, this.seen.size); return this.seen.get(id)!; }
}

export function timeline(value: HistorySnapshot, ids: Ids) {
  return { start: value.startId, current: value.current, redoCount: value.redoCount, trimmed: value.trimmed,
    steps: value.steps.map(step => ({ ...step, id: ids.of(step.id), at: step.at === undefined ? "none" : "set" })) };
}

/** Everything the History panel, the menus and the look show at one moment. */
export function moment(core: Core, ids: Ids) {
  const { app, document } = core;
  const history = app.history();
  return { recipe: digest(document.recipe), active: document.active, selected: document.selected,
    history, timeline: timeline(app.historyTimeline(), ids),
    undo: app.capability({ kind: "history.undo" }), redo: app.capability({ kind: "history.redo" }) };
}

/**
 * The whole history of the current look: every Undo to the oldest kept state, every Redo back, a
 * jump to the start and a jump back to the last step, each with what it shows.
 */
export function walk(core: Core) {
  const ids = new Ids(), { app } = core, seen = [moment(core, ids)];
  while (app.capability({ kind: "history.undo" }).available) { app.dispatch({ kind: "history.undo" }); seen.push(moment(core, ids)); }
  while (app.capability({ kind: "history.redo" }).available) { app.dispatch({ kind: "history.redo" }); seen.push(moment(core, ids)); }
  const last = app.historyTimeline().steps.at(-1)?.id;
  const jump = (entryId: string) => ({ ok: app.dispatch({ kind: "history.jumpTo", entryId }).ok, after: moment(core, ids) });
  const jumps = [jump(app.historyTimeline().startId), ...(last ? [jump(last)] : [])];
  return { states: digest(seen), count: seen.length, first: seen[0].timeline, jumps: digest(jumps) };
}

/** Every look of a restored workspace: the loose editor or each preset, restored presets and recovery drafts. */
export function observeHistories(state: WorkspaceState) {
  const { core, actions } = studio(state);
  if (!actions) return { loose: walk(core) };
  const presets = () => actions.summary().presets.map(preset => {
    actions.dispatch({ kind: "preset.select", id: preset.id });
    return { id: preset.id, walk: walk(core) };
  });
  const drafts = [presets()], restored: unknown[] = [];
  while (actions.summary().removed.length) {
    actions.dispatch({ kind: "preset.edit", command: { kind: "restore" } });
    restored.push(walk(core));
  }
  const recovery = actions.summary().recoveryCount;
  for (let i = 0; i < recovery; i++) { actions.dispatch({ kind: "collection.undoOpen" }); drafts.push(presets()); }
  return { drafts, restored };
}

/** The standard stored form (what the workspace writes when it fits its budget) and what it restores. */
export function observeStored(state: WorkspaceState) {
  const stored = encodeWorkspaceAt(state, 0, STUDIO_DOCUMENTS);
  const again = restore(stored.encoded);
  if (!again.writable) throw Error(again.error);
  return { size: stored.size, text: digest(stored.encoded), histories: digest(observeHistories(again.state)) };
}

/**
 * A scripted session on a restored workspace: dispatched edits, a form-control transaction (committed
 * and cancelled), a gesture (committed and cancelled), Undo, Redo and history jumps, a Redo discarded
 * by an edit, preset switches with Undo across a preset add and remove, and a reload of the stored form.
 */
export function session(stored: unknown) {
  const loaded = restore(stored);
  if (!loaded.writable) throw Error(loaded.error);
  const { core, actions } = studio(loaded.state), { app, document } = core, ids = new Ids();
  const log: { step: string; result?: unknown; moment: ReturnType<typeof moment> }[] = [];
  const record = (step: string, result?: unknown) => log.push({ step, ...(result === undefined ? {} : { result }), moment: moment(core, ids) });
  const layer = () => document.recipe.layers[document.active] ?? document.recipe.layers[0];
  record("restored");
  record("opacity", app.dispatch({ kind: "layer.setOpacity", layerId: layer().id, opacity: .41 }));
  record("colour", app.dispatch({ kind: "layer.setColor", layerId: layer().id, color: "#3355aa" }));
  record("add layer", app.dispatch({ kind: "layer.edit", command: { kind: "add" } }));
  record("rename", app.dispatch({ kind: "layer.edit", command: { kind: "rename", id: layer().id, name: "Step four" } }));
  const id = layer().id;
  record("control begin", app.controlBegin("opacity", id));
  record("control edit 1", app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .2 }));
  record("control edit 2", app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .25 }));
  record("undo inside control", app.capability({ kind: "history.undo" }));
  app.controlCommit("opacity"); record("control commit");
  record("cancelled control begin", app.controlBegin("opacity", id));
  record("cancelled control edit", app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .9 }));
  app.controlCancel("opacity"); record("control cancel (Esc)");
  record("empty control", app.controlBegin("colour", id)); app.controlCommit("colour"); record("empty control commit");
  const point = () => document.recipe.layers.find(item => item.id === id)!.points[0];
  record("gesture begin", app.beginGesture("uv", id));
  record("gesture frame 1", app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: point().u + .003 } }));
  record("gesture frame 2", app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: point().u + .002 } }));
  record("undo inside gesture", app.capability({ kind: "history.undo" }));
  app.endGesture("uv"); record("gesture commit");
  record("cancelled gesture begin", app.beginGesture("surface", id));
  record("cancelled gesture frame", app.applyGesture("surface", { kind: "point.replace", index: 0, next: { v: point().v + .004 } }));
  app.endGesture("surface", true); record("gesture cancel (Esc)");
  record("empty gesture", app.beginGesture("uv", id)); app.endGesture("uv"); record("empty gesture end");
  record("undo 1", app.dispatch({ kind: "history.undo" }));
  record("undo 2", app.dispatch({ kind: "history.undo" }));
  record("redo 1", app.dispatch({ kind: "history.redo" }));
  record("undo 3", app.dispatch({ kind: "history.undo" }));
  // A cancelled transaction hides Redo while it is open and brings it back.
  record("control over redo", app.controlBegin("opacity", id));
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .66 });
  app.controlCancel("opacity"); record("control over redo cancelled");
  const steps = () => app.historyTimeline().steps;
  record("jump to start", app.dispatch({ kind: "history.jumpTo", entryId: app.historyTimeline().startId }));
  record("jump to the middle", app.dispatch({ kind: "history.jumpTo", entryId: steps()[Math.floor(steps().length / 2)].id }));
  record("jump to last", app.dispatch({ kind: "history.jumpTo", entryId: steps().at(-1)!.id }));
  record("jump to current", app.dispatch({ kind: "history.jumpTo", entryId: steps()[app.historyTimeline().current]?.id ?? "start" }));
  record("undo 4", app.dispatch({ kind: "history.undo" }));
  record("edit discards redo", app.dispatch({ kind: "layer.setSymmetry", layerId: id, symmetry: false }));
  record("redo refused", app.dispatch({ kind: "history.redo" }));
  if (actions) {
    const home = actions.summary().selected!;
    actions.dispatch({ kind: "preset.edit", command: { kind: "add" } }); record("preset add");
    const added = actions.summary().selected!;
    record("undo in the new preset", app.dispatch({ kind: "history.undo" }));
    record("edit the new preset", app.dispatch({ kind: "layer.edit", command: { kind: "add" } }));
    actions.dispatch({ kind: "preset.select", id: home }); record("back to the first preset");
    record("undo across the add", app.dispatch({ kind: "history.undo" }));
    record("redo there", app.dispatch({ kind: "history.redo" }));
    actions.dispatch({ kind: "preset.edit", command: { kind: "remove", id: added } }); record("remove the added preset");
    record("undo after the remove", app.dispatch({ kind: "history.undo" }));
    actions.dispatch({ kind: "preset.edit", command: { kind: "restore" } }); record("restore the removed preset");
    record("undo in the restored preset", app.dispatch({ kind: "history.undo" }));
    actions.dispatch({ kind: "preset.select", id: home }); record("home again");
  }
  // Reload: the workspace as the browser captures it, stored in its standard form and restored (the
  // added preset's ID is random, so the stored text itself is not compared).
  const captured: WorkspaceState = { ...loaded.state, ...document.export(), collections: actions?.snapshot() ?? loaded.state.collections };
  const stored2 = encodeWorkspaceAt(captured, 0, STUDIO_DOCUMENTS);
  const reloaded = restore(stored2.encoded);
  const again = studio(reloaded.state);
  const reloadIds = new Ids();
  return { log: log.map(entry => ({ step: entry.step, result: entry.result === undefined ? null : entry.result,
    moment: entry.moment })),
    reload: { writable: reloaded.writable, moment: moment(again.core, reloadIds), walk: walk(again.core) } };
}
