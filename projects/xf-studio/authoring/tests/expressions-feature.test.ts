/**
 * The expressions feature (research/animation/expression-editor-design.md §3.1, §4): its part codec, its actions' capability and apply,
 * and how it runs in the Studio: the generic handler records its Undo steps, a slider drag is one step through the feature control
 * transaction, Escape restores the start, and the stored workspace keeps the part while a look that never used it stays unchanged.
 */
import { expect, test } from "bun:test";
import { EXPRESSIONS, expressionPart, expressionPose } from "../src/features/expressions";
import { applyExpression, expressionCapability, pairLinked, type ExpressionAction } from "../src/features/expressions/core";
import type { ExpressionPart } from "../src/features/expressions/part";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { f32 } from "../src/engines/facial-rig/vector";
import { freshWorkspace } from "./fixtures/eye-region";

const state = (controls: Record<string, number> = {}, links: Record<string, boolean> = {}) => ({ part: { controls, links }, editor: {} });
const apply = (action: ExpressionAction, from = state()) => applyExpression(from, action);

test("the part codec validates, normalises and keeps unknown controls; it refuses what it can't read", () => {
  const part = expressionPart.parse({ schema: "xfs/expression-part-1", body: { controls: { lips_l_corner_up: 0.3, some_future_control: 0.5, jaw_mid_open: 0 },
    links: { eye_brows_raise_in: false }, label: "Soft smile", origin: { kind: "installed", clip: "facial_happy", set: "x.anims", row: 7 } } });
  expect(part).toEqual({ label: "Soft smile", controls: { lips_l_corner_up: f32(0.3), some_future_control: 0.5 }, links: { eye_brows_raise_in: false },
    origin: { kind: "installed", clip: "facial_happy", set: "x.anims", row: 7 } });
  expect(expressionPart.parse(expressionPart.serialize(part))).toEqual(part);
  expect(() => expressionPart.parse({ schema: "xfs/expression-part-1", body: { controls: { jaw_mid_open: 2 }, links: {} } })).toThrow("0 to 1");
  expect(() => expressionPart.parse({ schema: "xfs/expression-part-1", body: { controls: {}, links: {}, extra: 1 } })).toThrow("doesn't know");
  expect(() => expressionPart.parse({ schema: "xfs/expression-part-1", body: { controls: {}, links: {}, origin: { kind: "mystery" } } })).toThrow();
  expect(expressionPose(part)).toBe(part.controls);
  expect(expressionPose({ controls: {}, links: {} })).toBeUndefined();
});

test("a linked mirror pair moves both sides; a lateral direction pair has no counterpart; links are stored per pair", () => {
  expect(apply({ kind: "expression.setControl", name: "lips_l_corner_up", value: 0.4 }).part.controls)
    .toEqual({ lips_l_corner_up: f32(0.4), lips_r_corner_up: f32(0.4) });
  expect(apply({ kind: "expression.setControl", name: "jaw_mid_shift_l", value: 0.4 }).part.controls).toEqual({ jaw_mid_shift_l: f32(0.4) });
  expect(apply({ kind: "expression.setControl", name: "jaw_mid_open", value: 0.2 }).part.controls).toEqual({ jaw_mid_open: f32(0.2) });
  const unlinked = apply({ kind: "expression.linkPair", pair: "lips_corner_up", linked: false });
  expect(pairLinked(unlinked.part, "lips_r_corner_up")).toBe(false);
  expect(apply({ kind: "expression.setControl", name: "lips_r_corner_up", value: 0.5 }, unlinked).part.controls).toEqual({ lips_r_corner_up: f32(0.5) });
  // Setting a control to its value records nothing (no Undo step).
  const same = state({ jaw_mid_open: f32(0.2) });
  expect(apply({ kind: "expression.setControl", name: "jaw_mid_open", value: 0.2 }, same).changed).toBe(false);
});

test("mirror, reset (all, a group, one control) and start from replace what they should", () => {
  const face = state({ lips_l_corner_up: f32(0.4), eye_l_brows_lower: f32(0.3), jaw_mid_shift_l: f32(0.2), jaw_mid_open: f32(0.1) });
  expect(apply({ kind: "expression.mirror", from: "left" }, face).part.controls).toEqual({ eye_l_brows_lower: f32(0.3), eye_r_brows_lower: f32(0.3),
    jaw_mid_open: f32(0.1), jaw_mid_shift_l: f32(0.2), lips_l_corner_up: f32(0.4), lips_r_corner_up: f32(0.4) });
  expect(apply({ kind: "expression.reset", scope: "group", target: "jaw" }, face).part.controls).toEqual({ eye_l_brows_lower: f32(0.3), lips_l_corner_up: f32(0.4) });
  // Resetting one side of a linked pair resets its partner too.
  const pair = state({ lips_l_corner_up: f32(0.4), lips_r_corner_up: f32(0.4), jaw_mid_open: f32(0.1) });
  expect(apply({ kind: "expression.reset", scope: "control", target: "lips_r_corner_up" }, pair).part.controls).toEqual({ jaw_mid_open: f32(0.1) });
  expect(apply({ kind: "expression.reset", scope: "all" }, face).part.controls).toEqual({});
  const started = apply({ kind: "expression.startFrom", origin: { kind: "installed", clip: "facial_happy", set: "s", row: 7 }, controls: { lips_apart_up: 0.86 } }, face);
  expect(started.part).toEqual({ controls: { lips_apart_up: f32(0.86) }, links: {}, origin: { kind: "installed", clip: "facial_happy", set: "s", row: 7 } });
  // A saved expression or sample brings its links (sorted), so its asymmetry survives the next edit; without them the links are kept.
  const linked = { part: { controls: {}, links: { lips_corner_up: true } } as ExpressionPart, editor: {} };
  expect(apply({ kind: "expression.startFrom", origin: { kind: "preset", id: "xf-sample:x", name: "X" }, controls: { lips_l_corner_up: 0.6, lips_r_corner_up: 0.5 },
    links: { lips_corner_up: false, eye_brows_lower: false } }, linked).part.links).toEqual({ eye_brows_lower: false, lips_corner_up: false });
  expect(apply({ kind: "expression.startFrom", origin: { kind: "rest" }, controls: {} }, linked).part.links).toEqual({ lips_corner_up: true });
  expect(apply({ kind: "expression.setLabel", label: "  Grin  " }).part.label).toBe("Grin");
  expect(apply({ kind: "expression.setLabel", label: "" }, { part: { controls: {}, links: {}, label: "x" } as ExpressionPart, editor: {} }).part).toEqual({ controls: {}, links: {} });
});

test("capability refuses with structured codes and plain reasons", () => {
  const s = state();
  expect(expressionCapability(s, { kind: "expression.setControl", name: "jaw_mid_open", value: 1.5 })).toMatchObject({ available: false, code: "invalid_value" });
  expect(expressionCapability(s, { kind: "expression.setControl", name: "../x", value: 0.5 })).toMatchObject({ available: false, code: "invalid_value" });
  expect(expressionCapability(s, { kind: "expression.reset", scope: "group", target: "elbows" })).toMatchObject({ available: false });
  expect(expressionCapability(s, { kind: "expression.startFrom", origin: { kind: "rest" }, controls: { jaw_mid_open: -1 } })).toMatchObject({ available: false });
  expect(expressionCapability(s, { kind: "expression.startFrom", origin: { kind: "preset", id: "p", name: "Mine" }, controls: {} })).toEqual({ available: true });
  expect(expressionCapability(s, { kind: "expression.startFrom", origin: { kind: "rest" }, controls: {}, links: { lips_corner_up: "yes" } as never })).toMatchObject({ available: false });
  expect(() => apply({ kind: "expression.setControl", name: "jaw_mid_open", value: 2 })).toThrow();
});

const core = (workspace = freshWorkspace()) => createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
const part = (c: ReturnType<typeof core>) => c.app.featureState("expressions")?.part as { controls: Record<string, number> } | undefined;

test("in the Studio: the generic handler records steps, a slider drag is one Undo step, Escape restores the start", () => {
  const c = core();
  expect(EXPRESSIONS.stage).toBe("preview");
  expect(part(c)).toBeUndefined();
  expect(c.app.dispatch({ kind: "expression.setControl", name: "jaw_mid_open", value: 0.1 } as never)).toMatchObject({ ok: true });
  expect(part(c)?.controls).toEqual({ jaw_mid_open: f32(0.1) });
  // A drag: begin, many edits, commit: one step named by its first change.
  expect(c.app.featureControlBegin("expressions", "drag")).toBe(true);
  for (const value of [0.1, 0.2, 0.3, 0.35]) c.app.featureControlEdit("expressions", "drag", { kind: "expression.setControl", name: "lips_l_corner_up", value } as { kind: string });
  // Undo is refused while the drag is open.
  expect(c.app.capability({ kind: "history.undo" })).toMatchObject({ available: false, code: "busy" });
  c.app.featureControlCommit("drag");
  expect(part(c)?.controls).toEqual({ jaw_mid_open: f32(0.1), lips_l_corner_up: f32(0.35), lips_r_corner_up: f32(0.35) });
  expect(c.app.historyTimeline().steps.map(step => step.label)).toEqual(["Face control", "Face control"]);
  // Escape: the drag's changes go, and no step is left.
  c.app.featureControlBegin("expressions", "drag2");
  c.app.featureControlEdit("expressions", "drag2", { kind: "expression.setControl", name: "jaw_mid_open", value: 0.9 } as { kind: string });
  c.app.featureControlCancel("drag2");
  expect(part(c)?.controls.jaw_mid_open).toBe(f32(0.1));
  expect(c.app.historyTimeline().steps.length).toBe(2);
  // Another feature's action can't ride in its transaction.
  expect(c.app.featureControlEdit("expressions", "x", { kind: "layer.setOpacity" } as never)).toMatchObject({ ok: false, code: "invalid_value" });
  // Undo walks back through both steps, the first removing the part again.
  c.app.dispatch({ kind: "history.undo" });
  expect(part(c)?.controls).toEqual({ jaw_mid_open: f32(0.1) });
  c.app.dispatch({ kind: "history.undo" });
  expect(part(c)).toBeUndefined();
});

test("the stored workspace keeps the expression; a workspace that never used it is unchanged", () => {
  const untouched = core(), stored = JSON.stringify(serializeWorkspace({ ...freshWorkspace(), ...untouched.document.export() } as never, STUDIO_COMPOSITION.documents));
  expect(stored).not.toContain("expression");
  const c = core();
  c.app.dispatch({ kind: "expression.setControl", name: "eye_l_brows_lower", value: 0.25 } as never);
  const workspace = { ...freshWorkspace(), ...c.document.export() };
  const again = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(workspace as never, STUDIO_COMPOSITION.documents))), STUDIO_COMPOSITION.documents);
  expect(part(core(again))?.controls).toEqual({ eye_l_brows_lower: f32(0.25), eye_r_brows_lower: f32(0.25) });
  // Saving the look's part as a preset uses the feature's own codec.
  expect(c.app.featureEnvelope("expressions")).toEqual({ schema: "xfs/expression-part-1", body: { controls: { eye_l_brows_lower: f32(0.25), eye_r_brows_lower: f32(0.25) }, links: {} } });
});

test("symmetry is one rule: linked gaze keeps both eyes looking the same way, Mirror copies by the rule, Flip gives the mirror image", () => {
  // A two-way gaze edit: the left eye looks toward V's left (out); linked, the right eye does too (in), never crossed.
  const look = apply({ kind: "expression.setAxis", negative: "eye_l_dir_out", positive: "eye_l_dir_in", value: -0.5 });
  expect(look.part.controls).toEqual({ eye_l_dir_out: 0.5, eye_r_dir_in: 0.5 });
  // Moving it the other way clears the first end: an eye can't look both ways.
  expect(apply({ kind: "expression.setAxis", negative: "eye_l_dir_out", positive: "eye_l_dir_in", value: 0.25 }, look).part.controls)
    .toEqual({ eye_l_dir_in: 0.25, eye_r_dir_out: 0.25 });
  // Separate eyes (the gaze link off) move alone; a centre axis (jaw) has no counterpart.
  const separate = apply({ kind: "expression.setLinks", links: { eye_dir_h: false } });
  expect(apply({ kind: "expression.setAxis", negative: "eye_l_dir_out", positive: "eye_l_dir_in", value: -0.5 }, separate).part.controls).toEqual({ eye_l_dir_out: 0.5 });
  expect(apply({ kind: "expression.setAxis", negative: "jaw_mid_shift_l", positive: "jaw_mid_shift_r", value: 0.3 }).part.controls).toEqual({ jaw_mid_shift_r: f32(0.3) });
  expect(expressionCapability(state(), { kind: "expression.setAxis", negative: "eye_l_dir_out", positive: "jaw_mid_open", value: 0.3 })).toMatchObject({ available: false });
  // Mirror left → right: skin as a mirror image, gaze in the same direction, the lateral jaw left alone.
  const face = state({ eye_l_dir_out: f32(0.4), eye_l_brows_lower: f32(0.3), jaw_mid_shift_l: f32(0.2), eye_r_dir_out: f32(0.1) });
  expect(apply({ kind: "expression.mirror", from: "left" }, face).part.controls).toEqual({ eye_l_brows_lower: f32(0.3), eye_r_brows_lower: f32(0.3),
    eye_l_dir_out: f32(0.4), eye_r_dir_in: f32(0.4), jaw_mid_shift_l: f32(0.2) });
  // Flip: the mirror image (the brows swap sides, the jaw shifts the other way, the look turns to the other side).
  expect(apply({ kind: "expression.mirror", from: "flip" }, state({ eye_l_brows_lower: f32(0.3), jaw_mid_shift_l: f32(0.2), eye_l_dir_out: f32(0.4), eye_r_dir_in: f32(0.4) })).part.controls)
    .toEqual({ eye_r_brows_lower: f32(0.3), jaw_mid_shift_r: f32(0.2), eye_r_dir_out: f32(0.4), eye_l_dir_in: f32(0.4) });
  // Symmetric for the whole face or a group is one setLinks step.
  expect(apply({ kind: "expression.setLinks", links: { eye_brows_lower: false, lips_corner_up: false } }).part.links).toEqual({ eye_brows_lower: false, lips_corner_up: false });
});

test("a mirrored edit is one Undo step in the Studio: a linked two-way drag sets both eyes and undoes at once", () => {
  const c = core();
  c.app.featureControlBegin("expressions", "gaze");
  for (const value of [-0.1, -0.3, -0.45]) c.app.featureControlEdit("expressions", "gaze", { kind: "expression.setAxis", negative: "eye_l_dir_out", positive: "eye_l_dir_in", value } as { kind: string });
  c.app.featureControlCommit("gaze");
  expect(part(c)?.controls).toEqual({ eye_l_dir_out: f32(0.45), eye_r_dir_in: f32(0.45) });
  c.app.dispatch({ kind: "expression.mirror", from: "flip" } as never);
  expect(part(c)?.controls).toEqual({ eye_r_dir_out: f32(0.45), eye_l_dir_in: f32(0.45) });
  expect(c.app.historyTimeline().steps.map(step => step.label)).toEqual(["Face control", "Flip face"]);
  c.app.dispatch({ kind: "history.undo" });
  expect(part(c)?.controls).toEqual({ eye_l_dir_out: f32(0.45), eye_r_dir_in: f32(0.45) });
  c.app.dispatch({ kind: "history.undo" });
  expect(part(c)).toBeUndefined();
});

test("intensity: toward full or rest from the drag's start, zeros and controls outside the start untouched, one Undo step, cancel restores", async () => {
  const { interpolateWeight } = await import("../src/engines/facial-rig/vector");
  const { centredAmount, ease } = await import("../src/platform/api/easing");
  // The maths: above the middle toward full, below toward rest, 0 stays 0, the middle changes nothing.
  expect([interpolateWeight(0.4, 0.5), interpolateWeight(0.4, -0.5), interpolateWeight(0, 1), interpolateWeight(0.4, 0), interpolateWeight(0.4, 1), interpolateWeight(0.4, -1)])
    .toEqual([f32(0.7), f32(0.2), 0, f32(0.4), 1, 0]);
  // Curves map the travel; the amount is signed and continuous through the middle.
  expect([centredAmount(50, "linear"), centredAmount(75, "linear"), centredAmount(25, "linear"), centredAmount(100, "in"), centredAmount(75, "in"), centredAmount(75, "out")])
    .toEqual([0, 0.5, -0.5, 1, 0.25, 0.75]);
  expect([ease("inOut", 0.5), ease("inOut", 0), ease("inOut", 1)]).toEqual([0.5, 0, 1]);
  // The action: absolute from its base, so one drag's edits replace each other; what isn't in the base is left alone.
  const start = state({ jaw_mid_open: f32(0.4), lips_l_corner_up: f32(0.2) });
  const base = { jaw_mid_open: f32(0.4), lips_l_corner_up: f32(0.2) };
  expect(apply({ kind: "expression.intensity", base, amount: 0.5 }, start).part.controls).toEqual({ jaw_mid_open: f32(0.7), lips_l_corner_up: f32(0.6) });
  expect(apply({ kind: "expression.intensity", base, amount: -1 }, start).part.controls).toEqual({});
  expect(apply({ kind: "expression.intensity", base: { jaw_mid_open: f32(0.4) }, amount: 1 }, start).part.controls).toEqual({ jaw_mid_open: 1, lips_l_corner_up: f32(0.2) });
  expect(expressionCapability(start, { kind: "expression.intensity", base, amount: 2 })).toMatchObject({ available: false, code: "invalid_value" });
  // The bleed area snaps the slider to the middle, which previews amount 0: from a mid-drag preview, the start-of-drag weights come back.
  const previewed = apply({ kind: "expression.intensity", base, amount: 0.8 }, start);
  expect(apply({ kind: "expression.intensity", base, amount: 0 }, { part: previewed.part, editor: {} }).part.controls).toEqual(base);
  // In the Studio: a drag is one Undo step; cancelling restores the start and leaves no step.
  const c = core();
  c.app.dispatch({ kind: "expression.setControl", name: "jaw_mid_open", value: 0.4 } as never);
  const before = part(c)!.controls, steps = c.app.historyTimeline().steps.length;
  c.app.featureControlBegin("expressions", "intensity");
  for (const amount of [0.1, 0.3, 0.5]) c.app.featureControlEdit("expressions", "intensity", { kind: "expression.intensity", base: before, amount } as { kind: string });
  c.app.featureControlCommit("intensity");
  expect([part(c)!.controls.jaw_mid_open, c.app.historyTimeline().steps.length, c.app.historyTimeline().steps.at(-1)!.label]).toEqual([f32(0.7), steps + 1, "Adjust intensity"]);
  c.app.featureControlBegin("expressions", "intensity2");
  c.app.featureControlEdit("expressions", "intensity2", { kind: "expression.intensity", base: part(c)!.controls, amount: -0.9 } as { kind: string });
  c.app.featureControlCancel("intensity2");
  expect([part(c)!.controls.jaw_mid_open, c.app.historyTimeline().steps.length]).toEqual([f32(0.7), steps + 1]);
  c.app.dispatch({ kind: "history.undo" });
  expect(part(c)!.controls.jaw_mid_open).toBe(f32(0.4));
});
