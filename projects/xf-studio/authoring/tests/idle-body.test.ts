// The game's preview idles read natively (idle-body.ts, idle-host.ts, idle-server.ts, platform/scene/idle-source.ts), over a synthetic body
// graph in the reader's JSON shape and synthetic rigs (no game data): which clips loop on which screen, the catalogue, the rests and
// ancestry, the host's disk cache and prepared faces, and the endpoint's refusals. The real game is compared in native-idle-oracle.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import { EYES_SECTION_ID, faceClipFor, idleCatalogue, previewIdles, restJoints, rigAncestry, type GraphIdle, type IdleState } from "../src/idle-body";
import { clipTimes, MAX_BAKE_FRAMES, MAX_BAKE_SECONDS } from "../src/engines/facial-rig/bake";
import { compileFacialRig, ENVELOPE_NAMES, FacialSetupError } from "../src/engines/facial-rig/solver";
import type { FaceSource } from "../src/facial-host";
import { FACE_MOTION_SCHEMA } from "../src/platform/api/facial";
import { IDLE_CACHE_KEYS, IDLE_HOST_VERSION, IdleHost, IdleSetupError, pruneIdleCache } from "../src/idle-host";
import { createIdleHandler } from "../src/idle-server";
import type { IdleEntry } from "../src/idle-catalogue";
import { loadIdleSource, restSkeleton } from "../src/platform/scene/idle-source";

const name = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
let handles = 0;
const node = (data: Record<string, unknown>) => ({ HandleId: String(handles++), Data: data });
const anim = (clip: string, looped = 1) => node({ $type: "animAnimNode_SkAnim", animation: name(clip), isLooped: looped });
const state = (title: string, input: unknown) => node({ $type: "animAnimNode_State", name: name(title), inputNode: input });
const condition = (flag: string) => node({ $type: "animAnimStateTransitionCondition_BoolFeature", featureName: name("Paperdoll"), featurePropertyName: name(flag) });

/** A body graph like the paperdoll's: a screens switch over two state machines, a clip it plays directly and a weapon idle deeper down. */
function graph() {
  handles = 0;
  const creator = node({ $type: "animAnimNode_StateMachine", states: [state("closeup", anim("ui_closeup_shot")), state("fullbody", anim("ui_fullbody_shot")),
    state("showcase", anim("ui_closeup_to_fullbody", 0))], transitions: [condition("characterCreation_Eyes"), condition("characterCreation_Head")] });
  const inventory = node({ $type: "animAnimNode_StateMachine", states: [state("Idle", anim("UI_full_shot"))], transitions: [condition("inventoryScreen_Legs")] });
  const weapons = node({ $type: "animAnimNode_Blend", input: anim("handgun_idle") });
  const screens = node({ $type: "animAnimNode_Switch", inputs: [creator, inventory, anim("ui_gender_selection"), weapons] });
  // A second reference to a node already written is a HandleRefId, as the reader writes it.
  return { $type: "animAnimGraph", rootNode: screens, debug: { HandleRefId: creator.HandleId } };
}

const entries: GraphIdle[] = previewIdles(graph()).entries;
const durations = new Map([["ui_closeup_shot", 12.3333], ["ui_fullbody_shot", 15.7333], ["UI_full_shot", 11.0667], ["ui_gender_selection", 15.6333]]);
const source = { graph: "g", set: "s", rig: "r" };

describe("the preview idles in a body graph", () => {
  test("each state's looping clip, the switch's own looping clip, the flags each machine tests; one-shots out, weapon idles left", () => {
    const { entries, left } = previewIdles(graph());
    // In the graph walk's order (the catalogue sorts them for the Motion panel).
    expect(entries.map(entry => [entry.id, entry.clip, entry.screen, entry.state, entry.flags.join(",")]).sort((a, b) => a[0]!.localeCompare(b[0]!))).toEqual([
      ["closeup", "ui_closeup_shot", "creator", "closeup", "characterCreation_Eyes,characterCreation_Head"],
      ["fullbody", "ui_fullbody_shot", "creator", "fullbody", "characterCreation_Eyes,characterCreation_Head"],
      ["gender-selection", "ui_gender_selection", "gender", "switch input", ""],
      ["inventory", "UI_full_shot", "inventory", "Idle", "inventoryScreen_Legs"]]);
    expect(left.map(item => item.clip)).toEqual(["handgun_idle"]);
    expect(entries.find(entry => entry.id === "closeup")!.evidence).toContain("state `closeup`");
  });

  test("the catalogue: lengths from the set, the creator's puppet for the creator's screens, no face without a prepared one", () => {
    const catalogue = idleCatalogue({ entries, left: [], durations, source });
    expect(catalogue.idles.map(entry => [entry.id, entry.label, entry.body, entry.duration, entry.puppet, entry.face])).toEqual([
      ["closeup", "Creator close-up", "cc-idle-body.glb", 12.333, "creator", null], ["fullbody", "Creator full body", "cc-idle-body-ui_fullbody_shot.glb", 15.733, "creator", null],
      ["inventory", "Inventory", "cc-idle-body-ui_full_shot.glb", 11.067, null, null],
      ["gender-selection", "Gender selection", "cc-idle-body-ui_gender_selection.glb", 15.633, "creator", null]]);
    // A clip no set holds is left out.
    expect(idleCatalogue({ entries, left: [], durations: new Map([["ui_closeup_shot", 12]]), source }).idles.map(entry => entry.id)).toEqual(["closeup"]);
  });

  test("a prepared face joins its entry, and the eyes section appears only with its own prepared face", () => {
    const face = (id: string, file: string, extra: Partial<IdleEntry> = {}) => [id, { id, label: "Creator close-up, eyes section", clip: "ui_closeup_shot", body: "x.glb",
      duration: 1, screen: "creator", state: "closeup (eyes one-shot)", flags: ["characterCreation_Eyes"], face: { clip: "c", file }, puppet: "creator",
      evidence: "e", ...extra } as IdleEntry] as const;
    const faces = new Map([face("closeup", "cc-idle-face.glb"), face(EYES_SECTION_ID, "cc-idle-face-eyes-section.glb", { face: { clip: "c", file: "cc-idle-face-eyes-section.glb", loopFrom: 4.5 } })]);
    const catalogue = idleCatalogue({ entries, left: [], durations, source, faces });
    expect(catalogue.idles.map(entry => [entry.id, entry.face?.file ?? null])).toEqual([["closeup", "cc-idle-face.glb"],
      [EYES_SECTION_ID, "cc-idle-face-eyes-section.glb"], ["fullbody", null], ["inventory", null], ["gender-selection", null]]);
    expect(catalogue.idles[1]!.body).toBe("cc-idle-body.glb");
    expect(catalogue.idles[1]!.face?.loopFrom).toBe(4.5);
  });
});

describe("rests, ancestry and the page's skeleton", () => {
  const rig = { bones: ["Root", "Hips", "Spine"], parents: [-1, 0, 1],
    reference: [0, 1, 2].map(() => ({ translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })),
    aPose: [{ translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, { translation: [0, 0, 1], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], scale: [1, 1, 1] },
      { translation: [0.5, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }] };
  test("the rest is the rig's A pose where it has one, else its reference; roots hang under Armature", () => {
    const joints = restJoints(rig);
    expect(joints.map(joint => [joint.bone, joint.parent, joint.translation])).toEqual([["Root", null, [0, 0, 0]], ["Hips", "Root", [0, 0, 1]], ["Spine", "Hips", [0.5, 0, 0]]]);
    expect(restJoints({ ...rig, aPose: undefined })[1]!.translation).toEqual([0, 0, 0]);
    expect(rigAncestry(joints)).toEqual({ Armature: null, Root: "Armature", Hips: "Root", Spine: "Hips" });
  });

  test("the page builds bones in glTF axes (game Z up → Y up) under an Armature node", () => {
    const skeleton = restSkeleton(restJoints(rig));
    expect(skeleton.name).toBe("Armature");
    const spine = skeleton.getObjectByName("Spine")!;
    expect(spine).toBeInstanceOf(THREE.Bone);
    // Hips 1 m up (game Z → glTF Y), turned a quarter about game Z (glTF −Y); Spine 0.5 m along the hips' X, which that turn points along game Y (glTF −Z).
    const at = new THREE.Vector3().setFromMatrixPosition(spine.matrixWorld);
    expect(at.x).toBeCloseTo(0, 6); expect(at.y).toBeCloseTo(1, 6); expect(at.z).toBeCloseTo(-0.5, 6);
  });
});

describe("the idle host and its endpoint", () => {
  const route = { gameRoot: "G", launchRoute: "direct" as const, mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null };
  test("without a game folder it needs setup; a disk cache answers without opening the game; faces come from the facial host or say why not", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idles-"));
    try {
      expect((await new IdleHost({ route: () => null, fingerprint: () => "f", resolverCache: root }).state()).phase).toBe("needs-setup");
      const assets = join(root, "assets");
      mkdirSync(assets);
      let opened = 0, reason: string | null = "V's face is still being read.";
      const host = new IdleHost({ route: () => route, fingerprint: () => "fp", resolverCache: join(root, "cache"), preparedAssets: () => assets,
        open: () => { opened++; throw Error("not in this test"); },
        faces: async () => reason ? { reason } : { rig: null as never, identity: "i", skeleton: "s", setup: "u", installation: null } });
      // Seed the cache under the host's own key.
      const key = (host as unknown as { key(): string }).key();
      mkdirSync(join(root, "cache", "idles", key), { recursive: true });
      const joints = [{ bone: "Root", parent: null, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }];
      writeFileSync(join(root, "cache", "idles", key, "idles.json"), JSON.stringify({ version: IDLE_HOST_VERSION, idles: { entries, left: [],
        durations: Object.fromEntries(durations), source, rig: { path: "r", joints }, face: { path: "f", joints }, clips: {} } }));
      const state = await host.state();
      expect(opened).toBe(0);
      if (state.phase !== "ready" || state.source !== "game") throw Error("not ready");
      expect(state.catalogue.idles.map(entry => entry.face)).toEqual([null, null, null, null]);
      expect(state.faceReason).toBe("V's face is still being read.");
      expect(state.ancestry).toEqual({ Armature: null, Root: "Armature" });
      // A developer preparation's face no longer joins the game's idles (it is the Python oracle's alone).
      writeFileSync(join(assets, "cc-idle-catalogue.json"), JSON.stringify({ schema: "xfs/idle-catalogue-1", source, left: [], idles: [{ id: "closeup", label: "Creator close-up",
        clip: "ui_closeup_shot", body: "cc-idle-body.glb", duration: 12.333, screen: "creator", state: "closeup", flags: [], face: { clip: "ui_closeup_shot", file: "cc-idle-face.glb" },
        puppet: "creator", evidence: "e" }] }));
      writeFileSync(join(assets, "cc-idle-face.glb"), "glb");
      expect(((await host.state()) as { catalogue: { idles: IdleEntry[] } }).catalogue.idles[0]!.face).toBeNull();
      // The face is ready but its clips can't be listed (the game can't be opened here): no faces, in plain words.
      reason = null;
      const later = await host.state();
      expect(later.phase === "ready" && later.source === "game" && later.faceReason).toBe("V's face holds still during the idle: XF Studio couldn't read it from your game files.");
      expect(await host.face("closeup")).toBeNull();
      // A body whose clip the cache can't place is null, not an error.
      expect(await host.body("closeup")).toBeNull();
      // The Python oracle's source answers with the preparation alone.
      const prepared = await new IdleHost({ route: () => route, fingerprint: () => "fp", resolverCache: join(root, "cache"), preparedAssets: () => assets, source: "prepared" }).state();
      expect(prepared.phase === "ready" && prepared.source).toBe("prepared");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("each idle's face clip: its own name in the face set, the inventory the close-up's, none otherwise", () => {
    const clips = new Map([["ui_closeup_shot", 1], ["ui_fullbody_shot", 1], ["ui_closeup_shot_eyes", 1]]);
    expect(faceClipFor({ clip: "ui_closeup_shot", screen: "creator" }, clips)).toBe("ui_closeup_shot");
    expect(faceClipFor({ clip: "UI_FULLBODY_SHOT", screen: "creator" }, clips)).toBe("ui_fullbody_shot");
    expect(faceClipFor({ clip: "UI_full_shot", screen: "inventory" }, clips)).toBe("ui_closeup_shot");
    expect(faceClipFor({ clip: "ui_gender_selection", screen: "gender" }, clips)).toBeNull();
    expect(faceClipFor({ clip: "UI_full_shot", screen: "inventory" }, new Map())).toBeNull();
  });

  test("the idle cache keeps a few installations' folders, least recently used dropped first, never another host's current one (PREV-163)", () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idle-cache-"));
    try {
      // Six installations' folders, oldest first; "main" is the other server's, used most recently.
      const names = ["a", "b", "c", "d", "main", "new"];
      names.forEach((name, i) => {
        mkdirSync(join(root, name));
        const at = new Date(Date.UTC(2026, 0, 1, 0, i));
        utimesSync(join(root, name), at, at);
      });
      pruneIdleCache(root, "new");
      expect(readdirSync(root).sort()).toEqual(["c", "d", "main", "new"]);
      expect(readdirSync(root)).toHaveLength(IDLE_CACHE_KEYS);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("the endpoint: other origins refused, ids checked, a missing idle 404, no game folder 409, a failure 503", async () => {
    const ready = { schema: "xfs/idle-state-1", phase: "needs-setup", message: "m" } as const;
    let body: () => Promise<unknown> = async () => null;
    const handler = createIdleHandler({ state: async () => ready, body: (() => body()) as never, face: async () => null });
    const get = (path: string, headers: Record<string, string> = {}) => handler(new Request(`http://127.0.0.1:4485/api/idles${path}`, { headers }));
    expect((await get("")).status).toBe(200);
    expect((await get("", { Origin: "http://evil.test" })).status).toBe(403);
    expect((await handler(new Request("http://localhost:4485/api/idles"))).status).toBe(403);
    expect((await get("?body=Not%20an%20id")).status).toBe(400);
    expect((await get("?body=closeup")).status).toBe(404);
    body = async () => { throw new IdleSetupError(); };
    expect((await get("?body=closeup")).status).toBe(409);
    body = async () => { throw Error("boom"); };
    const failed = await get("?body=closeup");
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("boom");
  });
});

// ---- The idle's face from a compiled rig (review at 0cd96cc: PREV-173..176, PREV-181) ----

describe("the idle's face, solved by XF Studio's own solver on the host", () => {
  const TRACKS = [...ENVELOPE_NAMES, "jaw_open", "jaw_openLipsync"], JAW = ENVELOPE_NAMES.length;
  const still = { Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: 0, Z: 0, W: 0 }, Scale: { X: 1, Y: 1, Z: 1, W: 0 } };
  const empty = () => ({ EnvelopesPerTrackMapping: [], GlobalLimits: [], InfluencedPoses: [], InfluenceIndices: [], UpperLowerFace: [], LipsyncPosesSides: [],
    GlobalCorrectiveEntries: [], InbetweenCorrectiveEntries: [], CorrectiveInfluencedPoses: [], CorrectiveInfluenceIndices: [], AllMainPoses: [],
    AllMainPosesInbetweens: [], AllMainPosesInbetweenScopeMultipliers: [], Wrinkles: [] });
  const none = { Poses: [], Transforms: [], Scales: [] };
  /** A two-joint face whose one control (jaw_open) moves the jaw 1 cm down. */
  const compiled = () => compileFacialRig({ boneNames: ["root", "jaw"], boneParentIndexes: [-1, 0], boneTransforms: [still, still], trackNames: TRACKS,
    referenceTracks: TRACKS.map((_, i) => [0, 1, 2, 5, 6, 7, 8].includes(i) ? 1 : 0) }, { version: 8,
    info: { tracksMapping: { numEnvelopes: JAW, numMainPoses: 1, numLipsyncOverrides: 0, numWrinkles: 0 } },
    bakedData: { Data: { LipsyncOverridesIndexMapping: [], Eyes: empty(), Tongue: empty(),
      Face: { ...empty(), EnvelopesPerTrackMapping: [{ Track: JAW, Envelope: 0, LevelOfDetail: 0 }], AllMainPoses: [{ Track: JAW, NumInbetweens: 1 }], AllMainPosesInbetweens: [1] } } },
    mainPosesData: { Data: { Eyes: none, Tongue: none, Face: { Poses: [{ TransformIdx: 0, NumTransforms: 1, IsScale: 0, ScaleIdx: 0 }],
      Transforms: [{ Bone: 1, Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: 0, Z: -0.01 } }], Scales: [] } } },
    correctivePosesData: { Data: { Face: none, Eyes: none, Tongue: none } } });
  const route = { gameRoot: "G", launchRoute: "direct" as const, mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null };
  const joints = [{ bone: "Root", parent: null, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }];

  /** A host over a seeded idle cache, a face set in one archive (its clips `duration` long) and a face that `faces` lends. */
  function world(root: string, options: { duration?: number; faces?: () => Promise<FaceSource | { reason: string }>; failOpens?: number } = {}) {
    const archive = { id: join(root, "basegame_face.archive"), name: "basegame_face", providerName: "" };
    if (!existsSync(archive.id)) writeFileSync(archive.id, "face set");
    let decodes = 0, opens = 0;
    const duration = options.duration ?? 2;
    const installation = { graph: { lookup: () => ({ winner: archive, candidates: [archive] }) }, fetcher: { nativeDecoder: { decodeAnim: async (request: { op: string; clip?: string }) =>
      request.op === "index" ? { ok: true, extractedSha256: "", index: { rig: null, clips: [{ name: "ui_closeup_shot", buffer: "simd", duration, animationType: "AdditiveFromRefPose" }] } }
        : (decodes++, { ok: true, extractedSha256: "", clip: { name: request.clip, duration, animationType: "AdditiveFromRefPose", constTrackKeys: [],
          trackKeys: [{ track: JAW, time: 0, value: 0 }, { track: JAW, time: duration, value: 1 }] } }) } } };
    const face = compiled();
    const host = new IdleHost({ route: () => route, fingerprint: () => "fp", resolverCache: join(root, "cache"),
      open: () => { if (opens++ < (options.failOpens ?? 0)) throw Error("The archive was busy."); return installation as never; },
      faces: options.faces ?? (async () => ({ rig: face, identity: "face-1", skeleton: "s", setup: "u", installation: null })) });
    const key = (host as unknown as { key(): string }).key();
    mkdirSync(join(root, "cache", "idles", key), { recursive: true });
    writeFileSync(join(root, "cache", "idles", key, "idles.json"), JSON.stringify({ version: IDLE_HOST_VERSION, idles: { entries, left: [],
      durations: Object.fromEntries(durations), source, rig: { path: "r", joints }, face: { path: "f", joints }, clips: {} } }));
    return { host, archive, decodes: () => decodes, opens: () => opens };
  }
  const faceOf = (state: IdleState, id: string) => state.phase === "ready" ? state.catalogue.idles.find(entry => entry.id === id)?.face ?? null : undefined;

  test("a face record: every frame at 30 Hz solved on the compiled face, cached by what it was solved from, read again when the face set's archive changes (PREV-175)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idle-face-"));
    try {
      const first = world(root);
      expect(faceOf(await first.host.state(), "closeup")).toEqual({ clip: "ui_closeup_shot", file: "ui_closeup_shot.face" });
      const record = await first.host.face("closeup");
      expect(record?.schema).toBe(FACE_MOTION_SCHEMA);
      expect(record?.clip.name).toBe("ui_closeup_shot_face");
      expect(record?.clip.joints).toEqual(["jaw"]);
      const times = new Float32Array(Buffer.from(record!.clip.times, "base64").buffer.slice(0));
      const local = new Float32Array(Buffer.from(record!.clip.local, "base64").buffer.slice(0));
      expect(times.length).toBe(61);
      // The last frame: the jaw 1 cm down along REDengine Z, which glTF axes (x, z, −y) put in y.
      expect(local[60 * 7 + 1]).toBeCloseTo(-0.01, 6);
      expect(first.decodes()).toBe(1);
      // Another host on the same cache reads it from disk.
      const again = world(root);
      expect((await again.host.face("closeup"))?.clip.name).toBe("ui_closeup_shot_face");
      expect(again.decodes()).toBe(0);
      // The face set's archive updated in place: solved again, not served stale.
      writeFileSync(first.archive.id, "a newer face set");
      const updated = world(root);
      await updated.host.face("closeup");
      expect(updated.decodes()).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a face clip longer than the bake takes is refused before it is decoded (PREV-173)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idle-face-"));
    try {
      const { host, decodes } = world(root, { duration: 3600 });
      expect(await host.face("closeup")).toBeNull();
      expect(decodes()).toBe(0);
      expect(() => clipTimes(3600, 30)).toThrow("longer than XF Studio bakes");
      expect(() => clipTimes(Number.POSITIVE_INFINITY, 30)).toThrow(FacialSetupError);
      expect(clipTimes(MAX_BAKE_SECONDS, 30)).toHaveLength(MAX_BAKE_FRAMES);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("the state answers at once while the face is still being read, and says so until it is ready (PREV-174)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idle-face-"));
    try {
      let lend!: (value: FaceSource) => void;
      const lent = new Promise<FaceSource>(resolve => { lend = resolve; });
      const { host } = world(root, { faces: () => lent });
      const started = performance.now();
      const pending = await host.state();
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(pending.phase === "ready" && pending.source === "game" && [pending.facePending, pending.faceReason])
        .toEqual([true, "Reading V's face from your game files… It moves once it's ready."]);
      expect(faceOf(pending, "closeup")).toBeNull();
      lend({ rig: compiled(), identity: "face-1", skeleton: "s", setup: "u", installation: null });
      const ready = await host.state();
      expect(ready.phase === "ready" && ready.source === "game" && [ready.facePending, ready.faceReason]).toEqual([undefined, undefined]);
      expect(faceOf(ready, "closeup")?.clip).toBe("ui_closeup_shot");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a face set that couldn't be listed is asked for again, not kept for the installation (PREV-176)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idle-face-"));
    try {
      const { host, opens } = world(root, { failOpens: 1 });
      const failed = await host.state();
      expect(failed.phase === "ready" && failed.source === "game" && failed.faceReason).toBe("V's face holds still during the idle: XF Studio couldn't read it from your game files.");
      const later = await host.state();
      expect(opens()).toBe(2);
      expect(faceOf(later, "closeup")?.clip).toBe("ui_closeup_shot");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("the page plays the body at once and asks again for a face still being read, taking it when it's ready (PREV-174)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-idle-face-"));
    const fetched = globalThis.fetch;
    try {
      let lend!: (value: FaceSource) => void;
      const lent = new Promise<FaceSource>(resolve => { lend = resolve; });
      const { host } = world(root, { faces: () => lent });
      const handler = createIdleHandler(host), asked: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(String(input), "http://127.0.0.1:4485");
        asked.push(url.search);
        return handler(new Request(url));
      }) as typeof fetch;
      const source = await loadIdleSource({ pollMs: 5 });
      expect([source.facePending, source.faceReason]).toEqual([true, "Reading V's face from your game files… It moves once it's ready."]);
      expect(source.first.face).toBeNull();
      expect(source.faceRest).not.toBeNull();
      const face = source.face(source.first);
      await new Promise(resolve => setTimeout(resolve, 30));
      // Still being read: the page asked for the state again, never for a face it doesn't know yet.
      expect(asked.filter(search => search === "").length).toBeGreaterThan(1);
      expect(asked.some(search => search.startsWith("?face="))).toBe(false);
      lend({ rig: compiled(), identity: "face-1", skeleton: "s", setup: "u", installation: null });
      const played = await face;
      expect(played?.clip.name).toBe("ui_closeup_shot_face");
      expect(played?.scene.getObjectByName("jaw")).toBeDefined();
      expect([source.facePending, source.faceReason]).toEqual([false, undefined]);
      expect(source.catalogue.idles.find(entry => entry.id === "closeup")?.face?.clip).toBe("ui_closeup_shot");
    } finally { globalThis.fetch = fetched; rmSync(root, { recursive: true, force: true }); }
  });
});
