/**
 * Profiles phase 1e review fixes: what an action names is what it acts on, at dispatch as well as when it was resolved.
 *
 * - A control run (a slider drag) captures its look when it begins; a look switch settles it on that look, and a continuation is refused,
 *   never applied to the next look.
 * - A scene-editing view action names its scene with the `gen`; a view relinked to another scene at the same `gen` is refused.
 * - A view action backed by the drawn head's device (camera, idle, pause, contributions, blink, what the head offers) acts only for a view
 *   showing the drawn scene; one naming another view is refused, and the device never changes.
 */
import { describe, expect, test } from "bun:test";
import { createStudioPresentation, type GenericFeatureFacade } from "../src/app/studio-presentation";
import type { StudioAction } from "../src/app/studio-application";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { STUDIO_COMPOSITION, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { MotionActions, NOT_DRAWN, type MotionPort } from "../src/animation/motion-actions";
import { PreviewActions, type PreviewPort } from "../src/preview/preview-actions";
import { createStudioViewGraph } from "../src/preview/preview-view-graph";
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

describe("view actions backed by the drawn head", () => {
  /** A graph with a second view on a scene of its own, a preview device drawing the main view, and the motion service over it. */
  function drawn() {
    const calls: string[] = [];
    const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview);
    const second = graph.addView(MAIN_VIEW, {}, { label: "New 3D view" });
    let camera = { position: [0, 1.6, -0.6], target: [0, 1.6, 0], fov: 30 };
    const previewPort: PreviewPort = { cameraState: () => camera, front: () => { calls.push("front"); return false; }, setFov: () => false, endFovGesture: () => {},
      restoreCamera: next => { camera = next; }, setLighting: () => calls.push("lighting"), setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {},
      setEyeOptics: () => {}, setHair: () => calls.push("hair"), setEyeShape: () => calls.push("eyeShape"), setPiercings: () => {}, setDetail: () => calls.push("detail") };
    const preview = new PreviewActions(workspace.preview, previewPort, graph);
    const motionPort: MotionPort = { available: true, blink: { available: true },
      idle: { enabled: false, time: 0, paused: false, bodyEnabled: true, faceEnabled: true, seek() {} },
      setIdle: value => calls.push(`idle.${value}`), setIdlePaused: () => calls.push("paused"), setIdleContributions: () => calls.push("contributions"),
      setBlink: () => calls.push("blink"), animateBlink: () => calls.push("animateBlink") };
    const motion = new MotionActions(workspace.preview, motionPort, { physics: view => preview.scenePhysics(view),
      setPhysics: (enabled, view) => preview.setScenePhysics(enabled, view), draws: view => preview.drawsScene(view) });
    calls.length = 0;
    return { graph, second, preview, motion, calls };
  }

  test("motion.setIdle naming a view on another scene is refused, and the drawn view's device never changes", () => {
    const { second, motion, calls } = drawn();
    expect(motion.capability({ kind: "motion.setIdle", view: second, enabled: true })).toEqual({ available: false, code: "missing_target", reason: NOT_DRAWN });
    expect(() => motion.dispatch({ kind: "motion.setIdle", view: second, enabled: true })).toThrow(NOT_DRAWN);
    expect(calls).toEqual([]);
    motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: true });
    expect(calls).toEqual(["idle.true"]);
  });

  test("every device-backed camera and motion action refuses a view whose scene isn't drawn; scene settings edit the named view's scene", () => {
    const { graph, second, preview, motion, calls } = drawn();
    for (const kind of STUDIO_REGISTRY.kinds().filter(kind => /^(camera|motion)\./.test(kind) && kind !== "motion.setPhysics")) {
      const action = { kind, view: second } as never;
      const capability = kind.startsWith("camera.") ? preview.check(action) : motion.capability(action);
      expect([kind, capability]).toEqual([kind, { available: false, code: "missing_target", reason: NOT_DRAWN }]);
    }
    // What the drawn head offers is checked for a view showing its scene only.
    for (const action of [{ kind: "preview.setEyeShape", index: 1 }, { kind: "preview.setHair", enabled: false }, { kind: "preview.setDetail", detail: "brows", enabled: false }])
      expect(preview.check({ ...action, view: second } as never)).toMatchObject({ available: false, code: "missing_target" });
    // Graph settings route by the named view: the second view's lights and scene change, the drawn device doesn't.
    preview.dispatch({ kind: "preview.setExposure", view: second, value: 3 });
    // Physics is a scene setting: it is never refused as not drawn (here the head's hair isn't loaded, which is its own reason).
    expect(motion.capability({ kind: "motion.setPhysics", view: second, enabled: true }).reason).not.toBe(NOT_DRAWN);
    preview.setScenePhysics(true, second);
    expect(calls).toEqual([]);
    expect(preview.scenePhysics(second)).toBe(true);
    expect(preview.scenePhysics(MAIN_VIEW)).toBe(false);
    expect(graph.node(second, "lights").id).not.toBe(graph.node(MAIN_VIEW, "lights").id);
  });
});
