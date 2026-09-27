import { expect, test } from "bun:test";
import * as THREE from "three";
import { creatorShadowCasters, DEFAULT_CREATOR_LIGHTING, readCreatorLighting, storedCreatorLighting } from "../src/creator-lighting";
import { createLightingSetupStage } from "../src/lighting-setup-stage";
import { studioStageSetup, type LightingSource } from "../src/lighting-setups";
import { DEFAULT_STUDIO_STAGE } from "../src/studio-lighting";
import type { StudioEnvironment } from "../src/studio-environment";
import { PreviewActions, type LightingStatus, type PreviewPort } from "../src/preview-actions";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { parseWorkspace } from "../src/workspace-state";
import { storedWorkspace } from "./fixtures/looks";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";

const GAME: LightingSource = { kind: "game", calibration: DEFAULT_CREATOR_LIGHTING };
const SOFT: LightingSource = { kind: "setup", setup: studioStageSetup(DEFAULT_STUDIO_STAGE) };
/** A stand-in room: the prefiltered texture it would set, or (probe) the light probe it would add. */
const room = (mode: "pmrem" | "probe" = "pmrem", texture = new THREE.Texture()) => (_renderer: THREE.WebGLRenderer, scene: THREE.Scene): StudioEnvironment => {
  const probe = new THREE.LightProbe();
  if (mode === "pmrem") scene.environment = texture; else scene.add(probe);
  return { mode, lights: mode === "probe" ? [probe] : [], restore: () => {}, dispose: () => {} };
};

function port(options: { creator?: boolean } = {}) {
  const calls: string[] = [], listeners = new Set<() => void>(), sources: LightingSource[] = [];
  let camera = { position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 };
  let status: LightingStatus = { preset: "studio", sex: "female", defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure, lut: { phase: "idle", source: null } };
  const base: PreviewPort = {
    cameraState: () => structuredClone(camera), front: () => false, setFov: () => false, endFovGesture: () => {},
    restoreCamera: value => { camera = structuredClone(value); calls.push(`camera:${value.fov}`); },
    setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {},
    setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
  };
  const creator: Partial<PreviewPort> = options.creator === false ? {} : {
    setLighting: source => {
      sources.push(structuredClone(source));
      const preset = source.kind === "game" || source.setup.display === "game" ? "creator" : "studio";
      calls.push(source.kind === "game" ? `creator:${source.calibration.intensity}/${source.calibration.cone}/${source.calibration.exposure}` : `setup:${preset}`);
      status = { ...status, preset };
    },
    creatorCamera: page => ({ position: [0, 1.62, page === "face" ? -1.2 : -2], target: [0, 1.62, 0], fov: 15 }),
    lightingStatus: () => status,
    onLightingStatus: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { port: { ...base, ...creator } as PreviewPort, calls, listeners, sources,
    setStatus(next: LightingStatus) { status = next; for (const listener of listeners) listener(); } };
}

test("Character creator is a setup like the others: reversible, the game rig to the device, its exposure the game's k", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  expect(actions.snapshot().lightingPreset).toBe("studio");
  expect(actions.snapshot().creatorLighting).toEqual(DEFAULT_CREATOR_LIGHTING);
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "creator" });
  expect(actions.snapshot().lightingPreset).toBe("creator");
  // Its exposure is the game display's k: the range follows, and a change forks it (the built-in's name never describes edited values).
  expect(actions.capability({ kind: "preview.setExposure", value: 15 }).available).toBe(true);
  expect(actions.capability({ kind: "preview.setExposure", value: 30 }).reason).toBe("Exposure must be between 0.01 and 20.");
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "soft" });
  expect(actions.capability({ kind: "preview.setExposure", value: 15 }).reason).toBe("Exposure must be between 0.125 and 8.");
  expect(calls).toEqual([`creator:isotropic/full/${DEFAULT_CREATOR_LIGHTING.exposure}`, "setup:studio"]);
});

test("creator diagnostics validate their switches and exposure, and the camera preset frames the creator page", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "creator" });
  calls.length = 0;
  expect(actions.capability({ kind: "preview.setCreatorLighting", key: "cone", value: "quarter" as never }).available).toBe(false);
  expect(actions.capability({ kind: "preview.setCreatorLighting", key: "exposure", value: 0 }).reason).toContain("between");
  expect(actions.capability({ kind: "preview.setLightingPreset", preset: "sunset" as never }).available).toBe(false);
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "intensity", value: "cone" });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "cone", value: "half" });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "exposure", value: 0.8 });
  expect(actions.snapshot().creatorLighting).toEqual({ intensity: "cone", cone: "half", exposure: 0.8, shadows: true });
  actions.dispatch({ kind: "camera.creatorFraming", page: "hair" });
  expect(actions.snapshot().camera).toEqual({ position: [0, 1.62, -2], target: [0, 1.62, 0], fov: 15 });
  expect(calls).toEqual([`creator:cone/full/${DEFAULT_CREATOR_LIGHTING.exposure}`, "creator:cone/half/" + DEFAULT_CREATOR_LIGHTING.exposure,
    "creator:cone/half/0.8", "camera:15"]);
});

test("Restore defaults puts every creator calibration control back, and says when there is nothing to restore", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "creator" });
  expect(actions.capability({ kind: "preview.resetCreatorLighting" })).toEqual({ available: false, reason: "The calibration is already at its defaults." });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "intensity", value: "cone" });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "cone", value: "half" });
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "exposure", value: 0.8 });
  actions.dispatch({ kind: "preview.setCreatorShadows", enabled: false });
  expect(actions.snapshot().creatorLighting.shadows).toBe(false);
  expect(actions.capability({ kind: "preview.setCreatorShadows", enabled: "yes" as never }).reason).toBe("Choose on or off.");
  expect(actions.capability({ kind: "preview.resetCreatorLighting" }).available).toBe(true);
  actions.dispatch({ kind: "preview.resetCreatorLighting" });
  expect(actions.snapshot().creatorLighting).toEqual({ ...DEFAULT_CREATOR_LIGHTING });
  expect(calls.at(-1)).toBe(`creator:isotropic/full/${DEFAULT_CREATOR_LIGHTING.exposure}`);
  expect(actions.capability({ kind: "preview.resetCreatorLighting" }).available).toBe(false);
  const bare = new PreviewActions(freshWorkspace().preview, port({ creator: false }).port);
  expect(bare.capability({ kind: "preview.resetCreatorLighting" }).available).toBe(false);
});

test("a preview without the lighting stage explains why, and the LUT's arrival notifies readers", () => {
  const bare = new PreviewActions(freshWorkspace().preview, port({ creator: false }).port);
  expect(bare.capability({ kind: "preview.selectLightingSetup", setup: "creator" }).reason).toBe("Lighting controls are unavailable in this preview.");
  expect(bare.capability({ kind: "preview.setLightingPreset", preset: "studio" }).available).toBe(false);
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
  expect(app.dispatch({ kind: "preview.setExposure", value: 1 })).toMatchObject({ ok: true });
  expect(app.previewState().lightingSetups?.shown).toMatchObject({ label: "Custom (from Character creator)", exposure: 1 });
});

test("the workspace keeps the preset and diagnostics, and restore applies them", () => {
  const workspace = freshWorkspace();
  workspace.preview.lightingPreset = "creator";
  workspace.preview.creatorLighting = { intensity: "cone", cone: "full", exposure: 1.5, shadows: false };
  const parsed = parseWorkspace(storedWorkspace(workspace), STUDIO_DOCUMENTS);
  expect(parsed.preview.lightingPreset).toBe("creator");
  expect(parsed.preview.creatorLighting).toEqual({ intensity: "cone", cone: "full", exposure: 1.5, shadows: false });
  // Options saved before the shadow switch existed read with shadows on.
  const earlier = parseWorkspace({ ...storedWorkspace(workspace), preview: { ...workspace.preview,
    creatorLighting: { intensity: "cone", cone: "full", exposure: 1.5 } } }, STUDIO_DOCUMENTS);
  expect(earlier.preview.creatorLighting).toEqual({ intensity: "cone", cone: "full", exposure: 1.5, shadows: true });
  const damaged = parseWorkspace({ ...storedWorkspace(workspace), preview: { ...workspace.preview, lightingPreset: "disco",
    creatorLighting: { intensity: "cone", cone: "full", exposure: -1 } } }, STUDIO_DOCUMENTS);
  expect(damaged.preview.lightingPreset).toBe("studio");
  expect(damaged.preview.creatorLighting).toEqual(DEFAULT_CREATOR_LIGHTING);
  const { port: p, calls } = port();
  createTrustedPreviewServices(parsed, { preview: p, savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 } as never) },
    motion: { idle: undefined, available: false, setIdle: () => {}, setIdlePaused: () => {}, setIdleContributions: () => {}, setBlink: () => {}, animateBlink: () => {} } as never });
  expect(calls).toEqual(["creator:cone/full/1.5"]);
});

test("the Three stage shows a setup's lights, room, backdrop and display, and the creator rig for the body shown", async () => {
  const scene = new THREE.Scene(), texture = new THREE.Texture(), background = new THREE.Texture();
  scene.background = background;
  const renders: string[] = [];
  const renderer = { render: (_s: THREE.Scene, c: THREE.Camera) => renders.push(c.type), setRenderTarget: () => {}, getRenderTarget: () => null,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8), toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  let loads = 0, resolveLut!: () => void;
  const stage = createLightingSetupStage({ scene, renderer, createEnvironment: room("pmrem", texture),
    loadLut: () => { loads++; return new Promise(resolve => { resolveLut = () => resolve({ lut: null, source: { kind: "neutral", depotPath: null, archive: null,
      group: null, provider: null, alternatives: [], rule: null, size: null, note: "neutral", skipped: [] } }); }); } });
  const lights = () => stage.rig.group.children.filter(child => (child as THREE.Light).isLight) as (THREE.DirectionalLight | THREE.SpotLight)[];
  // Soft studio by default: key, fill and rim, the room, the stage backdrop, ACES at 1.2.
  expect(lights().map(light => light.name)).toEqual(["xfs-light-key", "xfs-light-fill", "xfs-light-rim"]);
  expect([scene.environment, scene.background, scene.environmentIntensity, renderer.toneMappingExposure]).toEqual([texture, background, 1, 1.2]);
  expect(stage.status().preset).toBe("studio");
  let changes = 0; stage.subscribe(() => changes++);
  stage.setSource(GAME);
  const spots = () => lights().filter(light => light instanceof THREE.SpotLight);
  expect(spots()).toHaveLength(15);
  expect(lights()).toHaveLength(15);
  expect(scene.environment).toBeNull();
  expect((scene.background as unknown as THREE.Color).getHex()).toBe(0);
  expect(stage.status()).toMatchObject({ preset: "creator", lut: { phase: "loading" } });
  // The flagged lights cast head-scoped shadow maps that follow the preview quality; the calibration's switch turns them off.
  const casting = () => spots().filter(light => light.castShadow).map(light => light.name.replace("xfs-light-", ""));
  expect(casting().sort()).toEqual(creatorShadowCasters("female", DEFAULT_CREATOR_LIGHTING).sort());
  expect(spots().find(light => light.castShadow)!.shadow.mapSize.x).toBe(1024);
  stage.setShadowQuality(4096);
  expect(spots().find(light => light.castShadow)!.shadow.mapSize.x).toBe(2048);
  stage.setSource({ kind: "game", calibration: { ...DEFAULT_CREATOR_LIGHTING, shadows: false } });
  expect(casting()).toEqual([]);
  stage.setSource(GAME);
  expect(casting()).toHaveLength(6);
  // Solo (developer evidence) shows one light, null all of them again.
  stage.solo("Main_Face");
  expect(spots().filter(light => light.visible).map(light => light.name)).toEqual(["xfs-light-Main_Face"]);
  stage.solo(null);
  expect(spots().every(light => light.visible)).toBe(true);
  const camera = new THREE.PerspectiveCamera();
  stage.render(camera);
  expect(renders).toEqual(["PerspectiveCamera", "OrthographicCamera"]); // scene into the linear target, then the display pass
  resolveLut(); await Promise.resolve(); await Promise.resolve();
  expect(stage.status().lut.phase).toBe("ready");
  stage.setBodySex("male");
  expect(spots()).toHaveLength(14);
  expect(stage.shown().focus).toEqual([0, 1.67, 0]);
  stage.setSource(SOFT); stage.setSource(GAME); stage.setSource(SOFT);
  expect(loads).toBe(2); // each activation of the game display asks the host again (PREV-40)
  expect([scene.environment, scene.background]).toEqual([texture, background]);
  expect(lights().map(light => light.name)).toEqual(["xfs-light-key", "xfs-light-fill", "xfs-light-rim"]);
  renders.length = 0; stage.render(camera);
  expect(renders).toEqual(["PerspectiveCamera"]);
  expect(changes).toBeGreaterThanOrEqual(5);
  expect(stage.camera("face")).toEqual({ position: [0, 1.67, -1.2], target: [0, 1.67, 0], fov: 15 });
  // A setup with no room light has no environment at all; with the light probe instead, the probe follows the strength.
  stage.setSource({ kind: "setup", setup: { ...studioStageSetup(DEFAULT_STUDIO_STAGE), environment: 0, backdrop: "black" } });
  expect([scene.environment, (scene.background as unknown as THREE.Color).getHex()]).toEqual([null, 0]);
  stage.dispose();
  const probed = new THREE.Scene();
  const probeStage = createLightingSetupStage({ scene: probed, renderer, createEnvironment: room("probe"), loadLut: () => new Promise(() => {}) });
  const probe = probeStage.environment.lights[0] as THREE.LightProbe;
  probeStage.setSource({ kind: "setup", setup: { ...studioStageSetup(DEFAULT_STUDIO_STAGE), environment: 0.3 } });
  expect([probe.visible, probe.intensity, probed.environmentIntensity]).toEqual([true, 0.3, 0.3]);
  probeStage.setSource(GAME);
  expect(probe.visible).toBe(false);
  probeStage.dispose();
});

test("the studio stage draws through the scene-linear target too, with the backdrop untoned beneath it (PREV-50)", () => {
  const scene = new THREE.Scene(), backdrop = new THREE.Texture();
  scene.background = backdrop;
  const calls: string[] = [];
  let target: THREE.WebGLRenderTarget | null = null, clear = { colour: 0x14181c, alpha: 1 };
  const renderer = {
    autoClear: true, toneMappingExposure: 1.2, extensions: { has: (name: string) => name === "EXT_color_buffer_float" }, capabilities: { maxSamples: 8 },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32), getRenderTarget: () => target, setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
    getClearColor: (c: THREE.Color) => c.setHex(clear.colour), getClearAlpha: () => clear.alpha,
    setClearColor: (c: THREE.ColorRepresentation, alpha = 1) => { clear = { colour: new THREE.Color(c).getHex(), alpha }; },
    render(s: THREE.Scene, c: THREE.Camera) {
      const into = target ? `target ${target.width}x${target.height}×${target.samples}` : "canvas";
      const drawn = s === scene ? "scene" : s.background ? "backdrop" : ((s.children[0] as THREE.Mesh).material as THREE.Material).name;
      calls.push(`${drawn} → ${into}${renderer.autoClear ? "" : " (over)"}${s === scene ? ` background=${s.background === null} clear=${clear.alpha}` : ""}`);
      if (s !== scene && s.background) expect(s.background).toBe(backdrop);
      expect(c).toBeDefined();
    },
  } as unknown as THREE.WebGLRenderer;
  const stage = createLightingSetupStage({ scene, renderer, createEnvironment: room(), loadLut: () => new Promise(() => {}) });
  expect(stage.display.path).toBe("linear");
  stage.render(new THREE.PerspectiveCamera());
  expect(calls).toEqual([
    "scene → target 64x32×4 background=true clear=0", // scene-linear, transparent where nothing draws, no backdrop
    "xfs-display-coverage → target 64x32×4 (over)",   // coverage: alpha one wherever a surface wrote depth
    "backdrop → canvas",                             // Three's own background pass, untoned as before
    "xfs-studio-display → canvas (over)",            // tone mapping and sRGB at output, laid over the backdrop
  ]);
  // Nothing of the scene or renderer state is left changed.
  expect(scene.background).toBe(backdrop);
  expect(clear).toEqual({ colour: 0x14181c, alpha: 1 });
  expect(target).toBeNull();
  expect((renderer as unknown as { autoClear: boolean }).autoClear).toBe(true);
  expect(stage.display.info()).toEqual({ path: "linear", creatorTarget: "half-float", samples: 4, width: 64, height: 32 });
  stage.dispose();
});

test("without a renderable half-float buffer the creator preset renders into an 8-bit sRGB target, and the studio stage straight to the canvas (PREV-59)", () => {
  for (const extensions of [["EXT_color_buffer_half_float"], []]) {
    const scene = new THREE.Scene(), targets: (THREE.WebGLRenderTarget | null)[] = [];
    let target: THREE.WebGLRenderTarget | null = null;
    const renderer = {
      autoClear: true, extensions: { has: (name: string) => extensions.includes(name) }, capabilities: { maxSamples: 4 },
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(16, 16), getRenderTarget: () => target,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
      getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 1, setClearColor: () => {},
      render(s: THREE.Scene) { if (s === scene) targets.push(target); },
    } as unknown as THREE.WebGLRenderer;
    const stage = createLightingSetupStage({ scene, renderer, createEnvironment: room(), loadLut: () => new Promise(() => {}) });
    const camera = new THREE.PerspectiveCamera();
    stage.render(camera);
    stage.setSource(GAME);
    stage.render(camera);
    const [studio, creator] = targets;
    if (extensions.length) {
      // Either extension makes half float renderable (Three.js enables both): the linear path, as with EXT_color_buffer_float.
      expect(stage.display.info()).toMatchObject({ path: "linear", creatorTarget: "half-float" });
      expect(studio?.texture.type).toBe(THREE.HalfFloatType);
      expect(creator?.texture.type).toBe(THREE.HalfFloatType);
    } else {
      expect(stage.display.info()).toMatchObject({ path: "direct", creatorTarget: "srgb8" });
      expect(studio).toBeNull();
      expect(creator?.texture).toMatchObject({ type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
      expect(creator?.samples).toBe(4);
    }
    stage.dispose();
  }
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
  const stage = createLightingSetupStage({ scene, renderer, createEnvironment: room(), loadLut: async () => answers[loads++]! });
  const applied: unknown[] = [];
  const setLut = stage.display.setLut.bind(stage.display);
  stage.display.setLut = next => { applied.push(next); setLut(next); };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const reactivate = async () => { stage.setSource(SOFT); stage.setSource(GAME); await settle(); };
  stage.setSource(GAME); await settle();
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
  const stage = createLightingSetupStage({ scene, renderer, createEnvironment: room(), loadLut: async () => answers[loads++]! });
  const applied: unknown[] = [];
  const setLut = stage.display.setLut.bind(stage.display);
  stage.display.setLut = next => { applied.push(next); setLut(next); };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  stage.setSource(GAME); await settle();
  let notices = 0; stage.subscribe(() => notices++);
  stage.setSource(SOFT); stage.setSource(GAME);
  notices = 0; await settle();
  expect(applied).toHaveLength(2);
  expect(notices).toBe(1);
  stage.setSource(SOFT); stage.setSource(GAME);
  notices = 0; await settle();
  expect(applied).toHaveLength(2);
  expect(notices).toBe(0);
  stage.dispose();
});

test("the calibration is stored as the untouched token at its defaults, so an untouched workspace follows a refit", () => {
  expect(storedCreatorLighting(DEFAULT_CREATOR_LIGHTING)).toEqual({ intensity: "isotropic", cone: "full", exposure: 0.46 });
  expect(readCreatorLighting(storedCreatorLighting(DEFAULT_CREATOR_LIGHTING))).toEqual(DEFAULT_CREATOR_LIGHTING);
  const off = { ...DEFAULT_CREATOR_LIGHTING, shadows: false };
  expect(readCreatorLighting(storedCreatorLighting(off))).toEqual(off);
  const tuned = { ...DEFAULT_CREATOR_LIGHTING, exposure: 1.5 };
  expect(storedCreatorLighting(tuned)).toEqual({ intensity: "isotropic", cone: "full", exposure: 1.5 });
  expect(readCreatorLighting(storedCreatorLighting(tuned))).toEqual(tuned);
  const workspace = freshWorkspace();
  expect(parseWorkspace(storedWorkspace(workspace), STUDIO_DOCUMENTS).preview.creatorLighting).toEqual(DEFAULT_CREATOR_LIGHTING);
});
