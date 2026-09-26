/**
 * Eye makeup's renderer (feature-module platform §5): the layered-makeup engine's plate composite (`makeup-stack`) on the expanded
 * eye plate, lit once with the drawn skin's own light over the skin read under the plate. It reaches the scene only through the
 * scene port: the plate surface from the core record (read-only; the stack draws copies of it), its draw-order band, the skin underlay
 * and light, context restores and frame requests.
 *
 * The layers themselves arrive from the preview device (browser-preview-device.ts), which fills `layers` with the raster worker's
 * complete masks and maps; the composition lists this renderer as eye makeup's layered surface (compose/renderers.ts), and the root
 * hands its `LayeredMakeupSurface` to the preview device and the on-head editor.
 */
import type * as THREE from "three";
import { invalidating, type FeatureRendererFactory, type SceneHostPort, type SurfaceUnderlay } from "../../../platform/api/scene";
import { createMakeupStack, type LayeredSurfaceRenderer, type MakeupLayers } from "../../../engines/layered-makeup/render/makeup-stack";
import { MAX_LAYERS } from "../../../engines/layered-makeup/recipe";
import { EYE_MAKEUP_ID } from "..";
import { EYE_MAKEUP_REGION } from "../region";

/** The core record's surface the eye makeup plate is (render-detail.ts `geometry.nodes.plate`). */
export const EYE_PLATE_SURFACE = "plate";

export type EyeMakeupRenderer = LayeredSurfaceRenderer & {
  /** Study tools read the slot meshes and materials (tools/depth-study.ts, tools/glitter-head-study.ts). */
  readonly plates: readonly THREE.SkinnedMesh[];
  readonly materials: readonly THREE.MeshPhysicalMaterial[];
  /** How the authored plate is drawn: the export plan's layers in one lit plate, its light, the skin underlay's source and the composite. */
  evidence(): unknown;
};

function createEyeMakeupRenderer(host: SceneHostPort): EyeMakeupRenderer {
  const found = host.anchors().surface(EYE_PLATE_SURFACE);
  if (!found) throw Error("The 3D preview has no eye plate.");
  const plate: THREE.SkinnedMesh = found;
  const detached: (() => void)[] = [];
  // One draw-order slot per layer, in the band the host gave eye makeup (10 to 41 as its first feature).
  const stack = createMakeupStack(plate, host.renderer.capabilities.getMaxAnisotropy(), EYE_MAKEUP_REGION.fineGlitter, {
    attach: mesh => { detached.push(host.attach(mesh, { beside: plate })); },
    renderOrder: slot => host.renderBand.order(slot),
  });
  // The skin under the authored plate, which the plate blends over and lights once with the skin's own light (plate-blend.ts): read on
  // the drawn head, like the face decals' underlay, once per skin change and only when a layer first needs it. A plate not over the
  // drawn head keeps a linear blend per layer; without a resolved skin the plate is lit with the standard light, as the face decals.
  let source: { evidence?: SurfaceUnderlay["evidence"]; error?: string } = {};
  function refreshUnderlay() {
    stack.setSkinLight(host.skin.light());
    source = {};
    stack.setUnderlaySource(() => {
      try {
        const result = host.skin.underlay(plate);
        source = { evidence: result.evidence };
        return result;
      } catch (error) { source = { error: (error as Error).message }; return null; }
    });
  }
  refreshUnderlay();
  const releases = [host.skin.subscribe(refreshUnderlay), host.onContextRestored(() => stack.contextRestored())];
  // Every layer change draws a frame; the readers (does a layer need maps?) do not.
  const layers: MakeupLayers = { needsOptics: stack.needsOptics, needsAlbedo: stack.needsAlbedo,
    ...invalidating(stack, ["setCanvases", "reconcileLayerCanvases", "setLayerCanvas", "updateLayer"], host.requestFrame) };
  return {
    layers, surface: plate, maxTextureSize: host.renderer.capabilities.maxTextureSize,
    plates: stack.plates, materials: stack.materials,
    // The composite, only after a layer or the skin changed (plate-blend.ts).
    beforeDraw: () => stack.prepareBlend(host.renderer),
    setNormals: stack.setNormals,
    setWireframe: stack.setWire,
    evidence: () => ({ ...stack.blendDiagnostics(), source }),
    dispose() {
      for (const release of releases.splice(0)) release();
      stack.dispose();
      for (const detach of detached.splice(0)) detach();
    },
  };
}

/** Eye makeup's renderer entry in the composition (compose/renderers.ts): one draw-order slot per layer. */
export const EYE_MAKEUP_RENDERER: FeatureRendererFactory<EyeMakeupRenderer> = Object.freeze({ feature: EYE_MAKEUP_ID, renderSlots: MAX_LAYERS,
  create: createEyeMakeupRenderer });
