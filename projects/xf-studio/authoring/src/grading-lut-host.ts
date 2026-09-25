/**
 * Host service for the creator preset's colour-grading LUT (both hosts share it). It opens the launch
 * route with the generic resolver (the same source discovery and archive precedence Build and the character
 * details use), reads the creator environment's SDR LUT path, and picks the LUT resource that wins that path
 * (grading-lut.ts `selectGradingLut`). The winner is extracted with WolvenKit into a temporary folder, its
 * texel blob decoded, and the decoded cube stored content-addressed in the host's private cache. No mod is
 * named anywhere: a LUT mod works because its archive wins the vanilla LUT path.
 *
 * Read-only towards the game and MO2. The resolver's trimmed JSON cache drops texture blobs, so the LUT is
 * extracted separately here, in a unique temporary folder, through the shared WolvenKit runner (time limit,
 * exit and log rules, cancellation, missing .NET); only the decoded cube is kept, keyed by the archive,
 * the decoder version and the WolvenKit identity.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MountedArchive } from "./archive-precedence";
import { installationFingerprint, type CharacterDetailSettings } from "./character-detail-host";
import { writeFileAtomic } from "./derived-cache";
import { refFromPath } from "./depot-path";
import { CREATOR_ENVIRONMENT, GRADING_LUT_ASSET_PREFIX, GRADING_LUT_FILE, GRADING_LUT_STATE_SCHEMA, decodeGradingLut, decodeGradingLutBinary, encodeGradingLut, GradingLutError, readEnvironmentGrading, selectGradingLut,
  supportedMapping, type GradingLut, type GradingLutSource } from "./grading-lut";
import type { Installation, InstallationOptions } from "./resolver-host";
import { InstallationRegistry, installations } from "./installation-registry";
import { runWolvenKit, WOLVENKIT_RUNTIME_MISSING_MESSAGE, wolvenKitIdentity, wolvenKitIdentityKey, WolvenKitRunError } from "./wolvenkit-cli";

export { GRADING_LUT_ASSET_PREFIX, GRADING_LUT_ENDPOINT } from "./grading-lut";

export type GradingLutState = {
  schema: typeof GRADING_LUT_STATE_SCHEMA;
  phase: "preparing" | "ready";
  /** Present once ready. `file` is null when the neutral grade applies. */
  source: GradingLutSource | null;
  file: string | null;
};

export type GradingLutHostOptions = {
  /** Host-owned private preview cache; decoded LUTs live in `grading-lut/`. */
  cacheRoot: string;
  /** Resolver JSON and archive-index cache (shared with the character details). */
  resolverCache: string;
  settings: () => CharacterDetailSettings;
  log?: (message: string) => void;
  /** Time before the first retry of a transient failure, doubled for each later one (default `GRADING_LUT_RETRY_MS`). */
  retryAfterMs?: number;
  /** Test seams. */
  open?: (options: InstallationOptions) => Installation;
  extract?: (cli: string, archive: MountedArchive, hash: string, workDir: string, signal?: AbortSignal) => Promise<unknown>;
  now?: () => number;
};

const NOT_SET_UP = "Colour grading: the game's LUT appears once your game folder and WolvenKit are set up. A neutral grade is shown for now.";

/** Cache identity of an archive: its path, size and modification time (the id alone when it is not a file). */
const fingerprint = (path: string) => { try { const s = statSync(path); return `${path}|${s.size}|${s.mtimeMs}`; } catch { return path; } };

/** Time limit of one WolvenKit step (unbundle or convert) of the LUT extraction. */
export const GRADING_LUT_STEP_TIMEOUT_MS = 2 * 60_000;
/** Version of `decodeGradingLut`'s output; part of the decoded-LUT cache key, so a decoder change decodes again. */
export const GRADING_LUT_DECODER_VERSION = 1;
/** A preparation that failed for a transient reason (time limit, .NET, disk) is first tried again after this long, then after twice as long each time. */
export const GRADING_LUT_RETRY_MS = 30_000;
/** At most this many retries per installation fingerprint (30 s, 1, 2, 4 and 8 min by default); then only a change or a restart tries again. */
export const GRADING_LUT_MAX_RETRIES = 5;

/** Extract one resource from one archive with WolvenKit and return its untrimmed JSON. */
export async function extractUntrimmedJson(cli: string, archive: MountedArchive, hash: string, workDir: string, signal?: AbortSignal): Promise<unknown> {
  mkdirSync(workDir, { recursive: true });
  const dir = mkdtempSync(join(workDir, `lut-${process.pid}-`)), raw = join(dir, "raw");
  const run = (args: string[]) => runWolvenKit(cli, args, { signal, timeoutMs: GRADING_LUT_STEP_TIMEOUT_MS, keep: 16_000 });
  try {
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(dir, "hashes.txt"), `${hash}\n`);
    await run(["unbundle", archive.id, "-o", raw, "--hash", join(dir, "hashes.txt")]);
    const files: string[] = [];
    const walk = (folder: string) => { for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (lstatSync(full).isDirectory()) walk(full); else if (!name.endsWith(".json")) files.push(full);
    } };
    walk(raw);
    if (files.length !== 1) throw new GradingLutError(files.length ? "More than one resource was extracted." : "WolvenKit did not extract the LUT.");
    let file = files[0]!;
    if (!file.endsWith(".xbm")) { const renamed = `${file.replace(/\.[^.\\/]+$/, "")}.xbm`; renameSync(file, renamed); file = renamed; }
    await run(["convert", "s", raw]);
    if (!existsSync(`${file}.json`)) throw new GradingLutError("WolvenKit could not convert the LUT.");
    return JSON.parse(readFileSync(`${file}.json`, "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** When XF Studio tries again, as the plain note says it: shortly, or once something changes. */
const tryAgain = (retry: boolean) => retry ? "XF Studio tries again shortly."
  : "XF Studio tries again when your game, mods or WolvenKit change, or when XF Studio restarts.";

/** Plain note for a failure that left the neutral grade. */
function failureNote(error: unknown, retry: boolean): string {
  if (error instanceof WolvenKitRunError) {
    if (error.code === "runtime_missing") return `Colour grading: ${WOLVENKIT_RUNTIME_MISSING_MESSAGE} A neutral grade is shown until it is. ${tryAgain(retry)}`;
    if (error.code === "tool_timeout") return `Colour grading: reading the game's LUT took too long, so a neutral grade is shown for now. ${tryAgain(retry)}`;
    return `Colour grading: WolvenKit couldn't read the game's LUT, so a neutral grade is shown for now. ${tryAgain(retry)}`;
  }
  return `Colour grading: the game's LUT couldn't be read, so a neutral grade is shown for now. ${tryAgain(retry)}`;
}

/**
 * A LUT extraction failure that repeats while the archive, the entry and WolvenKit are unchanged (the cache key
 * holds all three): WolvenKit ran and reported failure (an exit code, or an unhandled exception in its log), or
 * what it wrote could not be read or decoded. A time limit, a missing .NET runtime, a process that could not
 * start and a disk error are transient.
 */
const lastingFailure = (error: unknown) =>
  error instanceof WolvenKitRunError ? error.code === "tool_failed" && error.exitCode !== null : error instanceof GradingLutError;

type Attempt = { source: GradingLutSource; file: string | null; failure: unknown };
type Preparation = { key: string; state: GradingLutState; promise: Promise<void>; controller: AbortController;
  /** Transient failures so far, and when the next retry is due (null when none is). */
  failures: number; retryAt: number | null };
class Superseded extends Error {}

/**
 * One preparation at a time, keyed by the installation fingerprint the character details use. A changed
 * installation supersedes the running preparation: its WolvenKit run is stopped at once, but source discovery
 * (synchronous) and a resource load already under way finish first, and the new preparation starts once it has
 * settled.
 *
 * Failures (PREV-45). A transient failure (time limit, missing .NET, a process that could not start, a disk
 * error) answers with the neutral grade and is tried again on a request after `GRADING_LUT_RETRY_MS`, doubling
 * each time, at most `GRADING_LUT_MAX_RETRIES` times. A retry reuses the installation the registry keeps open for the
 * route (installation-registry.ts: no second discovery while the mod setup is unchanged, and a fresh resource graph
 * when a read failed in a way that may not repeat) and re-extracts only what failed: decoded LUTs are cached on disk and failures
 * that repeat are remembered. While it runs, the answer already given stands. A lasting failure (see
 * `lastingFailure`) is not tried again until its archive or WolvenKit changes or the host restarts.
 */
export class GradingLutHost {
  private current: Preparation | null = null;
  /** The shared registry, or a private one over the `open` test seam. */
  private readonly installations: InstallationRegistry;
  /** Extractions that failed in a way that repeats, by decoded-LUT cache key: not tried again while the key holds. */
  private readonly lasting = new Map<string, string>();
  constructor(private readonly options: GradingLutHostOptions) {
    this.installations = options.open ? new InstallationRegistry({ open: options.open }) : installations;
  }

  private get root() { return join(this.options.cacheRoot, "grading-lut"); }
  private now() { return this.options.now?.() ?? Date.now(); }

  /** The LUT state for the host's current installation; starts preparing when the installation changed or a retry is due. */
  request(): GradingLutState {
    const settings = this.options.settings(), key = installationFingerprint(settings);
    const known = this.current;
    if (known?.key === key) {
      if (known.retryAt !== null && this.now() >= known.retryAt) this.run(known, settings, known.promise);
      return structuredClone(known.state);
    }
    known?.controller.abort();
    const entry: Preparation = { key, state: { schema: GRADING_LUT_STATE_SCHEMA, phase: "preparing", source: null, file: null },
      promise: Promise.resolve(), controller: new AbortController(), failures: 0, retryAt: null };
    this.current = entry;
    // A superseded preparation settles (its WolvenKit run is stopped) before the next one starts.
    this.run(entry, settings, known?.promise ?? Promise.resolve());
    return structuredClone(entry.state);
  }

  async settled(): Promise<void> { await this.current?.promise; }

  /** Start (or retry) `entry` once `after` has settled. Never rejects. */
  private run(entry: Preparation, settings: CharacterDetailSettings, after: Promise<void>): void {
    const controller = new AbortController();
    entry.controller = controller; entry.retryAt = null;
    const start = () => controller.signal.aborted ? Promise.reject(new Superseded()) : this.prepare(settings, entry.key, controller.signal);
    entry.promise = after.then(start)
      .then(result => {
        const retry = result.failure !== null && this.scheduleRetry(entry);
        // A transient failure that left the neutral grade says so plainly, and when XF Studio tries again.
        const source = result.failure !== null && result.source.kind === "neutral" ? { ...result.source, note: failureNote(result.failure, retry) } : result.source;
        entry.state = { schema: GRADING_LUT_STATE_SCHEMA, phase: "ready", source, file: result.file };
      })
      .catch(error => {
        if (error instanceof Superseded || controller.signal.aborted) return;
        this.options.log?.(`Colour grading LUT not prepared: ${(error as Error)?.stack ?? error}`);
        entry.state = { schema: GRADING_LUT_STATE_SCHEMA, phase: "ready", file: null, source: neutralSource(failureNote(error, this.scheduleRetry(entry))) };
      });
  }

  /** Count a transient failure and schedule the next retry with backoff; false once the retries are used up. */
  private scheduleRetry(entry: Preparation): boolean {
    entry.failures++;
    if (entry.failures > GRADING_LUT_MAX_RETRIES) return false;
    entry.retryAt = this.now() + (this.options.retryAfterMs ?? GRADING_LUT_RETRY_MS) * 2 ** (entry.failures - 1);
    return true;
  }

  /** The decoded LUT a cache index names, or null when it names none or its file is missing or damaged. */
  private cachedLut(index: string): { lut: GradingLut; name: string } | null {
    try {
      if (!existsSync(index)) return null;
      const name = readFileSync(index, "utf8").trim(), file = join(this.root, "files", name);
      if (!GRADING_LUT_FILE.test(name) || !existsSync(file)) return null;
      return { lut: decodeGradingLutBinary(new Uint8Array(readFileSync(file))), name };
    } catch { return null; }
  }

  private async prepare(settings: CharacterDetailSettings, key: string, signal: AbortSignal): Promise<Attempt> {
    if (!settings.gameRoot || !settings.wolvenKitCli || !existsSync(settings.wolvenKitCli))
      return { source: neutralSource(NOT_SET_UP), file: null, failure: null };
    const cli = settings.wolvenKitCli;
    const superseded = () => { if (signal.aborted) throw new Superseded(); };
    const installation = await this.installations.acquire({ gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: cli, cacheDir: this.options.resolverCache, log: this.options.log });
    superseded();
    const graph = installation.graph;
    // The environment names the LUT; a mod that edits the environment to name another LUT is followed too.
    let environmentPath: string | null = null, environmentNote: string | undefined;
    const env = await graph.load(refFromPath(CREATOR_ENVIRONMENT), "env");
    superseded();
    const grading = env ? readEnvironmentGrading(env.root) : null;
    if (!grading?.ldr?.path) environmentNote = "The creator environment could not be read; the vanilla LUT path is used.";
    else if (!supportedMapping(grading.ldr)) environmentNote = `The environment's LUT uses ${grading.ldr.inputMapping} → ${grading.ldr.outputMapping}, which the preview does not implement; the vanilla LUT path is used.`;
    else environmentPath = grading.ldr.path;
    const extract = this.options.extract ?? extractUntrimmedJson;
    mkdirSync(join(this.root, "tmp"), { recursive: true });
    const names = new Map<GradingLut, string>();
    // The decoded cube depends on the archive's bytes, the decoder and the WolvenKit that converted it.
    const tool = wolvenKitIdentityKey(wolvenKitIdentity(cli));
    let failure: unknown = null;
    const read = async (archive: MountedArchive, path: string): Promise<GradingLut> => {
      superseded();
      const entry = graph.locate(refFromPath(path)).entry;
      const cacheKey = createHash("sha256").update(`decoder:${GRADING_LUT_DECODER_VERSION}|${tool}|${fingerprint(archive.id)}|${entry.hash}`).digest("hex");
      const index = join(this.root, "keys", `${cacheKey}.txt`);
      const cached = this.cachedLut(index);
      if (cached) { names.set(cached.lut, cached.name); return cached.lut; }
      const lasting = this.lasting.get(cacheKey);
      if (lasting) throw new GradingLutError(lasting);
      let lut: GradingLut;
      try { lut = decodeGradingLut(await extract(cli, archive, entry.hash, join(this.root, "tmp"), signal)); }
      catch (error) {
        if (error instanceof WolvenKitRunError && error.code === "cancelled") throw error;
        if (lastingFailure(error)) this.lasting.set(cacheKey, (error as Error).message);
        else failure ??= error;
        throw error;
      }
      const bytes = encodeGradingLut(lut), name = `${createHash("sha256").update(bytes).digest("hex")}.bin`;
      try {
        mkdirSync(join(this.root, "files"), { recursive: true }); mkdirSync(join(this.root, "keys"), { recursive: true });
        writeFileAtomic(join(this.root, "files", name), bytes);
        writeFileAtomic(index, name);
      } catch (error) { failure ??= error; throw error; } // Served only from its file, so a failed write is tried again.
      names.set(lut, name);
      return lut;
    };
    const selected = await selectGradingLut({ environmentPath, environmentNote, read,
      lookup: path => graph.locate(refFromPath(path)).lookup });
    superseded();
    const file = selected.lut ? names.get(selected.lut) ?? null : null;
    const source = selected.source;
    this.options.log?.(`Colour grading LUT: ${source.kind}${source.archive ? ` from ${source.archive}` : ""}${source.skipped.length ? ` (skipped: ${source.skipped.join("; ")})` : ""}.`);
    return { source, file, failure };
  }

  /** Absolute path of a served LUT file, or null. Names are content-addressed, never paths. */
  filePath(name: string): string | null {
    if (!GRADING_LUT_FILE.test(name)) return null;
    const path = join(this.root, "files", name);
    return existsSync(path) ? path : null;
  }
}

function neutralSource(note: string): GradingLutSource {
  return { kind: "neutral", depotPath: null, archive: null, group: null, provider: null, alternatives: [], rule: null, size: null, note, skipped: [] };
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** GET the LUT state (starting preparation when needed). Callers mount it behind their own session checks. */
export function createGradingLutHandler(host: GradingLutHost) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to prepare the preview." }, 403);
    if (request.method !== "GET") return json({ code: "method", error: "Method not allowed." }, 405);
    return json(host.request());
  };
}

/** A content-addressed decoded LUT for `/assets/grading-lut/<name>`, or a 404. */
export function serveGradingLut(host: GradingLutHost, pathname: string, method: string): Response {
  const path = host.filePath(pathname.slice(GRADING_LUT_ASSET_PREFIX.length));
  if (!path) return new Response("Not found", { status: 404 });
  return new Response(method === "HEAD" ? null : Bun.file(path), { headers: { "Content-Type": "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
