// Dev-only side-by-side harness for the Python-to-TypeScript build port.
// Runs the Experiment 005 Python oracle and the TypeScript modules on the same inputs
// and diffs their outputs. Writes only to ignored folders; never installs anything.
//
//   bun tools/compare-build-port.ts mips [collection.json] [--size 1024]
//   bun tools/compare-build-port.ts supplied <build-dir>   (TS chain vs the build's Python-written input DDS)
//   bun tools/compare-build-port.ts inventory <build-dir>
//   bun tools/compare-build-port.ts verify <build-dir> [--wolvenkit WolvenKit.CLI.exe]
//   bun tools/compare-build-port.ts builds <python-build-dir> <typescript-build-dir>
//
// `verify` copies nothing: pass a private *copy* of a Python-built intermediate, because
// the Python verifier writes verification.json and unpacks into <build>/unpacked. It needs
// the builder's PNG copies, which only the Python builder writes. `builds` only reads: it
// compares a verified intermediate from the Python oracle (experiments/005 build.py and
// verify.py) with a verified product Build intermediate of the same collection and plate.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
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

function compareSupplied(args: string[]) {
  const build = resolve(args[0] ?? "");
  const record = JSON.parse(readFileSync(resolve(build, "build.json"), "utf8"));
  let files = 0, identical = 0;
  for (const [i, preset] of record.plan.presets.entries()) {
    const compiled = record.compiled[i], raw: Record<string, Uint8Array> = {};
    for (const map of compiled.maps) raw[map.channel] = new Uint8Array(readFileSync(resolve(build, "baked", map.file)));
    const chain = flatMipChain(raw.diffuse, raw.roughness, raw.metalness, compiled.size);
    for (const channel of channels) {
      const group = channel === "diffuse" ? "dds-colour" : "dds-scalar";
      const python = readFileSync(resolve(build, "input", group, `${preset.appearance}_${channel}.dds`));
      files++;
      if (Buffer.compare(python, encodeFlatDds(chain[channel], compiled.size, channel)) === 0) identical++;
    }
  }
  console.log(JSON.stringify({ build, files, identical }, null, 2));
  if (files !== identical) process.exitCode = 1;
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
  const configured = option(args, "--wolvenkit") ?? process.env.XFS_WOLVENKIT;
  if (!configured) throw Error("Pass --wolvenkit <WolvenKit.CLI.exe> or set XFS_WOLVENKIT.");
  const wolvenkit = resolve(configured);
  if (!existsSync(resolve(build, "build.json"))) throw Error(`Not a build: ${build}`);
  if (resolve(build).toLowerCase().startsWith(resolve(hq, "experiments").toLowerCase()) && !build.includes("port-compare"))
    console.warn("Warning: the Python verifier writes into this build; prefer a private copy.");
  let started = performance.now();
  const py = Bun.spawnSync([python, resolve(study, "verify.py"), "--build", build, "--wolvenkit", wolvenkit],
    { cwd: hq, stdout: "pipe", stderr: "pipe" });
  const pythonSeconds = (performance.now() - started) / 1000;
  if (py.exitCode !== 0) throw Error(`Python verifier failed: ${py.stderr.toString().slice(-3000)}`);
  const pyReport = JSON.parse(readFileSync(resolve(build, "verification.json"), "utf8"));
  // Evidence for dropping the verifier's PNG inputs: the builder's input PNGs equal the
  // baked raw maps, and WolvenKit's PNG export equals the DDS export's level 0.
  const pngEquivalence = JSON.parse(runPython(`
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
from mip_maps import read_dds_levels
out=Path(sys.stdin.read().strip());b=json.loads((out/'build.json').read_text());checked=0;same=0
for preset,record in zip(b['plan']['presets'],b['compiled']):
    for m in record['maps']:
        colour=m['channel']=='diffuse';mode='RGBA' if colour else 'L'
        png=np.asarray(Image.open(out/'input'/('colour' if colour else 'scalar')/(Path(m['file']).stem+'.png')).convert(mode)).tobytes()
        exported=np.asarray(Image.open(out/'export'/(Path(m['file']).stem+'.png')).convert(mode)).tobytes()
        level0=read_dds_levels(out/'export-dds'/(Path(m['file']).stem+'.dds'),m['channel'])[1][0].tobytes()
        checked+=1;same+=int(png==(out/'baked'/m['file']).read_bytes() and exported==level0)
print(json.dumps({'textures':checked,'inputPngEqualsRawAndExportPngEqualsDdsLevel0':same}))
`, build));
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
  console.log(JSON.stringify({ build, pngEquivalence, pythonSeconds, tsSeconds, fields: differences.length, numericDifferences: numeric.length,
    maxRelativeNumericDifference: maxRelative, nonNumericDifferences: other }, null, 2));
  if (other.length || maxRelative > 1e-12 || pngEquivalence.textures !== pngEquivalence.inputPngEqualsRawAndExportPngEqualsDdsLevel0) process.exitCode = 1;
}

/** Relative path -> SHA-256 of every file below root (empty when root is absent). */
function treeHashes(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(root)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.set(relative(root, path).split(sep).join("/"), sha(readFileSync(path)));
    }
  };
  walk(root);
  return out;
}

function compareTrees(label: string, a: string, b: string) {
  const left = treeHashes(a), right = treeHashes(b);
  const differing = [...new Set([...left.keys(), ...right.keys()])].filter(key => left.get(key) !== right.get(key)).sort();
  return { label, python: left.size, typescript: right.size, identical: differing.length === 0 && left.size > 0, differing };
}

/** Parsed-JSON equality of the generated resource inputs, ignoring WolvenKit's export header (timestamp, source path). */
function compareJsonInputs(label: string, a: string, b: string) {
  const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].sort();
  const strip = (file: string) => {
    const value = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
    delete value.Header;
    return value;
  };
  const differing = names.filter(name => !existsSync(resolve(a, name)) || !existsSync(resolve(b, name)) ||
    !Bun.deepEquals(strip(resolve(a, name)), strip(resolve(b, name))));
  return { label, files: names.length, identical: differing.length === 0 && names.length > 0, differing };
}

/** Compare a Python-wrapper intermediate with a product (TypeScript) intermediate of the same collection and plate. */
function compareBuilds(args: string[]) {
  const [pythonBuild, tsBuild] = [args[0], args[1]].map(arg => resolve(arg ?? ""));
  for (const build of [pythonBuild, tsBuild])
    if (!existsSync(resolve(build, "build.json")) || !existsSync(resolve(build, "verification.json")))
      throw Error(`Not a verified build: ${build}`);
  const py = JSON.parse(readFileSync(resolve(pythonBuild, "build.json"), "utf8"));
  const ts = JSON.parse(readFileSync(resolve(tsBuild, "build.json"), "utf8"));
  if (py.plan.namespace !== ts.plan.namespace) throw Error("The builds are of different collections.");
  const ns: string = py.plan.namespace;
  const xl = (build: string) => readFileSync(resolve(build, "package", "archive", "pc", "mod", ns + ".archive.xl"));
  // Unpacked members are what the game reads; each verifier unpacked the packed archive into <build>/unpacked.
  const trees = [
    compareTrees("unpacked archive members", resolve(pythonBuild, "unpacked"), resolve(tsBuild, "unpacked")),
    compareTrees("generated resources before pack", resolve(pythonBuild, "archive"), resolve(tsBuild, "archive")),
    compareTrees("baked raw maps", resolve(pythonBuild, "baked"), resolve(tsBuild, "baked")),
    compareTrees("DDS colour inputs", resolve(pythonBuild, "input", "dds-colour"), resolve(tsBuild, "input", "dds-colour")),
    compareTrees("DDS scalar inputs", resolve(pythonBuild, "input", "dds-scalar"), resolve(tsBuild, "input", "dds-scalar")),
    compareTrees("decoded DDS export", resolve(pythonBuild, "export-dds"), resolve(tsBuild, "export-dds")),
  ];
  const inputs = ["models-json", "app-json", "cc-json"].map(dir => compareJsonInputs(dir, resolve(pythonBuild, dir), resolve(tsBuild, dir)));
  const hashes = (inputs: { sha256: string }[]) => inputs.map(input => input.sha256);
  const records = { plan: Bun.deepEquals(py.plan, ts.plan), compiled: Bun.deepEquals(py.compiled, ts.compiled),
    artifacts: Bun.deepEquals(py.artifacts, ts.artifacts), plateStem: py.plateStem === ts.plateStem,
    plateInputHashes: Bun.deepEquals(hashes(py.plateInputs), hashes(ts.plateInputs)) };
  const differences: { path: string; python: Json; typescript: Json; relative?: number }[] = [];
  diffJson(JSON.parse(readFileSync(resolve(pythonBuild, "verification.json"), "utf8")),
    JSON.parse(readFileSync(resolve(tsBuild, "verification.json"), "utf8")), "$", differences);
  // The build path, and the packed hash (index timestamps), legitimately differ between two builds.
  const reported = differences.filter(d => d.path !== "$.build" && d.path !== "$.archiveSha256");
  const numeric = reported.filter(d => d.relative !== undefined), nonNumeric = reported.filter(d => d.relative === undefined);
  const maxRelative = Math.max(0, ...numeric.map(d => d.relative!));
  const summary = { namespace: ns, presets: py.plan.presets.length, trees, inputs, records,
    archiveXlIdentical: Buffer.compare(xl(pythonBuild), xl(tsBuild)) === 0,
    packedArchiveSha256: { python: py.archiveSha256, typescript: ts.archiveSha256,
      note: "WolvenKit records build times in the archive index, so packed hashes may differ while every member is identical." },
    verificationReports: { numericDifferences: numeric.length, maxRelativeNumericDifference: maxRelative, nonNumeric } };
  console.log(JSON.stringify(summary, null, 2));
  const pass = trees.every(t => t.identical) && inputs.every(i => i.identical) && Object.values(records).every(Boolean) &&
    summary.archiveXlIdentical && nonNumeric.length === 0 && maxRelative <= 1e-12;
  if (!pass) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "mips") await compareMips(rest);
else if (command === "supplied") compareSupplied(rest);
else if (command === "inventory") await compareInventory(rest);
else if (command === "verify") await compareVerify(rest);
else if (command === "builds") compareBuilds(rest);
else {
  console.error("Usage: bun tools/compare-build-port.ts mips [collection.json] [--size N] | supplied <build> | inventory <build> | verify <build> [--wolvenkit exe] | builds <python-build> <ts-build>");
  process.exitCode = 2;
}
