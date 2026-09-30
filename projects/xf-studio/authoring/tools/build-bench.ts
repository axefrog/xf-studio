/**
 * Build speed bench (PIPE-130): runs real Builds of one collection through the localhost package host service, as the
 * page's **Build now** does, with the saved Local settings' game, route and WolvenKit, and times each stage. Everything it
 * writes (plate cache, build, dist, kept intermediates) stays below the scratch folder given; nothing is installed.
 * Run it under the memory guard: every WolvenKit launch in it is real.
 *
 *   bun tools/build-bench.ts <collection.json> <scratch dir> [runs=1] [--keep]
 *
 * The first run prepares the plates into `<scratch>/plate-cache` when they aren't there (the cold Build). `--keep`
 * copies each Build's work folder to `<scratch>/kept/<run>` before the host removes it (resources, logs, archives).
 * Prints one JSON line per run: total seconds, seconds at which each stage started, the host's answer.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LocalSettingsStore } from "../src/local-settings-store";
import { localEyePlate, localMasculineEyePlate, localPackageAdapter, localPackageTools } from "../src/package-server";
import { runProductBuild } from "../src/platform/export/product-host";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { EYE_PLATE_MASCULINE_PREREQUISITE, EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";

const args = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const keep = process.argv.includes("--keep");
const [collectionArg, scratchArg, runsArg = "1"] = args;
if (!collectionArg || !scratchArg) throw Error("Usage: bun tools/build-bench.ts <collection.json> <scratch dir> [runs] [--keep]");
const scratch = resolve(scratchArg), runs = Number(runsArg);
const collection = JSON.parse(readFileSync(resolve(collectionArg), "utf8").replace(/^﻿/, ""));
const settings = new LocalSettingsStore().load().settings;
const tools = { ...localPackageTools(settings, { ...process.env, XFS_PACKAGE_PLATE_CACHE: join(scratch, "plate-cache") }) };
let kept = 0;
const adapter = localPackageAdapter({
  exporters: STUDIO_EXPORTERS, tools, roots: { build: join(scratch, "build"), dist: join(scratch, "dist") },
  prerequisites: t => ({ [EYE_PLATE_PREREQUISITE]: localEyePlate(t), [EYE_PLATE_MASCULINE_PREREQUISITE]: localMasculineEyePlate(t) }),
});
const runBuilder = adapter.runBuilder;
let workDir = "";
const buildSetup = adapter.buildSetup;
adapter.buildSetup = () => { const setup = buildSetup(); workDir = setup.work; return setup; };
adapter.runBuilder = async (argv, run) => {
  const result = await runBuilder(argv, run);
  if (keep) { const target = join(scratch, "kept", String(++kept)); rmSync(target, { recursive: true, force: true }); cpSync(workDir, target, { recursive: true }); }
  writeFileSync(join(scratch, `builder-${kept || "last"}.log`), result.stdout + "\n--- stderr ---\n" + result.stderr, "utf8");
  return result;
};
mkdirSync(scratch, { recursive: true });
for (let run = 1; run <= runs; run++) {
  const started = performance.now(), stages: Record<string, number> = {};
  const outcome = await runProductBuild(adapter, collection, new AbortController().signal, undefined, progress => {
    stages[progress.stage] ??= +((performance.now() - started) / 1000).toFixed(2);
  });
  const seconds = +((performance.now() - started) / 1000).toFixed(2);
  const answer = outcome.ok ? { ok: true, products: (outcome.result as { products?: { package: string; archiveSha256: string }[] }).products?.map(p => ({ package: p.package, archiveSha256: p.archiveSha256 })) }
    : outcome;
  console.log(JSON.stringify({ run, seconds, stages, answer }));
}
