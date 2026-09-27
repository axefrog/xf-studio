/**
 * The easing catalogue (platform/api/easing.ts), the value-transition node (platform/core/value-transition.ts) and the transitions
 * family's settings (platform/core/transition-settings.ts; research/animation/expression-editor-design.md §5.5): the curves' maths and
 * data, a transition's cut, ease, follow and interruption continuity, and the setting's validation, persistence and Undo neutrality.
 */
import { expect, test } from "bun:test";
import { bezierAt, bezierIssue, centredAmount, ease, EASING_IDS, EASINGS, easingBezier, easingPreset, parseEasingCurve, type EasingCurve } from "../src/platform/api/easing";
import { ValueTransition, weightBlend } from "../src/platform/core/value-transition";
import { DEFAULT_TRANSITION, parseTransitions, TransitionSettings } from "../src/platform/core/transition-settings";
import { storedWeight } from "../src/engines/facial-rig/vector";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { WorkspaceComposer } from "../src/workspace-composer";
import { EASING_ICONS, iconPaths } from "../src/studio-ui/icons";
import { freshWorkspace } from "./fixtures/eye-region";

const xs = Array.from({ length: 101 }, (_, i) => i / 100);

test("every preset runs from 0 to 1 and never goes back; the four gentle curves are their exact forms as Béziers", () => {
  // By family, each gentle curve beside its strong one.
  expect(EASING_IDS).toEqual(["linear", "in", "out", "outStrong", "inOut", "inOutStrong"]);
  for (const preset of EASINGS) {
    expect([ease(preset.id, 0), ease(preset.id, 1), ease(preset.id, -3), ease(preset.id, 7), ease(preset.id, NaN)]).toEqual([0, 1, 0, 1, 0]);
    const values = xs.map(x => ease(preset.id, x));
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]! - 1e-12);
    // The stored control points are the curve: the Bézier gives the exact form's values.
    if (preset.exact) for (const x of xs) expect(bezierAt(preset.bezier, x)).toBeCloseTo(preset.exact(x), 9);
    expect(bezierIssue(preset.bezier)).toBeUndefined();
  }
  // The Intensity maths are unchanged.
  expect([ease("in", 0.5), ease("out", 0.5), ease("inOut", 0.25), ease("linear", 0.3)]).toEqual([0.25, 0.75, 0.15625, 0.3]);
  expect([centredAmount(75, "in"), centredAmount(25, "out"), centredAmount(50, "outStrong")]).toEqual([0.25, -0.75, 0]);
  // The strong curves are stronger than the gentle ones where they should be.
  expect(ease("inOutStrong", 0.25)).toBeLessThan(ease("inOut", 0.25));
  expect(ease("inOutStrong", 0.75)).toBeGreaterThan(ease("inOut", 0.75));
  expect(ease("outStrong", 0.25)).toBeGreaterThan(ease("out", 0.25));
  expect(ease("inOutStrong", 0.5)).toBeCloseTo(0.5, 9);
});

test("a custom Bézier is the same data as a preset: evaluated, validated and read back; bad ones are refused", () => {
  const custom: EasingCurve = { bezier: [0.42, 0, 0.58, 1] };
  expect([ease(custom, 0), ease(custom, 1)]).toEqual([0, 1]);
  expect(ease(custom, 0.5)).toBeCloseTo(0.5, 9);
  // CSS ease-in-out at a quarter (a known value, about 0.1291).
  expect(ease(custom, 0.25)).toBeCloseTo(0.12916, 4);
  // An overshooting curve is allowed (its user clamps); it still ends exactly at 1.
  expect(ease({ bezier: [0.3, 1.6, 0.6, 1] }, 0.5)).toBeGreaterThan(1);
  expect(ease({ bezier: [0.3, 1.6, 0.6, 1] }, 1)).toBe(1);
  expect(parseEasingCurve("inOut")).toBe("inOut");
  expect(parseEasingCurve({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual({ bezier: [0.1, 0.2, 0.3, 0.4] });
  for (const bad of ["bounce", { bezier: [1.2, 0, 0.5, 1] }, { bezier: [0, 0, 1] }, { bezier: [0, 5, 1, 1] }, { bezier: [0, 0, 1, 1], extra: 1 }, [0, 0, 1, 1]])
    expect(parseEasingCurve(bad)).toBeUndefined();
  expect(easingBezier("inOut")).toEqual(easingPreset("inOut").bezier);
  expect(easingBezier(custom)).toEqual([0.42, 0, 0.58, 1]);
});

test("each curve's icon is its own Bézier, exactly", () => {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  for (const preset of EASINGS) {
    const path = iconPaths(EASING_ICONS[preset.id]).join(" ");
    if (preset.id === "linear") { expect(path).toBe("M2.5 13.5L13.5 2.5"); continue; }
    const [x1, y1, x2, y2] = preset.bezier;
    expect(path).toBe(`M2.5 13.5C${n(2.5 + 11 * x1)} ${n(13.5 - 11 * y1)} ${n(2.5 + 11 * x2)} ${n(13.5 - 11 * y2)} 13.5 2.5`);
  }
});

const weights = weightBlend(storedWeight);
const node = () => new ValueTransition(weights);

test("a transition cuts first, eases from what is shown, ends exactly on its target, and a zero duration cuts", () => {
  const t = node();
  expect(t.valueAt(0)).toBeUndefined();
  t.cut({ jaw_mid_open: 0.5 });
  expect([t.valueAt(0), t.moving(0)]).toEqual([{ jaw_mid_open: 0.5 }, false]);
  t.ease({ lips_l_corner_up: 1 }, 1000, { seconds: 1, curve: "linear" });
  expect(t.moving(1000)).toBe(true);
  expect(t.valueAt(1250)).toEqual({ jaw_mid_open: storedWeight(0.375), lips_l_corner_up: storedWeight(0.25) });
  expect(t.valueAt(1500)).toEqual({ jaw_mid_open: storedWeight(0.25), lips_l_corner_up: storedWeight(0.5) });
  // Exactly the target at the end and after; nothing left of the old expression.
  expect([t.valueAt(2000), t.valueAt(9000), t.moving(2000)]).toEqual([{ lips_l_corner_up: 1 }, { lips_l_corner_up: 1 }, false]);
  // The curve shapes the time: ease in-out is slower than linear at a quarter.
  t.ease({}, 3000, { seconds: 2, curve: "inOut" });
  expect(t.valueAt(3500)).toEqual({ lips_l_corner_up: storedWeight(1 - ease("inOut", 0.25)) });
  expect(t.valueAt(5000)).toEqual({});
  // 0 s is a cut.
  t.ease({ jaw_mid_open: 1 }, 6000, { seconds: 0, curve: "linear" });
  expect([t.valueAt(6000), t.moving(6000)]).toEqual([{ jaw_mid_open: 1 }, false]);
});

test("a change mid-transition starts from the blended pose on screen: no jump at the moment of the change", () => {
  const t = node();
  t.cut({});
  t.ease({ jaw_mid_open: 1 }, 0, { seconds: 1, curve: "inOutStrong" });
  const before = t.valueAt(400)!;
  t.ease({ lips_l_corner_up: 0.8 }, 400, { seconds: 1, curve: "linear" });
  expect(t.valueAt(400)).toEqual(before);
  // Continuous from there: small steps make small changes, and it arrives exactly.
  let last = t.valueAt(400)!;
  for (let ms = 410; ms <= 1400; ms += 10) {
    const now = t.valueAt(ms)!;
    for (const name of ["jaw_mid_open", "lips_l_corner_up"]) expect(Math.abs((now[name] ?? 0) - (last[name] ?? 0))).toBeLessThan(0.02);
    last = now;
  }
  // The target itself at the end (targets arrive as stored vectors, so exactly what the part holds).
  expect(t.valueAt(1400)).toEqual({ lips_l_corner_up: 0.8 });
});

test("a continuous edit follows at once for what it changed; everything else keeps easing", () => {
  const t = node();
  t.cut({ jaw_mid_open: 1, brow: 0.2 });
  t.ease({ brow: 0.2 }, 0, { seconds: 1, curve: "linear" });
  expect(t.valueAt(500)).toEqual({ jaw_mid_open: 0.5, brow: storedWeight(0.2) });
  // The brow is dragged to 0.6 at 500 ms: it shows 0.6 at once; the jaw keeps easing to 0 on the same clock.
  t.follow({ brow: 0.6 }, 500);
  expect(t.valueAt(500)).toEqual({ jaw_mid_open: 0.5, brow: storedWeight(0.6) });
  expect(t.valueAt(750)).toEqual({ jaw_mid_open: 0.25, brow: storedWeight(0.6) });
  expect(t.valueAt(1000)).toEqual({ brow: 0.6 });
  // With nothing moving, a follow is a cut.
  t.follow({ brow: 0.1 }, 2000);
  expect([t.valueAt(2000), t.moving(2000)]).toEqual([{ brow: 0.1 }, false]);
});

test("transition settings: off by default at 1 s Linear, validated, stored only when changed, read back from a workspace", () => {
  const settings = new TransitionSettings();
  expect(settings.get("expression")).toEqual({ enabled: false, seconds: 1, easing: "linear" });
  expect(DEFAULT_TRANSITION).toEqual({ enabled: false, seconds: 1, easing: "linear" });
  expect(settings.stored()).toBeUndefined();
  let heard = 0;
  settings.subscribe(() => heard++);
  for (const [action, reason] of [[{ seconds: 3.5 }, "0 to 3 seconds"], [{ seconds: NaN }, "0 to 3 seconds"], [{ easing: "bounce" }, "curves"], [{}, "Nothing"],
    [{ enabled: "yes" }, "on or off"]] as const)
    expect(settings.capability({ kind: "transition.set", source: "expression", ...(action as object) })).toMatchObject({ available: false, code: "invalid_value" });
  expect(settings.capability({ kind: "transition.set", source: "pose" as never, enabled: true })).toMatchObject({ available: false });
  expect(settings.dispatch({ kind: "transition.set", source: "expression", enabled: true, seconds: 0.7333, easing: "inOut" })).toBe(true);
  // Durations are kept on the slider's step.
  expect(settings.get("expression")).toEqual({ enabled: true, seconds: 0.75, easing: "inOut" });
  expect(settings.dispatch({ kind: "transition.set", source: "expression", enabled: true })).toBe(false);
  expect(heard).toBe(1);
  expect(settings.stored()).toEqual({ expression: { enabled: true, seconds: 0.75, easing: "inOut" } });
  expect(new TransitionSettings(settings.stored()).get("expression")).toEqual(settings.get("expression"));
  expect(parseTransitions({ expression: { enabled: true, seconds: 9, easing: "linear" }, other: {} })).toBeUndefined();
  expect(parseTransitions({ expression: { enabled: false, seconds: 0, easing: "outStrong" } })).toEqual({ expression: { enabled: false, seconds: 0, easing: "outStrong" } });
});

test("the setting persists with the workspace (before the head loads too) and a workspace that never changed it keeps its bytes", () => {
  const workspace = freshWorkspace();
  const untouched = JSON.stringify(serializeWorkspace(workspace, STUDIO_COMPOSITION.documents));
  expect(untouched).not.toContain("transitions");
  const settings = new TransitionSettings();
  const capture = () => new WorkspaceComposer(workspace, { editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: workspace.history, historyTrimmed: false,
    fieldSelection: {} }) as never, uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => workspace.preview.textureSize,
    preview: () => undefined, motion: () => undefined, transitions: () => settings.stored() }).capture();
  expect(capture().preview.transitions).toBeUndefined();
  settings.dispatch({ kind: "transition.set", source: "expression", enabled: true, easing: "outStrong" });
  const captured = capture();
  expect(captured.preview.transitions).toEqual({ expression: { enabled: true, seconds: 1, easing: "outStrong" } });
  const stored = JSON.parse(JSON.stringify(serializeWorkspace(captured, STUDIO_COMPOSITION.documents)));
  expect(parseWorkspace(stored, STUDIO_COMPOSITION.documents).preview.transitions).toEqual({ expression: { enabled: true, seconds: 1, easing: "outStrong" } });
  // A damaged setting is dropped, never fatal.
  stored.preview.transitions = { expression: { enabled: true, seconds: -1, easing: "linear" } };
  expect(parseWorkspace(stored, STUDIO_COMPOSITION.documents).preview.transitions).toBeUndefined();
});

test("through the Studio: transition.set is a platform action with no Undo step; a preset switch with it on is still one Undo step", () => {
  const c = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const settings = new TransitionSettings();
  c.app.attach({ transitions: settings });
  expect(c.app.capability({ kind: "transition.set", source: "expression", seconds: 4 })).toMatchObject({ available: false, code: "invalid_value" });
  expect(c.app.dispatch({ kind: "transition.set", source: "expression", enabled: true, seconds: 0.8 }).ok).toBe(true);
  expect(settings.get("expression")).toMatchObject({ enabled: true, seconds: 0.8 });
  expect(c.app.historyTimeline().steps).toEqual([]);
  c.app.dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: "xf-sample:smile", name: "Smile" }, controls: { lips_l_corner_up: 0.5 }, links: {} } as never);
  c.app.dispatch({ kind: "expression.startFrom", origin: { kind: "rest" }, controls: {}, links: {} } as never);
  expect(c.app.historyTimeline().steps.map(step => step.label)).toEqual(["Start expression from", "Start expression from"]);
  c.app.dispatch({ kind: "history.undo" });
  expect((c.app.featureState("expressions")?.part as { controls: object }).controls).toEqual({ lips_l_corner_up: 0.5 });
  // Without the service attached, the action says why.
  const bare = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  expect(bare.app.capability({ kind: "transition.set", source: "expression", enabled: true }).available).toBe(false);
});
