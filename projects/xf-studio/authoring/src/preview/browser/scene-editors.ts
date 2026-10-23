/**
 * The scene editors (profiles phase 4a-vi, experiment 043 §13): the on-head editor bound per view to the look that view's scene shows, the
 * layered surfaces a scene connects, and the UV editor's hooks. Built here, so the composition root only wires them (it was UI-boundary
 * exception 17 until 4a-vi).
 *
 * - **Surfaces.** Every composed layered surface is registered (the composition's list), and a scene connects the one its look editor edits
 *   (profiles design §7, the `liveSurface` row): the editor's preview device fills its layers, and it carries the on-head editor. The
 *   surfaces of features no look editor edits have no layer source yet (the look editor edits one feature's part). Nothing here, and nothing
 *   in the root, names a feature: which surface is wired follows from the look editor's own feature.
 * - **The on-head editor per view.** `mount(head, view)` mounts it on the head shown for `view`, once the head has connected its surface, and
 *   follows the head's Surface controls tool. Its selections and gestures name the look `view`'s scene shows (the input layer's naming for
 *   that view, `naming`: its panel's resolution, profiles design §3.3, §3.6), and its gestures come from `view`. The release unmounts it,
 *   settling a gesture still open (cancelled), and withdraws the surface's outline.
 * - **One edited look until phase 2.** The look editor edits one document, the drawn scene's look, and the editors' preview source rasters
 *   it. Until phase 2 gives each view its own document, a view whose scene shows another look can't be drawn: `refusal(view)` says so
 *   plainly, and the runtime owner refuses `show(view)` with it, so the editor never names one look while showing another's layers.
 * - **The UV editor** is a panel, not a view, until view graph P6: it edits the look the drawn view shows (`drawn`), so only its naming lives
 *   here; the root mounts it with its canvas and the device's reads.
 */
import type { FeatureRendererFactory } from "../../platform/api/scene";
import type { ViewId } from "../../platform/api/view-graph";
import type { LayeredSurfaceRenderer } from "../../engines/layered-makeup/render/makeup-stack";
import { surfaceOutline } from "../../engines/layered-makeup/surface-edge";
import type { StudioAction } from "../../app/studio-application";
import type { AdapterMessage } from "../../app/presentation-status";
import { sameLook, type LookRef } from "../../library/collection-documents";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
import type { AttachedHead, HeadServices, LayeredSurfaceWiring } from "./browser-head-attachment";
import type { createBrowserViewportDevice } from "./browser-viewport-device";

type Core = ReturnType<typeof createTrustedAuthoringCore>;
type ViewportDevice = ReturnType<typeof createBrowserViewportDevice>;
type SurfaceHooks = Parameters<ViewportDevice["mountSurface"]>[1];
type UVHooks = Parameters<ViewportDevice["mountUV"]>[2];

/** The registered layered surfaces, by feature (the composition's renderer list). */
export type LayeredSurfaces = ReadonlyMap<string, FeatureRendererFactory<LayeredSurfaceRenderer>>;

export type SceneEditorPorts = {
  surfaces: LayeredSurfaces;
  /** The look editor: the feature whose part it edits, the device that rasters its layers, and the look its document shows (`ref`). */
  look: { readonly feature: string; readonly preview: LayeredSurfaceWiring["preview"]; ref(): LookRef | undefined };
  /** The authoring core: the layers and selection the editors draw, and the application's gestures and dispatch. */
  core: { geometry: Pick<Core["geometry"], "layer" | "recipe">; presentation: Pick<Core["presentation"], "selected" | "layer" | "selectedField">;
    app: Pick<Core["app"], "dispatch" | "beginGesture" | "applyGesture" | "endGesture" | "surfaceEdge"> };
  /**
   * The input layer's naming for a view (the resolution of the panel that shows it; only the input layer reads the resolver): the look the
   * view's scene shows, and an action with the targets it leaves out named as that view names them.
   */
  naming: { look(view: ViewId): LookRef | undefined; complete(action: { kind: string } & Record<string, unknown>, view: ViewId): StudioAction };
  /** The view drawn now (the UV editor edits the look it shows). */
  drawn(): ViewId;
  viewport: Pick<ViewportDevice, "mountSurface" | "unmountSurface">;
  /** Connects head services to the application: the edited surface's outline while the on-head editor is mounted. */
  attach(services: Pick<HeadServices, "surfaceOutline">): void;
  /** A plain message from an editor (`surface`: the on-head editor's; `uv`: the UV editor's). */
  message(source: AdapterMessage["source"], text: string): void;
};

/** Why a view whose scene shows another look can't be drawn yet (phase 2 edits each view's look). */
export const ANOTHER_LOOK = "That view shows a different look from the one you're editing, and two looks can't be edited side by side yet.";

export function createSceneEditors(ports: SceneEditorPorts) {
  const { core, naming } = ports;
  const edited = ports.surfaces.get(ports.look.feature);
  const wiring: readonly LayeredSurfaceWiring[] = edited
    ? [{ feature: edited.feature, surface: scene => scene.feature(edited), preview: ports.look.preview, edited: true }] : [];
  /** The selection hooks both editors share, naming what `view` shows. */
  const selection = (view: () => ViewId) => ({
    layer: () => core.geometry.layer(), selected: () => core.presentation.selected,
    selectedField: () => core.presentation.selectedField()?.id,
    selectField: (id: string) => { const layer = core.presentation.layer(); if (layer) core.app.dispatch(naming.complete({ kind: "field.select", layerId: layer.id, fieldId: id }, view())); },
    select: (index: number) => { const layer = core.presentation.layer(); if (layer) core.app.dispatch(naming.complete({ kind: "point.select", layerId: layer.id, index }, view())); },
  });
  /** A gesture from `source`, on the look `view` shows when it begins. */
  const gestures = (source: string, view: () => ViewId) => ({
    begin: () => { const layer = core.presentation.layer(); if (layer) core.app.beginGesture(source, layer.id, naming.look(view())); },
    apply: (proposal: Parameters<Core["app"]["applyGesture"]>[1]) => core.app.applyGesture(source, proposal),
    cancel: () => core.app.endGesture(source, true), finish: () => core.app.endGesture(source),
  });

  return {
    /** The layered surfaces each head connects (in composition order; the edited one carries the on-head editor). */
    wiring,
    /** The renderer of the surface the look editor edits (developer evidence reads it). */
    edited,
    /**
     * Mount the on-head editor on `head`, shown for `view` (its surface connected): it edits the look `view`'s scene shows, and follows the
     * head's Surface controls tool. Returns the release, which unmounts it (a gesture still open is cancelled) and withdraws its outline.
     */
    mount(head: AttachedHead, view: ViewId): () => void {
      const surfaced = wiring.find(item => item.edited), makeup = surfaced?.surface(head.scene);
      if (!makeup) return () => {};
      const hooks: SurfaceHooks = { ...selection(() => view), ...gestures(view, () => view),
        layers: () => core.geometry.recipe().layers, message: text => ports.message("surface", text) };
      const editor = ports.viewport.mountSurface(makeup.surface, hooks);
      const follow = () => editor.setEnabled(head.surfaceControls());
      follow();
      const off = head.onSurfaceControls(follow);
      // The anchor's rest positions and UVs, read per element (glTF attributes may be interleaved): where its makeup is cut off (PREV-146).
      const geometry = makeup.surface.geometry, uv = geometry?.getAttribute("uv"), position = geometry?.getAttribute("position");
      if (uv && position) {
        const uvs = new Float64Array(uv.count * 2), positions = new Float64Array(position.count * 3);
        for (let i = 0; i < uv.count; i++) { uvs[2 * i] = uv.getX(i); uvs[2 * i + 1] = uv.getY(i); }
        for (let i = 0; i < position.count; i++) { positions[3 * i] = position.getX(i); positions[3 * i + 1] = position.getY(i); positions[3 * i + 2] = position.getZ(i); }
        ports.attach({ surfaceOutline: surfaceOutline({ positions, uvs, index: geometry!.index?.array ?? null }) });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        off();
        ports.viewport.unmountSurface();
        ports.attach({ surfaceOutline: undefined });
      };
    },
    /**
     * Why `view` can't be drawn now (undefined: it can): its scene shows another look than the one the look editor's document shows, and
     * until phase 2 one document is edited at a time (see the header).
     */
    refusal(view: ViewId): string | undefined {
      const shows = naming.look(view), edited = ports.look.ref();
      const same = shows && edited ? sameLook(shows, edited) : !shows && !edited;
      return same ? undefined : ANOTHER_LOOK;
    },
    /** The UV editor's hooks: the drawn view's look (a panel until view graph P6), its gestures from the UV view. */
    uvHooks(): Pick<UVHooks, "recipe" | "layer" | "selected" | "selectedField" | "selectField" | "select" | "surfaceEdge" | "begin" | "apply" | "cancel" | "finish" | "message"> {
      return { ...selection(ports.drawn), ...gestures("uv", ports.drawn), recipe: () => core.geometry.recipe(),
        surfaceEdge: () => core.app.surfaceEdge(core.presentation.layer()?.id), message: text => ports.message("uv", text) };
    },
  };
}
