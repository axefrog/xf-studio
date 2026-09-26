/**
 * End-to-end cold resolve bench (R&D; read-only towards the game and MO2): resolves one character twice, each in its own process
 * with its own fresh temporary resolver cache, once through the WolvenKit fetcher alone and once through the production
 * native-first route (resolver-host.ts `ResolverFetcher` over `NativeFirstFetcher`, which falls back to that same WolvenKit fetcher
 * per resource; strict, so a reader bug fails the run). It reports open and resolve times, WolvenKit launches and how many resources
 * each reader answered, then compares the two resolved characters leaf by leaf.
 *
 *   bun tools/native-resolver-bench.ts (--save <sav.dat | appearance.json> | --ui-state <state.json>) \
 *     [--game <root>] [--mo2 <instance> --profile <name> | --direct] [--wolvenkit <WolvenKit.CLI.exe>] [--order native-first] [--worker]
 *     [--worker-script <file>] [--seed-wolvenkit <resolver cache>] [--keep]
 *
 * `--worker` decodes in a worker with a time budget per resource (native-decode.ts `WorkerDecoder`, as the Studio's hosts do) instead
 * of in-process; `--worker-script <file>` starts that worker from a built bundle (the desktop app's `native-decode-worker.js`).
 *
 * `--seed-wolvenkit <folder>` copies a resolver cache's extracted JSON (`<folder>/json`, e.g. a copy of the Studio's own) into the
 * WolvenKit run's cache first, so that run launches WolvenKit only for what the copy lacks: a warm baseline for the comparison when a
 * cold WolvenKit run is too heavy for the machine (its launches use several GB). The native run always starts cold.
 *
 * Paths default to the Studio's local settings (game folder, launch route, MO2 instance and profile, WolvenKit CLI). The caches
 * live under the OS temp folder and are removed afterwards unless `--keep`. The printed summary names no mods; the per-run
 * reports (which do) stay in the temp folder.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { descriptorsFromUiState } from "../src/cco-model";
import { type CharacterInput, inputFromSave, loadMergedCco, resolveCharacter } from "../src/character-resolver";
import { LocalSettingsStore } from "../src/local-settings-store";
import type { NativeDecoder } from "../src/native/native-decode";
import { inProcessDecoder, type NativeFetchStats, openNativeDecoder, openNativeReader } from "../src/native/native-fetch-port";
import type { ResourceGraph } from "../src/resource-graph";
import { type NativeRoute, openInstallation } from "../src/resolver-host";
import { readSavedV } from "../src/save-reader";

const args = Bun.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const flag = (name: string) => args.includes(`--${name}`);

type Mode = "wolvenkit" | "native";
interface RunReport {
  mode: Mode; openMs: number; resolveMs: number; totalMs: number; cacheFiles: number; cacheBytes: number;
  wolvenKit: { cliCalls: number; extracted: number; cacheHits: number; shared: number; transient: number; failures: number };
  native?: Partial<NativeFetchStats> & { readerIdentity: string; decoder: "in-process" | "worker"; unavailable?: string };
  appearances: number; gaps: number;
  /** A second, warm pass of the WolvenKit run when the first answered anything null for a reason that may not repeat. */
  settle?: { ms: number; cliCalls: number; extracted: number; transient: number; failures: string[] };
}

async function resolveInput(graph: ResourceGraph) {
  let input: CharacterInput;
  const savePath = option("save"), uiStatePath = option("ui-state");
  if (savePath) {
    const bytes = readFileSync(savePath);
    input = inputFromSave(savePath.toLowerCase().endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : readSavedV(bytes));
  } else {
    const { bodyGender, state } = JSON.parse(readFileSync(uiStatePath!, "utf8"));
    const cco = await loadMergedCco(graph, bodyGender);
    const derived = descriptorsFromUiState(cco.merged.cco, state);
    input = { bodyGender, origin: "ui-state", morphs: derived.morphs, appearances: derived.appearances };
  }
  return resolveCharacter(graph, input);
}

function folderSize(root: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full); else { files++; bytes += statSync(full).size; }
    }
  };
  try { walk(root); } catch { /* empty */ }
  return { files, bytes };
}

/** One cold resolve in this process (a child of the driver). */
async function runOnce(mode: Mode, cacheDir: string, out: string): Promise<void> {
  const settings = new LocalSettingsStore().load().settings;
  const gameRoot = resolve(option("game") ?? settings.gameRoot ?? "");
  const direct = flag("direct") || (!option("mo2") && settings.launchRoute !== "mo2");
  const mo2Root = direct ? null : resolve(option("mo2") ?? settings.mo2Root ?? "");
  const profile = direct ? null : option("profile") ?? settings.mo2ProfileId;
  const cli = resolve(option("wolvenkit") ?? settings.wolvenKitCli ?? "");
  const started = performance.now();
  let nativeStats: RunReport["native"], native: NativeRoute | null = null, readerIdentity = "", close = () => {};
  const decoderKind = flag("worker") || option("worker-script") ? "worker" as const : "in-process" as const;
  if (mode === "native") {
    let decoder: NativeDecoder | null = null, reason = "";
    if (decoderKind === "worker") { const opened = openNativeDecoder(gameRoot, { script: option("worker-script") ?? undefined }); decoder = opened.decoder; if (!opened.decoder) reason = opened.reason; }
    else { const opened = openNativeReader(gameRoot); decoder = opened.reader ? inProcessDecoder(opened.reader) : null; if (!opened.reader) reason = opened.reason; }
    if (decoder) { native = { decoder, strict: true }; readerIdentity = decoder.identity; close = () => decoder.close(); }
    else nativeStats = { readerIdentity: "", decoder: decoderKind, unavailable: reason };
  }
  const installation = openInstallation({ gameRoot, launchRoute: direct ? "direct" : "mo2", mo2Root, mo2ProfileId: profile, wolvenKitCli: cli, cacheDir, native });
  const openMs = performance.now() - started;
  const graph = installation.graph;

  const resolveStart = performance.now();
  let result = await resolveInput(graph);
  const resolveMs = performance.now() - resolveStart;
  // A WolvenKit answer that may not repeat (a launch that did not finish cleanly) is retried on the same cache, as the Studio
  // would on its next preparation, so the comparison is between settled answers. The cold figures above stay those of the first pass.
  let settle: RunReport["settle"];
  if (mode === "wolvenkit" && installation.fetcher.stats.transient > 0) {
    const again = openInstallation({ gameRoot, launchRoute: direct ? "direct" : "mo2", mo2Root, mo2ProfileId: profile, wolvenKitCli: cli, cacheDir });
    const settleStart = performance.now();
    result = await resolveInput(again.graph);
    settle = { ms: performance.now() - settleStart, cliCalls: again.fetcher.stats.cliCalls, extracted: again.fetcher.stats.extracted,
      transient: again.fetcher.stats.transient, failures: again.fetcher.stats.failures };
  }
  if (installation.fetcher.nativeStats) nativeStats = { ...installation.fetcher.nativeStats, readerIdentity, decoder: decoderKind };
  close();

  const stats = installation.fetcher.stats, size = folderSize(join(cacheDir, "json"));
  const report: RunReport = { mode, openMs, resolveMs, totalMs: performance.now() - started, cacheFiles: size.files, cacheBytes: size.bytes,
    wolvenKit: { cliCalls: stats.cliCalls, extracted: stats.extracted, cacheHits: stats.cacheHits, shared: stats.shared, transient: stats.transient, failures: stats.failures.length },
    native: nativeStats, appearances: result.appearances.length, gaps: result.gaps.length, settle };
  writeFileSync(out, JSON.stringify({ report, failures: stats.failures, result }, null, 1));
}

/** Leaf paths where two JSON values differ (at most `limit`). */
function diff(a: unknown, b: unknown, path = "", out: { path: string; a: unknown; b: unknown }[] = [], limit = 200) {
  if (out.length >= limit) return out;
  if (a === b) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) diff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`, out, limit);
    return out;
  }
  out.push({ path, a, b });
  return out;
}

async function drive(): Promise<void> {
  if (!option("save") && !option("ui-state")) {
    console.error("Usage: bun tools/native-resolver-bench.ts (--save <file> | --ui-state <file>) [--game <root>] [--mo2 <root> --profile <name> | --direct] [--wolvenkit <exe>] [--order native-first] [--worker] [--keep]");
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), "xfs-resolver-bench-"));
  const order: Mode[] = option("order") === "native-first" ? ["native", "wolvenkit"] : ["wolvenkit", "native"];
  const passThrough = args.filter((arg, i) => !["--order", "--keep", "--seed-wolvenkit"].includes(arg) && !["--order", "--seed-wolvenkit"].includes(args[i - 1]!));
  const seed = option("seed-wolvenkit");
  const reports = new Map<Mode, { report: RunReport; failures: string[]; result: unknown }>();
  for (const mode of order) {
    const cacheDir = join(work, `cache-${mode}`), out = join(work, `${mode}.json`);
    if (mode === "wolvenkit" && seed) cpSync(join(seed, "json"), join(cacheDir, "json"), { recursive: true });
    const child = Bun.spawnSync([process.execPath, import.meta.path, "--run", mode, "--cache", cacheDir, "--out", out, ...passThrough], { stdout: "inherit", stderr: "inherit" });
    if (child.exitCode !== 0) { console.error(`${mode} run failed (exit ${child.exitCode}); work folder ${work}`); process.exit(1); }
    reports.set(mode, JSON.parse(readFileSync(out, "utf8")));
  }
  const wk = reports.get("wolvenkit")!, nat = reports.get("native")!;
  // Ambiguities and gaps are collected in the order resources arrive, which depends on the reader; compare them as sets.
  const settled = (result: unknown) => {
    const r = result as { ambiguities: unknown[]; gaps: unknown[] };
    const sorted = (items: unknown[]) => items.map(item => JSON.stringify(item)).sort();
    return { ...r, ambiguities: sorted(r.ambiguities), gaps: sorted(r.gaps) };
  };
  const differences = diff(settled(wk.result), settled(nat.result));
  // Expected: a `.app` package reference WolvenKit names from its path list while the native reader keeps the hash (a name-only gap).
  const nameOnly = differences.filter(d => /\/path$/.test(d.path) && (d.a === null || d.b === null || typeof d.a === "string" && typeof d.b === "string"));
  const summary = {
    order, seededWolvenKit: !!seed, runs: [wk.report, nat.report],
    equal: differences.length === 0, differences: differences.length, nameOnlyDifferences: nameOnly.length,
    otherDifferences: differences.filter(d => !nameOnly.includes(d)).slice(0, 20),
    speedup: { resolve: +(wk.report.resolveMs / nat.report.resolveMs).toFixed(1), total: +(wk.report.totalMs / nat.report.totalMs).toFixed(1) },
    work: flag("keep") ? work : null,
  };
  console.log(JSON.stringify(summary, (key, value) => typeof value === "number" && !Number.isInteger(value) ? Math.round(value) : value, 1));
  if (!flag("keep")) rmSync(work, { recursive: true, force: true });
}

const run = option("run") as Mode | null;
if (run) await runOnce(run, option("cache")!, option("out")!);
else await drive();
