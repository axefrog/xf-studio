/**
 * Profiles phase 1e review fixes: what an action names is what it acts on, at dispatch as well as when it was resolved.
 *
 * - A control run (a slider drag) captures its look when it begins; a look switch settles it on that look, and a continuation is refused,
 *   never applied to the next look.
 * - A scene-editing view action names its scene with the `gen`; a view relinked to another scene at the same `gen` is refused.
 * (Device-backed view actions naming another view are routed by the view they name: tests/view-routes.test.ts.)
 */
import { describe, expect, test } from "bun:test";
import { createStudioPresentation, type GenericFeatureFacade } from "../src/app/studio-presentation";
import type { StudioAction } from "../src/app/studio-application";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { STUDIO_COMPOSITION, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { freshWorkspace, initialRecipe } from "./fixtures/eye-region";
import { namedCore } from "./fixtures/named-targets";
import { profileStudio } from "./fixtures/profile-studio";

const jaw = (value: unknown) => (value as { part?: { controls?: Record<string, number> } } | undefined)?.part?.controls?.jaw_mid_open;
const set = (value: number) => ({ kind: "expression.setControl", name: "jaw_mid_open", value });

describe("control runs", () => {
  test("a run begun on look A that outlives A is settled on A, and its continuation is refused, never applied to look B", async () => {
    const studio = await profileStudio({ looks: [{ name: "A", recipe: initialRecipe() }, { name: "B", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    const [a, b] = studio.owner.looksOf(studio.shown()!).map(look => look.id);
    const port = createStudioPresentation({ authoring: studio.core.app, targets: studio.targets, library: studio.collection, files: studio.files,
      viewport: {} as never, preferences: {} as never, previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} } });
    const ok = (action: unknown) => expect(port.authoring.dispatch(action as never)).toMatchObject({ ok: true });
    ok(set(0.1)); ok(studio.choose(b!)); ok(set(0.8)); ok(studio.choose(a!));
    const expressions = port.feature("expressions") as GenericFeatureFacade;
    expect(expressions.controlBegin("drag")).toBe(true);
    expect(expressions.controlEdit("drag", set(0.5))).toMatchObject({ ok: true });
    // The look switches mid-drag: the run settles on A (one step there), and the drag going on can't reach B.
    ok(studio.choose(b!));
    expect(expressions.controlEdit("drag", set(0.6))).toMatchObject({ ok: false, code: "missing_target" });
    expressions.controlCancel("drag");
    expect(jaw(studio.app.featureState("expressions"))).toBe(Math.fround(0.8));
    ok(studio.choose(a!));
    expect(jaw(studio.app.featureState("expressions"))).toBe(Math.fround(0.5));
    // A's history holds the settled run; undoing it goes back to where the drag began.
    ok({ kind: "history.undo" });
    expect(jaw(studio.app.featureState("expressions"))).toBe(Math.fround(0.1));
  });

  test("eye makeup's form control: a run begun on A is refused once the editor shows B", async () => {
    const studio = await profileStudio({ looks: [{ name: "A", recipe: initialRecipe() }, { name: "B", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    const [, b] = studio.owner.looksOf(studio.shown()!).map(look => look.id);
    const layer = studio.document.recipe.layers[0]!.id;
    expect(studio.app.controlBegin("opacity", layer)).toBe(true);
    expect(studio.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer, opacity: 0.3 })).toMatchObject({ ok: true });
    expect(studio.app.dispatch(studio.choose(b!))).toMatchObject({ ok: true });
    expect(studio.app.snapshot().control).toBeUndefined();
    expect(studio.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer, opacity: 0.9 })).toMatchObject({ ok: false, code: "missing_target" });
    expect(studio.document.recipe.layers[0]!.opacity).not.toBe(0.9);
  });
});

describe("control runs over a replaced look", () => {
  test("a run whose look was replaced from elsewhere is over: its continuation is refused until it begins again (Sol's same-look case)", async () => {
    const a = await profileStudio({ looks: [{ name: "A", recipe: initialRecipe() }] });
    await a.collection.initialize();
    const port = createStudioPresentation({ authoring: a.core.app, targets: a.targets, library: a.collection, files: a.files,
      viewport: {} as never, preferences: {} as never, previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} } });
    const expressions = port.feature("expressions") as GenericFeatureFacade;
    expect(expressions.controlBegin("drag")).toBe(true);
    expect(expressions.controlEdit("drag", set(0.5))).toMatchObject({ ok: true });
    expect(await a.settle()).toBe(true);
    // Another window changes the same look; this one takes the change, and the run it replaced settles.
    const b = await profileStudio({ library: a.library, show: a.scene.look() });
    expect(b.app.dispatch(set(0.8) as never)).toMatchObject({ ok: true });
    expect(await b.settle()).toBe(true);
    await a.outbox.check(); await a.outbox.settle();
    expect(jaw(a.app.featureState("expressions"))).toBe(Math.fround(0.8));
    // The old drag going on is refused: it never writes over the replacement.
    expect(expressions.controlEdit("drag", set(0.6))).toMatchObject({ ok: false, code: "missing_target" });
    expect(jaw(a.app.featureState("expressions"))).toBe(Math.fround(0.8));
    expressions.controlCancel("drag");
    // A new drag begins on what the look holds now.
    expect(expressions.controlBegin("drag")).toBe(true);
    expect(expressions.controlEdit("drag", set(0.6))).toMatchObject({ ok: true });
    expressions.controlCommit("drag");
    expect(jaw(a.app.featureState("expressions"))).toBe(Math.fround(0.6));
  });

  test("a run that changed nothing, settled by a look switch, leaves no step behind in its look (Sol's phantom Undo)", async () => {
    const studio = await profileStudio({ looks: [{ name: "A", recipe: initialRecipe() }, { name: "B", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    const [a, b] = studio.owner.looksOf(studio.shown()!).map(look => look.id);
    const layer = studio.document.recipe.layers[0]!.id, start = studio.document.recipe.layers[0]!.opacity;
    expect(studio.app.history()).toMatchObject({ depth: 0 });
    expect(studio.app.controlBegin("opacity", layer)).toBe(true);
    expect(studio.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer, opacity: 0.3 })).toMatchObject({ ok: true });
    expect(studio.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer, opacity: start })).toMatchObject({ ok: true });
    expect(studio.app.dispatch(studio.choose(b!))).toMatchObject({ ok: true });
    expect(studio.app.dispatch(studio.choose(a!))).toMatchObject({ ok: true });
    expect(studio.app.history()).toMatchObject({ depth: 0 });
    expect(studio.app.capability({ kind: "history.undo" })).toMatchObject({ available: false });
  });
});

describe("scenes", () => {
  test("a scene-editing view action names its scene: a view relinked to another scene at the same gen is refused", () => {
    const core = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
    const second = core.views.addView(MAIN_VIEW, {}, { label: "New 3D view" });
    const first = core.views.node(MAIN_VIEW, "scene").id, other = core.views.node(second, "scene").id;
    expect(first).not.toBe(other);
    const action = core.targets.complete({ kind: "preview.setNormals", enabled: true } as StudioAction, core.application.descriptor("preview.setNormals"));
    expect(action).toMatchObject({ view: MAIN_VIEW, scene: first, sceneGen: 0 });
    // Resolved as named: the check passes (what's left is the 3D view's own readiness).
    expect(core.application.capability(action).code).not.toBe("missing_target");
    core.views.link(MAIN_VIEW, "scene", second);
    expect(core.views.node(MAIN_VIEW, "scene").id).toBe(other);
    expect(core.application.capability(action)).toEqual({ available: false, code: "missing_target", reason: "This view now shows another scene." });
    expect(core.application.dispatch(action)).toMatchObject({ ok: false, code: "missing_target" });
  });
});
