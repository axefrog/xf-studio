/**
 * Profiles phase 1e: the session's data contracts (profiles design §1.1, §4.1, §5), with no tab UI: session, tab, panel instance and
 * binding data as typed plain data, validated when read and stored back with focus; and each panel type's context (§5).
 */
import { describe, expect, test } from "bun:test";
import { PANEL_INSTANCE_ID, panelBindingOf, profileSessionOf, type ProfileSessionData } from "../src/app/profiles/profile-session";
import { ProfileSessionState } from "../src/app/profiles/profile-session-state";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { FocusService } from "../src/platform/core/focus";
import { createStudioViewGraph, sessionViewGraph } from "../src/preview/preview-view-graph";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { freshWorkspace } from "./fixtures/eye-region";

const LOOK = { collection: "11111111-1111-4111-8111-111111111111", look: "22222222-2222-4222-8222-222222222222" };
const seeded = () => { let n = 0; return () => ((n++ * 7919) % 36) / 36; };
const session = (): ProfileSessionData => sessionOfWorkspace(freshWorkspace(), { tab: "Layout 1", character: "c-1", look: LOOK }, seeded());

describe("bindings", () => {
  test("a binding reads as follow-focus or a pin to exactly one view, scene, subject or look; anything else is no binding", () => {
    expect(panelBindingOf({ policy: "follow-focus", extra: 1 })).toEqual({ policy: "follow-focus" });
    expect(panelBindingOf({ policy: "pinned", target: { view: "main" } })).toEqual({ policy: "pinned", target: { view: "main" } });
    expect(panelBindingOf({ policy: "pinned", target: { scene: "s1" } })).toEqual({ policy: "pinned", target: { scene: "s1" } });
    expect(panelBindingOf({ policy: "pinned", target: { subject: { kind: "character", id: "c-1", x: 1 } } }))
      .toEqual({ policy: "pinned", target: { subject: { kind: "character", id: "c-1" } } });
    expect(panelBindingOf({ policy: "pinned", target: { look: LOOK } })).toEqual({ policy: "pinned", target: { look: LOOK } });
    for (const value of [undefined, "pinned", { policy: "pinned" }, { policy: "pinned", target: { view: "a", scene: "b" } }, { policy: "pinned", target: {} },
      { policy: "pinned", target: { view: "" } }, { policy: "pinned", target: { subject: { kind: "character" } } }, { policy: "sticky", target: { view: "a" } }])
      expect(panelBindingOf(value)).toBeUndefined();
  });
});

describe("sessions as stored", () => {
  test("a session made from a workspace reads back as it is", () => {
    const value = session();
    expect(profileSessionOf(structuredClone(value))).toEqual(value);
    expect(value.tabs[0]!.panels.every(panel => PANEL_INSTANCE_ID.test(panel.id))).toBe(true);
  });

  test("reading validates instances, bindings, scenes and focus, keeps unknown fields, and refuses what a session can't be", () => {
    const value = structuredClone(session()) as unknown as Record<string, any>;
    value.tabs[0].panels = [{ id: "layers--abcd", type: "layers", binding: { policy: "follow-focus" } }, { id: "layers--abcd", type: "presets" },
      { id: "not an instance", type: "x" }, { id: "history--zzzz9", type: "history", binding: { policy: "pinned", target: {} }, later: "kept" }];
    value.views.scenes[0].look = { collection: 3 };
    value.views.scenes[0].gen = -2;
    value.focus = { views: { main: 9, other: 9, broken: "x" }, editing: 4, future: true };
    value.future = { kept: true };
    const read = profileSessionOf(value)!;
    // A duplicate instance ID and a malformed one are dropped; an unreadable binding is left out (the type's default follows).
    expect(read.tabs[0]!.panels as unknown).toEqual([{ id: "layers--abcd", type: "layers", binding: { policy: "follow-focus" } },
      { id: "history--zzzz9", type: "history", later: "kept" }]);
    expect(read.views.scenes[0]).not.toHaveProperty("look");
    expect(read.views.scenes[0]!.gen).toBe(0);
    expect(read.focus as unknown).toEqual({ views: { main: 9 }, future: true });
    expect(read.seq).toBe(9);
    expect((read as unknown as { future: unknown }).future).toEqual({ kept: true });
    // Two tabs with one ID, or a view in no tab of the session, isn't a session.
    const twice = structuredClone(session()) as unknown as Record<string, any>;
    twice.tabs.push({ ...twice.tabs[0], panels: [] });
    expect(profileSessionOf(twice)).toBeNull();
    const stray = structuredClone(session()) as unknown as Record<string, any>;
    stray.views.views[0].tab = "t-elsewhere";
    expect(profileSessionOf(stray)).toBeNull();
  });

  test("the window's session restores focus into the focus service and stores it back with the session; a focus change is a session change", () => {
    const data = session(), focus = new FocusService();
    const state = new ProfileSessionState("p-1", data, seeded(), focus);
    expect(focus.snapshot()).toEqual({ seq: 1, views: { main: 1 }, editing: `look:${LOOK.collection}/${LOOK.look}` });
    let changes = 0;
    state.subscribe(() => changes++);
    focus.focusPanel("history--abcd"); focus.edited("character:c-1");
    expect(changes).toBe(2);
    const graph = createStudioViewGraph(freshWorkspace().preview, undefined, undefined);
    const stored = state.stored({ graph: sessionViewGraph(graph), dock: null }).sessions["p-1"]!;
    expect(stored.focus).toEqual({ views: { main: 1 }, panel: "history--abcd", editing: "character:c-1" });
    expect(stored.seq).toBe(1);
    // Reading it back gives the same focus.
    expect(profileSessionOf(structuredClone(stored))!.focus).toEqual(stored.focus);
  });
});

describe("panel types declare their context (§5)", () => {
  test("each panel resolves from what it shows and edits; profile panels have no binding", () => {
    const contexts = Object.fromEntries(STUDIO_CATALOGUE.panels.map(panel => [panel.id, STUDIO_CATALOGUE.context(panel.id).kind]));
    expect(contexts).toEqual({
      presets: "look", layers: "look", history: "profile", library: "look", package: "profile", head: "view", "save-explorer.explorer": "profile",
      uv: "look", finish: "look", shape: "look", edge: "look", warp: "look", "expressions.controls": "look", "expressions.sets": "look",
      character: "subject", "poses.library": "scene", lighting: "view", motion: "scene", quality: "view", activity: "profile", settings: "profile",
      help: "profile",
    });
    expect(STUDIO_CATALOGUE.context("character")).toEqual({ kind: "subject", subjects: ["character"] });
    expect(STUDIO_CATALOGUE.context("no-such-panel")).toEqual({ kind: "profile" });
  });
});
