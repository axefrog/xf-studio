import { expect, test } from "bun:test";
import * as THREE from "three";
import { applyRendererState, SCENE_RENDERER_STATE, type RendererState } from "../src/platform/scene/renderer-state";
import { createLightingSetupStage } from "../src/preview/render/lighting-setup-stage";
import { studioStageSetup } from "../src/preview/lighting-setups";
import { DEFAULT_STUDIO_STAGE } from "../src/preview/studio-lighting";

/**
 * The renderer-state contract (profiles phase 4a-ii, experiments/043-scene-runtimes §2.6, risk 4): several scene runtimes share one
 * renderer, so each draw opens with the drawing scene's whole record and nothing another scene left survives. A recording fake renderer
 * stands in for Three's; the A-B-A pixel identity on a real GPU is tests/webgl-renderer-device.test.ts.
 */

/** Records what each render saw of the renderer's global state. */
function recordingRenderer() {
  const seen: { toneMapping: number; exposure: number; colorSpace: string; clear: string; target: unknown; shadow: string }[] = [];
  let target: unknown = null, clear = { colour: 0xffffff, alpha: 0 };
  const renderer = {
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping, toneMappingExposure: 9, outputColorSpace: THREE.LinearSRGBColorSpace as THREE.ColorSpace,
    shadowMap: { enabled: false, type: THREE.BasicShadowMap as THREE.ShadowMapType, autoUpdate: true, needsUpdate: false },
    autoClear: true,
    setClearColor(colour: THREE.ColorRepresentation, alpha = 1) { clear = { colour: new THREE.Color(colour).getHex(), alpha }; },
    getClearColor: (out: THREE.Color) => out.setHex(clear.colour), getClearAlpha: () => clear.alpha,
    setRenderTarget(next: unknown) { target = next; }, getRenderTarget: () => target,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8),
    render() {
      seen.push({ toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, colorSpace: renderer.outputColorSpace,
        clear: `${clear.colour.toString(16)}/${clear.alpha}`, target, shadow: `${renderer.shadowMap.enabled}:${renderer.shadowMap.type}:${renderer.shadowMap.autoUpdate}:${renderer.shadowMap.needsUpdate}` });
      // Three's shadow pass consumes a pending redraw.
      renderer.shadowMap.needsUpdate = false;
    },
  };
  return { renderer, seen };
}

test("applying a record sets every renderer-global field, the canvas as the target, and the shadow redraw only when given", () => {
  const { renderer } = recordingRenderer();
  renderer.setRenderTarget({});
  const state: RendererState = { ...SCENE_RENDERER_STATE, toneMappingExposure: 0.7, shadowMap: { ...SCENE_RENDERER_STATE.shadowMap } };
  applyRendererState(renderer as never, state);
  expect({ toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, colorSpace: renderer.outputColorSpace,
    clear: [renderer.getClearColor(new THREE.Color()).getHex(), renderer.getClearAlpha()], target: renderer.getRenderTarget(),
    shadow: { ...renderer.shadowMap } }).toEqual({ toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.7, colorSpace: THREE.SRGBColorSpace,
    clear: [0x14181c, 1], target: null, shadow: { enabled: true, type: THREE.PCFShadowMap, autoUpdate: false, needsUpdate: false } });
  applyRendererState(renderer as never, state, true);
  expect(renderer.shadowMap.needsUpdate).toBe(true);
  applyRendererState(renderer as never, state, false);
  expect(renderer.shadowMap.needsUpdate).toBe(false);
  // A compile ahead (no shadow pass) leaves the pending redraw as it is.
  renderer.shadowMap.needsUpdate = true;
  applyRendererState(renderer as never, state);
  expect(renderer.shadowMap.needsUpdate).toBe(true);
});

test("two scenes on one renderer: A, then B, then A each draw with their own state, whatever the other left", () => {
  const { renderer, seen } = recordingRenderer();
  const environment = () => ({ mode: "pmrem" as const, lights: [], restore: () => {}, dispose: () => {} });
  const stage = (exposure: number) => {
    const scene = new THREE.Scene();
    // A shadow-casting caster, so each scene's shadow fingerprint is its own.
    const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); caster.castShadow = true; scene.add(caster);
    const made = createLightingSetupStage({ scene, renderer: renderer as never, createEnvironment: environment, loadLut: () => new Promise(() => {}) });
    made.setSource({ kind: "setup", setup: { ...studioStageSetup(DEFAULT_STUDIO_STAGE), exposure } });
    return made;
  };
  const a = stage(0.8), b = stage(2.5), camera = new THREE.PerspectiveCamera();
  // Making a stage changes nothing on the shared renderer: its state is put there when it draws.
  expect([renderer.toneMappingExposure, renderer.shadowMap.enabled]).toEqual([9, false]);
  const draw = (which: typeof a) => { seen.length = 0; which.render(camera); return seen.at(-1)!; };
  const first = draw(a);
  // A's first frame: its own state, and its maps drawn (a fresh fingerprint).
  expect(first).toEqual({ toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.8, colorSpace: THREE.SRGBColorSpace, clear: "14181c/1", target: null,
    shadow: `true:${THREE.PCFShadowMap}:false:true` });
  expect(draw(b)).toMatchObject({ exposure: 2.5, shadow: `true:${THREE.PCFShadowMap}:false:true` });
  // Something else drawing in between (a bake, a study) leaves its own state behind.
  renderer.toneMappingExposure = 5; renderer.setClearColor(0xff0000, 0.5); renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.needsUpdate = true;
  const again = draw(a);
  // A draws exactly as it did: its exposure, tone mapping and clear colour; its maps are unchanged, so not drawn again for anyone else's flag.
  expect(again).toEqual({ ...first, shadow: `true:${THREE.PCFShadowMap}:false:false` });
  // A's own pending redraw is its own: a moved caster in A is drawn on A's next frame even after B drew in between.
  a.restore();
  draw(b);
  seen.length = 0; a.render(camera);
  expect(seen[0]!.shadow).toBe(`true:${THREE.PCFShadowMap}:false:true`);
  a.dispose(); b.dispose();
});
