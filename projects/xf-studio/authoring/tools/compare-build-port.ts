// Dev-only side-by-side harness for the Python-to-TypeScript build port (Phase 1).
// Runs the Experiment 005 Python oracle and the TypeScript modules on the same inputs
// and diffs their outputs. Writes only to ignored folders; never installs anything.
//
//   bun tools/compare-build-port.ts mips [collection.json] [--size 1024]
//   bun tools/compare-build-port.ts inventory <build-dir>
//   bun tools/compare-build-port.ts verify <build-dir> [--wolvenkit WolvenKit.CLI.exe]
//
// `verify` copies nothing: pass a private *copy* of a build, because the Python
// verifier writes verification.json and unpacks into <build>/unpacked.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { planCollection } from "../src/preset-collection";
import { compileFlatPreset } from "../src/preset-compiler";
import { encodeFlatDds, flatMipChain, type FlatMapChannel } from "../src/flat-mip-chain";

const app = resolve(import.meta.dir, "..");
const hq = resolve(app, "../../..");
const study = resolve(hq, "experiments/005-preset-collection");
const scratch = resolve(app, "../build/port-compare");
const python = process.env.XFS_PYTHON || "python";
const channels: FlatMapChannel[] = ["diffuse", "roughness", "metalness"];
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function runPython(code: string, input: string) {
  const result = Bun.spawnSync([python, "-c", code], { cwd: study, stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw Error(`Python oracle failed: ${result.stderr.toString().slice(-3000)}`);
  return result.stdout.toString();
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function compareMips(args: string[]) {
  const collection = resolve(args.find(a => !a.startsWith("--") && a !== option(args, "--size")) ?? resolve(study, "editor-collection.json"));
  const size = Number(option(args, "--size") ?? 1024);
  const out = resolve(scratch, `mips-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  const plan = planCollection(JSON.parse(readFileSync(collection, "utf8")));
  const jobs = [];
  for (const preset of plan.presets) {
    const compiled = compileFlatPreset(preset.recipe, size);
    const files: Record<string, string> = {};
    for (const channel of channels) {
      const file = resolve(out, `${preset.appearance}_${channel}.raw`);
      writeFileSync(file, compiled[channel]);
      files[channel] = file;
    }
    jobs.push({ name: preset.appearance, size, files, compiled });
  }
  // Python oracle: the unchanged Experiment 005 mip_maps.py.
  runPython(`
import json,sys
from pathlib import Path
from mip_maps import mip_levels, dds_bytes
for job in json.load(sys.stdin):
    raw={c:Path(p).read_bytes() for c,p in job['files'].items()}
    levels=mip_levels(raw['diffuse'],raw['roughness'],raw['metalness'],job['size'])
    for c,l in zip(['diffuse','roughness','metalness'],levels):
        Path(job['out']+'_'+c+'.py.dds').write_bytes(dds_bytes(l,job['size'],c))
`, JSON.stringify(jobs.map(j => ({ files: j.files, size: j.size, out: resolve(out, j.name) }))));
  const report = [];
  let totalDiff = 0;
  for (const job of jobs) {
    const chain = flatMipChain(job.compiled.diffuse, job.compiled.roughness, job.compiled.metalness, size);
    for (const channel of channels) {
      const ts = encodeFlatDds(chain[channel], size, channel);
      writeFileSync(resolve(out, `${job.name}_${channel}.ts.dds`), ts);
      const py = new Uint8Array(readFileSync(resolve(out, `${job.name}_${channel}.py.dds`)));
      let diff = 0, maxDelta = 0;
      const perLevel: number[] = [];
      let offset = 148, side = size, stride = channel === "diffuse" ? 4 : 1;
      if (py.length !== ts.length) throw Error(`${job.name} ${channel}: length ${py.length} vs ${ts.length}`);
      for (let i = 0; i < 148; i++) if (py[i] !== ts[i]) diff++;
      while (offset < py.length) {
        const length = side * side * stride;
        let levelDiff = 0;
        for (let i = offset; i < offset + length; i++) if (py[i] !== ts[i]) { levelDiff++; maxDelta = Math.max(maxDelta, Math.abs(py[i] - ts[i])); }
        perLevel.push(levelDiff); diff += levelDiff; offset += length; side = Math.max(1, side >> 1);
      }
      totalDiff += diff;
      report.push({ preset: job.name, channel, bytes: ts.length, differingBytes: diff, maxDelta, perLevel,
        identical: diff === 0, sha256: { python: sha(py), typescript: sha(ts) } });
    }
  }
  writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ collection, size, presets: jobs.length, files: report.length, differingBytes: totalDiff,
    identical: report.filter(r => r.identical).length, output: out }, null, 2));
  if (totalDiff) process.exitCode = 1;
}

async function compareInventory(args: string[]) {
  const { archiveInventory } = await import("../src/archive-inventory-fs");
  const build = resolve(args[0] ?? "");
  const plan = JSON.parse(readFileSync(resolve(build, "build.json"), "utf8")).plan;
  const py = JSON.parse(runPython(`
import json,sys
from archive_inventory import inventory
root,plan=json.load(sys.stdin)
print(json.dumps(inventory(root,plan)))
`, JSON.stringify([resolve(build, "archive"), plan])));
  const ts = archiveInventory(resolve(build, "archive"), plan);
  const same = JSON.stringify(py) === JSON.stringify(ts);
  console.log(JSON.stringify({ build, entries: ts.length, identical: same }, null, 2));
  if (!same) { console.log(JSON.stringify({ python: py, typescript: ts }, null, 2)); process.exitCode = 1; }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function diffJson(a: Json, b: Json, path: string, out: { path: string; python: Json; typescript: Json; relative?: number }[]) {
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) {
      const relative = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
      out.push({ path, python: a, typescript: b, relative });
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: path + ".length", python: a.length, typescript: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffJson(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a) || !(key in b)) out.push({ path: `${path}.${key}`, python: a[key] ?? null, typescript: b[key] ?? null });
      else diffJson(a[key], b[key], `${path}.${key}`, out);
    }
    return;
  }
  if (a !== b) out.push({ path, python: a, typescript: b });
}

async function compareVerify(args: string[]) {
  const build = resolve(args[0] ?? "");
  const wolvenkit = resolve(option(args, "--wolvenkit") ?? "F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe");
  if (!existsSync(resolve(build, "build.json"))) throw Error(`Not a build: ${build}`);
  if (resolve(build).toLowerCase().startsWith(resolve(hq, "experiments").toLowerCase()) && !build.includes("port-compare"))
    console.warn("Warning: the Python verifier writes into this build; prefer a private copy.");
  let started = performance.now();
  const py = Bun.spawnSync([python, resolve(study, "verify.py"), "--build", build, "--wolvenkit", wolvenkit],
    { cwd: hq, stdout: "pipe", stderr: "pipe" });
  const pythonSeconds = (performance.now() - started) / 1000;
  if (py.exitCode !== 0) throw Error(`Python verifier failed: ${py.stderr.toString().slice(-3000)}`);
  const pyReport = JSON.parse(readFileSync(resolve(build, "verification.json"), "utf8"));
  const { verifyBuild } = await import("../src/mod-verifier/verify-build");
  const unpackDir = resolve(build, "unpacked-ts");
  rmSync(unpackDir, { recursive: true, force: true });
  started = performance.now();
  const tsReport = await verifyBuild({ build, wolvenkit, unpackDir });
  const tsSeconds = (performance.now() - started) / 1000;
  writeFileSync(resolve(build, "verification-ts.json"), JSON.stringify(tsReport, null, 2) + "\n");
  const differences: { path: string; python: Json; typescript: Json; relative?: number }[] = [];
  diffJson(pyReport, tsReport as unknown as Json, "$", differences);
  // The only intentional structural difference is the unpack directory's build-relative location.
  const numeric = differences.filter(d => d.relative !== undefined);
  const other = differences.filter(d => d.relative === undefined);
  const maxRelative = Math.max(0, ...numeric.map(d => d.relative!));
  console.log(JSON.stringify({ build, pythonSeconds, tsSeconds, fields: differences.length, numericDifferences: numeric.length,
    maxRelativeNumericDifference: maxRelative, nonNumericDifferences: other }, null, 2));
  if (other.length || maxRelative > 1e-9) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "mips") await compareMips(rest);
else if (command === "inventory") await compareInventory(rest);
else if (command === "verify") await compareVerify(rest);
else {
  console.error("Usage: bun tools/compare-build-port.ts mips [collection.json] [--size N] | inventory <build> | verify <build> [--wolvenkit exe]");
  process.exitCode = 2;
}
