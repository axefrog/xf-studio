/**
 * Host service for the live facial preview (research/animation/expression-editor-design.md §5.2; both hosts share it). It reads the
 * player's face skeleton, facial setup and the game's normal blink from the winning files on the launch route (the same resolver Build
 * and the character details use), finds the installed photo-mode expressions the way the game finds them (the winning expression
 * table, clips by name among V's photo-mode face rig's animation sets, ArchiveXL patches of that rig included), and keeps the external
 * facial solver warm to answer solve requests, newest first.
 *
 * The solver is the Cyberpunk Blender add-on's (IO Suite), the same pinned, unmodified modules the idle and blink bakes run: a separate
 * GPL-3.0 program in its own checkout, started as `tools/facial_solver_server.py` and spoken to over stdin/stdout. None of its code is
 * in XF Studio. Where it isn't set up the preview says so plainly and editing still works (the controls are saved with the look).
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
import { BLINK_CLIP, EXPRESSION_TABLE, FACE_SETUP, FACE_SKELETON, FACIAL_ADDITIVES, PHOTO_MODE_FACE_RIG, readAnimSet, readBlink,
  readFaceRig, readFaceRigSets, readTable, startPoints, type SetClip } from "./facial-catalogue";
import { clipValuesAt, type ClipTracks } from "./engines/facial-rig/anim-tracks";
import { denseTracks, vectorIssue } from "./engines/facial-rig/vector";
import { CONTROL_GROUPS, type FacialVocabulary } from "./engines/facial-rig/vocabulary";
import type { RigRest } from "./engines/facial-rig/pose";
import { FACIAL_ENDPOINT, FACIAL_EXPRESSIONS_ENDPOINT, FACIAL_SOLVE_ENDPOINT, FACIAL_STATE_SCHEMA, type FacialBlink, type FacialHostState,
  type FacialSolveAnswer, type FacialSolveRequest, type FacialStartPoints } from "./platform/api/facial";

export { FACIAL_ENDPOINT, FACIAL_EXPRESSIONS_ENDPOINT, FACIAL_SOLVE_ENDPOINT } from "./platform/api/facial";

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

/** Where the solver lives: the add-on checkout, the Python that runs it and the server script; or why there is none, in plain words. */
export type FacialSolverLocation = { readonly addon: string; readonly python: string; readonly script: string } | { readonly missing: string };
export const SOLVER_MISSING = "The live face preview needs the facial solver from the Cyberpunk Blender add-on, which this version of " +
  "XF Studio can't set up by itself yet. You can still set every control: your expression is saved with the look.";

/**
 * Find the solver (localhost): `XFS_FACIAL_SOLVER` (the add-on checkout), else XF Studio's tools folder (`<tools>/io-suite/<pin>/`,
 * where a consented download will put it), else a checkout beside the repository (the developer layout the bakes use). Python is
 * `XFS_PYTHON`, else `python` on the path. The desktop passes no environment and no repository, so only its tools folder counts.
 */
export function locateFacialSolver(options: { env?: Readonly<Record<string, string | undefined>>; toolsRoot?: string | null;
  repoRoot?: string | null; script: string; pythonDefault?: string | null; exists?: (path: string) => boolean }): FacialSolverLocation {
  const exists = options.exists ?? existsSync, env = options.env ?? {};
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
export type FacialSolverSpawner = (location: Extract<FacialSolverLocation, { addon: string }>, rigJson: string, setupJson: string,
  options?: { log?: (message: string) => void }) => FacialSolverProcess;

/** Most characters of a line the solver printed that a log entry quotes. */
const LOGGED_LINE_CHARS = 200;
/**
 * The default spawner: `python facial_solver_server.py`, one JSON line per request and answer. Throws when the program can't be started
 * at all (no Python): the host turns that into plain words (CORE-99). A line that isn't an answer (a warning a module printed) is logged;
 * after the ready line it fails the oldest request waiting, since the host sends one at a time and that answer is lost (CORE-100).
 */
export const spawnFacialSolver: FacialSolverSpawner = (location, rigJson, setupJson, options = {}) => {
  const child = Bun.spawn([location.python, location.script, "--addon", location.addon, "--rig", rigJson, "--setup", setupJson],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true });
  return solverOverStreams(child, options.log);
};

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
  /** Test seams. */
  open?: (options: InstallationOptions) => Installation;
  extract?: FacialExtractor;
  spawn?: FacialSolverSpawner;
  now?: () => number;
};

type Rig = { vocabulary: FacialVocabulary; rest: RigRest; blink: { clip: ClipTracks; closedTime: number } | null; rigJson: string; setupJson: string };
type Preparation = { key: string; controller: AbortController; promise: Promise<void>;
  rig: FacialHostState["rig"]; rigData?: Rig; expressions: FacialStartPoints; solver: FacialHostState["solver"]; process?: FacialSolverProcess;
  /** The process must be replaced before the next solve (a solve timed out: it may have lost an answer). */
  stale?: boolean;
  /** When the solver was started again after it stopped, within the last `RESTART_WINDOW_MS` (CORE-101). */
  restarts: number[] };
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
/** A temporary extraction folder older than this was left by a host that ended mid-extraction, and is removed. */
export const STALE_TEMP_MS = 60 * 60_000;
/** Most pages whose solves wait at once; past it the oldest waiting one is answered superseded (CORE-104). */
export const MAX_WAITING_CLIENTS = 8;

const fingerprint = (path: string) => { try { const s = statSync(path); return `${path}|${s.size}|${s.mtimeMs}`; } catch { return path; } };
const NOT_SET_UP = "Live expressions read your V's face from your game files: set your game folder and WolvenKit in Game & tools.";
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
        main: rig.vocabulary.main, controls: rig.vocabulary.controls, groups: CONTROL_GROUPS, joints: rig.rest.joints } : entry.rig,
      solver: { ...entry.solver },
      blink: rig?.blink ? { available: true, closedTime: rig.blink.closedTime, duration: rig.blink.clip.duration, rate: BLINK_RATE } : { available: false },
      expressions: { phase: entry.expressions.phase, ...(entry.expressions.reason ? { reason: entry.expressions.reason } : {}), count: entry.expressions.items.length } };
  }
  expressions(): FacialStartPoints { return structuredClone(this.ensure().expressions); }
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
    this.current = null;
    entry?.controller.abort(); entry?.process?.dispose();
    await entry?.promise.catch(() => {});
    const before = await this.preparedBytes();
    for (const name of ["json", "start-points", "tmp"]) { try { rmSync(join(this.root, name), { recursive: true, force: true }); } catch { /* In use: kept. */ } }
    return { freed: Math.max(0, before - await this.preparedBytes()) };
  }

  private ensure(): Preparation {
    const settings = this.options.settings(), key = installationFingerprint(settings, this.installations);
    if (this.current?.key === key) return this.current;
    const previous = this.current;
    previous?.controller.abort(); previous?.process?.dispose();
    const entry: Preparation = { key, controller: new AbortController(), promise: Promise.resolve(),
      rig: { phase: "preparing" }, expressions: { phase: "preparing", items: [] }, solver: { phase: "starting" }, restarts: [] };
    this.current = entry;
    entry.promise = (previous?.promise ?? Promise.resolve()).catch(() => {}).then(() => this.prepare(entry, settings)).catch(error => {
      if (error instanceof Superseded || entry.controller.signal.aborted) return;
      hostFailure("facial", "facial_prepare_failed", "Your V's face couldn't be prepared for live expressions.", error, "warn");
      entry.rig = entry.rigData ? entry.rig : { phase: "failed", reason: plainFailure(error) };
      if (entry.expressions.phase === "preparing") entry.expressions = { phase: "failed", reason: "The installed expressions couldn't be read from your game files.", items: [] };
    });
    return entry;
  }

  private async prepare(entry: Preparation, settings: CharacterDetailSettings) {
    const signal = entry.controller.signal, superseded = () => { if (signal.aborted) throw new Superseded(); };
    if (!settings.gameRoot || !settings.wolvenKitCli || !existsSync(settings.wolvenKitCli)) {
      entry.rig = { phase: "unconfigured", reason: NOT_SET_UP };
      entry.expressions = { phase: "unconfigured", reason: NOT_SET_UP, items: [] };
      entry.solver = { phase: "missing", reason: NOT_SET_UP };
      return;
    }
    this.sweepTemporary();
    const cli = settings.wolvenKitCli, tool = wolvenKitIdentityKey(wolvenKitIdentity(cli));
    const installation = await this.installations.acquire({ gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: cli, cacheDir: this.options.resolverCache, log: this.options.log });
    superseded();
    const graph = installation.graph;
    // The face: skeleton, facial setup and the game's blink clip.
    const [skeletonRef, setupRef, additivesRef] = [FACE_SKELETON, FACE_SETUP, FACIAL_ADDITIVES].map(refFromPath) as [DepotRef, DepotRef, DepotRef];
    const files = await this.readJson(cli, tool, graph, [{ ref: skeletonRef, extension: "rig" }, { ref: setupRef, extension: "facialsetup" },
      { ref: additivesRef, extension: "anims" }], signal);
    superseded();
    const skeleton = files.get(skeletonRef.hash), setup = files.get(setupRef.hash);
    if (!skeleton || !setup) throw Error("The face skeleton or facial setup is missing from the game files.");
    const { vocabulary, rest } = readFaceRig(readDocument(skeleton.file), readDocument(setup.file));
    let blink: Rig["blink"] = null;
    try { const additives = files.get(additivesRef.hash); if (additives) blink = readBlink(readAnimSet(readDocument(additives.file)).clips, vocabulary); }
    catch (error) { hostFailure("facial", "blink_unreadable", `The game's blink (${BLINK_CLIP}) couldn't be read; expressions show without it.`, error, "warn"); }
    entry.rigData = { vocabulary, rest, blink, rigJson: skeleton.file, setupJson: setup.file };
    entry.rig = { phase: "ready" };
    this.startSolver(entry);
    // The installed expressions, after the face (the editor works without them).
    try { entry.expressions = await this.readStartPoints(installation, cli, tool, vocabulary, signal); }
    catch (error) {
      if (error instanceof Superseded || signal.aborted) throw error;
      hostFailure("facial", "start_points_failed", "The installed expressions couldn't be read.", error, "warn");
      entry.expressions = { phase: "failed", reason: "The installed photo-mode expressions couldn't be read from your game files. Start from rest instead.", items: [] };
    }
    // The face's own files stay; the animation sets beyond the budget go, least recently used first.
    this.keepJsonWithinBudget(new Set([skeleton.file, setup.file]));
    hostTrace().event("facial", "prepared", { controls: vocabulary.controls.length, joints: rest.joints.length, startPoints: entry.expressions.items.length,
      solver: entry.solver.phase });
  }

  /** Start (or start again) the solver for a preparation. A program that can't be started at all is "not set up" (CORE-99). */
  private startSolver(entry: Preparation) {
    const location = this.options.solver();
    if ("missing" in location) { entry.solver = { phase: "missing", reason: location.missing }; return; }
    entry.solver = { phase: "starting" };
    entry.stale = false;
    let process: FacialSolverProcess;
    try { process = (this.options.spawn ?? spawnFacialSolver)(location, entry.rigData!.rigJson, entry.rigData!.setupJson, { log: this.options.log }); }
    catch (error) {
      entry.process = undefined;
      hostFailure("facial", "solver_not_started", "The facial solver's program couldn't be started.", error, "warn");
      entry.solver = { phase: "missing", reason: SOLVER_NOT_SET_UP };
      return;
    }
    entry.process = process;
    void process.ready.then(result => {
      if (this.current !== entry || entry.process !== process) return;
      if (result.ok) { entry.solver = { phase: "ready", compileMs: result.compileMs }; this.options.log?.(`Facial solver ready (setup compiled in ${Math.round(result.compileMs)} ms).`); }
      else {
        hostFailure("facial", "solver_failed", "The facial solver couldn't start.", Error(result.error), "warn");
        entry.solver = { phase: "failed", reason: /Expected reviewed solver|local changes/.test(result.error)
          ? "The facial solver found isn't the reviewed version XF Studio uses, so the live face preview is off. Your expression is still saved with the look."
          : "The facial solver couldn't start, so the live face preview is off. Your expression is still saved with the look." };
      }
    });
  }
  /**
   * A ready solver that stopped (a crash) or is stuck is started again while the restart budget allows; past it the state says so
   * plainly, and the budget refills as old restarts age out (CORE-101). Answers whether a new process was started.
   */
  private checkSolver(entry: Preparation): boolean {
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
  private async readStartPoints(installation: Installation, cli: string, tool: string, vocabulary: FacialVocabulary,
    signal: AbortSignal): Promise<FacialStartPoints> {
    const graph = installation.graph;
    const identity = (ref: DepotRef) => { const winner = graph.locate(ref).lookup.winner; return winner ? fingerprint(winner.id) : "-"; };
    const rigRef = refFromPath(PHOTO_MODE_FACE_RIG), tableRef = refFromPath(EXPRESSION_TABLE);
    const sources = [FACE_SKELETON, FACE_SETUP, EXPRESSION_TABLE, PHOTO_MODE_FACE_RIG].map(path => identity(refFromPath(path)))
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
    const documents = await this.readJson(cli, tool, graph, sets.map(set => ({ ref: set.ref, extension: "anims" })), signal);
    const decoded: { path: string; provider: string; clips: ReadonlyMap<string, SetClip> }[] = [];
    for (const set of sets) {
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
    if (this.checkSolver(entry) && entry.process) await withTimeout(entry.process.ready, this.options.solveTimeoutMs ?? SOLVE_TIMEOUT_MS).catch(() => {});
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
    if (url.pathname === FACIAL_EXPRESSIONS_ENDPOINT && request.method === "GET") return json(host.expressions());
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
