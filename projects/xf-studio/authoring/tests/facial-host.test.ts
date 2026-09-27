/**
 * The facial host (facial-host.ts; design §3.2, §3.3, §5.2) over a synthetic installation: the rig, setup and blink are read from the
 * winning archives, the start points come from the winning expression table and the photo-mode face rig's sets (a mod's table wins
 * by precedence, no mod named), solves go to a fake warm solver newest first, and the solver is located without a developer path.
 * No game data, no Python: the solver process is a fake (CI runs on Linux).
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFacialHandler, FacialHost, locateFacialSolver, MAX_RESTARTS, RESTART_WINDOW_MS, SOLVER_MISSING, SOLVER_NOT_SET_UP, spawnFacialSolver, type FacialExtractor,
  type FacialSolverProcess, type FacialSolverSpawner } from "../src/facial-host";
import { EXPRESSION_TABLE, FACE_SETUP, FACE_SKELETON, FACIAL_ADDITIVES, PHOTO_MODE_FACE_RIG } from "../src/facial-catalogue";
import { depotHash } from "../src/depot-path";
import type { Installation } from "../src/resolver-host";
import { cn, cr2w, fixtureInstallation, handle, rh } from "./resolver-fixtures";

const SET = "base\\animations\\ui\\photomode\\test_faces.anims";
const MAIN = ["eye_l_blink", "eye_r_blink", "lips_l_corner_up", "lips_r_corner_up", "jaw_mid_open", "lips_tighten_up"];
const TRACKS = ["faceEnvelope", ...MAIN, "x_AnimOverrideWeight"];
const skeleton = cr2w({ $type: "animRig", boneNames: [cn("root"), cn("jaw")], boneParentIndexes: [-1, 0],
  boneTransforms: [{ Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: 0, Z: 1.6, W: 1 }, Scale: { X: 1, Y: 1, Z: 1, W: 1 } },
    { Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: -0.02, Z: -0.05, W: 0 }, Scale: { X: 1, Y: 1, Z: 1, W: 1 } }],
  trackNames: TRACKS.map(cn), referenceTracks: TRACKS.map((_, i) => i === 0 || i === TRACKS.length - 1 ? 1 : 0) });
// Its one wrinkle output reads lips_l_corner_up (track 3).
const setup = cr2w({ $type: "animFacialSetup", info: { tracksMapping: { numEnvelopes: 1, numMainPoses: MAIN.length, numLipsyncOverrides: 1, numWrinkles: 1 } },
  bakedData: { Data: { Face: { Wrinkles: [3] }, Eyes: { Wrinkles: [3] }, Tongue: { Wrinkles: [3] } } } });
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

type WorldOptions = { spawn?: FacialSolverSpawner; solveTimeoutMs?: number; now?: () => number; jsonBudget?: number;
  /** A mod archive that also provides the animation set, with these faces. */
  setOverride?: object };
function world(root: string, options: WorldOptions = {}) {
  const fixture = fixtureInstallation([
    { virtualPath: "archive/pc/content/basegame_4_animation.archive", files: { [FACE_SKELETON]: {}, [FACE_SETUP]: {}, [FACIAL_ADDITIVES]: {}, [SET]: {},
      [EXPRESSION_TABLE]: table([[0, "facial_happy"]]), [PHOTO_MODE_FACE_RIG]: rig } },
    // An expression mod's table wins the path (precedence), with an extra row.
    { virtualPath: "archive/pc/mod/zz_faces.archive", provider: "manual", providerName: "Some expression pack",
      files: { [EXPRESSION_TABLE]: table([[0, "facial_happy"], [1, "facial_grin"], [2, "facial_missing"]]) } },
    ...(options.setOverride ? [{ virtualPath: "archive/pc/mod/zzz_set.archive", provider: "manual" as const, providerName: "Set update", files: { [SET]: {} } }] : []),
  ]);
  const documents = new Map<string, unknown>([[depotHash(FACE_SKELETON), skeleton], [depotHash(FACE_SETUP), setup], [depotHash(FACIAL_ADDITIVES), additives],
    [depotHash(SET), options.setOverride ?? faces]]);
  let extractions = 0;
  const extract: FacialExtractor = async (_cli, _archive, resources, _dir, take) => {
    extractions++;
    for (const resource of resources) { const document = documents.get(resource.hash); if (document) take(resource.hash, JSON.stringify(document)); }
  };
  const solves: { frames: number; resolve(value: { q: string; t: string; ms: number }): void }[] = [];
  let probed = false;
  const process: FacialSolverProcess = { ready: Promise.resolve({ ok: true, compileMs: 12 }), exited: false, dispose: () => {},
    solve: frames => {
      // The first solve is the host's check for controls that move nothing (`findInert`): a toy face answers it at once.
      if (!probed) { probed = true; return Promise.resolve(toyFace(frames)); }
      return new Promise(resolve => solves.push({ frames: frames.length, resolve }));
    } };
  const cli = join(root, "wk.exe"); writeFileSync(cli, "fake");
  const host = new FacialHost({ cacheRoot: root, resolverCache: join(root, "resolver"),
    settings: () => ({ gameRoot: root, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli }),
    solver: () => ({ addon: "addon", python: "python", script: "server.py" }),
    open: () => ({ ...fixture, fetcher: fixture.graph.port }) as unknown as Installation, extract, spawn: options.spawn ?? (() => process),
    solveTimeoutMs: options.solveTimeoutMs, now: options.now, jsonBudget: options.jsonBudget });
  return { host, solves, extractions: () => extractions };
}
const zeros = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n * 4)));
/**
 * A toy face for the inert check: the jaw joint moves sideways with either blink, down with the jaw, and forward with the right mouth
 * corner only while the jaw is open (a control that acts only with another). The left corner and lips_tighten_up move no joint; the left
 * corner feeds the setup's wrinkle output, so only lips_tighten_up is inert.
 */
function toyFace(frames: readonly Float32Array[]) {
  const t = new Float32Array(frames.length * 6);
  frames.forEach((f, i) => { t[i * 6 + 3] = f[1]! + f[2]!; t[i * 6 + 4] = f[5]!; t[i * 6 + 5] = f[4]! * f[5]!; });
  const q = new Float32Array(frames.length * 8);
  for (let i = 0; i < frames.length * 2; i++) q[i * 4 + 3] = 1;
  const b64 = (a: Float32Array) => Buffer.from(a.buffer).toString("base64");
  return { q: b64(q), t: b64(t), ms: 1 };
}

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
    // Checked by the solver before it is ready: a control that acts only with another, or feeds a wrinkle output, is not inert.
    expect(state.rig.inert).toEqual(["lips_tighten_up"]);
    // No proposed opposites on this toy face: no two-way controls, and no gaze to check.
    expect([state.rig.axes, state.rig.gazeSameWay]).toEqual([[], null]);
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

// ---- Solver lifetime and bounds (review at 9f71a56: CORE-99..106) ----

/** A fake solver process the test drives: its solves wait until answered, it can stop (a crash), and records being disposed. */
function fakeProcess(options: { ready?: boolean; hang?: boolean } = {}) {
  const solves: { resolve(value: { q: string; t: string; ms: number }): void; reject(error: Error): void }[] = [];
  let exited = false, disposed = false;
  const process: FacialSolverProcess = {
    ready: Promise.resolve(options.ready === false ? { ok: false as const, error: "no" } : { ok: true as const, compileMs: 1 }),
    get exited() { return exited; },
    dispose: () => { disposed = true; exited = true; for (const solve of solves.splice(0)) solve.reject(Error("The solver stopped.")); },
    // The inert check (many frames at once) is answered by the toy face; `hang` applies to the solves after it.
    solve: frames => exited ? Promise.reject(Error("The solver stopped.")) : frames.length > 1 ? Promise.resolve(toyFace(frames)) : new Promise((resolve, reject) => {
      if (options.hang) { solves.push({ resolve, reject }); return; }
      resolve({ q: zeros(8), t: zeros(6), ms: 1 });
    }),
  };
  return { process, crash: () => { exited = true; for (const solve of solves.splice(0)) solve.reject(Error("The solver stopped.")); }, disposed: () => disposed };
}
const ready = async (host: FacialHost) => { host.state(); await host.settled(); await new Promise(resolve => setTimeout(resolve, 0)); };

test("a solver program that can't be started says plainly that it isn't set up, and the installed expressions still load (CORE-99)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const { host } = world(root, { spawn: () => { throw Error("ENOENT: python"); } });
    await ready(host);
    const state = host.state();
    expect(state.solver).toEqual({ phase: "missing", reason: SOLVER_NOT_SET_UP });
    expect(state.expressions.phase).toBe("ready");
    expect(host.expressions().items.length).toBe(2);
    expect(await host.solve({ controls: { jaw_mid_open: 0.1 } })).toMatchObject({ ok: false, code: "unavailable", message: SOLVER_NOT_SET_UP });
    // The real spawner with no such program: refused at once or failing to start, never "starting" forever.
    let outcome: string;
    try {
      const started = spawnFacialSolver({ addon: root, python: join(root, "no-such-python"), script: join(root, "server.py") }, "rig.json", "setup.json");
      outcome = (await started.ready).ok ? "ready" : "failed";
    } catch { outcome = "thrown"; }
    expect(["thrown", "failed"]).toContain(outcome);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a solve that doesn't come back in time fails plainly, and the solver is started again for the next solve (CORE-100)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const processes = [fakeProcess({ hang: true }), fakeProcess()];
    let spawned = 0;
    const { host } = world(root, { spawn: () => processes[spawned++]!.process, solveTimeoutMs: 30 });
    await ready(host);
    expect(await host.solve({ controls: { jaw_mid_open: 0.1 } })).toMatchObject({ ok: false, code: "failed", message: expect.stringContaining("took too long") });
    expect(processes[0]!.disposed()).toBe(true);
    // Every later solve isn't blocked: the next one starts a new solver and is answered.
    expect(await host.solve({ controls: { jaw_mid_open: 0.2 } })).toMatchObject({ ok: true, frames: 1 });
    expect(spawned).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a crashed solver is started again within a budget that refills; past it the state says so instead of ready (CORE-101)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    let clock = 1_000_000, spawned = 0;
    const made: ReturnType<typeof fakeProcess>[] = [];
    const { host } = world(root, { now: () => clock, spawn: () => { spawned++; const next = fakeProcess(); made.push(next); return next.process; } });
    await ready(host);
    for (let i = 0; i < MAX_RESTARTS; i++) {
      made.at(-1)!.crash();
      expect(await host.solve({ controls: { jaw_mid_open: 0.1 } })).toMatchObject({ ok: true });
    }
    expect(spawned).toBe(1 + MAX_RESTARTS);
    made.at(-1)!.crash();
    // The budget is spent: the state no longer reports ready for a stopped process.
    expect(host.state().solver).toMatchObject({ phase: "failed", reason: expect.stringContaining("stopped several times") });
    expect(await host.solve({ controls: { jaw_mid_open: 0.1 } })).toMatchObject({ ok: false, code: "unavailable" });
    // Old restarts age out: the next question starts it again.
    clock += RESTART_WINDOW_MS + 1
    const st = host.state();
    expect(st.solver.phase).toBe("starting");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.state().solver.phase).toBe("ready");
    expect(spawned).toBe(2 + MAX_RESTARTS);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pages take turns: a newer pose replaces only the same page's waiting one (CORE-104)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const { host, solves } = world(root);
    await ready(host);
    const running = host.solve({ controls: { jaw_mid_open: 0.1 }, client: "page-a" });
    const a1 = host.solve({ controls: { jaw_mid_open: 0.2 }, client: "page-a" });
    const b1 = host.solve({ controls: { jaw_mid_open: 0.3 }, client: "page-b" });
    const a2 = host.solve({ controls: { jaw_mid_open: 0.4 }, client: "page-a" });
    expect(await a1).toMatchObject({ ok: false, code: "superseded" });
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      solves[i]!.resolve({ q: zeros(8), t: zeros(6), ms: 1 });
    }
    expect(await running).toMatchObject({ ok: true });
    expect(await b1).toMatchObject({ ok: true });
    expect(await a2).toMatchObject({ ok: true });
    expect(await host.solve({ controls: {}, client: "bad page!" })).toMatchObject({ ok: false, code: "invalid" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the solve endpoint reads its body within the limit and refuses JSON that isn't a pose (CORE-106)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const { host } = world(root);
    await ready(host);
    const handler = createFacialHandler(host);
    const post = (body: string, headers: Record<string, string> = {}) => handler(new Request("http://127.0.0.1:1/api/facial/solve",
      { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }));
    expect((await post("null")).status).toBe(400);
    expect((await post("[1]")).status).toBe(400);
    expect((await post("{}", { "Content-Length": "999999" })).status).toBe(413);
    expect((await post(JSON.stringify({ controls: { jaw_mid_open: "x".repeat(70_000) } }))).status).toBe(413);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the facial cache is bounded, counted and cleared with the prepared game files, and crash leftovers are swept (CORE-102)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    // A temporary folder a host left mid-extraction two hours ago, and an old animation set nobody uses.
    const leftover = join(root, "facial", "tmp", "facial-1-old");
    mkdirSync(leftover, { recursive: true });
    const old = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(leftover, old, old);
    mkdirSync(join(root, "facial", "json"), { recursive: true });
    const unused = join(root, "facial", "json", "unused.json");
    writeFileSync(unused, "x".repeat(4000));
    utimesSync(unused, old, old);
    const { host } = world(root, { jsonBudget: 3000 });
    await ready(host);
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(unused)).toBe(false);
    // The face's own files are kept whatever the budget.
    expect(readdirSync(join(root, "facial", "json")).length).toBeGreaterThanOrEqual(2);
    expect(await host.preparedBytes()).toBeGreaterThan(0);
    const cleared = await host.clearPrepared();
    expect(cleared.freed).toBeGreaterThan(0);
    expect(existsSync(join(root, "facial", "json"))).toBe(false);
    expect(existsSync(join(root, "facial", "start-points"))).toBe(false);
    // Forgotten: the next question prepares the face again from the game files.
    await ready(host);
    expect(host.state().rig.phase).toBe("ready");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("start points are read again when an animation set's archive changes, not served from an older installation's cache (CORE-103)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    const first = world(root);
    await ready(first.host);
    expect(first.host.expressions().items.find(item => item.clip === "facial_grin")?.controls).toEqual({ jaw_mid_open: Math.fround(0.3) });
    // A mod now provides the set with a changed clip: the same table and face rig, a different set.
    const updated = animSet([["facial_happy", "AdditiveFromRefPose", 0.033, [], [[3, 0.5]]], ["facial_grin", "AdditiveFromRefPose", 0.033, [], [[5, 0.9]]]]);
    const second = world(root, { setOverride: updated });
    await ready(second.host);
    expect(second.host.expressions().items.find(item => item.clip === "facial_grin")?.controls).toEqual({ jaw_mid_open: Math.fround(0.9) });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the real protocol over a process's pipes: split and joined lines, a printed warning, a lost answer, and a crash mid-request (CORE-100)", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-facial-"));
  try {
    // Any program that speaks the protocol: Bun itself runs a stand-in for the Python server, so the test needs no Python.
    const script = join(root, "solver.js");
    writeFileSync(script, `
      const out = text => process.stdout.write(text);
      out("a module printed this\\n");
      out('{"ready": true, "jo'); setTimeout(() => out('ints": 2, "tracks": 7, "compileMs": 5}\\n'), 20);
      let buffer = "";
      process.stdin.on("data", chunk => {
        buffer += chunk;
        for (let at = buffer.indexOf("\\n"); at >= 0; at = buffer.indexOf("\\n")) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          const request = JSON.parse(line), first = request.frames[0][0];
          if (first === 99) { out("Traceback: not json\\n"); continue; }
          if (first === 98) process.exit(3);
          const answer = JSON.stringify({ id: request.id, ms: 0.5, q: "AAAAAAAAAAAAAAAAAAAAAA==", t: "AAAAAAAAAAAAAAAA" });
          // Framing in odd pieces: half a line, then the rest with a blank line (the pipe may join or split them further).
          out(answer.slice(0, 10)); out(answer.slice(10) + "\\n\\n");
        }
      });
    `);
    const logged: string[] = [];
    const solver = spawnFacialSolver({ addon: root, python: process.execPath, script }, "rig.json", "setup.json", { log: message => logged.push(message) });
    expect(await solver.ready).toEqual({ ok: true, compileMs: 5 });
    expect(logged.some(line => line.includes("a module printed this"))).toBe(true);
    const frame = (value: number) => [new Float32Array([value, 0, 0, 0, 0, 0, 0])];
    // Settled outcomes (a rejection read as its message), so a regression fails fast instead of hanging the test.
    const outcome = (work: Promise<unknown>) => Promise.race([work.then(value => ({ value }), error => ({ error: String(error) })),
      Bun.sleep(5000).then(() => ({ error: "no answer" }))]);
    const [a, b] = await Promise.all([outcome(solver.solve(frame(0.1))), outcome(solver.solve(frame(0.2)))]);
    expect(a).toEqual({ value: { q: "AAAAAAAAAAAAAAAAAAAAAA==", t: "AAAAAAAAAAAAAAAA", ms: 0.5 } });
    expect(b).toMatchObject({ value: { ms: 0.5 } });
    // A line that isn't an answer fails the request waiting for it instead of leaving it forever.
    expect(await outcome(solver.solve(frame(99)))).toEqual({ error: expect.stringContaining("couldn't be read") });
    expect(logged.some(line => line.includes("Traceback"))).toBe(true);
    // A crash mid-request answers the request and marks the process stopped.
    expect(await outcome(solver.solve(frame(98)))).toEqual({ error: expect.stringContaining("stopped") });
    expect(solver.exited).toBe(true);
    expect(await outcome(solver.solve(frame(0.3)))).toEqual({ error: expect.stringContaining("stopped") });
    solver.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
