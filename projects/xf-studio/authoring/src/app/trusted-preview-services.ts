import { MotionActions, type MotionPort } from "../animation/motion-actions";
import { PreviewActions, type PreviewPort } from "../preview/preview-actions";
import { SavedAppearanceActions, type SavedAppearancePort } from "../character/saved-appearance-actions";
import type { WorkspaceState } from "./workspace/workspace-state";
import type { ViewGraph } from "../platform/core/view-graph";
import type { ViewId } from "../platform/api/view-graph";
import { createStudioViewGraph, previewLights, previewMirror, type SceneState } from "../preview/preview-view-graph";
import { lightingSource } from "../preview/lighting-setups";
import { DEFAULT_MOTION, type MotionScene } from "../animation/scene-motion";

/**
 * The motion service's scene (scene-motion.ts): the motion settings in the scene node of the view the device draws (`drawn`, read each
 * time: the device may be shown for another view of the scene), edited as the device already shows them (no View and lighting step); hair
 * physics through the preview service.
 */
export function graphMotionScene(graph: ViewGraph, preview: () => PreviewActions | undefined, drawn: () => ViewId): MotionScene {
  return {
    motion: () => structuredClone(graph.state<SceneState>(drawn(), "scene").motion ?? DEFAULT_MOTION),
    setMotion: (motion, options) => {
      if (options?.sample) graph.sample(drawn(), "scene", { motion });
      else graph.edit(drawn(), "scene", { state: { motion } }, { applied: true });
    },
    physics: view => preview()?.scenePhysics(view) ?? graph.state<SceneState>(drawn(), "scene").physics === true,
    setPhysics: (enabled, view) => preview()?.setScenePhysics(enabled, view),
  };
}

/**
 * Restore the preview from workspace data without reading presentation controls. `views` is the workspace's view graph (the
 * composition root's, which outlives any one head) and the view the head is made for (its runtime owner names it: experiment 043 §13);
 * an unavailable detail is written into that view's display as restore-time state that records no View and lighting step. What the head
 * can't honour of its **scene** (an eye shape it lacks, an idle it can't play) is not written: several runtimes may share the scene, so its
 * node keeps the person's choice and this head shows its own fallback (experiment 043 §10). The motion is the drawn view's scene's (its
 * node's `motion`). Without a graph (fixtures) the services keep a private one-view graph over the restored preview.
 *
 * Restore order: the saved V, the optics, eye shape and details when the head is built; then, each time the head is shown (`show`), the
 * motion and then the camera (the camera node's pose, which the head shown before wrote when it was hidden).
 */
export function createTrustedPreviewServices(workspace: WorkspaceState, ports: {
  savedAppearance: SavedAppearancePort;
  preview: PreviewPort;
  motion: MotionPort;
}, views?: { graph: ViewGraph; view: ViewId }) {
  const graph = views?.graph;
  const savedAppearance = new SavedAppearanceActions(ports.savedAppearance);
  const restoredSavedAppearance = workspace.savedV
    ? savedAppearance.dispatch({ kind: "savedV.restore", value: workspace.savedV }) : undefined;
  // A private copy: restoring adjusts it (unavailable details, piercing and eye-shape fallbacks), never the caller's workspace.
  // With the workspace's graph, a head (a retry too) restores what the graph's main view holds now.
  // The graph's mirror holds `lightingSetups` only while there are user setups: the stored field never outlives them.
  const { lightingSetups: _stored, ...stored } = workspace.preview;
  const initial = structuredClone(views ? { ...stored, ...previewMirror(views.graph, views.view) } : workspace.preview);
  for (const detail of ["brows", "lashes"] as const) {
    if (ports.preview.availability?.(detail)) initial[detail] = false;
  }
  // A requested hair or piercing toggle is kept while the V's details are still on their way. The piercing style tried on the V is the
  // character-detail service's (it validates the persisted one itself; character-detail-actions.ts).

  // A restored eye shape the loaded head does not offer: this head shows its base shape (the scene node keeps the choice).
  const eyeChoices = ports.preview.eyeShapeOptions?.().choices;
  if (eyeChoices && !eyeChoices.some(choice => choice.index === initial.eyeShape)) initial.eyeShape = 0;

  // These scene settings preceded surface-control construction in the original startup.
  // The eye's own roughness is on unless the viewer turned it off (the retired `eyeOptics` opt-in is not read).
  ports.preview.setEyeOptics(initial.eyeOwnRoughness ?? true);
  ports.preview.setEyeShape(initial.eyeShape);
  ports.preview.setWire(initial.wire);
  ports.preview.setNormals(initial.normals);
  // The Rendering options, each at its default unless the viewer changed it (skin scatter and face shadows on, Crisp hair).
  ports.preview.setSkinScatter?.(initial.skinScatter ?? true);
  ports.preview.setFaceShadows?.(initial.faceShadows ?? true);
  ports.preview.setHairLook?.(initial.hairLook ?? 0);
  // The shown lighting setup (a workspace saved before setups migrates: lighting-setups.ts).
  const lights = previewLights(initial);
  ports.preview.setLighting?.(lightingSource({ setup: lights.setup, setups: lights.setups }, lights.creatorLighting));
  for (const detail of ["brows", "lashes"] as const)
    ports.preview.setDetail(detail, initial[detail]);
  ports.preview.setHair(initial.hair);
  ports.preview.setPhysics?.(initial.physics === true);

  return {
    savedAppearance,
    restoredSavedAppearance,
    /** Call after the surface editor exists. The motion and camera are applied by `show`. */
    finish() {
      ports.preview.setSurfaceControls(initial.surface);
      const own = views ?? { graph: createStudioViewGraph(initial), view: undefined };
      const graph = own.graph, view = own.view ?? graph.viewIds()[0]!;
      // The motion lives in the drawn view's scene node, and its scene settings (hair physics) through the preview service.
      let preview: PreviewActions | undefined;
      const motion = new MotionActions(ports.motion, graphMotionScene(graph, () => preview, () => preview?.view() ?? view));
      // The head shows the restored display now: the view learns the details it couldn't show.
      graph.withoutHistory(() => graph.edit(view, "display", { state: { brows: initial.brows, lashes: initial.lashes } }, { applied: true, seed: true }));
      preview = new PreviewActions(initial, ports.preview, graph, view);
      ports.preview.setPiercings(initial.piercings);
      ports.preview.setBody?.(initial.body ?? true);
      const shown = preview;
      return { preview, motion,
        /**
         * The head is shown (first, or again after another head was): the scene's motion, then the camera. The camera is the view's
         * camera node's pose (the head shown before wrote it when it was hidden), else where the workspace left it: not a jump, so no View
         * and lighting step and no Back trail entry.
         */
        show(drawn?: ViewId) {
          shown.draw(drawn ?? shown.view());
          motion.restore();
          const camera = shown.storedCamera() ?? initial.camera;
          if (camera) shown.restoreSavedCamera(camera);
        },
        /**
         * Another head takes the view: this one's camera pose goes to the camera node, then its motion is released. A view that no longer
         * exists (its tab closed while it was drawn) keeps nothing.
         */
        hide() {
          const kept = graph.has(shown.view());
          if (kept) shown.storeCamera();
          motion.release(kept);
          shown.draw(null);
        } };
    },
  };
}
