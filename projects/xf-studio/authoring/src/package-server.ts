import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCollection } from "./preset-collection";
import { packagePresetIdentities, preparePackageCollection } from "./package-filter";
import type { PackageAction, PackageBuild, PackageCheck } from "./package-action";
import { defaultLocalSettings, type LocalSettings } from "./local-settings";
import { packageToolPaths } from "./local-settings-readiness";
import { verifyPackageBuildResult } from "./package-result-verifier";
import { EyePlateError, ensureEyePlate, eyePlateHeadOverride, type EyePlateManifest, type EyePlateTools } from "./eye-plate-service";
import { createInstalledHeadSource } from "./eye-plate-head-resolver";
import { createWolvenKitEyePlateTools } from "./eye-plate-wolvenkit";
import { runProcessTree } from "./process-tree";

const app = resolve(import.meta.dir, "..");
const hq = resolve(app, "../../..");
const project = resolve(app, "..");
const dist = resolve(project, "dist");
/** The TypeScript package CLI; Bun runs it as a child so compiling and verifying never block this server. */
const script = resolve(app, "tools/build_collection_package.ts");
export const localCheckDeadlineMs = 120_000;
export const localBuildDeadlineMs = 40 * 60_000;
const maxBytes = 16_000_000;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/**
 * `plate` is empty unless the hidden `XFS_PACKAGE_PLATE` developer override names a plate directory;
 * otherwise Build derives the built-in eye plate into `plateCache` (host-owned, ignored storage) from the
 * head that `route` loads. `headOverride` comes from the Local setup choice `eyePlateHead` (or the
 * `XFS_EYE_PLATE_HEAD=base-game` developer override).
 */
export type PackageTools = { bun: string; plate: string; plateCache: string; wolvenkit: string; gamepath: string;
  route?: Pick<LocalSettings, "launchRoute" | "mo2Root" | "mo2ProfileId" | "manualModRoot">; headOverride?: "base-game" };
/** Localhost private cache for the derived eye plate; `XFS_PACKAGE_PLATE_CACHE` relocates it for isolated runs. */
export const localPlateCache = (env: Record<string, string | undefined> = process.env) =>
  resolve(env.XFS_PACKAGE_PLATE_CACHE || resolve(app, "data", "eye-plate-cache"));
/** Localhost folder for tools XF Studio downloads with consent (WolvenKit CLI); `XFS_TOOLS_DIR` relocates it. */
export const localToolsRoot = (env: Record<string, string | undefined> = process.env) =>
  resolve(env.XFS_TOOLS_DIR || resolve(app, "data", "tools"));
export function localPackageTools(settings: LocalSettings = defaultLocalSettings(), env = process.env,
  managedWolvenKit: string | null = null): PackageTools {
  const configured = packageToolPaths(settings, env, managedWolvenKit);
  return {
    bun: configured.bun || process.execPath,
    plate: configured.plate || "",
    plateCache: localPlateCache(env),
    wolvenkit: configured.wolvenkit || "",
    gamepath: configured.gamepath || "",
    route: { launchRoute: settings.launchRoute, mo2Root: settings.mo2Root, mo2ProfileId: settings.mo2ProfileId,
      manualModRoot: settings.manualModRoot },
    headOverride: eyePlateHeadOverride(env, settings.eyePlateHead),
  };
}

export type PlateToolsFactory = (wolvenkit: string) => EyePlateTools;

/** Resolve the plate for a localhost Build: the developer override, or the verified built-in plate. */
async function localPlate(tools: PackageTools, plateTools: PlateToolsFactory): Promise<{ args: string[]; manifest?: EyePlateManifest }> {
  if (tools.plate) {
    let valid = false;
    try { valid = statSync(tools.plate).isDirectory(); } catch { /* Missing override. */ }
    if (!valid) throw Error("The XFS_PACKAGE_PLATE developer override does not name a directory.");
    return { args: ["--plate", tools.plate] };
  }
  try {
    const route = tools.route ?? { launchRoute: "direct" as const, mo2Root: null, mo2ProfileId: null, manualModRoot: null };
    const plate = await ensureEyePlate({ gameRoot: tools.gamepath, cacheRoot: tools.plateCache, tools: plateTools(tools.wolvenkit),
      headSource: createInstalledHeadSource({ gameRoot: tools.gamepath, wolvenKitCli: tools.wolvenkit, ...route },
        join(tools.plateCache, "resolver")), headOverride: tools.headOverride });
    return { args: ["--plate", plate.directory, "--plate-manifest", plate.manifestFile], manifest: plate.manifest };
  } catch (error) {
    if (error instanceof EyePlateError && error.detail) console.error(`Eye plate preparation failed (${error.code}):`, error.detail.slice(-3000));
    throw error;
  }
}

/** Run the TypeScript package CLI as a bounded child process; the host keeps its own identity gates. */
export async function runLocalPackage(action: PackageAction, file: string, tools: PackageTools,
  plateTools: PlateToolsFactory = createWolvenKitEyePlateTools, signal?: AbortSignal): Promise<PackageCheck | PackageBuild> {
  if (action === "build") {
    for (const [name, path, kind] of [["WolvenKit", tools.wolvenkit, "file"], ["Game", tools.gamepath, "directory"]] as const) {
      let valid = false;
      try { const stat = statSync(path); valid = kind === "file" ? stat.isFile() : stat.isDirectory(); } catch { /* Missing local tool. */ }
      if (!valid) throw Error(name === "WolvenKit"
        ? "WolvenKit isn't set up yet. Let XF Studio download it (bun tools/setup-wolvenkit.ts), set its path in Local setup, or use the XFS_PACKAGE_WOLVENKIT server override."
        : "Game input is unavailable. Set its path in Local setup or use the XFS_PACKAGE_GAMEPATH server override.");
    }
    for (const [name, path] of [["game executable", join(tools.gamepath, "bin", "x64", "Cyberpunk2077.exe")],
      ["game archive directory", join(tools.gamepath, "archive", "pc")]] as const) {
      try { if (name.endsWith("directory") ? statSync(path).isDirectory() : statSync(path).isFile()) continue; }
      catch { /* Missing game input. */ }
      throw Error(`The configured ${name} is unavailable. Check the Cyberpunk 2077 folder in Local setup.`);
    }
    if (tools.bun.includes("/") || tools.bun.includes("\\")) { // A bare host PATH command is checked by spawn.
      let valid = false;
      try { valid = statSync(tools.bun).isFile(); } catch { /* Missing executable. */ }
      if (!valid) throw Error("The configured Bun executable is unavailable. Check Local setup.");
    }
  }
  const plate = action === "build" ? await localPlate(tools, plateTools) : { args: [] as string[] } as { args: string[]; manifest?: EyePlateManifest };
  const args = [script, "--collection", file, "--machine-result",
    ...(action === "check" ? ["--check"] : [...plate.args, "--wolvenkit", tools.wolvenkit, "--gamepath", tools.gamepath])];
  const run = await runProcessTree(tools.bun, args, { cwd: hq, signal,
    timeoutMs: action === "check" ? localCheckDeadlineMs : localBuildDeadlineMs });
  if (run.stopped) throw Error(`Package ${action} ${run.stopped === "timeout" ? "exceeded its time limit and was stopped" : "was cancelled"}. ` +
    "Your draft is unchanged; no package was installed.");
  if (run.exitCode !== 0) {
    console.error(`Local package ${action} tool failed (exit ${run.exitCode}):`, (run.error?.message ?? run.stderr.trim()).slice(-64_000));
    throw Error(`Package ${action} failed in the local build tool. See the studio server log for details. Your draft is unchanged; no package was installed.`);
  }
  const line = run.stdout.split(/\r?\n/).reverse().find(value => value.startsWith("XFS_PACKAGE_RESULT="));
  if (!line) throw Error("Package tool completed without a result.");
  const result = JSON.parse(line.slice("XFS_PACKAGE_RESULT=".length)) as PackageCheck | PackageBuild;
  if (action === "build" && plate.manifest) {
    const built = result as PackageBuild;
    if (built.plate?.source !== "derived" || built.plate.meshSha256 !== plate.manifest.files.mesh.sha256 ||
        built.plate.morphSha256 !== plate.manifest.files.morph.sha256)
      throw Error("Package was not built from the prepared eye plate.");
  }
  return result;
}

type Runner = (action: PackageAction, file: string, tools: PackageTools) => Promise<PackageCheck | PackageBuild>;
/** One active build per server; requests carry only a validated collection snapshot. */
export function createPackageHandler(tools: PackageTools | ((action: PackageAction) => PackageTools) = () => localPackageTools(), runner: Runner = runLocalPackage) {
  let building = false;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || request.headers.get("Origin") !== url.origin ||
        request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ error: "Use the local studio to build packages." }, 403);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (Number(request.headers.get("Content-Length")) > maxBytes) return json({ error: "Collection exceeds 16 MB." }, 413);
    let body: string;
    try { body = await request.text(); } catch { return json({ error: "Could not read collection snapshot." }, 400); }
    if (Buffer.byteLength(body) > maxBytes) return json({ error: "Collection exceeds 16 MB." }, 413);
    let action: PackageAction, collection;
    try {
      const input = JSON.parse(body);
      if (!input || (input.action !== "check" && input.action !== "build") || Object.keys(input).some(key => key !== "action" && key !== "collection"))
        throw Error("Expected a package action and collection only.");
      action = input.action;
      collection = parseCollection(input.collection);
    } catch (error) { return json({ error: (error as Error).message }, 400); }
    if (building) return json({ error: "A local package build is already running. Wait for its result before starting another." }, 409);
    let prepared: ReturnType<typeof preparePackageCollection>;
    try { prepared = preparePackageCollection(collection); }
    catch (error) { return json({ error: (error as Error).message, code: "no_exportable_content" }, 422); }
    const { plan, omissions, experimental, packaged } = prepared;
    const source = JSON.stringify(collection);
    const packagedHash = createHash("sha256").update(JSON.stringify(packaged)).digest("hex");
    const work = mkdtempSync(resolve(tmpdir(), "xfs-ui-package-"));
    const file = resolve(work, "collection.json");
    writeFileSync(file, source);
    if (action === "build") building = true;
    try {
      const result = await runner(action, file, typeof tools === "function" ? tools(action) : tools);
      if (action === "check") {
        const checked = result as PackageCheck;
        if (checked.ready !== true || checked.collectionId !== collection.id || checked.namespace !== plan.namespace ||
            checked.modName !== plan.modName || checked.selectorLabel !== plan.selectorLabel ||
            checked.originalPresetCount !== collection.presets.length || checked.packagedCollectionSha256 !== packagedHash ||
            JSON.stringify(checked.omissions) !== JSON.stringify(omissions) ||
            JSON.stringify(checked.experimental ?? []) !== JSON.stringify(experimental) ||
            JSON.stringify(checked.presets) !== JSON.stringify(packagePresetIdentities(plan)) ||
            JSON.stringify(checked.plateLiftsMm) !== JSON.stringify(plan.plate.liftsMm))
          throw Error("Package preflight returned a different collection identity.");
        return json(checked);
      }
      const built = result as PackageBuild;
      verifyPackageBuildResult(built, collection, prepared, source, dist);
      return json(built);
    } catch (error) {
      console.error("Local package action failed:", (error as Error).message);
      return json({ error: (error as Error).message, ...(error instanceof EyePlateError ? { code: error.code } : {}) }, 422);
    } finally {
      if (action === "build") building = false;
      rmSync(work, { recursive: true, force: true });
    }
  };
}
