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
import { refFromPath } from "./depot-path";
import { CREATOR_ENVIRONMENT, GRADING_LUT_ASSET_PREFIX, GRADING_LUT_FILE, GRADING_LUT_STATE_SCHEMA, decodeGradingLut, decodeGradingLutBinary, encodeGradingLut, GradingLutError, readEnvironmentGrading, selectGradingLut,
  supportedMapping, type GradingLut, type GradingLutSource } from "./grading-lut";
import type { Installation, InstallationOptions } from "./resolver-host";
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
  /** Minimum time before a transient failure is prepared again (default `GRADING_LUT_RETRY_MS`). */
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
/** A preparation that failed for a transient reason (WolvenKit, disk) is tried again after this long. */
export const GRADING_LUT_RETRY_MS = 30_000;

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

/** Plain note for a WolvenKit failure that left the neutral grade. */
function toolNote(error: WolvenKitRunError): string {
  if (error.code === "runtime_missing") return `Colour grading: ${WOLVENKIT_RUNTIME_MISSING_MESSAGE} A neutral grade is shown until it is.`;
  if (error.code === "tool_timeout") return "Colour grading: reading the game's LUT took too long, so a neutral grade is shown for now. XF Studio tries again shortly.";
  return "Colour grading: WolvenKit couldn't read the game's LUT, so a neutral grade is shown for now. XF Studio tries again shortly.";
}

type Preparation = { key: string; state: GradingLutState; promise: Promise<void>; controller: AbortController; retryAt: number | null };
class Superseded extends Error {}

/**
 * One preparation at a time, keyed by the installation fingerprint the character details use. A changed
 * installation supersedes (cancels) the running preparation, and the new one starts once it has stopped.
 * A preparation that failed for a transient reason (a WolvenKit error, time limit or missing .NET, or an
 * unexpected error) answers with the neutral grade and is prepared again on a request after
 * `GRADING_LUT_RETRY_MS`; a LUT whose content cannot be decoded stays neutral until the installation changes.
 */
export class GradingLutHost {
  private current: Preparation | null = null;
  constructor(private readonly options: GradingLutHostOptions) {}

  private get root() { return join(this.options.cacheRoot, "grading-lut"); }
  private now() { return this.options.now?.() ?? Date.now(); }

  /** The LUT state for the host's current installation; starts preparing when the installation changed or a retry is due. */
  request(): GradingLutState {
    const settings = this.options.settings(), key = installationFingerprint(settings);
    const known = this.current;
    if (known?.key === key && (known.retryAt === null || this.now() < known.retryAt)) return structuredClone(known.state);
    known?.controller.abort();
    const state: GradingLutState = { schema: GRADING_LUT_STATE_SCHEMA, phase: "preparing", source: null, file: null };
    const controller = new AbortController();
    const entry: Preparation = { key, state, promise: Promise.resolve(), controller, retryAt: null };
    this.current = entry;
    const retryLater = () => { entry.retryAt = this.now() + (this.options.retryAfterMs ?? GRADING_LUT_RETRY_MS); };
    const start = () => controller.signal.aborted ? Promise.reject(new Superseded()) : this.prepare(settings, controller.signal);
    // A superseded preparation settles (its WolvenKit run is stopped) before the next one starts.
    entry.promise = (known ? known.promise.then(start) : start())
      .then(result => {
        entry.state = { ...state, phase: "ready", source: result.source, file: result.file };
        if (result.transient) retryLater();
      })
      .catch(error => {
        if (error instanceof Superseded || controller.signal.aborted) return;
        this.options.log?.(`Colour grading LUT not prepared: ${(error as Error)?.stack ?? error}`);
        entry.state = { ...state, phase: "ready", file: null, source: neutralSource(error instanceof WolvenKitRunError ? toolNote(error)
          : "Colour grading: the game's LUT couldn't be read, so a neutral grade is shown for now. XF Studio tries again shortly.") };
        retryLater();
      });
    return structuredClone(state);
  }

  async settled(): Promise<void> { await this.current?.promise; }

  private async prepare(settings: CharacterDetailSettings, signal: AbortSignal): Promise<{ source: GradingLutSource; file: string | null; transient: boolean }> {
    if (!settings.gameRoot || !settings.wolvenKitCli || !existsSync(settings.wolvenKitCli))
      return { source: neutralSource(NOT_SET_UP), file: null, transient: false };
    const cli = settings.wolvenKitCli;
    const open = this.options.open ?? (await import("./resolver-host")).openInstallation;
    const installation = open({ gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: cli, cacheDir: this.options.resolverCache, log: this.options.log });
    const graph = installation.graph;
    const superseded = () => { if (signal.aborted) throw new Superseded(); };
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
    let toolError: WolvenKitRunError | null = null;
    const read = async (archive: MountedArchive, path: string): Promise<GradingLut> => {
      superseded();
      const entry = graph.locate(refFromPath(path)).entry;
      const cacheKey = createHash("sha256").update(`decoder:${GRADING_LUT_DECODER_VERSION}|${tool}|${fingerprint(archive.id)}|${entry.hash}`).digest("hex");
      const index = join(this.root, "keys", `${cacheKey}.txt`);
      if (existsSync(index)) {
        const name = readFileSync(index, "utf8").trim(), file = join(this.root, "files", name);
        if (GRADING_LUT_FILE.test(name) && existsSync(file)) {
          const lut = decodeGradingLutBinary(new Uint8Array(readFileSync(file)));
          names.set(lut, name);
          return lut;
        }
      }
      let document: unknown;
      try { document = await extract(cli, archive, entry.hash, join(this.root, "tmp"), signal); }
      catch (error) {
        if (error instanceof WolvenKitRunError && error.code !== "cancelled") toolError ??= error;
        throw error;
      }
      const lut = decodeGradingLut(document);
      const bytes = encodeGradingLut(lut), name = `${createHash("sha256").update(bytes).digest("hex")}.bin`;
      mkdirSync(join(this.root, "files"), { recursive: true }); mkdirSync(join(this.root, "keys"), { recursive: true });
      writeFileSync(join(this.root, "files", name), bytes);
      writeFileSync(index, name);
      names.set(lut, name);
      return lut;
    };
    const selected = await selectGradingLut({ environmentPath, environmentNote, read,
      lookup: path => graph.locate(refFromPath(path)).lookup });
    superseded();
    const failure = toolError as WolvenKitRunError | null;
    // WolvenKit itself failing is transient: say so plainly when it left the neutral grade, and try again later.
    const source = failure && selected.source.kind === "neutral" ? { ...selected.source, note: toolNote(failure) } : selected.source;
    const file = selected.lut ? names.get(selected.lut) ?? null : null;
    this.options.log?.(`Colour grading LUT: ${source.kind}${source.archive ? ` from ${source.archive}` : ""}${source.skipped.length ? ` (skipped: ${source.skipped.join("; ")})` : ""}.`);
    return { source, file, transient: failure !== null };
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
