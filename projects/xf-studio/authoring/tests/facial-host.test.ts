/**
 * The facial host (facial-host.ts; design §3.2, §3.3, §5.2) over a synthetic installation: the rig, setup and blink are read from the
 * winning archives, the start points come from the winning expression table and the photo-mode face rig's sets (a mod's table wins
 * by precedence, no mod named), solves go to a fake warm solver newest first, and the solver is located without a developer path.
 * No game data, no Python: the solver process is a fake (CI runs on Linux).
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFacialHandler, FacialHost, locateFacialSolver, SOLVER_MISSING, type FacialExtractor, type FacialSolverProcess } from "../src/facial-host";
import { EXPRESSION_TABLE, FACE_SETUP, FACE_SKELETON, FACIAL_ADDITIVES, PHOTO_MODE_FACE_RIG } from "../src/facial-catalogue";
import { depotHash } from "../src/depot-path";
import type { Installation } from "../src/resolver-host";
import { cn, cr2w, fixtureInstallation, handle, rh } from "./resolver-fixtures";

const SET = "base\\animations\\ui\\photomode\\test_faces.anims";
const MAIN = ["eye_l_blink", "eye_r_blink", "lips_l_corner_up", "lips_r_corner_up", "jaw_mid_open"];
const TRACKS = ["faceEnvelope", ...MAIN, "x_AnimOverrideWeight"];
const skeleton = cr2w({ $type: "animRig", boneNames: [cn("root"), cn("jaw")], boneParentIndexes: [-1, 0],
  boneTransforms: [{ Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: 0, Z: 1.6, W: 1 }, Scale: { X: 1, Y: 1, Z: 1, W: 1 } },
    { Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: -0.02, Z: -0.05, W: 0 }, Scale: { X: 1, Y: 1, Z: 1, W: 1 } }],
  trackNames: TRACKS.map(cn), referenceTracks: TRACKS.map((_, i) => i === 0 || i === TRACKS.length - 1 ? 1 : 0) });
const setup = cr2w({ $type: "animFacialSetup", info: { tracksMapping: { numEnvelopes: 1, numMainPoses: MAIN.length, numLipsyncOverrides: 1, numWrinkles: 0 } } });
/** An animation set whose clips hold float keys only: [name, type, duration, keyed [time, track, value][], constant [track, value][]]. */
function animSet(clips: [string, string, number, [number, number, number][], [number, number][]][]) {
  const chunks: number[] = [], entries: object[] = [];
  for (const [name, type, duration, keyed, constant] of clips) {
    const start = chunks.length, bytes = new Uint8Array((keyed.length + constant.length) * 8), view = new DataView(bytes.buffer);
    let at = 0;
    for (const [time, track, value] of keyed) { view.setUint16(at, Math.round(time / duration * 65535), true); view.setUint16(at + 2, track, true); view.setFloat32(at + 4, value, true); at += 8; }
    for (const [track, value] of constant) { view.setUint16(at, track, true); view.setFloat32(at + 4, value, true); at += 8; }
    chunks.push(...bytes);
    entries.push(handle({ $type: "animAnimSetEntry", animation: handle({ $type: "animAnimation", name: cn(name), animationType: type, duration,
      animBuffer: handle({ $type: "animAnimationBufferCompressed", duration, numFrames: 2, numAnimKeys: 0, numAnimKeysRaw: 0, numConstAnimKeys: 0,
        numTrackKeys: keyed.length, numConstTrackKeys: constant.length, dataAddress: { unkIndex: 0, fsetInBytes: start, zeInBytes: bytes.length } }) }) }));
  }
  return cr2w({ $type: "animAnimSet", animations: entries, animationDataChunks: [{ buffer: { BufferId: "0", Flags: 0, Bytes: btoa(String.fromCharCode(...chunks)) } }] });
}
const additives = animSet([["additive__blink_normal__01", "AdditiveFromRefPose", 0.5, [[0, 1, 0], [0.1, 1, 1], [0.5, 1, 0], [0, 2, 0], [0.1, 2, 1], [0.5, 2, 0]], []]]);
const faces = animSet([["facial_happy", "AdditiveFromRefPose", 0.033, [], [[3, 0.5], [4, 0.45]]], ["facial_grin", "AdditiveFromRefPose", 0.033, [], [[5, 0.3]]]]);
const table = (rows: [number, string][]) => cr2w({ $type: "C2dArray", compiledHeaders: ["Index", "AnimationName", "streamingContext", "FallbackAnimationName"],
  compiledData: rows.map(([index, name]) => [String(index), name, "photomode", name]) });
const rig = cr2w({ $type: "appearanceAppearanceResource", appearances: [handle({ $type: "appearanceAppearanceDefinition", name: cn("h0_000_pwa__basehead__face_rig"),
  compiledData: { BufferId: "0", Flags: 0, Data: { Version: 4, Sections: 7, CruidIndex: -1, CruidDict: {}, Chunks: [
    { $type: "entAnimationSetupExtensionComponent", name: cn("PhotomodeAnimations"), animations: { $type: "animAnimSetup", cinematics: [],
      gameplay: [{ $type: "animAnimSetupEntry", animSet: rh(depotHash(SET)), priority: 128, variableNames: [] }] } }] } } })] });

function world(root: string) {
  const fixture = fixtureInstallation([
    { virtualPath: "archive/pc/content/basegame_4_animation.archive", files: { [FACE_SKELETON]: {}, [FACE_SETUP]: {}, [FACIAL_ADDITIVES]: {}, [SET]: {},
      [EXPRESSION_TABLE]: table([[0, "facial_happy"]]), [PHOTO_MODE_FACE_RIG]: rig } },
    // An expression mod's table wins the path (precedence), with an extra row.
    { virtualPath: "archive/pc/mod/zz_faces.archive", provider: "manual", providerName: "Some expression pack",
      files: { [EXPRESSION_TABLE]: table([[0, "facial_happy"], [1, "facial_grin"], [2, "facial_missing"]]) } },
  ]);
  const documents = new Map<string, unknown>([[depotHash(FACE_SKELETON), skeleton], [depotHash(FACE_SETUP), setup], [depotHash(FACIAL_ADDITIVES), additives], [depotHash(SET), faces]]);
  let extractions = 0;
  const extract: FacialExtractor = async (_cli, _archive, resources, _dir, take) => {
    extractions++;
    for (const resource of resources) { const document = documents.get(resource.hash); if (document) take(resource.hash, JSON.stringify(document)); }
  };
  const solves: { frames: number; resolve(value: { q: string; t: string; ms: number }): void }[] = [];
  const process: FacialSolverProcess = { ready: Promise.resolve({ ok: true, compileMs: 12 }), exited: false, dispose: () => {},
    solve: frames => new Promise(resolve => solves.push({ frames: frames.length, resolve })) };
  const cli = join(root, "wk.exe"); writeFileSync(cli, "fake");
  const host = new FacialHost({ cacheRoot: root, resolverCache: join(root, "resolver"),
    settings: () => ({ gameRoot: root, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli }),
    solver: () => ({ addon: "addon", python: "python", script: "server.py" }),
    open: () => ({ ...fixture, fetcher: fixture.graph.port }) as unknown as Installation, extract, spawn: () => process });
  return { host, solves, extractions: () => extractions };
}
const zeros = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n * 4)));

test("the face rig, blink and installed expressions come from the winning files; the table's winner is followed", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const { host, extractions } = world(root);
    expect(host.state()).toMatchObject({ rig: { phase: "preparing" }, expressions: { phase: "preparing" } });
    await host.settled(); await Promise.resolve();
    const state = host.state();
    expect(state.rig).toMatchObject({ phase: "ready", main: { start: 1, count: MAIN.length } });
    expect(state.rig.controls!.map(control => control.name)).toEqual(MAIN);
    expect(state.rig.joints![0]).toMatchObject({ name: "root", t: [0, 1.6, -0] });
    expect(state.blink).toEqual({ available: true, closedTime: expect.closeTo(0.1, 3), duration: 0.5, rate: 60 });
    expect(state.solver).toEqual({ phase: "ready", compileMs: 12 });
    const points = host.expressions();
    expect(points.table).toEqual({ provider: "Some expression pack", rows: 3 });
    expect(points.items.map(item => [item.row, item.label, item.provider, item.controls])).toEqual([
      [0, "Happy", "Base game", { lips_l_corner_up: Math.fround(0.5), lips_r_corner_up: Math.fround(0.45) }],
      [1, "Grin", "Base game", { jaw_mid_open: Math.fround(0.3) }]]);
    expect(points.missing).toEqual(["facial_missing"]);
    // A second host on the same cache reads everything from it: no extraction.
    const again = world(root);
    again.host.state(); await again.host.settled();
    expect(again.extractions()).toBe(0);
    expect(again.host.expressions().items.length).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("solves run one at a time, newest first: a request still waiting is answered superseded; the blink composes before the solve", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const { host, solves } = world(root);
    host.state(); await host.settled(); await Promise.resolve();
    const first = host.solve({ controls: { jaw_mid_open: 0.1 } });
    const second = host.solve({ controls: { jaw_mid_open: 0.2 } });
    const third = host.solve({ controls: { jaw_mid_open: 0.3 }, blink: { play: true } });
    expect(await second).toMatchObject({ ok: false, code: "superseded" });
    await Promise.resolve();
    solves[0]!.resolve({ q: zeros(8), t: zeros(6), ms: 0.5 });
    expect(await first).toMatchObject({ ok: true, frames: 1, ms: 0.5, skipped: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    // Play blink: the game's clip at 60 Hz over its 0.5 s, the expression added to every frame.
    expect(solves[1]!.frames).toBe(31);
    solves[1]!.resolve({ q: zeros(8 * 31), t: zeros(6 * 31), ms: 3 });
    expect(await third).toMatchObject({ ok: true, frames: 31, rate: 60 });
    expect(await host.solve({ controls: { jaw_mid_open: 3 } })).toMatchObject({ ok: false, code: "invalid" });
    // The endpoint answers the local studio only.
    const handler = createFacialHandler(host);
    expect((await handler(new Request("http://127.0.0.1:1/api/facial"))).status).toBe(200);
    expect((await handler(new Request("http://evil.test/api/facial"))).status).toBe(403);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("without a game folder the host says so plainly; the solver is found only where it is put, never at a developer path", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const host = new FacialHost({ cacheRoot: root, resolverCache: root, solver: () => ({ missing: SOLVER_MISSING }),
      settings: () => ({ gameRoot: null, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null }) });
    host.state(); await host.settled();
    expect(host.state()).toMatchObject({ rig: { phase: "unconfigured", reason: expect.stringContaining("in Settings") }, solver: { phase: "missing" } });
  } finally { rmSync(root, { recursive: true, force: true }); }
  const has = (paths: string[]) => (path: string) => paths.some(entry => path.replaceAll("\\", "/").startsWith(entry));
  const solverFile = "i_scene_cp77_gltf/animation/facial/solver.py";
  expect(locateFacialSolver({ env: { XFS_FACIAL_SOLVER: "/src/addon", XFS_PYTHON: "/py" }, script: "/s.py", exists: has([`/src/addon/${solverFile}`, "/s.py"]) }))
    .toEqual({ addon: "/src/addon", python: "/py", script: "/s.py" });
  // The desktop: no environment, no repository, no Python: missing, in plain words.
  expect(locateFacialSolver({ toolsRoot: "/data/tools", script: "/s.py", exists: () => true })).toEqual({ missing: SOLVER_MISSING });
  expect(locateFacialSolver({ toolsRoot: "/data/tools", script: "/s.py", pythonDefault: "python", exists: () => false })).toEqual({ missing: SOLVER_MISSING });
});
