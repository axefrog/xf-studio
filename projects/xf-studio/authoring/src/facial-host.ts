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
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { MountedArchive } from "./archive-precedence";
import { installationFingerprint, type CharacterDetailSettings } from "./character-detail-host";
import { writeFileAtomic } from "./derived-cache";
import { depotHash, refFromHash, refFromPath, type DepotRef } from "./depot-path";
import { installations, InstallationRegistry } from "./installation-registry";
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
/** Most frames one solve may ask for (the blink clip at 60 Hz is 31). */
export const MAX_SOLVE_FRAMES = 64;
/** Version of what the start-point cache holds; part of its key. */
export const START_POINT_VERSION = 2;
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
export type FacialSolverSpawner = (location: Extract<FacialSolverLocation, { addon: string }>, rigJson: string, setupJson: string) => FacialSolverProcess;

/** The default spawner: `python facial_solver_server.py`, one JSON line per request and answer. */
export const spawnFacialSolver: FacialSolverSpawner = (location, rigJson, setupJson) => {
  const child = Bun.spawn([location.python, location.script, "--addon", location.addon, "--rig", rigJson, "--setup", setupJson],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true });
  const pending = new Map<number, { resolve(value: { q: string; t: string; ms: number }): void; reject(error: Error): void }>();
  let exited = false, nextId = 1, readyResolve!: (value: Awaited<FacialSolverProcess["ready"]>) => void;
  const ready = new Promise<Awaited<FacialSolverProcess["ready"]>>(done => { readyResolve = done; });
  let errors = "";
  void (async () => { for await (const chunk of child.stderr) errors = (errors + new TextDecoder().decode(chunk)).slice(-4000); })().catch(() => {});
  void (async () => {
    let buffer = "", started = false;
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk);
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let message: Record<string, unknown>;
        try { message = JSON.parse(line); } catch { continue; }
        if (!started) { started = true; readyResolve(message.ready === true ? { ok: true, compileMs: Number(message.compileMs) } : { ok: false, error: String(message.error ?? "The solver didn't start.") }); continue; }
        const waiter = pending.get(Number(message.id));
        if (!waiter) continue;
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
        child.stdin.write(JSON.stringify({ id, frames: frames.map(frame => Array.from(frame)) }) + "\n");
        child.stdin.flush();
      });
    },
    dispose() { try { child.stdin.end(); } catch { /* already closed */ } child.kill(); },
  };
};

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
  /** Test seams. */
  open?: (options: InstallationOptions) => Installation;
  extract?: FacialExtractor;
  spawn?: FacialSolverSpawner;
};

type Rig = { vocabulary: FacialVocabulary; rest: RigRest; blink: { clip: ClipTracks; closedTime: number } | null; rigJson: string; setupJson: string };
type Preparation = { key: string; controller: AbortController; promise: Promise<void>;
  rig: FacialHostState["rig"]; rigData?: Rig; expressions: FacialStartPoints; solver: FacialHostState["solver"]; process?: FacialSolverProcess;
  /** Times the solver was started again after it stopped. */
  restarts?: number };
class Superseded extends Error {}

const fingerprint = (path: string) => { try { const s = statSync(path); return `${path}|${s.size}|${s.mtimeMs}`; } catch { return path; } };
const NOT_SET_UP = "Live expressions read your V's face from your game files: set your game folder and WolvenKit in Game & tools.";
const plainFailure = (error: unknown) => error instanceof WolvenKitRunError
  ? (error.code === "runtime_missing" ? "WolvenKit needs its .NET runtime before your V's face can be read." : "WolvenKit couldn't read your V's face from your game files.")
  : "Your V's face couldn't be read from your game files.";

/**
 * One preparation per installation fingerprint (the character details' key), superseded when the mod setup changes, as the grading
 * LUT host does. Solves run one at a time; a newer request replaces one still waiting (answered `superseded`), so a drag never queues
 * stale solves.
 */
export class FacialHost {
  private current: Preparation | null = null;
  private readonly installations: InstallationRegistry;
  private running: Promise<void> | null = null;
  private waiting: { request: FacialSolveRequest; resolve(answer: FacialSolveAnswer): void } | null = null;
  constructor(private readonly options: FacialHostOptions) {
    this.installations = options.open ? new InstallationRegistry({ open: options.open }) : installations;
  }
  private get root() { return join(this.options.cacheRoot, "facial"); }

  /** The state for the current installation; starts preparing when it changed. */
  state(): FacialHostState {
    const entry = this.ensure(), rig = entry.rigData;
    return { schema: FACIAL_STATE_SCHEMA,
      rig: rig ? { ...entry.rig, skeleton: rig.vocabulary.rig, setup: rig.vocabulary.setup, tracks: rig.vocabulary.tracks, reference: rig.vocabulary.reference,
        main: rig.vocabulary.main, controls: rig.vocabulary.controls, groups: CONTROL_GROUPS, joints: rig.rest.joints } : entry.rig,
      solver: entry.solver,
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

  private ensure(): Preparation {
    const settings = this.options.settings(), key = installationFingerprint(settings, this.installations);
    if (this.current?.key === key) return this.current;
    const previous = this.current;
    previous?.controller.abort(); previous?.process?.dispose();
    const entry: Preparation = { key, controller: new AbortController(), promise: Promise.resolve(),
      rig: { phase: "preparing" }, expressions: { phase: "preparing", items: [] }, solver: { phase: "starting" } };
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
    try { entry.expressions = await this.readStartPoints(entry, installation, cli, tool, vocabulary, signal); }
    catch (error) {
      if (error instanceof Superseded || signal.aborted) throw error;
      hostFailure("facial", "start_points_failed", "The installed expressions couldn't be read.", error, "warn");
      entry.expressions = { phase: "failed", reason: "The installed photo-mode expressions couldn't be read from your game files. Start from rest instead.", items: [] };
    }
    hostTrace().event("facial", "prepared", { controls: vocabulary.controls.length, joints: rest.joints.length, startPoints: entry.expressions.items.length,
      solver: entry.solver.phase });
  }

  private startSolver(entry: Preparation) {
    const location = this.options.solver();
    if ("missing" in location) { entry.solver = { phase: "missing", reason: location.missing }; return; }
    entry.solver = { phase: "starting" };
    const process = (this.options.spawn ?? spawnFacialSolver)(location, entry.rigData!.rigJson, entry.rigData!.setupJson);
    entry.process = process;
    void process.ready.then(result => {
      if (this.current !== entry) return;
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
   * Put resources from their winning archives in the cache as untrimmed JSON (by the reference's hash; ArchiveXL copies and links
   * followed), keyed by WolvenKit identity, archive and hash. Answers each asked reference's cache file (read it with `document`), so
   * no more than one document is held at a time.
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
      if (existsSync(file)) { out.set(ref.hash, { file, archive }); continue; }
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

  private async readStartPoints(entry: Preparation, installation: Installation, cli: string, tool: string, vocabulary: FacialVocabulary,
    signal: AbortSignal): Promise<FacialStartPoints> {
    const cache = join(this.root, "start-points", `${createHash("sha256").update(`${START_POINT_VERSION}|${entry.key}`).digest("hex")}.json`);
    if (existsSync(cache)) { try { return JSON.parse(readFileSync(cache, "utf8")) as FacialStartPoints; } catch { /* read again */ } }
    const graph = installation.graph;
    // Whole documents from the winning archive (the resolver's graph keeps only the shapes it models).
    const document = async (ref: ReturnType<typeof refFromPath>, extension: string) => {
      const winner = graph.locate(ref).lookup.winner;
      return winner ? (await installation.fetcher.fetch(winner, graph.locate(ref).entry, extension))?.document ?? null : null;
    };
    const tableRef = refFromPath(EXPRESSION_TABLE), table = await document(tableRef, "csv");
    if (!table) return { phase: "failed", reason: "Photo mode's expression table wasn't found in your game files. Start from rest instead.", items: [] };
    const tableProvider = providerLabel(graph.locate(tableRef).lookup.winner);
    const rows = readTable(table);
    // V's photo-mode face rig and every ArchiveXL patch of it, in patch order.
    const rigRef = refFromPath(PHOTO_MODE_FACE_RIG), rig = await document(rigRef, "app");
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
    try { mkdirSync(join(this.root, "start-points"), { recursive: true }); writeFileAtomic(cache, JSON.stringify(result)); } catch { /* Advisory. */ }
    return result;
  }

  /** Solve a held expression (with the blink composed before the solve, as the game adds blink tracks first). Newest request wins. */
  solve(request: FacialSolveRequest): Promise<FacialSolveAnswer> {
    return new Promise(resolveAnswer => {
      this.waiting?.resolve({ ok: false, code: "superseded", message: "A newer pose was asked for." });
      this.waiting = { request, resolve: resolveAnswer };
      this.pump();
    });
  }
  private pump() {
    if (this.running || !this.waiting) return;
    const { request, resolve: done } = this.waiting;
    this.waiting = null;
    this.running = this.solveNow(request).then(done, error => done({ ok: false, code: "failed", message: plainSolveFailure(error) }))
      .finally(() => { this.running = null; this.pump(); });
  }
  private async solveNow(request: FacialSolveRequest): Promise<FacialSolveAnswer> {
    // The current preparation (a route change is noticed by the next state poll, not on every solve).
    const entry = this.current ?? this.ensure(), rig = entry.rigData, process = entry.process;
    const issue = vectorIssue(request.controls) ?? blinkIssue(request.blink);
    if (issue) return { ok: false, code: "invalid", message: issue };
    if (!rig) return { ok: false, code: "unavailable", message: entry.rig.reason ?? "Your V's face is still being prepared." };
    // A solver that stopped (a crash) is started again, at most a few times per preparation; the drawer's Try again asks once more.
    if (process?.exited && entry.solver.phase === "ready" && (entry.restarts = (entry.restarts ?? 0) + 1) <= 3) { process.dispose(); this.startSolver(entry); }
    if (!entry.process || entry.solver.phase !== "ready") return { ok: false, code: "unavailable", message: entry.solver.reason ?? "The facial solver is starting." };
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
    const answer = await entry.process.solve(frames);
    return { ok: true, frames: frames.length, ...(rate ? { rate } : {}), q: answer.q, t: answer.t, ms: answer.ms, skipped };
  }
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
      const text = await request.text();
      if (text.length > 64_000) return json({ ok: false, code: "invalid", message: "That pose is too large." }, 413);
      let body: FacialSolveRequest;
      try { body = JSON.parse(text); } catch { return json({ ok: false, code: "invalid", message: "Invalid JSON." }, 400); }
      return json(await host.solve(body));
    }
    return json({ code: "method", error: "Method not allowed." }, 405);
  };
}
