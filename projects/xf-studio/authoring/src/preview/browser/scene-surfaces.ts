/**
 * A scene's layered-makeup surfaces (profiles design §7, the `liveSurface` row): the composition root registers every composed layered
 * surface, and each scene connects the ones its look editor edits. The editor's preview device fills their layers, and the on-head editor
 * edits them through hooks that name the look the scene shows (the input layer's capture, §3.3). The surfaces of features no look editor
 * edits have no layer source yet: phase 1 draws one view and its look editor edits one feature's part.
 *
 * Nothing here, and nothing in the root, names a feature: which surface is wired follows from the look editor's own feature.
 */
import type { FeatureRendererFactory } from "../../platform/api/scene";
import type { LayeredSurfaceRenderer } from "../../engines/layered-makeup/render/makeup-stack";
import type { LayeredSurfaceWiring } from "./browser-head-attachment";

/** The registered layered surfaces, by feature (the composition's renderer list). */
export type LayeredSurfaces = ReadonlyMap<string, FeatureRendererFactory<LayeredSurfaceRenderer>>;
/** A scene's look editor: the feature whose part it edits, the device that rasters its layers, and the on-head editor's hooks. */
export type SceneLookEditor = { readonly feature: string; readonly preview: LayeredSurfaceWiring["preview"];
  readonly editor: NonNullable<LayeredSurfaceWiring["editor"]> };

/** The scene's surface wiring (at most one surface carries the on-head editor), and the renderer of the surface its look editor edits. */
export function sceneLayeredSurfaces(surfaces: LayeredSurfaces, look: SceneLookEditor): {
  readonly wiring: readonly LayeredSurfaceWiring[];
  readonly edited?: FeatureRendererFactory<LayeredSurfaceRenderer>;
} {
  const edited = surfaces.get(look.feature);
  if (!edited) return { wiring: [] };
  return { edited, wiring: [{ feature: edited.feature, surface: scene => scene.feature(edited), preview: look.preview, editor: look.editor }] };
}
