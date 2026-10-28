/**
 * View actions routed by the view they name (profiles phase 4a-vi, experiment 043 §13; src/preview/view-routes.ts). The application sends
 * each camera, preview and motion action to the runtime holding the named view, with how it holds it, and an action naming a hidden view
 * never touches the shown runtime's device.
 */
import { describe, expect, test } from "bun:test";
import type { StudioAction } from "../src/app/studio-application";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { STUDIO_COMPOSITION, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { MotionActions, type MotionPort } from "../src/animation/motion-actions";
import { PreviewActions, type PreviewPort } from "../src/preview/preview-actions";
import { graphMotionScene } from "../src/app/trusted-preview-services";
import { previewFields } from "../src/preview/preview-view-graph";
import { VIEW_HIDDEN, VIEW_LOADING, type ViewReach } from "../src/preview/view-routes";
import type { CameraState } from "../src/app/workspace/makeup-workspace";
import { freshWorkspace } from "./fixtures/eye-region";
import { namedCore } from "./fixtures/named-targets";

const CAMERA: CameraState = { position: [0, 1.6, -0.6], target: [0, 1.6, 0], fov: 30 };

/** A runtime's devices recording every call, with its preview and motion services over the core's graph, drawing `view`. */
function runtime(core: ReturnType<typeof world>["core"], view: string, label: string, calls: string[], options: { shapes?: number; hidden?: boolean } = {}) {
  let camera = structuredClone(CAMERA);
  const record = (what: string) => () => { calls.push(`${label}.${what}`); };
  const port: PreviewPort = { cameraState: () => camera, front: () => { calls.push(`${label}.front`); return false; }, setFov: () => false, endFovGesture: record("endFov"),
    restoreCamera: next => { calls.push(`${label}.restoreCamera`); camera = next; }, setLighting: record("lighting"), setSurfaceControls: () => {},
    setWire: () => {}, setNormals: record("normals"), setEyeOptics: () => {}, setHair: record("hair"), setEyeShape: index => calls.push(`${label}.eyeShape:${index}`),
    setPiercings: () => {}, setDetail: record("detail"), creatorCamera: () => structuredClone(CAMERA),
    eyeShapeOptions: () => ({ choices: Array.from({ length: options.shapes ?? 3 }, (_, index) => ({ index, label: `${index}` }) as never), eyesFollow: false, eyeSource: null }),
    availability: target => target === "brows" ? "This V's brows aren't prepared." : undefined };
  const preview = new PreviewActions(freshWorkspace().preview, port, core.views, view);
  if (options.hidden) preview.draw(null);
  const motionPort: MotionPort = { available: true, blink: { available: true },
    idle: { enabled: false, time: 0, paused: false, bodyEnabled: true, faceEnabled: true, seek() {} },
    setIdle: value => calls.push(`${label}.idle:${value}`), setIdlePaused: record("paused"), setIdleContributions: record("contributions"),
    setBlink: record("blink"), animateBlink: record("animateBlink") };
  const motion = new MotionActions(motionPort, graphMotionScene(core.views, () => preview, () => preview.view()));
  calls.length = 0;
  return { preview, motion };
}

/** A core with a second view on a scene of its own; runtime A shows the main view, B (another V's) is warm for the second view. */
function world(reachOfSecond: ViewReach = "warm") {
  const core = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
  const second = core.views.addView(MAIN_VIEW, {}, { label: "New 3D view" });
  core.views.edit(second, "camera", { state: { pose: { position: [0, 1.5, -1], target: [0, 1.5, 0], fov: 25 } } }, { applied: true });
  const calls: string[] = [];
  const a = runtime({ views: core.views } as never, MAIN_VIEW, "A", calls);
  const b = runtime({ views: core.views } as never, second, "B", calls, { shapes: 2, hidden: true });
  const routed: string[] = [];
  core.application.attach({ preview: a.preview, motion: a.motion, runtimes: { route: view => {
    routed.push(view);
    if (view === MAIN_VIEW) return { reach: "drawn", preview: a.preview, motion: a.motion };
    if (view === second) return reachOfSecond === "warm" ? { reach: "warm", preview: b.preview, motion: b.motion } : { reach: reachOfSecond, preview: a.preview, motion: a.motion };
    return undefined;
  } } });
  calls.length = 0;
  // Named as the input layer names an action for a view: the view, its scene and the scene's gen.
  const name = (action: Record<string, unknown>) => core.targets.complete({ ...action, scene: core.views.node(action.view as string, "scene").id } as unknown as StudioAction,
    core.application.descriptor(action.kind as StudioAction["kind"]));
  return { core, second, calls, a, b, routed, name };
}

describe("an action naming a hidden view never touches the shown runtime", () => {
  test("framing and motion naming the warm view are refused plainly; neither device moves", () => {
    const { core, second, calls, name } = world();
    for (const kind of STUDIO_REGISTRY.kinds().filter(kind => /^(camera\.(front|body|setFov|endFovGesture|creatorFraming)|motion\.)/.test(kind))) {
      const action = name({ kind, view: second, enabled: true, paused: true, body: true, face: true, value: 0.5, playing: true, clip: "closeup", degrees: 40, page: "face" });
      const capability = core.application.capability(action);
      expect([kind, capability]).toEqual([kind, { available: false, code: "not_ready", reason: VIEW_HIDDEN }]);
      expect(core.application.dispatch(action)).toMatchObject({ ok: false, code: "not_ready" });
    }
    expect(calls).toEqual([]);
    // The drawn view still reaches its own device.
    expect(core.application.dispatch(name({ kind: "camera.front", view: MAIN_VIEW }))).toMatchObject({ ok: true });
    expect(core.application.dispatch(name({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: true }))).toMatchObject({ ok: true });
    expect(calls).toEqual(["A.front", "A.idle:true"]);
  });

  test("a restore, Back and an orbit step naming the warm view edit its camera node only", () => {
    const { core, second, calls, name } = world();
    const pose = { position: [0.2, 1.6, -0.8], target: [0, 1.6, 0], fov: 30 };
    expect(core.application.dispatch(name({ kind: "camera.restore", view: second, camera: pose }))).toMatchObject({ ok: true });
    expect(previewFields(core.views, second).camera).toEqual(pose);
    expect(core.application.dispatch(name({ kind: "camera.back", view: second }))).toMatchObject({ ok: true });
    expect(previewFields(core.views, second).camera?.fov).toBe(25);
    expect(core.application.dispatch(name({ kind: "camera.navigate", view: second, command: { kind: "orbit", yaw: 10, pitch: 0 } }))).toMatchObject({ ok: true });
    expect(previewFields(core.views, second).camera?.position).not.toEqual([0, 1.5, -1]);
    // The warm runtime follows its view's node hidden (Back is published for its device); the shown one heard nothing.
    expect(calls.filter(call => call.startsWith("A."))).toEqual([]);
  });

  test("preview settings naming the warm view are checked against the warm head and applied to its view; the shown device never changes", () => {
    const { core, second, calls, name } = world();
    const mainShape = previewFields(core.views, MAIN_VIEW).scene.eyeShape;
    // The warm head offers two eye shapes, the shown one three: the warm head's are what count for its view.
    expect(core.application.capability(name({ kind: "preview.setEyeShape", view: second, index: 2 }))).toMatchObject({ available: false, code: "invalid_value" });
    expect(core.application.dispatch(name({ kind: "preview.setEyeShape", view: second, index: 1 }))).toMatchObject({ ok: true });
    expect(core.application.capability(name({ kind: "preview.setDetail", view: second, detail: "brows", enabled: true }))).toMatchObject({ available: false, code: "asset_unavailable" });
    expect(core.application.dispatch(name({ kind: "preview.setNormals", view: second, enabled: true }))).toMatchObject({ ok: true });
    expect(core.application.dispatch(name({ kind: "preview.setExposure", view: second, value: 2 }))).toMatchObject({ ok: true });
    // The warm head follows its view, hidden; the shown head's device heard nothing.
    expect(calls.filter(call => call.startsWith("A."))).toEqual([]);
    expect(calls).toEqual(expect.arrayContaining(["B.eyeShape:1", "B.lighting"]));
    expect(previewFields(core.views, second).scene.eyeShape).toBe(1);
    expect(previewFields(core.views, MAIN_VIEW).scene.eyeShape).toBe(mainShape);
  });

  test("a view whose V is still loading, or has no runtime: framing and motion refused, settings checked against the stored ranges only", () => {
    for (const reach of ["loading", "absent"] as const) {
      const { core, second, calls, name } = world(reach);
      const reason = reach === "loading" ? VIEW_LOADING : VIEW_HIDDEN;
      expect(core.application.capability(name({ kind: "camera.front", view: second }))).toEqual({ available: false, code: "not_ready", reason });
      expect(core.application.capability(name({ kind: "motion.setIdle", view: second, enabled: true }))).toEqual({ available: false, code: "not_ready", reason });
      // The shown head's three shapes and its missing brows don't decide another V's view: the stored range does, and the node keeps the choice.
      expect(core.application.dispatch(name({ kind: "preview.setEyeShape", view: second, index: 7 }))).toMatchObject({ ok: true });
      expect(core.application.dispatch(name({ kind: "preview.setDetail", view: second, detail: "brows", enabled: true }))).toMatchObject({ ok: true });
      expect(core.application.capability(name({ kind: "preview.setEyeShape", view: second, index: 99 }))).toMatchObject({ available: false, code: "invalid_value" });
      expect(previewFields(core.views, second).scene.eyeShape).toBe(7);
      expect(calls.filter(call => call.startsWith("A."))).toEqual([]);
    }
  });
});

test("a restore or orbit step naming a hidden view that shares the drawn view's camera moves the drawn device too, so hiding it keeps the pose (Sol's reproduction)", () => {
  const { core, a, calls } = world();
  // A view of another scene looking through the main view's camera, held by a hidden runtime.
  const shared = core.views.addView(MAIN_VIEW, { camera: true }, { label: "Shared camera" });
  const c = runtime({ views: core.views } as never, shared, "C", calls, { hidden: true });
  const pose = { position: [0.3, 1.6, -0.9], target: [0, 1.6, 0], fov: 45 } as CameraState;
  expect(c.preview.check({ kind: "camera.restore", view: shared, camera: pose }, "warm")).toEqual({ available: true });
  c.preview.dispatch({ kind: "camera.restore", view: shared, camera: pose }, "warm");
  // The edit was published as unapplied: the drawn device, drawing through that camera, moved; the hidden one follows it too.
  expect(calls).toEqual(expect.arrayContaining(["A.restoreCamera", "C.restoreCamera"]));
  expect(a.preview.snapshot().camera.fov).toBe(45);
  // Hiding the drawn head writes its live pose to the node: the requested one, not the 30° it showed before.
  a.preview.storeCamera();
  expect(previewFields(core.views, MAIN_VIEW).camera?.fov).toBe(45);
  // An orbit step the same way.
  calls.length = 0;
  c.preview.dispatch({ kind: "camera.navigate", view: shared, command: { kind: "orbit", yaw: 15, pitch: 0 } }, "warm");
  expect(calls).toContain("A.restoreCamera");
  const orbited = previewFields(core.views, MAIN_VIEW).camera!;
  expect(orbited.position).not.toEqual(pose.position);
  a.preview.storeCamera();
  expect(previewFields(core.views, MAIN_VIEW).camera).toEqual(orbited);
});

test("a preview service without a router works its reach out from its own view: framing only for the view it draws", () => {
  const { core, second, a } = world();
  expect(a.preview.check({ kind: "camera.front", view: second })).toEqual({ available: false, code: "not_ready", reason: VIEW_HIDDEN });
  expect(a.preview.check({ kind: "camera.front", view: MAIN_VIEW })).toEqual({ available: true });
  // Hidden, it frames nothing, even for its own view.
  a.preview.draw(null);
  expect(a.preview.check({ kind: "camera.front", view: MAIN_VIEW })).toMatchObject({ available: false, code: "not_ready" });
  a.preview.draw(MAIN_VIEW);
  // Another view of its scene sharing its camera is framed by it; one with a camera of its own is not.
  const shared = core.views.addView(MAIN_VIEW, { scene: true, camera: true }), own = core.views.addView(MAIN_VIEW, { scene: true });
  expect(a.preview.check({ kind: "camera.front", view: shared })).toEqual({ available: true });
  expect(a.preview.check({ kind: "camera.front", view: own })).toMatchObject({ available: false, code: "not_ready" });
});

test("a device drawn for another view of its scene takes that view's settings", () => {
  const { core, a, calls } = world();
  const other = core.views.addView(MAIN_VIEW, { scene: true });
  core.views.edit(other, "display", { state: { hair: false } });
  calls.length = 0;
  a.preview.draw(other);
  expect(a.preview.view()).toBe(other);
  expect(calls).toEqual(["A.hair"]);
});
