import { MotionActions, type MotionPort } from "./motion-actions";
import { PreviewActions, type PreviewPort } from "./preview-actions";
import { SavedAppearanceActions, type SavedAppearancePort } from "./saved-appearance-actions";
import type { WorkspaceState } from "./workspace-state";

/** Restore the preview from workspace data without reading presentation controls. */
export function createTrustedPreviewServices(workspace: WorkspaceState, ports: {
  savedAppearance: SavedAppearancePort;
  preview: PreviewPort;
  motion: MotionPort;
}) {
  const savedAppearance = new SavedAppearanceActions(ports.savedAppearance);
  const restoredSavedAppearance = workspace.savedV
    ? savedAppearance.dispatch({ kind: "savedV.restore", value: workspace.savedV }) : undefined;
  const initial = { ...workspace.preview };
  for (const detail of ["brows", "lashes"] as const) {
    if (ports.preview.availability?.(detail)) initial[detail] = false;
  }
  // Keep a requested hair/piercing toggle while its optional assets are absent.
  // A later saved-V import or local asset repair can then reveal that context.
  const options = ports.preview.piercingOptions?.() ?? [];
  const chosen = options.find(option => option.id === initial.piercingStyle);
  initial.piercingStyle = chosen?.id ?? "";
  initial.piercingDefinition = chosen?.choices.some(choice => choice.definition === initial.piercingDefinition)
    ? initial.piercingDefinition : chosen?.choices[0]?.definition ?? "";

  // A restored eye shape the loaded head does not offer falls back to its base shape.
  const eyeChoices = ports.preview.eyeShapeOptions?.().choices;
  if (eyeChoices && !eyeChoices.some(choice => choice.index === initial.eyeShape)) initial.eyeShape = 0;

  // These scene settings preceded surface-control construction in the original startup.
  ports.preview.setEyeOptics(initial.eyeOptics);
  ports.preview.setEyeShape(initial.eyeShape);
  ports.preview.setWire(initial.wire);
  ports.preview.setNormals(initial.normals);
  ports.preview.setExposure(initial.exposure);
  ports.preview.setLightAngle(initial.lightAngle);
  ports.preview.setCreatorLighting?.(initial.creatorLighting);
  if (!ports.preview.setLightingPreset) initial.lightingPreset = "studio";
  else ports.preview.setLightingPreset(initial.lightingPreset);
  for (const detail of ["brows", "lashes"] as const)
    ports.preview.setDetail(detail, initial[detail]);
  ports.preview.setHair(initial.hair);

  return {
    savedAppearance,
    restoredSavedAppearance,
    /** Call after the surface editor exists. Motion restores before neutral-space camera state. */
    finish() {
      ports.preview.setSurfaceControls(initial.surface);
      const motion = new MotionActions(initial, ports.motion);
      motion.restore();
      const preview = new PreviewActions(initial, ports.preview);
      ports.preview.setPiercingPreview(initial.piercingStyle, initial.piercingDefinition);
      if (options.length) ports.preview.setPiercings(initial.piercings);
      if (initial.camera) preview.dispatch({ kind: "camera.restore", camera: initial.camera });
      return { preview, motion };
    },
  };
}
