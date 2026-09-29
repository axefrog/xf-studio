/**
 * Mutation testing of the engine (no mutation tool runs under Bun, so this is a small one). Each mutant is one small
 * change to one engine file (see `mutants` in `instrument.ts`); the suite runs against it (`preload-mutant.ts` swaps
 * the file in as it loads) and must fail. A mutant the suite survives is either a missing test or an equivalent
 * change, recorded as such in `tools/equivalent-mutants.md` with the reason.
 *
 *   STRATA_ACORN=<acorn.mjs> bun tools/mutate.ts [--files a.ts,b.ts] [--workers 4] [--timeout 30000]
 *     [--cache results.json] [--survivors survivors.txt] [--recheck] [--only-cache] [--ratchet | --record] [--] [test files…]
 *
 * STRATA_VECTORS names a folder of external conformance tests: a mutant the suite survives runs against them too. Two
 * scores come out of one run: the full one (suite and vectors) and the public one (the suite alone); without
 * STRATA_VECTORS only the public one.
 *
 * Results are cached by mutant key (`mutant-keys.ts`: its file, function, change and occurrence, and a hash of the
 * function's text), each entry recording the test set it was run against; a rewritten function's mutants, and an entry
 * for another test set, run again. `--recheck` also reruns the cached survivors (equivalents included: one a test now
 * kills is reported, to be taken off the list). `--only-cache` runs nothing and reports from the cache. An equivalent
 * entry whose function has changed since it was judged is reported as stale and counts as a survivor until judged
 * again. `--ratchet` fails when a score falls below the one recorded in `tools/quality.json`; `--record` records the
 * scores and refuses to lower one. A mutant can loop or allocate without bound: STRATA_GUARD
 * (`<python>|<memory_guard.py>|<GB>`) runs each test process under the repository's memory guard, and a guard kill
 * counts as detected, like a timeout. Run the whole thing under the memory guard too.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyMutant, loadParser, mutants, ROOT } from "./instrument";
import type { Mutant } from "./instrument";
import { cachedStatus, equivalence, mutantKeys, readEquivalents, splitKey, testSetHash } from "./mutant-keys";
import type { CacheEntry, Status } from "./mutant-keys";

const DEFAULT_FILES = [
  "src/kernel/kernel.ts", "src/kernel/abort.ts", "src/kernel/erector.ts", "src/kernel/operators.ts",
  "src/graph.ts", "src/fold.ts", "src/resolve.ts", "src/model.ts", "src/compaction.ts", "src/define.ts", "src/paths.ts", "src/store.ts",
];
const DEFAULT_TESTS = ["tests/kernel.test.ts", "tests/kernel-policy.test.ts", "tests/erector.test.ts", "tests/edges.test.ts", "tests/units.test.ts", "tests/data-cases.test.ts", "tests/graph-api.test.ts",
  "tests/entity.test.ts", "tests/streams.test.ts", "tests/lifetime.test.ts", "tests/store.test.ts", "tests/example.test.ts", "tests/interleavings.test.ts",
  "tests/kernel-model.test.ts", "tests/erector-and-processes.test.ts", "tests/graph-behaviour.test.ts", "tests/property.test.ts", "tests/tables.test.ts", "tests/sim/dst.test.ts"];

const argv = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const at = argv.indexOf(name); if (at < 0) return fallback; const [, value] = argv.splice(at, 2); return value; };
const flag = (name: string) => { const at = argv.indexOf(name); if (at < 0) return false; argv.splice(at, 1); return true; };
const files = (option("--files") ?? DEFAULT_FILES.join(",")).split(",");
const workers = Number(option("--workers", "4"));
const timeout = Number(option("--timeout", "30000"));
const cacheFile = option("--cache", join(ROOT, "node_modules", ".strata-mutants.json"))!;
const survivorsFile = option("--survivors");
const recheck = flag("--recheck");
const onlyCache = flag("--only-cache");
const ratchet = flag("--ratchet"), record = flag("--record");
const dash = argv.indexOf("--");
const tests = dash >= 0 ? argv.slice(dash + 1) : argv.length ? argv : DEFAULT_TESTS;
const vectors = process.env.STRATA_VECTORS;
const testSet = testSetHash(tests, process.env.STRATA_SIM_SEEDS);
const equivalents = readEquivalents(existsSync(join(ROOT, "tools", "equivalent-mutants.md")) ? readFileSync(join(ROOT, "tools", "equivalent-mutants.md"), "utf8") : "");
const cache: Record<string, CacheEntry> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

const guard = process.env.STRATA_GUARD?.split("|");
const guarded = (cmd: string[]) => guard ? [guard[0], guard[1], "--limit", guard[2] ?? "0.8", "--", ...cmd] : cmd;

async function runTests(cwd: string, cmd: string[], env: Record<string, string | undefined>): Promise<Status> {
  const child = Bun.spawn(guarded(cmd), { cwd, env, stdout: "ignore", stderr: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  const code = await child.exited;
  clearTimeout(timer);
  if (timedOut || (guard && code === 99)) return "timeout";
  return code === 0 ? "survived" : "killed";
}

/**
 * The suite first, unless its result for this test set is known; then, for a full run, the external vectors when the
 * suite survived (so the public score comes from the same run).
 */
async function runOne(file: string, mutant: Mutant, known: CacheEntry | undefined): Promise<CacheEntry> {
  const env = { ...process.env, STRATA_MUTANT: `${file}#${mutant.start}:${mutant.end}:${JSON.stringify(mutant.replacement)}` };
  const kept = known?.tests === testSet ? known : undefined;
  const suite = kept?.suite ?? await runTests(ROOT, [process.execPath, "test", "--bail", "--preload", join(ROOT, "tools", "preload-mutant.ts"), ...tests], env);
  if (!vectors) return { ...kept, suite, tests: testSet };
  if (suite !== "survived") return { suite, full: suite, tests: testSet };
  const full = await runTests(vectors, [process.execPath, "test", "--bail", "--preload", join(ROOT, "tools", "preload-mutant.ts")], { ...env, STRATA_ENGINE: ROOT });
  return { suite, full, tests: testSet };
}

const acorn = await loadParser();
const queue: { file: string; mutant: Mutant; key: string }[] = [];
let invalid = 0;
for (const file of files) {
  const { js, mutants: list } = await mutants(readFileSync(join(ROOT, file), "utf8"));
  // A change that doesn't parse isn't a mutant.
  const valid = list.filter(mutant => {
    try { acorn.parse(applyMutant(js, mutant), { ecmaVersion: "latest", sourceType: "module" }); return true; } catch { invalid++; return false; }
  });
  const keys = mutantKeys(file, valid);
  valid.forEach((mutant, i) => queue.push({ file, mutant, key: keys[i] }));
}

const full = !!vectors;
const statusOf = (key: string, withVectors = full) => cachedStatus(cache[key], testSet, withVectors);
const todo = onlyCache ? [] : queue.filter(item => statusOf(item.key) === undefined || (recheck && statusOf(item.key) === "survived"));
console.log(`${queue.length} mutants (${invalid} that don't parse left out), ${todo.length} to run, ${workers} at a time${full ? ", with the external vectors" : ""}`);
let next = 0, done = 0;
const started = performance.now();
async function worker(): Promise<void> {
  for (;;) {
    const item = todo[next++];
    if (!item) return;
    // A recheck runs the suite again; otherwise a suite result for this test set is kept and only the vectors run.
    cache[item.key] = await runOne(item.file, item.mutant, recheck ? undefined : cache[item.key]);
    if (++done % 25 === 0) {
      writeFileSync(cacheFile, JSON.stringify(cache));
      console.log(`${done} / ${todo.length} run, ${Math.round((performance.now() - started) / 1000)} s`);
    }
  }
}
await Promise.all(Array.from({ length: workers }, worker));
writeFileSync(cacheFile, JSON.stringify(cache));

// The report covers every mutant in the queue, cached or run now.
type Row = { killed: number; survived: number; equivalent: number };
const score = (row: Row) => Math.round(10000 * row.killed / Math.max(1, row.killed + row.survived)) / 100;
function tally(withVectors: boolean): { byFile: Map<string, Row>; all: Row; survivors: string[]; stale: string[]; killedEquivalents: string[]; notRun: number } {
  const byFile = new Map<string, Row>(), all: Row = { killed: 0, survived: 0, equivalent: 0 };
  const survivors: string[] = [], stale: string[] = [], killedEquivalents: string[] = [];
  let notRun = 0;
  for (const item of queue) {
    const known = statusOf(item.key, withVectors);
    if (known === undefined) notRun++;
    const status = known ?? "survived";
    const row = byFile.get(item.file) ?? { killed: 0, survived: 0, equivalent: 0 };
    const listed = equivalence(equivalents, item.key);
    if (status !== "survived") { row.killed++; if (listed) killedEquivalents.push(item.key); }
    else if (listed === "equivalent") row.equivalent++;
    else {
      row.survived++;
      if (listed === "stale") stale.push(item.key);
      survivors.push(`${item.file}:${item.mutant.line}  ${item.mutant.fn}  [${item.mutant.operator}]  ${item.mutant.original}  →  ${item.mutant.replacement}${listed === "stale" ? "  (listed as equivalent against an older version of its function)" : ""}\n    key: ${item.key}`);
    }
    byFile.set(item.file, row);
  }
  for (const row of byFile.values()) { all.killed += row.killed; all.survived += row.survived; all.equivalent += row.equivalent; }
  return { byFile, all, survivors, stale, killedEquivalents, notRun };
}
const print = (title: string, result: ReturnType<typeof tally>) => {
  console.log(`\n${title}: mutation score (killed / (all - equivalent))`);
  for (const [file, row] of [...result.byFile, ["all", result.all] as const])
    console.log(`${file.padEnd(28)} ${String(row.killed).padStart(5)} killed ${String(row.survived).padStart(5)} survived ${String(row.equivalent).padStart(4)} equivalent ${score(row).toFixed(1).padStart(6)} %`);
};
const publicResult = tally(false), fullResult = full ? tally(true) : undefined;
if (fullResult) print("Full (suite and external vectors)", fullResult);
// A full run leaves the suite alone unrun for results kept from before the two were told apart.
if (!fullResult || !publicResult.notRun) print("Public (the suite alone)", publicResult);
const main = fullResult ?? publicResult;
const matched = new Set(queue.map(item => splitKey(item.key).base));
const orphans = [...equivalents.keys()].filter(base => files.some(file => base.startsWith(`${file}|`)) && !matched.has(base));
if (main.stale.length) console.log(`\n${main.stale.length} equivalent entries were judged against an older version of their function (listed with the survivors): judge them again.`);
if (main.killedEquivalents.length) console.log(`\n${main.killedEquivalents.length} mutants listed as equivalent are killed: take them off the list.\n${main.killedEquivalents.map(key => `  ${key}`).join("\n")}`);
if (orphans.length) console.log(`\n${orphans.length} equivalent entries match no mutant: remove them.\n${orphans.map(key => `  ${key}`).join("\n")}`);
if (survivorsFile) { writeFileSync(survivorsFile, `${main.survivors.join("\n")}\n`); console.log(`${main.survivors.length} survivors listed in ${survivorsFile}`); }

// Two baselines: `full` (with the private vectors) and `public` (the suite alone, as CI runs it).
const qualityFile = join(ROOT, "tools", "quality.json");
type Baseline = { mutants?: Row & { percent: number }; coverage?: unknown };
const quality = (existsSync(qualityFile) ? JSON.parse(readFileSync(qualityFile, "utf8")) : {}) as { full?: Baseline; public?: Baseline };
const measured = ([["public", publicResult], ["full", fullResult]] as const).filter((pair): pair is readonly ["public" | "full", ReturnType<typeof tally>] => !!pair[1] && !pair[1].notRun);
let fell = false;
for (const [baseline, result] of measured) {
  const floor = quality[baseline]?.mutants?.percent;
  if (floor !== undefined && score(result.all) < floor) { console.error(`The ${baseline} mutation score fell from ${floor} % to ${score(result.all)} %.`); fell = true; }
}
if (record && !fell) {
  for (const [baseline, result] of measured) quality[baseline] = { ...quality[baseline], mutants: { ...result.all, percent: score(result.all) } };
  writeFileSync(qualityFile, `${JSON.stringify(quality, null, 2)}\n`);
  console.log(`recorded ${measured.map(([baseline, result]) => `${baseline} ${score(result.all)} %`).join(", ")} in tools/quality.json`);
}
if ((ratchet || record) && fell) process.exit(1);
