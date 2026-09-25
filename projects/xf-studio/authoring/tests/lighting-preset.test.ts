import { expect, test } from "bun:test";
import * as THREE from "three";
import { DEFAULT_CREATOR_LIGHTING } from "../src/creator-lighting";
import { createLightingPresetStage } from "../src/lighting-preset-stage";
import { PreviewActions, type LightingStatus, type PreviewPort } from "../src/preview-actions";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import { storedWorkspace } from "./fixtures/looks";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

function port(options: { creator?: boolean } = {}) {
  const calls: string[] = [], listeners = new Set<() => void>();
  let camera = { position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 };
  let status: LightingStatus = { preset: "studio", sex: "female", defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure, lut: { phase: "idle", source: null } };
  const base: PreviewPort = {
    cameraState: () => structuredClone(camera), front: () => false, setFov: () => false, endFovGesture: () => {},
    restoreCamera: value => { camera = structuredClone(value); calls.push(`camera:${value.fov}`); },
    setExposure: value => calls.push(`exposure:${value}`), setLightAngle: value => calls.push(`angle:${value}`),
    setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {},
    setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {}, setPiercingPreview: () => {},
  };
  const creator: Partial<PreviewPort> = options.creator === false ? {} : {
    setLightingPreset: preset => { calls.push(`preset:${preset}`); status = { ...status, preset }; },
    setCreatorLighting: value => calls.push(`creator:${value.intensity}/${value.cone}/${value.exposure}`),
    creatorCamera: page => ({ position: [0, 1.62, page === "face" ? -1.2 : -2], target: [0, 1.62, 0], fov: 15 }),
    lightingStatus: () => status,
    onLightingStatus: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { port: { ...base, ...creator } as PreviewPort, calls, listeners,
    setStatus(next: LightingStatus) { status = next; for (const listener of listeners) listener(); } };
}

test("the creator preset is a typed, reversible workspace preference; studio stays the default", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  expect(actions.snapshot().lightingPreset).toBe("studio");
  expect(actions.snapshot().creatorLighting).toEqual(DEFAULT_CREATOR_LIGHTING);
  actions.dispatch({ kind: "preview.setLightingPreset", preset: "creator" });
  expect(actions.snapshot().lightingPreset).toBe("creator");
  // The studio stage's exposure and key angle don't apply while the game's lights show.
  expect(actions.capability({ kind: "preview.setExposure", value: 1 })).toMatchObject({ available: false });
  expect(actions.capability({ kind: "preview.setKeyAngle", degrees: 10 }).reason).toContain("Studio lighting");
  actions.dispatch({ kind: "preview.setLightingPreset", preset: "studio" });
  expect(actions.capability({ kind: "preview.setExposure", value: 1 }).available).toBe(true);
  expect(calls).toEqual(["preset:creator", "preset:studio"]);
});

test("creator diagnostics validate their switches and exposure, and the camera preset frames the creator page", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  expect(actions.capability({ kind: "preview.setCreatorLighting", key: "cone", value: "quarter" as never }).available).toBe(false);
  expect(actions.capability({ kind: "preview.setCreatorLighting", key: "exposure", value: 0 }).reason).toContain("between");
  expect(actions.capability({ kind: "preview.setLightingPreset", preset: "sunset" as never }).available).toBe(false);
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "intensity", value: "cone" });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "cone", value: "half" });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "exposure", value: 0.8 });
  expect(actions.snapshot().creatorLighting).toEqual({ intensity: "cone", cone: "half", exposure: 0.8 });
  actions.dispatch({ kind: "camera.creatorFraming", page: "hair" });
  expect(actions.snapshot().camera).toEqual({ position: [0, 1.62, -2], target: [0, 1.62, 0], fov: 15 });
  expect(calls).toEqual([`creator:cone/full/${DEFAULT_CREATOR_LIGHTING.exposure}`, "creator:cone/half/" + DEFAULT_CREATOR_LIGHTING.exposure,
    "creator:cone/half/0.8", "camera:15"]);
});

test("a preview without the creator rig explains why, and the LUT's arrival notifies readers", () => {
  const bare = new PreviewActions(freshWorkspace().preview, port({ creator: false }).port);
  expect(bare.capability({ kind: "preview.setLightingPreset", preset: "creator" }).reason).toBe("Creator lighting is unavailable in this preview.");
  expect(bare.capability({ kind: "preview.setLightingPreset", preset: "studio" }).available).toBe(true);
  expect(bare.capability({ kind: "camera.creatorFraming", page: "face" }).available).toBe(false);
  expect(bare.lightingStatus()).toBeNull();
  const live = port(), actions = new PreviewActions(freshWorkspace().preview, live.port);
  let notified = 0; actions.subscribe(() => notified++);
  live.setStatus({ preset: "creator", sex: "female", defaultExposure: 0.46, lut: { phase: "ready", source: { kind: "neutral", depotPath: null,
    archive: null, group: null, provider: null, alternatives: [], rule: null, size: null, note: "neutral", skipped: [] } } });
  expect(notified).toBe(1);
  const status = actions.lightingStatus()!;
  expect(status.lut.phase).toBe("ready");
  (status as { preset: string }).preset = "edited";
  expect(actions.lightingStatus()!.preset).toBe("creator");
});

test("descriptors and application validation cover the new actions", () => {
  expect(ACTION_DESCRIPTORS["preview.setLightingPreset"].payload.preset).toMatchObject({ type: "enum", values: ["studio", "creator"] });
  expect(ACTION_DESCRIPTORS["camera.creatorFraming"].payload.page).toMatchObject({ type: "enum", values: ["face", "hair"] });
  expect(ACTION_DESCRIPTORS["preview.setCreatorLighting"].variants!.exposure!.payload.value).toMatchObject({ min: 0.01, max: 20 });
  for (const kind of ["preview.setLightingPreset", "preview.setCreatorLighting", "camera.creatorFraming"] as const)
    expect(ACTION_DESCRIPTORS[kind]).toMatchObject({ scope: ["viewport"], effect: "workspace", undo: "none" });
  const workspace = freshWorkspace();
  const { app } = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  app.attach({ preview: new PreviewActions(workspace.preview, port().port) });
  expect(app.capability({ kind: "preview.setCreatorLighting", key: "exposure", value: 50 })).toMatchObject({ available: false, reason: "Creator exposure must be between 0.01 and 20." });
  expect(app.dispatch({ kind: "preview.setLightingPreset", preset: "creator" })).toMatchObject({ ok: true });
  expect(app.previewState().preview?.lightingPreset).toBe("creator");
  expect(app.previewState().lighting?.preset).toBe("creator");
  expect(app.dispatch({ kind: "preview.setExposure", value: 1 })).toMatchObject({ ok: false });
});

test("the workspace keeps the preset and diagnostics, and restore applies them", () => {
  const workspace = freshWorkspace();
  workspace.preview.lightingPreset = "creator";
  workspace.preview.creatorLighting = { intensity: "cone", cone: "full", exposure: 1.5 };
  const parsed = parseWorkspace(storedWorkspace(workspace), STUDIO_DOCUMENTS);
  expect(parsed.preview.lightingPreset).toBe("creator");
  expect(parsed.preview.creatorLighting).toEqual({ intensity: "cone", cone: "full", exposure: 1.5 });
  const damaged = parseWorkspace({ ...storedWorkspace(workspace), preview: { ...workspace.preview, lightingPreset: "disco",
    creatorLighting: { intensity: "cone", cone: "full", exposure: -1 } } }, STUDIO_DOCUMENTS);
  expect(damaged.preview.lightingPreset).toBe("studio");
  expect(damaged.preview.creatorLighting).toEqual(DEFAULT_CREATOR_LIGHTING);
  const { port: p, calls } = port();
  createTrustedPreviewServices(parsed, { preview: p, savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 } as never) },
    motion: { idle: undefined, available: false, setIdle: () => {}, setIdlePaused: () => {}, setIdleContributions: () => {}, setBlink: () => {}, animateBlink: () => {} } as never });
  expect(calls).toContain("creator:cone/full/1.5");
  expect(calls).toContain("preset:creator");
});

test("the Three stage hides the studio stage for the creator rig and restores exactly what it found", async () => {
  const scene = new THREE.Scene(), environment = new THREE.Texture(), background = new THREE.Texture();
  scene.environment = environment; scene.background = background;
  const key = new THREE.DirectionalLight(), fill = new THREE.DirectionalLight();
  fill.visible = false; // A light the studio itself had hidden stays hidden afterwards.
  const renders: string[] = [];
  const renderer = { render: (_s: THREE.Scene, c: THREE.Camera) => renders.push(c.type), setRenderTarget: () => {}, getRenderTarget: () => null,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8) } as unknown as THREE.WebGLRenderer;
  let loads = 0, resolveLut!: () => void;
  const stage = createLightingPresetStage({ scene, renderer, studioLights: [key, fill],
    loadLut: () => { loads++; return new Promise(resolve => { resolveLut = () => resolve({ lut: null, source: { kind: "neutral", depotPath: null, archive: null,
      group: null, provider: null, alternatives: [], rule: null, size: null, note: "neutral", skipped: [] } }); }); } });
  const spots = () => stage.rig.group.children.filter(child => child instanceof THREE.SpotLight);
  expect(spots()).toHaveLength(15);
  expect(stage.rig.group.visible).toBe(false);
  let changes = 0; stage.subscribe(() => changes++);
  stage.setPreset("creator");
  expect(scene.environment).toBeNull();
  expect((scene.background as unknown as THREE.Color).getHex()).toBe(0);
  expect([key.visible, fill.visible, stage.rig.group.visible]).toEqual([false, false, true]);
  expect(stage.status().lut.phase).toBe("loading");
  const camera = new THREE.PerspectiveCamera();
  stage.render(camera);
  expect(renders).toEqual(["PerspectiveCamera", "OrthographicCamera"]); // scene into the linear target, then the display pass
  resolveLut(); await Promise.resolve(); await Promise.resolve();
  expect(stage.status().lut.phase).toBe("ready");
  stage.setBodySex("male");
  expect(spots()).toHaveLength(14);
  stage.setPreset("studio"); stage.setPreset("creator"); stage.setPreset("studio");
  expect(loads).toBe(2); // each activation asks the host again (PREV-40)
  expect(scene.environment).toBe(environment);
  expect(scene.background).toBe(background);
  expect([key.visible, fill.visible, stage.rig.group.visible]).toEqual([true, false, false]);
  renders.length = 0; stage.render(camera);
  expect(renders).toEqual(["PerspectiveCamera"]);
  expect(changes).toBeGreaterThanOrEqual(5);
  expect(stage.camera("face")).toEqual({ position: [0, 1.67, -1.2], target: [0, 1.67, 0], fov: 15 });
  stage.dispose();
});

test("the creator preset re-asks the host on activation and swaps the grade only when the host's cube changed (PREV-40)", async () => {
  const scene = new THREE.Scene();
  const renderer = { render: () => {}, setRenderTarget: () => {}, getRenderTarget: () => null,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8) } as unknown as THREE.WebGLRenderer;
  const source = (kind: "neutral" | "installed", note: string) => ({ kind, depotPath: null, archive: kind === "installed" ? "lut-a.archive" : null, group: null,
    provider: null, alternatives: [], rule: null, size: null, note, skipped: [] });
  const cube = (level: number) => ({ size: 2, data: new Float32Array(32).fill(level) }) as never;
  const answers = [
    { lut: null, file: null, source: source("neutral", "Colour grading: set up WolvenKit.") },
    { lut: cube(0.25), file: "a".repeat(64) + ".bin", source: source("installed", "Colour grading: your LUT mod.") },
    { lut: null, file: null, unreachable: true, source: source("neutral", "unreachable") },
    { lut: cube(0.25), file: "a".repeat(64) + ".bin", source: source("installed", "Colour grading: your LUT mod.") },
  ];
  let loads = 0;
  const stage = createLightingPresetStage({ scene, renderer, studioLights: [], loadLut: async () => answers[loads++]! });
  const applied: unknown[] = [];
  const setLut = stage.display.setLut.bind(stage.display);
  stage.display.setLut = next => { applied.push(next); setLut(next); };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const reactivate = async () => { stage.setPreset("studio"); stage.setPreset("creator"); await settle(); };
  stage.setPreset("creator"); await settle();
  expect(stage.status().lut.source?.kind).toBe("neutral");
  // WolvenKit became ready (a new installation fingerprint on the host): the next activation shows the LUT.
  await reactivate();
  expect(stage.status().lut.source?.note).toBe("Colour grading: your LUT mod.");
  expect(applied).toHaveLength(2);
  // A re-check that never reached the host keeps the grade; the same cube again is not re-applied.
  await reactivate();
  expect(stage.status().lut.source?.kind).toBe("installed");
  await reactivate();
  expect(applied).toHaveLength(2);
  expect(loads).toBe(4);
  stage.dispose();
});

test("a changed cube with the same source description still notifies, so the viewport draws the new grade (PREV-48)", async () => {
  const scene = new THREE.Scene();
  const renderer = { render: () => {}, setRenderTarget: () => {}, getRenderTarget: () => null,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8) } as unknown as THREE.WebGLRenderer;
  const source = { kind: "installed" as const, depotPath: null, archive: "lut-a.archive", group: null, provider: null, alternatives: [], rule: null,
    size: null, note: "Colour grading: your LUT mod.", skipped: [] };
  const cube = (level: number) => ({ size: 2, data: new Float32Array(32).fill(level) }) as never;
  const answers = [
    { lut: cube(0.25), file: "a".repeat(64) + ".bin", source },
    // The LUT mod's file was updated in place: same archive and note, a different decoded cube.
    { lut: cube(0.5), file: "b".repeat(64) + ".bin", source: structuredClone(source) },
    // The same cube again changes nothing and stays quiet.
    { lut: cube(0.5), file: "b".repeat(64) + ".bin", source: structuredClone(source) },
  ];
  let loads = 0;
  const stage = createLightingPresetStage({ scene, renderer, studioLights: [], loadLut: async () => answers[loads++]! });
  const applied: unknown[] = [];
  const setLut = stage.display.setLut.bind(stage.display);
  stage.display.setLut = next => { applied.push(next); setLut(next); };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  stage.setPreset("creator"); await settle();
  let notices = 0; stage.subscribe(() => notices++);
  stage.setPreset("studio"); stage.setPreset("creator");
  notices = 0; await settle();
  expect(applied).toHaveLength(2);
  expect(notices).toBe(1);
  stage.setPreset("studio"); stage.setPreset("creator");
  notices = 0; await settle();
  expect(applied).toHaveLength(2);
  expect(notices).toBe(0);
  stage.dispose();
});
