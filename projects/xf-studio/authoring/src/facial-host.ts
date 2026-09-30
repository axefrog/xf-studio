/**
 * Host service for the live facial preview (research/animation/expression-editor-design.md §5.2; both hosts share it). It reads the
 * player's face skeleton, facial setup and the game's normal blink from the winning files on the launch route (the same resolver Build
 * and the character details use) with XF Studio's own reader (WolvenKit per resource where the reader can't), finds the installed
 * photo-mode expressions the way the game finds them (the winning expression table, clips by name among V's photo-mode face rig's
 * animation sets, ArchiveXL patches of that rig included), and answers solve requests, newest first, with XF Studio's own facial solver
 * (engines/facial-rig/solver.ts) in this process. It also bakes the game's blink for the preview (`blink`) and lends the compiled face to
 * the idle host for the idle's face (`faceSource`).
 *
 * The pinned IO Suite solver (the Cyberpunk Blender add-on's, GPL-3.0, run as its own program through `tools/facial_solver_server.py`)
 * remains a developer's parity oracle only: localhost with XFS_FACIAL_SOLVER_ORACLE=1. None of its code is in XF Studio.
 *
 * Game-derived data stays in the host's private cache (`facial/`): the resolver's JSON of the rig and setup, the decoded start points.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { MountedArchive } from "./archive-precedence";
import { installationFingerprint, type CharacterDetailSettings } from "./character-detail-host";
import { writeFileAtomic } from "./derived-cache";
import { depotHash, refFromHash, refFromPath, type DepotRef } from "./depot-path";
import { installations, InstallationRegistry } from "./installation-registry";
import { BodyTooLargeError, readBodyText } from "./request-body";
import type { Installation, InstallationOptions } from "./resolver-host";
import { runWolvenKit, wolvenKitIdentity, wolvenKitIdentityKey, WolvenKitRunError } from "./wolvenkit-cli";
import { hostFailure, hostTrace } from "./diagnostics/host-log";
import { IDLE_FACE_MISSING } from "./game-blink-messages";
import { bakeClips, bakedRest, clipFrame, eyeShapeSeats, type BakedFrames, type BakedRest } from "./engines/facial-rig/bake";
import { compileFacialRig, createFacialPose, solveFace, type CompiledFacialRig } from "./engines/facial-rig/solver";
import { morphBinds, nativeClip, nativeDocument, nativeSetClips } from "./facial-native";
import { EXPRESSION_SAMPLES } from "./expression-samples";
import { BLINK_CLIP, EXPRESSION_TABLE, EYE_MORPHS, FACE_MORPHS, FACE_SETUP, FACE_SKELETON, FACIAL_ADDITIVES, PHOTO_MODE_FACE_RIG, readAnimSet, readBlink,
  eyeTracks, faceSetupPath, readFaceRig, readFaceRigSets, readFaceRigSetup, readTable, startPoints, wrinkleSourceTracks, type SetClip } from "./facial-catalogue";
import { findRelations } from "./engines/facial-rig/relations";
import { posedLocals, worldPositions, type Vec3 } from "./engines/facial-rig/pose";
import { clipValuesAt, type ClipTracks } from "./engines/facial-rig/anim-tracks";
import { denseTracks, vectorIssue } from "./engines/facial-rig/vector";
import { CONTROL_GROUPS, type FacialVocabulary } from "./engines/facial-rig/vocabulary";
import type { RigRest } from "./engines/facial-rig/pose";
import type { AxisPair } from "./engines/facial-rig/symmetry";
import { FACE_MOTION_SCHEMA, FACIAL_BLINK_ENDPOINT, FACIAL_ENDPOINT, FACIAL_EXPRESSIONS_ENDPOINT, FACIAL_SOLVE_ENDPOINT, FACIAL_STATE_SCHEMA, type FaceMotionClip,
  type FaceMotionRest, type FacialBlink, type FacialBlinkRecord, type FacialHostState, type FacialSolveAnswer, type FacialSolveRequest,
  type FacialStartPoints } from "./platform/api/facial";

export { FACIAL_BLINK_ENDPOINT, FACIAL_ENDPOINT, FACIAL_EXPRESSIONS_ENDPOINT, FACIAL_SOLVE_ENDPOINT } from "./platform/api/facial";

/** The IO Suite revision the bakes reviewed (tools/bake_idle_face.py `PIN`); the solver process refuses any other. */
export const FACIAL_SOLVER_PIN = "7a4ee793c36d9615946fe87ec9d42cde7568021d";
/** The blink clip is solved at this rate for Play blink over an expression. */
export const BLINK_RATE = 60;
/** Most bytes of one solve request's body. */
export const SOLVE_BODY_BYTES = 64_000;
/** Most frames one solve may ask for (the blink clip at 60 Hz is 31). */
export const MAX_SOLVE_FRAMES = 64;
/** Version of what the start-point cache holds; part of its key. */
export const START_POINT_VERSION = 3;
const STEP_TIMEOUT_MS = 3 * 60_000;

/**
 * Which solver answers: XF Studio's own in this process (`inProcess`, the default everywhere), or the pinned IO Suite checkout run by
 * Python as a developer's parity oracle (the add-on checkout, the Python that runs it and the server script); or why the asked-for oracle
 * isn't there, in plain words.
 */
export type FacialSolverLocation = { readonly inProcess: true } | { readonly addon: string; readonly python: string; readonly script: string } | { readonly missing: string };
export const IN_APP_SOLVER: FacialSolverLocation = Object.freeze({ inProcess: true });
/** A developer asked for the IO Suite oracle (XFS_FACIAL_SOLVER_ORACLE=1) and it isn't there. */
export const SOLVER_MISSING = "The facial solver oracle asked for (XFS_FACIAL_SOLVER_ORACLE) isn't set up on this computer, so the live face preview is off. Your expression still saves.";

/**
 * Which solver answers. XF Studio's own (`IN_APP_SOLVER`) unless a developer asks for the IO Suite oracle with XFS_FACIAL_SOLVER_ORACLE=1
 * (localhost only: the desktop passes no environment): then `XFS_FACIAL_SOLVER` (the add-on checkout), else XF Studio's tools folder
 * (`<tools>/io-suite/<pin>/`), else a checkout beside the repository (the developer layout the bakes use); Python is `XFS_PYTHON`, else
 * `python` on the path.
 */
export function locateFacialSolver(options: { env?: Readonly<Record<string, string | undefined>>; toolsRoot?: string | null;
  repoRoot?: string | null; script: string; pythonDefault?: string | null; exists?: (path: string) => boolean }): FacialSolverLocation {
  const exists = options.exists ?? existsSync, env = options.env ?? {};
  if (env.XFS_FACIAL_SOLVER_ORACLE !== "1") return IN_APP_SOLVER;
  const candidates = [env.XFS_FACIAL_SOLVER, options.toolsRoot ? join(options.toolsRoot, "io-suite", FACIAL_SOLVER_PIN) : null,
    options.repoRoot ? resolve(options.repoRoot, "..", "Cyberpunk-Blender-add-on") : null].filter((path): path is string => !!path);
  const addon = candidates.find(path => exists(join(path, "i_scene_cp77_gltf", "animation", "facial", "solver.py")));
  const python = env.XFS_PYTHON || options.pythonDefault || null;
  if (!addon || !python || !exists(options.script)) return { missing: SOLVER_MISSING };
  return { addon, python, script: options.script };
}

/** One warm solver: started with the rig and setup JSON, answering absolute track frames. Tests pass a fake. */
export interface FacialSolverProcess {
  /** Resolves once the solver compiled the setup (or failed to, with its plain error). */
  ready: Promise<{ ok: true; compileMs: number } | { ok: false; error: string }>;
  solve(frames: readonly Float32Array[]): Promise<{ q: string; t: string; ms: number }>;
  readonly exited: boolean;
  dispose(): void;
}
export type FacialSolverSpawner = (location: Exclude<FacialSolverLocation, { missing: string }>, rigJson: string, setupJson: string,
  options?: { log?: (message: string) => void; compiled?: CompiledFacialRig }) => FacialSolverProcess;

/** Most characters of a line the solver printed that a log entry quotes. */
const LOGGED_LINE_CHARS = 200;
/**
 * The default spawner: `python facial_solver_server.py`, one JSON line per request and answer. Throws when the program can't be started
 * at all (no Python): the host turns that into plain words (CORE-99). A line that isn't an answer (a warning a module printed) is logged;
 * after the ready line it fails the oldest request waiting, since the host sends one at a time and that answer is lost (CORE-100).
 */
export const spawnFacialSolver: FacialSolverSpawner = (location, rigJson, setupJson, options = {}) => {
  if ("inProcess" in location)
    return inAppSolver(options.compiled ?? (() => compileFacialRig(JSON.parse(readFileSync(rigJson, "utf8")), JSON.parse(readFileSync(setupJson, "utf8")))));
  const child = Bun.spawn([location.python, location.script, "--addon", location.addon, "--rig", rigJson, "--setup", setupJson],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true });
  return solverOverStreams(child, options.log);
};

/** Float32 values as the solver protocol's base64 (little-endian). */
const base64Of = (values: Float32Array) => Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");

/**
 * XF Studio's own solver behind the same protocol (engines/facial-rig/solver.ts): compiled once, one reused pose, answers at once. It never
 * stops by itself. A compile failure is its plain refusal.
 */
export function inAppSolver(source: CompiledFacialRig | (() => CompiledFacialRig)): FacialSolverProcess {
  let rig: CompiledFacialRig | null = null, disposed = false;
  const ready = Promise.resolve().then(() => {
    const started = performance.now();
    try { rig = typeof source === "function" ? source() : source; return { ok: true as const, compileMs: performance.now() - started }; }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
  });
  let scratch: ReturnType<typeof createFacialPose> | null = null;
  return {
    ready,
    get exited() { return disposed; },
    async solve(frames) {
      await ready;
      if (disposed || !rig) throw Error("The solver stopped.");
      const compiled: CompiledFacialRig = rig, pose = scratch ??= createFacialPose(compiled);
      const J = compiled.jointNames.length, q = new Float32Array(frames.length * J * 4), t = new Float32Array(frames.length * J * 3);
      const started = performance.now();
      frames.forEach((frame, f) => { solveFace(compiled, frame, pose); q.set(pose.rotations, f * J * 4); t.set(pose.translations, f * J * 3); });
      return { q: base64Of(q), t: base64Of(t), ms: Math.round((performance.now() - started) * 1000) / 1000 };
    },
    dispose() { disposed = true; },
  };
}

/** The solver protocol over a started process's pipes (the default spawner's; tests start any program that speaks it). */
export function solverOverStreams(child: { stdin: { write(text: string): unknown; flush(): unknown; end(): unknown }; stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>; kill(): void }, log: (message: string) => void = () => {}): FacialSolverProcess {
  const pending = new Map<number, { resolve(value: { q: string; t: string; ms: number }): void; reject(error: Error): void }>();
  let exited = false, nextId = 1, readyResolve!: (value: Awaited<FacialSolverProcess["ready"]>) => void;
  const ready = new Promise<Awaited<FacialSolverProcess["ready"]>>(done => { readyResolve = done; });
  let errors = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) errors = (errors + decoder.decode(chunk, { stream: true })).slice(-4000);
  })().catch(() => {});
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "", started = false;
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
        if (!line) continue;
        let message: Record<string, unknown> | null = null;
        try { const parsed: unknown = JSON.parse(line); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) message = parsed as Record<string, unknown>; }
        catch { /* Not an answer: below. */ }
        if (!message) {
          log(`Facial solver printed a line that isn't an answer: ${line.slice(0, LOGGED_LINE_CHARS)}`);
          if (!started) continue;
          // The host sends one request at a time, so the oldest waiting one lost its answer: it fails now instead of waiting forever.
          const [id, waiter] = pending.entries().next().value ?? [];
          if (waiter) { pending.delete(id!); waiter.reject(Error("The facial solver's answer couldn't be read.")); }
          continue;
        }
        if (!started) { started = true; readyResolve(message.ready === true ? { ok: true, compileMs: Number(message.compileMs) } : { ok: false, error: String(message.error ?? "The solver didn't start.") }); continue; }
        const waiter = pending.get(Number(message.id));
        if (!waiter) { log(`Facial solver answered a request nobody is waiting for (${String(message.id).slice(0, 32)}).`); continue; }
        pending.delete(Number(message.id));
        if (typeof message.error === "string") waiter.reject(Error(message.error));
        else waiter.resolve({ q: String(message.q), t: String(message.t), ms: Number(message.ms) });
      }
    }
  })().catch(() => {}).finally(() => {
    exited = true;
    readyResolve({ ok: false, error: errors.trim().split("\n").at(-1) || "The solver stopped." });
    for (const waiter of pending.values()) waiter.reject(Error("The solver stopped."));
    pending.clear();
  });
  return {
    ready,
    get exited() { return exited; },
    solve(frames) {
      if (exited) return Promise.reject(Error("The solver stopped."));
      const id = nextId++;
      return new Promise((resolveSolve, reject) => {
        pending.set(id, { resolve: resolveSolve, reject });
        try {
          child.stdin.write(JSON.stringify({ id, frames: frames.map(frame => Array.from(frame)) }) + "\n");
          child.stdin.flush();
        } catch (error) { pending.delete(id); reject(error instanceof Error ? error : Error(String(error))); }
      });
    },
    dispose() { try { child.stdin.end(); } catch { /* already closed */ } try { child.kill(); } catch { /* already gone */ } },
  };
}

/** One resource to extract: its depot hash, and its extension (WolvenKit's converter needs one on a file it wrote by hash). */
export type FacialResource = { readonly hash: string; readonly extension: string };
/**
 * Extract resources by hash from one archive as untrimmed WolvenKit JSON: `take(hash, text)` is called once per resource written, so
 * a caller keeps one document's text at a time (an expression pack's sets are tens of megabytes of JSON). Tests pass a fake.
 */
export type FacialExtractor = (cli: string, archive: MountedArchive, resources: readonly FacialResource[], workDir: string,
  take: (hash: string, text: string) => void, signal?: AbortSignal) => Promise<void>;

/**
 * The default extractor: `unbundle --hash` then `convert s`, as the resolver's second step does, reading each output's JSON (outputs
 * WolvenKit names by path are matched by that path's hash; ones it names by hash are given their extension first).
 */
export const extractFacialJson: FacialExtractor = async (cli, archive, resources, workDir, take, signal) => {
  mkdirSync(workDir, { recursive: true });
  const dir = mkdtempSync(join(workDir, `facial-${process.pid}-`)), raw = join(dir, "raw");
  const run = (args: string[]) => runWolvenKit(cli, args, { signal, timeoutMs: STEP_TIMEOUT_MS, keep: 16_000 });
  try {
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(dir, "hashes.txt"), resources.map(item => item.hash).join("\n") + "\n");
    await run(["unbundle", archive.id, "-o", raw, "--hash", join(dir, "hashes.txt")]);
    const wanted = new Map(resources.map(item => [item.hash, item])), files = new Map<string, string>();
    const walk = (folder: string) => {
      for (const name of readdirSync(folder)) {
        const full = join(folder, name);
        if (lstatSync(full).isDirectory()) { walk(full); continue; }
        if (name.endsWith(".json")) continue;
        const rel = relative(raw, full).split(sep).join("\\"), numeric = /^(\d+)(?:\.[^.\\]+)?$/.exec(rel);
        const hash = numeric ? BigInt(numeric[1]!).toString() : depotHash(rel), item = wanted.get(hash);
        if (!item) continue;
        let file = full;
        if (numeric && !file.endsWith(`.${item.extension}`)) { file = `${full.replace(/\.[^.\\/]+$/, "")}.${item.extension}`; renameSync(full, file); }
        files.set(hash, file);
      }
    };
    walk(raw);
    if (files.size) await run(["convert", "s", raw]);
    for (const [hash, file] of files) if (existsSync(`${file}.json`)) take(hash, readFileSync(`${file}.json`, "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

/**
 * Which facial setup the face is solved with (design D1). `face-rig` (the default): the one V's photo-mode face rig names for the face
 * skeleton, read from the winning `.app` and its ArchiveXL patches (the male player setup in the base game, which session 4 read live in photo
 * mode [runtime]). `female-head`: the female head's own setup beside its skeleton, what the preview used before; kept for comparisons
 * (`XFS_FACIAL_SETUP=female-head` on localhost; the desktop passes no environment).
 */
export type FacialSetupSource = "face-rig" | "female-head";
export const facialSetupSource = (env: Readonly<Record<string, string | undefined>> = process.env): FacialSetupSource =>
  env.XFS_FACIAL_SETUP === "female-head" ? "female-head" : "face-rig";

export type FacialHostOptions = {
  /** Host-owned private preview cache; the facial data lives in `facial/`. */
  cacheRoot: string;
  /** Resolver JSON and archive-index cache (shared with the character details). */
  resolverCache: string;
  settings: () => CharacterDetailSettings;
  /** Where the solver is (checked at each preparation). */
  solver: () => FacialSolverLocation;
  log?: (message: string) => void;
  /** How long one solve may take before the solver is taken as stuck and started again (`SOLVE_TIMEOUT_MS`). */
  solveTimeoutMs?: number;
  /** Most bytes the cached JSON of the face and its animation sets may take (`FACIAL_JSON_BUDGET`). */
  jsonBudget?: number;
  /** Which facial setup to solve with (`facialSetupSource()` from the environment when unset). */
  setupSource?: FacialSetupSource;
  /** Test seams. */
  open?: (options: InstallationOptions) => Installation;
  extract?: FacialExtractor;
  spawn?: FacialSolverSpawner;
  now?: () => number;
};

type Rig = { vocabulary: FacialVocabulary; rest: RigRest; blink: { clip: ClipTracks; closedTime: number } | null;
  /** The facial setup solved with, and where the choice came from (`face-rig`, or `female-head` when asked for or when the rig names none). */
  setup: { ref: DepotRef; path: string; source: FacialSetupSource };
  /** The JSON files the oracle solver reads (written from the documents when it is asked for; WolvenKit's cache files otherwise). */
  rigJson: string; setupJson: string;
  /** The documents while the oracle may still need them written out (dropped once written or compiled). */
  documents?: { skeleton: unknown; setup: unknown };
  /** XF Studio's solver compiled from them, or why it couldn't be (plain words). */
  compiled: CompiledFacialRig | null; compileError?: string;
  /** The setup's joint regions (`bakedData.Data.JointRegions`), for the eye shapes' seats. */
  regions: readonly number[];
  /** The rig and setup's identity: the winning archives and hashes (the idle's face cache keys by it). */
  identity: string;
  /** The game's blink baked for the preview, once asked for. */
  blinkRecord?: Promise<FacialBlinkRecord | null>;
  /** Tracks the setup's wrinkle outputs read (they show in game even without joint motion). */
  wrinkleSources: readonly number[];
  /** Tracks of the setup's Eyes part (gaze and pupils). */
  eyeTracks: readonly number[];
  /** Opposing pairs the solver confirmed (`findRelations`), and whether gaze counterparts look the same way. */
  axes?: readonly AxisPair[];
  gazeSameWay?: boolean | null;
  /** Controls that move nothing on this face, found by the solver once it is ready (`findInert`); undefined until then or if it failed. */
  inert?: readonly string[];
  /** The check ran (once per face; a restarted solver doesn't repeat it). */
  probed?: boolean };
type Preparation = { key: string; controller: AbortController; promise: Promise<void>;
  /** Settles once the face (rig and setup) is read or has failed: what the idle's face and the blink wait for. */
  rigReady: Promise<void>; rigSettled?: () => void; installation?: Installation;
  /**
   * Settles when something asks for the installed expressions (`expressions()`, the Expressions view): the idle's face and the blink need
   * only the face, so they never start that read (PREV-179).
   */
  startPointsWanted: Promise<void>; wantStartPoints?: () => void;
  /**
   * The read was asked for as a prefetch (the page quiet after startup): its clips are decoded at background priority, behind anything the
   * person asks for. A later ask from the Expressions view joins the same read and lifts it to normal priority.
   */
  startPointsBackground?: boolean;
  rig: FacialHostState["rig"]; rigData?: Rig; expressions: FacialStartPoints; solver: FacialHostState["solver"]; process?: FacialSolverProcess;
  /** The started solver's readiness, the inert check included: a solve waiting for a restarted solver waits for this. */
  starting?: Promise<void>;
  /** The process must be replaced before the next solve (a solve timed out: it may have lost an answer). */
  stale?: boolean;
  /** When the solver was started again after it stopped, within the last `RESTART_WINDOW_MS` (CORE-101). */
  restarts: number[];
  /** Failed preparations of this fingerprint so far, and when the last one failed (CORE-108: a failure is tried again later). */
  failures: number; failedAt?: number };
class Superseded extends Error {}

/** A solve slower than this means the solver is stuck (or lost the answer): it is stopped and started again (CORE-100). */
export const SOLVE_TIMEOUT_MS = 15_000;
/** The solver is started again at most `MAX_RESTARTS` times within `RESTART_WINDOW_MS`; the budget refills as old restarts age out. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 10 * 60_000;
/** Most bytes the cached JSON of the face and its animation sets may take; the least recently used go first (CORE-102). */
export const FACIAL_JSON_BUDGET = 768 * 1024 ** 2;
/** Start points kept for this many installations (the newest). */
export const START_POINT_FILES = 8;
/** A failed preparation is tried again on a question after this long, doubled for each later failure, at most `MAX_PREPARE_RETRIES` times. */
export const PREPARE_RETRY_MS = 30_000;
export const MAX_PREPARE_RETRIES = 3;
/** A temporary extraction folder older than this was left by a host that ended mid-extraction, and is removed. */
export const STALE_TEMP_MS = 60 * 60_000;
/** Most pages whose solves wait at once; past it the oldest waiting one is answered superseded (CORE-104). */
export const MAX_WAITING_CLIENTS = 8;

const fingerprint = (path: string) => { try { const s = statSync(path); return `${path}|${s.size}|${s.mtimeMs}`; } catch { return path; } };
const NOT_SET_UP = "Live expressions read V's face from your game files: choose your game folder in Settings.";
/** The solver's program couldn't be started at all (no Python on this computer, CORE-99). */
export const SOLVER_NOT_SET_UP = "The facial solver isn't set up on this computer, so the live face preview is off. You can still set every " +
  "control: your expression is saved with the look.";
const SOLVER_STOPPED = "The facial solver stopped several times, so the live face preview is off for now. Try again in a few minutes. " +
  "Your expression is still saved with the look.";
const SOLVER_SLOW = "The facial solver took too long to answer, so it is being started again. Try again in a moment.";
const plainFailure = (error: unknown) => error instanceof WolvenKitRunError
  ? (error.code === "runtime_missing" ? "WolvenKit needs its .NET runtime before your V's face can be read." : "WolvenKit couldn't read your V's face from your game files.")
  : "Your V's face couldn't be read from your game files.";
const CLIENT = /^[A-Za-z0-9-]{1,64}$/;

/**
 * One preparation per installation fingerprint (the character details' key), superseded when the mod setup changes, as the grading
 * LUT host does. Solves run one at a time; a newer request from the same page replaces one still waiting (answered `superseded`), so a
 * drag never queues stale solves, and pages take turns (CORE-104).
 */
export class FacialHost {
  private current: Preparation | null = null;
  private readonly installations: InstallationRegistry;
  private running: Promise<void> | null = null;
  /** Each page's newest waiting solve, oldest page first. */
  private readonly waiting = new Map<string, { request: FacialSolveRequest; resolve(answer: FacialSolveAnswer): void }>();
  /** A temporary-folder sweep ran this session. */
  private swept = false;
  /** A "Clear prepared game files" still removing files: a preparation started meanwhile waits for it (CORE-108). */
  private clearing: Promise<void> | null = null;
  constructor(private readonly options: FacialHostOptions) {
    this.installations = options.open ? new InstallationRegistry({ open: options.open }) : installations;
  }
  private get root() { return join(this.options.cacheRoot, "facial"); }
  private now() { return this.options.now?.() ?? Date.now(); }

  /** The state for the current installation; starts preparing when it changed. */
  state(): FacialHostState {
    const entry = this.ensure(), rig = entry.rigData;
    this.checkSolver(entry);
    return { schema: FACIAL_STATE_SCHEMA,
      rig: rig ? { ...entry.rig, skeleton: rig.vocabulary.rig, setup: rig.vocabulary.setup, tracks: rig.vocabulary.tracks, reference: rig.vocabulary.reference,
        main: rig.vocabulary.main, controls: rig.vocabulary.controls, groups: CONTROL_GROUPS, joints: rig.rest.joints,
        ...(rig.inert ? { inert: rig.inert } : {}), ...(rig.axes ? { axes: rig.axes, gazeSameWay: rig.gazeSameWay ?? null } : {}) } : entry.rig,
      solver: { ...entry.solver },
      blink: rig?.blink ? { available: true, closedTime: rig.blink.closedTime, duration: rig.blink.clip.duration, rate: BLINK_RATE } : { available: false },
      expressions: { phase: entry.expressions.phase, ...(entry.expressions.reason ? { reason: entry.expressions.reason } : {}), count: entry.expressions.items.length },
      samples: EXPRESSION_SAMPLES };
  }
  /**
   * The installed expressions; asking starts reading them (after the face) if nothing asked before. `background`: a prefetch, read at
   * background priority; an ask without it while that read runs joins it at normal priority (never a second read).
   */
  expressions(options: { background?: boolean } = {}): FacialStartPoints {
    const entry = this.ensure();
    if (entry.wantStartPoints) { entry.startPointsBackground = !!options.background; entry.wantStartPoints(); }
    else if (!options.background) entry.startPointsBackground = false;
    return structuredClone(entry.expressions);
  }
  async settled(): Promise<void> { await this.current?.promise; }
  /** Check the route before answering (PIPE-59), as the character details do. */
  async refresh(): Promise<void> {
    const settings = this.options.settings();
    if (!settings.gameRoot || !settings.wolvenKitCli) return;
    try { await this.installations.revalidate({ ...settings, gameRoot: settings.gameRoot, wolvenKitCli: settings.wolvenKitCli }); }
    catch { /* The preparation opens the route again and reports what it cannot read. */ }
  }
  dispose() { this.current?.controller.abort(); this.current?.process?.dispose(); this.current = null; }

  /** The facial cache's size (`facial/`), for "Prepared game files". */
  async preparedBytes(): Promise<number> { return folderSize(this.root); }
  /**
   * "Clear prepared game files" (CORE-102): stop the current preparation and its solver, remove the cached face, animation sets and
   * start points, and forget them, so the next question reads the game files again.
   */
  async clearPrepared(): Promise<{ freed: number }> {
    const entry = this.current;
    entry?.controller.abort(); entry?.process?.dispose();
    // The stopped preparation stays current until its files are gone (CORE-108): a question meanwhile is answered from it instead of
    // starting a preparation whose files this clear would then delete; one started meanwhile for another installation waits for it.
    const removing = (async () => {
      await entry?.promise.catch(() => {});
      const before = await this.preparedBytes();
      for (const name of ["json", "start-points", "tmp"]) { try { rmSync(join(this.root, name), { recursive: true, force: true }); } catch { /* In use: kept. */ } }
      return Math.max(0, before - await this.preparedBytes());
    })();
    const clearing = this.clearing = removing.then(() => {}, () => {});
    try { return { freed: await removing }; }
    finally {
      if (this.current === entry) this.current = null;
      if (this.clearing === clearing) this.clearing = null;
    }
  }

  private ensure(): Preparation {
    const settings = this.options.settings(), key = installationFingerprint(settings, this.installations);
    if (this.current?.key === key && !this.retryDue(this.current)) return this.current;
    const previous = this.current;
    previous?.controller.abort(); previous?.process?.dispose();
    const entry: Preparation = { key, controller: new AbortController(), promise: Promise.resolve(), rigReady: Promise.resolve(),
      startPointsWanted: Promise.resolve(), rig: { phase: "preparing" }, expressions: { phase: "preparing", items: [] }, solver: { phase: "starting" },
      restarts: [], failures: previous?.key === key ? previous.failures : 0 };
    entry.rigReady = new Promise<void>(settle => { entry.rigSettled = settle; });
    // A retry of the same installation keeps a request for the installed expressions made before it.
    const wanted = previous?.key === key && previous.wantStartPoints === undefined;
    entry.startPointsWanted = wanted ? Promise.resolve() : new Promise<void>(settle => { entry.wantStartPoints = () => { entry.wantStartPoints = undefined; settle(); }; });
    this.current = entry;
    entry.promise = Promise.all([(previous?.promise ?? Promise.resolve()).catch(() => {}), this.clearing]).then(() => this.prepare(entry, settings)).finally(() => entry.rigSettled?.()).catch(error => {
      if (error instanceof Superseded || entry.controller.signal.aborted) return;
      entry.failures++; entry.failedAt = this.now();
      hostFailure("facial", "facial_prepare_failed", "Your V's face couldn't be prepared for live expressions.", error, "warn");
      entry.rig = entry.rigData ? entry.rig : { phase: "failed", reason: plainFailure(error) };
      if (entry.expressions.phase === "preparing") entry.expressions = { phase: "failed", reason: "The installed expressions couldn't be read from your game files.", items: [] };
    });
    return entry;
  }

  /** A failed preparation is started again on a question once its wait is over (`PREPARE_RETRY_MS`, doubling), a few times at most. */
  private retryDue(entry: Preparation): boolean {
    return entry.failedAt !== undefined && entry.failures <= MAX_PREPARE_RETRIES && this.now() - entry.failedAt >= PREPARE_RETRY_MS * 2 ** (entry.failures - 1);
  }

  private async prepare(entry: Preparation, settings: CharacterDetailSettings) {
    const signal = entry.controller.signal, superseded = () => { if (signal.aborted) throw new Superseded(); };
    if (!settings.gameRoot) {
      entry.rig = { phase: "unconfigured", reason: NOT_SET_UP };
      entry.expressions = { phase: "unconfigured", reason: NOT_SET_UP, items: [] };
      entry.solver = { phase: "missing", reason: NOT_SET_UP };
      return;
    }
    this.sweepTemporary();
    // WolvenKit is optional: XF Studio's own reader reads the face, and WolvenKit only what the reader refuses.
    const cli = settings.wolvenKitCli && existsSync(settings.wolvenKitCli) ? settings.wolvenKitCli : null;
    const tool = cli ? wolvenKitIdentityKey(wolvenKitIdentity(cli)) : "native";
    const installation = await this.installations.acquire({ gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: cli, cacheDir: this.options.resolverCache, log: this.options.log });
    superseded();
    entry.installation = installation;
    const graph = installation.graph, decoder = installation.fetcher.nativeDecoder;
    // The face: skeleton and the facial setup V's face rig names (design D1), natively first; the game's blink clip likewise.
    const setup = await this.faceSetup(installation);
    superseded();
    const [skeletonRef, additivesRef] = [FACE_SKELETON, FACIAL_ADDITIVES].map(refFromPath) as [DepotRef, DepotRef], setupRef = setup.ref;
    const documents = new Map<string, unknown>(), identity: string[] = [];
    for (const ref of [skeletonRef, setupRef]) {
      const located = graph.locate(ref), archive = located.lookup.winner;
      if (!archive) continue;
      identity.push(`${fingerprint(archive.id)}|${located.entry.hash}`);
      if (decoder) {
        try { const document = await nativeDocument(decoder, archive, located.entry.hash, this.options.log); if (document) documents.set(ref.hash, document); }
        catch (error) { hostFailure("facial", "native_face_unreadable", "XF Studio's reader couldn't read V's face; WolvenKit is asked instead.", error, "warn"); }
      }
    }
    superseded();
    let rigJson = "", setupJson = "";
    const wanted = [{ ref: skeletonRef, extension: "rig" }, { ref: setupRef, extension: "facialsetup" }].filter(item => !documents.has(item.ref.hash));
    if (wanted.length) {
      if (!cli) throw Error("The face skeleton or facial setup couldn't be read by XF Studio's reader, and WolvenKit isn't set up.");
      const files = await this.readJson(cli, tool, graph, wanted, signal);
      superseded();
      for (const item of wanted) {
        const found = files.get(item.ref.hash);
        if (!found) continue;
        documents.set(item.ref.hash, readDocument(found.file));
        if (item.ref === skeletonRef) rigJson = found.file; else setupJson = found.file;
      }
    }
    const skeletonDocument = documents.get(skeletonRef.hash), setupDocument = documents.get(setupRef.hash);
    if (!skeletonDocument || !setupDocument) throw Error("The face skeleton or facial setup is missing from the game files.");
    const { vocabulary, rest } = readFaceRig(skeletonDocument, setupDocument, setup.path);
    const wrinkleSources = wrinkleSourceTracks(setupDocument), eyes = eyeTracks(setupDocument);
    let compiled: CompiledFacialRig | null = null, compileError: string | undefined;
    try { compiled = compileFacialRig(skeletonDocument, setupDocument); }
    catch (error) {
      compileError = error instanceof Error ? error.message : String(error);
      hostFailure("facial", "face_not_compiled", "XF Studio's facial solver couldn't take V's facial setup.", error, "warn");
    }
    let blink: Rig["blink"] = null;
    try {
      const located = graph.locate(additivesRef), archive = located.lookup.winner;
      let clips: ReadonlyMap<string, import("./facial-catalogue").SetClip> | null = null;
      if (archive && decoder) {
        const clip = await nativeClip(decoder, archive.id, located.entry.hash, BLINK_CLIP).catch(() => null);
        if (clip) clips = new Map([[clip.name, clip]]);
      }
      if (!clips && archive && cli) {
        const additives = (await this.readJson(cli, tool, graph, [{ ref: additivesRef, extension: "anims" }], signal)).get(additivesRef.hash);
        if (additives) clips = readAnimSet(readDocument(additives.file)).clips;
      }
      if (clips) blink = readBlink(clips, vocabulary);
    } catch (error) { hostFailure("facial", "blink_unreadable", `The game's blink (${BLINK_CLIP}) couldn't be read; expressions show without it.`, error, "warn"); }
    superseded();
    const baked = (setupDocument as { Data?: { RootChunk?: { bakedData?: { Data?: { JointRegions?: unknown } } } } }).Data?.RootChunk?.bakedData?.Data?.JointRegions;
    entry.rigData = { vocabulary, rest, blink, setup, rigJson, setupJson, wrinkleSources, eyeTracks: eyes, compiled, ...(compileError ? { compileError } : {}),
      regions: Array.isArray(baked) ? baked.map(Number) : [], identity: identity.join("\n"),
      ...(rigJson && setupJson ? {} : { documents: { skeleton: skeletonDocument, setup: setupDocument } }) };
    entry.rig = { phase: "ready" };
    entry.rigSettled?.();
    this.startSolver(entry);
    // The installed expressions, after the face (the editor works without them), and only once something asks for them (PREV-179).
    await new Promise<void>(settle => { if (signal.aborted) return settle(); void entry.startPointsWanted.then(settle); signal.addEventListener("abort", () => settle(), { once: true }); });
    superseded();
    try { entry.expressions = await this.readStartPoints(installation, cli, tool, vocabulary, signal, () => entry.startPointsBackground ? "background" : undefined, setup.ref); }
    catch (error) {
      if (error instanceof Superseded || signal.aborted) throw error;
      hostFailure("facial", "start_points_failed", "The installed expressions couldn't be read.", error, "warn");
      entry.expressions = { phase: "failed", reason: "The installed photo-mode expressions couldn't be read from your game files. Start from rest instead.", items: [] };
    }
    // The face's own files stay; the animation sets beyond the budget go, least recently used first.
    this.keepJsonWithinBudget(new Set([entry.rigData.rigJson, entry.rigData.setupJson].filter(Boolean)));
    hostTrace().event("facial", "prepared", { controls: vocabulary.controls.length, joints: rest.joints.length, startPoints: entry.expressions.items.length,
      solver: entry.solver.phase, setup: setup.path, setupSource: setup.source });
  }

  /**
   * The facial setup to solve with (design D1): the one V's photo-mode face rig names for the face skeleton, from the winning `.app` and
   * its ArchiveXL patches; the female head's own when asked for, or when the rig can't be read or names no setup the installation has.
   */
  private async faceSetup(installation: Installation): Promise<Rig["setup"]> {
    const fallback: Rig["setup"] = { ref: refFromPath(FACE_SETUP), path: FACE_SETUP, source: "female-head" };
    if ((this.options.setupSource ?? facialSetupSource()) === "female-head") return fallback;
    try {
      const graph = installation.graph, rigRef = refFromPath(PHOTO_MODE_FACE_RIG);
      const document = async (ref: DepotRef) => {
        const located = graph.locate(ref), winner = located.lookup.winner;
        return winner ? (await installation.fetcher.fetch(winner, located.entry, "app"))?.document ?? null : null;
      };
      const apps: unknown[] = [];
      const rig = await document(rigRef);
      if (rig) apps.push(rig);
      for (const patch of graph.patchesFor(rigRef.hash)) { const source = await document(refFromHash(patch.source, patch.sourcePath)); if (source) apps.push(source); }
      const named = apps.length ? readFaceRigSetup(apps, FACE_SKELETON) : null;
      if (named && graph.locate(named).lookup.winner) return { ref: named, path: faceSetupPath(graph.named(named)), source: "face-rig" };
      hostFailure("facial", "face_rig_setup_missing", "V's face rig names no facial setup this game has; the female head's own is used.", null, "warn");
    } catch (error) {
      hostFailure("facial", "face_rig_unreadable", "V's face rig couldn't be read; the female head's own facial setup is used.", error, "warn");
    }
    return fallback;
  }

  /** Start (or start again) the solver for a preparation. A program that can't be started at all is "not set up" (CORE-99). */
  private startSolver(entry: Preparation) {
    const location = this.options.solver();
    if ("missing" in location) { entry.solver = { phase: "missing", reason: location.missing }; return; }
    const rig = entry.rigData!, inProcess = "inProcess" in location;
    // With XF Studio's own solver the documents (the setup's is tens of MB) are needed only by the oracle's files: dropped whether the face
    // compiled or not (PREV-180).
    if (inProcess) rig.documents = undefined;
    if (inProcess && !rig.compiled && !this.options.spawn) {
      entry.solver = { phase: "failed", kind: "in-app", reason: "XF Studio couldn't read V's face from your game files, so the live face preview is off. Your expression still saves with the look." };
      return;
    }
    entry.solver = { phase: "starting", kind: inProcess ? "in-app" : "oracle" };
    entry.stale = false;
    entry.starting = undefined;
    let process: FacialSolverProcess;
    try {
      if (!inProcess) this.writeOracleFiles(rig);
      process = (this.options.spawn ?? spawnFacialSolver)(location, rig.rigJson, rig.setupJson, { log: this.options.log, ...(rig.compiled ? { compiled: rig.compiled } : {}) });
    }
    catch (error) {
      entry.process = undefined;
      hostFailure("facial", "solver_not_started", "The facial solver's program couldn't be started.", error, "warn");
      entry.solver = { phase: "missing", reason: SOLVER_NOT_SET_UP };
      return;
    }
    entry.process = process;
    void process.ready.then(result => {
      if (this.current !== entry || entry.process !== process) return;
      if (result.ok) {
        // The controls that move nothing are found before the solver is ready, so the drawer never offers them (the preview polls while
        // the solver starts). A failed probe hides nothing.
        entry.starting = this.findInert(entry, process).then(() => {
          if (this.current !== entry || entry.process !== process) return;
          entry.solver = { phase: "ready", compileMs: result.compileMs, kind: inProcess ? "in-app" : "oracle" };
          this.options.log?.(`Facial solver ready (${inProcess ? "XF Studio's own" : "the IO Suite oracle"}; setup compiled in ${Math.round(result.compileMs)} ms).`);
        });
      }
      else {
        hostFailure("facial", "solver_failed", "The facial solver couldn't start.", Error(result.error), "warn");
        entry.solver = { phase: "failed", reason: /Expected reviewed solver|local changes/.test(result.error)
          ? "The facial solver found isn't the reviewed version XF Studio uses, so the live face preview is off. Your expression is still saved with the look."
          : "The facial solver couldn't start, so the live face preview is off. Your expression is still saved with the look." };
      }
    });
  }
  /** The oracle reads JSON files: the natively read documents are written to the facial cache once, when it is asked for. */
  private writeOracleFiles(rig: Rig) {
    if (rig.rigJson && rig.setupJson) return;
    const documents = rig.documents;
    if (!documents) throw Error("The face's documents are gone; prepare again.");
    mkdirSync(join(this.root, "json"), { recursive: true });
    const file = (name: string) => join(this.root, "json", `${createHash("sha256").update(`facial-native:1|${rig.identity}|${name}`).digest("hex")}.json`);
    rig.rigJson ||= file("rig"); rig.setupJson ||= file("setup");
    writeFileAtomic(rig.rigJson, JSON.stringify(documents.skeleton));
    writeFileAtomic(rig.setupJson, JSON.stringify(documents.setup));
    rig.documents = undefined;
  }

  /**
   * The compiled face for the idle's face (idle-host.ts): waits for the face to be read; null when it can't be (no game folder, a setup
   * XF Studio's solver can't take), with the plain reason.
   */
  async faceSource(): Promise<FaceSource | { reason: string }> {
    const entry = this.ensure();
    await entry.rigReady;
    const rig = entry.rigData;
    // The idle's own words (the Motion panel shows them): not the Expression panel's.
    if (entry.rig.phase === "unconfigured") return { reason: IDLE_FACE_NEEDS_SETUP };
    if (!rig?.compiled) return { reason: IDLE_FACE_MISSING };
    return { rig: rig.compiled, identity: `${FACE_BAKE_VERSION}|${rig.identity}`, skeleton: rig.vocabulary.rig, setup: rig.vocabulary.setup,
      regions: rig.regions, installation: entry.installation ?? null };
  }

  /**
   * The game's blink baked for the preview (game-blink.ts), solved by XF Studio's own solver: the normal blink clip at 60 Hz for Play blink,
   * its closing half in 21 steps for the Closure slider (time is the closure), and each eye shape's joint seats from the head's and the
   * eyes' morph targets. Null, with the reason logged, when the face or the clip can't be read.
   */
  async blink(): Promise<FacialBlinkRecord | { reason: string }> {
    // With the IO Suite oracle in use the whole face is the oracle's: the page reads the developer's prepared blink instead.
    if (!("inProcess" in this.options.solver())) return { reason: ORACLE_BLINK };
    const entry = this.ensure();
    await entry.rigReady;
    const rig = entry.rigData;
    if (!rig?.compiled || !rig.blink) return { reason: !rig ? entry.rig.reason ?? "V's face couldn't be read from your game files." : "The game's blink couldn't be read from your game files." };
    rig.blinkRecord ??= this.bakeBlink(entry, rig).catch(error => {
      hostFailure("facial", "blink_bake_failed", "The game's blink couldn't be prepared.", error, "warn");
      rig.blinkRecord = undefined;
      return null;
    });
    return (await rig.blinkRecord) ?? { reason: "The game's blink couldn't be prepared." };
  }
  private async bakeBlink(entry: Preparation, rig: Rig): Promise<FacialBlinkRecord> {
    const compiled = rig.compiled!, blink = rig.blink!, rest = bakedRest(compiled);
    const clipTimes = Array.from({ length: Math.min(MAX_SOLVE_FRAMES, Math.round(blink.clip.duration * BLINK_RATE) + 1) }, (_, i) => Math.min(blink.clip.duration, i / BLINK_RATE));
    const closureTimes = Array.from({ length: BLINK_STEPS + 1 }, (_, i) => i / BLINK_STEPS);
    const [clip, closure] = bakeClips(compiled, [{ frames: clipTimes.map(t => clipFrame(compiled, blink.clip, t)), times: clipTimes },
      { frames: closureTimes.map(c => clipFrame(compiled, blink.clip, c * blink.closedTime)), times: closureTimes }]) as [BakedFrames, BakedFrames];
    // Each eye shape's seats (the blink re-seats its rig on the shown shape; knowledge/facial-animation.md §4).
    let shapes: Record<string, Record<string, number[]>> | undefined;
    try {
      const installation = entry.installation, graph = installation?.graph;
      const read = async (path: string) => {
        const ref = refFromPath(path), winner = graph?.locate(ref).lookup.winner;
        return winner && installation ? (await installation.fetcher.fetch(winner, graph!.locate(ref).entry, "morphtarget"))?.document ?? null : null;
      };
      const [head, eyes] = await Promise.all([read(FACE_MORPHS), read(EYE_MORPHS)]);
      if (head) shapes = eyeShapeSeats(rest, rig.regions, morphBinds(head), eyes ? morphBinds(eyes) : []);
    } catch (error) { hostFailure("facial", "eye_shapes_unreadable", "The eye shapes' joint seats couldn't be read; the blink turns about the base shape.", error, "warn"); }
    const description = { schema: "xfs/game-blink-1",
      closure: { animation: "eye_blink_closure", tracks: ["eye_l_blink", "eye_r_blink"], steps: BLINK_STEPS, clip: BLINK_CLIP, closedTime: blink.closedTime },
      clip: { animation: BLINK_CLIP, source: FACIAL_ADDITIVES, duration: blink.clip.duration, sampleRate: BLINK_RATE },
      ...(shapes && Object.keys(shapes).length ? { shapes } : {}),
      rig: { skeleton: rig.vocabulary.rig, setup: rig.vocabulary.setup, bodyGender: "female" } };
    return { schema: FACE_MOTION_SCHEMA, rest: motionRest(rest, rig.regions), description,
      clips: [motionClip("eye_blink_closure", closure, rest), motionClip(BLINK_CLIP, clip, rest)] };
  }

  /**
   * The controls that move nothing on this face (research/animation/natural-expressions.md §3.2): each main-pose control is solved at
   * full weight alone and on top of every control at `INERT_CONTEXT`, which catches controls that act only with others (a lip seal that
   * needs an open jaw, a control that only undoes another); one that changes no joint in either, and feeds no wrinkle output, is inert.
   * Read from the setup the host solves with, so another setup or a mod's setup gets its own answer; nothing is named.
   */
  private async findInert(entry: Preparation, process: FacialSolverProcess): Promise<void> {
    const rig = entry.rigData;
    if (!rig || rig.probed) return;
    rig.probed = true;
    const controls = rig.vocabulary.controls, context = Object.fromEntries(controls.map(control => [control.name, INERT_CONTEXT]));
    const frames = [denseTracks(rig.vocabulary, {}).tracks, denseTracks(rig.vocabulary, context).tracks,
      ...controls.map(control => denseTracks(rig.vocabulary, { [control.name]: 1 }).tracks),
      ...controls.map(control => denseTracks(rig.vocabulary, { ...context, [control.name]: 1 }).tracks)];
    try {
      const answer = await withTimeout(process.solve(frames), this.options.solveTimeoutMs ?? SOLVE_TIMEOUT_MS);
      const q = floats(answer.q), t = floats(answer.t), joints = rig.rest.joints.length;
      if (q.length !== frames.length * joints * 4 || t.length !== frames.length * joints * 3) throw Error("The solver's answer has the wrong size.");
      const moved = (frame: number, base: number) => differs(q, frame, base, joints * 4) || differs(t, frame, base, joints * 3);
      const wrinkles = new Set(rig.wrinkleSources);
      rig.inert = controls.filter((control, index) => !wrinkles.has(control.track) && !moved(2 + index, 0) && !moved(2 + controls.length + index, 1))
        .map(control => control.name);
      hostTrace().event("facial", "inert", { count: rig.inert.length });
      // Opposing pairs and gaze counterparts, from the same solves (each control alone at full weight) in world space.
      const rest = worldPositions(rig.rest), pose = { q, t };
      const displacement = controls.map((control, index): Vec3[] | undefined => {
        if (!moved(2 + index, 0)) return undefined;
        return worldPositions(rig.rest, posedLocals(rig.rest, pose, 2 + index)).map((p, j) => [p[0] - rest[j]![0], p[1] - rest[j]![1], p[2] - rest[j]![2]] as Vec3);
      });
      const relations = findRelations({ rest: rig.rest, controls, displacement, eyeTracks: new Set(rig.eyeTracks) });
      rig.axes = relations.axes; rig.gazeSameWay = relations.gazeSameWay;
      hostTrace().event("facial", "relations", { axes: relations.axes.length, gazeSameWay: relations.gazeSameWay });
    } catch (error) { hostFailure("facial", "inert_probe_failed", "Finding the face controls that move nothing didn't work; all are shown.", error, "warn"); }
  }
  /**
   * A ready solver that stopped (a crash) or is stuck is started again while the restart budget allows; past it the state says so
   * plainly, and the budget refills as old restarts age out (CORE-101). Answers whether a new process was started.
   */
  private checkSolver(entry: Preparation): boolean {
    // A stopped preparation (a clear in progress, CORE-108) never starts its solver again.
    if (entry.controller.signal.aborted) return false;
    if (!entry.process || entry.solver.phase === "missing" || entry.solver.phase === "starting") return false;
    if (!entry.process.exited && !entry.stale) return false;
    if (entry.solver.phase === "failed" && entry.solver.reason !== SOLVER_STOPPED) return false;
    const now = this.now();
    entry.restarts = entry.restarts.filter(at => now - at < RESTART_WINDOW_MS);
    if (entry.restarts.length >= MAX_RESTARTS) { entry.solver = { phase: "failed", reason: SOLVER_STOPPED }; return false; }
    entry.restarts.push(now);
    this.options.log?.("The facial solver stopped; starting it again.");
    entry.process.dispose();
    this.startSolver(entry);
    return true;
  }

  /** Remove temporary extraction folders a host left when it ended mid-extraction (CORE-102), once per session. */
  private sweepTemporary() {
    if (this.swept) return;
    this.swept = true;
    const tmp = join(this.root, "tmp");
    let names: string[];
    try { names = readdirSync(tmp); } catch { return; }
    const now = Date.now();
    for (const name of names) {
      const path = join(tmp, name);
      try { if (now - statSync(path).mtimeMs > STALE_TEMP_MS) rmSync(path, { recursive: true, force: true }); } catch { /* In use or gone. */ }
    }
  }
  /** Keep the cached JSON within its budget: the least recently used first, never `keep` (this preparation's face). */
  private keepJsonWithinBudget(keep: ReadonlySet<string>) {
    const folder = join(this.root, "json"), budget = this.options.jsonBudget ?? FACIAL_JSON_BUDGET;
    let files: { path: string; bytes: number; used: number }[];
    try { files = readdirSync(folder).filter(name => name.endsWith(".json")).map(name => { const path = join(folder, name), info = statSync(path); return { path, bytes: info.size, used: info.mtimeMs }; }); }
    catch { return; }
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    if (total <= budget) return;
    for (const file of files.sort((a, b) => a.used - b.used)) {
      if (total <= budget) break;
      if (keep.has(file.path)) continue;
      try { rmSync(file.path, { force: true }); total -= file.bytes; } catch { /* In use: kept. */ }
    }
  }

  /**
   * Put resources from their winning archives in the cache as untrimmed JSON (by the reference's hash; ArchiveXL copies and links
   * followed), keyed by WolvenKit identity, archive and hash. Answers each asked reference's cache file (read it with `document`), so
   * no more than one document is held at a time. A file answered from the cache is marked used (the budget evicts by use).
   */
  private async readJson(cli: string, tool: string, graph: Installation["graph"], refs: readonly { ref: DepotRef; extension: string }[], signal: AbortSignal):
    Promise<Map<string, { file: string; archive: MountedArchive }>> {
    const byArchive = new Map<MountedArchive, { asked: string; resource: FacialResource }[]>(), out = new Map<string, { file: string; archive: MountedArchive }>();
    const cacheFile = (archive: MountedArchive, hash: string) =>
      join(this.root, "json", `${createHash("sha256").update(`facial-json:1|${tool}|${fingerprint(archive.id)}|${hash}`).digest("hex")}.json`);
    for (const { ref, extension } of refs) {
      const located = graph.locate(ref), archive = located.lookup.winner;
      if (!archive) continue;
      const file = cacheFile(archive, located.entry.hash);
      if (existsSync(file)) {
        try { const now = new Date(); utimesSync(file, now, now); } catch { /* Advisory. */ }
        out.set(ref.hash, { file, archive });
        continue;
      }
      const list = byArchive.get(archive) ?? []; list.push({ asked: ref.hash, resource: { hash: located.entry.hash, extension } }); byArchive.set(archive, list);
    }
    const extract = this.options.extract ?? extractFacialJson;
    for (const [archive, list] of byArchive) {
      mkdirSync(join(this.root, "json"), { recursive: true });
      await extract(cli, archive, list.map(item => item.resource), join(this.root, "tmp"), (hash, text) => {
        const file = cacheFile(archive, hash);
        writeFileAtomic(file, text);
        for (const item of list) if (item.resource.hash === hash) out.set(item.asked, { file, archive });
      }, signal);
    }
    return out;
  }

  /**
   * The installed expressions, cached by what they are read from (CORE-103): the winning archives of the face, the expression table and
   * V's photo-mode face rig with its patches, each by its file's identity (path, size, time); the cache also records the animation sets'
   * archives and is read again when one of them changed (a mod updated in place).
   */
  private async readStartPoints(installation: Installation, cli: string | null, tool: string, vocabulary: FacialVocabulary,
    signal: AbortSignal, priority: () => "background" | undefined = () => undefined, setupRef: DepotRef = refFromPath(FACE_SETUP)): Promise<FacialStartPoints> {
    const graph = installation.graph;
    const identity = (ref: DepotRef) => { const winner = graph.locate(ref).lookup.winner; return winner ? fingerprint(winner.id) : "-"; };
    const rigRef = refFromPath(PHOTO_MODE_FACE_RIG), tableRef = refFromPath(EXPRESSION_TABLE);
    const sources = [refFromPath(FACE_SKELETON), setupRef, refFromPath(EXPRESSION_TABLE), refFromPath(PHOTO_MODE_FACE_RIG)].map(identity)
      .concat(graph.patchesFor(rigRef.hash).map(patch => identity(refFromHash(patch.source, patch.sourcePath))));
    const cache = join(this.root, "start-points", `${createHash("sha256").update(`${START_POINT_VERSION}|${tool}|${sources.join("\n")}`).digest("hex")}.json`);
    if (existsSync(cache)) {
      try {
        const cached = JSON.parse(readFileSync(cache, "utf8")) as { sets?: { hash: string; archive: string }[]; points?: FacialStartPoints };
        if (cached.points && Array.isArray(cached.sets) && cached.sets.every(set => identity(refFromHash(set.hash, null)) === set.archive)) {
          try { const now = new Date(); utimesSync(cache, now, now); } catch { /* Advisory. */ }
          return cached.points;
        }
      } catch { /* read again */ }
    }
    // Whole documents from the winning archive (the resolver's graph keeps only the shapes it models).
    const document = async (ref: ReturnType<typeof refFromPath>, extension: string) => {
      const winner = graph.locate(ref).lookup.winner;
      return winner ? (await installation.fetcher.fetch(winner, graph.locate(ref).entry, extension))?.document ?? null : null;
    };
    const table = await document(tableRef, "csv");
    if (!table) return { phase: "failed", reason: "Photo mode's expression table wasn't found in your game files. Start from rest instead.", items: [] };
    const tableProvider = providerLabel(graph.locate(tableRef).lookup.winner);
    const rows = readTable(table);
    // V's photo-mode face rig and every ArchiveXL patch of it, in patch order.
    const rig = await document(rigRef, "app");
    if (!rig) return { phase: "failed", reason: "V's photo-mode face wasn't found in your game files. Start from rest instead.", items: [] };
    const apps: unknown[] = [rig];
    for (const patch of graph.patchesFor(rigRef.hash)) {
      const source = await document(refFromHash(patch.source, patch.sourcePath), "app");
      if (source) apps.push(source);
    }
    if (signal.aborted) throw new Superseded();
    const sets = readFaceRigSets(apps);
    // Each set natively first (only the clips the table names), WolvenKit for a set the reader can't read.
    const decoder = installation.fetcher.nativeDecoder, wantedClips = new Set(rows.map(row => row.AnimationName ?? "").filter(Boolean));
    const decoded: { path: string; provider: string; clips: ReadonlyMap<string, SetClip> }[] = [];
    const leftOver: typeof sets = [];
    const nativeSets = new Map<(typeof sets)[number], { path: string; provider: string; clips: ReadonlyMap<string, SetClip> }>();
    for (const set of sets) {
      const archive = graph.locate(set.ref).lookup.winner, path = graph.named(set.ref).path ?? `#${set.ref.hash}`;
      if (!archive) continue;
      const clips = decoder ? await nativeSetClips(decoder, archive.id, graph.locate(set.ref).entry.hash, wantedClips, priority).catch(() => null) : null;
      if (signal.aborted) throw new Superseded();
      if (clips) nativeSets.set(set, { path, provider: providerLabel(archive), clips }); else leftOver.push(set);
    }
    const documents = leftOver.length && cli ? await this.readJson(cli, tool, graph, leftOver.map(set => ({ ref: set.ref, extension: "anims" })), signal) : new Map();
    for (const set of sets) {
      const native = nativeSets.get(set);
      if (native) { decoded.push(native); continue; }
      const found = documents.get(set.ref.hash), path = graph.named(set.ref).path ?? `#${set.ref.hash}`;
      if (!found) continue;
      // One set's document at a time: decoded, then dropped.
      try { decoded.push({ path, provider: providerLabel(found.archive), clips: readAnimSet(readDocument(found.file)).clips }); }
      catch (error) { hostFailure("facial", "anim_set_unreadable", `An animation set of V's photo-mode face couldn't be read (${path}).`, error, "warn"); }
    }
    const { items, missing } = startPoints(rows, decoded, vocabulary);
    const result: FacialStartPoints = { phase: "ready", table: { provider: tableProvider, rows: rows.length }, items, ...(missing.length ? { missing } : {}) };
    try {
      mkdirSync(join(this.root, "start-points"), { recursive: true });
      writeFileAtomic(cache, JSON.stringify({ sets: sets.map(set => ({ hash: set.ref.hash, archive: identity(set.ref) })), points: result }));
      keepNewest(join(this.root, "start-points"), START_POINT_FILES);
    } catch { /* Advisory. */ }
    return result;
  }

  /**
   * Solve a held expression (with the blink composed before the solve, as the game adds blink tracks first). Each page's newest request
   * wins; pages take turns.
   */
  solve(request: FacialSolveRequest): Promise<FacialSolveAnswer> {
    return new Promise(resolveAnswer => {
      const client = request && typeof request === "object" && typeof request.client === "string" && CLIENT.test(request.client) ? request.client : "";
      this.waiting.get(client)?.resolve({ ok: false, code: "superseded", message: "A newer pose was asked for." });
      this.waiting.delete(client);
      if (this.waiting.size >= MAX_WAITING_CLIENTS) {
        const [oldest, waiter] = this.waiting.entries().next().value!;
        this.waiting.delete(oldest);
        waiter.resolve({ ok: false, code: "superseded", message: "A newer pose was asked for." });
      }
      this.waiting.set(client, { request, resolve: resolveAnswer });
      this.pump();
    });
  }
  private pump() {
    if (this.running || !this.waiting.size) return;
    const [client, { request, resolve: done }] = this.waiting.entries().next().value!;
    this.waiting.delete(client);
    this.running = this.solveNow(request).then(done, error => done({ ok: false, code: "failed", message: plainSolveFailure(error) }))
      .finally(() => { this.running = null; this.pump(); });
  }
  private async solveNow(request: FacialSolveRequest): Promise<FacialSolveAnswer> {
    if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, code: "invalid", message: "Send a pose to solve." };
    if (request.client !== undefined && (typeof request.client !== "string" || !CLIENT.test(request.client))) return { ok: false, code: "invalid", message: "Unknown page." };
    // The current preparation (a route change is noticed by the next state poll, not on every solve).
    const entry = this.current ?? this.ensure(), rig = entry.rigData;
    const issue = vectorIssue(request.controls) ?? blinkIssue(request.blink);
    if (issue) return { ok: false, code: "invalid", message: issue };
    if (!rig) return { ok: false, code: "unavailable", message: entry.rig.reason ?? "Your V's face is still being prepared." };
    // A solver that stopped (a crash) or is stuck is started again within the restart budget; this solve waits for it to be ready.
    if (this.checkSolver(entry) && entry.process) {
      await withTimeout(entry.process.ready, this.options.solveTimeoutMs ?? SOLVE_TIMEOUT_MS).catch(() => {});
      await entry.starting;
    }
    const process = entry.process;
    if (!process || entry.solver.phase !== "ready") return { ok: false, code: "unavailable", message: entry.solver.reason ?? "The facial solver is starting." };
    const { tracks: _probe, skipped } = denseTracks(rig.vocabulary, request.controls);
    const frames: Float32Array[] = [];
    let rate: number | undefined;
    const blink = request.blink && rig.blink ? request.blink : undefined;
    if (blink && "play" in blink) {
      rate = BLINK_RATE;
      const count = Math.min(MAX_SOLVE_FRAMES, Math.round(rig.blink!.clip.duration * BLINK_RATE) + 1);
      for (let i = 0; i < count; i++) frames.push(denseTracks(rig.vocabulary, request.controls, clipValuesAt(rig.blink!.clip, i / BLINK_RATE)).tracks);
    } else if (blink && blink.closure > 0) {
      frames.push(denseTracks(rig.vocabulary, request.controls, clipValuesAt(rig.blink!.clip, blink.closure * rig.blink!.closedTime)).tracks);
    } else frames.push(_probe);
    let answer: { q: string; t: string; ms: number };
    try { answer = await withTimeout(process.solve(frames), this.options.solveTimeoutMs ?? SOLVE_TIMEOUT_MS); }
    catch (error) {
      if (!(error instanceof SolveTimeout)) throw error;
      // Stuck, or its answer was lost: stopped now, started again for the next solve (CORE-100).
      hostFailure("facial", "solve_timeout", "The facial solver didn't answer in time.", error, "warn");
      if (entry.process === process) { entry.stale = true; process.dispose(); }
      return { ok: false, code: "failed", message: SOLVER_SLOW };
    }
    return { ok: true, frames: frames.length, ...(rate ? { rate } : {}), q: answer.q, t: answer.t, ms: answer.ms, skipped };
  }
}

/**
 * The idle's face without a game folder. Not reached through the idle today (the idle itself needs the game folder first and says so), kept
 * so the idle never shows the Expression panel's words.
 */
const IDLE_FACE_NEEDS_SETUP = "Choose your game folder in Settings to see V's face move during the idle.";
/** The blink endpoint's answer while a developer uses the IO Suite oracle (the page then reads the prepared blink asset, if any). */
const ORACLE_BLINK = "The facial solver oracle is in use, so the blink is the developer preparation's (XFS_PREPARED_MOTION=on serves it).";
/** The closure slider's steps (21 solved instants from open to the clip's closed frame). */
export const BLINK_STEPS = 20;
/** Version of what the face bakes hold (the solver's rules and the record's shape); part of the idle face cache's key. 2: the rest carries the setup's regions. */
export const FACE_BAKE_VERSION = 2;
/** The compiled face the idle host bakes the idle's face with (`FacialHost.faceSource`). */
export type FaceSource = { rig: CompiledFacialRig; identity: string; skeleton: string; setup: string;
  /** The setup's joint regions (`JointRegions`), one per rig joint, where they were read. */
  regions?: readonly number[]; installation: Installation | null };
/** A baked rest as the wire record holds it, with the setup's regions when they fit the rest (one per joint). */
export function motionRest(rest: BakedRest, regions?: readonly number[]): FaceMotionRest {
  return { names: [...rest.names], parents: [...rest.parents], local: base64Of(rest.local),
    ...(regions && regions.length === rest.names.length ? { regions: [...regions] } : {}) };
}
/** Baked frames as one wire clip (moving joints by name). */
export function motionClip(name: string, frames: BakedFrames, rest: BakedRest): FaceMotionClip {
  return { name, times: base64Of(frames.times), joints: frames.joints.map(j => rest.names[j]!), local: base64Of(frames.local) };
}

/** The weight every other control holds while `findInert` looks for controls that act only in combination. */
export const INERT_CONTEXT = 0.25;
/** Base64 float32 (the solver's answer) as numbers. */
function floats(text: string): Float32Array {
  const bytes = Buffer.from(text, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
/** Whether frame `frame` of a packed buffer (`size` numbers a frame) differs from frame `base` by more than rounding. */
function differs(values: Float32Array, frame: number, base: number, size: number): boolean {
  for (let i = 0; i < size; i++) if (Math.abs(values[frame * size + i]! - values[base * size + i]!) > 1e-6) return true;
  return false;
}

class SolveTimeout extends Error {}
/** `work`, or a `SolveTimeout` after `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SolveTimeout(`No answer within ${Math.round(ms)} ms.`)), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
/** A folder's size in bytes (small folders: the facial cache holds tens of files). */
function folderSize(folder: string): number {
  let total = 0;
  let names: string[];
  try { names = readdirSync(folder); } catch { return 0; }
  for (const name of names) {
    const path = join(folder, name);
    try { const info = lstatSync(path); total += info.isDirectory() ? folderSize(path) : info.size; } catch { /* Gone. */ }
  }
  return total;
}
/** Keep the `count` most recently used files of a folder. */
function keepNewest(folder: string, count: number) {
  const files = readdirSync(folder).map(name => { const path = join(folder, name); return { path, used: statSync(path).mtimeMs }; }).sort((a, b) => b.used - a.used);
  for (const file of files.slice(count)) { try { rmSync(file.path, { force: true }); } catch { /* In use: kept. */ } }
}

/** A cached document (readJson's file). */
const readDocument = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

function blinkIssue(blink: FacialBlink | undefined): string | undefined {
  if (blink === undefined) return undefined;
  if (typeof blink !== "object" || blink === null) return "The blink must be a closure or play.";
  if ("play" in blink) return blink.play === true ? undefined : "The blink must be a closure or play.";
  return typeof blink.closure === "number" && Number.isFinite(blink.closure) && blink.closure >= 0 && blink.closure <= 1 ? undefined : "A blink closure is from 0 to 1.";
}
const plainSolveFailure = (error: unknown) => `The facial solver couldn't solve that pose: ${error instanceof Error ? error.message : String(error)}`;
/** Who provides an archive, in the words the drawer shows: the base game, or the mod's name. */
function providerLabel(archive: MountedArchive | null | undefined): string {
  if (!archive) return "Unknown";
  return archive.provider === "game" ? "Base game" : archive.providerName || archive.name;
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** `GET /api/facial` (state), `GET /api/facial/expressions`, `POST /api/facial/solve`. Local, same-origin requests only. */
export function createFacialHandler(host: FacialHost) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ code: "forbidden", error: "Use the local studio." }, 403);
    if (url.pathname === FACIAL_ENDPOINT && request.method === "GET") { await host.refresh(); return json(host.state()); }
    // `?prefetch=1`: the page is quiet after startup and reads them ahead of the Expressions view, at background priority.
    if (url.pathname === FACIAL_EXPRESSIONS_ENDPOINT && request.method === "GET") return json(host.expressions({ background: url.searchParams.get("prefetch") === "1" }));
    if (url.pathname === FACIAL_BLINK_ENDPOINT && request.method === "GET") {
      const blink = await host.blink();
      return "reason" in blink ? json({ code: "unavailable", error: blink.reason }, 503) : json(blink);
    }
    if (url.pathname === FACIAL_SOLVE_ENDPOINT && request.method === "POST") {
      if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ ok: false, code: "invalid", message: "Send JSON." }, 400);
      // Read within the limit, never whole first (CORE-106).
      let body: unknown;
      try { body = JSON.parse(await readBodyText(request, SOLVE_BODY_BYTES)); }
      catch (error) {
        if (error instanceof BodyTooLargeError) return json({ ok: false, code: "invalid", message: "That pose is too large." }, 413);
        return json({ ok: false, code: "invalid", message: "Invalid JSON." }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, code: "invalid", message: "Send a pose to solve." }, 400);
      return json(await host.solve(body as FacialSolveRequest));
    }
    return json({ code: "method", error: "Method not allowed." }, 405);
  };
}
