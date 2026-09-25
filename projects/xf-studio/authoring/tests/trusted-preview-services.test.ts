import { expect, test } from "bun:test";
import { createTrustedPreviewServices } from "../src/trusted-preview-services";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import type { PreviewPort } from "../src/preview-actions";
import type { MotionPort } from "../src/motion-actions";
import type { SavedV } from "../src/save-reader";
import { freshWorkspace } from "../src/workspace-state";
import { bodySexOf, SavedAppearanceActions } from "../src/saved-appearance-actions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("preview bootstrap restores saved V, scene, motion and camera in order without controls", () => {
  const calls: string[] = [], workspace = freshWorkspace();
  const saved: SavedV = { schema: "eye-artistry/saved-v-1", saveVersion: 1, gameVersion: 2310,
    presetVersion: 1, isMale: false, brainIsMale: false,
    groups: { head: [{ name: "character_customization", appearances: [], morphs: [
      { region: "eyes", target: "h091", censorFlag: 0, censorAction: 0 }] }], arms: [], body: [] },
    perspectives: [], tags: [], evidence: { nodeName: "appearance", nodeBytes: 1, bytesRead: 1,
      trailingBytes: 0, chunks: 1, decompressedBytes: 1 } };
  workspace.savedV = saved;
  workspace.preview.eyeShape = 4;
  workspace.preview.brows = true;
  workspace.preview.hair = true;
  workspace.preview.piercingStyle = "stud";
  workspace.preview.piercingDefinition = "missing";
  workspace.preview.idle = true;
  workspace.preview.idlePaused = true;
  workspace.preview.idleTime = 2.5;
  workspace.preview.idleBody = false;
  workspace.preview.camera = { position: [0, 0, 1], target: [0, 0, 0], fov: 42 };
  let camera = { position: [0, 0, 1], target: [0, 0, 0], fov: 30 };
  const preview: PreviewPort = {
    cameraState: () => camera, front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: next => { calls.push("camera"); camera = next; },
    setExposure: () => calls.push("exposure"), setLightAngle: () => calls.push("light"),
    setSurfaceControls: () => calls.push("surface"), setWire: () => calls.push("wire"),
    setNormals: () => calls.push("normals"), setEyeOptics: () => calls.push("optics"),
    setHair: () => calls.push("hair"), setEyeShape: index => calls.push(`eye:${index}`),
    setPiercings: () => calls.push("piercings"),
    setPiercingPreview: (style, definition) => calls.push(`piercing:${style}:${definition}`),
    setDetail: detail => calls.push(detail),
    piercingOptions: () => [{ id: "stud", label: "Stud", choices: [
      { index: 1, definition: "silver", label: "Silver" }] }],
    availability: target => target === "brows" ? "Unavailable" : undefined,
  };
  const idle = { enabled: false, time: 0, paused: false, bodyEnabled: true, faceEnabled: true,
    seek(time: number) { this.time = time; calls.push("seek"); } };
  const motion: MotionPort = { available: true, idle,
    setIdle: enabled => { idle.enabled = enabled; calls.push("idle"); },
    setIdlePaused: paused => { idle.paused = paused; calls.push("pause"); },
    setIdleContributions: (body, face) => {
      idle.bodyEnabled = body; idle.faceEnabled = face; calls.push("parts"); },
    setBlink: () => calls.push("blink"), animateBlink: () => calls.push("play") };
  const services = createTrustedPreviewServices(workspace, {
    savedAppearance: { apply: () => { calls.push("save"); return { applied: [], appearanceReferences: 0,
      matchedPiercing: false, eyeShape: 9 }; } },
    preview, motion,
  });
  expect(services.restoredSavedAppearance?.suggestedEyeShape).toBe(9);
  expect(calls.slice(0, 4)).toEqual(["save", "optics", "eye:4", "wire"]);
  const { preview: actions, motion: motionActions } = services.finish();
  expect(calls.indexOf("surface")).toBeLessThan(calls.indexOf("parts"));
  expect(calls.indexOf("parts")).toBeLessThan(calls.indexOf("idle"));
  expect(calls.indexOf("idle")).toBeLessThan(calls.indexOf("seek"));
  expect(calls.indexOf("pause")).toBeLessThan(calls.indexOf("camera"));
  expect(actions.snapshot()).toMatchObject({ brows: false, hair: true,
    eyeShape: 4, piercingStyle: "stud", piercingDefinition: "silver", camera: { fov: 42 } });
  expect(motionActions.snapshot()).toMatchObject({ idle: true, idlePaused: true, idleTime: 2.5 });
  // File import uses the same saved-appearance dispatch after decoding. Recording its
  // suggested selector must not apply the eye morph a second time.
  let core!: ReturnType<typeof createTrustedAuthoringCore>;
  core = createTrustedAuthoringCore(workspace, { resetStack: () => {},
    selectedCollection: () => "draft" });
  core.app.attach({ preview: actions, savedV: services.savedAppearance });
  const before = calls.filter(call => call.startsWith("eye:")).length;
  const imported = services.savedAppearance.dispatch({ kind: "savedV.restore", value: saved });
  core.app.recordAppliedSavedAppearance(imported);
  expect(calls.filter(call => call.startsWith("eye:")).length).toBe(before);
  expect(actions.snapshot().eyeShape).toBe(9);

  const withoutAssets = createTrustedPreviewServices(freshWorkspace(), {
    savedAppearance: { apply: () => { throw Error("No save was supplied."); } },
    preview: { ...preview, piercingOptions: () => [],
      availability: target => target === "hair" ? "Saved hair is unavailable." : undefined },
    motion,
  });
  const retained = withoutAssets.finish().preview.snapshot();
  expect(retained).toMatchObject({ hair: true, piercings: true });
});

const savedV = (isMale: boolean): SavedV => ({ schema: "eye-artistry/saved-v-1", saveVersion: 1, gameVersion: 2310,
  presetVersion: 1, isMale, brainIsMale: isMale,
  groups: { head: [{ name: "TPP", appearances: [], morphs: [] }], arms: [], body: [] },
  perspectives: [], tags: [], evidence: { nodeName: "appearance", nodeBytes: 1, bytesRead: 1, trailingBytes: 0, chunks: 1, decompressedBytes: 1 } });
const applied = { applied: [], appearanceReferences: 0, matchedPiercing: false };

test("the creator rig's body follows the applied save, derived by the saved-appearance service (CORE-25)", () => {
  const calls: string[] = [];
  const actions = new SavedAppearanceActions({ apply: saved => { calls.push(`apply:${saved.isMale}`); return applied; },
    setBodySex: sex => calls.push(`body:${sex}`) });
  actions.dispatch({ kind: "savedV.restore", value: savedV(false) });
  actions.dispatch({ kind: "savedV.restore", value: savedV(true) });
  expect(calls).toEqual(["apply:false", "body:female", "apply:true", "body:male"]);
  expect([bodySexOf(undefined), bodySexOf(savedV(false)), bodySexOf(savedV(true))]).toEqual(["female", "female", "male"]);
  // A save the preview refuses leaves the rig as it was.
  const refusing = new SavedAppearanceActions({ apply: () => { throw Error("Male head assets are still needed."); },
    setBodySex: sex => calls.push(`body:${sex}`) });
  expect(() => refusing.dispatch({ kind: "savedV.restore", value: savedV(true) })).toThrow("Male head");
  expect(calls.length).toBe(4);
  // The browser port only forwards the derived value to the lighting device; it decides nothing itself.
  const source = readFileSync(resolve(import.meta.dir, "..", "src", "browser-scene-preview-ports.ts"), "utf8");
  expect(source).toContain("setBodySex: sex => scene.lighting.setBodySex(sex)");
  expect(source).not.toContain("isMale");
});

test("restoring the preview never changes the caller's workspace (CORE-25)", () => {
  const workspace = freshWorkspace();
  workspace.preview.brows = true;
  workspace.preview.piercingStyle = "missing";
  workspace.preview.eyeShape = 99;
  workspace.preview.camera = { position: [0, 0, 1], target: [0, 0, 0], fov: 42 };
  const before = structuredClone(workspace);
  // Frozen all the way down: any write to the caller's objects, nested ones included, throws.
  const freeze = (value: unknown) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(workspace);
  const noop = () => {};
  const preview: PreviewPort = {
    cameraState: () => workspace.preview.camera!, front: () => false, setFov: () => false, endFovGesture: noop, restoreCamera: noop,
    setExposure: noop, setLightAngle: noop, setSurfaceControls: noop, setWire: noop, setNormals: noop, setEyeOptics: noop,
    setHair: noop, setEyeShape: noop, setPiercings: noop, setPiercingPreview: noop, setDetail: noop,
    piercingOptions: () => [], availability: target => target === "brows" ? "Unavailable" : undefined,
    eyeShapeOptions: () => ({ choices: [], eyesFollow: false, eyeSource: null }),
    setLightingPreset: noop, setCreatorLighting: noop,
  };
  const motion: MotionPort = { available: false, setIdle: noop, setIdlePaused: noop, setIdleContributions: noop, setBlink: noop, animateBlink: noop };
  const services = createTrustedPreviewServices(workspace, { savedAppearance: { apply: () => applied }, preview, motion });
  const { preview: actions } = services.finish();
  actions.dispatch({ kind: "preview.setCreatorLighting", key: "exposure", value: 1.5 });
  // The restored state applied its fallbacks (brows off, no piercing style, base eye shape) to its own copy only.
  expect(actions.snapshot()).toMatchObject({ brows: false, piercingStyle: "" });
  expect(workspace).toEqual(before);
});
