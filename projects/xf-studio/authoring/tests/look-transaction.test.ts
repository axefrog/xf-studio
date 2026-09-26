/**
 * A live document per feature and the app-level look transaction (feature-module platform §3, step 5),
 * with the synthetic hair feature registered beside eye makeup: its actions run through a generic
 * handler over its live document, one Undo history spans both parts, `app.transaction` records one look
 * step, and the collection and the workspace carry each look's hair part and editor memory.
 */
import { expect, test } from "bun:test";
import { STUDIO_COMPOSITION, STUDIO_OWNERS } from "../src/compose/studio-registry";
import { CollectionSession } from "../src/collection-session";
import { collectionDraft } from "../src/collection-workspace";
import { COLLECTION_2, featureActionTable, featureId } from "../src/platform/api";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace, parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import { PartRegistry } from "../src/platform/core/document";
import { Registry } from "../src/platform/core/registry";
import { hairCodec, withHair, type Hair } from "./fixtures/hair-feature";

const RESET = { label: "Reset look", actionKind: "look.reset" };
const ids = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; };

function core(composition = withHair(), workspace = freshWorkspace()) {
  return createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft", newId: ids() }, composition);
}
const hair = (c: ReturnType<typeof core>) => c.document.others?.read("hair") as Hair | undefined;
const opacity = (c: ReturnType<typeof core>) => c.document.recipe.layers[0].opacity;
const setOpacity = (c: ReturnType<typeof core>, value: number) =>
  c.app.dispatch({ kind: "layer.setOpacity", layerId: c.document.recipe.layers[0].id, opacity: value });

test("the production composition has no other live documents and exports exactly what it did", () => {
  const c = core(STUDIO_COMPOSITION);
  expect(c.document.others).toBeUndefined();
  expect(c.document.otherParts()).toBeUndefined();
  expect("liveFeatures" in c.document.export()).toBe(false);
  expect(c.document.contentKey()).toBe(JSON.stringify(c.document.recipe));
});

test("a feature without a handler of its own runs its registered capability and apply over its live document", () => {
  const c = core(), before = c.document.geometryVersion.revision;
  expect(hair(c)).toBeUndefined();
  // The spec's own capability decides, with its code; the descriptor's payload check still runs first.
  expect(c.app.capability({ kind: "hair.setColour", colour: "blue" } as never)).toMatchObject({ available: false, code: "invalid_value", reason: "Pick a colour." });
  expect(c.app.capability({ kind: "hair.addStrand", length: 20 } as never)).toMatchObject({ available: false, code: "limit" });
  expect(c.app.dispatch({ kind: "hair.setColour", colour: "#aa3300" } as never)).toMatchObject({ ok: true });
  expect(hair(c)).toEqual({ colour: "#aa3300", strands: [] });
  expect(c.app.history().undo).toEqual({ label: "Hair colour", actionKind: "hair.setColour" });
  // A selection records nothing.
  c.app.dispatch({ kind: "hair.addStrand", length: 2 } as never);
  expect(c.app.dispatch({ kind: "hair.selectStrand", index: 0 } as never)).toMatchObject({ ok: true });
  expect(c.document.undoDepth).toBe(2);
  // Undo restores the hair part only: eye makeup is not republished.
  expect(c.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
  expect(hair(c)).toEqual({ colour: "#aa3300", strands: [] });
  expect(c.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
  expect(hair(c)).toBeUndefined();
  expect(c.document.geometryVersion.revision).toBe(before);
  expect(c.app.dispatch({ kind: "history.redo" })).toMatchObject({ ok: true });
  expect(hair(c)).toEqual({ colour: "#aa3300", strands: [] });
  expect(c.app.history()).toMatchObject({ redo: { label: "Add strand" }, depth: 1, redoDepth: 1 });
});

test("app.transaction records one look step over several parts; Undo and Redo move both", () => {
  const c = core(), start = opacity(c);
  setOpacity(c, .25);
  const outcome = c.app.transaction(RESET, ["eye-makeup", "hair"], () => {
    expect(setOpacity(c, .5)).toMatchObject({ ok: true });
    expect(c.app.dispatch({ kind: "hair.setColour", colour: "#123456" } as never)).toMatchObject({ ok: true });
    return "done";
  });
  expect(outcome).toEqual({ ok: true, result: "done" });
  expect(c.app.historyTimeline().steps.map(step => step.label)).toEqual(["Opacity", "Reset look"]);
  expect(c.document.undoDepth).toBe(2);
  expect(c.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
  expect([opacity(c), hair(c)]).toEqual([.25, undefined]);
  expect(c.app.dispatch({ kind: "history.redo" })).toMatchObject({ ok: true });
  expect([opacity(c), hair(c)]).toEqual([.5, { colour: "#123456", strands: [] }]);
  // Jumping to the start undoes both steps at once.
  const timeline = c.app.historyTimeline();
  expect(c.app.dispatch({ kind: "history.jumpTo", entryId: timeline.startId })).toMatchObject({ ok: true });
  expect([opacity(c), hair(c)]).toEqual([start, undefined]);
});

test("a transaction that changes nothing leaves no step; one that fails is reverted without Redo", () => {
  const c = core();
  expect(c.app.transaction(RESET, ["eye-makeup", "hair"], () => setOpacity(c, opacity(c)))).toMatchObject({ ok: true });
  expect(c.document.undoDepth).toBe(0);
  const start = opacity(c);
  const thrown = c.app.transaction(RESET, ["eye-makeup", "hair"], () => {
    setOpacity(c, .1); c.app.dispatch({ kind: "hair.addStrand", length: 3 } as never);
    throw Error("The save could not be read.");
  });
  expect(thrown).toEqual({ ok: false, code: "invalid_value", message: "The save could not be read." });
  expect([opacity(c), hair(c), c.document.undoDepth, c.app.history().redoDepth]).toEqual([start, undefined, 0, 0]);
  // A failed dispatch inside reverts the whole transaction too.
  const failed = c.app.transaction(RESET, ["eye-makeup", "hair"], () => {
    setOpacity(c, .2);
    return c.app.dispatch({ kind: "hair.setColour", colour: "nope" } as never);
  });
  expect(failed).toMatchObject({ ok: false, code: "invalid_value", message: "Pick a colour." });
  expect([opacity(c), c.document.undoDepth]).toEqual([start, 0]);
});

test("inside a transaction only the named parts change; Undo, other owners and nested transactions are refused", () => {
  const c = core();
  c.app.transaction(RESET, ["hair"], () => {
    expect(c.app.capability({ kind: "history.undo" })).toMatchObject({ available: false, code: "busy" });
    expect(setOpacity(c, .3)).toMatchObject({ ok: false, code: "busy" });
    expect(c.app.dispatch({ kind: "camera.front" })).toMatchObject({ ok: false, code: "busy" });
    expect(c.app.transaction(RESET, ["hair"], () => 1)).toMatchObject({ ok: false, code: "busy" });
    expect(c.app.controlBegin("opacity", c.document.recipe.layers[0].id)).toBe(false);
    expect(c.app.canBeginGesture("uv", c.document.recipe.layers[0].id)).toMatchObject({ available: false, code: "busy" });
    c.app.dispatch({ kind: "hair.addStrand", length: 1 } as never);
  });
  expect(c.app.historyTimeline().steps.map(step => step.label)).toEqual(["Reset look"]);
  expect(c.app.transaction(RESET, ["hair", "brows"], () => 1)).toMatchObject({ ok: false, code: "invalid_value" });
  expect(c.app.transaction(RESET, [], () => 1)).toMatchObject({ ok: false, code: "invalid_value" });
  // A form-control adjustment owns the Undo transaction while it runs.
  expect(c.app.controlBegin("opacity", c.document.recipe.layers[0].id)).toBe(true);
  expect(c.app.transaction(RESET, ["hair"], () => 1)).toMatchObject({ ok: false, code: "busy" });
  c.app.controlCommit("opacity");
});

test("each look keeps its own hair part and editor memory through preset switches, and Undo continues after switching back", () => {
  const model = withHair().documents, c = core();
  const [a, b] = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"];
  const draft = collectionDraft({ schema: COLLECTION_2, id: "00000000-0000-4000-8000-0000000000cc", name: "Looks", presets: [
    { id: a, name: "A", revision: 1, parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-2", body: initialRecipe() },
      hair: { schema: "xfs/hair-part-1", body: { colour: "#111111", strands: [4, 5] } } } },
    { id: b, name: "B", revision: 1, parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-2", body: initialRecipe() } } }] }, model);
  const session = new CollectionSession(model, draft, () => c.document.export(),
    editor => c.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), ids());
  session.display();
  expect(hair(c)).toEqual({ colour: "#111111", strands: [4, 5] });
  c.app.dispatch({ kind: "hair.selectStrand", index: 1 } as never);
  c.app.dispatch({ kind: "hair.addStrand", length: 6 } as never);
  session.select(b);
  expect(hair(c)).toBeUndefined();
  expect(c.document.undoDepth).toBe(0);
  // Look B gains hair only when it is edited; it had none.
  expect(session.snapshot().collection.presets[1].parts.hair).toBeUndefined();
  c.app.dispatch({ kind: "hair.setColour", colour: "#222222" } as never);
  expect(session.snapshot().collection.presets[1].parts.hair).toEqual({ schema: "xfs/hair-part-1", body: { colour: "#222222", strands: [] } });
  session.select(a);
  expect(hair(c)).toEqual({ colour: "#111111", strands: [4, 5, 6] });
  expect(c.document.others!.document("hair")!.editor).toEqual({ strand: 2 });
  expect(c.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
  expect(hair(c)).toEqual({ colour: "#111111", strands: [4, 5] });
  // Undo in look B takes its hair part away again: the look is sparse.
  session.select(b);
  c.app.dispatch({ kind: "history.undo" });
  expect(session.snapshot().collection.presets[1].parts).not.toHaveProperty("hair");
});

test("the stored workspace keeps the live hair part and editor memory, with a collection and as a loose look", () => {
  const { documents } = withHair();
  const loose = freshWorkspace();
  loose.liveFeatures = { hair: { part: { colour: "#333333", strands: [7] }, editor: { strand: 0 } } };
  const stored = JSON.parse(JSON.stringify(serializeWorkspace(loose, documents)));
  expect(stored.look.parts.hair).toEqual({ schema: "xfs/hair-part-1", body: { colour: "#333333", strands: [7] } });
  expect(parseWorkspace(stored, documents).liveFeatures).toEqual(loose.liveFeatures);
  // Restored into the core, then captured again: nothing lost.
  const c = core(withHair(), parseWorkspace(stored, documents));
  expect(hair(c)).toEqual({ colour: "#333333", strands: [7] });
  expect(c.document.export().liveFeatures).toEqual(loose.liveFeatures);
  // A build without the hair feature carries the loose look's hair part verbatim.
  expect(parseWorkspace(stored, STUDIO_COMPOSITION.documents).otherFeatures?.parts?.hair).toEqual(stored.look.parts.hair);
});

/**
 * A feature with a content action that records no Undo step (`tint.try`, Undo policy `none`: a try-on value),
 * beside eye makeup, as the step-5 review's probe composed it.
 */
function withTint() {
  const input = (type: "string") => ({ type, required: true, from: "input" as const });
  const TINT = Object.freeze({ owner: "feature", id: featureId("tint"), api: 1, label: "Tint", stage: "dev",
    part: { ...hairCodec, current: "xfs/tint-1", accepts: ["xfs/tint-1"], serialize: (part: unknown) => ({ schema: "xfs/tint-1", body: part }) },
    editor: { empty: () => ({}), parse: () => ({}), serialize: () => ({}) },
    actions: featureActionTable(
      { "tint.set": { scope: ["workspace"], effect: "content", undo: "part", payload: { colour: input("string") } },
        "tint.try": { scope: ["workspace"], effect: "content", undo: "none", payload: { colour: input("string") } } } as never,
      { "tint.set": true, "tint.try": true } as never, {
        capability: () => ({ available: true }),
        apply: (state: { part: Hair; editor: unknown }, action: { kind: string }) => {
          const colour = (action as { kind: string; colour: string }).colour;
          return { part: { ...state.part, colour }, editor: state.editor, changed: state.part.colour !== colour, effect: { kind: "content" } };
        },
        label: (action: { kind: string }) => ({ label: action.kind, actionKind: action.kind }),
      }),
  });
  return { registry: new Registry([...STUDIO_OWNERS, TINT as never]),
    documents: Object.freeze({ parts: new PartRegistry([EYE_MAKEUP, TINT as never]), live: "eye-makeup" }) };
}

test("a change that records no step hides Redo, which would overwrite it (CORE-46)", () => {
  const c = core(withTint() as never), tint = () => (c.document.others!.read("tint") as Hair | undefined)?.colour;
  c.app.dispatch({ kind: "tint.set", colour: "#111111" } as never);
  c.app.dispatch({ kind: "history.undo" });
  expect([tint(), c.app.history().redoDepth]).toEqual([undefined, 1]);
  expect(c.app.capability({ kind: "history.redo" }).available).toBe(true);
  // The un-recorded edit changes the look without a step: Redo would silently throw it away, so it goes.
  c.app.dispatch({ kind: "tint.try", colour: "#222222" } as never);
  expect(c.app.capability({ kind: "history.redo" })).toMatchObject({ available: false });
  expect(c.app.dispatch({ kind: "history.redo" })).toMatchObject({ ok: false });
  expect(tint()).toBe("#222222");
  // A change that leaves the content as it was (a selection) keeps Redo, as before.
  const h = core();
  h.app.dispatch({ kind: "hair.addStrand", length: 2 } as never);
  h.app.dispatch({ kind: "hair.addStrand", length: 3 } as never);
  h.app.dispatch({ kind: "history.undo" });
  expect(h.app.dispatch({ kind: "hair.selectStrand", index: 0 } as never)).toMatchObject({ ok: true });
  expect(h.app.dispatch({ kind: "history.redo" })).toMatchObject({ ok: true });
  expect(hair(h)!.strands).toEqual([2, 3]);
});

test("a transaction body that returns a promise is refused and reverted (CORE-48)", async () => {
  const c = core(), before = c.document.undoDepth;
  let resumed = false;
  // @ts-expect-error: a look transaction's body can't be async (its awaited edits could not join the step).
  const outcome = c.app.transaction(RESET, ["hair"], async () => {
    c.app.dispatch({ kind: "hair.setColour", colour: "#aa3300" } as never);
    await Promise.resolve();
    resumed = true;
  });
  expect(outcome).toMatchObject({ ok: false, code: "invalid_value" });
  // What ran before the first await is reverted with no step and no Redo; nothing else is open.
  expect([hair(c), c.document.undoDepth, c.app.history().redoDepth]).toEqual([undefined, before, 0]);
  await Promise.resolve(); await Promise.resolve();
  expect(resumed).toBe(true);
  expect(c.app.transaction(RESET, ["hair"], () => c.app.dispatch({ kind: "hair.setColour", colour: "#aa3300" } as never))).toMatchObject({ ok: true });
  expect(c.app.history().undo).toEqual(RESET);
});
