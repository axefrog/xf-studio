import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { previewClipPlanes } from "../../camera-depth";
import { frontCameraDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE, surfaceAnchoredDistance } from "../../camera-framing";
import { coreSceneEvidence } from "../../scene-evidence";
import { bindRenderTriggers, createRenderScheduler, invalidating } from "../../render-scheduler";
import { retainedViewportAspect, visibleViewportSize } from "../../viewport-size";
import { loadCoreDetail, type LoadedCoreDetail } from "../../core-detail-loader";
import { HeadLoadError } from "../../head-load-error";
import { createViewportBackdrop } from "../../viewport-backdrop";
import { attachHeadCameraInput } from "../../head-camera-input";
import type { StageTheme } from "../../stage-backdrop";
import { createLightingPresetStage, type GradingLutLoader } from "../../lighting-preset-stage";
import { loadGradingLut } from "../../browser-grading-lut-device";
import { viewportPixelRatio, watchDevicePixelRatio } from "../../device-pixel-ratio";
import { linearTargetSupported } from "../../linear-display";
import { createStudioLightRig } from "../../studio-light-rig";
import type { StudioLights } from "../../studio-lighting";
import type { FeatureRendererFactory } from "../api/scene";
import { createFeatureRenderers, type FeatureRenderers } from "./feature-renderers";
import { createHeadRig, type MotionLoader } from "./head-rig";
import { createCharacterRenderer } from "./character-renderer";

/**
 * The scene host (feature-module platform §5): the platform's 3D viewport. It owns the WebGL renderer, the camera and its controls,
 * the studio lights and the lighting presets with their display, the stage, render on demand, resizing and the device pixel ratio,
 * context restores and disposal; the head rig (head-rig.ts: the core head, its surfaces, facial shapes and motion) and the character
 * renderer (character-renderer.ts: the V the character context resolved) are the platform's character context. Features draw their
 * own parts through `FeatureRenderer`s it creates from the composition's list, each given only its `SceneHostPort`
 * (platform/api/scene.ts); the host names no feature.
 *
 * A failure at any point after the renderer exists releases what was made so far (WebGL context, canvas, stage, renderers and
 * observers), so a retry starts clean; `dispose()` releases the same when the head is unloaded (PREV-20).
 */

export type SceneHostOptions = {
  stage?: StageTheme;
  /** The feature renderers to create once the head is ready (the composition's list, compose/renderers.ts). */
  renderers?: readonly FeatureRendererFactory[];
  /** The core head record (default: the host's derived preview, core-detail-loader.ts). Probe pages inject a synthetic head. */
  loadCore?: (renderer: THREE.WebGLRenderer) => Promise<LoadedCoreDetail>;
  /** The rig's motion (default: the game idle and blink assets, head-rig.ts). */
  loadMotion?: MotionLoader;
  /** The creator preset's grading LUT (default: the host's). */
  loadLut?: GradingLutLoader;
};
/** A stored orbit, in neutral head space (workspace-state.ts `CameraState` has the same shape). */
export type SceneCameraState = { position: number[]; target: number[]; fov: number };
export type SceneHost = Awaited<ReturnType<typeof createSceneHost>>;

export async function createSceneHost(host: HTMLElement, options: SceneHostOptions = {}) {
  const releases: (() => void)[] = [];
  try { return await assembleHost(host, options, releases); }
  catch (error) { releaseAll(releases); throw error; }
}

/** Runs each release once, newest first; teardown is best effort. */
function releaseAll(releases: (() => void)[]) {
  for (const release of releases.splice(0).reverse()) {
    try { release(); } catch { /* Best effort: the rest still run. */ }
  }
}

async function assembleHost(host: HTMLElement, options: SceneHostOptions, releases: (() => void)[]) {
  // Opaque canvas: the stage is drawn in the scene (viewport-backdrop.ts), and the drawing buffer
  // has no alpha channel, so fragments that write alpha below one (alpha-to-coverage hair, decals)
  // cannot reveal the page behind the canvas. Three always requests an alpha channel for its own
  // context (its `alpha: false` only clears alpha to one), so the context is created here.
  // Both lighting presets draw through a multisampled scene-linear target (linear-display.ts), so the canvas itself
  // needs neither multisampling nor depth. Without a renderable half-float buffer the studio stage draws straight to
  // the canvas, which then gets both back.
  const open = (direct: boolean) => {
    const canvas = document.createElement("canvas");
    return { canvas, direct, context: canvas.getContext("webgl2", {
      alpha: false, antialias: direct, depth: direct, stencil: false, preserveDrawingBuffer: true }) };
  };
  let opened = open(false);
  if (opened.context && !linearTargetSupported(opened.context)) {
    opened.context.getExtension("WEBGL_lose_context")?.loseContext();
    opened = open(true);
  }
  const { canvas, context } = opened;
  if (!context) throw new HeadLoadError("webgl_unavailable", "WebGL 2 is unavailable");
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, context, antialias: opened.direct, depth: opened.direct, preserveDrawingBuffer: true }); }
  catch (error) { throw new HeadLoadError("webgl_unavailable", "WebGL 2 could not start", { cause: error }); }
  renderer.setPixelRatio(viewportPixelRatio(devicePixelRatio));
  renderer.setClearColor(0x14181c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.prepend(renderer.domElement);
  releases.push(() => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  const backdrop = createViewportBackdrop(scene, options.stage ?? "dark");
  releases.push(() => backdrop.dispose());
  const controls = new OrbitControls(camera, renderer.domElement);
  // The binding catalogue, not the controls' default mouse/touch mapping, decides every press.
  const cameraInput = attachHeadCameraInput(renderer.domElement, controls);
  releases.push(() => { cameraInput.dispose(); controls.dispose(); });
  controls.enableDamping = true;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  // OrbitControls leaves an inline `cursor: auto`; the presentation owns viewport cursors (`[data-cursor]`).
  renderer.domElement.style.cursor = "";
  const idleFrameOffset = new THREE.Vector3();
  let frontPending = false;
  function front() {
    frontPending = !visibleViewportSize(host.clientWidth, host.clientHeight);
    const requested = frontCameraDistance(camera.fov,
      retainedViewportAspect(host.clientWidth, host.clientHeight, camera.aspect));
    const distance = Math.min(MAX_CAMERA_DISTANCE - .005, requested);
    camera.position.set(0, 1.67, -distance);
    controls.target.set(0, 1.67, 0.005);
    camera.position.add(idleFrameOffset);
    controls.target.add(idleFrameOffset);
    controls.update();
    return requested > distance;
  }
  front();
  // The studio stage's room environment, key, fill and rim (studio-light-rig.ts).
  const studio = createStudioLightRig(renderer, scene);
  releases.push(() => studio.dispose());
  // Lighting presets: this studio stage (default) or the game's creator screen (lighting-preset-stage.ts).
  const lighting = createLightingPresetStage({ scene, renderer, studioLights: studio.lights, loadLut: options.loadLut ?? (() => loadGradingLut()) });
  releases.push(() => lighting.dispose());
  // The core head, plate, eyes and maps load through one typed render record (see core-detail-loader).
  const core: LoadedCoreDetail = await (options.loadCore ?? loadCoreDetail)(renderer);
  const coreDetail = { identity: core.record.identity, origin: core.record.origin, label: core.record.provenance.label };
  // The feature renderers (compose/renderers.ts), created once the head and its motion are ready.
  let features: FeatureRenderers | undefined;
  // The platform's character context: the head rig and the V drawn on it. Features' meshes attached with `morphs` and the V's drawn
  // details follow the facial shapes with the head's own surfaces.
  const rig = await createHeadRig(scene, core, { releases, loadMotion: options.loadMotion,
    deforming: () => [...features?.followers() ?? [], ...character.drawnMeshes()] });
  const { head, eyes, surfaces, albedo, motion } = rig;
  const { idle, blink, rig: rigMotion } = motion;
  const character = createCharacterRenderer({ scene, renderer, rig, superseded: () => features?.superseded() ?? new Set() });
  // A restored context comes back with empty render targets: the studio stage prefilters its environment again, the feature
  // renderers redraw theirs (eye makeup's composite), and the shown V's layered parts are baked again from their stacks (PREV-62).
  const restored = () => {
    studio.restore(); features?.contextRestored();
    character.contextRestored();
  };
  renderer.domElement.addEventListener("webglcontextrestored", restored);
  releases.push(() => renderer.domElement.removeEventListener("webglcontextrestored", restored));
  function frameIdle() {
    // Stored cameras use neutral space: take the idle's displacement off, then put the current one (zero while it is off) back on.
    camera.position.sub(idleFrameOffset); controls.target.sub(idleFrameOffset);
    rig.idleOffset(idleFrameOffset);
    camera.position.add(idleFrameOffset); controls.target.add(idleFrameOffset);
    controls.update();
  }
  const ray = new THREE.Raycaster();
  let fovGestureAnchor: THREE.Vector3 | undefined;
  let appliedWidth = 0, appliedHeight = 0;
  const resize = () => {
    const size = visibleViewportSize(host.clientWidth, host.clientHeight);
    if (!size) return false;
    if (size.width !== appliedWidth || size.height !== appliedHeight) {
      renderer.setSize(size.width, size.height);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      appliedWidth = size.width; appliedHeight = size.height;
    }
    if (frontPending) front();
    return true;
  };
  const frameListeners = new Set<(dt: number) => void>();
  // Reused every frame: the head centre the clip planes are measured from.
  const centre = new THREE.Vector3();
  // Render on demand (UI-38): a frame is drawn when something visible changed, or while the idle or
  // Play blink runs. The host's own mutators, the feature renderers' changes, the lighting device, the idle,
  // the controls (every orbit and damping step), canvas input, frame listeners and resizes all request one.
  const scheduler = createRenderScheduler({
    clock: { request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle), now: () => performance.now() },
    animating: rigMotion.animating,
    frame(dt) {
      rigMotion.advance(dt);
      if (controls.enabled) controls.update();
      // At long orbits, move the near plane in front of a conservative head
      // envelope so the thin makeup plate retains depth precision.
      centre.set(0, 1.67, 0).add(idleFrameOffset);
      const clip = previewClipPlanes(controls.getDistance(), camera.position.distanceTo(centre));
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
    },
  });
  const invalidate = () => scheduler.invalidate();
  releases.push(() => scheduler.dispose());
  releases.push(bindRenderTriggers(invalidate, { controls, element: renderer.domElement, lighting }));
  // Creator options (exposure, intensity form, cone) don't notify the lighting device's listeners.
  Object.assign(lighting, invalidating(lighting, ["setCreatorOptions"], invalidate));
  releases.push(rigMotion.connect(invalidate));
  const observer = new ResizeObserver(() => { resize(); invalidate(); });
  observer.observe(host);
  releases.push(() => observer.disconnect());
  // A monitor move or page zoom changes the device pixel ratio without resizing the host (UI-46).
  releases.push(watchDevicePixelRatio(window, pixelRatio => { renderer.setPixelRatio(pixelRatio); resize(); invalidate(); }));
  /** Run `callback` before each drawn frame (the viewport draws only when something changed); adding or removing one draws a frame. */
  const onFrame = (callback: (dt: number) => void) => {
    frameListeners.add(callback);
    invalidate();
    return () => { frameListeners.delete(callback); invalidate(); };
  };
  // The feature renderers, through their scene ports only (platform/api/scene.ts).
  features = createFeatureRenderers({ renderer, head, surfaces, skin: character.skin,
    character: character.view, subscribeCharacter: character.subscribe,
    lighting: () => ({ preset: lighting.status().preset }), subscribeLighting: listener => { const off = lighting.subscribe(listener); return () => { off(); }; },
    requestFrame: invalidate, onFrame }, options.renderers ?? []);
  releases.push(() => features?.dispose());
  // A renderer that replaces a resolved slot hides it from the start.
  if (features.superseded().size) character.refreshVisibility();
  resize();
  invalidate();
  const evidence = coreSceneEvidence({ coreDetail, meshes: rig.meshes, blink, blinkError: motion.blinkError,
    eyeShape: { choices: rig.eyeShapeChoices.length, eyesFollow: rig.eyesFollowShape, eyeMorphTargets: eyes.morphTargetInfluences?.length ?? 0 },
    profileEncoding: character.profileEncoding, idle, idleError: motion.idleError });
  const api = {
    scene,
    camera,
    /** Releases the V's details, the feature renderers, the WebGL renderer, its canvas, the stage and observers; the host is unusable afterwards. */
    dispose: () => { character.setCharacterDetails(null); releaseAll(releases); },
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
    resize,
    front,
    /** A composed feature's renderer (the composition root hands its devices what they need; the host names no feature). */
    feature: (id: string) => features?.get(id),
    /** The composed features that draw, in creation order. */
    features: () => features?.features() ?? [],
    /** Developer evidence from each feature renderer, by feature. */
    featureEvidence: () => features?.evidence() ?? {},
    /** Frames drawn, requests and recent frame timings; `running: false` means the viewport is idle. `display`: how frames reach the canvas. */
    frameTiming: () => ({ ...scheduler.stats(), display: lighting.display.info() }),
    maxTextureSize: renderer.capabilities.maxTextureSize,
    eyeShape: rig.eyeShape,
    eyeShapeOptions: rig.eyeShapeOptions,
    applySavedV: rig.applySavedV,
    setFaceMorphs: rig.setFaceMorphs,
    eyeAppearance: character.eyeAppearance,
    setEyeOptics: character.setEyeOptics,
    setHair: (enabled: boolean) => character.setSlotVisible("hair", enabled),
    /** The host's detail loader (§5): the V's resolved components, each chunk through the adapter for its template. */
    details: character.details,
    setCharacterDetails: character.setCharacterDetails,
    /** Listen for the placed V's limits changing after it was placed (PREV-74); returns the unsubscribe. */
    onBakeLimits: character.onBakeLimits,
    // With the renderer's live geometry and texture counts, so a V switch or a tried style can be measured (PREV-63).
    characterDetailsEvidence: () => ({ ...character.evidence(), memory: { ...renderer.info.memory } }),
    /** Piercings are a visibility preference: the V's own (or a tried style) arrive with the character record and follow it. */
    setPiercings: (enabled: boolean) => character.setSlotVisible("piercings", enabled),
    /** Developer evidence: each baked layered part's packed maps read back at their centre texel. */
    layeredSamples: character.layeredSamples,
    /** The idle rig; its own changes (seek, pause) request a frame through `onChange`. */
    idle,
    /** The game's blink (game-blink.ts); undefined with `evidence.blink.error` when it isn't prepared. */
    blink,
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
        camera.position.toArray(), controls.target.toArray(), fovGestureAnchor.toArray(), camera.fov, next);
      const orbitDirection = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(orbitDirection, frame.distance);
      camera.fov = next;
      camera.updateProjectionMatrix();
      controls.update();
      return frame.limited;
    },
    endFovGesture: () => { fovGestureAnchor = undefined; },
    setIdle: (enabled: boolean) => { if (rigMotion.setIdle(enabled)) frameIdle(); },
    setIdlePaused: (paused: boolean) => idle?.setPaused(paused),
    setIdleContributions: (body: boolean, face: boolean) => {
      if (!idle || (idle.bodyEnabled === body && idle.faceEnabled === face)) return;
      idle.setContributions({ body, face }); frameIdle();
    },
    setDetail: (name: "brows" | "lashes", v: boolean) => character.setSlotVisible(name, v),
    setBlink: (v: number) => blink?.setClosure(v),
    animateBlink: (v: boolean) => blink?.setPlaying(v),
    /** Wireframe display of the feature renderers' own surfaces (eye makeup's layers and plate). */
    setWire: (v: boolean) => features?.setWireframe(v),
    setNormals: (v: boolean) => {
      rig.setNormals(v);
      character.setNormals(v);
      features?.setNormals(v);
    },
    setExposure: (v: number) => (renderer.toneMappingExposure = v),
    /** Typed theme input for the stage backdrop; it never changes lighting. */
    setStage: (theme: StageTheme) => backdrop.setTheme(theme),
    setLightAngle: (degrees: number) => studio.setKeyAngle(degrees),
    /** The studio stage's environment, key, fill and rim strengths, key elevation and tint (studio-lighting.ts). */
    setStudioLights: (lights: StudioLights) => studio.setLights(lights),
    /** Evidence: the studio rig's current settings. */
    studioLighting: () => studio.state(),
  };
  // Every call that changes what is drawn requests a frame. Readers (camera state, evidence, options) don't.
  return { ...api, ...invalidating(api, ["resize", "front", "eyeShape", "applySavedV", "setFaceMorphs", "setEyeOptics", "setHair",
    "setCharacterDetails", "setPiercings", "restoreCamera", "setFov", "setIdle", "setIdlePaused", "setIdleContributions", "setDetail",
    "setBlink", "animateBlink", "setWire", "setNormals", "setExposure", "setStage", "setLightAngle", "setStudioLights"], invalidate) };
}
