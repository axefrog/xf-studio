import * as THREE from "three";
import { BODY_ENVELOPE, bodyClipPlanes, previewClipPlanes } from "../../preview/camera-depth";
import { BODY_FRAME, BODY_SUBJECT, bodyCameraDistance, CAMERA_DISTANCE_RANGE, frontCameraDistance, HEAD_SUBJECT, posedBodyFrame, posedBodySubject, surfaceAnchoredDistance,
  type JointBox, type Subject } from "../../preview/camera-framing";
import type { PoseSample } from "../../animation/pose-sample";
import { poseClip } from "../../animation/render/pose-clip";
import type { PosePlacement } from "../../animation/pose-sample";
import { coreSceneEvidence, idleEvidence } from "../../character/render/scene-evidence";
import { bindRenderTriggers, invalidating } from "../../preview/render/render-scheduler";
import { retainedViewportAspect, visibleViewportSize } from "../../preview/viewport-size";
import { coreDisposer, loadCoreDetail, type LoadedCoreDetail } from "../../character/render/core-detail-loader";
import type { CoreBody } from "../../character/render-detail";
import { createViewportBackdrop } from "../../preview/render/viewport-backdrop";
import { attachHeadCameraInput, type HeadCameraInput, type TargetResolver } from "../../preview/render/head-camera-input";
import type { StageTheme } from "../../preview/stage-backdrop";
import { createLightingSetupStage, type GradingLutLoader } from "../../preview/render/lighting-setup-stage";
import { loadGradingLut } from "../../preview/render/browser-grading-lut-device";
import type { LightingSource } from "../../preview/lighting-setups";
import type { FeatureRenderer, FeatureRendererFactory } from "../api/scene";
import { createFeatureRenderers, type FeatureRenderers } from "./feature-renderers";
import { characterGeometry } from "./character-geometry";
import type { ExperimentPort } from "../api/experiments";
import { followOptionalRenderers } from "./optional-renderers";
import { createHeadRig, type MotionLoader } from "./head-rig";
import { afterTask, createCharacterRenderer } from "./character-renderer";
import { createCameraSettle } from "./camera-settle";
import { createMouthApertureSampler, headBones } from "./mouth-aperture-sampler";
import { createOrbitLimits, SceneOrbitControls } from "./orbit-limits";
import type { RendererDevice } from "./renderer-device";
import { acrossContextLoss, prepareRuntime, type RuntimePreparationReport, type RuntimePreparationResult } from "./runtime-preparation";
import { drawOnly, isDrawable } from "./drawables";

/**
 * The scene host (feature-module platform §5): one scene runtime, the platform's 3D scene of one subject, drawn by the window's renderer
 * device (renderer-device.ts, profiles phase 4a-ii). It owns the scene, its camera and controls, the studio lights and the lighting
 * setups with their display, the stage, its renderer-global state (renderer-state.ts, applied by the lighting stage on every draw), the
 * head rig (head-rig.ts: the core head, its surfaces, facial shapes and motion) and the character renderer (character-renderer.ts: the V the
 * character context resolved), which are the platform's character context. Features draw their own parts through `FeatureRenderer`s it
 * creates from the composition's list, each given only its `SceneHostPort` (platform/api/scene.ts); the runtime names no feature.
 *
 * The device owns the canvas, the WebGL context, the render loop, the pane's size and the pixel ratio. A runtime is built hidden: it draws
 * nothing until the device shows it, and its camera takes input from the canvas only while shown. Building takes an `AbortSignal` that is
 * checked between steps (the stage, the core head, the rig and its motion, each feature renderer): an abort, like any failure part-way,
 * releases everything made so far and rejects with the signal's reason. `dispose()` releases the same for a built runtime, on a renderer
 * that lives on: everything it made is freed without relying on the context being lost (PREV-20, experiments/043-scene-runtimes), and it
 * never disposes the device.
 *
 * A lighting setup asked for while the runtime is shown, whose programs no preparation has readied, is not drawn at once (its first frame
 * would link every program in one task: 92–104 s on a cold program cache, PREV-209). It is staged beside the setup drawn
 * (lighting-setup-stage.ts `stage`), the runtime says it needs preparing (`onUnprepared`), and its owner prepares it as it would a hidden
 * runtime (`prepare`: the staged setup's programs compiled ahead, its maps uploaded, its warm-up drawn in pieces); the setup before keeps
 * drawing until the staged one takes over at the end. A runtime that isn't shown takes a new setup at once (it is prepared before it is
 * shown again).
 */

export type SceneHostOptions = {
  stage?: StageTheme;
  /** The feature renderers to create once the head is ready (the composition's list, compose/renderers.ts). */
  renderers?: readonly FeatureRendererFactory[];
  optionalRenderers?: Pick<ExperimentPort, "registrations" | "subscribe">;
  referenceTextures?: import("../api/scene").SceneHostPort["referenceTextures"];
  /** Whose core head to load: the feminine V's (default) or the masculine V's; a V of the other body needs another runtime. */
  body?: CoreBody;
  /** The core head record (default: the host's derived preview, core-detail-loader.ts). Probe pages inject a synthetic head. */
  loadCore?: (renderer: THREE.WebGLRenderer, body: CoreBody, signal?: AbortSignal) => Promise<LoadedCoreDetail>;
  /** The rig's motion (default: the game idle and blink assets, head-rig.ts). */
  loadMotion?: MotionLoader;
  /** The creator preset's grading LUT (default: the host's). */
  loadLut?: GradingLutLoader;
  /** Told when a feature renderer's method throws (default: the console); the host and the other features draw on (PREV-94). */
  onRendererError?: (feature: string, method: string, error: unknown) => void;
  /** Stops the build between steps (a newer request, or the runtime is no longer wanted): what was made is released. */
  signal?: AbortSignal;
};
/** What a runtime uses of the renderer device. */
export type SceneDevice = Pick<RendererDevice, "renderer" | "measure" | "resize" | "add" | "stats" | "warmUp" | "contextSignal" | "contextReady">;
/** A stored orbit, in neutral head space (workspace-state.ts `CameraState` has the same shape). */
export type SceneCameraState = { position: number[]; target: number[]; fov: number };
export type SceneRuntime = Awaited<ReturnType<typeof createSceneRuntime>>;

/** Build a scene runtime on `device`, hidden (the device shows it). */
export async function createSceneRuntime(device: SceneDevice, options: SceneHostOptions = {}) {
  const releases: (() => void)[] = [];
  try { return await assembleRuntime(device, options, releases); }
  catch (error) {
    releaseAll(releases);
    // A step that failed because the build was aborted (a fetch cut short, say) rejects with the abort, never as a failure of its own.
    if (options.signal?.aborted) throw options.signal.reason;
    throw error;
  }
}

/** Runs each release once, newest first; teardown is best effort. */
function releaseAll(releases: (() => void)[]) {
  for (const release of releases.splice(0).reverse()) {
    try { release(); } catch { /* Best effort: the rest still run. */ }
  }
}

async function assembleRuntime(device: SceneDevice, options: SceneHostOptions, releases: (() => void)[]) {
  const { signal } = options, renderer = device.renderer;
  signal?.throwIfAborted();
  // On the device from the start, hidden, before anything is made on the renderer: a context lost and restored while this runtime is
  // still being built reaches what it has made so far (the stage's prefiltered room is made before the core loads), and the device
  // never draws it until its owner shows it, once built. What it restores grows with the build (`restoreMade`).
  let restoreMade = () => {};
  const drawn = device.add({ draw: dt => draw(dt), animating: () => rigMotion.animating() || settle.settling, attach, detach,
    resized: (width, height) => resized(width, height), contextRestored: () => restoreMade() });
  releases.push(() => drawn.remove());
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  const backdrop = createViewportBackdrop(scene, options.stage ?? "dark");
  releases.push(() => backdrop.dispose());
  // The controls take the canvas only while this runtime is shown (`attach`), so camera input never reaches a hidden scene's camera.
  const controls = new SceneOrbitControls(camera);
  controls.enableDamping = true;
  // The binding catalogue, not the controls' default mouse/touch mapping, decides every press (head-camera-input.ts). The surface editor's
  // target resolution is kept here, so the input made on each show resolves through it.
  let input: HeadCameraInput | undefined, resolveTarget: TargetResolver | undefined, attached: HTMLCanvasElement | null = null;
  const cameraInput = {
    setTargetResolver(resolver: TargetResolver | undefined) { resolveTarget = resolver; input?.setTargetResolver(resolver); },
  };
  function attach(canvas: HTMLCanvasElement) {
    attached = canvas;
    controls.connect(canvas);
    input = attachHeadCameraInput(canvas, controls);
    input.setTargetResolver(resolveTarget);
    // OrbitControls leaves an inline `cursor: auto`; the presentation owns viewport cursors (`[data-cursor]`).
    canvas.style.cursor = "";
  }
  function detach() {
    // Hidden, the runtime takes a setup still staged at once: it is prepared again before it is shown (`prepared`).
    if (pendingLighting) { const next = pendingLighting; pendingLighting = null; lighting.setSource(next); }
    if (!attached) return;
    input?.dispose(); input = undefined;
    // Disconnecting resets the canvas's touch action and cursor; the next runtime shown connects its own.
    controls.disconnect();
    attached.style.cursor = "";
    attached = null;
  }
  releases.push(detach);
  // The distance limits come from the scene once the head and the V exist (orbit-limits.ts); the jumps below reach the whole range.
  const idleFrameOffset = new THREE.Vector3();
  let frontPending = false;
  /** The pane's aspect for framing: the device's pane, or the camera's last while the pane has no size. */
  const paneAspect = () => { const { width, height } = device.measure(); return retainedViewportAspect(width, height, camera.aspect); };
  function front() {
    const { width, height } = device.measure();
    frontPending = !visibleViewportSize(width, height);
    const requested = frontCameraDistance(camera.fov, paneAspect());
    const distance = Math.min(CAMERA_DISTANCE_RANGE.max, requested);
    camera.position.set(0, 1.67, -distance);
    controls.target.set(0, 1.67, 0.005);
    camera.position.add(idleFrameOffset);
    controls.target.add(idleFrameOffset);
    controls.update();
    return requested > distance;
  }
  front();
  // The loop keeps drawing while the camera settles after a damped move, even under the controls' own change threshold (camera-settle.ts).
  const settle = createCameraSettle(camera, controls.target);
  /** The posed V's joints while she holds a photo-mode pose (rig space), for the whole-body view, the orbit's reach and the clip planes. */
  let posedBox: JointBox | null = null;
  const posed = () => posedBox && idle?.enabled && idle.posing && idle.bodyEnabled ? posedBox : null;
  /**
   * The whole-body view: the same frontal orbit, aimed at the body's middle and far enough to fit a standing V (camera-framing.ts); a posed
   * V is framed by her posed joints instead (pose-library-design.md §5.3), so a sitting or lying V fills the view.
   */
  function frameBody() {
    frontPending = false;
    const box = posed();
    if (box) {
      const frame = posedBodyFrame(camera.fov, paneAspect(), box);
      const distance = Math.min(CAMERA_DISTANCE_RANGE.max, frame.distance);
      controls.target.set(frame.target[0], frame.target[1], frame.target[2] + .005);
      camera.position.set(frame.target[0], frame.target[1], frame.target[2] - distance);
      controls.update();
      return frame.distance > distance;
    }
    const requested = bodyCameraDistance(camera.fov, paneAspect());
    const distance = Math.min(CAMERA_DISTANCE_RANGE.max, requested);
    camera.position.set(0, BODY_FRAME.targetHeight, -distance);
    controls.target.set(0, BODY_FRAME.targetHeight, 0.005);
    camera.position.add(idleFrameOffset);
    controls.target.add(idleFrameOffset);
    controls.update();
    return requested > distance;
  }
  // The lighting setup shown: its lights, room, backdrop, display transform and this scene's renderer-global state (lighting-setup-stage.ts;
  // the backdrop is the stage's).
  const lighting = createLightingSetupStage({ scene, renderer, loadLut: options.loadLut ?? (() => loadGradingLut()), studioBackground: scene.background });
  releases.push(() => lighting.dispose());
  restoreMade = () => lighting.restore();
  signal?.throwIfAborted();
  // The core head, plate, eyes and maps load through one typed render record (see core-detail-loader).
  const core: LoadedCoreDetail = await (options.loadCore ?? ((renderer, body, signal) => loadCoreDetail(renderer, fetch, body, signal)))(
    renderer, options.body ?? "female", signal);
  // The core head's own geometry, materials and textures go with the runtime (not with the context, which outlives it).
  releases.push(coreDisposer(core));
  signal?.throwIfAborted();
  // The creator light rig follows the body of the head it lights (the game's preview controller does the same).
  lighting.setBodySex(core.body);
  const coreDetail = { identity: core.record.identity, origin: core.record.origin, label: core.record.provenance.label };
  // The feature renderers (compose/renderers.ts), created once the head and its motion are ready.
  let features: FeatureRenderers | undefined;
  // The platform's character context: the head rig and the V drawn on it. Features' meshes attached with `morphs` and the V's drawn
  // details follow the facial shapes with the head's own surfaces.
  const rig = await createHeadRig(scene, core, { releases, loadMotion: options.loadMotion, signal,
    deforming: () => [...features?.followers() ?? [], ...character.drawnMeshes()] });
  signal?.throwIfAborted();
  const { head, eyes, surfaces, albedo, motion } = rig;
  const { idle, blink, rig: rigMotion } = motion;
  const character = createCharacterRenderer({ scene, renderer, rig, superseded: () => features?.superseded() ?? [] });
  // The lips' aperture on the posed face, measured each drawn frame for the mouth interior's light (PREV-147 step A): the lip joints come
  // from the face records' rest and regions (the idle's face, else the blink's), the posed bones are the core head's own.
  const mouth = createMouthApertureSampler(() => headBones(head), () => [idle?.facial?.source, blink?.source]);
  // The orbit's distance limits follow the lens, the pane's aspect, the target and what shows: the farthest fits the head (and the
  // body while it shows) with a margin, the closest stops in front of the head's surface (camera-framing.ts, orbit-limits.ts).
  const shifted = (subject: Subject): Subject => ({ radius: subject.radius,
    centre: [subject.centre[0] + idleFrameOffset.x, subject.centre[1] + idleFrameOffset.y, subject.centre[2] + idleFrameOffset.z] });
  const orbitLimits = createOrbitLimits({ camera, controls,
    subjects: () => { const box = posed(); return character.bodyShown() ? [shifted(HEAD_SUBJECT), box ? posedBodySubject(box) : shifted(BODY_SUBJECT)] : [shifted(HEAD_SUBJECT)]; },
    framing: (fov, aspect) => character.bodyShown() ? [frontCameraDistance(fov, aspect), bodyCameraDistance(fov, aspect)] : [frontCameraDistance(fov, aspect)],
    surfaces: () => [head, ...surfaces.values(), eyes],
    surfaceBounds: () => shifted(HEAD_SUBJECT),
    // As the lens gesture does: skinned and morphed bounds go stale as the face moves, and the ray tests them first.
    updateWorld: () => { scene.updateMatrixWorld(true); head.computeBoundingSphere(); for (const surface of surfaces.values()) surface.computeBoundingSphere(); } });
  releases.push(() => orbitLimits.dispose());
  // A restored context comes back with empty render targets: the studio stage prefilters its environment again, the feature
  // renderers redraw theirs (eye makeup's composite), and the shown V's layered parts are baked again from their stacks (PREV-62).
  restoreMade = () => {
    lighting.restore(); features?.contextRestored();
    character.contextRestored();
  };
  function frameIdle() {
    // A pose never moves the camera (decision Q3); the framing offset stays the one measured before it.
    if (idle?.enabled && idle.posing) return;
    // Stored cameras use neutral space: take the idle's displacement off, then put the current one (zero while it is off) back on.
    camera.position.sub(idleFrameOffset); controls.target.sub(idleFrameOffset);
    rig.idleOffset(idleFrameOffset);
    camera.position.add(idleFrameOffset); controls.target.add(idleFrameOffset);
    controls.update();
  }
  const ray = new THREE.Raycaster();
  let fovGestureAnchor: THREE.Vector3 | undefined;
  let appliedWidth = 0, appliedHeight = 0;
  /** The device's pane, while this runtime is shown: the camera takes its aspect, and a Front view asked for while it had no size happens now. */
  const resized = (width: number, height: number) => {
    if (width !== appliedWidth || height !== appliedHeight) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      appliedWidth = width; appliedHeight = height;
    }
    if (frontPending) front();
  };
  const frameListeners = new Set<(dt: number) => void>();
  /**
   * Just after the next animation frame, in a task of its own (work prepared ahead takes its turns between frames: run inside the frame's
   * callback, a 4096² map's 40 ms upload and the scene's own draw made one long task).
   */
  const nextFrame = () => new Promise<void>(resolve => { requestAnimationFrame(() => afterTask(resolve)); });
  // Reused every frame: the head centre (and, while the body shows, the body's) the clip planes are measured from.
  const centre = new THREE.Vector3(), bodyCentre = new THREE.Vector3();
  /** One drawn frame (the device calls it only while this runtime is shown). */
  function draw(dt: number) {
    // The renderer is shared: this scene's own renderer-global state comes first (renderer-state.ts).
    lighting.applyRendererState();
    rigMotion.advance(dt);
    character.setMouthParting(mouth.sample());
    if (controls.enabled) controls.update();
    settle.step();
    // At long orbits, move the near plane in front of a conservative head
    // envelope so the thin makeup plate retains depth precision.
    centre.set(0, 1.67, 0).add(idleFrameOffset);
    let clip = previewClipPlanes(controls.getDistance(), camera.position.distanceTo(centre));
    // With the body shown, the depth range covers it too (the head views are unchanged while it is hidden).
    if (character.bodyShown()) {
      const box = posed(), subject = box ? posedBodySubject(box) : null;
      if (subject) bodyCentre.set(subject.centre[0], subject.centre[1], subject.centre[2]);
      else bodyCentre.set(0, BODY_ENVELOPE.centreHeight, 0).add(idleFrameOffset);
      clip = bodyClipPlanes(clip, controls.getDistance(), camera.position.distanceTo(bodyCentre), subject?.radius);
    }
    if (clip.near !== camera.near || clip.far !== camera.far) {
      camera.near = clip.near; camera.far = clip.far; camera.updateProjectionMatrix();
    }
    if (frameListeners.size) {
      scene.updateMatrixWorld(true);
      for (const update of frameListeners) update(dt);
    }
    // Each feature renderer brings its own GPU state up to date (eye makeup: the plate's composite, only after a change).
    features?.beforeDraw();
    lighting.render(camera);
  }
  // Render on demand (UI-38): a frame is drawn when something visible changed, or while the idle or Play blink runs. The runtime's own
  // mutators, the feature renderers' changes, the lighting device, the idle, the controls (every orbit and damping step), frame listeners
  // and the device's resizes and canvas input all request one; a hidden runtime's requests wait until it is shown.
  const invalidate = () => drawn.requestFrame();
  releases.push(bindRenderTriggers(invalidate, { controls, lighting }));
  // A new setup or a trial turn doesn't always notify the lighting device's listeners (only a changed display or body does).
  Object.assign(lighting, invalidating(lighting, ["setSource", "trialYaw", "trialCasters", "solo", "setScatter", "setScatterScale"], invalidate));
  releases.push(rigMotion.connect(invalidate));
  /** Run `callback` before each drawn frame (the viewport draws only when something changed); adding or removing one draws a frame. */
  const onFrame = (callback: (dt: number) => void) => {
    frameListeners.add(callback);
    invalidate();
    return () => { frameListeners.delete(callback); invalidate(); };
  };
  // The feature renderers, through their scene ports only (platform/api/scene.ts).
  features = createFeatureRenderers({ renderer, head, surfaces, skin: character.skin,
    character: character.view, subscribeCharacter: character.subscribe,
    geometry: () => characterGeometry(head, character.resolvedSurfaces("hair"), character.resolvedSurfaces("body")),
    resolvedSurfaces: character.resolvedSurfaces,
    referenceTextures: options.referenceTextures,
    requestFrame: invalidate, onFrame, rig: { attach: bones => rigMotion.attach(bones), detach: bones => rigMotion.detach(bones) },
    compile: async object => {
      const prepared = lighting.prepare(object, camera);
      await prepared.ready;
      for (const program of prepared.programs()) { await nextFrame(); program.getUniforms(); program.getAttributes(); }
    },
    supersededChanged: () => { character.refreshVisibility(); invalidate(); },
    ...(options.onRendererError ? { report: options.onRendererError } : {}) }, options.renderers ?? [], signal);
  releases.push(() => features?.dispose());
  if (options.optionalRenderers) releases.push(followOptionalRenderers(options.optionalRenderers, (factory, signal) => features!.register(factory, signal)));
  // A renderer that replaces resolved parts hides them from the start.
  if (features.superseded().length) character.refreshVisibility();
  signal?.throwIfAborted();
  // Built: its owner may show it now (the device sizes its camera to the pane then).
  const evidence = coreSceneEvidence({ coreDetail, meshes: rig.meshes, blink, blinkError: motion.blinkError,
    eyeShape: { choices: rig.eyeShapeChoices.length, eyesFollow: rig.eyesFollowShape, eyeMorphTargets: eyes.morphTargetInfluences?.length ?? 0 },
    profileEncoding: character.profileEncoding, idle, idleError: motion.idleError, faceError: motion.faceError ?? "" });
  // The idle's face can arrive after the scene starts (PREV-174): its evidence follows, and a frame shows it.
  const faceChanged = new Set<() => void>();
  releases.push(motion.onFaceChange?.(() => {
    evidence.idle = idleEvidence(idle, motion.idleError, motion.faceError ?? "");
    invalidate();
    for (const listener of faceChanged) listener();
  }) ?? (() => {}));
  /**
   * What the programs of the meshes drawn now depend on besides the lighting (each visible mesh and its materials), recorded when a
   * preparation ends: while it is unchanged, the lighting program states prepared since still hold (`prepared`).
   */
  const drawnKey = () => {
    const parts: string[] = [];
    scene.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) parts.push(`${mesh.id}:${(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.uuid).join(",")}`);
    });
    return parts.join("|");
  };
  /** The meshes drawn when a preparation last ended (`drawnKey`), and every lighting program state a preparation readied them for since. */
  let preparedFor: { drawn: string; lighting: Set<string> } | null = null;
  /** Whether the meshes drawn now have been prepared for `source`'s programs (a setup drawn before, or the one drawn now). */
  const lightingPrepared = (source: LightingSource) =>
    !!preparedFor && preparedFor.lighting.has(lighting.programStateFor(source)) && preparedFor.drawn === drawnKey();
  /** A lighting setup asked for while shown and not prepared yet: staged, drawn once a preparation readied it (see the header). */
  let pendingLighting: LightingSource | null = null;
  const unpreparedListeners = new Set<() => void>();
  const unprepared = () => { for (const listener of [...unpreparedListeners]) listener(); };
  /** See `api.setLighting`. */
  function setLighting(source: LightingSource) {
    const was = pendingLighting;
    // Hidden, or the same programs as now (a value changed), or programs readied before: drawn at once.
    if (!drawn.shown || lighting.programStateFor(source) === lighting.programState() || lightingPrepared(source)) {
      pendingLighting = null;
      lighting.setSource(source);
      if (was) unprepared();
      return;
    }
    pendingLighting = source;
    lighting.stage(source);
    // A value edit of the setup staged needs nothing new; another setup's programs do.
    if (!was || lighting.programStateFor(was) !== lighting.programStateFor(source)) unprepared();
  }
  /** The staged setup takes over (its preparation ended, or failed for a reason other than an abort: the choice is never lost). */
  function adoptPending() {
    if (!pendingLighting) return;
    const next = pendingLighting;
    pendingLighting = null;
    lighting.setSource(next);
    invalidate();
  }
  /** See `api.prepare`. */
  async function prepare(options: { signal?: AbortSignal; report?: (report: RuntimePreparationReport) => void;
    setups?: readonly LightingSource[]; overlays?: () => Iterable<THREE.Object3D>; work?: () => Iterable<() => void> } = {}): Promise<RuntimePreparationResult> {
    let result: RuntimePreparationResult;
    // A context lost part-way starts the preparation again once the context is back (runtime-preparation.ts `acrossContextLoss`).
    try { result = await acrossContextLoss(device, signal => prepareAttempt(signal, options), options); }
    catch (error) {
      if (!options.signal?.aborted && drawn.shown) adoptPending();
      throw error;
    }
    if (drawn.shown) adoptPending();
    const now = drawnKey();
    if (preparedFor?.drawn !== now) preparedFor = { drawn: now, lighting: new Set() };
    preparedFor.lighting.add(lighting.programState());
    return result;
  }
  /** The visible drawables now (the warm-up's pieces hide all but some of them). */
  const visibleDrawables = () => { const found: THREE.Object3D[] = []; scene.traverseVisible(object => { if (isDrawable(object)) found.push(object); }); return found; };
  async function prepareAttempt(signal: AbortSignal, options: { report?: (report: RuntimePreparationReport) => void; setups?: readonly LightingSource[];
    overlays?: () => Iterable<THREE.Object3D>; work?: () => Iterable<() => void> }) {
    // Shown with a setup staged: everything is compiled, uploaded and warmed up for the staged setup, put in place only inside each step
    // (the drawn frames between steps still show the setup before).
    const staged = drawn.shown && pendingLighting !== null;
    const prepareLighting = staged ? {
      prepareSteps: (object: THREE.Object3D, at: THREE.Camera) => {
        const made = lighting.prepareSteps(object, at);
        return { steps: made.steps.map(step => () => lighting.withStaged(step)), result: made.result };
      },
      prepareDisplay: () => lighting.withStaged(() => lighting.prepareDisplay()),
    } : lighting;
    // The feature renderers' own passes first (eye makeup's composite), then their surfaces as the first frame draws them.
    const base = { renderer, scene, camera, lighting: prepareLighting, frame: nextFrame, signal, features: (signal?: AbortSignal) => features?.prepare(signal),
      ...(options.overlays ? { extra: options.overlays } : {}) };
    // Other setups a view of this scene shows: their programs too, while hidden (a shown runtime keeps drawing its own setup).
    if (options.setups?.length && !drawn.shown) {
      const own = lighting.source, key = JSON.stringify(own);
      try {
        for (const setup of options.setups) {
          if (JSON.stringify(setup) === key) continue;
          lighting.setSource(setup);
          await prepareRuntime({ ...base, warmUp: () => false, programsOnly: true });
        }
      } finally { lighting.setSource(own); }
    }
    // The shown runtime warms up only what it will draw under the staged setup: its scene rendered as it is (no motion advanced, no camera
    // moved), and the device draws its own frame after it.
    const stagedFrame = () => lighting.withStaged(() => { lighting.applyRendererState(); features?.beforeDraw(); lighting.render(camera); });
    const warmUp = (only?: ReadonlySet<THREE.Object3D>) => device.warmUp(drawn,
      staged ? () => drawOnly(visibleDrawables(), only, stagedFrame) : only ? () => drawOnly(visibleDrawables(), only, () => draw(0)) : undefined);
    return prepareRuntime({ ...base, report: options.report, warmUp, ...(options.work ? { work: options.work } : {}) });
  }
  const api = {
    /** Whose core head this scene shows. */
    body: core.body,
    scene,
    camera,
    /**
     * Releases the V's details, the feature renderers, the core head, the rig, the stage and every listener: all it made on the renderer, which
     * it never disposes (it leaves the device, hidden first if shown). The runtime is unusable afterwards.
     */
    dispose: () => { pendingLighting = null; unpreparedListeners.clear(); drawn.remove(); character.dispose(); releaseAll(releases); },
    /** Its place on the renderer device: the device shows it by this (`device.show(runtime.slot)`). */
    slot: drawn,
    /**
     * Make this runtime ready for its first shown frame while it is hidden (profiles phase 4a-v, runtime-preparation.ts): everything drawn
     * now compiled for every pass, the programs linked off the page's thread and taken, the maps uploaded, the hidden warm-up drawn in pieces.
     * `setups`: other lighting setups a view of this scene shows, whose programs are compiled too. `overlays`: what will be added once shown
     * (the on-head editor's guides), compiled too. `work`: the owner's own work to do ahead between frames (the on-head editor's parts). Shown with a lighting setup staged (`setLighting`), it readies that setup instead, which
     * then takes over. Small steps between frames; rejects with the signal's reason once it aborts. Call it again after the V's details are
     * placed: what is ready already costs only a check.
     */
    prepare,
    /**
     * Whether a preparation readied what is drawn now for the lighting asked for (the setup staged, else the one drawn): nothing that decides
     * programs changed since, so its next show, or the staged setup, needs none.
     */
    prepared: () => lightingPrepared(pendingLighting ?? lighting.source),
    /**
     * Hear this runtime needing a preparation while shown (a lighting setup staged, see the header), or no longer needing it (the staged
     * setup was replaced by one ready); its owner calls `prepare`. Returns the unsubscribe.
     */
    onUnprepared: (listener: () => void) => { unpreparedListeners.add(listener); return () => { unpreparedListeners.delete(listener); }; },
    onFrame,
    /** Something the host can't see changed what it draws (for example the selected layer's handles): draw a frame. */
    requestRender: invalidate,
    renderer,
    controls,
    cameraInput,
    /** Lighting preset device (studio stage or creator rig and display pass). */
    lighting,
    head,
    eyes,
    albedo,
    evidence,
    /** The pane moved or changed size: bring the canvas and, while this runtime is shown, its camera to it. */
    resize: () => drawn.shown && device.resize(),
    front,
    /** Frame the whole body (the whole-body view); true when the lens is too narrow to fit it within the orbit's reach. */
    frameBody,
    /** The orbit's distance limits now, derived from the lens, the pane's aspect, the target and what the scene shows. */
    distanceLimits: () => orbitLimits.limits(),
    /** A composed feature's renderer, typed by its factory (the composition root hands its devices what they need; the host names no feature). */
    feature: <R extends FeatureRenderer>(factory: FeatureRendererFactory<R>): R | undefined => features?.get(factory),
    /** The composed features that draw, in creation order. */
    features: () => features?.features() ?? [],
    /** Developer evidence from each feature renderer, by feature. */
    featureEvidence: () => features?.evidence() ?? {},
    /** Each feature renderer's draw-order band, by feature (developer evidence). */
    featureBands: () => features?.bands() ?? {},
    /**
     * Frames drawn of this runtime, the device's requests and recent frame timings; `running: false` means nothing of it is being drawn (the
     * device is idle, or this runtime is hidden). `display`: how frames reach the canvas.
     */
    frameTiming: () => { const stats = device.stats();
      return { ...stats, frames: drawn.frames, running: drawn.shown && stats.running, display: lighting.display.info() }; },
    /** The mouth interior's light (developer evidence): the lip joints measured, the aperture now (metres) and the floor. */
    mouthEvidence: () => ({ lips: mouth.lips, parting: character.mouthParting() }),
    /** Developer comparisons: hold the mouth interior at a fixed parting and floor, or null to follow the face (character-renderer.ts). */
    pinMouthInterior: (pin: { parting: number; floor: number } | null) => { character.pinMouthInterior(pin); invalidate(); },
    maxTextureSize: renderer.capabilities.maxTextureSize,
    eyeShape: rig.eyeShape,
    eyeShapeOptions: rig.eyeShapeOptions,
    applySavedV: rig.applySavedV,
    setFaceMorphs: rig.setFaceMorphs,
    eyeAppearance: character.eyeAppearance,
    setEyeOptics: character.setEyeOptics,
    setHair: (enabled: boolean) => character.setSlotVisible("hair", enabled),
    /** The head options whose parts the view hides (the V's own makeup); a visibility preference, instant. */
    setHiddenOptions: (options: readonly string[]) => character.setHiddenOptions(options),
    /** The host's detail loader (§5): the V's resolved components, each chunk through the adapter for its template. */
    details: character.details,
    setCharacterDetails: character.setCharacterDetails,
    /**
     * Before `setCharacterDetails(details)`: make the parts it adds ready for their first frame while the shown V keeps drawing (maps
     * uploaded a few per frame, layered stacks baked, programs linked off the page's thread; PREV-188/189), so placing them never
     * freezes the page. Stops early when `signal` aborts (a newer change).
     */
    prepareDetails: (details: Parameters<typeof character.prepareDetails>[0], signal?: AbortSignal) => character.prepareDetails(details, { signal,
      compile: object => lighting.prepareSteps(object, camera), frame: nextFrame }),
    /** Release the parts kept for later (another V is being shown: nothing of the previous one lingers in GPU memory). */
    releaseKeptParts: character.releaseKeptParts,
    /** Listen for the placed V's limits changing after it was placed (PREV-74); returns the unsubscribe. */
    onBakeLimits: character.onBakeLimits,
    // With the renderer's live geometry and texture counts, so a V switch or a tried style can be measured (PREV-63).
    characterDetailsEvidence: () => ({ ...character.evidence(), memory: { ...renderer.info.memory } }),
    /** Developer evidence: the drawn parts' dangles (hair physics) and their chain bones' positions. */
    dangleEvidence: () => idle?.dangleEvidence() ?? null,
    /** Piercings are a visibility preference: the V's own (or a tried style) arrive with the character record and follow it. */
    setPiercings: (enabled: boolean) => character.setSlotVisible("piercings", enabled),
    /** The V's body (body, arms, hands, feet and their decals, and the clothes on it) is a visibility preference too; it arrives with the character record. */
    setBody: (enabled: boolean) => { character.setSlotVisible("body", enabled); character.setSlotVisible("clothing", enabled); },
    /** Developer evidence: each baked layered part's packed maps read back at their centre texel. */
    layeredSamples: character.layeredSamples,
    /** The idle rig; its own changes (seek, pause) request a frame through `onChange`. */
    idle,
    /** The game's blink (game-blink.ts); undefined with `evidence.blink.error` when it isn't prepared. */
    blink,
    /** The facial pose sink (head-rig.ts `face`): a held expression's solved pose on the head; every change draws a frame. */
    face: { ...rig.face, setRig: (joints: Parameters<typeof rig.face.setRig>[0]) => { try { rig.face.setRig(joints); } finally { invalidate(); } },
      get ready() { return rig.face.ready; }, get holding() { return rig.face.holding; } },
    // Store the orbit in neutral head space; enabling idle adds its framing offset once.
    cameraState: (): SceneCameraState => ({ position: camera.position.clone().sub(idleFrameOffset).toArray(),
      target: controls.target.clone().sub(idleFrameOffset).toArray(), fov: camera.fov }),
    restoreCamera: (state: SceneCameraState) => {
      frontPending = false;
      camera.fov = state.fov;
      camera.position.fromArray(state.position).add(idleFrameOffset);
      controls.target.fromArray(state.target).add(idleFrameOffset);
      camera.updateProjectionMatrix();
      controls.update();
    },
    setFov: (degrees: number) => {
      const next = THREE.MathUtils.clamp(degrees, 10, 90);
      if (next === camera.fov) return;
      // The centre ray selects the currently viewed head, surface or eye plane.
      // When looking at background, preserve the orbit target plane instead.
      if (!fovGestureAnchor) {
        scene.updateMatrixWorld(true);
        ray.setFromCamera(new THREE.Vector2(), camera);
        head.computeBoundingSphere();
        for (const surface of surfaces.values()) surface.computeBoundingSphere();
        const hit = ray.intersectObjects([head, ...surfaces.values(), eyes], false)[0];
        fovGestureAnchor = (hit?.point ?? controls.target).clone();
      }
      const frame = surfaceAnchoredDistance(
        camera.position.toArray(), controls.target.toArray(), fovGestureAnchor.toArray(), camera.fov, next, orbitLimits.limits(next));
      const orbitDirection = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(orbitDirection, frame.distance);
      camera.fov = next;
      camera.updateProjectionMatrix();
      controls.update();
      return frame.limited;
    },
    endFovGesture: () => { fovGestureAnchor = undefined; },
    setIdle: (enabled: boolean) => { if (rigMotion.setIdle(enabled)) frameIdle(); },
    /** The game's preview idles prepared on this computer (idle-catalogue.ts); the latest (the eyes section joins once the faces are known). */
    get idles() { return motion.idles; },
    /** Listen for the idle's face arriving after the scene started (`evidence.idle` has changed); returns the unsubscribe. */
    onIdleFaceChange: (listener: () => void) => { faceChanged.add(listener); return () => { faceChanged.delete(listener); }; },
    /** Play another of them; the framing follows the new clip's head, as enabling the idle does. */
    selectIdle: async (id: string, signal?: AbortSignal) => {
      if (!motion.selectIdle) throw Error("The game's other idles aren't prepared on this computer.");
      await motion.selectIdle(id, signal);
      frameIdle();
    },
    /**
     * Hold a photo-mode pose on V's body (pose-library-design.md §5.2), or stop holding one (null: the chosen idle's own clips come back;
     * turning the idle off is `setIdle`'s). The camera never moves; the whole-body view frames the posed body when asked. Rejects with a
     * plain reason when V's motion isn't prepared.
     */
    setPose: async (pose: { sample: PoseSample; placement?: PosePlacement } | null) => {
      if (!motion.selectPose || !idle) throw Error("V's motion isn't prepared on this computer, so she can't hold a pose.");
      if (pose) {
        const built = poseClip(pose.sample, pose.placement);
        await motion.selectPose(built);
        rigMotion.poseChanged();
        if (built.start > 0) idle.seek(built.start);
        const box = idle.jointBounds(built.moves ? 12 : 1);
        posedBox = box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
      } else {
        await motion.selectPose(null);
        posedBox = null;
        rigMotion.poseChanged();
      }
      invalidate();
    },
    setIdlePaused: (paused: boolean) => idle?.setPaused(paused),
    /** The scene's dangle simulation (hair with physics; the scene node's setting, off until calibrated). */
    setPhysics: (enabled: boolean) => idle?.setPhysics(enabled),
    /** The drawn parts with a dangle component, and whether any simulates (absent without the idle's rig). */
    dangles: () => idle ? { parts: idle.dangleParts, simulated: idle.simulatedDangles, loaded: character.hasDetails() } : undefined,
    setIdleContributions: (body: boolean, face: boolean) => {
      if (!idle || (idle.bodyEnabled === body && idle.faceEnabled === face)) return;
      idle.setContributions({ body, face }); frameIdle();
    },
    setDetail: (name: "brows" | "lashes", v: boolean) => character.setSlotVisible(name, v),
    setBlink: (v: number) => blink?.setClosure(v),
    animateBlink: (v: boolean) => blink?.setPlaying(v),
    /** Wireframe display of the feature renderers' own surfaces (eye makeup's layers and plate). */
    setWire: (v: boolean) => features?.setWireframe(v),
    /** Whether research tools show: the feature renderers make ahead only what can be chosen (PREV-194). Draws nothing new. */
    setResearchTools: (v: boolean) => features?.setResearchTools(v),
    setNormals: (v: boolean) => {
      rig.setNormals(v);
      character.setNormals(v);
      features?.setNormals(v);
    },
    /** Typed theme input for the stage backdrop; it never changes lighting. */
    setStage: (theme: StageTheme) => backdrop.setTheme(theme),
    /**
     * Light the scene by a lighting setup (lighting-setups.ts), or the built-in game rig for the shown body. While shown, a setup whose
     * programs aren't prepared is staged and drawn once its preparation ends (see the header); anything else is drawn at once.
     */
    setLighting,
    // Rendering options (the Preview quality panel's Rendering group): how this view draws, never the looks or the export.
    /** The skin's screen-space scatter (on) or the wrap stand-in (off). */
    setSkinScatter: (enabled: boolean) => lighting.setScatter(enabled),
    /** The lights' shadow maps on the V (creator and studio setups alike); off draws every light unshadowed. */
    setFaceShadows: (enabled: boolean) => lighting.setShadowsEnabled(enabled),
    /** The strands' Hair look: 0 Crisp (faithful coverage) … 1 Game-like (hair-colour-model.ts `HAIR_LOOK`). */
    setHairLook: (value: number) => character.setHairLook(value),
    /** Evidence: the setup drawn now, and how the room is lit on this GPU. */
    lightingEvidence: () => ({ setup: lighting.shown(), environmentMode: lighting.environment.mode, staged: lighting.staged !== null }),
  };
  // Every call that changes what is drawn requests a frame. Readers (camera state, evidence, options) don't. The host is `api` itself (as with the lighting above), so
  // its getters stay live: a spread copy read `idles` once, before the eyes section joined (PREV-187).
  return Object.assign(api, invalidating(api, ["resize", "front", "frameBody", "setPose", "eyeShape", "applySavedV", "setFaceMorphs", "setEyeOptics", "setHair",
    "setCharacterDetails", "setHiddenOptions", "setPiercings", "setBody", "restoreCamera", "setFov", "setIdle", "setIdlePaused", "setIdleContributions", "setPhysics", "setDetail",
    "setBlink", "animateBlink", "setWire", "setNormals", "setResearchTools", "setStage", "setLighting",
    "setSkinScatter", "setFaceShadows", "setHairLook"], invalidate));
}
