import type { MotionPort } from "./motion-actions";
import type { PreviewPort } from "./preview-actions";
import type { SavedAppearancePort } from "./saved-appearance-actions";
import type { createScene } from "./scene";

type Scene = Awaited<ReturnType<typeof createScene>>;

/** The Three scene stays on the trusted device side of the presentation boundary. */
export function createBrowserScenePreviewPorts(scene: Scene, options: {
  setSurfaceControls(enabled: boolean): void;
  hasSavedAppearance(): boolean;
}): { savedAppearance: SavedAppearancePort; preview: PreviewPort; motion: MotionPort } {
  return {
    savedAppearance: { apply: savedV => scene.applySavedV(savedV) },
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
      availability: target => target === "hair"
        ? !options.hasSavedAppearance() || !scene.hair.length ? "Saved hair preview is unavailable." : undefined
        : !scene.details[target] ? `${target} preview assets are unavailable.` : undefined,
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
