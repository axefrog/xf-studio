/**
 * The history service (`platform/core/history-service.ts`): scoped stacks, focus routing, Redo validity, moves that apply once,
 * refused replays, coalescing, transactions and the limit, over plain targets. The Studio's own scopes are compared with the
 * code before the service in history-parity.test.ts.
 */
import { expect, test } from "bun:test";
import { HISTORY_LIMIT, type HistoryLabel, type HistoryTarget } from "../src/platform/api/history";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { createHistoryService, lookScope as lookScopeOf, LOCAL_VIEW_SCOPE } from "../src/platform/core/history-service";
const LOOK_SCOPE = lookScopeOf({ collection: "c", look: "l" });
import { CONTROL_TRANSACTION, GESTURE_TRANSACTION } from "../src/platform/core/history-transaction";
import { createStudioViewGraph, defaultViewGraph, STUDIO_VIEW_GRAPH_RULES } from "../src/preview/preview-view-graph";
import { ViewGraph } from "../src/platform/core/view-graph";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { DEFAULT_CREATOR_LIGHTING } from "../src/preview/creator-lighting";
import { CHARACTER_NOT_SHOWN, characterHistory } from "../src/character/character-history";
import { freshWorkspace } from "./fixtures/eye-region";

import { namedCore } from "./fixtures/named-targets";
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
  const lookScope = service.open(LOOK_SCOPE, look.target), viewScope = service.open(LOCAL_VIEW_SCOPE, view.target);
  lookScope.checkpoint(["a"], label("A")); look.set("a", 2);
  viewScope.checkpoint(["n"], label("N")); view.set("n", 2);
  expect(service.acting(service.focus.recent())).toBe(lookScope);
  service.documents.record("hair:g", "Hair Lab", { id: "g1", ...label("Hair length") }, { before: 1, after: 2 });
  expect(service.documents.selected()).toBe("hair:g");
  // Recorded and selected, but no experiment offers it: Undo stays with the look.
  expect(service.acting(service.focus.recent())).toBe(lookScope);
  const offered = new Set(["hair:g"]);
  const off = service.participants(() => [...offered].map(id => ({ id, dispatch: () => true })));
  expect(service.acting(service.focus.recent())!.id).toBe("doc:hair:g");
  expect(service.acting(service.focus.recent())!.timeline()).toMatchObject({ startId: "hair:g:start", documentLabel: "Hair Lab", steps: [{ id: "g1", label: "Hair length" }] });
  offered.clear();
  expect(service.acting(service.focus.recent())).toBe(lookScope);
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
  service.open(LOCAL_VIEW_SCOPE, store({ n: 0 }).target).checkpoint(["n"], label("N"));
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

test("a refused Undo, Redo or jump preserves steps, labels, displaced limit entries and chunks (P3-i H2)", () => {
  const service = createHistoryService(), view = store({ n: 0 }, { content: true }), scope = service.open(LOCAL_VIEW_SCOPE, view.target, { limit: 2 });
  scope.checkpoint(["n"], label("One")); view.set("n", 1);
  scope.checkpoint(["n"], label("Two")); view.set("n", 2);
  scope.checkpoint(["n"], label("Three")); view.set("n", 3);
  let notifications = 0; service.subscribe(() => notifications++);
  const refused = (move: () => boolean) => {
    const timeline = scope.timeline(), state = scope.state(), data = scope.data(), stats = scope.stats(), values = { ...view.values }, heard = notifications;
    for (let i = 0; i < 3; i++) {
      view.refuseNext(); expect(move()).toBe(false);
      expect(view.values).toEqual(values); expect(scope.timeline()).toEqual(timeline); expect(scope.state()).toEqual(state);
      expect(scope.data()).toEqual(data); expect(scope.stats()).toEqual(stats); expect(notifications).toBe(heard);
    }
  };
  refused(() => scope.undo());
  expect(scope.undo()).toBe(true); expect(view.values.n).toBe(2); expect(scope.timeline().trimmed).toBe(false);
  refused(() => scope.redo());
  refused(() => scope.jumpTo(scope.timeline().startId));
  expect(scope.redo()).toBe(true); expect(view.values.n).toBe(3);
  expect(scope.jumpTo(scope.timeline().startId)).toBe(true); expect(view.values.n).toBe(1);
});

test("a slider drag coalesces into one step until it is released (CORE-95), in the view graph too", () => {
  const service = createHistoryService(), views = createStudioViewGraph(freshWorkspace().preview, undefined, service);
  const exposure = (value: number) => ({ state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: value } } });
  const shown = () => views.state<{ creatorLighting: { exposure: number } }>(MAIN_VIEW, "lights").creatorLighting.exposure, start = shown();
  for (const value of [1.3, 1.4, 1.5]) views.edit(MAIN_VIEW, "lights", exposure(value), { label: "Exposure", coalesce: "exposure" });
  expect(service.scope(LOCAL_VIEW_SCOPE)!.state()).toMatchObject({ undo: { label: "Exposure" }, depth: 1 });
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
  const core = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft", history: service }, STUDIO_COMPOSITION));
  expect(service.scope(core.document.scopeId)).toBe(core.document.history);
  core.app.dispatch({ kind: "layer.setOpacity", layerId: core.document.recipe.layers[0].id, opacity: 0.3 });
  core.views.edit(MAIN_VIEW, "lights", { state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: 2 } } }, { label: "Exposure" });
  expect(service.acting(service.focus.recent())!.state()).toMatchObject({ undo: { label: "Opacity" }, depth: 1 });
  expect(service.scope(LOCAL_VIEW_SCOPE)!.state()).toMatchObject({ undo: { label: "Exposure" }, depth: 1 });
});

// ----- Review regressions -----

test("a target with a fingerprint and no revision has Redo checked against its content every time (CORE-46)", () => {
  const service = createHistoryService(), values: Record<string, unknown> = { a: 1 };
  const scope = service.open(LOOK_SCOPE, { read: key => values[key], apply: next => { Object.assign(values, next); return true; },
    fingerprint: () => JSON.stringify(values) });
  scope.checkpoint(["a"], label("A")); values.a = 2;
  expect(scope.undo()).toBe(true);
  expect(scope.canRedo()).toBe(true);
  // A change that records no step: Redo would overwrite it, so it is refused and the change stays.
  values.a = 3;
  expect(scope.canRedo()).toBe(false);
  expect(scope.redo()).toBe(false);
  expect(values.a).toBe(3);
});

test("a stored node whose ID reads like the history's structure key is still an ordinary node", () => {
  const stored = defaultViewGraph(freshWorkspace().preview), lights = stored.lights[0].id;
  const data = { ...stored, lights: [{ ...stored.lights[0], id: "structure" }],
    views: stored.views.map(view => ({ ...view, lights: view.lights === lights ? "structure" : view.lights })) };
  const views = new ViewGraph(data, STUDIO_VIEW_GRAPH_RULES);
  const exposure = () => views.state<{ creatorLighting: { exposure: number } }>(MAIN_VIEW, "lights").creatorLighting.exposure, start = exposure();
  views.edit(MAIN_VIEW, "lights", { state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: 9 } } }, { label: "Exposure" });
  expect(views.undo()).toBe(true);
  expect(exposure()).toBe(start);
  expect(views.redo()).toBe(true);
  expect(exposure()).toBe(9);
});

test("the view graph publishes an Undo once its history has settled, so subscribers read Redo as it stands", () => {
  const views = createStudioViewGraph(freshWorkspace().preview), seen: unknown[] = [];
  views.edit(MAIN_VIEW, "lights", { state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: 2 } } }, { label: "Exposure" });
  views.subscribe(change => seen.push({ origin: change.origin, history: views.history() }));
  views.undo();
  expect(seen).toEqual([{ origin: "history", history: { redo: "Exposure", depth: 0, redoDepth: 1 } }]);
  views.redo();
  expect(seen.at(-1)).toEqual({ origin: "history", history: { undo: "Exposure", depth: 1, redoDepth: 0 } });
});

test("a target that can't move now (a V still being restored) refuses Undo and Redo with its reason, keeps its steps and applies nothing", () => {
  const history = createHistoryService(), plain = store({ v: 1 });
  let held: string | undefined;
  const scope = history.open("character:v", { ...plain.target, unavailable: () => held });
  scope.checkpoint(["v"], label("Change")); plain.set("v", 2);
  held = "Restoring changes from your last session…";
  expect(scope.capability({ kind: "history.undo" })).toEqual({ available: false, code: "not_ready", reason: held });
  expect(scope.command({ kind: "history.undo" })).toBe(false);
  expect([plain.values.v, plain.applies(), scope.state().depth]).toEqual([2, 0, 1]);
  held = undefined;
  expect(scope.command({ kind: "history.undo" })).toBe(true);
  expect(plain.values.v).toBe(1);
});

test("a character's history with no context bound (its head loading again) refuses Undo and Redo with a reason and keeps every step", () => {
  const history = createHistoryService(), home = { service: history, id: "v" };
  const first = store({ v: 1 }), made = characterHistory(home);
  const unbind = made.bind(first.target);
  made.scope.checkpoint(["v"], label("Change")); first.set("v", 2);
  made.scope.checkpoint(["v"], label("Again")); first.set("v", 3);
  expect(made.scope.command({ kind: "history.undo" })).toBe(true);
  expect([first.values.v, made.scope.state().depth, made.scope.state().redoDepth]).toEqual([2, 1, 1]);
  // Detached: both moves wait with their reason, nothing applies and nothing is dropped.
  unbind();
  for (const kind of ["history.undo", "history.redo"] as const) {
    expect(made.scope.capability({ kind })).toEqual({ available: false, code: "not_ready", reason: CHARACTER_NOT_SHOWN });
    expect(made.scope.command({ kind })).toBe(false);
  }
  expect([made.scope.state().depth, made.scope.state().redoDepth, first.applies()]).toEqual([1, 1, 1]);
  // The next context (the head loaded again) is bound to the same scope and gets the steps back.
  const second = store({ v: 2 });
  characterHistory(home).bind(second.target);
  expect(made.scope.command({ kind: "history.redo" })).toBe(true);
  expect(second.values.v).toBe(3);
  expect(made.scope.command({ kind: "history.undo" })).toBe(true);
  expect(made.scope.command({ kind: "history.undo" })).toBe(true);
  expect([second.values.v, made.scope.state().depth]).toEqual([1, 0]);
});
