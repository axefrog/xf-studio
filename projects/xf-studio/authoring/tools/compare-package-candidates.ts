// The byte-identity gate for mod packages, re-runnable (PIPE-95): compares two verified candidates of the same
// collection (for example one built by `main` and one by a branch, with the same CLI arguments, plate and tools) and,
// optionally, pairs of intermediate trees. Reads only; WolvenKit unbundles each archive into a scratch folder.
//
//   bun tools/compare-package-candidates.ts <candidate-a> <candidate-b> --wolvenkit <WolvenKit.CLI.exe> [--gamepath <game>]
//     [--work <scratch dir>] [--tree <dir-a> <dir-b>]...
//
// A candidate is a promoted folder: manifest.json (xfs/local-package-1 or -2) and archive/pc/mod/<archive>.archive(.xl).
// The gate passes when the archives' members (paths, lengths, SHA-256) are identical, the .archive.xl bytes are identical,
// the manifests agree on archive name, feature namespaces, mod name, verified file and look counts (and, for two
// version-2 manifests, on every field but the archive container's own hash and length, which record WolvenKit's build), and every
// `--tree` pair holds identical files. `.json` files in trees are compared without WolvenKit's `Header` (export time).
// Prints a JSON report; exits 1 when anything differs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readPackageManifest } from "../src/platform/export/manifest";
import type { VerifierTools } from "../src/platform/api";

export type FileRecord = { path: string; bytes: number; sha256: string };
export type CandidateComparison = { identical: boolean; differences: string[]; members: number };
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Every regular file below `root`: slash-separated relative path, length and SHA-256 (`.json` without `Header` when asked). */
export function treeFiles(root: string, withoutJsonHeader = false): FileRecord[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : entry.isFile() ? [join(dir, entry.name)] : []);
  return walk(root).map(path => {
    const bytes = readFileSync(path);
    let data: Uint8Array | string = bytes;
    if (withoutJsonHeader && path.endsWith(".json")) {
      try { const { Header: _header, ...rest } = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); data = JSON.stringify(rest); }
      catch { /* Not JSON after all: compared as bytes. */ }
    }
    return { path: path.slice(root.length + 1).split(/[\\/]/).join("/"), bytes: data.length, sha256: sha(data) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** The differences between two file lists, in words (missing, extra, changed). */
export function treeDifferences(label: string, a: readonly FileRecord[], b: readonly FileRecord[]): string[] {
  const left = new Map(a.map(file => [file.path, file])), right = new Map(b.map(file => [file.path, file]));
  return [...[...left.keys()].filter(path => !right.has(path)).map(path => `${label}: only in A: ${path}`),
    ...[...right.keys()].filter(path => !left.has(path)).map(path => `${label}: only in B: ${path}`),
    ...[...left].filter(([path, file]) => right.has(path) && (right.get(path)!.sha256 !== file.sha256 || right.get(path)!.bytes !== file.bytes))
      .map(([path]) => `${label}: differs: ${path}`)];
}

/** Compare two candidate folders; `unbundle` is WolvenKit's (or a test's stand-in) and writes only below `work`. */
export function compareCandidates(a: string, b: string, unbundle: VerifierTools["unbundle"], work: string): CandidateComparison {
  const read = (root: string) => {
    const raw = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    return { raw, view: readPackageManifest(raw, "eye-makeup") };
  };
  const left = read(a), right = read(b), differences: string[] = [];
  const same = (label: string, x: unknown, y: unknown) => { if (JSON.stringify(x) !== JSON.stringify(y)) differences.push(`manifest ${label}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); };
  same("archive", left.view.archive, right.view.archive);
  same("features", left.view.features, right.view.features);
  same("mod name", left.view.modName, right.view.modName);
  same("verified files", left.view.verifiedUnpackedFiles, right.view.verifiedUnpackedFiles);
  same("verified looks", left.view.presetCount, right.view.presetCount);
  if (left.view.schema === "xfs/local-package-2" && right.view.schema === "xfs/local-package-2") {
    const strip = (raw: { files: { sha256: string; bytes: number }[] }) => ({ ...raw, files: [{ ...raw.files[0], sha256: "(archive)", bytes: 0 }, raw.files[1]] });
    same("fields", strip(left.raw), strip(right.raw));
  }
  const payload = (root: string, archive: string, suffix: string) => join(root, "archive", "pc", "mod", `${archive}${suffix}`);
  if (!readFileSync(payload(a, left.view.archive, ".archive.xl")).equals(readFileSync(payload(b, right.view.archive, ".archive.xl"))))
    differences.push("the .archive.xl files differ");
  const members = (root: string, archive: string, name: string) => {
    const output = join(work, name);
    mkdirSync(output, { recursive: true });
    const run = unbundle(payload(root, archive, ".archive"), output);
    if (run.exitCode !== 0) throw Error(`WolvenKit could not unbundle ${name}: ${(run.stdout + run.stderr).slice(-2000)}`);
    return treeFiles(output);
  };
  const x = members(a, left.view.archive, "a"), y = members(b, right.view.archive, "b");
  differences.push(...treeDifferences("archive members", x, y));
  return { identical: !differences.length, differences, members: x.length };
}

if (import.meta.main) {
  const args = process.argv.slice(2), positional: string[] = [], trees: [string, string][] = [];
  let wolvenkit: string | undefined, gamepath: string | undefined, work: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wolvenkit") wolvenkit = args[++i];
    else if (args[i] === "--gamepath") gamepath = args[++i];
    else if (args[i] === "--work") work = args[++i];
    else if (args[i] === "--tree") trees.push([resolve(args[++i]), resolve(args[++i])]);
    else positional.push(resolve(args[i]));
  }
  if (positional.length !== 2 || !wolvenkit) {
    console.error("Usage: bun tools/compare-package-candidates.ts <candidate-a> <candidate-b> --wolvenkit <WolvenKit.CLI.exe> [--gamepath <game>] [--work <dir>] [--tree <a> <b>]...");
    process.exit(2);
  }
  const { createWolvenKitVerifierTools } = await import("../src/verifier-wolvenkit");
  const base = resolve(import.meta.dir, "../../build");
  if (!work) mkdirSync(base, { recursive: true });
  const scratch = work ? resolve(work) : mkdtempSync(join(base, "candidate-compare-"));
  if (existsSync(scratch) && readdirSync(scratch).length) { console.error(`The work folder must be empty: ${scratch}`); process.exit(2); }
  try {
    const report = compareCandidates(positional[0], positional[1], createWolvenKitVerifierTools(wolvenkit, gamepath).unbundle, scratch);
    for (const [left, right] of trees) {
      if (!statSync(left).isDirectory() || !statSync(right).isDirectory()) throw Error(`Not a folder pair: ${left} ${right}`);
      report.differences.push(...treeDifferences(`tree ${left}`, treeFiles(left, true), treeFiles(right, true)));
    }
    report.identical = !report.differences.length;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.identical ? 0 : 1;
  } finally { if (!work) rmSync(scratch, { recursive: true, force: true }); }
}
