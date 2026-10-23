/**
 * What a person can observe of every Undo history (the look's, the View and lighting history and the experiments' document
 * histories), read through interfaces that exist before and after the history service: the trusted core's application
 * (dispatch, gestures, form controls, feature controls, look transactions, the timeline), the view graph and its views family,
 * the document-history API and the presentation port's Undo/Redo. `tests/golden/history-parity.json` was captured with this
 * observer from the code before the history service (2e0708a6, by `capture-history-golden.ts`); the service must match it.
 *
 * Only `wiring()` (how a session is assembled) changed when the service landed: the observations did not. Step IDs are opaque and
 * compared by first appearance; times are compared only for presence.
 */
import { MAIN_VIEW, type ViewGraphChange } from "../../src/platform/api/view-graph";
import type { HistoryParticipant, HistorySnapshot, HistoryCommand } from "../../src/platform/api/history";
import { STUDIO_COMPOSITION } from "../../src/compose/studio-registry";
import { DEFAULT_CREATOR_LIGHTING } from "../../src/preview/creator-lighting";
import { createHistoryService } from "../../src/platform/core/history-service";
import { createStudioPresentation } from "../../src/app/studio-presentation";
import { createTrustedAuthoringCore, type StudioComposition } from "../../src/app/trusted-authoring-core";
import { createViewServices } from "../../src/app/view-actions";
import { STUDIO_MODULE_REGISTRATION } from "../../src/compose/modules";
import { freshWorkspace } from "./eye-region";
import { withHair, withTint, type Hair } from "./hair-feature";
import { Ids, timeline } from "./look-history-parity";
import { digest, restore } from "./workspace-observable";
import { createHash } from "node:crypto";
import { encodeWorkspaceAt } from "../../src/app/workspace/workspace-budget";
import { STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import { largeWorkspaceV1, looseWorkspaceV1, smallWorkspaceV1 } from "./workspace-v1-fixtures";

import { namedCore, type NamedTrustedCore } from "./named-targets";
type Core = NamedTrustedCore;

/**
 * How a session is assembled: the only part of this observer that follows the code (see the header). Before the service the
 * documents were a `createDocumentHistory()` of their own, routed by the presentation; now one history service holds the look's
 * history and the documents, and the experiments register their participants with it.
 */
export function wiring() {
  const service = createHistoryService(), documents = service.documents;
  return {
    documents,
    core(composition: StudioComposition, resetStack: () => void, workspace = freshWorkspace()) {
      let n = 0;
      return namedCore(createTrustedAuthoringCore(workspace, { resetStack, selectedCollection: () => "draft", history: service,
        newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` }, composition));
    },
    /** The presentation port over a core, with experiments that contribute `participants` and use `documents`. */
    port(core: Core, participants: () => HistoryParticipant[]) {
      service.participants(participants);
      const experiments = { history: documents, snapshot: () => [], set: async () => ({ ok: true }), subscribe: () => () => {},
        registrations: () => [{ histories: participants } as never] };
      return createStudioPresentation({ authoring: core.application, targets: core.targets, library: {} as never, files: {} as never, viewport: {} as never,
        preferences: {} as never, previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} }, experiments });
    },
  };
}

// ----- The look -----

function lookMoment(c: Core, ids: Ids, counts: { resets: number; recipe: number; history: number }) {
  const { app, document } = c;
  return { recipe: digest(document.recipe), active: document.active, others: document.otherParts()?.parts ?? null,
    history: app.history(), timeline: timeline(app.historyTimeline(), ids),
    undo: app.capability({ kind: "history.undo" }), redo: app.capability({ kind: "history.redo" }),
    // Since the previous moment: how often the preview was reset and the recipe published (exactly), and whether the history changed.
    counts: { resets: counts.resets, recipe: counts.recipe, history: counts.history > 0 } };
}
function moments(c: Core, counts: { resets: number; recipe: number; history: number }) {
  const ids = new Ids(), seen: unknown[] = [];
  const note = (what: string, result?: unknown) => {
    seen.push({ what, result: result ?? null, at: lookMoment(c, ids, counts) });
    counts.resets = counts.recipe = counts.history = 0;
  };
  return { ids, seen, note };
}

/** A scripted session over eye makeup and the synthetic hair feature: every kind of step, cancel and move. */
export function lookSession() {
  const wire = wiring(), counts = { resets: 0, recipe: 0, history: 0 };
  const c = wire.core(withHair(), () => counts.resets++), { app, document } = c, { seen, note } = moments(c, counts);
  document.subscribe(change => { if (change === "recipe") counts.recipe++; if (change === "history") counts.history++; });
  const layerId = () => document.recipe.layers[0].id, u0 = document.recipe.layers[0].points[0].u;
  const gesture = (moves: number[], cancel = false) => {
    const begun = app.beginGesture("uv", layerId());
    for (const u of moves) app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u } });
    app.endGesture("uv", cancel);
    return begun;
  };
  // CORE-42: a gesture moved and back keeps its step; a cancelled one from there removes none; the next edit names that step.
  note("gesture moved and back", gesture([u0 + 0.01, u0]));
  note("cancelled gesture", gesture([u0 + 0.03], true));
  note("opacity", app.dispatch({ kind: "layer.setOpacity", layerId: layerId(), opacity: 0.42 }));
  note("undo", app.dispatch({ kind: "history.undo" }));
  note("cancelled gesture after undo", gesture([u0 + 0.02], true));
  note("redo", app.dispatch({ kind: "history.redo" }));
  note("empty gesture", gesture([]));
  // Discrete edits, several parts, and jumps (each applies once: one reset, one publish).
  for (const opacity of [0.3, 0.5, 0.7]) note(`opacity ${opacity}`, app.dispatch({ kind: "layer.setOpacity", layerId: layerId(), opacity }));
  note("hair colour", app.dispatch({ kind: "hair.setColour", colour: "#aa3300" } as never));
  note("hair strand", app.dispatch({ kind: "hair.addStrand", length: 2 } as never));
  note("selection keeps Redo", app.dispatch({ kind: "hair.selectStrand", index: 0 } as never));
  const start = app.historyTimeline().startId;
  note("jump to start", app.dispatch({ kind: "history.jumpTo", entryId: start }));
  note("jump to the same place", app.dispatch({ kind: "history.jumpTo", entryId: start }));
  const steps = app.historyTimeline().steps;
  note("jump to the third step", app.dispatch({ kind: "history.jumpTo", entryId: steps[2].id }));
  note("jump to the last step", app.dispatch({ kind: "history.jumpTo", entryId: steps.at(-1)!.id }));
  note("jump to an unknown step", app.dispatch({ kind: "history.jumpTo", entryId: "step-999999" }));
  note("undo twice", [app.dispatch({ kind: "history.undo" }), app.dispatch({ kind: "history.undo" })]);
  // A form control: a run of edits is one step; back at its start it leaves none; Escape restores without Redo.
  note("control begin", app.controlBegin("opacity", layerId()));
  note("control edit", app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layerId(), opacity: 0.11 }));
  note("busy undo", app.capability({ kind: "history.undo" }));
  note("control edit 2", app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layerId(), opacity: 0.12 }));
  note("control cancel", app.controlCancel("opacity"));
  const now = document.recipe.layers[0].opacity;
  app.controlBegin("opacity", layerId());
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layerId(), opacity: 0.9 });
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layerId(), opacity: now });
  note("control back at start commits nothing", app.controlCommit("opacity"));
  app.controlBegin("opacity", layerId());
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layerId(), opacity: 0.25 });
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layerId(), opacity: 0.26 });
  note("control commit", app.controlCommit("opacity"));
  note("one-shot control edit", app.controlEdit("colour", { kind: "layer.setColor", layerId: layerId(), color: "#123456" } as never));
  // A generic feature control and a look transaction.
  note("feature control", [app.featureControlBegin("hair", "drag"), app.featureControlEdit("hair", "drag", { kind: "hair.setColour", colour: "#010101" } as never),
    app.featureControlEdit("hair", "drag", { kind: "hair.setColour", colour: "#020202" } as never), app.featureControlCommit("drag")]);
  note("feature control cancel", [app.featureControlBegin("hair", "drag"), app.featureControlEdit("hair", "drag", { kind: "hair.setColour", colour: "#030303" } as never),
    app.featureControlCancel("drag")]);
  const RESET = { label: "Reset look", actionKind: "look.reset" };
  note("look transaction", app.transaction(RESET, ["eye-makeup", "hair"], () => {
    app.dispatch({ kind: "layer.setOpacity", layerId: layerId(), opacity: 0.66 });
    return app.dispatch({ kind: "hair.addStrand", length: 4 } as never);
  }));
  note("empty look transaction", app.transaction(RESET, ["hair"], () => ({ ok: true })));
  note("failed look transaction", app.transaction(RESET, ["hair"], () => { app.dispatch({ kind: "hair.addStrand", length: 5 } as never); return { ok: false, message: "No." }; }));
  note("undo the transaction", app.dispatch({ kind: "history.undo" }));
  note("redo the transaction", app.dispatch({ kind: "history.redo" }));
  // Redo is discarded by an edit that stays in the history.
  app.dispatch({ kind: "history.undo" });
  note("edit after undo", app.dispatch({ kind: "hair.setColour", colour: "#0f0f0f" } as never));
  note("redo after the edit", app.dispatch({ kind: "history.redo" }));
  // The limit: 80 steps kept; the step a new one displaced comes back when that one is undone.
  for (let i = 0; i < 85; i++) app.dispatch({ kind: "layer.setOpacity", layerId: layerId(), opacity: (i % 50) / 100 + 0.2 });
  note("at the limit");
  note("undo at the limit", app.dispatch({ kind: "history.undo" }));
  note("redo at the limit", app.dispatch({ kind: "history.redo" }));
  return seen;
}

/** CORE-46: a change that records no step hides Redo; one that leaves the content as it was keeps it. */
export function redoValiditySession() {
  const counts = { resets: 0, recipe: 0, history: 0 }, c = wiring().core(withTint() as never, () => counts.resets++), { app } = c;
  const { seen, note } = moments(c, counts);
  c.document.subscribe(change => { if (change === "recipe") counts.recipe++; if (change === "history") counts.history++; });
  note("tint", app.dispatch({ kind: "tint.set", colour: "#111111" } as never));
  note("undo", app.dispatch({ kind: "history.undo" }));
  note("unrecorded tint", app.dispatch({ kind: "tint.try", colour: "#222222" } as never));
  note("redo refused", app.dispatch({ kind: "history.redo" }));
  note("tint again", app.dispatch({ kind: "tint.set", colour: "#333333" } as never));
  note("undo again", app.dispatch({ kind: "history.undo" }));
  note("unrecorded tint back to the same", app.dispatch({ kind: "tint.try", colour: "#222222" } as never));
  note("redo still there", app.dispatch({ kind: "history.redo" }));
  return seen;
}

// ----- The View and lighting history -----

const calibrated = (exposure: number) => ({ state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure } } });

export function viewSession() {
  const history = createHistoryService(), focus = history.focus;
  const { views, viewActions } = createViewServices(freshWorkspace().preview, undefined, STUDIO_MODULE_REGISTRATION, history);
  const events: unknown[] = [], seen: unknown[] = [];
  views.subscribe((change: ViewGraphChange) => events.push({ ...change, nodes: [...change.nodes].sort(), views: [...change.views].sort() }));
  const note = (what: string, result?: unknown) => {
    seen.push({ what, result: result ?? null, history: views.history(), snapshot: viewActions.snapshot().history, data: digest(views.data()), lights: views.state(MAIN_VIEW, "lights").creatorLighting,
      undo: viewActions.capability({ kind: "view.undo" }), redo: viewActions.capability({ kind: "view.redo" }), events: events.splice(0) });
  };
  const run = (action: Parameters<typeof viewActions.dispatch>[0]) => { viewActions.dispatch(action); return true; };
  for (const value of [1.3, 1.4, 1.5]) views.edit(MAIN_VIEW, "lights", calibrated(value), { label: "Exposure", coalesce: "exposure" });
  note("one drag");
  note("release", run({ kind: "view.endEdit" }));
  note("second drag", views.edit(MAIN_VIEW, "lights", calibrated(1.6), { label: "Exposure", coalesce: "exposure" }));
  note("another edit ends the run", views.edit(MAIN_VIEW, "lights", { state: { setup: "key" } }, { label: "Lighting: Key light", coalesce: "setup" }));
  note("same slider again", views.edit(MAIN_VIEW, "lights", calibrated(1.7), { label: "Exposure", coalesce: "exposure" }));
  note("undo", run({ kind: "view.undo" }));
  note("drag after undo", views.edit(MAIN_VIEW, "lights", calibrated(1.8), { label: "Exposure", coalesce: "exposure" }));
  note("drag after undo 2", views.edit(MAIN_VIEW, "lights", calibrated(1.9), { label: "Exposure", coalesce: "exposure" }));
  note("undo 2", run({ kind: "view.undo" }));
  note("redo", run({ kind: "view.redo" }));
  note("tool toggle records nothing", run({ kind: "view.setTool", view: "main", tool: "eye-makeup.surface", enabled: false }));
  note("display edit", views.edit(MAIN_VIEW, "display", { state: { brows: false } }, { label: "Hide eyebrows" }));
  note("unlabelled edit", views.edit(MAIN_VIEW, "display", { state: { lashes: false } }));
  note("seed", views.edit(MAIN_VIEW, "display", { state: { lashes: true } }, { label: "Show eyelashes", seed: true }));
  note("without history", views.withoutHistory(() => views.edit(MAIN_VIEW, "display", { state: { brows: true } }, { label: "Show eyebrows" })));
  note("undo display", run({ kind: "view.undo" }));
  const orbit = { position: [0.3, 1.6, -0.5], target: [0, 1.6, 0], fov: 30 }, front = { position: [0, 1.67, -0.6], target: [0, 1.67, 0], fov: 30 };
  note("camera jump", views.cameraJump(MAIN_VIEW, { pose: orbit }, { pose: front }, "Front view"));
  note("undo the jump", run({ kind: "view.undo" }));
  note("redo the jump", run({ kind: "view.redo" }));
  note("camera back", views.cameraStep(MAIN_VIEW, "back", { pose: front }));
  const v2 = views.addView(MAIN_VIEW, { scene: true, lights: true }, { label: "New 3D view" });
  note("add view", v2);
  note("exposure in the new view", views.edit(v2, "lights", calibrated(3), { label: "Exposure" }));
  note("unlink lights", views.unlink(v2, "lights"));
  note("link camera", views.link(v2, "camera", MAIN_VIEW));
  note("focus records nothing", focus.focusView(v2));
  // (Focus back on the main view before the next step: Redo now restores what the Undo replaced, focus included, where the code
  // before the service restored what the step left. history-service.test.ts says what holds.)
  focus.focusView(MAIN_VIEW);
  note("close view", views.closeView(v2, { label: "Close view" }));
  note("undo close", run({ kind: "view.undo" }));
  note("undo link", run({ kind: "view.undo" }));
  note("redo link", run({ kind: "view.redo" }));
  note("unrecorded structure change clears", views.withoutHistory(() => views.closeView(v2)));
  note("nothing to undo", viewActions.capability({ kind: "view.undo" }));
  for (let i = 0; i < 55; i++) views.edit(MAIN_VIEW, "lights", calibrated(1 + i / 100), { label: `Exposure ${i}` });
  note("at the limit");
  return seen;
}

// ----- Document histories (experiments) -----

/** The document-history API on its own: records, moves and selection. */
export function documentSession() {
  const { documents } = wiring(), seen: unknown[] = [];
  let heard = 0;
  documents.subscribe(() => heard++);
  const ids = new Ids(), view = (id: string) => ({ ...timeline(documents.snapshot(id), ids), documentLabel: documents.snapshot(id).documentLabel ?? null });
  const note = (what: string, result?: unknown) => seen.push({ what, result: result === undefined ? null : result, selected: documents.selected(), heard,
    a: view("hair:a"), b: view("hair:b") });
  const step = (id: string, label: string) => ({ id, label, actionKind: "hairLab.set" });
  note("empty");
  note("record a", documents.record("hair:a", "Hair Lab", step("a1", "Hair length"), { before: { v: 1 }, after: { v: 2 } }));
  note("record a again", documents.record("hair:a", "Hair Lab", step("a2", "Hair waves"), { before: { v: 2 }, after: { v: 3 } }));
  note("record a with a stale before", documents.record("hair:a", "Hair Lab", step("a3", "Hair volume"), { before: "ignored", after: { v: 4 } }));
  note("record b", documents.record("hair:b", "Other groom", step("b1", "Hair length"), { before: 10, after: 20 }));
  note("move a back", documents.move("hair:a", 1));
  note("move a to start", documents.move("hair:a", -1));
  note("move a beyond", documents.move("hair:a", 9));
  note("move a to the same place", documents.move("hair:a", 2));
  note("move a back one", documents.move("hair:a", 1));
  note("record a drops its redo", documents.record("hair:a", "Hair Lab", step("a4", "Hair length"), { before: { v: 3 }, after: { v: 5 } }));
  note("move unknown", documents.move("hair:none", 0));
  note("focus null", documents.focus(null));
  note("focus null again", documents.focus(null));
  note("focus b", documents.focus("hair:b"));
  return seen;
}

/** Global Undo and Redo through the presentation port while an experiment's document history is focused. */
export function routedSession() {
  const wire = wiring(), c = wire.core(STUDIO_COMPOSITION, () => {}), { documents } = wire, ids = new Ids();
  let groom = 0, shown = true;
  // An experiment's participant, as Hair Lab moves its history: through the snapshot, then `move`.
  const move = (action: HistoryCommand) => {
    const scope = "hair:g", t = documents.snapshot(scope);
    const desired = action.kind === "history.undo" ? t.current - 1 : action.kind === "history.redo" ? t.current + 1
      : action.entryId === t.startId ? -1 : t.steps.findIndex(step => step.id === action.entryId);
    if (desired < -1 || desired >= t.steps.length || action.kind === "history.jumpTo" && desired === -1 && action.entryId !== t.startId) return false;
    if (desired === t.current) return true;
    groom = documents.move(scope, desired) as number;
    return true;
  };
  const port = wire.port(c, () => shown ? [{ id: "hair:g", dispatch: move }] : []);
  const a = port.authoring, seen: unknown[] = [];
  const show = (t: HistorySnapshot) => ({ ...timeline(t, ids), documentLabel: t.documentLabel ?? null });
  const note = (what: string, result?: unknown) => seen.push({ what, result: result === undefined ? null : result, groom, selected: documents.selected(),
    history: a.history(), timeline: show(a.historyTimeline()), undo: a.capability({ kind: "history.undo" }), redo: a.capability({ kind: "history.redo" }),
    recipe: JSON.stringify(c.document.recipe.layers[0].opacity) });
  const layerId = c.document.recipe.layers[0].id;
  note("look edit", a.dispatch({ kind: "layer.setOpacity", layerId, opacity: 0.4 }));
  const record = (value: number, label: string) => { documents.record("hair:g", "Hair Lab", { id: `g${value}`, label, actionKind: "hairLab.set" }, { before: groom, after: value }); groom = value; };
  record(1, "Hair length"); note("groom step");
  record(2, "Hair waves"); note("groom step 2");
  note("undo goes to the groom", a.dispatch({ kind: "history.undo" }));
  note("redo goes to the groom", a.dispatch({ kind: "history.redo" }));
  note("jump to the groom's start", a.dispatch({ kind: "history.jumpTo", entryId: documents.snapshot("hair:g").startId }));
  note("jump to a step it doesn't hold is refused", a.capability({ kind: "history.jumpTo", entryId: "step-999999" }));
  note("busy while a control is open", [a.controlBegin("opacity", layerId), a.capability({ kind: "history.undo" }), a.dispatch({ kind: "history.undo" })]);
  // (Whether a control cancelled or committed under the document's focus moves the focus is not compared: the code before the
  // service returned it to the look after a cancel and kept it after a commit, by accident. history-service.test.ts says what holds.)
  a.controlCancel("opacity"); documents.focus(null);
  note("after the cancelled control");
  note("a look edit returns Undo to the look", a.dispatch({ kind: "layer.setOpacity", layerId, opacity: 0.5 }));
  note("look undo", a.dispatch({ kind: "history.undo" }));
  record(3, "Hair volume"); note("groom step 3");
  record(4, "Hair length"); note("groom step 4");
  shown = false; note("a groom no longer shown leaves Undo with the look");
  shown = true; note("shown again");
  note("focus back to the look", documents.focus(null));
  return seen;
}

// ----- Persistence -----

/** The exact text (not canonical: key order is part of the stored bytes). */
const bytes = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * A restored workspace's look history through the core: what the document exports (exactly the restored data), what a save
 * stores, and both again after an edit, an Undo and a Redo.
 */
export function persistenceSession() {
  const fixtures = { small: smallWorkspaceV1, loose: looseWorkspaceV1, large: () => largeWorkspaceV1(8, 30) };
  return Object.entries(fixtures).map(([name, fixture]) => {
    const state = restore(fixture()).state, restored = JSON.stringify(state.history);
    const c = wiring().core(STUDIO_COMPOSITION, () => {}, state);
    const exported = () => c.document.export().history, stored = () => encodeWorkspaceAt({ ...state, ...c.document.export() }, 0, STUDIO_DOCUMENTS).encoded;
    const first = { roundTrips: JSON.stringify(exported()) === restored, exported: bytes(exported()), stored: createHash("sha256").update(stored()).digest("hex") };
    const layerId = c.document.recipe.layers[0].id;
    c.app.dispatch({ kind: "layer.setOpacity", layerId, opacity: 0.37 });
    const edited = bytes(exported());
    c.app.dispatch({ kind: "history.undo" });
    const undone = { exported: bytes(exported()), back: JSON.stringify(exported()) === restored };
    c.app.dispatch({ kind: "history.redo" });
    return { name, first, edited, undone, redone: bytes(exported()), storedAfter: createHash("sha256").update(stored()).digest("hex") };
  });
}
