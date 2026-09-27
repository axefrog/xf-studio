import { MotionActions, type MotionPort } from "./motion-actions";
import { PreviewActions, type PreviewPort } from "./preview-actions";
import { SavedAppearanceActions, type SavedAppearancePort } from "./saved-appearance-actions";
import type { WorkspaceState } from "./workspace-state";
import type { ViewGraph } from "./platform/core/view-graph";
import { MAIN_VIEW } from "./platform/api/view-graph";
import { previewMirror } from "./preview-view-graph";

/**
 * Restore the preview from workspace data without reading presentation controls. `graph` is the workspace's view graph (the
 * composition root's, which outlives any one head); the loaded head's fallbacks (an unavailable detail, an eye shape it lacks, no
 * creator rig) are written into its main view as restore-time state that records no View and lighting step. Without one (fixtures)
 * the preview actions keep a private one-view graph over the restored preview.
 */
export function createTrustedPreviewServices(workspace: WorkspaceState, ports: {
  savedAppearance: SavedAppearancePort;
  preview: PreviewPort;
  motion: MotionPort;
}, graph?: ViewGraph) {
  const savedAppearance = new SavedAppearanceActions(ports.savedAppearance);
  const restoredSavedAppearance = workspace.savedV
    ? savedAppearance.dispatch({ kind: "savedV.restore", value: workspace.savedV }) : undefined;
  // A private copy: restoring adjusts it (unavailable details, piercing and eye-shape fallbacks), never the caller's workspace.
  // With the workspace's graph, a head (a retry too) restores what the graph's main view holds now.
  const initial = structuredClone(graph ? { ...workspace.preview, ...previewMirror(graph) } : workspace.preview);
  for (const detail of ["brows", "lashes"] as const) {
    if (ports.preview.availability?.(detail)) initial[detail] = false;
  }
  // A requested hair or piercing toggle is kept while the V's details are still on their way. The piercing style tried on the V is the
  // character-detail service's (it validates the persisted one itself; character-detail-actions.ts).

  // A restored eye shape the loaded head does not offer falls back to its base shape.
  const eyeChoices = ports.preview.eyeShapeOptions?.().choices;
  if (eyeChoices && !eyeChoices.some(choice => choice.index === initial.eyeShape)) initial.eyeShape = 0;

  // These scene settings preceded surface-control construction in the original startup.
  // The eye's own roughness is on unless the viewer turned it off (the retired `eyeOptics` opt-in is not read).
  ports.preview.setEyeOptics(initial.eyeOwnRoughness ?? true);
  ports.preview.setEyeShape(initial.eyeShape);
  ports.preview.setWire(initial.wire);
  ports.preview.setNormals(initial.normals);
  ports.preview.setExposure(initial.exposure);
  ports.preview.setLightAngle(initial.lightAngle);
  ports.preview.setStudioLights?.(initial.studioLights);
  ports.preview.setCreatorLighting?.(initial.creatorLighting);
  if (!ports.preview.setLightingPreset) initial.lightingPreset = "studio";
  else ports.preview.setLightingPreset(initial.lightingPreset);
  for (const detail of ["brows", "lashes"] as const)
    ports.preview.setDetail(detail, initial[detail]);
  ports.preview.setHair(initial.hair);
  ports.preview.setPhysics?.(initial.physics === true);

  return {
    savedAppearance,
    restoredSavedAppearance,
    /** Call after the surface editor exists. Motion restores before neutral-space camera state. */
    finish() {
      ports.preview.setSurfaceControls(initial.surface);
      // Motion's scene settings (hair physics) live in the view graph's scene node, which the preview service edits.
      let preview: PreviewActions | undefined;
      const motion = new MotionActions(initial, ports.motion, { physics: view => preview?.scenePhysics(view) ?? initial.physics === true,
        setPhysics: (enabled, view) => preview?.setScenePhysics(enabled, view) });
      motion.restore();
      // The head shows the restored state now: the graph's main view learns the fallbacks it needed.
      graph?.withoutHistory(() => {
        const seed = { applied: true, seed: true } as const;
        graph.edit(MAIN_VIEW, "display", { state: { brows: initial.brows, lashes: initial.lashes } }, seed);
        graph.edit(MAIN_VIEW, "scene", { state: { eyeShape: initial.eyeShape } }, seed);
        graph.edit(MAIN_VIEW, "lights", { kind: initial.lightingPreset }, seed);
      });
      preview = new PreviewActions(initial, ports.preview, graph);
      ports.preview.setPiercings(initial.piercings);
      ports.preview.setBody?.(initial.body ?? true);
      // A saved camera is where the workspace left it, not a jump: no View and lighting step, no Back trail entry.
      if (initial.camera) preview.restoreSavedCamera(initial.camera);
      return { preview, motion };
    },
  };
}
