/**
 * The scene editors (profiles phase 4a-vi, experiment 043 §13): the on-head editor bound per view to the look that view's scene shows, the
 * layered surfaces a scene connects. Built here, so the composition root only wires them (it was UI-boundary
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
 * - **One editor document follows the drawn view** (experiment 044 decision D3). The look editor edits the drawn scene's look, and the
 *   editors' preview source rasters it. Drawing a view of another look switches the document only after the head on screen let its layers
 *   go and this editor was unmounted (browser-scene-heads.ts), so the editor never names one look while showing another's layers.
 * Flat editors are independently bound panel adapters (panel-uv.ts); there is no singleton UV hook bundle.
 */
import type { FeatureRendererFactory } from "../../platform/api/scene";
import type { ViewId } from "../../platform/api/view-graph";
import type { LayeredSurfaceRenderer } from "../../engines/layered-makeup/render/makeup-stack";
import type { StudioAction } from "../../app/studio-application";
import type { AdapterMessage } from "../../app/presentation-status";
import type { LookRef } from "../../library/collection-documents";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
import type { AttachedHead, HeadServices, LayeredSurfaceWiring } from "./browser-head-attachment";
import type { createBrowserViewportDevice } from "./browser-viewport-device";

import { registeredEditorAdapters, type BrowserEditorAdapters } from "./editor-adapters";

type Core = ReturnType<typeof createTrustedAuthoringCore>;
type ViewportDevice = ReturnType<typeof createBrowserViewportDevice>;

/** The registered layered surfaces, by feature (the composition's renderer list). */
export type LayeredSurfaces = ReadonlyMap<string, FeatureRendererFactory<LayeredSurfaceRenderer>>;

export type SceneEditorPorts = {
  surfaces: LayeredSurfaces;
  /** The look editor: the feature whose part it edits and the device that rasters its layers. */
  look: { readonly feature: string; readonly preview: LayeredSurfaceWiring["preview"] };
  /** Bound services are opaque to the core host; only the registered adapter interprets the projection. */
  core: Pick<Core, "app" | "documents">;
  adapters?: BrowserEditorAdapters;
  /**
   * The input layer's naming for a view (the resolution of the panel that shows it; only the input layer reads the resolver): the look the
   * view's scene shows, and an action with the targets it leaves out named as that view names them.
   */
  naming: { look(view: ViewId | undefined): LookRef | undefined; complete(action: { kind: string } & Record<string, unknown>, view: ViewId | undefined): StudioAction };
  /** The view drawn now (the UV editor edits the look it shows; undefined: none is drawn). */
  drawn(): ViewId | undefined;
  viewport: Pick<ViewportDevice, "mountSurface" | "unmountSurface" | "surfaceOutline">;
  /** Connects head services to the application: the edited surface's outline while the on-head editor is mounted. */
  attach(services: Pick<HeadServices, "surfaceOutline">): void;
  /** A plain message from an editor (`surface`: the on-head editor's; `uv`: the UV editor's). */
  message(source: AdapterMessage["source"], text: string): void;
};


export function createSceneEditors(ports: SceneEditorPorts) {
  const { core, naming } = ports;
  const adapters = ports.adapters ?? registeredEditorAdapters(core);
  const edited = ports.surfaces.get(ports.look.feature);
  const wiring: readonly LayeredSurfaceWiring[] = edited
    ? [{ feature: edited.feature, surface: scene => scene.feature(edited), preview: ports.look.preview, edited: true }] : [];
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
      const surfaced = wiring.find(item => item.edited), surface = surfaced?.surface(head.scene);
      if (!surface || !adapters?.surface) return () => {};
      const life = new AbortController();
      const editor = ports.viewport.mountSurface(surface.surface, { state: core, source: view, signal: life.signal,
        look: () => naming.look(view), complete: action => naming.complete(action, view), check: () => ({ available: true }),
        message: text => ports.message("surface", text) });
      if (!editor) { life.abort(); return () => {}; }
      const follow = () => editor.setEnabled(head.surfaceControls());
      follow();
      const off = head.onSurfaceControls(follow);
      ports.attach({ surfaceOutline: ports.viewport.surfaceOutline(surface.surface) });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        off();
        ports.viewport.unmountSurface();
        life.abort();
        ports.attach({ surfaceOutline: undefined });
      };
    },

  };
}
