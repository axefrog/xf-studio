/**
 * `runProductBuild`, the one package host service both hosts run (feature-module platform §6; PIPE-03). The
 * localhost server and the desktop host differ only in their adapter: where private roots live, how the
 * builder process is started, how Check's worker is found, and what their Build readiness checks. Everything
 * else is here, once: normalising the request (diagnostic knobs are dropped, PIPE-70), preparing each feature's
 * host prerequisites (Check plans on what they last left; Build prepares them), deadlines and cancellation,
 * error codes and their HTTP statuses, the one retry after a stale prerequisite, and the result gate (the
 * builder's answer must equal the host's own plan, file for file) before a candidate is moved into the store.
 * Never installs anything.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import {
  ExportRefusal, PACKAGE_BUILD_2, type FeatureCheck, type FeatureExporterEntry, type PackageBuildResult, type PackageCheckResult, type ProductBuild,
} from "../api/export";
import { checkProducts } from "./product-check";
import { runWorkerCheck, type CheckOutcome, type CheckRequest } from "./check-runner";
import { LOCAL_PACKAGE_2, readPackageManifest } from "./manifest";

/** One Check's deadline (a fresh worker; small compiles only). */
export const PACKAGE_CHECK_DEADLINE_MS = 15_000;
/** One Build's deadline, prerequisites included. */
export const PACKAGE_BUILD_DEADLINE_MS = 40 * 60_000;
/** Largest collection request either host accepts. */
export const MAX_PACKAGE_REQUEST_BYTES = 16_000_000;

export type PackageAction = "check" | "build";
/** A host prerequisite a feature's Build needs (eye makeup: the built-in eye plate, cut from the head the game loads). */
export interface HostPrerequisite {
  /** What Check plans on: what the last preparation left for this host's current setup (the cached plate's footprint), or null. */
  cached(): unknown | null;
  /** Prepare it for one Build; may take minutes. Throws an error carrying `code` and a plain message when it cannot. */
  prepare(signal: AbortSignal): Promise<PreparedPrerequisite>;
  /** The builder found it stale: forget it, so the next preparation starts afresh. */
  discard(prepared: PreparedPrerequisite): void;
}
/** A prepared prerequisite: what the builder is handed (paths), and what the host's own plan reads (footprint, provenance). */
export type PreparedPrerequisite = { readonly builder: unknown; readonly plan: unknown };
/** A finished builder process. */
export type BuilderRun = { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string;
  readonly stopped: "timeout" | "cancelled" | null; readonly error?: Error };

/** What a host supplies. */
export interface PackageHostAdapter {
  /** Every exporting feature the host composition registers. */
  readonly exporters: readonly FeatureExporterEntry[];
  /** The host's prerequisite preparers by ID, for its current settings. */
  readonly prerequisites: Readonly<Record<string, HostPrerequisite>>;
  /** Check: the worker entry (`tools/package_check_worker.ts` or the desktop's bundled copy). */
  readonly checkWorker: string;
  /** Build: why it cannot run on this host right now, in plain words (tools, game, private storage), or null. */
  buildIssue(): string | null | Promise<string | null>;
  /**
   * Build: fresh private roots (the snapshot folder, the builder's work and stage roots, all unique to this
   * Build), the candidate store verified results move into, and the tools the builder needs.
   */
  buildSetup(): { snapshot: string; work: string; stage: string; candidates: string; wolvenkit: string; gamepath: string;
    /** Makes a writable private root (and checks it is still private) before it is used. */
    ensurePrivate?(path: string): void };
  /** Run the builder once as a bounded process tree with these arguments (after the host's own builder entry). */
  runBuilder(args: readonly string[], options: { cwd: string; signal: AbortSignal; timeoutMs: number }): Promise<BuilderRun>;
  /** Where failure details go (the host log); never shown raw in the page. */
  log(scope: "check" | "build", code: string, message: string, detail?: unknown): void;
}

export type PackageHostOutcome =
  | { ok: true; result: PackageCheckResult | PackageBuildResult }
  | { ok: false; code: string; message: string; status: number };

const STATUS: Readonly<Record<string, number>> = {
  invalid_collection: 422, no_exportable_content: 422, namespace_duplicated: 422, package_conflict: 422,
  package_check_busy: 409, package_build_busy: 409, package_restart_pending: 409,
  package_check_timeout: 504, package_build_timeout: 504, package_check_cancelled: 499, package_build_cancelled: 499,
  package_check_worker_unavailable: 503, package_check_worker_failed: 503, package_build_unavailable: 503,
};
const failure = (code: string, message: string): PackageHostOutcome => ({ ok: false, code, message, status: STATUS[code] ?? 422 });
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const refusalOf = (error: unknown) => error instanceof ExportRefusal ? failure(error.code, error.message) : undefined;

/**
 * The request's collection as the builder gets it: identity-checked, with a prepared test candidate's diagnostic
 * knobs dropped (hosts never build one; PIPE-70). Throws `ExportRefusal("invalid_collection")`.
 */
export function hostCollection(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExportRefusal("invalid_collection",
    "Expected a named XF Studio collection with a stable UUID and at least one preset.");
  const { diagnostics: _knobs, ...collection } = value as Record<string, unknown>;
  return collection;
}

/** The error code the builder reported on its machine error line (`XFS_PACKAGE_ERROR=`), and the stale prerequisite if any. */
export function builderError(stderr: string): { code: string | null; message?: string; prerequisite?: string } {
  const line = stderr.split(/\r?\n/).reverse().find(value => value.startsWith("XFS_PACKAGE_ERROR="));
  if (!line) return { code: null };
  try {
    const value = JSON.parse(line.slice("XFS_PACKAGE_ERROR=".length)) as { code?: unknown; message?: unknown; prerequisite?: unknown };
    return { code: typeof value.code === "string" ? value.code : null,
      ...(typeof value.message === "string" ? { message: value.message } : {}),
      ...(typeof value.prerequisite === "string" ? { prerequisite: value.prerequisite } : {}) };
  } catch { return { code: null }; }
}
/** Refusals of the collection itself, whose plain message the person sees as the builder gave it. */
const REFUSALS = new Set(["no_exportable_content", "invalid_collection", "namespace_duplicated", "package_conflict"]);

function fileSha256(path: string): string {
  const digest = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), handle = openSync(path, "r");
  try { let count: number; while ((count = readSync(handle, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count)); }
  finally { closeSync(handle); }
  return digest.digest("hex");
}

/**
 * The result gate: a Build's answer must describe exactly the products the host planned itself (same features,
 * looks, omissions, hashes and prerequisite provenance), and each candidate folder below `root` must hold exactly
 * its manifest and the two files it names, with their lengths and hashes. Throws on the first difference.
 */
export function verifyProductBuildResult(built: PackageBuildResult, expected: PackageCheckResult, root: string): void {
  const mismatch = () => Error("Package manifest does not match this collection snapshot.");
  const outside = () => Error("Package result is outside the local dist directory.");
  if (built?.schema !== PACKAGE_BUILD_2 || built.installed !== false || built.gameRenderingVerified !== false ||
      built.collectionId !== expected.collectionId || built.collectionSha256 !== expected.collectionSha256 ||
      built.originalPresetCount !== expected.originalPresetCount || JSON.stringify(built.omissions) !== JSON.stringify(expected.omissions) ||
      !Array.isArray(built.products) || built.products.length !== expected.products.length) throw mismatch();
  const canonical = (path: string) => { try { return realpathSync.native(path); } catch { throw outside(); } };
  const canonicalRoot = canonical(resolve(root));
  const fold = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  built.products.forEach((product, index) => {
    const { package: pkg, manifest: manifestPath, archiveSha256, xlSha256, verifiedUnpackedFiles, installed, gameRenderingVerified, ...check } = product;
    if (JSON.stringify(check) !== JSON.stringify(expected.products[index]) || installed !== false || gameRenderingVerified !== false) throw mismatch();
    // Containment on canonical paths (a Windows 8.3 short form and its long form name one folder; a link must not lead out),
    // and lexically: the result must name the same folders below the root as its canonical path does.
    const final = resolve(pkg ?? ""), manifestFile = resolve(manifestPath ?? "");
    const canonicalFinal = canonical(final);
    const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
    if (!canonicalFinal.startsWith(canonicalRoot + sep) || !isFile(manifestFile) || canonical(manifestFile) !== resolve(canonicalFinal, "manifest.json"))
      throw outside();
    const below = relative(canonicalRoot, canonicalFinal).split(sep), parts = final.split(sep);
    const lexicalRoot = parts.slice(0, parts.length - below.length).join(sep);
    if (parts.length <= below.length || fold(parts.slice(-below.length).join(sep)) !== fold(below.join(sep)) ||
        ![resolve(root), canonicalRoot].some(item => fold(resolve(lexicalRoot)) === fold(item)))
      throw outside();
    if (lstatSync(final).isSymbolicLink() || lstatSync(manifestFile).isSymbolicLink() || resolve(manifestFile) !== resolve(final, "manifest.json"))
      throw Error("Package result is outside the local dist directory or uses a linked path.");
    const raw = JSON.parse(readFileSync(manifestFile, "utf8"));
    const manifest = readPackageManifest(raw, check.features[0]?.feature ?? "");
    const inventory = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error("Package contains a linked path.");
      if (entry.isDirectory()) return inventory(path);
      if (!entry.isFile()) throw Error("Package contains an unexpected file type.");
      return [path.slice(final.length + 1).replaceAll("\\", "/")];
    });
    if (JSON.stringify(inventory(final).sort()) !== JSON.stringify(["manifest.json", ...manifest.files.map(file => file.path)].sort()))
      throw Error("Package contains unexpected files.");
    for (const entry of manifest.files) {
      const payload = resolve(final, entry.path);
      if (!canonical(payload).startsWith(canonicalFinal + sep) || statSync(payload).size !== entry.bytes || fileSha256(payload) !== entry.sha256)
        throw Error("Package payload does not match its manifest.");
    }
    const features = check.features.map((feature: FeatureCheck) => ({ feature: feature.feature, exporter: feature.exporter, exporterVersion: feature.exporterVersion,
      namespace: feature.namespace, brand: feature.brand, selectorLabel: feature.selectorLabel, selector: feature.selector, presets: feature.presets,
      omissions: feature.omissions, experimental: feature.experimental, requirements: feature.requirements, packagedSha256: feature.packagedSha256,
      details: feature.details }));
    const recorded = (raw.features as Record<string, unknown>[]).map(({ planSha256: _plan, verification: _verified, ...rest }) => rest);
    if (raw.schema !== LOCAL_PACKAGE_2 || raw.productId !== check.productId || raw.modName !== check.modName || raw.nameSource !== check.nameSource ||
        raw.archive !== check.archive || raw.collectionId !== expected.collectionId || raw.collectionSha256 !== expected.collectionSha256 ||
        raw.originalPresetCount !== expected.originalPresetCount || JSON.stringify(raw.omissions) !== JSON.stringify(expected.omissions) ||
        JSON.stringify(raw.requirements) !== JSON.stringify(check.requirements) || JSON.stringify(recorded) !== JSON.stringify(features) ||
        archiveSha256 !== manifest.files[0].sha256 || xlSha256 !== manifest.files[1].sha256 ||
        verifiedUnpackedFiles !== manifest.verifiedUnpackedFiles || raw.installed !== false || raw.gameRenderingVerified !== false)
      throw mismatch();
  });
}

/**
 * The package host service: one Check and one Build at a time per host. Both hosts' HTTP handlers call it with the
 * parsed request (`{ action, collection }` only); the adapter supplies what differs between them.
 */
export class PackageHostService {
  private checking = false;
  private building = false;


  busy(action: PackageAction): boolean { return action === "check" ? this.checking : this.building; }

  /** Run one request with the host's adapter for it (made per request, so setup changes apply to the next one). */
  async run(adapter: PackageHostAdapter, action: PackageAction, value: unknown, signal: AbortSignal,
    /** The request's deadline; defaults to `PACKAGE_CHECK_DEADLINE_MS` or `PACKAGE_BUILD_DEADLINE_MS`. */
    timeoutMs?: number): Promise<PackageHostOutcome> {
    if (action === "check") {
      if (this.checking) return failure("package_check_busy", "A package Check is already running. Wait for its result before starting another.");
      this.checking = true;
      try { return await this.check(adapter, value, signal, timeoutMs ?? PACKAGE_CHECK_DEADLINE_MS); } finally { this.checking = false; }
    }
    if (this.building) return failure("package_build_busy", "A package Build is already running. Wait for its result before starting another.");
    this.building = true;
    try { return await runProductBuild(adapter, value, signal, timeoutMs ?? PACKAGE_BUILD_DEADLINE_MS); } finally { this.building = false; }
  }

  private async check(adapter: PackageHostAdapter, value: unknown, signal: AbortSignal, timeoutMs: number): Promise<PackageHostOutcome> {
    let collection: Record<string, unknown>, prerequisites: Record<string, unknown>;
    try {
      collection = hostCollection(value);
      // Check plans on what each prerequisite last left for this host's setup (the plate the last Build prepared).
      prerequisites = {};
      for (const [id, prerequisite] of Object.entries(adapter.prerequisites)) {
        let cached: unknown = null;
        try { cached = prerequisite.cached(); } catch { cached = null; }
        if (cached !== null && cached !== undefined) prerequisites[id] = cached;
      }
    } catch (error) { return refusalOf(error) ?? failure("invalid_collection", (error as Error).message); }
    const request: CheckRequest = { collection, prerequisites, collectionSha256: sha256(JSON.stringify(collection)) };
    const outcome: CheckOutcome = await runWorkerCheck(request, adapter.checkWorker, timeoutMs, signal);
    if (outcome.kind === "failure") {
      if (outcome.code !== "package_check_cancelled" && outcome.code !== "no_exportable_content") adapter.log("check", outcome.code, outcome.message);
      return failure(outcome.code, outcome.message);
    }
    // The worker's answer must be the host's own plan of the same snapshot (the preflight's compile aside).
    try {
      const own = checkProducts({ collection, exporters: adapter.exporters, prerequisites, diagnostics: false, preflight: false,
        collectionSha256: request.collectionSha256 }).result;
      if (JSON.stringify(own) !== JSON.stringify(outcome.result)) throw Error("Package preflight returned a different collection identity.");
    } catch (error) {
      adapter.log("check", "package_check_failed", (error as Error).message, error);
      return refusalOf(error) ?? failure("package_check_failed", (error as Error).message);
    }
    return { ok: true, result: outcome.result };
  }
}

/**
 * Build every product of a collection into verified private candidates: prepare the prerequisites its features
 * need, plan on them, run the builder once as a bounded process tree, gate its answer against the host's own plan in
 * the stage root, move each candidate into the store and gate it again. One retry when the builder finds a
 * prerequisite stale (PIPE-37). Never throws; never installs.
 */
export async function runProductBuild(adapter: PackageHostAdapter, value: unknown, signal: AbortSignal,
  timeoutMs = PACKAGE_BUILD_DEADLINE_MS): Promise<PackageHostOutcome> {
  const started = Date.now();
  const first = await attempt(adapter, value, signal, timeoutMs, false);
  if (first !== RETRY) return first;
  const second = await attempt(adapter, value, signal, Math.max(1, timeoutMs - (Date.now() - started)), true);
  return second === RETRY ? failure("package_build_failed", "Package Build failed. No candidate was published.") : second;
}

/** The builder found a prerequisite stale and it was discarded: build once more. */
const RETRY = Symbol("retry");

async function attempt(adapter: PackageHostAdapter, value: unknown, signal: AbortSignal, timeoutMs: number,
  retried: boolean): Promise<PackageHostOutcome | typeof RETRY> {
  const started = Date.now();
  let issue: string | null;
  try { issue = await adapter.buildIssue(); }
  catch (error) { adapter.log("build", "package_build_unavailable", "Build readiness could not be checked.", error); issue = "Package Build could not check its setup. Restart XF Studio and try again."; }
  if (issue) return failure("package_build_unavailable", issue);
  let collection: Record<string, unknown>;
  try { collection = hostCollection(value); } catch (error) { return refusalOf(error)!; }
  const source = JSON.stringify(collection), collectionSha256 = sha256(source);
  // Refuse what no prerequisite can change (nothing exportable, a damaged plan) before preparing anything.
  try { checkProducts({ collection, exporters: adapter.exporters, prerequisites: {}, diagnostics: false, preflight: false, collectionSha256 }); }
  catch (error) {
    const refused = refusalOf(error);
    if (refused) return refused;
    adapter.log("build", "package_build_failed", (error as Error).message, error);
    return failure("package_build_failed", "Package Build could not plan these mod files. No candidate was published.");
  }
  // Which features this collection holds decides which prerequisites to prepare.
  const present = adapter.exporters.filter(entry => { try { return entry.exporter.present(collection); } catch { return false; } });
  const needed = [...new Set(present.flatMap(entry => entry.exporter.prerequisites))];
  const missing = needed.filter(id => !adapter.prerequisites[id]);
  if (missing.length) return failure("package_build_unavailable", "This host can't prepare everything these mod files need.");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const stop = () => deadline.abort();
  signal.addEventListener("abort", stop, { once: true });
  const stopped = () => signal.aborted ? failure("package_build_cancelled", "Package Build was cancelled. Your draft is unchanged; nothing was installed.")
    : failure("package_build_timeout", "Package Build exceeded its time limit and was stopped. Your draft is unchanged; nothing was installed.");
  const prepared: Record<string, PreparedPrerequisite> = {};
  let setup: ReturnType<PackageHostAdapter["buildSetup"]> | undefined;
  try {
    for (const id of needed) {
      try { prepared[id] = await adapter.prerequisites[id].prepare(deadline.signal); }
      catch (error) {
        if (deadline.signal.aborted) return stopped();
        // A prerequisite's own failure carries its code and a plain message (eye makeup: which head, which mod, the next step).
        const code = (error as { code?: unknown })?.code;
        if (typeof code === "string") return failure(code, (error as Error).message);
        adapter.log("build", "package_build_failed", (error as Error).message, error);
        return failure("package_build_failed", "Something XF Studio needs for these mod files could not be prepared. No candidate was published.");
      }
    }
    // The host's own plan, on the prepared prerequisites: what the builder's answer must equal.
    let expected: PackageCheckResult;
    try {
      expected = checkProducts({ collection, exporters: adapter.exporters, collectionSha256, diagnostics: false, preflight: false,
        prerequisites: Object.fromEntries(Object.entries(prepared).map(([id, item]) => [id, item.plan])) }).result;
    } catch (error) {
      const refused = refusalOf(error);
      if (refused) return refused;
      adapter.log("build", "package_build_failed", (error as Error).message, error);
      return failure("package_build_failed", "Package Build could not plan these mod files. No candidate was published.");
    }
    setup = adapter.buildSetup();
    for (const path of [setup.snapshot, setup.work, setup.stage, setup.candidates]) setup.ensurePrivate?.(path);
    mkdirSync(setup.snapshot, { recursive: true, mode: 0o700 });
    const snapshot = resolve(setup.snapshot, "collection.json"), prerequisites = resolve(setup.snapshot, "prerequisites.json");
    writeFileSync(snapshot, source, { mode: 0o600, flag: "wx" });
    writeFileSync(prerequisites, JSON.stringify(Object.fromEntries(Object.entries(prepared).map(([id, item]) => [id, item.builder]))),
      { mode: 0o600, flag: "wx" });
    const run = await adapter.runBuilder(["--collection", snapshot, "--prerequisites", prerequisites, "--wolvenkit", setup.wolvenkit,
      "--gamepath", setup.gamepath, "--build-root", setup.work, "--dist-root", setup.stage, "--machine-result"],
    { cwd: setup.snapshot, signal: deadline.signal, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)) });
    if (run.stopped || deadline.signal.aborted) return stopped();
    if (run.exitCode !== 0) {
      const reported = builderError(run.stderr);
      if (!retried && reported.code === "package_prerequisite_stale" && reported.prerequisite && prepared[reported.prerequisite]) {
        adapter.log("build", "package_prerequisite_stale", `The builder found ${reported.prerequisite} stale; preparing it again.`);
        try { adapter.prerequisites[reported.prerequisite].discard(prepared[reported.prerequisite]); }
        catch (error) { adapter.log("build", "package_build_failed", (error as Error).message, error);
          return failure("package_build_failed", "Package Build failed. No candidate was published."); }
        return RETRY;
      }
      adapter.log("build", reported.code ?? "package_build_failed", `The package builder failed (exit ${run.exitCode}).`,
        { message: (run.error?.message ?? run.stderr.trim()).slice(-3_500) });
      if (reported.code && REFUSALS.has(reported.code) && reported.message) return failure(reported.code, reported.message);
      return failure("package_build_failed", "Package Build failed. See the log for details. Your draft is unchanged; nothing was installed.");
    }
    const line = run.stdout.split(/\r?\n/).reverse().find(item => item.startsWith("XFS_PACKAGE_RESULT="));
    if (!line) return failure("package_build_failed", "Package Build completed without a result. No candidate was published.");
    try {
      const built = JSON.parse(line.slice("XFS_PACKAGE_RESULT=".length)) as PackageBuildResult;
      verifyProductBuildResult(built, expected, setup.stage);
      // Move each verified candidate into the store, then gate it there again.
      setup.ensurePrivate?.(setup.candidates);
      mkdirSync(setup.candidates, { recursive: true, mode: 0o700 });
      const products: ProductBuild[] = built.products.map(product => {
        const promoted = resolve(setup!.candidates, basename(product.package));
        if (existsSync(promoted)) throw Error("A candidate with this name already exists.");
        renameSync(product.package, promoted);
        return { ...product, package: promoted, manifest: resolve(promoted, "manifest.json") };
      });
      const result: PackageBuildResult = { ...built, products };
      verifyProductBuildResult(result, expected, setup.candidates);
      return { ok: true, result };
    } catch (error) {
      adapter.log("build", "package_build_failed", `The package result failed verification: ${(error as Error).message}`, error);
      return failure("package_build_failed", "Package Build could not verify its result. No candidate was published.");
    }
  } catch (error) {
    if (deadline.signal.aborted) return stopped();
    adapter.log("build", "package_build_failed", "Package Build could not start.", error);
    return failure("package_build_failed", "Package Build could not start. No candidate was published.");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    if (setup) for (const path of [setup.snapshot, setup.work, setup.stage]) rmSync(path, { recursive: true, force: true });
  }
}
