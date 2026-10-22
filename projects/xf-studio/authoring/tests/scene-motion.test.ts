/**
 * Profiles phase 4a-iii (experiment 043 §9): the motion settings (idle on or off, its phase, pause and contributions, the idle played, the
 * blink and the pose) live in the view graph's scene node. An existing workspace's motion is read from its legacy `preview` fields once and
 * then written only to the node; the legacy fields are written back as read, so an older build opens them as they were at the upgrade.
 * Motion records no View and lighting step, and an Undo of another scene setting leaves it as it is now. A new head of the same scene
 * applies the node's motion, with the phase its previous head left.
 */
import { describe, expect, test } from "bun:test";
import { MotionActions, type MotionPort } from "../src/animation/motion-actions";
import { DEFAULT_MOTION, previewMotion, sceneMotionOf, type SceneMotion } from "../src/animation/scene-motion";
import { graphMotionScene, createTrustedPreviewServices } from "../src/app/trusted-preview-services";
import { WorkspaceComposer } from "../src/app/workspace/workspace-composer";
import { parseWorkspace, serializeWorkspace, type WorkspaceState } from "../src/app/workspace/workspace-state";
import { ProfileSessionState } from "../src/app/profiles/profile-session-state";
import { sessionOfWorkspace, workspaceProfiles } from "../src/app/profiles/profiles-migration-data";
import { PROFILES_MIGRATION } from "../src/app/profiles/profile-session";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { createHistoryService, viewScope } from "../src/platform/core/history-service";
import type { ViewGraph } from "../src/platform/core/view-graph";
import { PreviewActions, type PreviewPort } from "../src/preview/preview-actions";
import { createStudioViewGraph, sessionViewGraph, type SceneState } from "../src/preview/preview-view-graph";
import type { IdleEntry } from "../src/animation/idle-catalogue";
import { freshWorkspace } from "./fixtures/eye-region";

const MODEL = STUDIO_DOCUMENTS;
const LOOK = { collection: "11111111-1111-4111-8111-111111111111", look: "22222222-2222-4222-8222-222222222222" };
const seeded = () => { let n = 0; return () => ((n++ * 7919) % 36) / 36; };
const sceneMotion = (graph: ViewGraph) => graph.state<SceneState>(MAIN_VIEW, "scene").motion;

const entry = (id: string): IdleEntry => ({ id, label: id, clip: `ui_${id}`, body: `cc-idle-body-${id}.glb`, duration: 10, screen: "creator", state: id, flags: [],
  face: null, puppet: "creator", evidence: "[resource] test" });
/** A device's idle and blink, recording what it is asked; `idles`: the preview idles prepared on it (none: the close-up alone). */
function motionPort(calls: string[] = [], idles?: readonly string[]): MotionPort & { idle: NonNullable<MotionPort["idle"]> } {
  const idle = { enabled: false, time: 0, paused: false, bodyEnabled: true, faceEnabled: true, seek(time: number) { this.time = time; calls.push(`seek:${time}`); } };
  return { available: true, blink: { available: true }, idle,
    ...(idles ? { idles: idles.map(entry), selectIdle: async (id: string) => { calls.push(`clip:${id}`); } } : {}),
    setIdle: enabled => { idle.enabled = enabled; calls.push(`idle:${enabled}`); }, setIdlePaused: paused => { idle.paused = paused; calls.push(`pause:${paused}`); },
    setIdleContributions: (body, face) => { idle.bodyEnabled = body; idle.faceEnabled = face; calls.push(`parts:${body}:${face}`); },
    setBlink: value => calls.push(`blink:${value}`), animateBlink: playing => calls.push(`play:${playing}`) };
}
const previewPort = (): PreviewPort => ({ cameraState: () => ({ position: [0, 1.6, -0.6], target: [0, 1.6, 0], fov: 30 }), front: () => false, setFov: () => false,
  endFovGesture: () => {}, restoreCamera: () => {}, setLighting: () => {}, setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {},
  setHair: () => {}, setEyeShape: () => {}, setPiercings: () => {}, setDetail: () => {}, setPhysics: () => {} });

/** A workspace saved before the move: the motion only in its legacy fields, its migrated session's scenes without it (a phase 1 build's). */
function upgradedWorkspace(): WorkspaceState {
  const state = freshWorkspace();
  Object.assign(state.preview, { idle: true, idleTime: 3.5, idlePaused: true, idleBody: false, idleFace: true, idleClip: "inventory",
    pose: { id: "PhotoModePoses.lean", label: "Lean" } });
  // The session as the window stores it, then without the scenes' motion (as a build before the move wrote it).
  const made = new ProfileSessionState("p-1", sessionOfWorkspace(state, { tab: "Layout 1", character: "c-1", look: LOOK }, seeded()), seeded());
  const session = made.stored({ graph: sessionViewGraph(createStudioViewGraph(state.preview, made.graph())), dock: made.dock() }).sessions["p-1"]!;
  const before = { ...session, views: { ...session.views, scenes: session.views.scenes.map(({ motion: _motion, ...scene }) => scene) } };
  return parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace({ ...state, migration: { id: PROFILES_MIGRATION, token: "00000000-0000-4000-8000-000000000001",
    state: "done" }, profiles: workspaceProfiles("p-1", before as never) }, MODEL))), MODEL);
}

/** A window over a stored workspace: its session, the graph the core makes from it, and the composer that stores it back. */
function open(state: WorkspaceState) {
  const sessionState = new ProfileSessionState("p-1", state.profiles!.sessions["p-1"]!, seeded());
  const history = createHistoryService();
  const graph = createStudioViewGraph(state.preview, sessionState.graph(), history, viewScope("p-1"));
  const composer = new WorkspaceComposer(state, {
    editor: () => ({ recipe: state.recipe, active: state.active, selected: state.selected, fieldSelection: state.fieldSelection, history: state.history }),
    uvView: () => state.uvView, savedV: () => state.savedV, collections: () => state.collections, quality: () => state.preview.textureSize,
    preview: () => undefined, views: () => state.views,
    profiles: () => ({ migration: state.migration, profiles: sessionState.stored({ graph: sessionViewGraph(graph), dock: sessionState.dock() }, state.profiles) }),
  });
  const save = () => JSON.stringify(serializeWorkspace(composer.capture(), MODEL));
  return { graph, history, save };
}
const read = (text: string) => parseWorkspace(JSON.parse(text), MODEL);

describe("persistence and migration", () => {
  test("an existing workspace's motion comes through unchanged: the main scene takes the legacy fields once, then only the node is written", () => {
    const state = upgradedWorkspace();
    expect(state.profiles!.sessions["p-1"]!.views.scenes[0]).not.toHaveProperty("motion");
    const window = open(state);
    // Read once: the node holds exactly what the legacy fields held.
    expect(sceneMotion(window.graph)).toEqual(previewMotion(state.preview));
    expect(sceneMotion(window.graph)).toMatchObject({ idle: true, idleTime: 3.5, idlePaused: true, idleBody: false, idleClip: "inventory",
      pose: { id: "PhotoModePoses.lean", label: "Lean" } });
    // The motion service shows it on a head built for the scene.
    const calls: string[] = [], port = motionPort(calls, ["closeup", "inventory"]), motion = new MotionActions(port, graphMotionScene(window.graph, () => undefined));
    motion.restore();
    expect(calls).toEqual(["parts:false:true", "clip:inventory", "idle:true", "seek:3.5", "pause:true"]);
    expect(motion.pendingPose()).toEqual({ id: "PhotoModePoses.lean", label: "Lean" });
    // A change is written to the node only; the legacy fields stay as they were read.
    motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: false });
    const saved = read(window.save());
    expect(saved.preview).toEqual(state.preview);
    expect(saved.profiles!.sessions["p-1"]!.views.scenes[0]!.motion).toEqual({ ...DEFAULT_MOTION, idleTime: 3.5, idleBody: false, idleClip: "inventory" });
    // Read again: the node wins over the legacy fields, which still say the idle plays.
    expect(saved.preview.idle).toBe(true);
    expect(sceneMotion(open(saved).graph)).toMatchObject({ idle: false, idleClip: "inventory" });
    expect(sceneMotion(open(saved).graph)).not.toHaveProperty("pose");
  });

  test("a workspace round-trips byte-identically when nothing changed; an upgraded one gains only its main scene's motion, once", () => {
    const upgraded = upgradedWorkspace(), before = JSON.stringify(serializeWorkspace(upgraded, MODEL));
    const first = open(upgraded).save();
    // Only the scene's motion was added (the legacy fields and every other byte as they were).
    const strip = (text: string) => { const value = JSON.parse(text); for (const scene of value.profiles.sessions["p-1"].views.scenes) delete scene.motion; return JSON.stringify(value); };
    expect(first).not.toBe(before);
    expect(strip(first)).toBe(before);
    // From then on a round trip keeps every byte, the idle's phase included.
    const second = open(read(first)).save();
    expect(second).toBe(first);
    expect(open(read(second)).save()).toBe(second);
  });

  test("an older build reads what this build stores: its scene codec ignores the motion, and its legacy fields are the ones read at the upgrade", () => {
    const state = upgradedWorkspace(), window = open(state);
    const motion = new MotionActions(motionPort([], ["closeup", "inventory"]), graphMotionScene(window.graph, () => undefined));
    motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: false });
    motion.dispatch({ kind: "motion.setBlink", view: MAIN_VIEW, value: .5 });
    const stored = JSON.parse(window.save());
    // The scene codec as it was before the move (d9f88a33): known fields only, unknown ones dropped.
    const olderScene = (s: Record<string, unknown>) => typeof s.eyeShape === "number" && typeof s.normals === "boolean"
      ? { eyeShape: s.eyeShape, normals: s.normals, ...(s.physics === undefined ? {} : { physics: s.physics }) } : undefined;
    for (const scene of stored.profiles.sessions["p-1"].views.scenes) expect(olderScene(scene)).toBeDefined();
    // The legacy fields an older build restores the main view's motion from: as read at the upgrade, still valid for its reader.
    expect(read(JSON.stringify(stored)).preview).toMatchObject({ idle: true, idleTime: 3.5, idlePaused: true, idleClip: "inventory", blink: 0 });
    // The older build saves: its codec drops the node's motion and it writes its own motion into the legacy fields. This build then reads
    // that motion again (the documented reset on downgrade, profiles design §2.4), never the node's from before the downgrade.
    for (const scene of stored.profiles.sessions["p-1"].views.scenes) delete scene.motion;
    Object.assign(stored.preview, { idle: false, idlePaused: false, blink: .25, blinkPlaying: true });
    expect(sceneMotion(open(read(JSON.stringify(stored))).graph)).toMatchObject({ idle: false, blink: .25, blinkPlaying: true, idleClip: "inventory" });
  });

  test("the scene codec validates and normalises the motion as the workspace reader always did; a damaged motion is refused", () => {
    expect(sceneMotionOf({ ...DEFAULT_MOTION, idle: true, blink: .5, blinkPlaying: true, idlePaused: true, idleClip: "closeup" }))
      .toEqual({ ...DEFAULT_MOTION, idle: true, idlePaused: true });
    expect(sceneMotionOf({ ...DEFAULT_MOTION, idlePaused: true, blink: .5 })).toEqual({ ...DEFAULT_MOTION, blink: .5 });
    for (const bad of [{ ...DEFAULT_MOTION, blink: 2 }, { ...DEFAULT_MOTION, idleTime: -1 }, { ...DEFAULT_MOTION, idleClip: "../x" }, { ...DEFAULT_MOTION, pose: { id: "a b", label: "x" } },
      { ...DEFAULT_MOTION, idle: "yes" }, null, []])
      expect(sceneMotionOf(bad)).toBeUndefined();
    const graph = createStudioViewGraph(freshWorkspace().preview);
    expect(() => graph.edit(MAIN_VIEW, "scene", { state: { motion: { ...DEFAULT_MOTION, blink: 3 } } })).toThrow();
  });
});

describe("history", () => {
  /** A drawn view's preview and motion services over a graph recording into a View and lighting scope. */
  function services() {
    const workspace = freshWorkspace(), history = createHistoryService(), scope = viewScope("p-1");
    const graph = createStudioViewGraph(workspace.preview, undefined, history, scope);
    let preview: PreviewActions | undefined;
    const port = motionPort(), motion = new MotionActions(port, graphMotionScene(graph, () => preview));
    motion.restore();
    preview = new PreviewActions(workspace.preview, previewPort(), graph);
    return { graph, history, preview, motion, port };
  }

  test("motion records no View and lighting step, and an Undo or Redo of another scene setting leaves it as it is now", () => {
    const { graph, preview, motion, port } = services();
    preview.dispatch({ kind: "preview.setEyeShape", view: MAIN_VIEW, index: 4 });
    expect(graph.history().depth).toBe(1);
    motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: true });
    motion.dispatch({ kind: "motion.setContributions", view: MAIN_VIEW, body: false, face: true });
    port.idle.time = 6;
    motion.dispatch({ kind: "motion.setPaused", view: MAIN_VIEW, paused: true });
    expect(graph.history()).toMatchObject({ depth: 1, undo: expect.any(String) });
    const now: SceneMotion = { ...DEFAULT_MOTION, idle: true, idleTime: 6, idlePaused: true, idleBody: false };
    expect(sceneMotion(graph)).toEqual(now);
    graph.undo();
    expect(graph.state<SceneState>(MAIN_VIEW, "scene").eyeShape).not.toBe(4);
    expect(sceneMotion(graph)).toEqual(now);
    motion.dispatch({ kind: "motion.setPaused", view: MAIN_VIEW, paused: false });
    graph.redo();
    expect(graph.state<SceneState>(MAIN_VIEW, "scene").eyeShape).toBe(4);
    expect(sceneMotion(graph)).toEqual({ ...now, idlePaused: false });
    // Hair physics is a recorded scene setting beside it: its Undo keeps the motion too.
    graph.edit(MAIN_VIEW, "scene", { state: { physics: true } }, { label: "Hair physics on" });
    motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: false });
    graph.undo();
    expect(graph.state<SceneState>(MAIN_VIEW, "scene").physics).toBeUndefined();
    expect(sceneMotion(graph)).toMatchObject({ idle: false, idleTime: 6, idleBody: false });
    expect(motion.snapshot().idle).toBe(false);
  });
});

describe("a runtime applies its scene's motion", () => {
  const restored = (workspace: WorkspaceState, graph: ViewGraph, port: MotionPort) => createTrustedPreviewServices(workspace, {
    savedAppearance: { apply: () => ({ applied: [], appearanceReferences: 0 }) as never }, preview: previewPort(), motion: port }, graph).finish();

  test("a new head of the same scene restores the node's motion, from where the previous head left the idle, whatever the workspace snapshot says", () => {
    const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview);
    const first = motionPort(), head = restored(workspace, graph, first);
    head.motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: true });
    first.idle.time = 7.25;
    // The head is released (a body change reloads it): the idle's phase goes back to the scene.
    head.motion.release(); head.preview.dispose();
    expect(sceneMotion(graph)).toMatchObject({ idle: true, idleTime: 7.25 });
    // The workspace the next head attaches with still says the idle is off: the scene's node decides.
    const calls: string[] = [], next = restored(workspace, graph, motionPort(calls));
    expect(calls).toEqual(["parts:true:true", "idle:true", "seek:7.25", "pause:false"]);
    expect(next.motion.snapshot()).toMatchObject({ idle: true, idleTime: 7.25 });
  });

  test("what a device can't take is stored back as the scene shows it, as restore-time state that records nothing", () => {
    const workspace = freshWorkspace(), history = createHistoryService();
    workspace.preview.blink = .6; workspace.preview.blinkPlaying = true; workspace.preview.idleClip = "relaxed";
    const graph = createStudioViewGraph(workspace.preview, undefined, history, viewScope("p-1"));
    expect(sceneMotion(graph)).toMatchObject({ blink: .6, blinkPlaying: true, idleClip: "relaxed" });
    // No blink and no catalogue on this device: the closure opens and the default idle is the one shown.
    restored(workspace, graph, { ...motionPort(), blink: { available: false } });
    expect(sceneMotion(graph)).toEqual(DEFAULT_MOTION);
    expect(graph.history().depth).toBe(0);
  });
});
