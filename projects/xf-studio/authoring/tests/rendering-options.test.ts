import { expect, test } from "bun:test";
import * as THREE from "three";
import { HAIR_LOOK, hairCoverage, hairLookCoverage, resolveHairMaterial } from "../src/hair-colour-model";
import { attachHairColor, attachStrandCoverage } from "../src/hair-shading";
import { createLightingSetupStage } from "../src/lighting-setup-stage";
import { PreviewActions, type PreviewPort } from "../src/preview-actions";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { createStudioViewGraph, DEFAULT_RENDERING, previewMirror, STUDIO_VIEW_GRAPH_RULES } from "../src/preview-view-graph";
import { parseViewGraph } from "../src/platform/core/view-graph";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { parseWorkspace } from "../src/workspace-state";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { storedWorkspace } from "./fixtures/looks";
import { freshWorkspace } from "./fixtures/eye-region";
import { hairLookText, RENDERING_HELP } from "../src/studio-ui/panels/preview";

/** A preview port that records the Rendering calls. */
function port() {
  const calls: string[] = [];
  const value: PreviewPort = {
    cameraState: () => ({ position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 }), front: () => false, setFov: () => false, endFovGesture: () => {},
    restoreCamera: () => {}, setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {},
    setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
    setSkinScatter: enabled => calls.push(`scatter:${enabled}`), setFaceShadows: enabled => calls.push(`shadows:${enabled}`),
    setHairLook: look => calls.push(`hair:${look}`),
  };
  return { port: value, calls };
}

/** Run a material's shader patch over Three's physical shaders, as the renderer would before compiling. */
function patched(material: THREE.Material) {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

test("Hair look: Crisp is exactly the faithful coverage; Game-like boosts it ×1.33 and widens it with a lower threshold", () => {
  for (const cutoff of [0, 0.1, 0.3, 0.6]) for (const alpha of [0, 0.05, 0.2, 0.5, 0.9, 1])
    expect(hairLookCoverage(alpha, cutoff, 0)).toBe(hairCoverage(alpha, cutoff));
  expect(HAIR_LOOK.coverageBoost).toBe(1.33);
  // With no cutoff, Game-like is the boost alone.
  expect(hairLookCoverage(0.5, 0, 1)).toBeCloseTo(0.5 * 1.33, 12);
  // A soft edge below the material's cutoff counts at Game-like (the widening), and nothing gets thinner anywhere.
  expect(hairLookCoverage(0.25, 0.3, 0)).toBe(0);
  expect(hairLookCoverage(0.25, 0.3, 1)).toBeGreaterThan(0);
  for (const alpha of [0.1, 0.3, 0.5, 0.7]) {
    let previous = -1;
    for (const look of [0, 0.25, 0.5, 0.75, 1]) { const c = hairLookCoverage(alpha, 0.2, look); expect(c).toBeGreaterThanOrEqual(previous); previous = c; }
  }
  // Out-of-range looks clamp; a degenerate cutoff covers nothing at any look.
  expect(hairLookCoverage(0.5, 0.2, 7)).toBe(hairLookCoverage(0.5, 0.2, 1));
  expect(hairLookCoverage(1, 1, 1)).toBe(0);
});

test("Hair look: the strand and coverage shaders read one shared uniform, with the smoothing bias, the lower threshold and the boost", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const look = { value: 0 };
  const strand = new THREE.MeshPhysicalMaterial({ specularIntensity: 0, anisotropy: 1e-4, alphaMap: texture });
  attachHairColor(strand, { kind: "strand", id: texture, gradient: texture, profile: texture, sampleCount: 127, material: resolveHairMaterial(), look });
  const lash = new THREE.MeshStandardMaterial({ alphaMap: texture });
  attachStrandCoverage(lash, 0.2, look);
  for (const material of [strand, lash]) {
    const shader = patched(material), fragment = shader.fragmentShader;
    // The same object: a change of look needs no recompile, and every strand of the scene follows it.
    expect(shader.uniforms.xfsHairLook).toBe(look);
    expect(fragment).toContain("uniform float xfsAlphaCutoff, xfsHairLook;");
    expect(fragment).toContain("texture2D(alphaMap, vAlphaMapUv, xfsHairLook * 1.00000000)");
    expect(fragment).toContain("float strandCutoff = xfsAlphaCutoff * (1.0 - xfsHairLook * 0.300000000)");
    expect(fragment).toContain("strandRemapped *= 1.0 + xfsHairLook * 0.330000000");
    expect(fragment).not.toContain("#include <alphamap_fragment>");
  }
  // Without a look the strands are Crisp.
  const alone = new THREE.MeshPhysicalMaterial({ specularIntensity: 0, anisotropy: 1e-4, alphaMap: texture });
  attachHairColor(alone, { kind: "strand", id: texture, gradient: texture, profile: texture, sampleCount: 127, material: resolveHairMaterial() });
  expect(patched(alone).uniforms.xfsHairLook!.value).toBe(0);
});

test("Rendering actions: each edits the view's display node, reaches the device, and is one View and lighting step", () => {
  const workspace = freshWorkspace(), { port: p, calls } = port();
  const graph = createStudioViewGraph(workspace.preview), actions = new PreviewActions(workspace.preview, p, graph);
  expect(actions.rendering()).toEqual(DEFAULT_RENDERING);
  // Defaults are never written: an untouched workspace keeps its bytes.
  expect(Object.keys(actions.snapshot())).not.toContain("hairLook");
  actions.dispatch({ kind: "preview.setSkinScatter", enabled: false });
  actions.dispatch({ kind: "preview.setFaceShadows", enabled: false });
  expect(graph.history().undo).toBe("Face shadows off");
  // A drag coalesces into one step until the slider is released.
  for (const value of [0.2, 0.6, 1]) actions.dispatch({ kind: "preview.setHairLook", value });
  expect(graph.history()).toMatchObject({ undo: "Hair look", depth: 3 });
  expect(calls).toEqual(["scatter:false", "shadows:false", "hair:0.2", "hair:0.6", "hair:1"]);
  expect(actions.rendering()).toEqual({ skinScatter: false, faceShadows: false, hairLook: 1 });
  expect(actions.snapshot()).toMatchObject({ skinScatter: false, faceShadows: false, hairLook: 1 });
  // Undo steps the device back.
  graph.undo();
  expect(calls.at(-1)).toBe("hair:0");
  graph.undo();
  expect(calls.at(-1)).toBe("shadows:true");
  // Refusals in plain words; the descriptors bound the payloads.
  expect(actions.capability({ kind: "preview.setHairLook", value: 1.5 })).toEqual({ available: false, reason: "Hair look goes from Crisp (0) to Game-like (1)." });
  expect(actions.capability({ kind: "preview.setHairLook", value: Number.NaN }).available).toBe(false);
  expect(actions.capability({ kind: "preview.setSkinScatter", enabled: "yes" as never })).toEqual({ available: false, reason: "Choose on or off." });
  expect(ACTION_DESCRIPTORS["preview.setHairLook"].payload.value).toMatchObject({ min: 0, max: 1 });
  for (const kind of ["preview.setSkinScatter", "preview.setFaceShadows", "preview.setHairLook"] as const)
    expect(ACTION_DESCRIPTORS[kind]).toMatchObject({ scope: ["viewport"], effect: "workspace", undo: "none" });
});

test("Rendering options persist with the workspace, per view, and restore to the device", () => {
  const workspace = freshWorkspace();
  Object.assign(workspace.preview, { skinScatter: false, faceShadows: false, hairLook: 0.4 });
  const parsed = parseWorkspace(storedWorkspace(workspace), STUDIO_DOCUMENTS);
  expect(parsed.preview).toMatchObject({ skinScatter: false, faceShadows: false, hairLook: 0.4 });
  // Damaged values are dropped (the defaults apply); a workspace from before keeps no fields.
  const damaged = parseWorkspace({ ...storedWorkspace(workspace), preview: { ...workspace.preview, skinScatter: "no", hairLook: 3 } }, STUDIO_DOCUMENTS);
  expect(damaged.preview.skinScatter).toBeUndefined();
  expect(damaged.preview.hairLook).toBeUndefined();
  const earlier = parseWorkspace(storedWorkspace(freshWorkspace()), STUDIO_DOCUMENTS);
  expect(["skinScatter", "faceShadows", "hairLook"].filter(key => key in earlier.preview)).toEqual([]);
  // The main view's display node mirrors them; a stored node refuses a look out of range.
  const graph = createStudioViewGraph(parsed.preview);
  expect(previewMirror(graph)).toMatchObject({ skinScatter: false, faceShadows: false, hairLook: 0.4 });
  const data = graph.data();
  expect(parseViewGraph({ ...data, display: data.display.map(node => ({ ...node, hairLook: 2 })) }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
  // Restoring applies each one to the device.
  const { port: p, calls } = port();
  createTrustedPreviewServices(parsed, { preview: p, savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 } as never) },
    motion: { idle: undefined, available: false, setIdle: () => {}, setIdlePaused: () => {}, setIdleContributions: () => {}, setBlink: () => {}, animateBlink: () => {} } as never });
  expect(calls).toEqual(["scatter:false", "shadows:false", "hair:0.4"]);
});

test("Face shadows off draws every light of the setup unshadowed, and on again restores the setup's own choices", () => {
  const scene = new THREE.Scene();
  const renderer = { render: () => {}, setRenderTarget: () => {}, getRenderTarget: () => null,
    shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8) } as unknown as THREE.WebGLRenderer;
  const stage = createLightingSetupStage({ scene, renderer, loadLut: () => new Promise(() => {}),
    createEnvironment: () => ({ mode: "pmrem", lights: [], restore: () => {}, dispose: () => {} }) });
  const casting = () => stage.rig.objects.filter(light => light.castShadow).length;
  const before = casting();
  expect(before).toBeGreaterThan(0);
  stage.setShadowsEnabled(false);
  expect(casting()).toBe(0);
  // The setup itself is unchanged: it still asks for its shadows.
  expect(stage.shown().lights.filter(light => light.shadows).length).toBe(before);
  stage.setShadowsEnabled(true);
  expect(casting()).toBe(before);
  stage.dispose();
});

test("the Rendering group's words: the scatter's help says what it does, and the Hair look names its ends", () => {
  expect(RENDERING_HELP.scatter).toContain("shadow edges soften and turn warm");
  expect(RENDERING_HELP.scatter).toContain("lit skin stays neutral");
  expect([hairLookText(0), hairLookText(40), hairLookText(100)]).toEqual(["Crisp", "40 %", "Game-like"]);
});
