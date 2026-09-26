import { expect, test } from "bun:test";
import * as THREE from "three";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { PreviewActions, type PreviewPort } from "../src/preview-actions";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { createStudioLightRig } from "../src/studio-light-rig";
import { DEFAULT_KEY_ANGLE, DEFAULT_KEY_ELEVATION, DEFAULT_STUDIO_EXPOSURE, DEFAULT_STUDIO_LIGHTS, lightDirection, matchingStudioSetup,
  STUDIO_SETUP_IDS, STUDIO_SETUPS, validStudioLights, type StudioLights } from "../src/studio-lighting";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { WorkspaceComposer } from "../src/workspace-composer";
import { freshWorkspace, parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { storedWorkspace } from "./fixtures/looks";

function port(options: { rig?: boolean } = {}) {
  const calls: string[] = [];
  let preset: "studio" | "creator" = "studio";
  const p: PreviewPort = {
    cameraState: () => ({ position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 }), front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: () => {},
    setExposure: value => calls.push(`exposure:${value}`), setLightAngle: value => calls.push(`angle:${value}`),
    setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {},
    setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
    setLightingPreset: next => { preset = next; }, setCreatorLighting: () => {},
    lightingStatus: () => ({ preset, sex: "female", defaultExposure: 1, lut: { phase: "idle", source: null } }),
    ...(options.rig === false ? {} : { setStudioLights: (lights: StudioLights) => calls.push(`lights:${JSON.stringify(lights)}`) }),
  };
  return { port: p, calls };
}
const lightsCall = (lights: StudioLights) => `lights:${JSON.stringify(lights)}`;

test("the default rig is exactly the original studio stage: key at 329° and 0.23 m above the head, exposure 1.2, no rim", () => {
  expect(DEFAULT_STUDIO_LIGHTS).toEqual({ environment: 1, key: 1, elevation: DEFAULT_KEY_ELEVATION, fill: 1, rim: 0, neutral: false });
  expect(DEFAULT_KEY_ELEVATION).toBeCloseTo(21.53, 2);
  const a = DEFAULT_KEY_ANGLE * Math.PI / 180, r = Math.hypot(0.3, 0.5);
  const original = new THREE.Vector3(Math.sin(a) * r, 1.9 - 1.67, -Math.cos(a) * r).normalize();
  const now = new THREE.Vector3(...lightDirection(DEFAULT_KEY_ANGLE, DEFAULT_KEY_ELEVATION));
  expect(now.distanceTo(original)).toBeLessThan(1e-12);
  expect(freshWorkspace().preview).toMatchObject({ exposure: DEFAULT_STUDIO_EXPOSURE, lightAngle: DEFAULT_KEY_ANGLE, studioLights: DEFAULT_STUDIO_LIGHTS });
  expect(matchingStudioSetup({ lights: DEFAULT_STUDIO_LIGHTS, exposure: 1.2, angle: 329 })).toBe("soft");
  // Every setup is a valid rig and a distinct stage.
  for (const id of STUDIO_SETUP_IDS) {
    expect(validStudioLights(STUDIO_SETUPS[id].lights)).toBe(true);
    expect(matchingStudioSetup(STUDIO_SETUPS[id])).toBe(id);
  }
  // Setups other than Soft studio trade the room's ambient for direct light or neutral light.
  expect(STUDIO_SETUPS.key.lights.environment).toBeLessThan(0.5);
  expect(STUDIO_SETUPS.key.lights.key).toBeGreaterThan(2);
  expect(STUDIO_SETUPS.rim.lights.rim).toBeGreaterThan(1);
  expect(STUDIO_SETUPS.flat.lights.neutral).toBe(true);
});

test("each studio control is a validated workspace action; the creator preset and a preview without the rig refuse them", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  actions.dispatch({ kind: "preview.setStudioLight", key: "environment", value: 0.3 });
  actions.dispatch({ kind: "preview.setStudioLight", key: "elevation", value: 60 });
  actions.dispatch({ kind: "preview.setStudioNeutral", enabled: true });
  actions.dispatch({ kind: "preview.setExposure", value: 6 });
  const expected = { ...DEFAULT_STUDIO_LIGHTS, environment: 0.3, elevation: 60, neutral: true };
  expect(actions.snapshot().studioLights).toEqual(expected);
  expect(actions.snapshot().exposure).toBe(6);
  expect(calls.at(-2)).toBe(lightsCall(expected));
  expect(actions.studioSetups().active).toBeNull();
  // Ranges.
  expect(actions.capability({ kind: "preview.setExposure", value: 0.1 }).reason).toBe("Exposure must be between 0.125 and 8.");
  expect(actions.capability({ kind: "preview.setExposure", value: 8 }).available).toBe(true);
  expect(actions.capability({ kind: "preview.setStudioLight", key: "key", value: 5 }).reason).toBe("Key light strength must be between 0 and 4.");
  expect(actions.capability({ kind: "preview.setStudioLight", key: "elevation", value: -40 }).available).toBe(false);
  expect(actions.capability({ kind: "preview.setStudioLight", key: "neutral" as never, value: 1 }).available).toBe(false);
  expect(actions.capability({ kind: "preview.applyStudioSetup", setup: "disco" as never }).available).toBe(false);
  // The creator preset owns the lights while it shows.
  actions.dispatch({ kind: "preview.setLightingPreset", preset: "creator" });
  for (const action of [{ kind: "preview.setStudioLight", key: "rim", value: 1 }, { kind: "preview.setStudioNeutral", enabled: false },
    { kind: "preview.applyStudioSetup", setup: "key" }, { kind: "preview.resetStudioLighting" }] as const)
    // A mode refusal, not a bad value (UI-56).
    expect(actions.check(action)).toMatchObject({ available: false, code: "incompatible_mode", reason: expect.stringContaining("Switch to Studio lighting") });
  // Without the adjustable rig only exposure and angle remain.
  const bare = new PreviewActions(freshWorkspace().preview, port({ rig: false }).port);
  expect(bare.check({ kind: "preview.setStudioLight", key: "key", value: 1 })).toMatchObject({ available: false, code: "unavailable" });
  expect(bare.capability({ kind: "preview.applyStudioSetup", setup: "flat" }).available).toBe(false);
  expect(bare.capability({ kind: "preview.setExposure", value: 3 }).available).toBe(true);
  // Descriptors: workspace preferences, never Undo.
  for (const kind of ["preview.setStudioLight", "preview.setStudioNeutral", "preview.applyStudioSetup", "preview.resetStudioLighting"] as const)
    expect(ACTION_DESCRIPTORS[kind]).toMatchObject({ scope: ["viewport"], effect: "workspace", undo: "none" });
  expect(ACTION_DESCRIPTORS["preview.setStudioLight"].variants!.elevation!.payload.value).toMatchObject({ min: -30, max: 80 });
  expect(ACTION_DESCRIPTORS["preview.setExposure"].payload.value).toMatchObject({ min: 0.125, max: 8 });
});

test("a setup applies in one step and stays adjustable; Restore defaults returns to Soft studio and is refused there", () => {
  const { port: p, calls } = port();
  const actions = new PreviewActions(freshWorkspace().preview, p);
  expect(actions.capability({ kind: "preview.resetStudioLighting" })).toMatchObject({ available: false,
    reason: "The studio lighting is already at its defaults." });
  expect(actions.studioSetups()).toMatchObject({ active: "soft", setups: STUDIO_SETUP_IDS.map(id => ({ id, label: STUDIO_SETUPS[id].label })) });
  actions.dispatch({ kind: "preview.applyStudioSetup", setup: "rim" });
  const rim = STUDIO_SETUPS.rim;
  expect(actions.snapshot()).toMatchObject({ studioLights: rim.lights, exposure: rim.exposure, lightAngle: rim.angle });
  expect(calls.slice(-3)).toEqual([lightsCall(rim.lights), `exposure:${rim.exposure}`, `angle:${rim.angle}`]);
  expect(actions.studioSetups().active).toBe("rim");
  actions.dispatch({ kind: "preview.setKeyAngle", degrees: 200 });
  expect(actions.studioSetups().active).toBeNull();
  expect(actions.snapshot().studioLights).toEqual(rim.lights);
  // Exposure or angle alone also counts as a change from the defaults.
  const exposed = new PreviewActions(freshWorkspace().preview, port().port);
  exposed.dispatch({ kind: "preview.setExposure", value: 2 });
  expect(exposed.capability({ kind: "preview.resetStudioLighting" }).available).toBe(true);
  actions.dispatch({ kind: "preview.resetStudioLighting" });
  expect(actions.snapshot()).toMatchObject({ studioLights: DEFAULT_STUDIO_LIGHTS, exposure: 1.2, lightAngle: 329 });
  expect(actions.studioSetups().active).toBe("soft");
  expect(actions.capability({ kind: "preview.resetStudioLighting" }).available).toBe(false);
  // Through the application: the read model carries the setups; the dispatch reaches the port.
  const workspace = freshWorkspace();
  const { app } = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const other = port();
  app.attach({ preview: new PreviewActions(workspace.preview, other.port) });
  expect(app.previewState().studioSetups?.active).toBe("soft");
  expect(app.dispatch({ kind: "preview.applyStudioSetup", setup: "key" })).toMatchObject({ ok: true });
  expect(app.previewState().studioSetups?.active).toBe("key");
  expect(app.dispatch({ kind: "preview.resetStudioLighting" })).toMatchObject({ ok: true });
  expect(app.dispatch({ kind: "preview.resetStudioLighting" })).toMatchObject({ ok: false });
});

test("the workspace stores the rig only when adjusted, restores it, and older or damaged workspaces load the original rig", () => {
  // Untouched: the stored preview has exactly the keys it had before these controls.
  const fresh = freshWorkspace();
  const stored = serializeWorkspace(fresh, STUDIO_DOCUMENTS);
  expect("studioLights" in stored.preview).toBe(false);
  expect(Object.keys(stored.preview)).toEqual(Object.keys(fresh.preview).filter(key => key !== "studioLights"));
  // A workspace saved before the controls (no field) loads the default rig and writes the same bytes back.
  const older = JSON.parse(JSON.stringify(stored));
  const loaded = parseWorkspace(older, STUDIO_DOCUMENTS);
  expect(loaded.preview.studioLights).toEqual(DEFAULT_STUDIO_LIGHTS);
  expect(JSON.stringify(serializeWorkspace(loaded, STUDIO_DOCUMENTS))).toBe(JSON.stringify(older));
  // Adjusted: stored, restored exactly, with the wider exposure range.
  const adjusted = freshWorkspace();
  adjusted.preview.studioLights = { ...STUDIO_SETUPS.key.lights };
  adjusted.preview.exposure = 6.5;
  const round = parseWorkspace(storedWorkspace(adjusted), STUDIO_DOCUMENTS);
  expect(round.preview.studioLights).toEqual(STUDIO_SETUPS.key.lights);
  expect(round.preview.exposure).toBe(6.5);
  // Damaged or partial rigs fall back as a whole.
  for (const damaged of [{ ...STUDIO_SETUPS.key.lights, key: 9 }, { environment: 0.2 }, { ...STUDIO_SETUPS.key.lights, neutral: "yes" }, "bright"]) {
    const parsed = parseWorkspace({ ...storedWorkspace(adjusted), preview: { ...storedWorkspace(adjusted).preview, studioLights: damaged } }, STUDIO_DOCUMENTS);
    expect(parsed.preview.studioLights).toEqual(DEFAULT_STUDIO_LIGHTS);
  }
  expect(parseWorkspace({ ...storedWorkspace(adjusted), preview: { ...storedWorkspace(adjusted).preview, exposure: 12 } }, STUDIO_DOCUMENTS)
    .preview.exposure).toBe(1.2);
  // Restoring defaults after a load drops the stored rig again (the composer takes the preview's snapshot over the loaded state).
  const { port: p } = port();
  const actions = new PreviewActions(round.preview, p);
  actions.dispatch({ kind: "preview.resetStudioLighting" });
  const composer = new WorkspaceComposer(round, { editor: () => ({ recipe: round.recipe, active: round.active, selected: round.selected,
    fieldSelection: round.fieldSelection, history: round.history }) as never, uvView: () => round.uvView, savedV: () => undefined,
  collections: () => undefined, quality: () => round.preview.textureSize, preview: () => actions.snapshot(), motion: () => undefined });
  composer.setPreviewReady();
  expect("studioLights" in serializeWorkspace(composer.capture(), STUDIO_DOCUMENTS).preview).toBe(false);
});

test("restoring the workspace hands the rig to the scene before the preview's actions exist", () => {
  const workspace = freshWorkspace();
  workspace.preview.studioLights = { ...STUDIO_SETUPS.flat.lights };
  const { port: p, calls } = port();
  createTrustedPreviewServices(workspace, { preview: p, savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 } as never) },
    motion: { idle: undefined, available: false, setIdle: () => {}, setIdlePaused: () => {}, setIdleContributions: () => {}, setBlink: () => {}, animateBlink: () => {} } as never });
  expect(calls).toContain(lightsCall(STUDIO_SETUPS.flat.lights));
});

test("the Three rig: strengths, key direction, environment intensity and neutral tints; the light count never changes", () => {
  const scene = new THREE.Scene();
  // No half-float extension: the environment is the room's light probe, whose intensity follows the environment strength.
  const renderer = { extensions: { has: () => false } } as unknown as THREE.WebGLRenderer;
  const rig = createStudioLightRig(renderer, scene);
  const directional = () => scene.children.filter(child => (child as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight[];
  expect(directional().map(light => light.name)).toEqual(["xfs-studio-key", "xfs-studio-fill", "xfs-studio-rim"]);
  expect([rig.key.intensity, rig.fill.intensity, rig.rim.intensity]).toEqual([2.5, 1, 0]);
  // Where the earlier `setLightAngle(329)` put it (restore always applied the saved angle): 0.583 m out at 329°, 1.9 m up.
  const a = 329 * Math.PI / 180, r = Math.hypot(0.3, 0.5);
  expect(rig.key.position.distanceTo(new THREE.Vector3(Math.sin(a) * r, 1.9, -Math.cos(a) * r))).toBeLessThan(1e-12);
  expect(rig.fill.position.toArray()).toEqual([0.4, 1.65, -0.2]);
  expect(scene.environmentIntensity).toBe(1);
  expect(rig.key.color.getHex()).toBe(0xfff2e9);
  rig.setLights({ ...STUDIO_SETUPS.rim.lights, neutral: true });
  rig.setKeyAngle(90);
  expect(rig.key.intensity).toBeCloseTo(2.5 * STUDIO_SETUPS.rim.lights.key);
  expect(rig.rim.intensity).toBeCloseTo(2.5 * STUDIO_SETUPS.rim.lights.rim);
  const probe = rig.lights.find(light => (light as THREE.LightProbe).isLightProbe) as THREE.LightProbe;
  expect(probe.intensity).toBe(STUDIO_SETUPS.rim.lights.environment);
  expect(scene.environmentIntensity).toBe(STUDIO_SETUPS.rim.lights.environment);
  // Key at 90°: from V's right (+X), at the setup's elevation.
  const direction = rig.key.position.clone().sub(rig.key.target.position).normalize();
  expect(direction.x).toBeGreaterThan(0.8);
  expect(Math.asin(direction.y) * 180 / Math.PI).toBeCloseTo(STUDIO_SETUPS.rim.lights.elevation, 6);
  // Neutral keeps each light's luminance.
  const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  expect(rig.fill.color.r).toBeCloseTo(rig.fill.color.b, 9);
  expect(luminance(rig.fill.color)).toBeCloseTo(luminance(new THREE.Color(0xc6dafa)), 9);
  expect(directional()).toHaveLength(3);
  rig.dispose();
  expect(directional()).toHaveLength(0);
});

test("every studio control requests a frame and nothing else draws (render on demand)", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(import.meta.dir, "..", "src", "platform", "scene", "scene-host.ts"), "utf8") as string;
  const wrapped = [...source.slice(source.indexOf("...invalidating(api, [")).matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]!);
  for (const change of ["setExposure", "setLightAngle", "setStudioLights"]) expect(wrapped).toContain(change);
  // The evidence reader does not.
  expect(wrapped).not.toContain("studioLighting");
});
