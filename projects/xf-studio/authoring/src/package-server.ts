/**
 * The localhost package route: HTTP checks (loopback, same origin, JSON, size) in front of the package host
 * service both hosts share (platform/export/product-host, PIPE-03). This module is only localhost's adapter:
 * its tool paths and developer overrides, its private roots in the project's ignored `build/` and `dist/`, the
 * builder run from the source tree, and the server log.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultLocalSettings, type LocalSettings } from "./local-settings";
import { packageToolPaths } from "./local-settings-readiness";
import { eyePlateHeadOverride } from "./eye-plate-service";
import { eyePlatePrerequisite, eyePlateRouteKeyFor } from "./eye-plate-prerequisite";
import { runProcessTree } from "./process-tree";
import { hostFailure } from "./diagnostics/host-log";
import { MAX_PACKAGE_REQUEST_BYTES, PackageHostService, type HostPrerequisite, type PackageAction, type PackageHostAdapter } from "./platform/export/product-host";
import type { FeatureExporterEntry } from "./platform/api";

const app = resolve(import.meta.dir, "..");
const project = resolve(app, "..");
/** The TypeScript builder CLI; Bun runs it as a child so compiling and verifying never block this server. */
const script = resolve(app, "tools/build_collection_package.ts");
/** The Check worker entry, from the source tree. */
export const localCheckWorker = resolve(app, "tools/package_check_worker.ts");
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

const localRoute = (tools: PackageTools) => ({ gameRoot: tools.gamepath,
  ...(tools.route ?? { launchRoute: "direct" as const, mo2Root: null, mo2ProfileId: null, manualModRoot: null }) });
/** The route and head choice a plate prepared for these tools is recorded under (PIPE-36). */
export const localPlateRouteKey = (tools: PackageTools) => eyePlateRouteKeyFor({ route: localRoute(tools), headOverride: tools.headOverride });

/** Eye makeup's plate prerequisite for these localhost tools: the developer override, or the verified built-in plate. */
export const localEyePlate = (tools: PackageTools, plateTools?: Parameters<typeof eyePlatePrerequisite>[0]["tools"]): HostPrerequisite =>
  eyePlatePrerequisite({ route: localRoute(tools), cacheRoot: tools.plateCache, wolvenKitCli: tools.wolvenkit, headOverride: tools.headOverride,
    ...(tools.plate ? { override: tools.plate } : {}), ...(plateTools ? { tools: plateTools } : {}) });

/** What localhost's Build needs before anything starts, in plain words, or null. */
export function localBuildIssue(tools: PackageTools): string | null {
  for (const [name, path, kind] of [["WolvenKit", tools.wolvenkit, "file"], ["Game", tools.gamepath, "directory"]] as const) {
    let valid = false;
    try { const stat = statSync(path); valid = kind === "file" ? stat.isFile() : stat.isDirectory(); } catch { /* Missing local tool. */ }
    if (!valid) return name === "WolvenKit"
      ? "WolvenKit isn't set up yet. Let XF Studio download it (bun tools/setup-wolvenkit.ts), set its path in Local setup, or use the XFS_PACKAGE_WOLVENKIT server override."
      : "Game input is unavailable. Set its path in Local setup or use the XFS_PACKAGE_GAMEPATH server override.";
  }
  for (const [name, path] of [["game executable", join(tools.gamepath, "bin", "x64", "Cyberpunk2077.exe")],
    ["game archive directory", join(tools.gamepath, "archive", "pc")]] as const) {
    try { if (name.endsWith("directory") ? statSync(path).isDirectory() : statSync(path).isFile()) continue; }
    catch { /* Missing game input. */ }
    return `The configured ${name} is unavailable. Check the Cyberpunk 2077 folder in Local setup.`;
  }
  if (tools.bun.includes("/") || tools.bun.includes("\\")) { // A bare host PATH command is checked by spawn.
    let valid = false;
    try { valid = statSync(tools.bun).isFile(); } catch { /* Missing executable. */ }
    if (!valid) return "The configured Bun executable is unavailable. Check Local setup.";
  }
  return null;
}

/**
 * Localhost's package host adapter: `prerequisites` makes each feature's host prerequisites for these tools
 * (the root binds eye makeup's plate to its prerequisite ID). Private roots live in the project's ignored
 * `build/` (one snapshot, work and stage folder per Build) and verified candidates in its ignored `dist/`.
 */
export function localPackageAdapter(options: { exporters: readonly FeatureExporterEntry[]; tools: PackageTools;
  prerequisites: (tools: PackageTools) => Readonly<Record<string, HostPrerequisite>>; roots?: { build: string; dist: string } }): PackageHostAdapter {
  const { tools } = options, build = options.roots?.build ?? resolve(project, "build"), dist = options.roots?.dist ?? resolve(project, "dist");
  return {
    exporters: options.exporters,
    prerequisites: options.prerequisites(tools),
    checkWorker: localCheckWorker,
    buildIssue: () => localBuildIssue(tools),
    buildSetup: () => {
      const id = randomUUID();
      return { snapshot: resolve(build, "package-snapshots", id), work: resolve(build, "package-work", id),
        stage: resolve(build, "package-stage", id), candidates: dist, wolvenkit: tools.wolvenkit, gamepath: tools.gamepath };
    },
    runBuilder: (args, run) => runProcessTree(tools.bun, [script, ...args], { cwd: run.cwd, signal: run.signal, timeoutMs: run.timeoutMs }),
    log: (scope, code, message, detail) => hostFailure("package", code, `Package ${scope}: ${message}`, detail,
      code === "invalid_collection" || code === "no_exportable_content" ? "warn" : "error"),
  };
}

/**
 * The localhost package route: requests carry only `{ action, collection }` (the server decides every path and
 * tool), and one Check and one Build run at a time. `adapter` makes the host adapter for each request, so
 * Local setup changes apply to the next Build.
 */
export function createPackageHandler(adapter: (action: PackageAction) => PackageHostAdapter) {
  const service = new PackageHostService();
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || request.headers.get("Origin") !== url.origin ||
        request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ error: "Use the local studio to build packages." }, 403);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (Number(request.headers.get("Content-Length")) > MAX_PACKAGE_REQUEST_BYTES) return json({ error: "Collection exceeds 16 MB." }, 413);
    let body: string;
    try { body = await request.text(); } catch { return json({ error: "Could not read collection snapshot." }, 400); }
    if (Buffer.byteLength(body) > MAX_PACKAGE_REQUEST_BYTES) return json({ error: "Collection exceeds 16 MB." }, 413);
    let input: { action?: unknown; collection?: unknown };
    try { input = JSON.parse(body); } catch { return json({ error: "Expected a package action and collection only." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input) || (input.action !== "check" && input.action !== "build") ||
        Object.keys(input).some(key => key !== "action" && key !== "collection") || !("collection" in input))
      return json({ error: "Expected a package action and collection only." }, 400);
    const action = input.action as PackageAction;
    if (service.busy(action)) return json({ code: `package_${action}_busy`, error: action === "build"
      ? "A local package build is already running. Wait for its result before starting another."
      : "A package Check is already running. Wait for its result before starting another." }, 409);
    const outcome = await service.run(adapter(action), action, input.collection, request.signal);
    return outcome.ok ? json(outcome.result) : json({ code: outcome.code, error: outcome.message }, outcome.status);
  };
}
