import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { extendSkin } from "./skin";
import type { SavedV } from "./save-reader";
import { createMakeupStack } from "./engines/layered-makeup/render/makeup-stack";
import type { FineGlitterScope } from "./engines/layered-makeup/region";
import { IdleAnimation } from "./idle-animation";
import { activeEyeShape, GAME_BLINK_MISSING, loadGameBlink, type GameBlink } from "./game-blink";
import { composePreviewMotion } from "./preview-motion";
import type { CameraState } from "./workspace-state";
import { previewClipPlanes } from "./camera-depth";
import { frontCameraDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE, surfaceAnchoredDistance } from "./camera-framing";
import { createEyeMaterial, EYE_FLAT_ROUGHNESS, eyeParameters, IRIS_MASK_ENCODING } from "./eye-material";
import type { ProfileEncoding } from "./hair-colour-model";
import type { AdapterContext } from "./character-material-adapters";
import type { LoadedCharacterComponent, LoadedCharacterDetails } from "./character-detail-loader";
import type { DetailSlot } from "./render-detail";
import { coreAlbedoReader, coreRoughnessReader, createHeadSkinPlacement, morphTargetNames, type BrowUnderlayEvidence, type DecalSurfaceUnderlay, type HeadSkinPlacement } from "./head-skin-placement";
import { priorityRank } from "./render-templates";
import type { DetailLimit } from "./detail-limits";
import { layeredContextRestored } from "./layered-material";
import type { ResolvedSkinSurface } from "./character-material-adapters";
import { characterDetailsEvidence, coreSceneEvidence } from "./scene-evidence";
import { bindRenderTriggers, createRenderScheduler, invalidating } from "./render-scheduler";
import { retainedViewportAspect, visibleViewportSize } from "./viewport-attachment";
import { loadCoreDetail, type LoadedCoreDetail } from "./core-detail-loader";
import { HeadLoadError } from "./head-load-error";
import { faceMorphChoiceIndex, faceMorphChoices, faceMorphWeights, followsFaceMorphChoices, type FaceMorphChoice } from "./face-morphs";
import { createViewportBackdrop } from "./viewport-backdrop";
import { attachHeadCameraInput } from "./head-camera-input";
import type { StageTheme } from "./stage-backdrop";
import { createLightingPresetStage } from "./lighting-preset-stage";
import { loadGradingLut } from "./browser-grading-lut-device";
import { viewportPixelRatio, watchDevicePixelRatio } from "./device-pixel-ratio";
import { linearTargetSupported } from "./linear-display";
import { createStudioLightRig } from "./studio-light-rig";
import type { StudioLights } from "./studio-lighting";

/**
 * Draw order of the face's decals, below the editable makeup plates (10 to 41), the eye's wetness shell (99), brows (100) and
 * lashes (101), and above the opaque skin: the game draws every post-G-buffer decal after the skin, `EMP_Front` templates
 * after `EMP_Normal` ones, and the order between decals of one priority is unknown (knowledge/head-cc-rendering.md section 3).
 * The documented fallback is the creator resource's option order; the Studio's own plate, being authored, draws over the V's
 * own decals. Each chunk gets a slot of its own, so up to 400 decal chunks per priority keep their order.
 */
export const FACE_DECAL_RENDER_ORDER = 2;
export const faceDecalRenderOrder = (priority: string | null | undefined, index: number) =>
  FACE_DECAL_RENDER_ORDER + 4 * priorityRank(priority) + Math.min(index, 399) / 100;

/**
 * Creates the 3D head scene in `host`. A failure at any point after the renderer exists releases
 * what was made so far (WebGL context, canvas, stage and observers), so a retry starts clean; the
 * returned scene's `dispose()` releases the same resources when the head is unloaded (PREV-20).
 */
export async function createScene(
  host: HTMLElement,
  canvases: HTMLCanvasElement[],
  fineGlitter: FineGlitterScope,
  stage: StageTheme = "dark",
) {
  const releases: (() => void)[] = [];
  try { return await assembleScene(host, canvases, fineGlitter, stage, releases); }
  catch (error) { releaseAll(releases); throw error; }
}

/** Runs each release once, newest first; teardown is best effort. */
function releaseAll(releases: (() => void)[]) {
  for (const release of releases.splice(0).reverse()) {
    try { release(); } catch { /* Best effort: the rest still run. */ }
  }
}

async function assembleScene(
  host: HTMLElement,
  canvases: HTMLCanvasElement[],
  fineGlitter: FineGlitterScope,
  stage: StageTheme,
  releases: (() => void)[],
) {
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
  const backdrop = createViewportBackdrop(scene, stage);
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
  const lighting = createLightingPresetStage({ scene, renderer, studioLights: studio.lights, loadLut: () => loadGradingLut() });
  releases.push(() => lighting.dispose());
  // The core head, plate, eyes and maps load through one typed render record (see core-detail-loader).
  const core: LoadedCoreDetail = await loadCoreDetail(renderer);
  const { gltf, meshes, head, plate } = core;
  let eyes = core.eyes;
  scene.add(gltf.scene);
  const coreDetail = { identity: core.record.identity, origin: core.record.origin, label: core.record.provenance.label };
  const { "head.albedo": albedo, "eyes.albedo": eyeColor, "head.normal": normal, "head.roughness": roughness } = core.textures;
  const skin = new THREE.MeshStandardMaterial({
    map: albedo,
    roughness: 0.85,
    roughnessMap: roughness,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.35, -0.35),
  });
  head.material = skin;
  extendSkin(head, skin);
  // The core eye is the fallback: the base game's eye texture through the same eyeball material as a resolved eye
  // (eye-material.ts: colour sampled V-flipped, as the game's program does). The shown V's own eyes come with the
  // character record and replace it, a layered eye design included (drawn through the layered adapter).
  // The game's eye UV0 spans several tiles, so every eye texture repeats.
  eyeColor.wrapS = eyeColor.wrapT = THREE.RepeatWrapping;
  eyeColor.needsUpdate = true;
  const coreEye = createEyeMaterial({ albedo: eyeColor }, eyeParameters({ scalars: {} }));
  const eyeMat = coreEye.material;
  releases.push(() => { eyeMat.dispose(); for (const texture of coreEye.owned) texture.dispose(); });
  eyes.material = eyeMat;
  if (eyes instanceof THREE.SkinnedMesh) extendSkin(eyes, eyeMat);
  let eyeOpticsEnabled = false;
  /** The resolved eyeballs drawn now (empty while the core eye shows). */
  const resolvedEyeballs = () => drawnDetails().flatMap(item => item.eyes?.eyeballs ?? []);
  /** A layered eye design's baked eyeball chunks (the multilayered eye has no refraction or eye light; it replaces the core eye too). */
  const layeredEyes = () => drawnDetails().filter(item => item.component.slot === "eyes").flatMap(item => item.layered ?? [])
    .filter(entry => entry.handle.state === "baked");
  function applyEyeOptics() {
    for (const { handle } of [{ handle: coreEye.handle }, ...resolvedEyeballs()]) handle.setSourceRoughness(eyeOpticsEnabled);
  }
  function setEyeOptics(enabled: boolean) { eyeOpticsEnabled = enabled; applyEyeOptics(); }
  /** Which eye is drawn and how (developer evidence and the status line's optics state). */
  function eyeAppearance() {
    const eyeballs = resolvedEyeballs();
    const item = drawnDetails().find(entry => entry.component.slot === "eyes");
    const shown = eyeballs[0]?.handle ?? coreEye.handle;
    const templates = item ? [...new Set(item.component.materials.map(material => material.template))] : [];
    const layered = layeredEyes();
    return {
      source: eyeballs.length ? "resolved" as const : layered.length ? "layered" as const : "core" as const,
      reason: eyeballs.length ? "resolved" : layered.length ? "layered-design" : item ? "eye-design-not-drawn" : "no-resolved-eye",
      definition: item?.component.definition ?? null, templates, gradient: shown.gradient, irisMaskEncoding: IRIS_MASK_ENCODING,
      coreEyeVisible: eyes.visible, shells: item?.eyes?.shells.length ?? 0,
      optics: { requested: eyeOpticsEnabled, active: shown.sourceRoughness, error: undefined as string | undefined,
        reason: !eyeOpticsEnabled ? "off" : shown.sourceRoughness ? "source-roughness-r" : "no-source-roughness",
        roughnessScale: shown.sourceRoughness ? shown.parameters.roughnessScale : EYE_FLAT_ROUGHNESS },
    };
  }
  // Profile stops are decoded from sRGB before the shader's overlay (see
  // knowledge/hair-shading.md). One explicit choice for hair and lashes.
  const profileEncoding: ProfileEncoding = "srgb-decoded";
  // Where the resolved skin is drawn, and the skin colour under decals read on that same head (head-skin-placement.ts).
  const skinPlacement = createHeadSkinPlacement(head, { coreAlbedo: coreAlbedoReader(albedo), coreRoughness: coreRoughnessReader(roughness) });
  let browUnderlay: BrowUnderlayEvidence | undefined;
  // Resolved character details (skin, face details, brows, lashes, hair, eyes, piercings): loaded later from the host's character record
  // (character-detail-loader.ts) and swapped in whole; each V replaces the previous one completely.
  const detailVisible: Record<DetailSlot, boolean> = { skin: true, face: true, brows: true, lashes: true, hair: true, eyes: true, piercings: true };
  // Keep context details above the entire editable makeup stack (orders 10–41); skin, hair and the eyeballs keep their own order.
  // Face decals sit below the stack (faceDecalRenderOrder).
  const DETAIL_RENDER_ORDER: Record<DetailSlot, number> = { skin: 0, face: FACE_DECAL_RENDER_ORDER, brows: 100, lashes: 101, hair: 0, eyes: 0, piercings: 0 };
  // The eye's wetness shell multiplies what is behind it: after the opaque eye, skin and the makeup plates, before brows and lashes.
  const EYE_SHELL_RENDER_ORDER = 99;
  let characterDetails: LoadedCharacterDetails | null = null;
  /**
   * How the resolved skin is shown (head-skin-placement.ts): on the core head when the launch route's head is
   * the same one-chunk surface (the usual case; the eye plate and idle stay bound to it), otherwise as the
   * resolved head itself with the core head hidden. Null while the fixed default skin shows.
   */
  let resolvedSkin: { item: LoadedCharacterComponent; placement: HeadSkinPlacement } | null = null;
  /** The last skin placed, so a skin component kept across a swap is not compared with the core head again. */
  let placedSkin: { item: LoadedCharacterComponent; placement: HeadSkinPlacement } | null = null;
  let normalsEnabled = true;
  const skinLimits = (): { slot: DetailSlot; limit: DetailLimit }[] => resolvedSkin?.placement.limit ? [{ slot: "skin", limit: resolvedSkin.placement.limit }] : [];
  function detailContext(slot: DetailSlot): Omit<AdapterContext, "slot"> {
    return { overMakeup: slot === "lashes", profileEncoding,
      ...(slot === "face" ? { surface: (mesh: THREE.Mesh, skin?: ResolvedSkinSurface | null) => skinPlacement.surfaceUnderlay(mesh, skin ?? null) } : {}),
      ...(slot === "brows" ? { underlay: (mesh: THREE.Mesh, skin?: ResolvedSkinSurface | null) => {
        const result = skinPlacement.underlay(mesh, skin ?? null);
        browUnderlay = result.evidence;
        return result.attribute;
      } } : {}) };
  }
  const makeup = createMakeupStack(plate, renderer.capabilities.getMaxAnisotropy(), fineGlitter);
  // A restored WebGL context comes back with empty render targets: prefilter the environment again and redraw the composite.
  // A restored context comes back with empty render targets: the studio stage prefilters its environment again, the composite
  // redraws, and the shown V's layered parts are baked again from their stacks (PREV-62): their kept maps died with the context.
  const restored = () => {
    studio.restore(); makeup.contextRestored();
    layeredContextRestored(renderer);
    for (const item of characterDetails?.components ?? []) for (const { handle } of item.layered ?? []) handle.contextRestored();
    // The re-bake's outcome reaches the panel, and the core eye shows only while no layered eye design is baked (PREV-74).
    publishBakeLimits([...skinLimits(), ...bakeLayered()]);
    if (characterDetails) eyes.visible = !resolvedEyeballs().length && !layeredEyes().length;
  };
  renderer.domElement.addEventListener("webglcontextrestored", restored);
  releases.push(() => renderer.domElement.removeEventListener("webglcontextrestored", restored));
  const { plates, materials, updateLayer } = makeup;
  makeup.setCanvases(canvases);
  // The skin under the authored plate, which the plate blends over and lights once with the skin's own light (plate-blend.ts): read on
  // the drawn head, like the face decals' underlay, once per skin change and only when a layer first needs it. A plate not over the
  // drawn head keeps a linear blend per layer; without a resolved skin the plate is lit with the standard light, as the face decals.
  let plateUnderlay: { evidence?: DecalSurfaceUnderlay["evidence"]; error?: string } = {};
  function refreshPlateUnderlay() {
    const item = resolvedSkin?.item, skinSurface: ResolvedSkinSurface | null = item?.skin
      ? { base: item.skin.base, roughness: item.skin.roughness, chunks: item.meshes } : null;
    makeup.setSkinLight(item?.skin?.handle.parameters ?? null);
    plateUnderlay = {};
    makeup.setUnderlaySource(() => {
      try {
        const result = skinPlacement.surfaceUnderlay(plate, skinSurface);
        plateUnderlay = { evidence: result.evidence };
        return result;
      } catch (error) { plateUnderlay = { error: (error as Error).message }; return null; }
    });
  }
  refreshPlateUnderlay();
  let idle: IdleAnimation | undefined, idleError = "";
  try {
    const [motion, facial, binding] = await Promise.all([
      new GLTFLoader().loadAsync("/assets/cc-idle-body.glb"),
      new GLTFLoader().loadAsync("/assets/cc-idle-face.glb"),
      fetch("/assets/cc-idle-binding.json").then(r => { if (!r.ok) throw Error("Idle binding data unavailable"); return r.json(); }),
    ]);
    const clip = motion.animations.find(a => a.name === binding.clip);
    if (!clip) throw Error("Expected character-creator close-up clip is missing");
    const faceClip = facial.animations.find(a => a.name === "ui_closeup_shot_face");
    if (!faceClip) throw Error("Solved facial idle clip is missing");
    // The legacy eyeball preview is rigid geometry. Give each disconnected eye
    // one authoritative eye-joint influence so gaze rotates around the game pivot.
    if (!(eyes instanceof THREE.SkinnedMesh)) {
      facial.scene.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      const eyeBones = ["l_J_eye_JNT","r_J_eye_JNT"].map(name => {
        const reference = facial.scene.getObjectByName(name);
        if (!reference) throw Error(`Missing gaze pivot ${name}`);
        const bone = new THREE.Bone(); bone.name=name;
        reference.matrixWorld.decompose(bone.position,bone.quaternion,bone.scale);
        return bone;
      });
      const geometry = eyes.geometry.clone(), positions = geometry.getAttribute("position");
      const indices = new Uint16Array(positions.count*4), weights = new Float32Array(positions.count*4);
      const point = new THREE.Vector3();
      for (let i=0;i<positions.count;i++) {
        point.fromBufferAttribute(positions,i).applyMatrix4(eyes.matrixWorld);
        indices[i*4] = point.distanceToSquared(eyeBones[0]!.position) < point.distanceToSquared(eyeBones[1]!.position) ? 0 : 1;
        weights[i*4] = 1;
      }
      const triangles = geometry.index;
      if (!triangles) throw Error("Expected indexed eyeball geometry");
      for (let i=0;i<triangles.count;i+=3) {
        const sides = [0,1,2].map(j => indices[triangles.getX(i+j)*4]);
        if (sides[0]!==sides[1] || sides[0]!==sides[2]) throw Error("Eye geometry crosses gaze attachment groups");
      }
      geometry.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(indices,4));
      geometry.setAttribute("skinWeight",new THREE.Float32BufferAttribute(weights,4));
      const skinned = new THREE.SkinnedMesh(geometry,eyeMat);
      // Keep the eye component's own facial morph targets (eye shape) on the rigidly attached copy.
      if (eyes.morphTargetDictionary) {
        skinned.morphTargetDictionary = { ...eyes.morphTargetDictionary };
        skinned.morphTargetInfluences = [...(eyes.morphTargetInfluences ?? [])];
      }
      skinned.name="eyes"; skinned.position.copy(eyes.position);skinned.quaternion.copy(eyes.quaternion);skinned.scale.copy(eyes.scale);
      skinned.frustumCulled=false;
      eyes.parent!.add(skinned); scene.add(...eyeBones); scene.updateMatrixWorld(true);
      skinned.bind(new THREE.Skeleton(eyeBones),skinned.matrixWorld);
      meshes[meshes.indexOf(eyes)] = skinned;
      eyes.removeFromParent(); eyes=skinned;
    }
    const targets: THREE.Object3D[] = [];
    scene.traverse(o => { if (o instanceof THREE.Bone) targets.push(o); });
    idle = new IdleAnimation(motion.scene, clip, targets, binding.ancestry, { source: facial.scene, clip: faceClip });
    if (!idle.bindings.length) throw Error("Idle rig has no matching bones");
  } catch (error) {
    idle = undefined; idleError = (error as Error).message;
  }
  // The game's own blink (game-blink.ts), bound by name to every rig bone present now (the eyeball joints above included);
  // each V's details join it with the idle. Without the local asset the blink controls stay off with plain guidance.
  let blink: GameBlink | undefined, blinkError = "";
  try {
    const targets: THREE.Object3D[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse(o => { if (o instanceof THREE.Bone) targets.push(o); });
    blink = await loadGameBlink(targets);
  } catch (error) {
    blink = undefined; blinkError = (error as Error).message || GAME_BLINK_MISSING;
  }
  // One owner of the rig's bones at a time: the idle while enabled, otherwise the blink (preview-motion.ts).
  const rigMotion = composePreviewMotion(idle, blink);
  function frameIdle() {
    // Stored cameras use neutral space. Always derive the displacement at phase
    // zero so restoring a paused/nonzero phase never adds a different offset.
    camera.position.sub(idleFrameOffset); controls.target.sub(idleFrameOffset);
    idleFrameOffset.set(0, 0, 0);
    if (idle?.enabled) {
      const time = idle.time;
      idle.seek(0);
      const anchor = idle.bindings.find(b => b.bone.name === "Head");
      if (anchor) idleFrameOffset.setFromMatrixPosition(anchor.bone.matrixWorld)
        .sub(new THREE.Vector3().setFromMatrixPosition(anchor.worldBind));
      idle.seek(time);
      camera.position.add(idleFrameOffset); controls.target.add(idleFrameOffset);
    }
    controls.update();
  }
  // Every mesh with facial morph targets follows the character-creator morph choices. The eye
  // component carries its own `eyes` targets (a separate morph resource in the game), paired with
  // the head's by (target, region); see face-morphs.ts.
  const coreDeforming: THREE.Mesh[] = [
    head,
    plate,
    ...(eyes.morphTargetDictionary ? [eyes] : []),
  ];
  // Resolved details join and leave with each character record (a skin drawn on the core head adds no mesh).
  const drawnDetails = () => characterDetails?.components.filter(item => !(resolvedSkin?.placement.mode === "core-head" && resolvedSkin.item === item)) ?? [];
  const deforming = () => [...coreDeforming, ...drawnDetails().flatMap(item => item.meshes)];
  // The head is the authority for which eye shapes exist: its `eyes` targets in resource order.
  const eyeShapeChoices: FaceMorphChoice[] = faceMorphChoices(morphTargetNames(head), "eyes");
  const eyesFollowShape = followsFaceMorphChoices(morphTargetNames(eyes), eyeShapeChoices);
  function applyFaceMorph(choice: FaceMorphChoice) {
    for (const m of deforming()) {
      if (!m.morphTargetInfluences) continue;
      for (const [i, weight] of faceMorphWeights(morphTargetNames(m), choice.region, choice.target)) m.morphTargetInfluences[i] = weight;
    }
    // The blink turns the lids about the eye shape's own joint binds (game-blink.ts).
    blink?.setShape(activeEyeShape(head));
  }
  /** The eye shape the preview's own control chose last; it stays on top of the V's facial shape. */
  let shownEyeShape: number | null = null;
  function eyeShape(index: number) {
    const choice = eyeShapeChoices[index];
    if (!choice) throw Error("That eye shape is not in this head.");
    shownEyeShape = index;
    applyFaceMorph(choice);
  }
  /**
   * The V's facial shape from the character context (region → target pairs of the third-person group): every morph the head and its
   * plates carry is set to the pairs given (the base shape where none is), then the preview's eye shape is put back on top. Pairs the
   * head doesn't carry are skipped and returned.
   */
  function setFaceMorphs(morphs: readonly { region: string; target: string }[]): string[] {
    const names = morphs.map(m => `${m.target}_${m.region}`);
    const missing = names.filter(name => head.morphTargetDictionary?.[name] === undefined);
    for (const mesh of deforming()) {
      mesh.morphTargetInfluences?.fill(0);
      for (const name of names) {
        const i = mesh.morphTargetDictionary?.[name];
        if (i !== undefined) mesh.morphTargetInfluences![i] = 1;
      }
    }
    if (shownEyeShape !== null && eyeShapeChoices[shownEyeShape]) applyFaceMorph(eyeShapeChoices[shownEyeShape]!);
    blink?.setShape(activeEyeShape(head));
    return missing;
  }
  function eyeShapeOptions() {
    return { choices: eyeShapeChoices.map(choice => ({ ...choice })), eyesFollow: eyesFollowShape,
      eyeSource: core.record.geometry.morphs?.find(entry => entry.node === core.record.geometry.nodes.eyes)?.depotPath ?? null };
  }
  /** Piercings are a visibility preference: the V's own (or a tried style) arrive with the character record and follow it. */
  function setPiercings(enabled: boolean) { detailVisible.piercings = enabled; refreshDetailVisibility(); }
  function applySavedV(v: SavedV) {
    if (v.isMale)
      throw Error(
        "This study currently contains a female head. Male head assets are still needed.",
      );
    // The third-person head consumes `TPP`; `character_customization` (the creator puppet) can list fewer
    // morph regions (a new-game save stores only eyes and nose there, all five in TPP) [resource].
    const group =
      v.groups.head.find((g) => g.name === "TPP") ??
      v.groups.head.find((g) => g.name === "character_customization");
    if (!group)
      throw Error("No supported facial morph group found.");
    // A V whose every face region is the base shape stores no morphs; that is the base head.
    const names = group.morphs.map((m) => `${m.target}_${m.region}`);
    for (const mesh of [head, ...plates])
      for (const name of names)
        if (mesh.morphTargetDictionary?.[name] === undefined)
          throw Error(
            `This preview does not contain the saved facial morph ${name}`,
          );
    for (const mesh of deforming()) {
      mesh.morphTargetInfluences?.fill(0);
      for (const name of names) {
        const i = mesh.morphTargetDictionary?.[name];
        if (i !== undefined) mesh.morphTargetInfluences![i] = 1;
      }
    }
    blink?.setShape(activeEyeShape(head));
    const savedEyes = group.morphs.find(m => m.region === "eyes");
    // No saved `eyes` pair means the base shape (`None`); the save stores only chosen morphs.
    const savedEyeShape = faceMorphChoiceIndex(eyeShapeChoices, savedEyes?.target ?? null);
    // The saved eye colour and piercings arrive with the character record (setCharacterDetails), like the skin, brows, lashes and hair.
    return {
      applied: names,
      appearanceReferences: group.appearances.length,
      ...(savedEyeShape === undefined ? {} : { eyeShape: savedEyeShape }),
    };
  }
  function refreshDetailVisibility() {
    for (const item of drawnDetails()) item.root.visible = detailVisible[item.component.slot];
    // A layered part of a slot that was hidden is baked when the slot is first shown (PREV-63); its outcome reaches the panel (PREV-74).
    if (characterDetails) publishBakeLimits([...skinLimits(), ...bakeLayered()]);
  }
  /**
   * The placed V's limits (its skin placement's and its bakes') when they change after `setCharacterDetails` returned them: a slot
   * shown later, a re-bake after a context restore (PREV-74).
   */
  const bakeLimitListeners = new Set<(limits: { slot: DetailSlot; limit: DetailLimit }[]) => void>();
  let publishedBakeLimits = "[]";
  function publishBakeLimits(limits: { slot: DetailSlot; limit: DetailLimit }[]) {
    const text = JSON.stringify(limits);
    if (text === publishedBakeLimits) return;
    publishedBakeLimits = text;
    for (const listener of bakeLimitListeners) listener(limits.map(entry => ({ ...entry })));
  }
  function setHair(enabled: boolean) { detailVisible.hair = enabled; refreshDetailVisibility(); }
  /**
   * Swap in a character's resolved details, replacing the previous ones completely (null removes them). Components the new details
   * took over unchanged from the previous ones (a tried piercing style keeps the rest of the V; PREV-68) stay as they are: their
   * objects, materials and bakes are kept, only released parts are disposed. The new meshes follow the head's current facial shapes
   * and join the idle rig.
   */
  function setCharacterDetails(next: LoadedCharacterDetails | null): { limits: { slot: DetailSlot; limit: DetailLimit }[] } {
    if (characterDetails === next) return { limits: [...skinLimits(), ...bakeLayered()] };
    const previous = characterDetails;
    const drawnBefore = drawnDetails();
    characterDetails = null;
    next?.adopt();
    const kept = new Set(next?.components ?? []);
    if (previous) {
      rigMotion.detach(drawnBefore.flatMap(item => item.bones));
      for (const item of previous.components) for (const mesh of item.meshes) {
        const index = meshes.indexOf(mesh); if (index >= 0) meshes.splice(index, 1);
      }
      // Nothing of the previous V's skin or eyes may linger: the core head and eye return to their fixed defaults.
      head.material = skin;
      head.visible = true;
      eyes.visible = true;
      resolvedSkin = null;
    }
    // The previous V is released after the new one has baked, so a tried style can share a bake it keeps (PREV-78).
    const releasePrevious = () => previous?.dispose(kept);
    refreshPlateUnderlay();
    if (!next) { releasePrevious(); publishedBakeLimits = "[]"; return { limits: [] }; }
    // The same placement the brow decals were projected with (decided once per loaded skin).
    const skinItem = next.components.find(item => item.component.slot === "skin" && item.skin);
    if (skinItem) {
      // A skin kept from the previous details keeps its placement (comparing it with the core head again would decide the same).
      const placement = placedSkin?.item === skinItem ? placedSkin.placement : skinPlacement.place(skinItem.meshes);
      placedSkin = { item: skinItem, placement };
      if (placement.mode === "core-head") {
        head.material = skinItem.meshes[0]!.material;
        // A skin kept from the previous details already drew on the core head with this material's extension.
        const material = head.material as THREE.MeshStandardMaterial;
        if (!material.userData.xfsHeadExtended) { extendSkin(head, material); material.userData.xfsHeadExtended = true; }
      } else head.visible = false;
      resolvedSkin = { item: skinItem, placement };
      skinItem.skin!.handle.setNormals(normalsEnabled);
      refreshPlateUnderlay();
    }
    for (const item of next.components) for (const decal of item.decals ?? []) decal.handle.setNormals(normalsEnabled);
    characterDetails = next;
    // Face decals draw by template priority, then in the record's order (the creator option order), each chunk after the last.
    const faceOrder = new Map<THREE.Mesh, number>();
    for (const [index, { mesh, chunk }] of next.components.flatMap(item => item.decals ?? []).entries())
      faceOrder.set(mesh, faceDecalRenderOrder(chunk.materialPriority, index));
    for (const item of drawnDetails()) {
      const shells = new Set<THREE.Mesh>(item.eyes?.shells.map(entry => entry.mesh) ?? []);
      for (const mesh of item.meshes) {
        mesh.renderOrder = shells.has(mesh) ? EYE_SHELL_RENDER_ORDER : faceOrder.get(mesh) ?? DETAIL_RENDER_ORDER[item.component.slot];
        // A component kept from the previous details already carries the skinning extension (it wraps the material's compile once).
        if (!mesh.userData.xfsSkinExtended) { extendSkin(mesh, mesh.material as THREE.MeshStandardMaterial); mesh.userData.xfsSkinExtended = true; }
        // Facial shapes: the same (target, region) names as the head's.
        for (const [key, index] of Object.entries(mesh.morphTargetDictionary ?? {}))
          mesh.morphTargetInfluences![index] = head.morphTargetInfluences?.[head.morphTargetDictionary?.[key] ?? -1] ?? 0;
        meshes.push(mesh);
      }
      scene.add(item.root);
    }
    // Layered chunks (piercings, eye designs): each stack is baked once into surface maps with this renderer, then lit per frame.
    const bakeLimits = bakeLayered();
    releasePrevious();
    publishedBakeLimits = JSON.stringify([...skinLimits(), ...bakeLimits]);
    // The V's own eyeball (a baked layered design's included) replaces the core eye.
    eyes.visible = !resolvedEyeballs().length && !layeredEyes().length;
    applyEyeOptics();
    scene.updateMatrixWorld(true);
    // The blink binds first: it must capture the details' neutral pose before a playing idle poses them.
    rigMotion.attach(drawnDetails().flatMap(item => item.bones));
    refreshDetailVisibility();
    return { limits: [...skinLimits(), ...bakeLimits] };
  }
  /**
   * Bake every layered stack of the shown V that is not baked yet (layered-material.ts). A failed bake leaves that chunk hidden and is
   * reported with the slot's code: the eye design (the core eye then shows) or a layered part. A slot the viewer hides (piercings,
   * hair) is baked when it is first shown, so a hidden part costs no GPU memory (PREV-63).
   */
  function bakeLayered(): { slot: DetailSlot; limit: DetailLimit }[] {
    const limits: { slot: DetailSlot; limit: DetailLimit }[] = [];
    for (const item of characterDetails?.components ?? []) for (const { mesh, handle } of item.layered ?? []) {
      if (handle.state === "pending" && detailVisible[item.component.slot]) handle.bake(renderer);
      if (handle.state !== "failed") continue;
      mesh.visible = false;
      const limit: DetailLimit = item.component.slot === "eyes" ? "eye-design" : "layered-material";
      if (!limits.some(entry => entry.slot === item.component.slot && entry.limit === limit)) limits.push({ slot: item.component.slot, limit });
    }
    return limits;
  }
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let fovGestureAnchor: THREE.Vector3 | undefined;
  function pick(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    plate.computeBoundingSphere();
    return ray.intersectObject(plate, false)[0]?.uv;
  }
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
  const frameListeners = new Set<() => void>();
  // Reused every frame: the head centre the clip planes are measured from.
  const centre = new THREE.Vector3();
  // Render on demand (UI-38): a frame is drawn when something visible changed, or while the idle or
  // Play blink runs. The scene's own mutators, the makeup stack, the lighting device, the idle, the
  // controls (every orbit and damping step), canvas input, frame listeners and resizes all request one.
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
        for (const update of frameListeners) update();
      }
      // The plate's composite, only after a layer or the skin changed (plate-blend.ts).
      makeup.prepareBlend(renderer);
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
  resize();
  invalidate();
  const evidence = coreSceneEvidence({ coreDetail, meshes, blink, blinkError,
    eyeShape: { choices: eyeShapeChoices.length, eyesFollow: eyesFollowShape, eyeMorphTargets: eyes.morphTargetInfluences?.length ?? 0 },
    profileEncoding, idle, idleError });
  const api = {
    scene,
    camera,
    /** Releases the renderer, its canvas, the stage and observers; the scene is unusable afterwards. */
    dispose: () => { setCharacterDetails(null); releaseAll(releases); },
    /** Run `callback` before each drawn frame (the viewport draws only when something changed; see `requestRender`). */
    onFrame: (callback: () => void) => {
      frameListeners.add(callback);
      return () => { frameListeners.delete(callback); invalidate(); };
    },
    /** Something the scene can't see changed what it draws (for example the selected layer's handles): draw a frame. */
    requestRender: invalidate,
    renderer,
    controls,
    cameraInput,
    /** Lighting preset device (studio stage or creator rig and display pass). */
    lighting,
    head,
    eyes,
    plate,
    plates,
    materials,
    albedo,
    evidence,
    resize,
    front,
    pick,
    updateLayer,
    setLayerCanvases: makeup.setCanvases,
    reconcileLayerCanvases: makeup.reconcileLayerCanvases,
    setLayerCanvas: makeup.setLayerCanvas,
    needsOptics: makeup.needsOptics,
    needsAlbedo: makeup.needsAlbedo,
    makeupDiagnostics: makeup.diagnostics,
    /** How the authored plate is drawn: the export plan's layers in one lit plate, its light, the skin underlay's source and the composite. */
    plateBlendEvidence: () => ({ ...makeup.blendDiagnostics(), source: plateUnderlay }),
    /** Developer evidence: each baked layered part's packed maps read back at their centre texel (colour + roughness, normal + metalness). */
    layeredSamples: () => (characterDetails?.components ?? []).flatMap(item => (item.layered ?? []).map(({ mesh, handle }) => {
      const target = handle.target;
      if (!target) return { mesh: mesh.name, state: handle.state };
      const read = (index: number) => { const pixel = new Uint8Array(4);
        renderer.readRenderTargetPixels(target, target.width >> 1, target.height >> 1, 1, 1, pixel, undefined, index); return [...pixel]; };
      return { mesh: mesh.name, state: handle.state, colour: read(0), normal: read(1) };
    })),
    /** Frames drawn, requests and recent frame timings; `running: false` means the viewport is idle. `display`: how frames reach the canvas. */
    frameTiming: () => ({ ...scheduler.stats(), display: lighting.display.info() }),
    maxTextureSize: renderer.capabilities.maxTextureSize,
    eyeShape,
    eyeShapeOptions,
    applySavedV,
    setFaceMorphs,
    eyeAppearance,
    setEyeOptics,
    setHair,
    setCharacterDetails,
    /** Listen for the placed V's limits changing after it was placed (PREV-74); returns the unsubscribe. */
    onBakeLimits(listener: (limits: { slot: DetailSlot; limit: DetailLimit }[]) => void) {
      bakeLimitListeners.add(listener);
      return () => { bakeLimitListeners.delete(listener); };
    },
    detailContext,
    // With the renderer's live geometry and texture counts, so a V switch or a tried style can be measured (PREV-63).
    characterDetailsEvidence: () => ({ ...characterDetailsEvidence({ details: characterDetails, skin: resolvedSkin, head, browUnderlay,
      eyes: { core: eyes, appearance: eyeAppearance() } }), memory: { ...renderer.info.memory } }),
    setPiercings,
    /** The idle rig; its own changes (seek, pause) request a frame through `onChange`. */
    idle,
    /** The game's blink (game-blink.ts); undefined with `evidence.blink.error` when it isn't prepared. */
    blink,
    // Store the orbit in neutral head space; enabling idle adds its framing offset once.
    cameraState: (): CameraState => ({ position: camera.position.clone().sub(idleFrameOffset).toArray(),
      target: controls.target.clone().sub(idleFrameOffset).toArray(), fov: camera.fov }),
    restoreCamera: (state: CameraState) => {
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
      // The centre ray selects the currently viewed head, plate or eye plane.
      // When looking at background, preserve the orbit target plane instead.
      if (!fovGestureAnchor) {
        scene.updateMatrixWorld(true);
        ray.setFromCamera(new THREE.Vector2(), camera);
        head.computeBoundingSphere();
        plate.computeBoundingSphere();
        const hit = ray.intersectObjects([head, plate, eyes], false)[0];
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
    setDetail: (name: "brows" | "lashes", v: boolean) => {
      detailVisible[name] = v; refreshDetailVisibility();
    },
    setBlink: (v: number) => blink?.setClosure(v),
    animateBlink: (v: boolean) => blink?.setPlaying(v),
    setWire: makeup.setWire,
    setNormals: (v: boolean) => {
      normalsEnabled = v;
      skin.normalScale.set(v ? 0.35 : 0, v ? -0.35 : 0);
      resolvedSkin?.item.skin?.handle.setNormals(v);
      makeup.setNormals(v);
      for (const item of characterDetails?.components ?? []) for (const decal of item.decals ?? []) decal.handle.setNormals(v);
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
  return { ...api, ...invalidating(api, ["onFrame", "resize", "front", "updateLayer", "setLayerCanvases", "reconcileLayerCanvases",
    "setLayerCanvas", "eyeShape", "applySavedV", "setFaceMorphs", "setEyeOptics", "setHair", "setCharacterDetails", "setPiercings",
    "restoreCamera", "setFov", "setIdle", "setIdlePaused", "setIdleContributions", "setDetail", "setBlink", "animateBlink", "setWire",
    "setNormals", "setExposure", "setStage", "setLightAngle", "setStudioLights"], invalidate) };
}
