import type { CharacterOverride } from "./character-detail-request";
import { choiceLabel } from "./character-detail-plan";
import type { MotionPort } from "./motion-actions";
import type { PiercingPreviewOption, PreviewPort } from "./preview-actions";
import type { RenderChoices } from "./render-detail";
import type { SavedAppearancePort } from "./saved-appearance-actions";
import type { createScene } from "./scene";

type Scene = Awaited<ReturnType<typeof createScene>>;
/** The character-detail service as the piercing controls use it: the creator's choices on the shown V, and the choice being tried. */
export type TriedChoices = { snapshot(): { readonly choices: readonly RenderChoices[] }; setOverride(override: CharacterOverride | null): Promise<void> };

/**
 * The piercing styles and colours the creator offers on this installation (from the shown V's record), as the preview controls list
 * them: the style's number as the creator's switcher counts it, and each colour's plain name in the creator's order.
 */
export function piercingOptions(choices: readonly RenderChoices[]): PiercingPreviewOption[] {
  const options = choices.find(entry => entry.slot === "piercings")?.options ?? [];
  const word = (definition: string) => { const label = choiceLabel(definition); return label.charAt(0).toUpperCase() + label.slice(1); };
  return options.map(option => ({ id: option.option,
    label: option.index < 1024 ? `Piercing ${String(option.index).padStart(2, "0")}` : word(option.option),
    choices: option.definitions.map((definition, position) => ({ index: position + 1, definition: definition.name, label: word(definition.name) })) }));
}

/** The Three scene stays on the trusted device side of the presentation boundary. */
export function createBrowserScenePreviewPorts(scene: Scene, options: {
  setSurfaceControls(enabled: boolean): void;
  /** Piercing styles are resolved by the host: trying one asks for the V's record with that choice (character-detail-actions.ts). */
  piercings?: TriedChoices;
}): { savedAppearance: SavedAppearancePort; preview: PreviewPort; motion: MotionPort } {
  return {
    savedAppearance: { apply: savedV => scene.applySavedV(savedV), setBodySex: sex => scene.lighting.setBodySex(sex) },
    preview: {
      cameraState: scene.cameraState, front: scene.front, setFov: scene.setFov,
      endFovGesture: scene.endFovGesture, restoreCamera: scene.restoreCamera,
      setExposure: scene.setExposure, setLightAngle: scene.setLightAngle,
      setSurfaceControls: options.setSurfaceControls, setWire: scene.setWire,
      setNormals: scene.setNormals, setEyeOptics: scene.setEyeOptics,
      setHair: scene.setHair, setDetail: scene.setDetail, setEyeShape: scene.eyeShape,
      setPiercings: scene.setPiercings,
      setPiercingPreview: (style, definition) => { void options.piercings?.setOverride(style ? { slot: "piercings", option: style, definition } : null); },
      piercingOptions: () => piercingOptions(options.piercings?.snapshot().choices ?? []),
      eyeShapeOptions: scene.eyeShapeOptions,
      setLightingPreset: preset => scene.lighting.setPreset(preset),
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
      setIdle: scene.setIdle, setIdlePaused: scene.setIdlePaused,
      setIdleContributions: scene.setIdleContributions, setBlink: scene.setBlink,
      animateBlink: scene.animateBlink,
    },
  };
}
