import * as THREE from "three";
import { creatorCamera, creatorShadowMapSize, creatorShadowRadius, CREATOR_SHADOW, DEFAULT_CREATOR_LIGHTING, type BodySex,
  type CreatorCameraPage, type LightingPreset, type Vec3 } from "../creator-lighting";
import { aimShadowAtHead } from "./creator-lighting-rig";
import { createLinearDisplay } from "./linear-display";
import type { GradingLut, GradingLutSource } from "../grading-lut";
import { installShadowFilter } from "./shadow-filter";
import { installLinearFalloff, LINEAR_FALLOFF_DECAY } from "./linear-falloff";
import { createSkinScatter } from "../../platform/scene/skin-scatter";
import { createContactShadows, setContactShadows } from "../../platform/scene/contact-shadow";
import { bodyCastersOnly, contactOnly, setBodyCastersOnly } from "../../platform/scene/shadow-casters";
import { contactShadowUniforms } from "../../materials/render/skin-material";
import type { ScatterQuality } from "../../platform/scene/skin-scatter-kernel";
import { createStudioEnvironment, type StudioEnvironment } from "./studio-environment";
import { DEFAULT_STUDIO_STAGE } from "../studio-lighting";
import { resolveLightingSource, studioStageSetup, type LightingSetup, type LightingSource, type SetupLight } from "../lighting-setups";
import { applyRendererState, SCENE_RENDERER_STATE, type RendererState } from "../../platform/scene/renderer-state";
import { linkedPrograms, releaseShadersWithPrograms, type LinkedProgram } from "../../materials/render/linked-programs";
import { isDrawable } from "../../platform/scene/drawables";

/** What the lighting device reports (read-only; the presentation turns it into plain text). `preset` is the shown setup's display. */
export type LightingStageStatus = {
  preset: LightingPreset;
  sex: BodySex;
  /** The creator calibration's unfitted default exposure, for a reset control. */
  defaultExposure: number;
  lut: { phase: "idle" | "loading" | "ready"; source: GradingLutSource | null };
};
/** `file` names the host's decoded cube (null for neutral); `unreachable` marks an answer that never reached the host. */
export type GradingLutLoader = () => Promise<{ lut: GradingLut | null; source: GradingLutSource; file?: string | null; unreachable?: boolean }>;
/** How often the game display asks the host again while it is shown (PREV-40). */
export const LUT_RECHECK_MS = 20_000;
/** The studio key's distance from the head: a directional light there keeps the old rig's shadow far plane exactly. */
const KEY_DISTANCE = Math.hypot(Math.hypot(0.3, 0.5), 1.9 - 1.67);

type RigLight = THREE.DirectionalLight | THREE.SpotLight;
const isSpot = (light: RigLight): light is THREE.SpotLight => (light as THREE.SpotLight).isSpotLight === true;

/**
 * Three adapter for a setup's light list (lighting-setups.ts): one Three light per setup light, in the setup's order, in one group.
 * An edit that keeps each light's type updates the lights in place (a drag allocates nothing); a changed type or count replaces the
 * lights that differ. Shadows follow the creator rig's rules (knowledge/creator-lighting.md §12): a spot light's map is a square frustum
 * aimed at the focus (`aimShadowAtHead`), a directional light's a square orthographic map over the head and shoulders, both soft PCF
 * with the preview quality's size. Directional lights come before spot lights in Three's uniforms whatever their order here, and
 * within a type the order is the setup's, so the studio key stays the first directional light as the glint shader expects.
 */
export function createLightListRig() {
  const group = new THREE.Group();
  group.name = "xfs-lighting-rig";
  const focus = new THREE.Vector3();
  const objects: RigLight[] = [];
  let lights: readonly SetupLight[] = [], mapSize = 1024;
  const configureShadow = (light: RigLight) => {
    const shadow = light.shadow;
    shadow.map?.dispose(); shadow.map = null;
    shadow.mapSize.set(mapSize, mapSize);
    shadow.bias = CREATOR_SHADOW.bias; shadow.normalBias = CREATOR_SHADOW.normalBias;
    shadow.radius = creatorShadowRadius(mapSize);
  };
  const create = (type: SetupLight["type"]): RigLight => {
    const light = type === "spot" ? new THREE.SpotLight() : new THREE.DirectionalLight();
    if (isSpot(light)) aimShadowAtHead(light.shadow, focus, CREATOR_SHADOW.focusRadius);
    return light;
  };
  const update = (light: RigLight, spec: SetupLight, fresh: boolean) => {
    light.name = `xfs-light-${spec.id}`;
    light.color.setRGB(spec.colour[0], spec.colour[1], spec.colour[2], THREE.LinearSRGBColorSpace);
    light.intensity = spec.intensity;
    light.position.set(spec.position[0], spec.position[1], spec.position[2]);
    light.target.position.set(spec.target[0], spec.target[1], spec.target[2]);
    if (isSpot(light)) {
      // The game's linear falloff, per fragment (linear-falloff.ts): the radius as the distance, a negative decay as the mark.
      light.distance = spec.linearRadius ?? spec.distance; light.decay = spec.linearRadius ? LINEAR_FALLOFF_DECAY : spec.decay;
      light.angle = spec.angle; light.penumbra = spec.penumbra;
    }
    const was = light.castShadow;
    light.castShadow = spec.shadows;
    // The game's character contact shadows (platform/scene/contact-shadow.ts), on a light that shadows at all: the shadow switch turns both off.
    setContactShadows(light, spec.shadows && !!spec.game && spec.game.contactShadows !== "none");
    // A light the game shadows only by the contact march: its map is a stand-in and holds the body's own shapes, no hair (shadow-casters.ts).
    setBodyCastersOnly(light.shadow, contactOnly(spec.game));
    if (!spec.shadows) return;
    if (!isSpot(light)) {
      const d = Math.hypot(spec.position[0] - spec.target[0], spec.position[1] - spec.target[1], spec.position[2] - spec.target[2]);
      const r = CREATOR_SHADOW.focusRadius, camera = light.shadow.camera;
      camera.left = camera.bottom = -r; camera.right = camera.top = r;
      camera.near = -2 * r; camera.far = (Math.abs(d - KEY_DISTANCE) < 1e-9 ? KEY_DISTANCE : d) + 2 * r;
      camera.updateProjectionMatrix();
    }
    if (fresh || !was) configureShadow(light);
  };
  return {
    group,
    /** Show a light list about a focus point (the head its placements and shadow maps centre on). */
    apply(next: readonly SetupLight[], at: Vec3) {
      focus.set(at[0], at[1], at[2]);
      let structure = next.length !== objects.length;
      for (let i = 0; i < Math.max(next.length, objects.length); i++) {
        const spec = next[i], light = objects[i];
        if (light && (!spec || (spec.type === "spot") !== isSpot(light))) {
          light.shadow.map?.dispose(); light.dispose();
          objects[i] = undefined as unknown as RigLight;
          structure = true;
        }
        if (!spec) continue;
        const fresh = !objects[i];
        if (fresh) objects[i] = create(spec.type);
        update(objects[i]!, spec, fresh);
      }
      objects.length = next.length;
      // The group holds the lights in the setup's order (a replaced light goes back in its place).
      if (structure) { group.clear(); for (const light of objects) group.add(light, light.target); }
      lights = next;
    },
    /** The shadow maps' size (the preview quality's; creatorShadowMapSize). */
    setShadowMapSize(size: number) {
      if (size === mapSize) return;
      mapSize = size;
      for (const light of objects) if (light.castShadow) configureShadow(light);
    },
    get shadowMapSize() { return mapSize; },
    /** The Three lights, in the setup's order (evidence and tests). */
    get objects(): readonly RigLight[] { return objects; },
    get lights(): readonly SetupLight[] { return lights; },
    /** Developer evidence (verification only): show one light alone by its setup ID, or all of them again with null. */
    solo(id: string | null) { objects.forEach((light, i) => { light.visible = id === null || lights[i]?.id === id; }); },
    dispose() {
      for (const light of objects) { light.shadow.map?.dispose(); light.dispose(); }
      objects.length = 0; group.clear(); group.removeFromParent();
    },
  };
}
export type LightListRig = ReturnType<typeof createLightListRig>;

/**
 * The viewport's lighting (Three adapter for lighting-setups.ts): the shown setup's lights, its surroundings (the room environment at its
 * strength, or none; the stage backdrop or black) and its display transform, all drawn through one scene-linear display
 * (linear-display.ts; knowledge/creator-lighting.md §9). Every setup, built-in or the person's own, draws through this one path, so an
 * unedited fork draws exactly as its built-in. The built-in Character creator arrives as the game rig and is resolved here for the body
 * shown (`setBodySex`), so a masculine V gets the masculine rig.
 *
 * The room is the studio environment (studio-environment.ts): the prefiltered `RoomEnvironment` as `scene.environment`, or without a
 * half-float buffer its light probe; a setup with no room light has neither. Three recompiles the lit materials when the number or type
 * of lights, or whether there is a room, changes; values alone never recompile.
 *
 * While a setup draws through the game display the LUT is requested from the host when it turns on and re-checked every
 * `LUT_RECHECK_MS`. The host keys its answer by the installation fingerprint the character details use, so a changed route, profile or
 * LUT mod, or WolvenKit becoming ready, is picked up without a restart. Until the first answer arrives the neutral grade shows; later
 * answers replace the grade only when the host's cube changed, and an answer that never reached the host keeps the current grade.
 *
 * Every setup lights the V's skin with the game's screen-space scatter (platform/scene/skin-scatter.ts) whenever the display's target is
 * half float; the skin light's wrap stands in for it otherwise, and while it is switched off (a verification switch for A/B evidence).
 * Its kernel's sample count follows the preview quality (`scatterQualityFor`).
 *
 * The renderer may be shared with other scenes (the renderer device's, profiles phase 4a-ii), so the stage never leaves its own state on
 * it: its exposure, shadow switches and the rest are its renderer-state record (platform/scene/renderer-state.ts), applied at the start
 * of every draw and of every compile ahead, and the shadow maps' pending redraw is its own flag, set on every draw.
 *
 * **A staged setup** (profiles phase 4a-v-b). A setup whose programs aren't linked yet can be staged beside the one drawn (`stage`): it gets
 * a light rig of its own, outside the drawn scene, and is put in place only for the length of a synchronous call (`withStaged`), so the
 * scene's programs can be compiled ahead and warmed up for it while every drawn frame still shows the setup before. `setSource` with the
 * staged setup then adopts it: its rig, with the lights and shadow maps its warm-up made, becomes the drawn one, and nothing is rebuilt.
 */
export function createLightingSetupStage(options: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  loadLut: GradingLutLoader;
  /** What the studio backdrop is (the stage backdrop's texture, viewport-backdrop.ts); the scene's background when created by default. */
  studioBackground?: THREE.Scene["background"];
  /** The room (tests pass a stand-in; the default prefilters Three's `RoomEnvironment` or makes its light probe). */
  createEnvironment?: (renderer: THREE.WebGLRenderer, scene: THREE.Scene) => StudioEnvironment;
}) {
  const { scene, renderer } = options;
  const studioBackground = options.studioBackground === undefined ? scene.background : options.studioBackground;
  const environment = (options.createEnvironment ?? createStudioEnvironment)(renderer, scene);
  // The prefiltered room (null with the light probe instead); a setup with room light shows it, one without has no environment.
  const room = scene.environment;
  const display = createLinearDisplay(renderer), scatter = createSkinScatter(renderer);
  // The drawn setup's light rig; a staged setup's rig takes its place in the holder only inside `withStaged`, or for good once adopted.
  let rig = createLightListRig();
  const contact = createContactShadows(renderer, contactShadowUniforms);
  let contactOn = true;
  const lightsHolder = new THREE.Group();
  lightsHolder.name = "xfs-lighting";
  lightsHolder.add(rig.group);
  scene.add(lightsHolder);
  // Shadow maps render only for lights that cast; soft PCF with a per-light radius (the record's shadow switches). They are drawn again
  // only when what casts or lights them changed (`shadowState`), not for a camera move: a static V orbited keeps its maps.
  installShadowFilter();
  installLinearFalloff();
  /** This scene's renderer-global state, applied before it draws or compiles; `apply` keeps its studio exposure. */
  const state: RendererState = { ...SCENE_RENDERER_STATE, shadowMap: { ...SCENE_RENDERER_STATE.shadowMap } };
  const applyState = (shadowNeedsUpdate?: boolean) => applyRendererState(renderer, state, shadowNeedsUpdate);
  let shadowKey = "";
  let source: LightingSource = { kind: "setup", setup: studioStageSetup(DEFAULT_STUDIO_STAGE) };
  let sex: BodySex = "female";
  // The view's Face shadows preference: off draws every light of the shown setup without its shadow map.
  let shadowsEnabled = true;
  // Verification-only trials of the game rig (a yaw, a set of casting lights), kept across each other; never stored.
  let trial: { yawOffset?: number; casters?: readonly string[] } = {};
  let shown: LightingSetup = source.kind === "setup" ? source.setup : studioStageSetup(DEFAULT_STUDIO_STAGE);
  let lutStatus: LightingStageStatus["lut"] = { phase: "idle", source: null };
  const black = new THREE.Color(0, 0, 0);
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  let disposed = false, lutLoading = false, lutFile: string | null = null;
  let lutTimer: ReturnType<typeof setTimeout> | null = null;
  const game = () => shown.display === "game";

  const stopRecheck = () => { if (lutTimer) clearTimeout(lutTimer); lutTimer = null; };
  function requestLut() {
    stopRecheck();
    if (lutLoading || disposed) return;
    lutLoading = true;
    const first = lutStatus.phase !== "ready";
    if (first) lutStatus = { phase: "loading", source: null };
    void options.loadLut().then(result => {
      lutLoading = false;
      if (disposed) return;
      if (first || !result.unreachable) {
        const file = result.file ?? null;
        // A new cube changes the picture even when its source description is identical (PREV-48), so either
        // change notifies, and the scene's lighting subscription asks for a frame.
        const graded = first || file !== lutFile;
        if (graded) { display.setLut(result.lut); lutFile = file; }
        const changed = first || JSON.stringify(result.source) !== JSON.stringify(lutStatus.source);
        lutStatus = { phase: "ready", source: result.source };
        if (changed || graded) notify();
      }
      if (game()) lutTimer = setTimeout(requestLut, LUT_RECHECK_MS);
    });
  }
  /** A setup's lights as the rig draws them: without their shadow maps while the Face shadows preference is off. */
  const rigLights = (setup: LightingSetup) => shadowsEnabled ? setup.lights : setup.lights.map(light => light.shadows ? { ...light, shadows: false } : light);
  /** Put a resolved setup's surroundings on the scene: its room and its strength, its backdrop, its exposure. */
  function present(setup: LightingSetup) {
    const lit = setup.environment > 0;
    scene.environment = lit ? room : null;
    scene.environmentIntensity = setup.environment;
    for (const probe of environment.lights) { probe.visible = lit; (probe as THREE.LightProbe).intensity = setup.environment; }
    scene.background = setup.backdrop === "black" ? black : studioBackground;
    if (setup.display === "game") display.setExposure(setup.exposure); else state.toneMappingExposure = setup.exposure;
  }
  /** Resolve the source for the body and show it; `announce` when the status (display or body) may have changed. */
  function apply(announce: boolean) {
    const wasGame = game();
    shown = resolveLightingSource(source, sex, trial);
    rig.apply(rigLights(shown), shown.focus);
    present(shown);
    if (game() && !wasGame) requestLut();
    else if (!game() && wasGame) stopRecheck();
    if (announce || game() !== wasGame) notify();
  }
  apply(false);
  /**
   * What the programs of a scene lit by `setup` depend on, as one string (its display and room, its light types and shadow switches as the
   * rig draws them, and the scatter, contact and shadow switches): equal strings need no new programs for the same meshes.
   */
  const programStateOf = (setup: LightingSetup) => JSON.stringify([setup.display === "game", setup.environment > 0, shadowsEnabled, contactOn,
    scatter.enabled, display.scatterPossible, state.toneMapping, rigLights(setup).map(light => [light.type === "spot", light.shadows, contactOnly(light.game)])]);
  /**
   * The staged setup (`stage`): its source, its own rig (outside the drawn scene except inside `withStaged`), and its own shadow-map
   * fingerprint, so a frame drawn for it never makes the drawn setup's next frame draw its maps again.
   */
  let staged: { source: LightingSource; key: string; rig: LightListRig; shadowKey: string } | null = null;
  const unstage = () => { staged?.rig.dispose(); staged = null; };
  /** Whether the next frame draws shadow maps (the setup's lights cast, and the Face shadows preference is on). */
  const castsShadowMaps = () => state.shadowMap.enabled && shadowsEnabled && shown.lights.some(light => light.shadows);
  /**
   * Everything the V shows receives the lights' shadows (makeup and decals included, so they darken with the skin under them); which meshes
   * cast is the character renderer's choice (skin, body and clothing). Set before each frame, and before a compile ahead: Three keys a
   * program on whether its mesh receives shadows, so a part compiled without it would be linked again by its first frame.
   */
  const receiveShadows = (root: THREE.Object3D, visibleOnly: boolean) => {
    if (!shadowsEnabled || !shown.lights.some(light => light.shadows)) return;
    const mark = (object: THREE.Object3D) => { if ((object as THREE.Mesh).isMesh) object.receiveShadow = true; };
    if (visibleOnly) root.traverseVisible(mark); else root.traverse(mark);
  };
  /** A 1×1 target to compile shadow depth variants against while the scene itself draws to the canvas (the direct studio path). */
  let depthCompileTarget: THREE.WebGLRenderTarget | null = null;
  const depthTarget = () => depthCompileTarget ??= new THREE.WebGLRenderTarget(1, 1);
  /** Stand-ins for Three's own depth materials (its shadow pass keeps them private): the same parameters, so the same programs. */
  const depthProxies = new Map<string, THREE.MeshDepthMaterial>();
  /**
   * The depth material Three's shadow pass (WebGLShadowMap `getDepthMaterial`, three r186) draws `mesh` with for `material` under a
   * directional or spot light, with the fields that pass sets on it: the mesh's own `customDepthMaterial`, else the default depth
   * material or a per-material variant of it (alpha-tested, displaced or clipped materials). Every field it copies is part of a program key.
   * A mesh's own `customDepthMaterial` is live (the contact prepass draws with it): its fields as they were go to `touched` before the
   * first write, so the caller puts every one back once it has compiled (`restoreTouched`) and compiling ahead changes nothing drawn.
   */
  function shadowDepthMaterial(mesh: THREE.Mesh, material: THREE.Material, touched: Map<THREE.Material, Record<string, unknown>>): THREE.Material {
    const source = material as THREE.MeshStandardMaterial & { clipShadows?: boolean; linewidth?: number; wireframeLinewidth?: number };
    let result = mesh.customDepthMaterial as THREE.MeshDepthMaterial | undefined;
    if (result) {
      if (!touched.has(result)) {
        const fields = result as unknown as Record<string, unknown>;
        touched.set(result, Object.fromEntries(DEPTH_FIELDS.map(field => [field, fields[field]])));
      }
    } else {
      const variant = (renderer.localClippingEnabled && source.clipShadows === true && Array.isArray(source.clippingPlanes) && source.clippingPlanes.length !== 0)
        || (!!source.displacementMap && source.displacementScale !== 0) || (!!source.alphaMap && source.alphaTest > 0) || (!!source.map && source.alphaTest > 0)
        || source.alphaToCoverage === true;
      const key = variant ? material.uuid : "";
      result = depthProxies.get(key) ?? depthProxies.set(key, new THREE.MeshDepthMaterial()).get(key)!;
    }
    const target = result as THREE.MeshDepthMaterial & { clipShadows: boolean; linewidth?: number; wireframeLinewidth: number };
    target.visible = source.visible;
    target.wireframe = source.wireframe ?? false;
    target.side = source.shadowSide ?? (source.side === THREE.FrontSide ? THREE.BackSide : source.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
    target.alphaMap = source.alphaMap ?? null;
    target.alphaTest = source.alphaToCoverage === true ? 0.5 : source.alphaTest;
    target.map = source.map ?? null;
    target.clipShadows = source.clipShadows ?? false;
    target.clippingPlanes = source.clippingPlanes;
    target.clipIntersection = source.clipIntersection;
    target.displacementMap = source.displacementMap ?? null;
    target.displacementScale = source.displacementScale ?? 1;
    target.displacementBias = source.displacementBias ?? 0;
    target.wireframeLinewidth = source.wireframeLinewidth ?? 1;
    target.linewidth = source.linewidth;
    return result;
  }

  /** See `prepareSteps` below; a step reads the shown setup when it runs (inside `withStaged`, the staged one). */
  function prepareSteps(object: THREE.Object3D, camera: THREE.Camera): PreparationSteps {
    const pending: Promise<unknown>[] = [], materials = new Set<THREE.Material>();
    /** The meshes' own depth materials as they were before a shadow variant was compiled with them (`shadowDepthMaterial`). */
    const touched = new Map<THREE.Material, Record<string, unknown>>();
    const drawables: THREE.Object3D[] = [], meshes: THREE.Mesh[] = [];
    object.traverse(child => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
      if (isDrawable(child)) drawables.push(child);
    });
    const materialsOf = (drawable: THREE.Object3D) => { const material = (drawable as THREE.Mesh).material; return Array.isArray(material) ? material : [material]; };
    /** Compile `mesh` as drawn with `material` (a pass's own material swapped in for the compile only). */
    const compileAs = (mesh: THREE.Mesh, material: THREE.Material) => {
      const own = mesh.material;
      mesh.material = material;
      try { pending.push(renderer.compileAsync(mesh, camera, scene)); materials.add(material); }
      finally { mesh.material = own; }
    };
    /**
     * One step, compiled with this scene's state: Three keys a program on the tone mapping, output colour space and shadow switches, and on
     * whether its mesh receives shadows (as the frame will set it). `run` gets the display's scene target; everything is put back after.
     */
    const step = (run: (target: THREE.WebGLRenderTarget | null) => void) => () => {
      applyState();
      receiveShadows(object, false);
      const previous = renderer.getRenderTarget(), target = display.sceneTarget(game() ? "creator" : "studio");
      renderer.setRenderTarget(target);
      try { run(target); }
      finally {
        renderer.setRenderTarget(previous); restoreTouched(touched);
        // At once, not at `result()`: a preparation stopped part-way still frees the shaders of the programs it made (linked-programs.ts).
        releaseShadersWithPrograms(renderer, linkedPrograms(renderer, materials));
      }
    };
    const steps: (() => void)[] = [];
    // The forward scene, into the display's target.
    for (const drawable of drawables) steps.push(step(() => {
      pending.push(renderer.compileAsync(drawable, camera, scene));
      for (const material of materialsOf(drawable)) materials.add(material);
    }));
    for (const mesh of meshes) {
      // The skin scatter's input variants (one program per target, S0 to S2), and the contact shadows' caster depth.
      for (let target = 0; target < 3; target++) steps.push(step(() => {
        if (!display.scatterPossible || Array.isArray(mesh.material)) return;
        const variant = scatter.variantsOf(mesh.material)[target];
        if (variant) compileAs(mesh, variant);
      }));
      steps.push(step(() => { if (contactOn && mesh.castShadow) compileAs(mesh, contact.casterMaterial(mesh)); }));
      // The shadow pass draws into the lights' maps: any render target keys a program as one does (no tone mapping, working colour space).
      steps.push(step(target => {
        if (!castsShadowMaps() || !mesh.castShadow) return;
        renderer.setRenderTarget(target ?? depthTarget());
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material.visible) compileAs(mesh, shadowDepthMaterial(mesh, material, touched));
        }
        // The maps are redrawn inside the contact prepass too (its draw is the frame's first, while every caster wears its depth
        // material), so Three's shadow pass then picks a depth material for the depth material itself: that variant as well. It
        // reads the caster as it is drawn now (what the line above wrote is put back first), and it turns the caster's side over on
        // every redraw (PREV-208), so the next redraw's variant too.
        if (contactOn) {
          restoreTouched(touched);
          const caster = contact.casterMaterial(mesh);
          compileAs(mesh, shadowDepthMaterial(mesh, caster, touched));
          compileAs(mesh, shadowDepthMaterial(mesh, caster, touched));
        }
      }));
    }
    return {
      steps,
      programs: () => linkedPrograms(renderer, materials),
      result(): PreparedObject {
        const textures = new Set<THREE.Texture>();
        const collect = (value: unknown) => {
          if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
          else if (Array.isArray(value)) for (const entry of value) collect(entry);
        };
        // A material's own maps (Three copies them into its uniforms only when it draws), and the uniforms it was compiled with.
        for (const material of materials) {
          for (const value of Object.values(material)) collect(value);
          const own = (material as THREE.ShaderMaterial).uniforms;
          const compiled = (renderer.properties.get(material) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
          for (const uniform of [...Object.values(own ?? {}), ...Object.values(compiled ?? {})]) collect(uniform?.value);
        }
        return { ready: Promise.all(pending).then(() => undefined), textures: [...textures], programs: () => linkedPrograms(renderer, materials) };
      },
    };
  }

  return {
    /** The display the shown setup draws through, as the lighting preset it replaced (`creator` for the game display). */
    get preset(): LightingPreset { return game() ? "creator" : "studio"; },
    /** The setup or game rig the scene is lit by now (a copy). */
    get source(): LightingSource { return structuredClone(source); },
    /**
     * Light the scene by a setup, or by the built-in game rig for the body shown. The staged setup (`stage`) is adopted: its rig, with the
     * lights and shadow maps its warm-up made, becomes the drawn one. Any other setup drops what was staged.
     */
    setSource(next: LightingSource) {
      const key = JSON.stringify(next);
      if (staged && staged.key === key) {
        const adopted = staged.rig;
        shadowKey = staged.shadowKey;
        staged = null;
        rig.dispose();
        rig = adopted;
        lightsHolder.add(rig.group);
      } else unstage();
      if (key === JSON.stringify(source)) return;
      source = structuredClone(next);
      apply(false);
    },
    /**
     * Stage `next` beside the setup drawn (see the header): a rig of its own, shown only inside `withStaged`, until `setSource(next)` adopts
     * it or `unstage` drops it. Staging the setup drawn now drops what was staged.
     */
    stage(next: LightingSource) {
      const key = JSON.stringify(next);
      if (key === JSON.stringify(source)) { unstage(); return; }
      if (staged) { staged.source = structuredClone(next); staged.key = key; return; }
      const made = createLightListRig();
      made.setShadowMapSize(rig.shadowMapSize);
      staged = { source: structuredClone(next), key, rig: made, shadowKey: "" };
    },
    /** Drop the staged setup, if any. */
    unstage,
    /** The staged setup's source (null: none). */
    get staged(): LightingSource | null { return staged ? structuredClone(staged.source) : null; },
    /**
     * Run `run` with the staged setup in place of the drawn one (its lights, room, backdrop, display and exposure: everything a program or a
     * draw depends on), then put the drawn setup back, whatever `run` did. Synchronous only: no frame is drawn meanwhile. Without a staged
     * setup it just runs.
     */
    withStaged<T>(run: () => T): T {
      if (!staged) return run();
      const was = { shown, rig, shadowKey, environment: scene.environment, environmentIntensity: scene.environmentIntensity, background: scene.background,
        exposure: state.toneMappingExposure, gameExposure: display.exposure,
        probes: environment.lights.map(probe => ({ visible: probe.visible, intensity: (probe as THREE.LightProbe).intensity })) };
      // Three's shadow pass, run inside the contact prepass, turns each caster's own depth material over (PREV-208): what a frame drawn for
      // the staged setup does to them is put back, so the drawn setup's next frame draws exactly as it would have.
      const depth = new Map<THREE.Material, Record<string, unknown>>();
      scene.traverse(object => {
        const custom = (object as THREE.Mesh).customDepthMaterial as unknown as Record<string, unknown> | undefined;
        if (custom && !depth.has(custom as unknown as THREE.Material)) depth.set(custom as unknown as THREE.Material, Object.fromEntries(DEPTH_FIELDS.map(field => [field, custom[field]])));
      });
      const setup = resolveLightingSource(staged.source, sex, trial);
      staged.rig.apply(rigLights(setup), setup.focus);
      shown = setup; rig = staged.rig; shadowKey = staged.shadowKey;
      lightsHolder.remove(was.rig.group); lightsHolder.add(rig.group);
      present(setup);
      try { return run(); }
      finally {
        if (staged) staged.shadowKey = shadowKey;
        shadowKey = was.shadowKey;
        restoreTouched(depth);
        lightsHolder.remove(rig.group); lightsHolder.add(was.rig.group);
        shown = was.shown; rig = was.rig;
        scene.environment = was.environment; scene.environmentIntensity = was.environmentIntensity; scene.background = was.background;
        state.toneMappingExposure = was.exposure; display.setExposure(was.gameExposure);
        environment.lights.forEach((probe, i) => { probe.visible = was.probes[i]!.visible; (probe as THREE.LightProbe).intensity = was.probes[i]!.intensity; });
      }
    },
    /** The program state (`programState`) the scene would have lit by `next`, without lighting it. */
    programStateFor(next: LightingSource): string { return programStateOf(resolveLightingSource(next, sex, trial)); },
    setBodySex(next: BodySex) {
      if (next === sex) return;
      sex = next;
      apply(true);
    },
    /**
     * The preview quality (generated-texture size) the shadow maps follow. A notification that keeps the size keeps the maps (PREV-131: the
     * old studio rig disposed them on every quality notification and never drew them again); a new size is a new fingerprint, so the next
     * frame draws them at it.
     */
    setShadowQuality(textureSize: number) {
      rig.setShadowMapSize(creatorShadowMapSize(textureSize)); staged?.rig.setShadowMapSize(creatorShadowMapSize(textureSize));
      scatter.setQuality(scatterQualityFor(textureSize));
    },
    /**
     * The Face shadows preference (the Rendering group): off, no light of any setup casts its shadow map onto the V; on again, the
     * setup's own shadow choices return. The setup itself is unchanged either way.
     */
    setShadowsEnabled(enabled: boolean) {
      if (enabled === shadowsEnabled) return;
      shadowsEnabled = enabled;
      apply(false);
    },
    get shadowsEnabled() { return shadowsEnabled; },
    /** Camera state for a creator page, for the preview's camera port. */
    camera: (page: CreatorCameraPage) => creatorCamera(sex, page),
    /** This scene's renderer-global state (a copy; evidence and tests). */
    rendererState: (): RendererState => structuredClone(state),
    /** Put this scene's renderer-global state on the renderer (a scene's draw opens with it; `render` and `prepare` apply it too). */
    applyRendererState() { applyState(); },
    /** Draw one frame through the shown setup's display transform. */
    render(camera: THREE.Camera) {
      receiveShadows(scene, true);
      // The maps are this scene's lights': they are drawn again when this scene's fingerprint changed, whatever another scene left.
      let redraw: boolean | undefined;
      if (renderer.shadowMap) {
        const key = shadowState(scene);
        redraw = key !== shadowKey; shadowKey = key;
      }
      applyState(redraw);
      // Contact shadows' caster depth first: the forward skin, its scatter input and the plate all read it (PREV-148).
      if (contactOn) contact.prepare(scene, camera); else contact.off();
      // The scatter decides first, so the forward skin lights with the same irradiance it blurs (the wrap off while it runs).
      const scattering = scatter.prepare(scene, display.scatterPossible);
      display.render(scene, camera, game() ? "creator" : "studio", scattering ? () => scatter.render(scene, camera) : undefined);
    },
    /**
     * Compile `object`'s programs (a part not in the scene yet, or the whole scene) for every pass the next frame draws it in: the forward
     * scene into the display's target, the skin scatter's input variants, the contact shadows' caster depth and, while the shown setup's
     * lights draw shadow maps, each caster's shadow depth variant as Three's shadow pass will pick it (`shadowDepthMaterial`). Three's
     * `compileAsync` over KHR_parallel_shader_compile: the driver links them on its own threads, and `ready` resolves when all are linked,
     * so the first frame that draws the part finds them done instead of waiting on each link (PREV-188/189: seconds on ANGLE's D3D11
     * compiler). Returns the textures the compiled programs sample (their uniforms), so the caller can upload them ahead too, and the
     * programs themselves, whose first use (`LinkedProgram`) the caller can take ahead as well once they are linked.
     */
    prepare(object: THREE.Object3D, camera: THREE.Camera): PreparedObject {
      const made = prepareSteps(object, camera);
      for (const step of made.steps) step();
      return made.result();
    },
    /**
     * `prepare` in steps (profiles phase 4a-v-b): each step compiles about one program's worth (one drawable for the forward scene, or one
     * pass's variant of one mesh) with this scene's state applied for its length, so a caller can let a frame through between steps and no
     * step holds the page's thread for long (one call for a whole part was 306 ms on real data). Run every step, then `result()`.
     */
    prepareSteps,
    /**
     * Compile the display's own passes for the shown setup, as the next frame draws them (the game display's grade, or the studio's coverage
     * and tone pass, and the skin scatter's blur), so a setup's first frame waits on none of them either.
     */
    prepareDisplay(): { ready: Promise<void>; programs(): LinkedProgram[] } {
      applyState();
      const compiled = display.compile(game() ? "creator" : "studio", scene);
      // The skin scatter's blur, when this display can run it.
      if (display.scatterPossible) { compiled.pending.push(scatter.compile()); compiled.materials.push(scatter.blurMaterial); }
      releaseShadersWithPrograms(renderer, linkedPrograms(renderer, compiled.materials));
      return { ready: Promise.all(compiled.pending).then(() => undefined), programs: () => linkedPrograms(renderer, compiled.materials) };
    },
    /**
     * What the programs this scene draws with depend on, as one string (the shown setup's light types and shadow switches, its room and
     * display, the scatter, contact and shadow switches): equal strings need no new programs for the same meshes.
     */
    programState(): string { return programStateOf(shown); },
    status: (): LightingStageStatus => structuredClone({ preset: game() ? "creator" : "studio", sex,
      defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure, lut: lutStatus }),
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    /** The definition drawn now (evidence and tests). */
    shown: (): LightingSetup => structuredClone(shown),
    /** Developer evidence (verification only): the game rig turned by a trial yaw (null: the calibration's), for a refit. */
    trialYaw(degrees: number | null) { trial = { ...trial, yawOffset: degrees ?? undefined }; apply(false); },
    /** Developer evidence (verification only): a trial set of the game rig's shadow-casting lights by name (null: the budgeted flagged ones). */
    trialCasters(names: readonly string[] | null) { trial = { ...trial, casters: names ?? undefined }; apply(false); },
    /**
     * The skin scatter on, or off (the wrap stand-in): the Rendering group's Skin scattering (`preview.setSkinScatter`). Developer evidence
     * may also ask for `bare` (the wrap off and no Δ: the direct light alone), for A/B captures.
     */
    setScatter(mode: boolean | "bare") { scatter.setEnabled(mode !== false); scatter.setBare(mode === "bare"); },
    /** Developer evidence (verification only): switch the character contact shadows off or on again, for A/B captures (PREV-148). */
    setContactShadows(on: boolean) { contactOn = on; },
    /** Developer evidence (verification only): a trial scatter screen scale (null: the default), for fitting it from captures. */
    setScatterScale(scale: number | null) { scatter.setScale(scale); },
    /** Developer evidence (verification only): show one light alone by its setup ID, or all of them again with null. */
    solo(id: string | null) { rig.solo(id); },
    /** Developer evidence: mean milliseconds per frame over `frames` frames drawn back to back, the GPU finished at both ends. */
    frameCost(camera: THREE.Camera, frames: number) {
      const gl = renderer.getContext();
      this.render(camera); gl.finish();
      const start = performance.now();
      for (let i = 0; i < frames; i++) this.render(camera);
      gl.finish();
      return (performance.now() - start) / frames;
    },
    /**
     * After a restored context: prefilter the room again into the same texture, and draw the shadow maps again on the next frame (the
     * restored context's maps are empty, and a still V would otherwise keep them: PREV-132). A staged setup's rig is drawn again too: its
     * fingerprint, a record of maps drawn in the context's last generation, is dropped with them.
     */
    restore() { environment.restore(); shadowKey = ""; if (staged) staged.shadowKey = ""; },
    /** Test and evidence access: the drawn setup's rig. */
    get rig() { return rig; },
    display,
    environment,
    scatter,
    contact,
    dispose() {
      disposed = true; stopRecheck(); listeners.clear(); rig.dispose(); unstage(); lightsHolder.removeFromParent();
      display.dispose(); environment.dispose(); scatter.dispose(); contact.dispose();
      for (const proxy of depthProxies.values()) proxy.dispose();
      depthProxies.clear(); depthCompileTarget?.dispose(); depthCompileTarget = null;
    },
  };
}
export type LightingSetupStage = ReturnType<typeof createLightingSetupStage>;
/** What compiling an object ahead gives (`prepare`): when its programs are linked, the textures they sample, and the programs themselves. */
export type PreparedObject = { ready: Promise<void>; textures: THREE.Texture[]; programs(): LinkedProgram[] };
/** `prepare` in steps (`prepareSteps`): run every step (each synchronous), then take the result. */
export type PreparationSteps = { steps: (() => void)[];
  /** The programs the steps run so far made (to pace the driver's links). */
  programs(): LinkedProgram[];
  result(): PreparedObject };

/** Every field `shadowDepthMaterial` sets on a depth material, as Three's shadow pass sets them. */
const DEPTH_FIELDS = ["visible", "wireframe", "side", "alphaMap", "alphaTest", "map", "clipShadows", "clippingPlanes", "clipIntersection",
  "displacementMap", "displacementScale", "displacementBias", "wireframeLinewidth", "linewidth"] as const;
/** Put back what compiling a shadow variant wrote on live depth materials (only the fields that differ: `alphaTest` bumps a version). */
function restoreTouched(touched: Map<THREE.Material, Record<string, unknown>>) {
  for (const [material, fields] of touched) {
    const target = material as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(fields)) if (target[field] !== value) target[field] = value;
  }
  touched.clear();
}

/**
 * The scatter's sample count for a preview quality (the generated-texture size): the game's High (25 samples) at every size. The
 * cost follows the canvas, not the texture size, and was measured small enough at both (research/materials/shader-skin.md §11.5).
 */
export const scatterQualityFor = (_textureSize: number): ScatterQuality => "high";

/**
 * A fingerprint of everything a shadow map depends on, so the maps are redrawn only when it changes: each visible shadow-casting
 * light (identity, placement, map size) and each visible caster (identity, placement, its bones' local poses and its morph weights).
 * The camera is not in it. Every affine element of each matrix and every bone's rotation, position and scale go into a 64-bit hash
 * (two 32-bit lanes), quantised to 1e-5, so opposite yaws or moves along different axes never collide (PREV-159). Cheap: a few hundred
 * bones per frame drawn.
 */
export function shadowState(scene: THREE.Scene): string {
  // Placements as this frame will draw them (the renderer updates the world matrices again; the cost is small).
  scene.updateMatrixWorld();
  let lights = "", casters = 0, a = 0x811c9dc5 | 0, b = 0x2545f491 | 0;
  const word = (part: number) => {
    a = Math.imul(a ^ part, 0x85ebca6b); a ^= a >>> 13;
    b = Math.imul(b ^ part, 0xc2b2ae35) + 0x9e3779b9 | 0; b ^= b >>> 16;
  };
  const mix = (value: number) => { const q = Math.round(value * 1e5); word(q | 0); word((q / 4294967296) | 0); };
  const affine = (e: ArrayLike<number>) => { for (let i = 0; i < 15; i++) if ((i & 3) !== 3) mix(e[i]!); };
  const seenSkeletons = new Set<THREE.Skeleton>();
  scene.traverseVisible(object => {
    const light = object as THREE.Light & { shadow?: THREE.LightShadow };
    if (light.isLight && light.castShadow && light.shadow) {
      const e = light.matrixWorld.elements;
      const t = (light as THREE.DirectionalLight).target?.matrixWorld.elements;
      lights += `${light.uuid}:${light.shadow.mapSize.x}:${bodyCastersOnly(light.shadow) ? "body" : "all"}:${e[12]!.toFixed(4)},${e[13]!.toFixed(4)},${e[14]!.toFixed(4)}` +
        (t ? `>${t[12]!.toFixed(4)},${t[13]!.toFixed(4)},${t[14]!.toFixed(4)};` : ";");
      // A spot light's cone follows its rotation too.
      affine(e);
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow) return;
    casters++;
    word(mesh.id);
    affine(mesh.matrixWorld.elements);
    const weights = mesh.morphTargetInfluences;
    if (weights) { word(weights.length); for (const weight of weights) mix(weight); }
    const skeleton = (mesh as THREE.SkinnedMesh).skeleton;
    if (skeleton && !seenSkeletons.has(skeleton)) {
      seenSkeletons.add(skeleton);
      word(skeleton.bones.length);
      for (const bone of skeleton.bones) {
        const q = bone.quaternion, p = bone.position, k = bone.scale;
        mix(q.x); mix(q.y); mix(q.z); mix(q.w); mix(p.x); mix(p.y); mix(p.z); mix(k.x); mix(k.y); mix(k.z);
      }
    }
  });
  return `${lights}|${casters}|${(a >>> 0).toString(16)}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
