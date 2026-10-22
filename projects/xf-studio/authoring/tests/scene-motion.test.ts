/**
 * Profiles phase 4a-iii (experiment 043 §9): the motion settings (idle on or off, its phase, pause and contributions, the idle played, the
 * blink and the pose) live in the view graph's scene node. An existing workspace's motion is read from its legacy `preview` fields once and
 * then written only to the node; the legacy fields are written back as read, so an older build opens them as they were at the upgrade.
 * Motion records no View and lighting step, and an Undo of another scene setting leaves it as it is now. A new head of the same scene
 * applies the node's motion, with the phase its previous head left.
 */
import { describe, expect, test } from "bun:test";
import { IDLE_MASCULINE, MotionActions, RELEASED, type MotionPort } from "../src/animation/motion-actions";
import { DEFAULT_MOTION, previewMotion, recoverSceneMotion, sceneMotionOf, type SceneMotion } from "../src/animation/scene-motion";
import { graphMotionScene, createTrustedPreviewServices } from "../src/app/trusted-preview-services";
import { WorkspaceComposer } from "../src/app/workspace/workspace-composer";
import { loadWorkspace, parseWorkspace, serializeWorkspace, workspaceKeys, type WorkspaceState } from "../src/app/workspace/workspace-state";
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
function open(state: WorkspaceState, sample?: () => void) {
  const sessionState = new ProfileSessionState("p-1", state.profiles!.sessions["p-1"]!, seeded());
  const history = createHistoryService();
  const graph = createStudioViewGraph(state.preview, sessionState.graph(), history, viewScope("p-1"));
  const composer = new WorkspaceComposer(state, {
    editor: () => ({ recipe: state.recipe, active: state.active, selected: state.selected, fieldSelection: state.fieldSelection, history: state.history }),
    uvView: () => state.uvView, savedV: () => state.savedV, collections: () => state.collections, quality: () => state.preview.textureSize,
    preview: () => undefined, views: () => state.views, ...(sample ? { sample } : {}),
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
    // A reader recovers field by field instead: each damaged field at its default, a damaged idle choice or pose left out.
    expect(recoverSceneMotion({ ...DEFAULT_MOTION, idleTime: 4, blink: 2, blinkPlaying: true, idleBody: "no", idleClip: "../x", pose: { id: "a b", label: "x" } }))
      .toEqual({ ...DEFAULT_MOTION, idleTime: 4, blinkPlaying: true });
    expect(recoverSceneMotion({})).toEqual(DEFAULT_MOTION);
    for (const bad of [null, [], "motion", 3]) expect(recoverSceneMotion(bad)).toBeUndefined();
  });

  test("one damaged optional scene setting never costs the scene or the graph: it is recovered alone, and the next save keeps every view", () => {
    const window = open(upgradedWorkspace());
    window.graph.addView(MAIN_VIEW, {}, { label: "New 3D view" });
    const graphOf = (text: string) => open(read(text)).graph;
    const stored = JSON.parse(window.save()), scenes = stored.profiles.sessions["p-1"].views.scenes;
    expect(scenes).toHaveLength(2);
    // Sol's reproduction: an eyelid closure out of range in the second scene, and a damaged optional switch beside it.
    scenes[1].motion = { ...scenes[1].motion, blink: 2, idleTime: 5 };
    scenes[1].physics = "yes";
    const graph = graphOf(JSON.stringify(stored));
    expect(graph.viewIds()).toHaveLength(2);
    const second = graph.viewIds().find(view => view !== MAIN_VIEW)!;
    // The new view's scene started as a copy of the main one's; only the damaged field went back to its default.
    expect(graph.state<SceneState>(second, "scene").motion).toEqual({ ...sceneMotion(window.graph)!, blink: 0, idleTime: 5 });
    expect(graph.state<SceneState>(second, "scene")).not.toHaveProperty("physics");
    expect(sceneMotion(graph)).toEqual(sceneMotion(window.graph));
    // A whole motion that isn't one is left out: the main scene then reads the legacy fields again, another scene the default.
    scenes[0].motion = "damaged"; scenes[1].motion = [];
    const reread = graphOf(JSON.stringify(stored));
    expect(reread.viewIds()).toHaveLength(2);
    expect(sceneMotion(reread)).toEqual(previewMotion(read(JSON.stringify(stored)).preview));
    // The legacy `views` field recovers the same way.
    const legacy = createStudioViewGraph(freshWorkspace().preview);
    legacy.addView(MAIN_VIEW, {}, { label: "New 3D view" });
    const views = sessionViewGraph(legacy), base = JSON.parse(window.save());
    (views.scenes[1] as Record<string, unknown>).motion = { ...DEFAULT_MOTION, blink: 2 };
    expect(read(JSON.stringify({ ...base, views })).views?.views).toHaveLength(2);
  });

  test("the restore says, in the person's words, which 3D view settings it reset: one line per scene, through the workspace's restore notice", () => {
    const window = open(upgradedWorkspace());
    window.graph.addView(MAIN_VIEW, {}, { label: "New 3D view" });
    const stored = JSON.parse(window.save()), scenes = stored.profiles.sessions["p-1"].views.scenes;
    // Sol's reproduction, in the second scene: damaged switches beside a damaged closure; the main scene is untouched.
    Object.assign(scenes[1], { physics: "yes", uncensored: 3, eyeOwnRoughness: "x", motion: { ...scenes[1].motion, blink: 2 } });
    const warnings: string[] = [], state = parseWorkspace(structuredClone(stored), MODEL, warnings);
    expect(warnings).toEqual(["Some 3D view settings couldn't be read and were reset: eye's own roughness, showing V uncensored, hair physics, blink."]);
    for (const line of warnings) expect(line).not.toMatch(/physics"|eyeOwnRoughness|uncensored:|idle[A-Z]|blinkPlaying/);
    // The unreadable values aren't kept: the session holds the recovered scene, and both views come through.
    const session = state.profiles!.sessions["p-1"]!.views;
    expect(session.scenes[1]).not.toHaveProperty("physics");
    expect(session.scenes[1]!.motion).toMatchObject({ blink: 0 });
    expect(open(state).graph.viewIds()).toHaveLength(2);
    // A whole motion that isn't one names every motion setting; an undamaged workspace says nothing.
    scenes[0].motion = "damaged";
    const both: string[] = [];
    parseWorkspace(structuredClone(stored), MODEL, both);
    expect(both).toEqual(["Some 3D view settings couldn't be read and were reset: game idle, blink, pose.", warnings[0]]);
    const clean: string[] = [];
    parseWorkspace(JSON.parse(window.save()), MODEL, clean);
    expect(clean).toEqual([]);
    // The notice the workspace already shows for a repaired restore carries it (with any dropped draft before it).
    const storage = { getItem: (key: string) => key === workspaceKeys(false).workspace ? JSON.stringify(stored) : null };
    expect(loadWorkspace(storage, false, MODEL)).toMatchObject({ writable: true,
      warning: `${both[0]} ${both[1]}` });
  });

  test("a save reads the playing idle's phase into the scene first, without recording, publishing or touching the legacy fields", () => {
    const state = upgradedWorkspace();
    let motion: MotionActions | undefined;
    const window = open(state, () => motion?.sample());
    const port = motionPort([], ["closeup", "inventory"]);
    motion = new MotionActions(port, graphMotionScene(window.graph, () => undefined));
    motion.restore();
    motion.dispatch({ kind: "motion.setPaused", view: MAIN_VIEW, paused: false });
    expect(sceneMotion(window.graph)?.idleTime).toBe(3.5);
    port.idle.time = 7.25;
    let published = 0;
    window.graph.subscribe(() => published++);
    const saved = read(window.save());
    expect(saved.profiles!.sessions["p-1"]!.views.scenes[0]!.motion).toMatchObject({ idle: true, idleTime: 7.25, idlePaused: false });
    expect(published).toBe(0);
    expect(window.graph.history().depth).toBe(0);
    expect(saved.preview).toEqual(state.preview);
    // A reload (a flush, no head released) starts the idle there.
    const calls: string[] = [];
    new MotionActions(motionPort(calls, ["closeup", "inventory"]), graphMotionScene(open(saved).graph, () => undefined)).restore();
    expect(calls).toContain("seek:7.25");
    // Only live state can be sampled.
    expect(() => window.graph.sample(MAIN_VIEW, "scene", { eyeShape: 2 })).toThrow();
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
  /** A head built for the scene and shown (its motion and camera applied). */
  const shownHead = (workspace: WorkspaceState, graph: ViewGraph, port: MotionPort) => { const head = restored(workspace, graph, port); head.show(); return head; };

  test("a new head of the same scene restores the node's motion, from where the previous head left the idle, whatever the workspace snapshot says", () => {
    const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview);
    const first = motionPort(), head = shownHead(workspace, graph, first);
    head.motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: true });
    first.idle.time = 7.25;
    // The head is released (a body change reloads it): the idle's phase goes back to the scene.
    head.motion.release(); head.preview.dispose();
    expect(sceneMotion(graph)).toMatchObject({ idle: true, idleTime: 7.25 });
    // The workspace the next head attaches with still says the idle is off: the scene's node decides.
    const calls: string[] = [], next = shownHead(workspace, graph, motionPort(calls));
    expect(calls).toEqual(["parts:true:true", "idle:true", "seek:7.25", "pause:false"]);
    expect(next.motion.snapshot()).toMatchObject({ idle: true, idleTime: 7.25 });
  });

  test("a released service never reaches the scene or the device again: its idle load failing later leaves the replacement's choice", async () => {
    const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview);
    let reject!: (error: Error) => void;
    const first = { ...motionPort([], ["closeup", "inventory"]),
      selectIdle: () => new Promise<void>((_resolve, fail) => { reject = fail; }) };
    const old = new MotionActions(first, graphMotionScene(graph, () => undefined));
    old.restore();
    old.dispatch({ kind: "motion.setIdleClip", view: MAIN_VIEW, clip: "inventory" });
    expect(old.snapshot()).toMatchObject({ idleClip: "inventory", idleLoading: true });
    // Sol's reproduction: the head is released while the load is under way, its replacement plays the choice, then the old load fails.
    old.release();
    const replacement = new MotionActions(motionPort([], ["closeup", "inventory"]), graphMotionScene(graph, () => undefined));
    replacement.restore();
    await Bun.sleep(0);
    expect(replacement.snapshot()).toMatchObject({ idleClip: "inventory", idleLoading: false });
    reject(Error("missing file"));
    await Bun.sleep(0);
    expect(sceneMotion(graph)?.idleClip).toBe("inventory");
    expect(replacement.snapshot().idleClip).toBe("inventory");
    // The released service refuses actions and writes nothing more.
    expect(old.capability({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: false })).toMatchObject({ available: false, reason: RELEASED });
    expect(old.poseCapability()).toMatchObject({ available: false, reason: RELEASED });
    const before = sceneMotion(graph);
    old.sample(); old.release();
    expect(sceneMotion(graph)).toEqual(before);
  });

  test("a pose still loading on a released service never plays nor reaches the scene", async () => {
    const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview), played: unknown[] = [];
    let resolve!: (sample: never) => void;
    const port = { ...motionPort(), setPose: async (pose: unknown) => { played.push(pose); } };
    const old = new MotionActions(port, graphMotionScene(graph, () => undefined));
    const holding = old.holdPose({ id: "PhotoModePoses.a", label: "A", moves: false }, new Promise(done => { resolve = done; }));
    expect(sceneMotion(graph)?.pose).toEqual({ id: "PhotoModePoses.a", label: "A" });
    old.release();
    // The replacement takes the scene: it drops the pose it can't hold.
    const replacement = new MotionActions(motionPort(), graphMotionScene(graph, () => undefined));
    replacement.dropPendingPose();
    resolve({} as never);
    expect(await holding).toBe(false);
    expect(played).toEqual([]);
    expect(sceneMotion(graph)).not.toHaveProperty("pose");
  });

  test("a runtime that can't honour the node's motion leaves the node unchanged: it shows its own fallback as status (4a-iv)", () => {
    const workspace = freshWorkspace(), history = createHistoryService();
    Object.assign(workspace.preview, { idle: true, idleTime: 7.25, idleClip: "inventory" });
    const graph = createStudioViewGraph(workspace.preview, undefined, history, viewScope("p-1"));
    const chosen = sceneMotion(graph);
    expect(chosen).toMatchObject({ idle: true, idleTime: 7.25, idleClip: "inventory" });
    // A masculine head: no idle on this version. It holds still and says why; the node keeps the person's idle, clip and phase.
    const calls: string[] = [];
    const masculine = shownHead(workspace, graph, { ...motionPort(calls), available: false, error: IDLE_MASCULINE });
    expect(masculine.motion.snapshot()).toMatchObject({ idle: false, available: false, error: IDLE_MASCULINE });
    expect(calls).toContain("idle:false");
    expect(sceneMotion(graph)).toEqual(chosen);
    // Hidden for another head: its idle doesn't play, so it has no phase to give.
    masculine.hide();
    expect(sceneMotion(graph)).toEqual(chosen);
    // The feminine head shown next plays the chosen idle from where it was.
    const played: string[] = [], feminine = shownHead(workspace, graph, motionPort(played, ["closeup", "inventory"]));
    expect(played).toEqual(["parts:true:true", "clip:inventory", "idle:true", "seek:7.25", "pause:false"]);
    expect(feminine.motion.snapshot()).toMatchObject({ idle: true, idleClip: "inventory" });
    // No blink and no catalogue on a device: it opens the closure and plays the close-up, and the node still holds the blink and the clip.
    const still = freshWorkspace();
    Object.assign(still.preview, { blink: .6, blinkPlaying: true, idleClip: "relaxed" });
    const other = createStudioViewGraph(still.preview, undefined, history, viewScope("p-2"));
    const before = sceneMotion(other);
    const bare = shownHead(still, other, { ...motionPort(), blink: { available: false } });
    expect(bare.motion.snapshot()).toMatchObject({ idleClip: "closeup", blinkAvailable: false });
    expect(sceneMotion(other)).toEqual(before);
    expect(graph.history().depth).toBe(0);
    expect(other.history().depth).toBe(0);
  });

  test("motion is released and restored across a swap: a warm head shown again plays from the phase the other head left, and nothing it had under way lands (4a-iv)", async () => {
    const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview);
    const loads: ((error: Error) => void)[] = [];
    const aPort = { ...motionPort([], ["closeup", "inventory"]), selectIdle: () => new Promise<void>((_resolve, reject) => { loads.push(reject); }) };
    const a = shownHead(workspace, graph, aPort);
    a.motion.dispatch({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: true });
    a.motion.dispatch({ kind: "motion.setIdleClip", view: MAIN_VIEW, clip: "inventory" });
    aPort.idle.time = 2;
    // B takes the view: A's phase goes to the node, and A refuses actions while hidden.
    a.hide();
    expect(sceneMotion(graph)).toMatchObject({ idle: true, idleTime: 2, idleClip: "inventory" });
    expect(a.motion.capability({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: false })).toMatchObject({ available: false, reason: RELEASED });
    const bPort = motionPort([], ["closeup", "inventory"]), b = shownHead(workspace, graph, bPort);
    bPort.idle.time = 9.5;
    b.hide();
    // A again: it restores the node's motion, from B's phase. A's load from before it was hidden failing now changes nothing.
    const calls: string[] = [];
    const seek = aPort.idle.seek.bind(aPort.idle);
    aPort.idle.seek = (time: number) => { calls.push(`seek:${time}`); seek(time); };
    a.show();
    expect(calls).toEqual(["seek:9.5"]);
    expect(loads.length).toBe(2);
    loads[0]!(Error("missing file"));
    await Bun.sleep(0);
    expect(sceneMotion(graph)).toMatchObject({ idle: true, idleTime: 9.5, idleClip: "inventory" });
    expect(a.motion.snapshot()).toMatchObject({ idleClip: "inventory", idleLoading: true });
    expect(a.motion.capability({ kind: "motion.setIdle", view: MAIN_VIEW, enabled: false })).toEqual({ available: true });
  });
});
