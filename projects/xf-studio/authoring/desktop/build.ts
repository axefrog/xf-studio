import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { parseCollection } from "../src/preset-collection";
import { preparePackageCollection } from "../src/package-filter";
import { verifyPackageBuildResult } from "../src/package-result-verifier";
import type { PackageBuild } from "../src/package-action";
import type { LocalSettings } from "../src/local-settings";
import { EyePlateError, ensureEyePlate, type EyePlateResult } from "../src/eye-plate-service";
import { createWolvenKitEyePlateTools } from "../src/eye-plate-wolvenkit";
import { runProcessTree } from "../src/process-tree";

export const buildDeadlineMs = 40 * 60_000;
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
const wolvenKitCache = new Map<string, { issue: string | null; until: number }>();
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
      ? "The selected Bun executable cannot run the packaged compiler scripts." : null;
    bunCache.set(key, { issue, until: issue ? Date.now() + 10_000 : Infinity });
    return issue;
  } catch { return "The selected Bun executable could not be checked."; }
}
export const probeWolvenKit: WolvenKitProbe = path => {
  const stamp = statSync(path);
  const key = `${path}|${stamp.size}|${stamp.mtimeMs}`;
  const cached = wolvenKitCache.get(key);
  if (cached && Date.now() < cached.until) return cached.issue;
  const version = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
  let issue: string | null = null;
  if (version.error || version.status !== 0 || !/\b(?:8\.17\.4|9\.0\.1)\b/.test(version.stdout + version.stderr))
    issue = "WolvenKit CLI must be a validated 8.17.4 or 9.0.1 installation.";
  else {
    const help = spawnSync(path, ["--help"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    const commands = help.stdout + help.stderr;
    if (help.error || help.status !== 0 ||
        !["import", "export", "convert", "pack", "extract"].every(name => new RegExp(`\\b${name}\\b`, "i").test(commands)))
      issue = "WolvenKit CLI does not expose the required build and verification commands.";
  }
  wolvenKitCache.set(key, { issue, until: issue ? Date.now() + 10_000 : Infinity });
  return issue;
};
const stampKey = (path: string) => { const stamp = statSync(path); return `${path}|${stamp.size}|${stamp.mtimeMs}`; };
async function run(path: string, args: string[], timeoutMs: number) {
  const child = Bun.spawn([path, ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
  } finally { clearTimeout(timer); }
}
const inFlight = new Map<string, Promise<void>>();
function once(key: string, work: () => Promise<void>): Promise<void> {
  let pending = inFlight.get(key);
  if (!pending) { pending = work().finally(() => inFlight.delete(key)); inFlight.set(key, pending); }
  return pending;
}
/** The same checks as probeWolvenKit/probeBun without blocking the event loop; one shared run per tool. */
export async function warmBuildProbes(settings: LocalSettings): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (settings.wolvenKitCli && file(settings.wolvenKitCli)) {
    const path = settings.wolvenKitCli, key = stampKey(path);
    const cached = wolvenKitCache.get(key);
    if (!cached || Date.now() >= cached.until) jobs.push(once(`wk:${key}`, async () => {
      let issue: string | null = null;
      try {
        const version = await run(path, ["--version"], 15_000);
        if (version.code !== 0 || !/\b(?:8\.17\.4|9\.0\.1)\b/.test(version.stdout + version.stderr))
          issue = "WolvenKit CLI must be a validated 8.17.4 or 9.0.1 installation.";
        else {
          const help = await run(path, ["--help"], 15_000);
          const commands = help.stdout + help.stderr;
          if (help.code !== 0 || !["import", "export", "convert", "pack", "extract"].every(name => new RegExp(`\\b${name}\\b`, "i").test(commands)))
            issue = "WolvenKit CLI does not expose the required build and verification commands.";
        }
      } catch { issue = "WolvenKit CLI could not complete its version and command checks."; }
      wolvenKitCache.set(key, { issue, until: issue ? Date.now() + 10_000 : Infinity });
    }));
  }
  const bun = settings.bunExecutable || process.execPath;
  if (file(bun)) {
    const key = stampKey(bun), cached = bunCache.get(key);
    if (!cached || Date.now() >= cached.until) jobs.push(once(`bun:${key}`, async () => {
      let issue: string | null = null;
      try {
        const result = await run(bun, ["-e", "process.stdout.write('XFS_BUN_OK:' + Bun.version)"], 5000);
        if (result.code !== 0 || !/^XFS_BUN_OK:\d+\.\d+\.\d+/.test(result.stdout)) issue = "The selected Bun executable cannot run the packaged compiler scripts.";
      } catch { issue = "The selected Bun executable could not be checked."; }
      bunCache.set(key, { issue, until: issue ? Date.now() + 10_000 : Infinity });
    }));
  }
  await Promise.all(jobs);
}
/** Readiness-path probes: answer from the cache, or start a background check and say so. */
export const cachedWolvenKitProbe: WolvenKitProbe = path => {
  const cached = wolvenKitCache.get(stampKey(path));
  if (cached && Date.now() < cached.until) return cached.issue;
  void warmBuildProbes({ wolvenKitCli: path } as LocalSettings).catch(() => {});
  return PROBE_PENDING;
};
export const cachedBunProbe: BunProbe = path => {
  const cached = bunCache.get(stampKey(path));
  if (cached && Date.now() < cached.until) return cached.issue;
  void warmBuildProbes({ bunExecutable: path } as LocalSettings).catch(() => {});
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
  if (!settings.wolvenKitCli || !file(settings.wolvenKitCli)) return "Select a WolvenKit CLI executable for Build.";
  if (!signature(settings.wolvenKitCli, "MZ")) return "The selected WolvenKit CLI is not a Windows executable.";
  try { const issue = wolvenKitProbe(settings.wolvenKitCli); if (issue) return issue; }
  catch { return "WolvenKit CLI could not complete its version and command checks."; }
  if (!settings.gameRoot || !file(resolve(settings.gameRoot, "bin/x64/Cyberpunk2077.exe")) ||
      !directory(resolve(settings.gameRoot, "archive/pc"))) return "Select a complete Cyberpunk 2077 game directory.";
  if (!signature(resolve(settings.gameRoot, "bin/x64/Cyberpunk2077.exe"), "MZ"))
    return "The selected game executable is not a Windows executable.";
  const bun = settings.bunExecutable || process.execPath;
  if (!file(bun)) return "The Bun executable is unavailable.";
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

type BuildOutcome = { kind: "success"; result: PackageBuild } |
  { kind: "failure"; code: string; message: string };

/** Prepares the verified built-in eye plate for one Build; injectable for host tests. */
export type DesktopPlatePreparer = (settings: LocalSettings, cacheRoot: string, signal: AbortSignal) => Promise<EyePlateResult>;
export const prepareDesktopPlate: DesktopPlatePreparer = (settings, cacheRoot, signal) => ensureEyePlate({
  gameRoot: settings.gameRoot!, cacheRoot, tools: createWolvenKitEyePlateTools(settings.wolvenKitCli!), signal });

/** Prepare the built-in eye plate, then run the packaged builder as one bounded process tree; publish only the shared verified result. */
export async function runDesktopBuild(value: unknown, settings: LocalSettings, dataRoot: string, toolsRoot: string,
  timeoutMs = buildDeadlineMs, signal?: AbortSignal, wolvenKitProbe: WolvenKitProbe = probeWolvenKit,
  preparePlate: DesktopPlatePreparer = prepareDesktopPlate, log: (message: string) => void = message => console.error(message)): Promise<BuildOutcome> {
  // Build itself waits for definitive tool checks (async, shared with readiness requests).
  if (wolvenKitProbe === probeWolvenKit) await warmBuildProbes(settings);
  const issue = desktopBuildIssue(settings, dataRoot, toolsRoot, wolvenKitProbe);
  if (issue) return { kind: "failure", code: "package_build_unavailable", message: issue };
  const started = Date.now();
  let collection: ReturnType<typeof parseCollection>;
  let prepared: ReturnType<typeof preparePackageCollection>;
  try { collection = parseCollection(value); prepared = preparePackageCollection(collection); }
  catch (error) { return { kind: "failure", code: "invalid_collection", message: (error as Error).message }; }
  const source = JSON.stringify(collection);
  const work = resolve(dataRoot, "package-snapshots", randomUUID());
  const buildRoot = resolve(dataRoot, "package-work", randomUUID());
  const stageRoot = resolve(dataRoot, "package-staging", randomUUID());
  const candidateRoot = resolve(dataRoot, "package-candidates");
  try { for (const path of [work, buildRoot, stageRoot, candidateRoot]) privatePath(dataRoot, path); }
  catch { return { kind: "failure", code: "package_build_unavailable", message: "Private package storage is unsafe." }; }
  let plate: EyePlateResult;
  const plateDeadline = new AbortController();
  const plateTimer = setTimeout(() => plateDeadline.abort(), timeoutMs);
  const plateAbort = () => plateDeadline.abort();
  signal?.addEventListener("abort", plateAbort, { once: true });
  try {
    privatePath(dataRoot, desktopPlateCache(dataRoot));
    plate = await preparePlate(settings, desktopPlateCache(dataRoot), plateDeadline.signal);
  } catch (error) {
    if (error instanceof EyePlateError) {
      if (error.detail) log(`Build: eye plate preparation failed (${error.code}): ${error.detail.slice(-3000)}`);
      if (error.code === "plate_cancelled") return signal?.aborted
        ? { kind: "failure", code: "package_build_cancelled", message: "Package Build was cancelled." }
        : { kind: "failure", code: "package_build_timeout", message: "Package Build exceeded its time limit and was stopped." };
      return { kind: "failure", code: error.code, message: error.message };
    }
    return { kind: "failure", code: "package_build_failed", message: "The built-in eye plate could not be prepared. No candidate was published." };
  } finally { clearTimeout(plateTimer); signal?.removeEventListener("abort", plateAbort); }
  const remainingMs = Math.max(1, timeoutMs - (Date.now() - started));
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const snapshot = resolve(work, "collection.json");
  writeFileSync(snapshot, source, { mode: 0o600, flag: "wx" });
  const args = [resolve(toolsRoot, builderEntry), "--collection", snapshot,
    "--plate", plate.directory, "--plate-manifest", plate.manifestFile,
    "--wolvenkit", settings.wolvenKitCli!, "--gamepath", settings.gameRoot!,
    "--app-root", toolsRoot, "--build-root", buildRoot, "--dist-root", stageRoot, "--machine-result"];
  try {
    const run = await runProcessTree(settings.bunExecutable || process.execPath, args, { cwd: work, signal, timeoutMs: remainingMs });
    if (run.stopped === "timeout")
      return { kind: "failure", code: "package_build_timeout", message: "Package Build exceeded its time limit and was stopped." };
    if (run.stopped === "cancelled") return { kind: "failure", code: "package_build_cancelled", message: "Package Build was cancelled." };
    if (run.exitCode !== 0) {
      log(`Build: the package tool failed (exit ${run.exitCode}): ${(run.error?.message ?? run.stderr).slice(-3000)}`);
      return { kind: "failure", code: "package_build_failed", message: "Package Build failed. No candidate was published." };
    }
    const line = run.stdout.split(/\r?\n/).reverse().find(value => value.startsWith("XFS_PACKAGE_RESULT="));
    if (!line) throw Error("Package tool completed without a result.");
    const built = JSON.parse(line.slice("XFS_PACKAGE_RESULT=".length)) as PackageBuild;
    verifyPackageBuildResult(built, collection, prepared, source, stageRoot, plate.manifest);
    privatePath(dataRoot, candidateRoot);
    mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
    privatePath(dataRoot, candidateRoot);
    const promoted = resolve(candidateRoot, basename(built.package));
    renameSync(built.package, promoted);
    const result = { ...built, package: promoted, manifest: resolve(promoted, "manifest.json") };
    verifyPackageBuildResult(result, collection, prepared, source, candidateRoot, plate.manifest);
    return { kind: "success", result };
  } catch (error) {
    log(`Build: the package result failed verification: ${(error as Error).message}`);
    return { kind: "failure", code: "package_build_failed", message: "Package Build could not verify its result. No candidate was published." };
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stageRoot, { recursive: true, force: true });
    rmSync(buildRoot, { recursive: true, force: true });
  }
}
