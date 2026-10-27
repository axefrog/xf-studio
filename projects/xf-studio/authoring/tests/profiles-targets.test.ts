import { targetStatus } from "./fixtures/target-status";
/**
 * Profiles phase 1e: focus, binding resolution and captures (profiles design §3.1–3.5), as plain data with a few operations, tested
 * deterministically before anything is wired: the focus service's ordering and editing context, `resolveBinding`'s policies, eligibility,
 * constraint rules, empty and dangling states, `captureCurrent`, and the input layer's `TargetResolver` naming targets and holding captures.
 * The multi-subject case (§9.2): three Vs of both bodies, three looks, five views in two tabs, and three Character panels pinned to three Vs.
 */
import { describe, expect, test } from "bun:test";
import { FocusService, focusDataOf, topView } from "../src/platform/core/focus";
import { type BindingWorld, captureCurrent, type ConstraintRule, requirementsMet, resolveBinding } from "../src/app/profiles/bindings";
import { TargetResolver } from "../src/app/profiles/targets";
import { nameTargets } from "../src/app/action-targets";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { refusal } from "../src/platform/api/capability";
import type { PanelBinding } from "../src/app/profiles/profile-session";
import type { LookRef } from "../src/library/collection-documents";
import { createStudioViewGraph } from "../src/preview/preview-view-graph";
import { freshWorkspace } from "./fixtures/eye-region";

const v = (id: string) => ({ kind: "character", id });
const look = (collection: string, id: string): LookRef => ({ collection, look: id });

describe("the focus service", () => {
  test("each focus takes the next number of a sequence that never resets; the most recent of any set of views is the highest", () => {
    const focus = new FocusService();
    focus.focusView("a"); focus.focusView("b"); focus.focusView("a");
    expect(focus.snapshot()).toEqual({ seq: 3, views: { a: 3, b: 2 } });
    expect(focus.topView(["a", "b"])).toBe("a");
    expect(focus.topView(["b", "c"])).toBe("b");
    expect(focus.topView(["c"])).toBeUndefined();
    // Focusing the most recent view again changes nothing (no write, no notification).
    let heard = 0;
    focus.subscribe(() => heard++);
    focus.focusView("a");
    expect([focus.snapshot().seq, heard]).toEqual([3, 0]);
    // A closed view leaves the order; the others keep their numbers and the sequence goes on.
    focus.forgetView("a"); focus.focusView("c");
    expect(focus.snapshot()).toEqual({ seq: 4, views: { b: 2, c: 4 } });
    // Restoring a session never moves the sequence back.
    focus.restore({ seq: 2, views: { b: 1 } });
    focus.focusView("d");
    expect(focus.snapshot().views.d).toBe(5);
  });

  test("stored focus is validated: numbers are positive, unique and never above the sequence", () => {
    expect(focusDataOf({ views: { a: 4, b: 4, c: -1, d: 1.5, e: 2 }, panel: "history--abc1", editing: "look:c/l" }, 3))
      .toEqual({ seq: 4, views: { a: 4, e: 2 }, panel: "history--abc1", editing: "look:c/l" });
    expect(focusDataOf(null, "x")).toEqual({ seq: 0, views: {} });
    expect(topView({ a: 1, b: 7 }, ["a", "b"])).toBe("b");
  });

  test("the editing context is the last edited scope, with a few before it; the history service records into it and nothing else owns it", () => {
    const history = createHistoryService(), focus = history.focus;
    const values: Record<string, number> = { a: 1 };
    const scope = history.open(lookScope(look("c", "l")), { read: key => values[key], apply: next => { Object.assign(values, next); return true; } });
    expect(focus.editing()).toBeUndefined();
    scope.checkpoint(["a"], { label: "A", actionKind: "a" }); values.a = 2;
    expect(focus.editing()).toBe("look:c/l");
    history.documents.record("hair:g", "Hair Lab", { id: "g1", label: "Length", actionKind: "hair" }, { before: 1, after: 2 });
    expect(focus.recent()).toEqual(["doc:hair:g", "look:c/l"]);
    // The document isn't offered by an experiment: the first scope that can act is the look's.
    expect(history.acting(focus.recent())?.id).toBe("look:c/l");
    history.documents.focus(null);
    expect(focus.recent()).toEqual(["look:c/l"]);
    // Focus and view order never enter Undo.
    focus.focusView("main"); focus.focusPanel("history--abcd");
    expect(scope.state()).toMatchObject({ depth: 1 });
  });

  test("a focus move in a view records nothing in the View and lighting history and is no part of the view graph", () => {
    const history = createHistoryService(), graph = createStudioViewGraph(freshWorkspace().preview, undefined, history);
    const v2 = graph.addView("main", { scene: true }, { label: "New 3D view" });
    const depth = graph.history().depth;
    history.focus.focusView(v2); history.focus.focusView("main");
    expect(graph.history().depth).toBe(depth);
    expect(graph.undo()).toBe(true);
    // Undoing the new view never moves focus: focus is the session's.
    expect(history.focus.topView(["main", v2])).toBe("main");
    expect("focused" in graph.snapshot()).toBe(false);
  });
});

/** Two tabs: t1 holds views a, b and c; t2 holds d and e. Scenes s1–s5; s3 shows no look; s5 is a location scene with no V. */
function world(overrides: Partial<BindingWorld> = {}): BindingWorld {
  return {
    views: { a: { tab: "t1", scene: "s1" }, b: { tab: "t1", scene: "s2" }, c: { tab: "t1", scene: "s3" }, d: { tab: "t2", scene: "s4" }, e: { tab: "t2", scene: "s5" } },
    scenes: {
      s1: { kind: "character", subject: v("c-1"), look: look("k", "l1"), gen: 0 },
      s2: { kind: "character", subject: v("c-2"), look: look("k", "l2"), gen: 3 },
      s3: { kind: "character", subject: v("c-3"), gen: 1 },
      s4: { kind: "character", subject: v("c-1"), look: look("k", "l3"), gen: 0 },
      s5: { kind: "location", gen: 0 },
    },
    focus: { a: 1, b: 4, c: 2, d: 5, e: 6 },
    subject: ref => targetStatus(["c-1", "c-2", "c-3"].includes(ref.id), ref.kind, ref.id),
    look: ref => targetStatus(["l1", "l2", "l3"].includes(ref.look), "look", ref.look),
    ...overrides,
  };
}

describe("binding resolution", () => {
  test("follow-focus resolves the eligible view in the panel's own tab with the highest focus number, never another tab", () => {
    expect(resolveBinding(world(), { tab: "t1", context: { kind: "look" } })).toEqual({ state: "resolved",
      target: { view: "b", scene: "s2", sceneGen: 3, subject: v("c-2"), look: look("k", "l2") }, candidates: 3, named: true });
    // t2's most recent view is a location: a V's panel follows the V's view there, a scene panel of any kind follows the location.
    expect(resolveBinding(world(), { tab: "t2", context: { kind: "subject", subjects: ["character"] } })).toMatchObject({ state: "resolved",
      target: { view: "d", subject: v("c-1") }, candidates: 1, named: false });
    expect(resolveBinding(world(), { tab: "t2", context: { kind: "scene" } })).toMatchObject({ target: { view: "e", scene: "s5" }, candidates: 2 });
    expect(resolveBinding(world(), { tab: "t2", context: { kind: "scene", scenes: ["character"] } })).toMatchObject({ target: { view: "d" } });
    // No candidate in the tab: the empty state, with no fallback to another tab or any "current" V.
    expect(resolveBinding(world(), { tab: "t3", context: { kind: "view" } })).toMatchObject({ state: "empty" });
    // An eligible view with no focus number is still present; use the first until one is focused.
    expect(resolveBinding(world({ focus: {} }), { tab: "t1", context: { kind: "view" } })).toMatchObject({ state: "resolved", target: { view: "a" } });
    // A profile panel has no binding and resolves to nothing in particular.
    expect(resolveBinding(world(), { tab: "t1", context: { kind: "profile" } })).toEqual({ state: "resolved", target: {}, candidates: 0, named: false });
  });

  test("a removed scene look dangles with its captured partial context; it is never an unassigned slot", () => {
    const resolved = resolveBinding(world({ look: ref => targetStatus(ref.look !== "l2") }), { tab: "t1", context: { kind: "look" } });
    expect(resolved).toMatchObject({ state: "dangling", missing: "look", target: { view: "b", subject: v("c-2") } });
    const target = resolved.state === "dangling" ? resolved.target! : {};
    expect("look" in target).toBe(false);
    expect(requirementsMet(target, ["scene"])).toEqual({ available: true });
    expect(requirementsMet(target, ["scene", "look"])).toEqual(refusal("missing_target", "Choose a look first."));
  });

  test("constraint rules are data: evaluated at bind time, they make a view ineligible and say why at dispatch", () => {
    const eyeMakeupOnly: ConstraintRule = { id: "eye-makeup-look", applies: context => context.kind === "look",
      check: target => target.look ? { available: true } : refusal("missing_target", "Eye-makeup editors need a look with eye makeup.") };
    // b (the most recent) shows l2; with l2 refused by the rule, c (no look) is refused too, so a follows.
    const rules: ConstraintRule[] = [eyeMakeupOnly, { id: "no-l2", applies: () => true, check: target => target.look?.look === "l2" ? refusal("invalid_value", "No.") : { available: true } }];
    expect(resolveBinding(world(), { tab: "t1", context: { kind: "look" }, rules })).toMatchObject({ target: { view: "a" }, candidates: 1, named: false });
    // A rule that doesn't apply to the context leaves it alone.
    expect(resolveBinding(world(), { tab: "t1", context: { kind: "view" }, rules: [eyeMakeupOnly] })).toMatchObject({ target: { view: "b" }, candidates: 3 });
  });

  test("pins resolve to what they name, are always named in the header, and dangle (keeping the pin) when it is gone", () => {
    const pinned = (target: Extract<PanelBinding, { policy: "pinned" }>["target"]): PanelBinding => ({ policy: "pinned", target });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ view: "d" }), context: { kind: "view" } }))
      .toMatchObject({ state: "resolved", target: { view: "d", scene: "s4" }, named: true });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ scene: "s3" }), context: { kind: "scene" } }))
      .toEqual({ state: "resolved", target: { scene: "s3", sceneGen: 1, subject: v("c-3") }, candidates: 1, named: true });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ subject: v("c-2") }), context: { kind: "subject", subjects: ["character"] } }))
      .toEqual({ state: "resolved", target: { subject: v("c-2") }, candidates: 1, named: true });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ look: look("k", "l3") }), context: { kind: "look" } }))
      .toEqual({ state: "resolved", target: { look: look("k", "l3") }, candidates: 1, named: true });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ view: "gone" }), context: { kind: "view" } }))
      .toEqual({ state: "dangling", missing: "view", reason: "The 3D view this panel was pinned to was closed." });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ subject: v("c-9") }), context: { kind: "subject", subjects: ["character"] } }))
      .toEqual({ state: "dangling", missing: "subject", reason: "The V this panel was pinned to was deleted." });
    expect(resolveBinding(world(), { tab: "t1", binding: pinned({ look: look("k", "gone") }), context: { kind: "look" } }))
      .toMatchObject({ state: "dangling", missing: "look" });
  });
});

describe("captures", () => {
  const capture = { target: { view: "b", scene: "s2", sceneGen: 3, subject: v("c-2"), look: look("k", "l2") }, revisions: { "character/c-2": 4 } };
  const revision = (key: string) => key === "character/c-2" ? 4 : undefined;

  test("a capture is current while its view shows its scene at the same gen, its V and look exist and its documents are unchanged", () => {
    expect(captureCurrent(world(), capture, revision)).toEqual({ available: true });
  });

  test("a stale capture is refused with missing_target, saying what changed; it never acts on a replacement", () => {
    const at = (overrides: Partial<BindingWorld>) => captureCurrent(world(overrides), capture, revision);
    expect(at({ scenes: { ...world().scenes, s2: { kind: "character", subject: v("c-3"), look: look("k", "l2"), gen: 4 } } }))
      .toEqual(refusal("missing_target", "This view now shows another V."));
    expect(at({ scenes: { ...world().scenes, s2: { kind: "character", subject: v("c-2"), look: look("k", "l1"), gen: 4 } } }))
      .toEqual(refusal("missing_target", "This view now shows another look."));
    expect(at({ views: { ...world().views, b: { tab: "t1", scene: "s1" } } })).toEqual(refusal("missing_target", "This view now shows another scene."));
    const { b: _closed, ...views } = world().views;
    expect(at({ views })).toEqual(refusal("missing_target", "That 3D view was closed."));
    expect(at({ look: () => targetStatus(false) })).toEqual(refusal("missing_target", "That look was removed."));
    expect(at({ subject: () => targetStatus(false) })).toEqual(refusal("missing_target", "That V was deleted."));
    expect(captureCurrent(world(), capture, () => 5)).toEqual(refusal("missing_target", "This changed in another window. Try again."));
  });
});

describe("the input layer's resolver", () => {
  /** A resolver over the multi-subject world: three Character panels pinned to three Vs, a Presets panel following focus, a 3D view. */
  function resolver(state = { world: world(), revisions: { "character/c-1": 1, "character/c-2": 1, "character/c-3": 1 } as Record<string, number> }) {
    const panels: Record<string, { type: string; binding?: PanelBinding }> = {
      "character--v1": { type: "character", binding: { policy: "pinned", target: { subject: v("c-1") } } },
      "character--v2": { type: "character", binding: { policy: "pinned", target: { subject: v("c-2") } } },
      "character--v3": { type: "character", binding: { policy: "pinned", target: { subject: v("c-3") } } },
      "presets--p": { type: "presets" },
      "view--a": { type: "view", binding: { policy: "pinned", target: { view: "a" } } },
    };
    const focus = new FocusService({ seq: 6, views: state.world.focus });
    const history = createHistoryService({ focus });
    const targets = new TargetResolver({
      session: { tab: () => "t1", views: () => Object.entries(state.world.views).filter(([, view]) => view.tab === "t1").map(([id, view]) => ({ id, scene: view.scene })),
        scene: id => state.world.scenes[id], panel: id => panels[id] },
      focus, acting: scopes => history.acting(scopes)?.id, status: { subject: ref => state.world.subject(ref), look: ref => state.world.look(ref) },
      context: type => type === "character" ? { kind: "subject", subjects: ["character"] } : type === "presets" ? { kind: "look" } : { kind: "view" },
      revisions: target => target.subject ? { [`character/${target.subject.id}`]: state.revisions[`character/${target.subject.id}`]! } : {},
      revision: key => state.revisions[key],
    });
    return { targets, focus, history, state };
  }

  test("three Character panels pinned to three Vs each name their own V; a panel following focus names what the focused view shows", () => {
    const { targets } = resolver();
    expect(["character--v1", "character--v2", "character--v3"].map(panel => targets.named(panel).character)).toEqual(["c-1", "c-2", "c-3"]);
    expect(targets.named("presets--p")).toMatchObject({ view: "b", scene: "s2", sceneGen: 3, character: "c-2", look: look("k", "l2"), collection: "k", tab: "t1" });
    // A key binding or palette command outside any panel follows the tab's most recently focused view.
    expect(targets.named()).toMatchObject({ view: "b", character: "c-2" });
    // Naming fills only what an action's descriptor declares and leaves out, never overriding what the caller chose.
    const descriptor = { payload: { view: { type: "string", required: true, from: "target" }, sceneGen: { type: "integer", required: true, from: "target" },
      enabled: { type: "boolean", required: true, from: "input" } } } as const;
    expect(targets.complete({ kind: "preview.setNormals", enabled: true }, descriptor, { instance: "presets--p" }) as object)
      .toEqual({ kind: "preview.setNormals", enabled: true, view: "b", sceneGen: 3 });
    expect(targets.complete({ kind: "preview.setNormals", enabled: true, view: "a" }, descriptor) as object).toEqual({ kind: "preview.setNormals", enabled: true, view: "a", sceneGen: 3 });
    expect(nameTargets({ kind: "x" }, undefined, { view: "a" })).toEqual({ kind: "x" });
  });

  test("Ctrl+Z in a 3D view steps the look its scene shows; in a Character panel its V; elsewhere the editing context (none: nothing)", () => {
    const { targets, history } = resolver();
    expect(targets.undoScope("view--a")).toBe("look:k/l1");
    // A Character panel's own Undo (the panel's button and keys) steps the V it shows, whatever was edited last.
    expect(["character--v1", "character--v2", "character--v3"].map(panel => targets.undoScope(panel))).toEqual(["character:c-1", "character:c-2", "character:c-3"]);
    // A panel pinned to a deleted V has nothing to undo: never another scope.
    expect(resolver({ world: world({ subject: ref => targetStatus(ref.id !== "c-2") }), revisions: {} }).targets.undoScope("character--v2")).toBeUndefined();
    expect(targets.undoScope("presets--p")).toBeUndefined();
    let value = 0;
    history.open("look:k/l2", { read: () => value, apply: () => true }).checkpoint(["v"], { label: "A", actionKind: "a" });
    value = 1;
    expect([targets.editing(), targets.undoScope("presets--p"), targets.named().scope]).toEqual(["look:k/l2", "look:k/l2", "look:k/l2"]);
    expect(targets.undoScope("character--v1")).toBe("character:c-1");
  });

  test("a capture freezes what its panel resolved until its signal aborts; the owner refuses it once stale, and a released one", () => {
    const { targets, focus, state } = resolver();
    const menu = new AbortController(), capture = targets.capture("presets--p", menu.signal);
    expect(capture.named).toMatchObject({ view: "b", look: look("k", "l2") });
    expect(targets.held()).toBe(1);
    // Focus moves on: the capture keeps what it froze, and is still current.
    focus.focusView("a");
    expect(targets.named("presets--p").view).toBe("a");
    expect(targets.complete({ kind: "camera.front" }, { payload: { view: { type: "string", required: true, from: "target" } } }, { capture }) as object).toEqual({ kind: "camera.front", view: "b" });
    expect(targets.current(capture)).toEqual({ available: true });
    // Another window changed the V: refused.
    state.revisions["character/c-2"] = 2;
    expect(targets.current(capture)).toEqual(refusal("missing_target", "This changed in another window. Try again."));
    state.revisions["character/c-2"] = 1;
    // The scene shows another look: refused, with what changed.
    state.world = world({ scenes: { ...world().scenes, s2: { kind: "character", subject: v("c-2"), look: look("k", "l1"), gen: 4 } } });
    expect(targets.current(capture)).toEqual(refusal("missing_target", "This view now shows another look."));
    // Aborting releases it.
    menu.abort();
    expect(targets.held()).toBe(0);
    expect(targets.current(capture)).toEqual(refusal("missing_target", "That menu was closed."));
    const late = new AbortController(); late.abort();
    expect(targets.capture(undefined, late.signal).released()).toBe(true);
    expect(targets.held()).toBe(0);
  });
});
