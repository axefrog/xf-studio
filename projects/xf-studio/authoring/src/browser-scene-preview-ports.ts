import type { MotionPort } from "./motion-actions";
import type { PreviewPort } from "./preview-actions";
import type { SavedAppearancePort } from "./saved-appearance-actions";
import type { createScene } from "./scene";

type Scene = Awaited<ReturnType<typeof createScene>>;

/** The Three scene stays on the trusted device side of the presentation boundary. */
export function createBrowserScenePreviewPorts(scene: Scene, options: {
  setSurfaceControls(enabled: boolean): void;
}): { savedAppearance: SavedAppearancePort; preview: PreviewPort; motion: MotionPort } {
  return {
    savedAppearance: { apply: savedV => {
      const result = scene.applySavedV(savedV);
      // The creator rig follows V's body, as the game's preview controller does.
      scene.lighting.setBodySex(savedV.isMale ? "male" : "female");
      return result;
    } },
    preview: {
      cameraState: scene.cameraState, front: scene.front, setFov: scene.setFov,
      endFovGesture: scene.endFovGesture, restoreCamera: scene.restoreCamera,
      setExposure: scene.setExposure, setLightAngle: scene.setLightAngle,
      setSurfaceControls: options.setSurfaceControls, setWire: scene.setWire,
      setNormals: scene.setNormals, setEyeOptics: scene.setEyeOptics,
      setHair: scene.setHair, setDetail: scene.setDetail, setEyeShape: scene.eyeShape,
      setPiercings: scene.setPiercings, setPiercingPreview: scene.setPiercingPreview,
      piercingOptions: () => scene.piercingStyles.map(style => ({ id: style.id, label: style.label,
        choices: style.choices.map(choice => ({ index: choice.index,
          definition: choice.definition, label: choice.label })) })),
      eyeShapeOptions: scene.eyeShapeOptions,
      setLightingPreset: preset => scene.lighting.setPreset(preset),
      setCreatorLighting: options => scene.lighting.setCreatorOptions(options),
      creatorCamera: page => scene.lighting.camera(page),
      lightingStatus: () => scene.lighting.status(),
      onLightingStatus: listener => scene.lighting.subscribe(listener),
      // Brows, lashes and hair are visibility preferences: their resolved details arrive later and
      // follow the setting, so the toggles never depend on what is loaded right now.
    },
    motion: {
      get idle() { return scene.idle; },
      available: scene.evidence.idle.available, error: scene.evidence.idle.error,
      setIdle: scene.setIdle, setIdlePaused: scene.setIdlePaused,
      setIdleContributions: scene.setIdleContributions, setBlink: scene.setBlink,
      animateBlink: scene.animateBlink,
    },
  };
}
