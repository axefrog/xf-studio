import * as THREE from "three";

/**
 * The renderer-global state one scene draws with (profiles phase 4a-ii, experiments/043-scene-runtimes §2.6). Several scene runtimes
 * share one `WebGLRenderer` (the renderer device's), and these fields live on the renderer, not on a scene: a runtime that left its
 * exposure or its clear colour behind would change how the next one draws. So every draw, and every compile ahead (Three keys a
 * program on tone mapping, output colour space and the shadow map's switch and type), opens by applying the drawing runtime's whole
 * record. Nothing else writes these fields.
 *
 * The shadow map's `needsUpdate` is in the record too: a runtime's maps are its own lights', so whether they need drawing again is
 * that runtime's pending flag, set explicitly true or false on each draw, never left over from another runtime's frame.
 */
export type RendererState = {
  toneMapping: THREE.ToneMapping;
  /** The studio display's exposure (Three's tone mapping); the game display grades in its own pass and leaves it as it was. */
  toneMappingExposure: number;
  clearColour: number;
  clearAlpha: number;
  outputColorSpace: THREE.ColorSpace;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType; autoUpdate: boolean };
};

/** What every scene starts from: the viewport's dark clear colour, ACES at 1.2, sRGB output, soft shadow maps redrawn only on demand. */
export const SCENE_RENDERER_STATE: Readonly<RendererState> = Object.freeze({
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.2,
  clearColour: 0x14181c,
  clearAlpha: 1,
  outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: Object.freeze({ enabled: true, type: THREE.PCFShadowMap, autoUpdate: false }),
});

/** The part of `WebGLRenderer` the record writes (a recording fake implements it in tests). */
export type StatefulRenderer = Pick<THREE.WebGLRenderer, "toneMapping" | "toneMappingExposure" | "outputColorSpace" | "setClearColor" | "setRenderTarget"> & {
  shadowMap?: Pick<THREE.WebGLShadowMap, "enabled" | "type" | "autoUpdate" | "needsUpdate">;
};

/**
 * Apply `state` to the renderer: every field, so nothing another scene set survives. `shadowNeedsUpdate` is the drawing runtime's own
 * pending flag (left as it is when absent: a compile ahead draws no shadow pass). The render target is the canvas.
 */
export function applyRendererState(renderer: StatefulRenderer, state: Readonly<RendererState>, shadowNeedsUpdate?: boolean): void {
  renderer.toneMapping = state.toneMapping;
  renderer.toneMappingExposure = state.toneMappingExposure;
  renderer.outputColorSpace = state.outputColorSpace;
  renderer.setClearColor(state.clearColour, state.clearAlpha);
  renderer.setRenderTarget(null);
  const shadowMap = renderer.shadowMap;
  if (!shadowMap) return;
  shadowMap.enabled = state.shadowMap.enabled;
  shadowMap.type = state.shadowMap.type;
  shadowMap.autoUpdate = state.shadowMap.autoUpdate;
  if (shadowNeedsUpdate !== undefined) shadowMap.needsUpdate = shadowNeedsUpdate;
}
