import * as THREE from "three";
import { creatorCamera, creatorShadowMapSize, DEFAULT_CREATOR_LIGHTING, type BodySex, type CreatorCameraPage, type CreatorLightingOptions,
  type LightingPreset } from "./creator-lighting";
import { createLinearDisplay } from "./linear-display";
import { createCreatorLightRig } from "./creator-lighting-rig";
import type { GradingLut, GradingLutSource } from "./grading-lut";
import { installShadowFilter } from "./shadow-filter";
import { createSkinScatter } from "./platform/scene/skin-scatter";
import type { ScatterQuality } from "./platform/scene/skin-scatter-kernel";

/** What the lighting preset device reports (read-only; the presentation turns it into plain text). */
export type LightingPresetStatus = {
  preset: LightingPreset;
  sex: BodySex;
  /** The preset's unfitted default exposure, for a reset control. */
  defaultExposure: number;
  lut: { phase: "idle" | "loading" | "ready"; source: GradingLutSource | null };
};
/** `file` names the host's decoded cube (null for neutral); `unreachable` marks an answer that never reached the host. */
export type GradingLutLoader = () => Promise<{ lut: GradingLut | null; source: GradingLutSource; file?: string | null; unreachable?: boolean }>;
/** How often the creator preset asks the host again while it is shown (PREV-40). */
export const LUT_RECHECK_MS = 20_000;

/**
 * Three adapter that switches the viewport between the studio stage and the creator preset. The studio
 * stage (IBL environment, key and fill lights, stage backdrop, ACES) is left untouched and only hidden;
 * the creator preset shows the creator light rig on a black background with no environment, with the flagged lights' shadow maps
 * on the V (knowledge/creator-lighting.md §12; only the creator rig casts, so the studio stage is untouched). Both draw
 * through one scene-linear display (linear-display.ts): the studio stage tone-maps and encodes at output,
 * the creator preset applies the game's grade. Switching is immediate and fully reversible: turning the
 * preset off restores exactly the environment, background and light visibility it found.
 *
 * The LUT is requested from the host each time the preset turns on and re-checked every `LUT_RECHECK_MS`
 * while it shows. The host keys its answer by the installation fingerprint the character details use, so a
 * changed route, profile or LUT mod, or WolvenKit becoming ready, is picked up without a restart. Until the
 * first answer arrives the neutral grade is shown; later answers replace the grade only when the host's
 * cube changed, and an answer that never reached the host keeps the current grade. Any change of cube or of
 * its source notifies subscribers.
 *
 * Both presets light the V's skin with the game's screen-space scatter (platform/scene/skin-scatter.ts) whenever the display's target is
 * half float; the skin light's wrap stands in for it otherwise, and while it is switched off (a verification switch for A/B evidence).
 * Its kernel's sample count follows the preview quality (`scatterQualityFor`).
 */
export function createLightingPresetStage(options: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  /** The studio stage's own lights, hidden while the creator preset shows. */
  studioLights: readonly THREE.Object3D[];
  loadLut: GradingLutLoader;
  /** The studio stage's shadow-map size, which follows the preview quality with the creator rig's. */
  setStudioShadowMapSize?(size: number): void;
}) {
  const { scene, renderer } = options;
  const rig = createCreatorLightRig(), display = createLinearDisplay(renderer), scatter = createSkinScatter(renderer);
  scene.add(rig.group);
  // Shadow maps render only for lights that cast; soft PCF with a per-light radius. They are drawn again only when what casts or
  // lights them changed (`shadowState`), not for a camera move: a static V orbited keeps its maps.
  installShadowFilter();
  if (renderer.shadowMap) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; }
  let shadowKey = "";
  // Verification-only trials (a rig yaw, a set of casting lights), kept across each other; never stored.
  let trial: { yawOffset?: number; casters?: readonly string[] } = {};
  let preset: LightingPreset = "studio", sex: BodySex = "female";
  let creator: CreatorLightingOptions = { ...DEFAULT_CREATOR_LIGHTING };
  let lutStatus: LightingPresetStatus["lut"] = { phase: "idle", source: null };
  let saved: { environment: THREE.Texture | null; background: THREE.Scene["background"]; visible: boolean[] } | null = null;
  const black = new THREE.Color(0, 0, 0);
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  let disposed = false, lutLoading = false, lutFile: string | null = null;
  let lutTimer: ReturnType<typeof setTimeout> | null = null;
  rig.apply(sex, creator);
  display.setExposure(creator.exposure);

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
      if (preset === "creator") lutTimer = setTimeout(requestLut, LUT_RECHECK_MS);
    });
  }

  return {
    get preset() { return preset; },
    setPreset(next: LightingPreset) {
      if (next === preset) return;
      preset = next;
      if (next === "creator") {
        saved = { environment: scene.environment, background: scene.background, visible: options.studioLights.map(light => light.visible) };
        scene.environment = null;
        scene.background = black;
        for (const light of options.studioLights) light.visible = false;
        rig.group.visible = true;
        requestLut();
      } else if (saved) {
        scene.environment = saved.environment;
        scene.background = saved.background;
        options.studioLights.forEach((light, i) => { light.visible = saved!.visible[i] ?? true; });
        rig.group.visible = false;
        saved = null;
        stopRecheck();
      }
      notify();
    },
    setCreatorOptions(next: CreatorLightingOptions) {
      const rebuild = next.intensity !== creator.intensity || next.cone !== creator.cone || next.shadows !== creator.shadows;
      creator = { ...next };
      if (rebuild) rig.apply(sex, creator);
      display.setExposure(creator.exposure);
    },
    setBodySex(next: BodySex) {
      if (next === sex) return;
      sex = next;
      rig.apply(sex, creator);
      notify();
    },
    /** The preview quality (generated-texture size) the shadow maps follow. */
    setShadowQuality(textureSize: number) {
      const size = creatorShadowMapSize(textureSize);
      rig.setShadowMapSize(size);
      options.setStudioShadowMapSize?.(size);
      scatter.setQuality(scatterQualityFor(textureSize));
    },
    /** Camera state for a creator page, for the preview's camera port. */
    camera: (page: CreatorCameraPage) => creatorCamera(sex, page),
    /** Draw one frame through the active preset. */
    render(camera: THREE.Camera) {
      // Everything the V shows receives the rig's shadows (makeup and decals included, so they darken with the skin under them);
      // which meshes cast is the character renderer's choice (skin, body and clothing). The studio stage's key and rim cast too.
      if (preset === "studio" || creator.shadows) scene.traverseVisible(object => { if ((object as THREE.Mesh).isMesh) object.receiveShadow = true; });
      if (renderer.shadowMap) {
        const key = shadowState(scene);
        if (key !== shadowKey) { renderer.shadowMap.needsUpdate = true; shadowKey = key; }
      }
      // The scatter decides first, so the forward skin lights with the same irradiance it blurs (the wrap off while it runs).
      const scattering = scatter.prepare(scene, display.scatterPossible);
      display.render(scene, camera, preset, scattering ? () => scatter.render(scene, camera) : undefined);
    },
    status: (): LightingPresetStatus => structuredClone({ preset, sex, defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure, lut: lutStatus }),
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Developer evidence (verification only): rebuild the rig turned by a trial yaw (null: the calibration's), for a refit. */
    trialYaw(degrees: number | null) { trial = { ...trial, yawOffset: degrees ?? undefined }; rig.apply(sex, { ...creator, ...trial }); },
    /** Developer evidence (verification only): a trial set of shadow-casting rig lights by name (null: the budgeted flagged ones). */
    trialCasters(names: readonly string[] | null) { trial = { ...trial, casters: names ?? undefined }; rig.apply(sex, { ...creator, ...trial }); },
    /** Developer evidence (verification only): show one rig light alone by name, or all of them again with null. */
    solo(name: string | null) {
      for (const child of rig.group.children) if ((child as THREE.SpotLight).isSpotLight) child.visible = name === null || child.name === `xfs-creator-${name}`;
    },
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
     * Developer evidence (verification only): switch the skin scatter off (the wrap stand-in) or on again, or to `bare` (the wrap off and
     * no Δ: the direct light alone), for A/B captures.
     */
    setScatter(mode: boolean | "bare") { scatter.setEnabled(mode !== false); scatter.setBare(mode === "bare"); },
    /** Developer evidence (verification only): a trial scatter screen scale (null: the default), for fitting it from captures. */
    setScatterScale(scale: number | null) { scatter.setScale(scale); },
    /** Test and evidence access. */
    rig,
    display,
    scatter,
    dispose() { disposed = true; stopRecheck(); listeners.clear(); rig.dispose(); display.dispose(); scatter.dispose(); },
  };
}
export type LightingPresetStage = ReturnType<typeof createLightingPresetStage>;

/**
 * The scatter's sample count for a preview quality (the generated-texture size): the game's High (25 samples) at every size. The
 * cost follows the canvas, not the texture size, and was measured small enough at both (research/materials/shader-skin.md §11.5).
 */
export const scatterQualityFor = (_textureSize: number): ScatterQuality => "high";

/**
 * A fingerprint of everything a shadow map depends on, so the maps are redrawn only when it changes: each visible shadow-casting
 * light (identity, placement, map size) and each visible caster (identity, placement, its bones' local poses and its morph weights).
 * The camera is not in it. Cheap: a few hundred bones per frame drawn.
 */
export function shadowState(scene: THREE.Scene): string {
  // Placements as this frame will draw them (the renderer updates the world matrices again; the cost is small).
  scene.updateMatrixWorld();
  let lights = "", casters = 0, pose = 0;
  const seenSkeletons = new Set<THREE.Skeleton>();
  const mix = (value: number, weight: number) => { pose = (pose + value * weight) % 1e9; };
  scene.traverseVisible(object => {
    const light = object as THREE.Light & { shadow?: THREE.LightShadow };
    if (light.isLight && light.castShadow && light.shadow) {
      const e = light.matrixWorld.elements;
      const t = (light as THREE.DirectionalLight).target?.matrixWorld.elements;
      lights += `${light.uuid}:${light.shadow.mapSize.x}:${e[12]!.toFixed(4)},${e[13]!.toFixed(4)},${e[14]!.toFixed(4)}` +
        (t ? `>${t[12]!.toFixed(4)},${t[13]!.toFixed(4)},${t[14]!.toFixed(4)};` : ";");
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow) return;
    casters++;
    const e = mesh.matrixWorld.elements;
    for (let i = 0; i < 16; i += 5) mix(e[i]! + e[12]! + e[13]! + e[14]!, i + casters);
    mesh.morphTargetInfluences?.forEach((w, i) => mix(w, i + 17));
    const skeleton = (mesh as THREE.SkinnedMesh).skeleton;
    if (skeleton && !seenSkeletons.has(skeleton)) {
      seenSkeletons.add(skeleton);
      skeleton.bones.forEach((bone, i) => {
        const q = bone.quaternion, p = bone.position;
        mix(q.x + 2 * q.y + 3 * q.z + 5 * q.w + 7 * p.x + 11 * p.y + 13 * p.z, i + 31);
      });
    }
    casters += mesh.id * 1e-6;
  });
  return `${lights}|${casters}|${pose.toFixed(6)}`;
}
