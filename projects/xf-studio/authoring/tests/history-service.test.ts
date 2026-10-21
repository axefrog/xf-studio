/**
 * The history service (`platform/core/history-service.ts`): scoped stacks, focus routing, Redo validity, moves that apply once,
 * refused replays, coalescing, transactions and the limit, over plain targets. The Studio's own scopes are compared with the
 * code before the service in history-parity.test.ts.
 */
import { expect, test } from "bun:test";
import { HISTORY_LIMIT, type HistoryLabel, type HistoryTarget } from "../src/platform/api/history";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { createHistoryService, LOOK_SCOPE, VIEW_SCOPE } from "../src/platform/core/history-service";
import { CONTROL_TRANSACTION, GESTURE_TRANSACTION } from "../src/platform/core/history-transaction";
import { createStudioViewGraph } from "../src/preview-view-graph";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { DEFAULT_CREATOR_LIGHTING } from "../src/creator-lighting";
import { freshWorkspace } from "./fixtures/eye-region";

const label = (text: string): HistoryLabel => ({ label: text, actionKind: text });

/** A target over a record of values, counting how often moves are applied; `refuse` makes the next apply inconsistent. */
function store(initial: Record<string, unknown>, options: { content?: boolean } = {}) {
  const values: Record<string, unknown> = { ...initial };
  let revision = 0, applies = 0, refuse = false;
  const target: HistoryTarget = {
    read: key => values[key],
    apply: next => {
      if (refuse) { refuse = false; return false; }
      applies++;
      for (const [key, value] of Object.entries(next)) if (value === undefined) delete values[key]; else values[key] = value;
      revision++;
      return true;
    },
    ...(options.content ? { revision: () => revision, fingerprint: keys => JSON.stringify((keys ?? Object.keys(values).sort()).map(key => values[key])) } : {}),
  };
  return { values, target, set(key: string, value: unknown) { values[key] = value; revision++; }, applies: () => applies, refuseNext() { refuse = true; } };
}

test("scopes are isolated and global Undo goes to the focused one; a document is focused only while its experiment offers it", () => {
  const service = createHistoryService(), look = store({ a: 1 }), view = store({ n: 1 });
  const lookScope = service.open(LOOK_SCOPE, look.target), viewScope = service.open(VIEW_SCOPE, view.target);
  lookScope.checkpoint(["a"], label("A")); look.set("a", 2);
  viewScope.checkpoint(["n"], label("N")); view.set("n", 2);
  expect(service.focused()).toBe(lookScope);
  service.documents.record("hair:g", "Hair Lab", { id: "g1", ...label("Hair length") }, { before: 1, after: 2 });
  expect(service.documents.selected()).toBe("hair:g");
  // Recorded and selected, but no experiment offers it: Undo stays with the look.
  expect(service.focused()).toBe(lookScope);
  const offered = new Set(["hair:g"]);
  const off = service.participants(() => [...offered].map(id => ({ id, dispatch: () => true })));
  expect(service.focused().id).toBe("doc:hair:g");
  expect(service.focused().timeline()).toMatchObject({ startId: "hair:g:start", documentLabel: "Hair Lab", steps: [{ id: "g1", label: "Hair length" }] });
  offered.clear();
  expect(service.focused()).toBe(lookScope);
  off();
  // Each scope moves on its own.
  expect(viewScope.undo()).toBe(true);
  expect([look.values.a, view.values.n]).toEqual([2, 1]);
  expect(lookScope.state()).toMatchObject({ undo: label("A"), depth: 1 });
});

test("a step kept in the look's history returns global Undo to the look; a cancelled one leaves the focus where it was", () => {
  const service = createHistoryService(), look = store({ a: 1 }, { content: true }), scope = service.open(LOOK_SCOPE, look.target);
  const focusDocument = () => service.documents.focus("hair:g");
  focusDocument();
  const cancelled = scope.begin(["a"], CONTROL_TRANSACTION);
  look.set("a", 5); cancelled.applied(true, () => label("A"));
  cancelled.cancel();
  expect(service.documents.selected()).toBe("hair:g");
  const kept = scope.begin(["a"], CONTROL_TRANSACTION);
  look.set("a", 6); kept.applied(true, () => label("A"));
  kept.commit();
  expect(service.documents.selected()).toBeNull();
  focusDocument();
  scope.checkpoint(["a"], label("B")); look.set("a", 7);
  expect(service.documents.selected()).toBeNull();
  // The View and lighting history is not the look's: its steps leave the focus alone.
  focusDocument();
  service.open(VIEW_SCOPE, store({ n: 0 }).target).checkpoint(["n"], label("N"));
  expect(service.documents.selected()).toBe("hair:g");
});

test("Redo is valid only while the content is what the last move left (CORE-46); a step hides it and a cancelled one brings it back", () => {
  const service = createHistoryService(), look = store({ a: 1 }, { content: true }), scope = service.open(LOOK_SCOPE, look.target);
  scope.checkpoint(["a"], label("A")); look.set("a", 2);
  expect(scope.undo()).toBe(true);
  expect(scope.canRedo()).toBe(true);
  // An open transaction's checkpoint hides Redo; cancelling it brings Redo back.
  const open = scope.begin(["a"], GESTURE_TRANSACTION);
  expect(scope.canRedo()).toBe(false);
  open.cancel();
  expect(scope.canRedo()).toBe(true);
  // A republish of the same content keeps it; a change that records no step hides it, and the next move discards it.
  look.set("a", 1);
  expect(scope.canRedo()).toBe(true);
  look.set("a", 9);
  expect(scope.capability({ kind: "history.redo" })).toMatchObject({ available: false, reason: "There is no undone change to redo." });
  expect(scope.redo()).toBe(false);
  look.set("a", 1);
  expect(scope.canRedo()).toBe(false);
});

test("a jump applies once, however many steps it crosses, and keeps every step reachable", () => {
  const service = createHistoryService(), look = store({ a: 0 }), scope = service.open(LOOK_SCOPE, look.target);
  for (let i = 1; i <= 5; i++) { scope.checkpoint(["a"], label(`Step ${i}`)); look.set("a", i); }
  const timeline = scope.timeline();
  expect(scope.plan(timeline.startId)).toEqual({ direction: "undo", count: 5 });
  expect(scope.jumpTo(timeline.startId)).toBe(true);
  expect([look.values.a, look.applies()]).toEqual([0, 1]);
  expect(scope.jumpTo(timeline.steps[2].id)).toBe(true);
  expect([look.values.a, look.applies()]).toEqual([3, 2]);
  expect(scope.capability({ kind: "history.jumpTo", entryId: timeline.steps[2].id })).toMatchObject({ available: false, reason: "This is already the current step." });
  expect(scope.timeline().steps.map(step => step.state)).toEqual(["done", "done", "done", "undone", "undone"]);
});

test("a move the target refuses drops the scope's steps and changes nothing (CORE-94)", () => {
  const service = createHistoryService(), view = store({ n: 0 }), scope = service.open(VIEW_SCOPE, view.target);
  scope.checkpoint(["n"], label("One")); view.set("n", 1);
  scope.checkpoint(["n"], label("Two")); view.set("n", 2);
  view.refuseNext();
  expect(scope.undo()).toBe(false);
  expect(view.values.n).toBe(2);
  expect(scope.state()).toEqual({ depth: 0, redoDepth: 0 });
});

test("a slider drag coalesces into one step until it is released (CORE-95), in the view graph too", () => {
  const service = createHistoryService(), views = createStudioViewGraph(freshWorkspace().preview, undefined, service);
  const exposure = (value: number) => ({ state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: value } } });
  const shown = () => views.state<{ creatorLighting: { exposure: number } }>(MAIN_VIEW, "lights").creatorLighting.exposure, start = shown();
  for (const value of [1.3, 1.4, 1.5]) views.edit(MAIN_VIEW, "lights", exposure(value), { label: "Exposure", coalesce: "exposure" });
  expect(service.scope(VIEW_SCOPE)!.state()).toMatchObject({ undo: { label: "Exposure" }, depth: 1 });
  views.seal();
  views.edit(MAIN_VIEW, "lights", exposure(1.6), { label: "Exposure", coalesce: "exposure" });
  expect(views.history().depth).toBe(2);
  views.undo(); views.undo();
  expect(shown()).toBe(start);
});

test("Redo restores what the Undo replaced, including changes no step recorded since the step (camera navigation)", () => {
  const views = createStudioViewGraph(freshWorkspace().preview);
  const orbit = { position: [0.3, 1.6, -0.5], target: [0, 1.6, 0], fov: 30 }, front = { position: [0, 1.67, -0.6], target: [0, 1.67, 0], fov: 30 };
  const moved = { position: [0.1, 1.67, -0.7], target: [0, 1.67, 0], fov: 30 };
  views.cameraJump(MAIN_VIEW, { pose: orbit }, { pose: front }, "Front view");
  views.cameraMoved(MAIN_VIEW, { pose: moved });
  views.undo();
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose: orbit });
  views.redo();
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose: moved });
});

test("a cancelled transaction keeps the step that already held its start and takes off only its own (CORE-42)", () => {
  const service = createHistoryService(), look = store({ a: 0 }, { content: true }), scope = service.open(LOOK_SCOPE, look.target);
  // A gesture that moved and back keeps its step (the gesture policy).
  const moved = scope.begin(["a"], GESTURE_TRANSACTION);
  look.set("a", 1); moved.applied(true, () => label("Move")); look.set("a", 0); moved.applied(true, () => label("Move"));
  moved.commit();
  expect(scope.state().depth).toBe(1);
  // From there the top step already holds the start: the next transaction adds none, and cancelling it removes none.
  const again = scope.begin(["a"], GESTURE_TRANSACTION);
  expect(again.checkpoint).toBeUndefined();
  look.set("a", 3); again.applied(true, () => label("Move"));
  again.cancel();
  expect([look.values.a, scope.state().depth]).toEqual([0, 1]);
  // A kept change names that step.
  const opacity = scope.begin(["a"], CONTROL_TRANSACTION);
  look.set("a", 4); opacity.applied(true, () => label("Opacity"));
  opacity.commit();
  expect(scope.state()).toMatchObject({ undo: label("Opacity"), depth: 1 });
});

test("at the limit a new step displaces the oldest, and undoing it brings that one back", () => {
  const service = createHistoryService(), look = store({ a: 0 }), scope = service.open(LOOK_SCOPE, look.target);
  for (let i = 1; i <= HISTORY_LIMIT + 1; i++) { scope.checkpoint(["a"], label(`Step ${i}`)); look.set("a", i); }
  expect([scope.state().depth, scope.trimmed]).toEqual([HISTORY_LIMIT, true]);
  expect(scope.timeline().steps[0].label).toBe("Step 2");
  scope.undo();
  expect([scope.state().depth, scope.trimmed, scope.timeline().steps[0].label]).toEqual([HISTORY_LIMIT, false, "Step 1"]);
});

test("the trusted core's look, View and lighting history live in the one service it is given", () => {
  const service = createHistoryService();
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft", history: service }, STUDIO_COMPOSITION);
  expect(service.scope(LOOK_SCOPE)).toBe(core.document.history);
  core.app.dispatch({ kind: "layer.setOpacity", layerId: core.document.recipe.layers[0].id, opacity: 0.3 });
  core.views.edit(MAIN_VIEW, "lights", { state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: 2 } } }, { label: "Exposure" });
  expect(service.focused().state()).toMatchObject({ undo: { label: "Opacity" }, depth: 1 });
  expect(service.scope(VIEW_SCOPE)!.state()).toMatchObject({ undo: { label: "Exposure" }, depth: 1 });
});
