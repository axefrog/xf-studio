import { expect, test } from "bun:test";
import * as THREE from "three";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { studioStageSetup, type LightingSource } from "../src/lighting-setups";
import { PreviewActions, type PreviewPort } from "../src/preview-actions";
import { DEFAULT_KEY_ANGLE, DEFAULT_KEY_ELEVATION, DEFAULT_STUDIO_EXPOSURE, DEFAULT_STUDIO_LIGHTS, lightDirection, matchingStudioSetup,
  STUDIO_SETUP_IDS, STUDIO_SETUPS, validStudioLights } from "../src/studio-lighting";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { WorkspaceComposer } from "../src/workspace-composer";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { storedWorkspace } from "./fixtures/looks";
import { freshWorkspace } from "./fixtures/eye-region";

/**
 * The studio stage's parametric rigs (studio-lighting.ts): the built-in studio setups' definitions and the legacy workspace fields
 * that store them. The setups themselves, forking and the light editor: tests/lighting-setups.test.ts.
 */
function port() {
  const sources: LightingSource[] = [];
  const p: PreviewPort = {
    cameraState: () => ({ position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 }), front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: () => {},
    setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {},
    setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
    setLighting: source => sources.push(structuredClone(source)),
    lightingStatus: () => ({ preset: "studio", sex: "female", defaultExposure: 1, lut: { phase: "idle", source: null } }),
  };
  return { port: p, sources };
}

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
  // Choosing Soft studio after a load drops the stored rig again (the composer takes the preview's snapshot over the loaded state).
  const { port: p } = port();
  const actions = new PreviewActions(round.preview, p);
  expect(actions.lightingSetups().shown.label).toBe("Custom (from Key light)");
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "soft" });
  const composer = new WorkspaceComposer(round, { editor: () => ({ recipe: round.recipe, active: round.active, selected: round.selected,
    fieldSelection: round.fieldSelection, history: round.history }) as never, uvView: () => round.uvView, savedV: () => undefined,
  collections: () => undefined, quality: () => round.preview.textureSize, preview: () => actions.snapshot(), motion: () => undefined });
  composer.setPreviewReady();
  expect("studioLights" in serializeWorkspace(composer.capture(), STUDIO_DOCUMENTS).preview).toBe(false);
});

test("restoring the workspace hands the rig to the scene before the preview's actions exist", () => {
  const workspace = freshWorkspace();
  workspace.preview.studioLights = { ...STUDIO_SETUPS.flat.lights };
  const { port: p, sources } = port();
  createTrustedPreviewServices(workspace, { preview: p, savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 } as never) },
    motion: { idle: undefined, available: false, setIdle: () => {}, setIdlePaused: () => {}, setIdleContributions: () => {}, setBlink: () => {}, animateBlink: () => {} } as never });
  // The stage's lights with the workspace's exposure and key angle (the flat rig at the default 1.2 and 329°): an own setup, drawn exactly.
  expect(sources).toEqual([{ kind: "setup", setup: studioStageSetup({ lights: STUDIO_SETUPS.flat.lights, exposure: DEFAULT_STUDIO_EXPOSURE, angle: DEFAULT_KEY_ANGLE }) }]);
});

test("a lighting change requests a frame and nothing else draws (render on demand)", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(import.meta.dir, "..", "src", "platform", "scene", "scene-host.ts"), "utf8") as string;
  const wrapped = [...source.slice(source.indexOf("...invalidating(api, [")).matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]!);
  expect(wrapped).toContain("setLighting");
  // The evidence reader does not.
  expect(wrapped).not.toContain("lightingEvidence");
});

test("the eye's own roughness: absent from an untouched workspace (bytes kept, the retired opt-in kept as read), stored once turned off", () => {
  const fresh = freshWorkspace();
  const stored = serializeWorkspace(fresh, STUDIO_DOCUMENTS);
  expect("eyeOwnRoughness" in stored.preview).toBe(false);
  const legacy = JSON.parse(JSON.stringify({ ...stored, preview: { ...stored.preview, eyeOptics: false } }));
  const loaded = parseWorkspace(legacy, STUDIO_DOCUMENTS);
  expect(loaded.preview.eyeOwnRoughness).toBeUndefined();
  expect(JSON.stringify(serializeWorkspace(loaded, STUDIO_DOCUMENTS))).toBe(JSON.stringify(legacy));
  const off = freshWorkspace();
  off.preview.eyeOwnRoughness = false;
  expect(parseWorkspace(storedWorkspace(off), STUDIO_DOCUMENTS).preview.eyeOwnRoughness).toBe(false);
  expect(parseWorkspace({ ...storedWorkspace(off), preview: { ...storedWorkspace(off).preview, eyeOwnRoughness: "no" } }, STUDIO_DOCUMENTS)
    .preview.eyeOwnRoughness).toBeUndefined();
});
