import type { MotionPort } from "./motion-actions";
import type { PreviewPort } from "./preview-actions";
import type { SavedAppearancePort } from "./saved-appearance-actions";
import type { createScene } from "./scene";

type Scene = Awaited<ReturnType<typeof createScene>>;

/**
 * The Three scene stays on the trusted device side of the presentation boundary. These ports are devices only: every creator choice
 * belongs to the character context (character-context-actions.ts), which the composition root attaches to the application beside them.
 */
export function createBrowserScenePreviewPorts(scene: Scene, options: {
  setSurfaceControls(enabled: boolean): void;
}): { savedAppearance: SavedAppearancePort; preview: PreviewPort; motion: MotionPort } {
  return {
    savedAppearance: { apply: savedV => scene.applySavedV(savedV), clear: () => { scene.setFaceMorphs([]); },
      setBodySex: sex => scene.lighting.setBodySex(sex) },
    preview: {
      cameraState: scene.cameraState, front: scene.front, setFov: scene.setFov,
      endFovGesture: scene.endFovGesture, restoreCamera: scene.restoreCamera,
      setExposure: scene.setExposure, setLightAngle: scene.setLightAngle,
      setSurfaceControls: options.setSurfaceControls, setWire: scene.setWire,
      setNormals: scene.setNormals, setEyeOptics: scene.setEyeOptics,
      setHair: scene.setHair, setDetail: scene.setDetail, setEyeShape: scene.eyeShape,
      setPiercings: scene.setPiercings,
      eyeShapeOptions: scene.eyeShapeOptions,
      setLightingPreset: preset => scene.lighting.setPreset(preset),
      // The studio stage's adjustable rig (studio-light-rig.ts), part of this port like every other scene device (PREV-69).
      setStudioLights: lights => scene.setStudioLights(lights),
      setCreatorLighting: options => scene.lighting.setCreatorOptions(options),
      creatorCamera: page => scene.lighting.camera(page),
      lightingStatus: () => scene.lighting.status(),
      onLightingStatus: listener => scene.lighting.subscribe(listener),
      // Brows, lashes, hair and piercings are visibility preferences: their resolved details arrive later and
      // follow the setting, so the toggles never depend on what is loaded right now.
    },
    motion: {
      get idle() { return scene.idle; },
      available: scene.evidence.idle.available, error: scene.evidence.idle.error,
      blink: { available: scene.evidence.blink?.available ?? false, error: scene.evidence.blink?.error || undefined },
      setIdle: scene.setIdle, setIdlePaused: scene.setIdlePaused,
      setIdleContributions: scene.setIdleContributions, setBlink: scene.setBlink,
      animateBlink: scene.animateBlink,
    },
  };
}
