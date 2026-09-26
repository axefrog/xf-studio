import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { LocalSettings } from "../src/local-settings";
import { eyePlateHeadOverride, type EyePlateTools } from "../src/eye-plate-service";
import { eyePlatePrerequisite } from "../src/eye-plate-prerequisite";
import { runProcessTree } from "../src/process-tree";
import { hostFailure } from "../src/diagnostics/host-log";
import type { FeatureExporterEntry } from "../src/platform/api";
import type { HostPrerequisite, PackageHostAdapter } from "../src/platform/export/product-host";
import { cachedWolvenKitProbeResult, probeWolvenKitCli, probeWolvenKitCliAsync } from "../src/wolvenkit-cli";

/** The packaged TypeScript builder: one Bun bundle of tools/build_collection_package.ts. No Python. */
export const BUILD_TOOLS_SCHEMA = "xfs/desktop-build-tools-2";
export const builderEntry = "app/tools/build.js";
const toolNames = [builderEntry];
const file = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const directory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const signature = (path: string, expected: string) => {
  try {
    const handle = openSync(path, "r");
    try { const bytes = Buffer.alloc(expected.length);
      return readSync(handle, bytes, 0, bytes.length, 0) === bytes.length && bytes.toString("ascii") === expected;
    } finally { closeSync(handle); }
  }
  catch { return false; }
};
const inside = (path: string, root: string) => {
  const target = process.platform === "win32" ? path.toLowerCase() : path;
  const base = process.platform === "win32" ? root.toLowerCase() : root;
  return target === base || target.startsWith(base + sep);
};
export type WolvenKitProbe = (path: string) => string | null;
export type BunProbe = (path: string) => string | null;
/** Shown while the first tool check runs in the background; readiness requests never wait for it. */
export const PROBE_PENDING = "XF Studio is still checking your build tools. Try again in a moment.";
const bunCache = new Map<string, { issue: string | null; until: number }>();
/** Execute code, rather than trusting a filename or the Electrobun main path. */
export function probeBun(path: string): string | null {
  try {
    const stamp = statSync(path);
    const key = `${path}|${stamp.size}|${stamp.mtimeMs}`;
    const cached = bunCache.get(key);
    if (cached && Date.now() < cached.until) return cached.issue;
    const run = spawnSync(path, ["-e", "process.stdout.write('XFS_BUN_OK:' + Bun.version)"],
      { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 4096 });
    const issue = run.error || run.status !== 0 || !/^XFS_BUN_OK:\d+\.\d+\.\d+/.test(run.stdout || "")
      ? "XF Studio's build runtime cannot run the packaged build tools. Reinstall XF Studio to repair it." : null;
    bunCache.set(key, { issue, until: issue ? Date.now() + 10_000 : Infinity });
    return issue;
  } catch { return "XF Studio's build runtime could not be checked. Restart XF Studio and try again."; }
}
/** Run the CLI's version and command checks through the shared WolvenKit runner; a failure is retried after a short interval. */
export const probeWolvenKit: WolvenKitProbe = path => {
  const probe = probeWolvenKitCli(path);
  return probe.ok ? null : probe.issue;
};
const stampKey = (path: string) => { const stamp = statSync(path); return `${path}|${stamp.size}|${stamp.mtimeMs}`; };
const inFlight = new Map<string, Promise<void>>();
function once(key: string, work: () => Promise<void>): Promise<void> {
  let pending = inFlight.get(key);
  if (!pending) { pending = work().finally(() => inFlight.delete(key)); inFlight.set(key, pending); }
  return pending;
}
/**
 * The Bun that runs the packaged builder: XF Studio's own runtime. Only the disposable Build trial
 * entry points it elsewhere (`useBuilderBun`); there is no setting for it.
 */
let builderBunOverride: string | null = null;
export function useBuilderBun(path: string | null) { builderBunOverride = path; }
export const builderBun = () => builderBunOverride ?? process.execPath;

/** The same checks as probeWolvenKit/probeBun without blocking the event loop; one shared run per tool. */
export async function warmBuildProbes(settings: Pick<LocalSettings, "wolvenKitCli">, bun = builderBun()): Promise<void> {
  const jobs: Promise<void>[] = [];
  // WolvenKit is checked by the shared runner, which keeps one cache and one run per file.
  if (settings.wolvenKitCli && file(settings.wolvenKitCli)) jobs.push(probeWolvenKitCliAsync(settings.wolvenKitCli).then(() => {}));
  if (file(bun)) {
    const key = stampKey(bun), cached = bunCache.get(key);
    if (!cached || Date.now() >= cached.until) jobs.push(once(`bun:${key}`, async () => {
      let issue: string | null = null;
      try {
        // The shared process runner stops the whole tree when the probe overruns.
        const result = await runProcessTree(bun, ["-e", "process.stdout.write('XFS_BUN_OK:' + Bun.version)"], { timeoutMs: 5000, keep: 4096 });
        if (result.exitCode !== 0 || !/^XFS_BUN_OK:\d+\.\d+\.\d+/.test(result.stdout)) issue = "XF Studio's build runtime cannot run the packaged build tools. Reinstall XF Studio to repair it.";
      } catch { issue = "XF Studio's build runtime could not be checked. Restart XF Studio and try again."; }
      bunCache.set(key, { issue, until: issue ? Date.now() + 10_000 : Infinity });
    }));
  }
  await Promise.all(jobs);
}
/** Readiness-path probes: answer from the cache, or start a background check and say so. */
export const cachedWolvenKitProbe: WolvenKitProbe = path => {
  const cached = cachedWolvenKitProbeResult(path);
  if (cached) return cached.ok ? null : cached.issue;
  void probeWolvenKitCliAsync(path).catch(() => {});
  return PROBE_PENDING;
};
export const cachedBunProbe: BunProbe = path => {
  const cached = bunCache.get(stampKey(path));
  if (cached && Date.now() < cached.until) return cached.issue;
  void warmBuildProbes({ wolvenKitCli: null }, path).catch(() => {});
  return PROBE_PENDING;
};
const toolHashes = new Map<string, string>();
/** The packaged tool's SHA-256, recomputed only when its size or modification time changes. */
function toolHash(path: string): string {
  const key = stampKey(path);
  let hash = toolHashes.get(key);
  if (!hash) { hash = createHash("sha256").update(readFileSync(path)).digest("hex"); toolHashes.set(key, hash); }
  return hash;
}

function privatePath(root: string, target: string): void {
  const base = resolve(root), path = resolve(target);
  if (!inside(path, base) || lstatSync(base).isSymbolicLink()) throw Error("Private build root uses a linked path.");
  const canonical = realpathSync(base);
  let current = base;
  for (const part of path.slice(base.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink() || !inside(realpathSync(current), canonical))
      throw Error("Private build root uses a linked path.");
  }
}

/** Writable host-owned roots below the desktop user-data directory. */
const privateRoots = ["package-snapshots", "package-work", "package-staging", "package-candidates", "plate-cache"];
/** The built-in eye plate is derived from the installed game and cached here. */
export const desktopPlateCache = (dataRoot: string) => resolve(dataRoot, "plate-cache");

/** A packaged code bundle, external executables and the game are required; the eye plate is built in. */
export function desktopBuildIssue(settings: LocalSettings, dataRoot: string, toolsRoot: string,
  wolvenKitProbe: WolvenKitProbe = probeWolvenKit, bunProbe: BunProbe = probeBun): string | null {
  try {
    const manifest = JSON.parse(readFileSync(resolve(toolsRoot, "manifest.json"), "utf8"));
    if (manifest.schema !== BUILD_TOOLS_SCHEMA || !manifest.files ||
      JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...toolNames].sort()))
      return "The packaged build tools are incomplete.";
    const actualTools = realpathSync(toolsRoot);
    for (const name of toolNames) {
      const path = resolve(toolsRoot, name);
      if (!file(path) || !inside(realpathSync(path), actualTools) ||
        toolHash(path) !== manifest.files[name])
        return "The packaged build tools failed integrity checks.";
    }
  } catch { return "The packaged build tools are unavailable."; }
  if (!settings.wolvenKitCli || !file(settings.wolvenKitCli))
    return "WolvenKit isn't set up yet. XF Studio can download it for you from the 3D preview card.";
  if (!signature(settings.wolvenKitCli, "MZ")) return "The selected WolvenKit CLI is not a Windows executable.";
  try { const issue = wolvenKitProbe(settings.wolvenKitCli); if (issue) return issue; }
  catch { return "WolvenKit CLI could not complete its version and command checks."; }
  if (!settings.gameRoot || !file(resolve(settings.gameRoot, "bin/x64/Cyberpunk2077.exe")) ||
      !directory(resolve(settings.gameRoot, "archive/pc"))) return "Select a complete Cyberpunk 2077 game directory.";
  if (!signature(resolve(settings.gameRoot, "bin/x64/Cyberpunk2077.exe"), "MZ"))
    return "The selected game executable is not a Windows executable.";
  const bun = builderBun();
  if (!file(bun)) return "XF Studio's own build runtime is missing. Reinstall XF Studio to repair it.";
  const bunIssue = bunProbe(bun);
  if (bunIssue) return bunIssue;
  try {
    for (const name of privateRoots) privatePath(dataRoot, resolve(dataRoot, name));
  } catch { return "Private build storage uses a linked path."; }
  // Electrobun installs app resources below userData. Its read-only tool bundle
  // may share that parent, but none of the writable package roots may overlap
  // an input (including an MO2 root unknown to the package builder).
  try {
    const output = realpathSync(dataRoot);
    const writable = privateRoots.map(name => resolve(output, name));
    for (const input of [toolsRoot, settings.gameRoot,
      settings.wolvenKitCli, bun, settings.mo2Root].filter((v): v is string => !!v)) {
      const source = realpathSync(input);
      if (writable.some(path => inside(path, source) || inside(source, path)))
        return "Private build data overlaps a configured input.";
    }
  } catch { return "A configured build path is unavailable."; }
  return null;
}

/** Eye makeup's plate prerequisite for these desktop settings: cut from the head the saved launch route loads (PIPE-36). */
export const desktopEyePlate = (settings: LocalSettings, dataRoot: string, tools?: (wolvenKitCli: string) => EyePlateTools): HostPrerequisite =>
  eyePlatePrerequisite({ route: { gameRoot: settings.gameRoot ?? "", launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
    mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot },
  cacheRoot: desktopPlateCache(dataRoot), wolvenKitCli: settings.wolvenKitCli ?? "",
  headOverride: eyePlateHeadOverride(process.env, settings.eyePlateHead), ...(tools ? { tools } : {}) });

/**
 * The desktop's package host adapter: its readiness gate (packaged builder bundle, WolvenKit, game, private
 * storage), its private roots under Electrobun user data (one snapshot, work and stage folder per Build; verified
 * candidates in `package-candidates/`), the bundled builder run by XF Studio's own Bun, and its host log.
 */
export function desktopPackageAdapter(options: { exporters: readonly FeatureExporterEntry[]; settings: LocalSettings; dataRoot: string;
  toolsRoot: string; checkWorker: string; prerequisites: (settings: LocalSettings) => Readonly<Record<string, HostPrerequisite>>;
  wolvenKitProbe?: WolvenKitProbe; log?: (message: string) => void }): PackageHostAdapter {
  const { settings, dataRoot, toolsRoot } = options, probe = options.wolvenKitProbe ?? probeWolvenKit;
  const log = options.log ?? (message => console.error(message));
  return {
    exporters: options.exporters,
    prerequisites: options.prerequisites(settings),
    checkWorker: options.checkWorker,
    buildIssue: async () => {
      // Build itself waits for definitive tool checks (async, shared with readiness requests).
      if (probe === probeWolvenKit) await warmBuildProbes(settings);
      return desktopBuildIssue(settings, dataRoot, toolsRoot, probe);
    },
    buildSetup: () => {
      const id = randomUUID();
      return { snapshot: resolve(dataRoot, "package-snapshots", id), work: resolve(dataRoot, "package-work", id),
        stage: resolve(dataRoot, "package-staging", id), candidates: resolve(dataRoot, "package-candidates"),
        wolvenkit: settings.wolvenKitCli!, gamepath: settings.gameRoot!, ensurePrivate: path => privatePath(dataRoot, path) };
    },
    runBuilder: (args, run) => runProcessTree(builderBun(), [resolve(toolsRoot, builderEntry), ...args, "--app-root", toolsRoot],
      { cwd: run.cwd, signal: run.signal, timeoutMs: run.timeoutMs }),
    log: (scope, code, message, detail) => {
      const text = detail && typeof detail === "object" && "message" in detail ? `${message} ${String((detail as { message: unknown }).message).slice(-3000)}` : message;
      log(`${scope === "build" ? "Build" : "Check"}: ${text}`);
      if (code !== "package_build_cancelled" && code !== "package_check_cancelled")
        hostFailure("package", code, `${scope === "build" ? "Build" : "Check"}: ${message}`, detail instanceof Error ? detail : undefined,
          code === "invalid_collection" || code === "no_exportable_content" ? "warn" : "error");
    },
  };
}
