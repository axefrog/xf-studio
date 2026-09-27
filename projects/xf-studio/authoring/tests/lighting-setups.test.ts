/**
 * Lighting setups (src/lighting-setups.ts; knowledge/creator-lighting.md §9): one flat list of complete definitions, built-ins as
 * read-only templates that fork on the first edit, the person's own setups (rename, duplicate, delete, reset), the light editor, the
 * View and lighting history, numeric parity between a built-in and its unedited fork, and the migration of workspaces saved before.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { creatorRigSpecs, DEFAULT_CREATOR_LIGHTING, type BodySex } from "../src/creator-lighting";
import { createLightListRig } from "../src/lighting-setup-stage";
import { BUILT_IN_SETUP_IDS, builtInSetup, colourHex, creatorSetup, hexToLinear, legacyStudioStage, lightingSource, lightPlacement,
  LIGHTING_LIMITS, migrateLegacyLighting, parseSetupLibrary, resolveLightingSource, studioStageSetup, type LightingSource,
  type SetupLibrary } from "../src/lighting-setups";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { PreviewActions, type LightingStatus, type PreviewPort } from "../src/preview-actions";
import { createStudioViewGraph, previewLights, storedViewGraph } from "../src/preview-view-graph";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { DEFAULT_KEY_ANGLE, DEFAULT_STUDIO_STAGE, STUDIO_LIGHT_COLOURS, STUDIO_SETUP_IDS, STUDIO_SETUPS } from "../src/studio-lighting";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { WorkspaceComposer } from "../src/workspace-composer";
import { parseWorkspace, serializeWorkspace, type WorkspaceState } from "../src/workspace-state";
import { freshWorkspace } from "./fixtures/eye-region";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Workspaces written by the build before setups (commit f1aa3bd), by its own serializer. */
type OldPreview = WorkspaceState["preview"] & { studioLights?: WorkspaceState["preview"]["studioLights"] };
const before = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures", "workspace-before-lighting-setups.json"), "utf8")) as {
  workspace: Record<string, unknown>; lighting: Record<"untouched" | "keyLight" | "adjusted" | "creatorOverAdjusted" | "secondView",
    { preview: OldPreview; views?: unknown }> };

function lightingPort(options: { sex?: BodySex; lighting?: boolean } = {}) {
  const sources: LightingSource[] = [], listeners = new Set<() => void>();
  let status: LightingStatus = { preset: "studio", sex: options.sex ?? "female", defaultExposure: DEFAULT_CREATOR_LIGHTING.exposure,
    lut: { phase: "idle", source: null } };
  const port: PreviewPort = {
    cameraState: () => ({ position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 }), front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: () => {}, setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {},
    setEyeOptics: () => {}, setHair: () => {}, setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
    ...(options.lighting === false ? {} : { setLighting: (source: LightingSource) => {
      sources.push(structuredClone(source));
      status = { ...status, preset: source.kind === "game" || source.setup.display === "game" ? "creator" : "studio" };
    } }),
    creatorCamera: page => ({ position: [0, 1.62, page === "face" ? -1.2 : -2], target: [0, 1.62, 0], fov: 15 }),
    lightingStatus: () => status,
    onLightingStatus: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { port, sources };
}
const setup = (overrides: Partial<WorkspaceState["preview"]> = {}) => {
  const workspace = freshWorkspace();
  Object.assign(workspace.preview, overrides);
  const views = createStudioViewGraph(workspace.preview), device = lightingPort();
  return { workspace, views, device, actions: new PreviewActions(workspace.preview, device.port, views) };
};
const libraryOf = (actions: PreviewActions): SetupLibrary => {
  const view = actions.lightingSetups();
  return { setup: view.active, setups: actions.views().state<SetupLibrary>(MAIN_VIEW, "lights").setups };
};

test("the studio built-ins are light lists that place, colour and weight the key, fill and rim exactly as the old rig did", () => {
  // Colours: a hex decodes to exactly the floats Three's own Color holds (the old rig's colours were THREE.Color(hex)).
  for (const hex of [STUDIO_LIGHT_COLOURS.key, STUDIO_LIGHT_COLOURS.fill, STUDIO_LIGHT_COLOURS.rim, 0x000000, 0xffffff, 0x0a0b0c, 0x808080]) {
    const three = new THREE.Color(hex);
    expect(hexToLinear(hex)).toEqual([three.r, three.g, three.b]);
    expect(colourHex(hexToLinear(hex))).toBe(`#${hex.toString(16).padStart(6, "0")}`);
  }
  const soft = studioStageSetup(DEFAULT_STUDIO_STAGE);
  expect(soft.lights.map(light => [light.id, light.type, light.shadows])).toEqual([["key", "directional", true], ["fill", "directional", false],
    ["rim", "directional", true]]);
  // The original key: 0.583 m out at 329°, 1.9 m up; the fill where it always was; the rim at zero strength.
  const a = DEFAULT_KEY_ANGLE * Math.PI / 180, r = Math.hypot(0.3, 0.5);
  const key = new THREE.Vector3(...soft.lights[0]!.position);
  expect(key.distanceTo(new THREE.Vector3(Math.sin(a) * r, 1.9, -Math.cos(a) * r))).toBeLessThan(1e-12);
  expect(soft.lights[1]!.position).toEqual([0.4, 1.65, -0.2]);
  expect(soft.lights.map(light => light.intensity)).toEqual([2.5, 1, 0]);
  expect(soft).toMatchObject({ environment: 1, backdrop: "studio", display: "aces", exposure: 1.2, focus: [0, 1.67, 0] });
  // Untinted setups keep each light's luminance as grey.
  const flat = studioStageSetup(STUDIO_SETUPS.flat), luminance = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  for (const [i, light] of flat.lights.entries()) {
    expect(light.colour[0]).toBe(light.colour[2]);
    expect(luminance(light.colour)).toBeCloseTo(luminance(soft.lights[i]!.colour), 12);
  }
  expect(studioStageSetup(STUDIO_SETUPS.rim).lights[2]!.intensity).toBe(2.5 * STUDIO_SETUPS.rim.lights.rim);
});

test("the Character creator built-in is the game rig resolved for the body shown, never a stored copy", () => {
  for (const sex of ["female", "male"] as const) {
    const specs = creatorRigSpecs(sex, DEFAULT_CREATOR_LIGHTING), built = creatorSetup(sex, DEFAULT_CREATOR_LIGHTING);
    expect(built.lights.map(light => light.id)).toEqual(specs.map(spec => spec.name));
    built.lights.forEach((light, i) => {
      const spec = specs[i]!;
      expect([light.position, light.target, light.colour, light.intensity, light.angle, light.penumbra, light.decay, light.distance, light.shadows])
        .toEqual([[...spec.position], [...spec.target], [...spec.colour], spec.intensity, spec.angle, spec.penumbra, spec.decay, spec.distance, spec.castShadow]);
    });
    expect(built).toMatchObject({ environment: 0, backdrop: "black", display: "game", exposure: DEFAULT_CREATOR_LIGHTING.exposure });
  }
  // The device gets the game rig to resolve itself (it knows the body); a studio built-in arrives complete.
  expect(lightingSource({ setup: "creator", setups: [] }, DEFAULT_CREATOR_LIGHTING)).toEqual({ kind: "game", calibration: DEFAULT_CREATOR_LIGHTING });
  expect(lightingSource({ setup: "key", setups: [] }, DEFAULT_CREATOR_LIGHTING)).toEqual({ kind: "setup", setup: studioStageSetup(STUDIO_SETUPS.key) });
  expect(creatorSetup("male", DEFAULT_CREATOR_LIGHTING).lights).toHaveLength(14);
});

test("one flat list: the six built-ins as templates, then the person's own; Soft studio shows by default", () => {
  const { actions, device } = setup();
  const view = actions.lightingSetups();
  expect(view.active).toBe("soft");
  expect(view.setups.map(entry => [entry.id, entry.label, entry.builtIn])).toEqual([["soft", "Soft studio", true], ["key", "Key light", true],
    ["flat", "Flat", true], ["rim", "Rim / dramatic", true], ["mirror", "Mirror", true], ["creator", "Character creator", true]]);
  expect(view.shown).toMatchObject({ id: "soft", builtIn: true, resettable: false, display: "aces", environment: 1, exposure: 1.2,
    exposureRange: { min: 0.125, max: 8 }, shadowCasters: 2 });
  expect(view.shown.lights.map(light => light.name)).toEqual(["Key", "Fill", "Rim"]);
  expect(view.shown.lights[0]).toMatchObject({ azimuth: expect.closeTo(329, 9), colour: "#fff2e9", intensity: 2.5 });
  // Choosing the creator is a setup like any other: the device gets the game rig, the node's kind becomes the game display.
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "creator" });
  expect(device.sources.at(-1)).toEqual({ kind: "game", calibration: DEFAULT_CREATOR_LIGHTING });
  expect(actions.snapshot().lightingPreset).toBe("creator");
  expect(actions.lightingSetups().shown).toMatchObject({ id: "creator", display: "game", backdrop: "black", environment: 0 });
  expect(actions.lightingSetups().shown.lights).toHaveLength(15);
  expect(actions.capability({ kind: "preview.selectLightingSetup", setup: "disco" })).toMatchObject({ available: false });
});

test("editing a built-in forks it into Custom (from <base>) at once; the built-in never changes and switching away loses nothing", () => {
  const { actions, device } = setup();
  actions.dispatch({ kind: "preview.setRoomLight", value: 0.4 });
  let view = actions.lightingSetups();
  expect(view.active).toBe("u1");
  expect(view.setups.at(-1)).toMatchObject({ id: "u1", label: "Custom (from Soft studio)", builtIn: false, base: "soft", baseLabel: "Soft studio" });
  expect(view.shown).toMatchObject({ label: "Custom (from Soft studio)", builtIn: false, environment: 0.4, resettable: true, baseLabel: "Soft studio" });
  expect(device.sources.at(-1)).toMatchObject({ kind: "setup", setup: { environment: 0.4 } });
  // A second edit changes the fork, not another copy.
  actions.dispatch({ kind: "preview.setExposure", value: 2 });
  expect(actions.lightingSetups().setups.filter(entry => !entry.builtIn)).toHaveLength(1);
  // Away and back: the built-in is untouched, the fork keeps its edits.
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "soft" });
  expect(actions.lightingSetups().shown).toMatchObject({ environment: 1, exposure: 1.2 });
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "u1" });
  expect(actions.lightingSetups().shown).toMatchObject({ environment: 0.4, exposure: 2 });
  // A change that changes nothing forks nothing and records nothing.
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "key" });
  const steps = actions.views().history().depth;
  actions.dispatch({ kind: "preview.setBackdrop", backdrop: "studio" });
  expect(actions.lightingSetups().active).toBe("key");
  expect(actions.views().history().depth).toBe(steps);
  // Editing the creator forks the game rig resolved for the body shown, exactly.
  actions.dispatch({ kind: "preview.selectLightingSetup", setup: "creator" });
  actions.dispatch({ kind: "preview.setLightColour", light: "Main_Face", colour: "#ff8040" });
  view = actions.lightingSetups();
  expect(view.shown).toMatchObject({ label: "Custom (from Character creator)", display: "game", builtIn: false });
  expect(view.shown.lights.find(light => light.id === "Main_Face")!.colour).toBe("#ff8040");
  expect(actions.snapshot().lightingPreset).toBe("creator");
  const fork = actions.views().state<SetupLibrary>(MAIN_VIEW, "lights").setups.find(entry => entry.id === view.active)!;
  const built = creatorSetup("female", DEFAULT_CREATOR_LIGHTING);
  expect({ ...fork.setup, lights: fork.setup.lights.filter(light => light.id !== "Main_Face") })
    .toEqual({ ...built, lights: built.lights.filter(light => light.id !== "Main_Face") });
});

test("setup edits are View and lighting steps: a drag is one step, and Undo takes the fork away again", () => {
  const { actions, views } = setup();
  for (const value of [0.9, 0.8, 0.7]) actions.dispatch({ kind: "preview.setRoomLight", value });
  views.seal(); // the slider was released (view.endEdit)
  expect(views.history()).toMatchObject({ undo: "Room light", depth: 1 });
  expect(actions.lightingSetups().shown.environment).toBe(0.7);
  views.undo();
  expect(actions.lightingSetups()).toMatchObject({ active: "soft", setups: expect.any(Array) });
  expect(actions.lightingSetups().setups.some(entry => !entry.builtIn)).toBe(false);
  views.redo();
  expect(actions.lightingSetups().shown).toMatchObject({ id: "u1", environment: 0.7 });
  // A later drag of a different control is its own step.
  actions.dispatch({ kind: "preview.setExposure", value: 1.5 });
  expect(views.history()).toMatchObject({ undo: "Exposure", depth: 2 });
});

test("the person's own setups: new from any template, rename, delete (its base shows) and Reset to the base", () => {
  const { actions } = setup();
  actions.dispatch({ kind: "preview.createLightingSetup", from: "rim" });
  expect(actions.lightingSetups().shown).toMatchObject({ id: "u1", label: "Rim / dramatic copy", baseLabel: "Rim / dramatic", resettable: false });
  // An own setup is a template too; names stay distinct.
  actions.dispatch({ kind: "preview.createLightingSetup", from: "u1" });
  actions.dispatch({ kind: "preview.createLightingSetup", from: "u1" });
  expect(actions.lightingSetups().setups.filter(entry => !entry.builtIn).map(entry => [entry.id, entry.label, entry.base]))
    .toEqual([["u1", "Rim / dramatic copy", "rim"], ["u2", "Rim / dramatic copy copy", "rim"], ["u3", "Rim / dramatic copy copy 2", "rim"]]);
  actions.dispatch({ kind: "preview.renameLightingSetup", setup: "u2", name: "  Night market  " });
  expect(actions.lightingSetups().setups.find(entry => entry.id === "u2")!.label).toBe("Night market");
  expect(actions.capability({ kind: "preview.renameLightingSetup", setup: "u2", name: " " })).toMatchObject({ available: false });
  // Built-ins are read-only: renaming, deleting or resetting one says how to make it your own.
  for (const action of [{ kind: "preview.renameLightingSetup", setup: "soft", name: "Mine" }, { kind: "preview.deleteLightingSetup", setup: "creator" },
    { kind: "preview.resetLightingSetup", setup: "key" }] as const)
    expect(actions.check(action)).toMatchObject({ available: false, code: "incompatible_mode", reason: expect.stringContaining("Make your own setup from it") });
  // Reset: refused while it matches its base, then returns the base's values (the name stays).
  expect(actions.capability({ kind: "preview.resetLightingSetup", setup: "u3" }).reason).toBe("Rim / dramatic copy copy 2 already matches Rim / dramatic.");
  actions.dispatch({ kind: "preview.setLight", light: "key", key: "azimuth", value: 90 });
  expect(actions.lightingSetups().shown.resettable).toBe(true);
  actions.dispatch({ kind: "preview.resetLightingSetup", setup: "u3" });
  expect(actions.lightingSetups().shown).toMatchObject({ id: "u3", label: "Rim / dramatic copy copy 2", resettable: false });
  expect(actions.lightingSetups().shown.lights[0]!.azimuth).toBeCloseTo(STUDIO_SETUPS.rim.angle, 9);
  // Delete, no prompt: the shown one gives way to its base; Undo brings it back.
  actions.dispatch({ kind: "preview.deleteLightingSetup", setup: "u3" });
  expect(actions.lightingSetups().active).toBe("rim");
  actions.views().undo();
  expect(actions.lightingSetups().active).toBe("u3");
  expect(actions.views().history().redo).toBe("Delete Rim / dramatic copy copy 2");
});

test("the light editor: add, place about the head, recolour, shape the cone, shadows up to the budget, type, aim and remove", () => {
  const { actions } = setup();
  actions.dispatch({ kind: "preview.addLight", type: "spot" });
  let shown = actions.lightingSetups().shown;
  expect(shown.label).toBe("Custom (from Soft studio)");
  const added = shown.lights.at(-1)!;
  expect(added).toMatchObject({ id: "light-4", name: "Light 4", type: "spot", azimuth: expect.closeTo(45, 9), elevation: expect.closeTo(30, 9),
    distance: expect.closeTo(1, 9), colour: "#ffffff", shadows: false, cone: expect.closeTo(30, 9) });
  // Placement about the focus round-trips, and a move keeps what the light points at.
  actions.dispatch({ kind: "preview.setLight", light: "light-4", key: "azimuth", value: 200 });
  actions.dispatch({ kind: "preview.setLight", light: "light-4", key: "elevation", value: -10 });
  actions.dispatch({ kind: "preview.setLight", light: "light-4", key: "distance", value: 2.5 });
  shown = actions.lightingSetups().shown;
  expect(shown.lights.at(-1)).toMatchObject({ azimuth: expect.closeTo(200, 9), elevation: expect.closeTo(-10, 9), distance: expect.closeTo(2.5, 9) });
  const stored = () => actions.views().state<SetupLibrary>(MAIN_VIEW, "lights").setups[0]!.setup;
  expect(stored().lights.at(-1)!.target).toEqual([0, 1.67, 0]);
  actions.dispatch({ kind: "preview.setLightColour", light: "light-4", colour: "#3366ff" });
  actions.dispatch({ kind: "preview.setLight", light: "light-4", key: "cone", value: 12 });
  actions.dispatch({ kind: "preview.setLight", light: "light-4", key: "softness", value: 0.2 });
  expect(actions.lightingSetups().shown.lights.at(-1)).toMatchObject({ colour: "#3366ff", cone: expect.closeTo(12, 9), softness: 0.2 });
  expect(actions.capability({ kind: "preview.setLightColour", light: "light-4", colour: "blue" }).reason).toBe("Choose a colour as #rrggbb.");
  // A directional light has no cone.
  expect(actions.check({ kind: "preview.setLight", light: "key", key: "cone", value: 20 })).toMatchObject({ available: false, code: "incompatible_mode" });
  expect(actions.capability({ kind: "preview.setLight", light: "key", key: "elevation", value: 95 }).available).toBe(false);
  // Shadows: at most the budget at once.
  actions.dispatch({ kind: "preview.setLightShadows", light: "light-4", enabled: true });
  for (let i = 0; i < 3; i++) { actions.dispatch({ kind: "preview.addLight", type: "directional" }); }
  for (const id of ["light-5", "light-6", "light-7"]) actions.dispatch({ kind: "preview.setLightShadows", light: id, enabled: true });
  expect(actions.lightingSetups().shown.shadowCasters).toBe(LIGHTING_LIMITS.shadowCasters);
  actions.dispatch({ kind: "preview.addLight", type: "spot" });
  expect(actions.capability({ kind: "preview.setLightShadows", light: "light-8", enabled: true }).reason).toContain("At most 6 lights");
  // Type, aim, rename and remove.
  actions.dispatch({ kind: "preview.setLightType", light: "light-4", type: "directional" });
  actions.dispatch({ kind: "preview.setLightType", light: "light-4", type: "spot" });
  expect(actions.lightingSetups().shown.lights.find(light => light.id === "light-4")!.cone).toBeCloseTo(12, 9);
  actions.dispatch({ kind: "preview.aimLightAtHead", light: "light-4" });
  actions.dispatch({ kind: "preview.renameLight", light: "light-4", name: "Neon sign" });
  actions.dispatch({ kind: "preview.removeLight", light: "fill" });
  expect(actions.lightingSetups().shown.lights.map(light => light.name)).toEqual(["Key", "Rim", "Neon sign", "Light 5", "Light 6", "Light 7", "Light 8"]);
  expect(actions.capability({ kind: "preview.removeLight", light: "fill" })).toMatchObject({ available: false });
  // At most 16 lights.
  while (actions.lightingSetups().shown.lights.length < LIGHTING_LIMITS.lights) actions.dispatch({ kind: "preview.addLight", type: "directional" });
  expect(actions.capability({ kind: "preview.addLight", type: "spot" }).reason).toContain("at most 16 lights");
  // The display transform: exposure goes to the new display's default and its range follows.
  actions.dispatch({ kind: "preview.setDisplayTransform", display: "game" });
  expect(actions.lightingSetups().shown).toMatchObject({ display: "game", exposure: DEFAULT_CREATOR_LIGHTING.exposure, exposureRange: { min: 0.01, max: 20 } });
  expect(actions.snapshot().lightingPreset).toBe("creator");
  expect(actions.capability({ kind: "preview.setExposure", value: 15 }).available).toBe(true);
});

test("an unedited fork of every built-in draws exactly as the built-in: the same definition and the same Three lights", () => {
  const rigOf = (source: LightingSource, sex: BodySex) => {
    const rig = createLightListRig(), shown = resolveLightingSource(source, sex);
    rig.apply(shown.lights, shown.focus);
    const lights = rig.objects.map(light => {
      const camera = light.shadow.camera as THREE.OrthographicCamera & THREE.PerspectiveCamera;
      return { type: light.type, name: light.name, colour: light.color.toArray(), intensity: light.intensity, position: light.position.toArray(),
        target: light.target.position.toArray(), castShadow: light.castShadow, mapSize: light.shadow.mapSize.toArray(), bias: light.shadow.bias,
        normalBias: light.shadow.normalBias, radius: light.shadow.radius, camera: [camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far],
        spot: (light as THREE.SpotLight).isSpotLight ? [(light as THREE.SpotLight).angle, (light as THREE.SpotLight).penumbra, (light as THREE.SpotLight).decay,
          (light as THREE.SpotLight).distance] : null };
    });
    rig.dispose();
    return { shown, lights };
  };
  for (const sex of ["female", "male"] as const) for (const id of BUILT_IN_SETUP_IDS) {
    const { actions, device } = setup();
    (device.port.lightingStatus!() as LightingStatus).sex = sex;
    actions.dispatch({ kind: "preview.selectLightingSetup", setup: id });
    const builtInSource = lightingSource(libraryOf(actions), DEFAULT_CREATOR_LIGHTING);
    const sent = device.sources.length;
    actions.dispatch({ kind: "preview.createLightingSetup", from: id });
    const forkSource = lightingSource(libraryOf(actions), DEFAULT_CREATOR_LIGHTING);
    expect(forkSource.kind).toBe("setup");
    // A studio fork is the same source as its built-in, so the device isn't even asked to redraw; the creator's arrives resolved.
    expect(device.sources.length - sent).toBe(id === "creator" ? 1 : 0);
    const a = rigOf(builtInSource, sex), b = rigOf(forkSource, sex);
    expect(JSON.stringify(b.shown), `${id} ${sex}`).toBe(JSON.stringify(a.shown));
    expect(b.lights, `${id} ${sex}`).toEqual(a.lights);
    expect(a.shown).toEqual(builtInSetup(id, sex, DEFAULT_CREATOR_LIGHTING));
  }
  // The studio key and rim keep the old rig's shadow camera exactly (far = the key's distance + 2 × 0.45 m).
  const rig = createLightListRig(), soft = studioStageSetup(DEFAULT_STUDIO_STAGE);
  rig.apply(soft.lights, soft.focus);
  expect((rig.objects[0]!.shadow.camera as THREE.OrthographicCamera).far).toBe(Math.hypot(Math.hypot(0.3, 0.5), 1.9 - 1.67) + 0.9);
  expect(rig.objects.map(light => light.castShadow)).toEqual([true, false, true]);
  rig.dispose();
});

test("the light rig updates in place while the types hold, and replaces only a light whose type changed", () => {
  const rig = createLightListRig(), soft = studioStageSetup(DEFAULT_STUDIO_STAGE);
  rig.apply(soft.lights, soft.focus);
  const [key, fill] = rig.objects;
  rig.apply(soft.lights.map(light => ({ ...light, intensity: light.intensity * 2 })), soft.focus);
  expect(rig.objects[0]).toBe(key!);
  expect(rig.objects[0]!.intensity).toBe(5);
  rig.apply(soft.lights.map(light => light.id === "rim" ? { ...light, type: "spot" as const } : light), soft.focus);
  expect(rig.objects[1]).toBe(fill!);
  expect((rig.objects[2] as THREE.SpotLight).isSpotLight).toBe(true);
  expect(rig.group.children.filter(child => (child as THREE.Light).isLight).map(child => child.name)).toEqual(["xfs-light-key", "xfs-light-fill", "xfs-light-rim"]);
  rig.solo("fill");
  expect(rig.objects.map(light => light.visible)).toEqual([false, true, false]);
  rig.apply(soft.lights.slice(0, 1), soft.focus);
  expect(rig.group.children).toHaveLength(2);
  rig.setShadowMapSize(2048);
  expect(rig.objects[0]!.shadow.mapSize.x).toBe(2048);
  rig.dispose();
});

test("scripts keep working: setKeyAngle turns the shown setup's key (forking a built-in), setLightingPreset picks creator or Soft studio", () => {
  const { actions } = setup();
  actions.dispatch({ kind: "preview.setKeyAngle", degrees: 90 });
  expect(actions.lightingSetups().shown).toMatchObject({ label: "Custom (from Soft studio)" });
  expect(actions.lightingSetups().shown.lights[0]!.azimuth).toBeCloseTo(90, 9);
  expect(actions.snapshot().lightAngle).toBeCloseTo(90, 9);
  actions.dispatch({ kind: "preview.setLightingPreset", preset: "creator" });
  expect(actions.lightingSetups().active).toBe("creator");
  expect(actions.capability({ kind: "preview.setKeyAngle", degrees: 10 }).available).toBe(false);
  actions.dispatch({ kind: "preview.setLightingPreset", preset: "studio" });
  expect(actions.lightingSetups().active).toBe("soft");
  // Descriptors: workspace view state, never look Undo.
  for (const kind of ["preview.selectLightingSetup", "preview.createLightingSetup", "preview.setLight", "preview.addLight", "preview.resetLightingSetup"] as const)
    expect(ACTION_DESCRIPTORS[kind]).toMatchObject({ scope: ["viewport"], effect: "workspace", undo: "none" });
  expect(ACTION_DESCRIPTORS["preview.setLight"].variants!.elevation!.payload.value).toMatchObject({ min: -89, max: 89 });
  // A preview without the lighting stage says so.
  const bare = new PreviewActions(freshWorkspace().preview, lightingPort({ lighting: false }).port);
  expect(bare.check({ kind: "preview.selectLightingSetup", setup: "key" })).toMatchObject({ available: false, code: "unavailable" });
});

test("through the application: the read model carries the setups and a built-in's edit forks it", () => {
  const workspace = freshWorkspace();
  const { app } = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  app.attach({ preview: new PreviewActions(workspace.preview, lightingPort().port) });
  expect(app.previewState().lightingSetups?.active).toBe("soft");
  expect(app.dispatch({ kind: "preview.setLight", light: "rim", key: "intensity", value: 4 })).toMatchObject({ ok: true });
  expect(app.previewState().lightingSetups?.shown).toMatchObject({ label: "Custom (from Soft studio)" });
  expect(app.dispatch({ kind: "preview.deleteLightingSetup", setup: "soft" })).toMatchObject({ ok: false });
});

// ----- Workspaces -----

const oldWorkspace = (name: keyof typeof before.lighting) => {
  const { preview, views } = structuredClone(before.lighting[name]);
  return { ...structuredClone(before.workspace), preview, ...(views ? { views } : {}) };
};
const libraryAfterRead = (name: keyof typeof before.lighting) => {
  const workspace = parseWorkspace(oldWorkspace(name), STUDIO_DOCUMENTS);
  const views = createStudioViewGraph(workspace.preview, workspace.views);
  return { workspace, views, lights: views.state<ReturnType<typeof previewLights>>(MAIN_VIEW, "lights") };
};

test("workspaces saved before setups: a built-in's stage stays that built-in and keeps its bytes", () => {
  for (const [name, id] of [["untouched", "soft"], ["keyLight", "key"]] as const) {
    const { workspace, lights } = libraryAfterRead(name);
    expect(lights.setup).toBe(id);
    expect(lights.setups).toEqual([]);
    expect(workspace.preview.lightingSetups).toBeUndefined();
    expect(JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS))).toBe(JSON.stringify(oldWorkspace(name)));
  }
});

test("workspaces saved before setups: an adjusted stage becomes one own setup holding its exact rig, so nothing drawn changes", () => {
  const { workspace, lights } = libraryAfterRead("adjusted");
  const old = before.lighting.adjusted.preview;
  expect(lights.setup).toBe("u1");
  expect(lights.setups).toHaveLength(1);
  expect(lights.setups[0]).toMatchObject({ id: "u1", name: "Custom (from Key light)", base: "key" });
  expect(lights.setups[0]!.setup).toEqual(studioStageSetup({ lights: old.studioLights!, exposure: old.exposure, angle: old.lightAngle }));
  // The legacy fields a build before setups reads describe it exactly.
  expect({ exposure: lights.exposure, lightAngle: lights.lightAngle }).toEqual({ exposure: 1.6, lightAngle: 200 });
  expect(lights.studioLights).toMatchObject({ ...old.studioLights, elevation: expect.closeTo(35, 9) });
  // Restoring hands the device the same rig the old build drew.
  const device = lightingPort();
  createTrustedPreviewServices(workspace, { preview: device.port, savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 } as never) },
    motion: { idle: undefined, available: false, setIdle: () => {}, setIdlePaused: () => {}, setIdleContributions: () => {}, setBlink: () => {}, animateBlink: () => {} } as never });
  expect(device.sources[0]).toEqual({ kind: "setup", setup: lights.setups[0]!.setup });
});

test("workspaces saved before setups: the creator over an adjusted studio stage keeps both, and the calibration token is untouched", () => {
  const { workspace, lights, views } = libraryAfterRead("creatorOverAdjusted");
  expect(lights.setup).toBe("creator");
  expect(lights.setups.map(entry => [entry.name, entry.base])).toEqual([["Custom (from Soft studio)", "soft"]]);
  expect(lights.setups[0]!.setup.environment).toBe(0.4);
  expect(lights.creatorLighting).toEqual({ intensity: "isotropic", cone: "full", exposure: 0.8, shadows: false });
  expect(views.kind(MAIN_VIEW, "lights")).toBe("creator");
  // Saved again: the own setup is stored beside the legacy fields, which stay a readable creator preset for older builds.
  const composer = new WorkspaceComposer(workspace, { editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: workspace.history,
    fieldSelection: {} }) as never, uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined,
  quality: () => workspace.preview.textureSize, preview: () => new PreviewActions(workspace.preview, lightingPort().port, views).snapshot(), motion: () => undefined,
  views: () => storedViewGraph(views) } as never);
  composer.setPreviewReady();
  const stored = serializeWorkspace(composer.capture(), STUDIO_DOCUMENTS);
  expect(stored.preview).toMatchObject({ lightingPreset: "creator", creatorLighting: before.lighting.creatorOverAdjusted.preview.creatorLighting,
    lightingSetups: { setup: "creator", setups: [{ id: "u1", name: "Custom (from Soft studio)" }] } });
  // And read back exactly.
  const again = createStudioViewGraph(parseWorkspace(JSON.parse(JSON.stringify(stored)), STUDIO_DOCUMENTS).preview).state(MAIN_VIEW, "lights");
  expect(again).toEqual(lights);
});

test("workspaces saved before setups: a stored view graph's lights nodes migrate per node", () => {
  const { views } = libraryAfterRead("secondView");
  const graph = views.data();
  const v2 = graph.views.find(view => view.id !== MAIN_VIEW)!;
  expect(views.kind(v2.id, "lights")).toBe("creator");
  expect(views.state<SetupLibrary>(v2.id, "lights").setup).toBe("creator");
  // The main view's key at 200 % is no built-in: an own setup on that node only.
  expect(views.state<SetupLibrary>(MAIN_VIEW, "lights").setups.map(entry => entry.name)).toEqual(["Custom (from Soft studio)"]);
  expect(views.state<SetupLibrary>(v2.id, "lights").setups).toEqual([]);
  // A stored node carries the legacy fields too, so a build before setups still parses the graph.
  expect(graph.lights.every(node => typeof node.exposure === "number" && typeof node.lightAngle === "number" && typeof node.studioLights === "object")).toBe(true);
});

test("own setups round-trip through the workspace, and the field goes when the last one is deleted", () => {
  const { actions, workspace, views } = setup();
  actions.dispatch({ kind: "preview.createLightingSetup", from: "creator" });
  actions.dispatch({ kind: "preview.setLight", light: "Rim_Top", key: "intensity", value: 12 });
  const capture = () => {
    const composer = new WorkspaceComposer(workspace, { editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: workspace.history,
      fieldSelection: {} }) as never, uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined,
    quality: () => workspace.preview.textureSize, preview: () => actions.snapshot(), motion: () => undefined, views: () => storedViewGraph(views) } as never);
    composer.setPreviewReady();
    return JSON.parse(JSON.stringify(serializeWorkspace(composer.capture(), STUDIO_DOCUMENTS)));
  };
  const stored = capture();
  const read = parseWorkspace(stored, STUDIO_DOCUMENTS);
  expect(read.preview.lightingSetups).toEqual(libraryOf(actions));
  expect(parseSetupLibrary(stored.preview.lightingSetups)).toEqual(libraryOf(actions));
  // Damage anywhere drops the setups as a whole (the legacy fields still read).
  const damaged = structuredClone(stored);
  damaged.preview.lightingSetups.setups[0].setup.lights[0].colour = [2, 0, 0];
  expect(parseWorkspace(damaged, STUDIO_DOCUMENTS).preview.lightingSetups).toBeUndefined();
  actions.dispatch({ kind: "preview.deleteLightingSetup", setup: "u1" });
  expect("lightingSetups" in capture().preview).toBe(false);
});

test("the legacy mirror approximates an own studio setup for older builds, and is exact with none", () => {
  for (const id of STUDIO_SETUP_IDS) expect(legacyStudioStage({ setup: id, setups: [] })).toEqual({ lights: STUDIO_SETUPS[id].lights,
    exposure: STUDIO_SETUPS[id].exposure, angle: STUDIO_SETUPS[id].angle });
  expect(legacyStudioStage({ setup: "creator", setups: [] })).toEqual(DEFAULT_STUDIO_STAGE);
  const stage = { ...STUDIO_SETUPS.mirror, angle: 120 };
  const library = migrateLegacyLighting("studio", stage);
  expect(library.setups[0]!.base).toBe("mirror");
  const mirrored = legacyStudioStage(library);
  expect(mirrored.angle).toBeCloseTo(120, 9);
  expect(mirrored.lights).toMatchObject({ neutral: true, environment: 0.5, key: expect.closeTo(1.6, 12), elevation: expect.closeTo(20, 9) });
  expect(lightPlacement(library.setups[0]!.setup.lights[0]!, library.setups[0]!.setup.focus).azimuth).toBeCloseTo(120, 9);
});
