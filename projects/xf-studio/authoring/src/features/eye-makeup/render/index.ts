/**
 * Eye makeup's renderer (feature-module platform §5): the layered-makeup engine's plate composite (`makeup-stack`) on the expanded
 * eye plate, lit once with the drawn skin's own light over the skin read under the plate. It reaches the scene only through the
 * scene port: the plate surface from the core record, the skin underlay and light, context restores and frame requests.
 *
 * The layers themselves arrive from the preview device (browser-preview-device.ts), which fills `layers` with the raster worker's
 * complete masks and maps; the composition root hands this renderer's `LayeredMakeupSurface` to it and to the on-head editor.
 */
import type * as THREE from "three";
import { invalidating, type FeatureRenderer, type FeatureRendererFactory, type SceneHostPort, type SurfaceUnderlay } from "../../../platform/api/scene";
import { createMakeupStack, type LayeredMakeupSurface, type MakeupLayers } from "../../../engines/layered-makeup/render/makeup-stack";
import { EYE_MAKEUP_ID } from "..";

/** The core record's surface the eye makeup plate is (render-detail.ts `geometry.nodes.plate`). */
export const EYE_PLATE_SURFACE = "plate";

export type EyeMakeupRenderer = FeatureRenderer & LayeredMakeupSurface & {
  /** Study tools read the slot meshes and materials (tools/depth-study.ts, tools/glitter-head-study.ts). */
  readonly plates: readonly THREE.SkinnedMesh[];
  readonly materials: readonly THREE.MeshPhysicalMaterial[];
  pick(ray: THREE.Raycaster): { x: number; y: number } | undefined;
  /** Per-slot GPU diagnostics. */
  diagnostics(): unknown;
  /** How the authored plate is drawn: the export plan's layers in one lit plate, its light, the skin underlay's source and the composite. */
  evidence(): unknown;
};

function createEyeMakeupRenderer(host: SceneHostPort): EyeMakeupRenderer {
  const found = host.anchors().surface(EYE_PLATE_SURFACE);
  if (!found) throw Error("The 3D preview has no eye plate.");
  const plate: THREE.SkinnedMesh = found;
  const detached: (() => void)[] = [];
  const stack = createMakeupStack(plate, host.renderer.capabilities.getMaxAnisotropy(),
    mesh => { detached.push(host.attach(mesh, { beside: plate })); });
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
    pick(ray) {
      plate.computeBoundingSphere();
      const uv = ray.intersectObject(plate, false)[0]?.uv;
      return uv ? { x: uv.x, y: uv.y } : undefined;
    },
    diagnostics: stack.diagnostics,
    evidence: () => ({ ...stack.blendDiagnostics(), source }),
    dispose() {
      for (const release of releases.splice(0)) release();
      stack.dispose();
      for (const detach of detached.splice(0)) detach();
    },
  };
}

/** Eye makeup's renderer entry in the composition (compose/renderers.ts). */
export const EYE_MAKEUP_RENDERER: FeatureRendererFactory<EyeMakeupRenderer> = Object.freeze({ feature: EYE_MAKEUP_ID, create: createEyeMakeupRenderer });

/** Eye makeup's renderer on a loaded scene host, for the composition root's devices (undefined when it isn't composed). */
export function eyeMakeupRenderer(scene: { feature(id: string): FeatureRenderer | undefined }): EyeMakeupRenderer | undefined {
  return scene.feature(EYE_MAKEUP_ID) as EyeMakeupRenderer | undefined;
}
