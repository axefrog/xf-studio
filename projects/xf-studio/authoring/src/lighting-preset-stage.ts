import * as THREE from "three";
import { creatorCamera, creatorShadowMapSize, DEFAULT_CREATOR_LIGHTING, type BodySex, type CreatorCameraPage, type CreatorLightingOptions,
  type LightingPreset } from "./creator-lighting";
import { createLinearDisplay } from "./linear-display";
import { createCreatorLightRig } from "./creator-lighting-rig";
import type { GradingLut, GradingLutSource } from "./grading-lut";

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
 */
export function createLightingPresetStage(options: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  /** The studio stage's own lights, hidden while the creator preset shows. */
  studioLights: readonly THREE.Object3D[];
  loadLut: GradingLutLoader;
}) {
  const { scene, renderer } = options;
  const rig = createCreatorLightRig(), display = createLinearDisplay(renderer);
  scene.add(rig.group);
  // Shadow maps render only for lights that cast, and only the creator rig's do; soft PCF with a per-light radius.
  if (renderer.shadowMap) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
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
    setShadowQuality(textureSize: number) { rig.setShadowMapSize(creatorShadowMapSize(textureSize)); },
    /** Camera state for a creator page, for the preview's camera port. */
    camera: (page: CreatorCameraPage) => creatorCamera(sex, page),
    /** Draw one frame through the active preset. */
    render(camera: THREE.Camera) {
      // Everything the V shows receives the rig's shadows (makeup and decals included, so they darken with the skin under them);
      // which meshes cast is the character renderer's choice (skin, body and clothing).
      if (preset === "creator" && creator.shadows) scene.traverseVisible(object => { if ((object as THREE.Mesh).isMesh) object.receiveShadow = true; });
      display.render(scene, camera, preset);
    },
    status: (): LightingPresetStatus => structuredClone({ preset, sex, defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure, lut: lutStatus }),
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
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
    /** Test and evidence access. */
    rig,
    display,
    dispose() { disposed = true; stopRecheck(); listeners.clear(); rig.dispose(); display.dispose(); },
  };
}
export type LightingPresetStage = ReturnType<typeof createLightingPresetStage>;
