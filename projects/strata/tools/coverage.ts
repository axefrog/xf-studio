/**
 * Branch coverage of the engine (Bun reports lines and functions only). Runs the test suite with every engine file
 * instrumented (`preload-coverage.ts`), and, when STRATA_VECTORS names a folder of external conformance tests, those
 * too; merges the counts and prints each file's covered branch outcomes, then every uncovered one.
 *
 *   STRATA_ACORN=<acorn.mjs> bun tools/coverage.ts [--list uncovered.txt] [--ratchet | --record] [test files…]
 *
 * Two shares come out: the public one (the suite alone, as CI runs it) and, with STRATA_VECTORS, the full one.
 * `--ratchet` fails when a share falls below the one recorded in `tools/quality.json`; `--record` records them and
 * refuses to lower one. Coverage never goes down.
 *
 * Run it under the memory guard: it runs the whole suite.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./instrument";
import type { Probe } from "./instrument";

type Hit = Probe & { hits: number[] };
const args = process.argv.slice(2);
const listAt = args.indexOf("--list");
const listFile = listAt >= 0 ? args.splice(listAt, 2)[1] : undefined;
const pull = (name: string) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const ratchet = pull("--ratchet"), record = pull("--record");
const QUALITY = join(ROOT, "tools", "quality.json");
const preload = join(ROOT, "tools", "preload-coverage.ts");
const work = mkdtempSync(join(tmpdir(), "strata-cov-"));

function run(cwd: string, out: string, extra: Record<string, string> = {}): void {
  const result = Bun.spawnSync([process.execPath, "test", "--preload", preload, ...(cwd === ROOT ? args : [])], {
    cwd, env: { ...process.env, ...extra, STRATA_COV_OUT: out }, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) console.error(`(tests in ${cwd} exited with ${result.exitCode}; counts are still merged)`);
}

const outputs = [join(work, "suite.json")];
run(ROOT, outputs[0]);
if (process.env.STRATA_VECTORS) { outputs.push(join(work, "vectors.json")); run(process.env.STRATA_VECTORS, outputs[1], { STRATA_ENGINE: ROOT }); }

/** Merges the counts of some of the runs, file by file. */
function merge(runs: readonly string[]): Map<string, Hit[]> {
  const merged = new Map<string, Hit[]>();
  for (const file of runs) {
    let data: Record<string, Hit[]>;
    try { data = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    for (const [name, probes] of Object.entries(data)) {
      const current = merged.get(name);
      if (!current) { merged.set(name, structuredClone(probes)); continue; }
      probes.forEach((probe, i) => probe.hits.forEach((count, j) => { current[i].hits[j] += count; }));
    }
  }
  return merged;
}
// Two baselines: `public` (the suite alone, as CI runs it) and `full` (with the private vectors).
const measured = new Map<"public" | "full", Map<string, Hit[]>>([["public", merge(outputs.slice(0, 1))]]);
if (outputs.length > 1) measured.set("full", merge(outputs));
rmSync(work, { recursive: true, force: true });

type Share = { covered: number; total: number; percent: number };
function report(merged: Map<string, Hit[]>): { share: Share; lines: string[]; missing: string[] } {
  let total = 0, covered = 0;
  const lines: string[] = [], missing: string[] = [];
  for (const [name, probes] of [...merged].sort(([a], [b]) => a < b ? -1 : 1)) {
    let fileTotal = 0, fileCovered = 0;
    for (const probe of probes) probe.hits.forEach((count, i) => {
      fileTotal++;
      if (count > 0) fileCovered++;
      else missing.push(`${name}:${probe.line}  ${probe.fn}  [${probe.kind}: ${probe.outcomes[i]} never]  ${probe.code}`);
    });
    total += fileTotal; covered += fileCovered;
    lines.push(`${name.padEnd(34)} ${String(fileCovered).padStart(5)} / ${String(fileTotal).padEnd(5)} ${(100 * fileCovered / Math.max(1, fileTotal)).toFixed(1).padStart(6)} %`);
  }
  return { share: { covered, total, percent: Math.round(10000 * covered / Math.max(1, total)) / 100 }, lines, missing };
}
const quality = (existsSync(QUALITY) ? JSON.parse(readFileSync(QUALITY, "utf8")) : {}) as Record<"public" | "full", { coverage?: Share } | undefined>;
let fell = false;
const shares: [ "public" | "full", Share][] = [];
for (const [baseline, merged] of measured) {
  const { share, lines, missing } = report(merged);
  shares.push([baseline, share]);
  console.log(`\nBranch outcomes covered (${baseline === "full" ? "suite and external vectors" : "the suite alone"})\n${lines.join("\n")}\n${"all engine files".padEnd(34)} ${String(share.covered).padStart(5)} / ${String(share.total).padEnd(5)} ${share.percent.toFixed(1).padStart(6)} %`);
  // The uncovered list is the most complete run's.
  if (listFile && baseline === [...measured.keys()].at(-1)) { writeFileSync(listFile, `${missing.join("\n")}\n`); console.log(`${missing.length} uncovered outcomes listed in ${listFile}`); }
  const floor = quality[baseline]?.coverage?.percent;
  if (floor !== undefined && share.percent < floor) { console.error(`Branch coverage (${baseline}) fell from ${floor} % to ${share.percent} %.`); fell = true; }
}
if (record && !fell) {
  for (const [baseline, share] of shares) quality[baseline] = { ...quality[baseline], coverage: share };
  writeFileSync(QUALITY, `${JSON.stringify(quality, null, 2)}\n`);
  console.log(`recorded ${shares.map(([baseline, share]) => `${baseline} ${share.percent} %`).join(", ")} in tools/quality.json`);
}
if ((ratchet || record) && fell) process.exit(1);
