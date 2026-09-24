import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { parseCollection } from "../src/preset-collection";
import { preparePackageCollection } from "../src/package-filter";
import { verifyPackageBuildResult } from "../src/package-result-verifier";
import type { PackageBuild } from "../src/package-action";
import type { LocalSettings } from "../src/local-settings";

export const buildDeadlineMs = 40 * 60_000;
const toolNames = ["build_collection_package.py", "study/build.py", "study/verify.py",
  "study/mip_maps.py", "study/archive_inventory.py", "app/tools/preflight.js", "app/tools/bake.js"];
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
const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
export type WolvenKitProbe = (path: string) => string | null;
const wolvenKitCache = new Map<string, { issue: string | null; until: number }>();
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

/** A packaged code bundle, external executables, private plate and game are all required. */
export function desktopBuildIssue(settings: LocalSettings, dataRoot: string, toolsRoot: string,
  wolvenKitProbe: WolvenKitProbe = probeWolvenKit): string | null {
  try {
    const manifest = JSON.parse(readFileSync(resolve(toolsRoot, "manifest.json"), "utf8"));
    if (manifest.schema !== "xfs/desktop-build-tools-1" || !manifest.files ||
      JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...toolNames].sort()))
      return "The packaged build tools are incomplete.";
    const actualTools = realpathSync(toolsRoot);
    for (const name of toolNames) {
      const path = resolve(toolsRoot, name);
      if (!file(path) || !inside(realpathSync(path), actualTools) ||
        createHash("sha256").update(readFileSync(path)).digest("hex") !== manifest.files[name])
        return "The packaged build tools failed integrity checks.";
    }
  } catch { return "The packaged build tools are unavailable."; }
  if (!settings.pythonExecutable || !file(settings.pythonExecutable)) return "Select a Python executable for Build.";
  if (!settings.wolvenKitCli || !file(settings.wolvenKitCli)) return "Select a WolvenKit CLI executable for Build.";
  if (!signature(settings.wolvenKitCli, "MZ")) return "The selected WolvenKit CLI is not a Windows executable.";
  try { const issue = wolvenKitProbe(settings.wolvenKitCli); if (issue) return issue; }
  catch { return "WolvenKit CLI could not complete its version and command checks."; }
  if (!settings.plateInput || !directory(settings.plateInput) ||
      !["xfas_eye_plate.mesh", "xfas_eye_plate.morphtarget"].every(name => file(resolve(settings.plateInput!, name))))
    return "Select a private plate directory with both mesh and morph resources.";
  if (!["xfas_eye_plate.mesh", "xfas_eye_plate.morphtarget"].every(name =>
      signature(resolve(settings.plateInput!, name), "CR2W")))
    return "The selected plate resources do not have the expected game resource format.";
  if (!settings.gameRoot || !file(resolve(settings.gameRoot, "bin/x64/Cyberpunk2077.exe")) ||
      !directory(resolve(settings.gameRoot, "archive/pc"))) return "Select a complete Cyberpunk 2077 game directory.";
  if (!signature(resolve(settings.gameRoot, "bin/x64/Cyberpunk2077.exe"), "MZ"))
    return "The selected game executable is not a Windows executable.";
  const bun = settings.bunExecutable || process.execPath;
  if (!file(bun)) return "The Bun executable is unavailable.";
  try {
    for (const name of ["package-snapshots", "package-work", "package-staging", "package-candidates"])
      privatePath(dataRoot, resolve(dataRoot, name));
  } catch { return "Private build storage uses a linked path."; }
  // Reject a user-data path nested in any input, including an MO2 root that
  // the Python wrapper cannot know about. Never build into game/mod sources.
  try {
    const output = realpathSync(dataRoot);
    for (const input of [toolsRoot, settings.gameRoot, settings.plateInput,
      settings.wolvenKitCli, settings.pythonExecutable, bun, settings.mo2Root].filter((v): v is string => !!v)) {
      const source = realpathSync(input);
      if (inside(output, source) || inside(source, output)) return "Private build data overlaps a configured input.";
    }
  } catch { return "A configured build path is unavailable."; }
  const probe = spawnSync(settings.pythonExecutable, ["-c", "import numpy; from PIL import Image"],
    { timeout: 5000, windowsHide: true, stdio: "ignore" });
  if (probe.error || probe.status !== 0) return "Python needs NumPy and Pillow for the independent verifier.";
  return null;
}

type BuildOutcome = { kind: "success"; result: PackageBuild } |
  { kind: "failure"; code: string; message: string };

/** Run the wrapper as one bounded process tree; publish only the shared verified result. */
export async function runDesktopBuild(value: unknown, settings: LocalSettings, dataRoot: string, toolsRoot: string,
  timeoutMs = buildDeadlineMs, signal?: AbortSignal, wolvenKitProbe: WolvenKitProbe = probeWolvenKit): Promise<BuildOutcome> {
  const issue = desktopBuildIssue(settings, dataRoot, toolsRoot, wolvenKitProbe);
  if (issue) return { kind: "failure", code: "package_build_unavailable", message: issue };
  let collection: ReturnType<typeof parseCollection>;
  let prepared: ReturnType<typeof preparePackageCollection>;
  try { collection = parseCollection(value); prepared = preparePackageCollection(collection); }
  catch (error) { return { kind: "failure", code: "invalid_collection", message: (error as Error).message }; }
  const source = JSON.stringify(collection);
  const work = resolve(dataRoot, "package-snapshots", randomUUID());
  const buildRoot = resolve(dataRoot, "package-work");
  const stageRoot = resolve(dataRoot, "package-staging", randomUUID());
  const candidateRoot = resolve(dataRoot, "package-candidates");
  try { for (const path of [work, buildRoot, stageRoot, candidateRoot]) privatePath(dataRoot, path); }
  catch { return { kind: "failure", code: "package_build_unavailable", message: "Private package storage is unsafe." }; }
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const snapshot = resolve(work, "collection.json");
  writeFileSync(snapshot, source, { mode: 0o600, flag: "wx" });
  const python = settings.pythonExecutable!;
  const args = [resolve(toolsRoot, "build_collection_package.py"), "--collection", snapshot,
    "--bun", settings.bunExecutable || process.execPath, "--plate", settings.plateInput!,
    "--wolvenkit", settings.wolvenKitCli!, "--gamepath", settings.gameRoot!,
    "--app-root", resolve(toolsRoot, "app"), "--study-root", resolve(toolsRoot, "study"),
    "--work-root", work, "--build-root", buildRoot, "--dist-root", stageRoot,
    "--preflight-script", resolve(toolsRoot, "app/tools/preflight.js"),
    "--bake-script", resolve(toolsRoot, "app/tools/bake.js"), "--machine-result"];
  try {
    const processResult = await new Promise<{ code: number | null; stdout: string; stderr: string; stopped: string | null }>(done => {
      const child = spawn(python, args, { cwd: work, windowsHide: true, detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "", stopped: string | null = null, settled = false;
      const keep = (old: string, chunk: Buffer) => (old + chunk.toString("utf8")).slice(-128_000);
      child.stdout.on("data", chunk => { stdout = keep(stdout, chunk); });
      child.stderr.on("data", chunk => { stderr = keep(stderr, chunk); });
      const stopTree = (reason: string) => {
        if (settled || stopped) return;
        stopped = reason;
        if (child.pid) {
          if (process.platform === "win32") {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            killer.on("error", () => child.kill());
            killer.on("close", code => { if (code !== 0) child.kill(); });
          } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
        } else child.kill();
      };
      const abort = () => stopTree("package_build_cancelled");
      const timer = setTimeout(() => stopTree("package_build_timeout"), timeoutMs);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
        done({ code, stdout, stderr, stopped });
      };
      child.on("error", () => finish(null));
      child.on("close", code => finish(code));
    });
    if (processResult.stopped) return { kind: "failure", code: processResult.stopped,
      message: processResult.stopped === "package_build_timeout" ? "Package Build exceeded its time limit and was stopped." :
        "Package Build was cancelled." };
    if (processResult.code !== 0) {
      console.error("Desktop package tool failed:", processResult.stderr.slice(-3000));
      return { kind: "failure", code: "package_build_failed", message: "Package Build failed. No candidate was published." };
    }
    const line = processResult.stdout.split(/\r?\n/).reverse().find(value => value.startsWith("XFS_PACKAGE_RESULT="));
    if (!line) throw Error("Package tool completed without a result.");
    const built = JSON.parse(line.slice("XFS_PACKAGE_RESULT=".length)) as PackageBuild;
    verifyPackageBuildResult(built, collection, prepared, source, stageRoot);
    privatePath(dataRoot, candidateRoot);
    mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
    privatePath(dataRoot, candidateRoot);
    const promoted = resolve(candidateRoot, basename(built.package));
    renameSync(built.package, promoted);
    const result = { ...built, package: promoted, manifest: resolve(promoted, "manifest.json") };
    verifyPackageBuildResult(result, collection, prepared, source, candidateRoot);
    return { kind: "success", result };
  } catch (error) {
    console.error("Desktop package result failed:", (error as Error).message);
    return { kind: "failure", code: "package_build_failed", message: "Package Build could not verify its result. No candidate was published." };
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stageRoot, { recursive: true, force: true });
  }
}
