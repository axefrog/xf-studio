/**
 * Host service for the creator preset's colour-grading LUT (both hosts share it). It opens the launch
 * route with the generic resolver (the same source discovery and archive precedence Build and the character
 * details use), reads the creator environment's SDR LUT path, and picks the LUT resource that wins that path
 * (grading-lut.ts `selectGradingLut`). The winner is extracted with WolvenKit into a temporary folder, its
 * texel blob decoded, and the decoded cube stored content-addressed in the host's private cache. No mod is
 * named anywhere: a LUT mod works because its archive wins the vanilla LUT path.
 *
 * Read-only towards the game and MO2. The resolver's trimmed JSON cache drops texture blobs, so the LUT is
 * extracted separately here; only the decoded cube is kept.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MountedArchive } from "./archive-precedence";
import { installationFingerprint, type CharacterDetailSettings } from "./character-detail-host";
import { refFromPath } from "./depot-path";
import { CREATOR_ENVIRONMENT, GRADING_LUT_ASSET_PREFIX, GRADING_LUT_FILE, GRADING_LUT_STATE_SCHEMA, decodeGradingLut, decodeGradingLutBinary, encodeGradingLut, GradingLutError, readEnvironmentGrading, selectGradingLut,
  supportedMapping, type GradingLut, type GradingLutSource } from "./grading-lut";
import type { Installation, InstallationOptions } from "./resolver-host";

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
  /** Test seams. */
  open?: (options: InstallationOptions) => Installation;
  extract?: (cli: string, archive: MountedArchive, hash: string, workDir: string) => Promise<unknown>;
};

const NOT_SET_UP = "Colour grading: the game's LUT appears once your game folder and WolvenKit are set up. A neutral grade is shown for now.";

/** Cache identity of an archive: its path, size and modification time (the id alone when it is not a file). */
const fingerprint = (path: string) => { try { const s = statSync(path); return `${path}|${s.size}|${s.mtimeMs}`; } catch { return path; } };

/** Extract one resource from one archive with WolvenKit and return its untrimmed JSON. */
export async function extractUntrimmedJson(cli: string, archive: MountedArchive, hash: string, workDir: string): Promise<unknown> {
  const dir = join(workDir, `lut-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`), raw = join(dir, "raw");
  mkdirSync(raw, { recursive: true });
  const run = async (args: string[]) => {
    const child = Bun.spawn([cli, ...args], { stdout: "pipe", stderr: "pipe" });
    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
  };
  try {
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

export class GradingLutHost {
  private current: { key: string; state: GradingLutState; promise: Promise<void> } | null = null;
  constructor(private readonly options: GradingLutHostOptions) {}

  private get root() { return join(this.options.cacheRoot, "grading-lut"); }

  /** The LUT state for the host's current installation; starts preparing it when the installation changed. */
  request(): GradingLutState {
    const settings = this.options.settings(), key = installationFingerprint(settings);
    if (this.current?.key === key) return structuredClone(this.current.state);
    const state: GradingLutState = { schema: GRADING_LUT_STATE_SCHEMA, phase: "preparing", source: null, file: null };
    const entry = { key, state, promise: Promise.resolve() };
    this.current = entry;
    entry.promise = this.prepare(settings)
      .then(result => { entry.state = { ...state, phase: "ready", ...result }; })
      .catch(error => {
        this.options.log?.(`Colour grading LUT not prepared: ${(error as Error)?.stack ?? error}`);
        entry.state = { ...state, phase: "ready", file: null, source: neutralSource("Colour grading: the game's LUT couldn't be read, so a neutral grade is shown.") };
      });
    return structuredClone(state);
  }

  async settled(): Promise<void> { await this.current?.promise; }

  private async prepare(settings: CharacterDetailSettings): Promise<{ source: GradingLutSource; file: string | null }> {
    if (!settings.gameRoot || !settings.wolvenKitCli || !existsSync(settings.wolvenKitCli))
      return { source: neutralSource(NOT_SET_UP), file: null };
    const cli = settings.wolvenKitCli;
    const open = this.options.open ?? (await import("./resolver-host")).openInstallation;
    const installation = open({ gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: cli, cacheDir: this.options.resolverCache, log: this.options.log });
    const graph = installation.graph;
    // The environment names the LUT; a mod that edits the environment to name another LUT is followed too.
    let environmentPath: string | null = null, environmentNote: string | undefined;
    const env = await graph.load(refFromPath(CREATOR_ENVIRONMENT), "env");
    const grading = env ? readEnvironmentGrading(env.root) : null;
    if (!grading?.ldr?.path) environmentNote = "The creator environment could not be read; the vanilla LUT path is used.";
    else if (!supportedMapping(grading.ldr)) environmentNote = `The environment's LUT uses ${grading.ldr.inputMapping} → ${grading.ldr.outputMapping}, which the preview does not implement; the vanilla LUT path is used.`;
    else environmentPath = grading.ldr.path;
    const extract = this.options.extract ?? extractUntrimmedJson;
    mkdirSync(join(this.root, "tmp"), { recursive: true });
    const names = new Map<GradingLut, string>();
    const read = async (archive: MountedArchive, path: string): Promise<GradingLut> => {
      const entry = graph.locate(refFromPath(path)).entry;
      const cacheKey = createHash("sha256").update(`${fingerprint(archive.id)}|${entry.hash}`).digest("hex");
      const index = join(this.root, "keys", `${cacheKey}.txt`);
      if (existsSync(index)) {
        const name = readFileSync(index, "utf8").trim(), file = join(this.root, "files", name);
        if (GRADING_LUT_FILE.test(name) && existsSync(file)) {
          const lut = decodeGradingLutBinary(new Uint8Array(readFileSync(file)));
          names.set(lut, name);
          return lut;
        }
      }
      const lut = decodeGradingLut(await extract(cli, archive, entry.hash, join(this.root, "tmp")));
      const bytes = encodeGradingLut(lut), name = `${createHash("sha256").update(bytes).digest("hex")}.bin`;
      mkdirSync(join(this.root, "files"), { recursive: true }); mkdirSync(join(this.root, "keys"), { recursive: true });
      writeFileSync(join(this.root, "files", name), bytes);
      writeFileSync(index, name);
      names.set(lut, name);
      return lut;
    };
    const { lut, source } = await selectGradingLut({ environmentPath, environmentNote, read,
      lookup: path => graph.locate(refFromPath(path)).lookup });
    const file = lut ? names.get(lut) ?? null : null;
    this.options.log?.(`Colour grading LUT: ${source.kind}${source.archive ? ` from ${source.archive}` : ""}${source.skipped.length ? ` (skipped: ${source.skipped.join("; ")})` : ""}.`);
    return { source, file };
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
