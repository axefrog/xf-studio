import * as THREE from "three";
import { creatorCamera, DEFAULT_CREATOR_LIGHTING, type BodySex, type CreatorCameraPage, type CreatorLightingOptions,
  type LightingPreset } from "./creator-lighting";
import { createCreatorDisplay } from "./creator-display";
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
export type GradingLutLoader = () => Promise<{ lut: GradingLut | null; source: GradingLutSource }>;

/**
 * Three adapter that switches the viewport between the studio stage and the creator preset. The studio
 * stage (IBL environment, key and fill lights, stage backdrop, ACES) is left untouched and only hidden;
 * the creator preset shows the creator light rig on a black background with no environment and renders
 * through the creator display pass. Switching is immediate and fully reversible: turning the preset off
 * restores exactly the environment, background and light visibility it found.
 *
 * The LUT is requested from the host the first time the preset turns on; until it arrives the neutral
 * grade is shown.
 */
export function createLightingPresetStage(options: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  /** The studio stage's own lights, hidden while the creator preset shows. */
  studioLights: readonly THREE.Object3D[];
  loadLut: GradingLutLoader;
}) {
  const { scene, renderer } = options;
  const rig = createCreatorLightRig(), display = createCreatorDisplay(renderer);
  scene.add(rig.group);
  let preset: LightingPreset = "studio", sex: BodySex = "female";
  let creator: CreatorLightingOptions = { ...DEFAULT_CREATOR_LIGHTING };
  let lutStatus: LightingPresetStatus["lut"] = { phase: "idle", source: null };
  let saved: { environment: THREE.Texture | null; background: THREE.Scene["background"]; visible: boolean[] } | null = null;
  const black = new THREE.Color(0, 0, 0);
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  let disposed = false;
  rig.apply(sex, creator);
  display.setExposure(creator.exposure);

  function requestLut() {
    if (lutStatus.phase !== "idle") return;
    lutStatus = { phase: "loading", source: null };
    void options.loadLut().then(result => {
      if (disposed) return;
      display.setLut(result.lut);
      lutStatus = { phase: "ready", source: result.source };
      notify();
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
        display.release();
      }
      notify();
    },
    setCreatorOptions(next: CreatorLightingOptions) {
      const rebuild = next.intensity !== creator.intensity || next.cone !== creator.cone;
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
    /** Camera state for a creator page, for the preview's camera port. */
    camera: (page: CreatorCameraPage) => creatorCamera(sex, page),
    /** Draw one frame through the active preset. */
    render(camera: THREE.Camera) {
      if (preset === "creator") display.render(scene, camera);
      else renderer.render(scene, camera);
    },
    status: (): LightingPresetStatus => structuredClone({ preset, sex, defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure, lut: lutStatus }),
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Test and evidence access. */
    rig,
    display,
    dispose() { disposed = true; listeners.clear(); rig.dispose(); display.dispose(); },
  };
}
export type LightingPresetStage = ReturnType<typeof createLightingPresetStage>;
