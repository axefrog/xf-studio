/**
 * Mutation testing of the engine (no mutation tool runs under Bun, so this is a small one). Each mutant is one small
 * change to one engine file (see `mutants` in `instrument.ts`); the suite runs against it (`preload-mutant.ts` swaps
 * the file in as it loads) and must fail. A mutant the suite survives is either a missing test or an equivalent
 * change, recorded as such in `tools/equivalent-mutants.md` with the reason.
 *
 *   STRATA_ACORN=<acorn.mjs> bun tools/mutate.ts [--files a.ts,b.ts] [--workers 4] [--timeout 60000]
 *     [--cache results.json] [--survivors survivors.txt] [--recheck] [--] [test files…]
 *
 * Results are cached by mutant: its file, function, operator, the code it changes and its replacement (and which
 * occurrence of that it is in the function), so a rerun after new tests or a local fix runs only mutants it hasn't
 * seen; a mutant once killed stays killed (tests are only ever added), and `--recheck` reruns the cached survivors.
 * `--only-cache` runs nothing and reports from the cache (after moving an older cache to these keys). `--ratchet` fails
 * when the score falls below the one recorded in `tools/quality.json`; `--record` records it. The score never goes down. STRATA_VECTORS names a folder of external conformance tests run as well.
 * A mutant can loop or allocate without bound: STRATA_GUARD (`<python>|<memory_guard.py>|<GB>`) runs each test
 * process under the repository's memory guard, and a guard kill counts as detected, like a timeout. Run the whole
 * thing under the memory guard too.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyMutant, loadParser, mutants, ROOT } from "./instrument";
import type { Mutant } from "./instrument";

const DEFAULT_FILES = [
  "src/kernel/kernel.ts", "src/kernel/abort.ts", "src/kernel/erector.ts", "src/kernel/operators.ts",
  "src/graph.ts", "src/fold.ts", "src/resolve.ts", "src/model.ts", "src/compaction.ts", "src/define.ts", "src/paths.ts", "src/store.ts",
];
const DEFAULT_TESTS = ["tests/kernel.test.ts", "tests/kernel-policy.test.ts", "tests/erector.test.ts", "tests/edges.test.ts", "tests/units.test.ts", "tests/data-cases.test.ts", "tests/graph-api.test.ts",
  "tests/entity.test.ts", "tests/streams.test.ts", "tests/lifetime.test.ts", "tests/store.test.ts", "tests/example.test.ts", "tests/interleavings.test.ts",
  "tests/kernel-model.test.ts", "tests/property.test.ts", "tests/sim/dst.test.ts"];

/** The test set the first caches were keyed by. */
const OLDER_TESTS = ["tests/entity.test.ts", "tests/streams.test.ts", "tests/lifetime.test.ts", "tests/store.test.ts", "tests/example.test.ts",
  "tests/property.test.ts", "tests/sim/dst.test.ts"];

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
/**
 * The mutants recorded as equivalent: in the Markdown file, a list item holding a key in double backticks, then its
 * reason on the indented lines after it.
 */
function readEquivalents(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  let key: string | undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const item = /^- ``(.+)``\s*$/.exec(line);
    if (item) { key = item[1]; out.set(key, ""); continue; }
    if (key && /^\s+\S/.test(line)) out.set(key, `${out.get(key)} ${line.trim()}`.trim());
    else if (!/^\s*$/.test(line)) key = undefined;
  }
  return out;
}
const equivalents = readEquivalents(join(ROOT, "tools", "equivalent-mutants.md"));

type Status = "killed" | "survived" | "timeout";
type Result = { status: Status; file: string; mutant: Mutant; ms: number };
const cache: Record<string, { status: Status }> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const hashOf = (text: string) => Bun.hash(text).toString(16);

const guard = process.env.STRATA_GUARD?.split("|");
const guarded = (cmd: string[]) => guard ? [guard[0], guard[1], "--limit", guard[2] ?? "0.8", "--", ...cmd] : cmd;

async function runOne(file: string, mutant: Mutant): Promise<Status> {
  const env = { ...process.env, STRATA_MUTANT: `${file}#${mutant.start}:${mutant.end}:${JSON.stringify(mutant.replacement)}` };
  const commands: { cwd: string; cmd: string[]; env: Record<string, string | undefined> }[] = [
    { cwd: ROOT, cmd: [process.execPath, "test", "--bail", "--preload", join(ROOT, "tools", "preload-mutant.ts"), ...tests], env },
  ];
  if (process.env.STRATA_VECTORS) commands.push({ cwd: process.env.STRATA_VECTORS, env: { ...env, STRATA_ENGINE: ROOT },
    cmd: [process.execPath, "test", "--bail", "--preload", join(ROOT, "tools", "preload-mutant.ts")] });
  // The vectors are quick: run them first.
  for (const command of commands.reverse()) {
    const child = Bun.spawn(guarded(command.cmd), { cwd: command.cwd, env: command.env, stdout: "ignore", stderr: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    const code = await child.exited;
    clearTimeout(timer);
    if (timedOut || (guard && code === 99)) return "timeout";
    if (code !== 0) return "killed";
  }
  return "survived";
}

await loadParser();
const acorn = await loadParser();
const queue: { file: string; mutant: Mutant; key: string }[] = [];
let invalid = 0;
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const { js, mutants: list } = await mutants(text);
  const fileHash = hashOf(text);
  const seen = new Map<string, number>();
  for (const mutant of list) {
    // A change that doesn't parse isn't a mutant.
    try { acorn.parse(applyMutant(js, mutant), { ecmaVersion: "latest", sourceType: "module" }); } catch { invalid++; continue; }
    const identity = `${file}|${mutant.fn}|${mutant.operator}|${mutant.original}|${mutant.replacement}`;
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    const key = `${identity}|${occurrence}`;
    // A cache written under the older key (file content and position) moves to this one.
    const older = `${file}#${fileHash}#${hashOf(OLDER_TESTS.join(" ") + (process.env.STRATA_SIM_SEEDS ?? ""))}#${mutant.start}:${mutant.end}:${mutant.replacement}`;
    if (!cache[key] && cache[older]) cache[key] = cache[older];
    queue.push({ file, mutant, key });
  }
}

const results: Result[] = [];
let next = 0, done = 0;
const started = performance.now();
const todo = onlyCache ? [] : queue.filter(item => !cache[item.key] || (recheck && cache[item.key].status === "survived"));
console.log(`${queue.length} mutants (${invalid} that don't parse left out), ${todo.length} to run, ${workers} at a time`);
async function worker(): Promise<void> {
  for (;;) {
    const item = todo[next++];
    if (!item) return;
    const t0 = performance.now();
    const status = await runOne(item.file, item.mutant);
    cache[item.key] = { status };
    results.push({ status, file: item.file, mutant: item.mutant, ms: performance.now() - t0 });
    if (++done % 25 === 0) {
      writeFileSync(cacheFile, JSON.stringify(cache));
      console.log(`${done} / ${todo.length} run, ${Math.round((performance.now() - started) / 1000)} s`);
    }
  }
}
await Promise.all(Array.from({ length: workers }, worker));
writeFileSync(cacheFile, JSON.stringify(cache));

// The report covers every mutant in the queue, cached or run now.
const byFile = new Map<string, { killed: number; survived: number; equivalent: number }>();
const survivors: string[] = [];
for (const item of queue) {
  const status = cache[item.key]?.status ?? "survived";
  const row = byFile.get(item.file) ?? { killed: 0, survived: 0, equivalent: 0 };
  const key = item.key;
  if (status !== "survived") row.killed++;
  else if (equivalents.has(key)) row.equivalent++;
  else { row.survived++; survivors.push(`${item.file}:${item.mutant.line}  ${item.mutant.fn}  [${item.mutant.operator}]  ${item.mutant.original}  →  ${item.mutant.replacement}\n    key: ${key}`); }
  byFile.set(item.file, row);
}
let killed = 0, survived = 0, equivalent = 0;
console.log("\nMutation score (killed / (all - equivalent))");
for (const [file, row] of byFile) {
  killed += row.killed; survived += row.survived; equivalent += row.equivalent;
  const score = 100 * row.killed / Math.max(1, row.killed + row.survived);
  console.log(`${file.padEnd(28)} ${String(row.killed).padStart(5)} killed ${String(row.survived).padStart(5)} survived ${String(row.equivalent).padStart(4)} equivalent ${score.toFixed(1).padStart(6)} %`);
}
console.log(`${"all".padEnd(28)} ${String(killed).padStart(5)} killed ${String(survived).padStart(5)} survived ${String(equivalent).padStart(4)} equivalent ${(100 * killed / Math.max(1, killed + survived)).toFixed(1).padStart(6)} %`);
if (survivorsFile) { writeFileSync(survivorsFile, `${survivors.join("\n")}\n`); console.log(`${survivors.length} survivors listed in ${survivorsFile}`); }
const qualityFile = join(ROOT, "tools", "quality.json");
const quality = existsSync(qualityFile) ? JSON.parse(readFileSync(qualityFile, "utf8")) as Record<string, unknown> : {};
const score = Math.round(10000 * killed / Math.max(1, killed + survived)) / 100;
if (record) { writeFileSync(qualityFile, `${JSON.stringify({ ...quality, mutants: { killed, survived, equivalent, percent: score } }, null, 2)}
`); console.log(`recorded ${score} % in tools/quality.json`); }
const floor = (quality.mutants as { percent?: number } | undefined)?.percent;
if (ratchet && floor !== undefined && score < floor) { console.error(`The mutation score fell from ${floor} % to ${score} %.`); process.exit(1); }
