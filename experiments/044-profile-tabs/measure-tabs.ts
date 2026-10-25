/**
 * G4 (README §5/§15). Isolated host, headless Chrome, offline browser evidence only.
 * bun experiments/044-profile-tabs/measure-tabs.ts --cache warm|fresh [--rows T-a,T-g] [--quick] [--no-game]
 * Defaults run warm (prime then measure), followed by fresh. The coordinator runs the full gate, never an agent smoke.
 * Server and browser are guarded separately at 5 GB; see README §15 for exact commands and limits.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { launch, type Session } from "../../projects/xf-studio/authoring/tools/cdp";
import { GL_PROBE } from "../../projects/xf-studio/authoring/tools/gl-probe";
import { localSettingsDirectory } from "../../projects/xf-studio/authoring/src/setup/host/local-settings-store";
import { TAB_PROBE } from "./measure-tabs-probe";

export const ROWS = ["T-a", "T-b", "T-c", "T-d", "T-e", "T-f", "T-g", "T-h"] as const;
export type Row = typeof ROWS[number];
type Tab = { tab: string; view: string; scene: string; unchanged?: boolean };
type Resident = { scene: string; key: string; state: string };
type Tick = { at: number; tab: string; drawn: string | null; onCanvas: string | null; phase: string; frames: number | null;
  detailComponents: number; key: string | null; scene: string | null; preparation: unknown; residents: Resident[]; progress: string; canvasVisible: boolean;
  canvasSize?: [number, number] | null; hash: number | null };
export type Run = { t0: number; before: Tick; ticks: Tick[]; sent: { tab: string; at: number }[]; errors: string[];
  shown: number | null; presented: number | null; target: Tab; links: { linkAt: number; name: string }[]; creates: number[];
  long: [number, number][]; rasters: { at: number }[]; draws: { at: number; view: string | null }[];
  /** The page's timing marks, GL uploads and program waits over the interval (null detail: none), as [name, ms from the click, ...]. */
  marks?: [string, number, unknown][]; uploads?: unknown[][]; waits?: unknown[][] };
type Memory = { live: Record<string, number>; heapMB: number | null; residents: Resident[]; objects?: { kind: string; stack: string }[] };
type OSMemory = { privateMB: number; dedicatedMB: number | null; sharedMB: number | null; processes: number; error?: string };
type Closure = { before: Memory; after: Memory; osBefore: OSMemory; osAfter: OSMemory; scene: string };
const round = (n: number) => Math.round(n * 10) / 10;

/** Pure gate reduction. Missing measurements are failures, never a zero-valued pass. */
export function analyse(row: Row, run: Run, noGame = false, closure?: Closure) {
  const failures = [...run.errors], last = run.ticks.at(-1)!;
  const first = run.ticks.findIndex(t => run.shown !== null && t.at >= run.shown);
  const frameStart = first > 0 ? run.ticks[first - 1]!.at : run.t0;
  const frameEnd = run.presented;
  const inFirst = (at: number) => frameEnd !== null && at >= frameStart && at <= frameEnd;
  const latency = run.presented === null ? null : round(run.presented - run.t0);
  const links = run.links.filter(p => inFirst(p.linkAt)).length, programs = run.creates.filter(inFirst).length;
  const long = run.long.filter(([at, ms]) => ms >= 50 && (row !== "T-g" || at <= run.t0 + 1000));
  const progress = run.ticks.find(t => t.at >= run.t0 && t.progress && (t.preparation || t.phase === "preparing" || t.phase === "loading"));
  const progressMs = progress ? round(progress.at - run.t0) : null;
  const blank = run.ticks.filter(t => t.at >= run.t0 && (!run.shown || t.at < run.shown) && !t.canvasVisible && !t.progress);
  const wrongDraws = row === "T-f" ? run.draws.filter(d => d.view !== run.target.view) : [];
  const changes = row === "T-f" ? run.ticks.filter(t => t.hash !== null && run.before.hash !== null && t.hash !== run.before.hash) : [];
  if (latency === null) failures.push("No first presented frame before timeout");
  if (last.tab !== run.target.tab) failures.push("Final tab differs from the requested tab");
  if (!noGame && (!run.before.key || run.before.frames === null || !run.before.detailComponents || !last.detailComponents || last.onCanvas !== run.target.view || last.phase !== "ready" || last.preparation))
    failures.push("Real head / final takeover not established");
  if (["T-a", "T-b", "T-c", "T-d"].includes(row) && (latency === null || latency > 100)) failures.push("Click to first presented frame exceeds 100 ms");
  if (["T-b", "T-c", "T-d"].includes(row) && links) failures.push("Links in the first shown frame");
  if (row === "T-b" && programs) failures.push("Programs created in the first shown frame");
  if (row === "T-d" && run.rasters.length) failures.push("Warm look requested a raster");
  if (row === "T-e") {
    if (progressMs === null || progressMs > 150) failures.push("No preparation progress within 150 ms");
    if (blank.length) failures.push("Blank pane before takeover");
  }
  if (["T-e", "T-g"].includes(row) && long.length) failures.push("Main-thread task of 50 ms or more");
  if (row === "T-f") {
    if (wrongDraws.length || changes.length) failures.push("Superseded draw or canvas change (idle off)");
    if (run.sent.length !== 4 || run.sent[3]!.at - run.sent[0]!.at > 300) failures.push("Four clicks did not fit within 300 ms");
    if (run.ticks.some(t => t.onCanvas !== run.target.view || t.key !== run.before.key)) failures.push("Superseded or late runtime shown");
  }
  if (!noGame && ["T-b", "T-c", "T-d"].includes(row) &&
    !run.before.residents.some(r => r.scene === run.target.scene && r.state === "warm")) failures.push("Destination was not warm before the click");
  if (!noGame && row === "T-e" && run.before.residents.some(r => r.scene === run.target.scene)) failures.push("Destination was resident before the cold click");
  if (!noGame && row === "T-c" && (!run.before.key?.endsWith("|female") || !last.key?.endsWith("|male"))) failures.push("Different-body setup not established");
  if (row === "T-h") {
    if (!closure) failures.push("Close baseline not recorded");
    else {
      if (closure.after.residents.some(r => r.scene === closure.scene)) failures.push("Closed scene remains resident");
      if (Object.entries(closure.before.live).some(([k, n]) => (closure.after.live[k] ?? Infinity) > n)) failures.push("Live GL objects exceed baseline");
      if (closure.before.heapMB === null || closure.after.heapMB === null || closure.after.heapMB > closure.before.heapMB + 16) failures.push("JS heap exceeds baseline + 16 MiB");
      const a = closure.osBefore, b = closure.osAfter;
      if (a.error || b.error || !a.processes || !b.processes || a.dedicatedMB === null || b.dedicatedMB === null || a.sharedMB === null || b.sharedMB === null)
        failures.push("OS / GPU memory counters unavailable");
      else if (b.privateMB > a.privateMB + 64 || b.dedicatedMB > a.dedicatedMB + 16 || b.sharedMB > a.sharedMB + 16)
        failures.push("OS memory exceeds baseline (private +64 MiB, GPU dedicated/shared +16 MiB)");
    }
  }
  return { row, pass: failures.length === 0, evidence: noGame ? "shell-only smoke; real-data G4 pending" : "offline real-data browser",
    realDataPass: !noGame && failures.length === 0, clickToFirstPresentedMs: latency, firstFrameLinks: links, firstFramePrograms: programs,
    rasterRequests: run.rasters.length, longTasks50: long.length, longestTaskMs: round(Math.max(0, ...long.map(([, ms]) => ms))),
    progressWithinMs: progressMs, blankSamples: blank.length, supersededDraws: wrongDraws.length, canvasChangeSamples: changes.length,
    failures, ...(closure ? { closure } : {}) };
}

/** G3's OS counters, scoped to this profile's browser process tree. Never sampled during a timing. */
async function chromeMemory(profile: string): Promise<OSMemory> {
  // Ask this browser for its own process IDs. WMI process enumeration may be unavailable in a restricted host, and matching a
  // command-line substring is unnecessary when Chrome can supply the exact tree, including its GPU and renderer processes.
  let ids: number[];
  try {
    const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/);
    ids = await new Promise<number[]>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const done = (error?: unknown, result?: number[]) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(result!); };
      const timer = setTimeout(() => done(Error("Chrome process query timed out")), 5000);
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }));
      socket.onerror = () => done(Error("Chrome process query failed"));
      socket.onmessage = event => {
        const answer = JSON.parse(String(event.data));
        if (answer.id !== 1) return;
        if (answer.error) done(Error(JSON.stringify(answer.error)));
        else done(undefined, answer.result.processInfo.map((p: { id: number }) => p.id));
      };
    });
    if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0)) throw Error("Chrome returned no valid process IDs");
  } catch (e) { return { privateMB: 0, dedicatedMB: null, sharedMB: null, processes: 0, error: String(e) }; }
  const script = String.raw`$ErrorActionPreference='Stop'
$ids=@(${ids.join(",")})
$private=0; foreach($idValue in $ids) { $p=Get-Process -Id $idValue -ErrorAction SilentlyContinue; if($p) {$private+=$p.PrivateMemorySize64} }
function Counter($name) { try { $values=@((Get-Counter "\GPU Process Memory(*)\$name" -ErrorAction Stop).CounterSamples | Where-Object { $_.InstanceName -match 'pid_(\d+)_' -and $ids -contains [int]$Matches[1] }); if(!$values.Count){return $null}; return (($values | Measure-Object CookedValue -Sum).Sum / 1MB) } catch {return $null} }
[pscustomobject]@{privateMB=$private/1MB;dedicatedMB=(Counter 'Dedicated Usage');sharedMB=(Counter 'Shared Usage');processes=$ids.Count} | ConvertTo-Json -Compress`;
  const p = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  try { if (p.exitCode) throw Error(p.stderr.toString()); return JSON.parse(p.stdout.toString()); }
  catch (e) { return { privateMB: 0, dedicatedMB: null, sharedMB: null, processes: 0, error: String(e) }; }
}

const P = "window.xfStudioPresentation", G = "window.__g4";
const root = resolve(import.meta.dir, "../../projects/xf-studio/authoring");
const repo = resolve(import.meta.dir, "../..");
// Resolve the full interpreter path, never the packaged `python` alias (its AppData view differs).
const python = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "", "AppData/Local"), "Python/pythoncore-3.14-64/python.exe");
async function act(page: Session, action: Record<string, unknown>) { return page.evaluate(`${G}.act(${JSON.stringify(action)})`); }
async function settle(page: Session, tab: Tab, noGame: boolean) {
  await page.waitFor(`${P}.tabs.snapshot().shown === ${JSON.stringify(tab.tab)} && ${noGame ? "true" : `(() => { const s=${G}.sample(); return s.phase==='ready' && s.onCanvas===${JSON.stringify(tab.view)} && !!s.key && !s.preparation; })()`}`, 900_000);
  if (!noGame) await page.waitFor(`${P}.previewReadiness.snapshot().phase === 'ready'`, 30_000);
  if (!noGame) await page.waitFor(`${G}.sample().detailComponents > 0`, 900_000);
  await page.wait(400);
}
async function current(page: Session): Promise<Tab> {
  return page.evaluate(`(() => {const tab=${P}.tabs.snapshot().shown, v=${P}.views.snapshot().views.find(v=>v.tab===tab); if(!v)throw Error('Tab has no view'); return {tab,view:v.id,scene:v.scene};})()`);
}
async function makeTab(page: Session, subject: unknown, look: unknown, share: string | null, noGame: boolean): Promise<Tab> {
  await page.evaluate(`(() => { const p=${P}, s=p.tabs.substitution('eye-makeup/default'); if(!s.subjects)throw Error(JSON.stringify(s));
    ${G}.act({kind:'tabs.new',default:'eye-makeup/default',choice:{subjects:Object.fromEntries(s.subjects.map(x=>[x.key,${JSON.stringify(subject)}])),
      looks:Object.fromEntries(s.looks.map(x=>[x.key,${JSON.stringify(look)}])),scenes:Object.fromEntries(s.scenes.map(x=>[x.key,${JSON.stringify(share)}]))}});
    // Stored display edits work while a destination loads. Set head-only before its asynchronous preparation reads the display node.
    const v=p.views.snapshot().views.find(v=>v.tab===p.tabs.snapshot().shown);
    if(!${noGame} && window.xfStudioSceneEvidence?.()) ${G}.act({kind:'preview.setBody',enabled:false,view:v.id}); })()`);
  return current(page);
}
async function show(page: Session, tab: Tab, noGame: boolean) { await page.evaluate(`${G}.click(${JSON.stringify(tab.tab)})`); await settle(page, tab, noGame); }

async function measure(page: Session, row: Row, noGame: boolean, quick: boolean, profile: string) {
  await page.waitFor(`!!window.xfStudioTabFixtures && !!window.xfStudioShell && !!${P}?.tabs && !!document.querySelector('.history-controls button')`, 120_000);
  // Real owners create the candidates; remove all old tabs after the fixture to isolate this row's residency.
  const fixture = await page.evaluate(`window.xfStudioTabFixtures.u6('look',1)`) as { tab: string; subjects: string[] };
  const seeded = await page.evaluate(`window.xfStudioTabFixtures.seed()`) as { subjects: string[]; collection: string; looks: string[] };
  const subject = { kind: "character", id: fixture.subjects[0]! }, lookA = { collection: seeded.collection, look: seeded.looks[0]! };
  const a = await makeTab(page, subject, lookA, null, noGame);
  const old = await page.evaluate(`${P}.tabs.snapshot().tabs.map(t=>t.id)`) as string[];
  for (const tab of old) if (tab !== a.tab) await act(page, { kind: "tabs.close", tab });
  await settle(page, a, noGame);
  if (!noGame) {
    await act(page, { kind: "preview.setBody", enabled: false });
    await act(page, { kind: "motion.setIdle", enabled: false });
    // T-f compares the scene's pixels. The on-head editing guides intentionally leave and remount on a tab change; they are not
    // superseded scene content. Keep that optional overlay off, and retain the exact hash and every default-framebuffer draw gate.
    if (row === "T-f") await act(page, { kind: "preview.setSurfaceControls", enabled: false });
    await act(page, { kind: "layer.edit", command: { kind: "add" } });
    await settle(page, a, false);
  }
  // Like T2's renderer baseline, exercise a disposable runtime before sampling the surviving scene. The first second-runtime
  // preparation populates renderer-shared maps/programs and the driver's allocation pools; those outlive that runtime. A new
  // independent runtime is still opened and closed below, so a per-runtime leak continues to exceed this baseline.
  if (row === "T-h") {
    const calibration = await makeTab(page, subject, lookA, null, noGame);
    await settle(page, calibration, noGame);
    await show(page, a, noGame);
    await act(page, { kind: "tabs.close", tab: calibration.tab });
    await page.wait(5000);
  }
  const baseline = row === "T-h" ? { page: await page.evaluate(`${G}.memory()`) as Memory, os: await chromeMemory(profile) } : undefined;
  const shared = row === "T-a" || row === "T-g";
  // Diagnostic (README §16.6): in T-e the cold tab is B, the masculine default V as T-c has it, whose maps no other runtime holds.
  const otherV = row === "T-e" && !noGame && process.env.XFS_G4_T_E_V === "male";
  const b = await makeTab(page, row === "T-c" || otherV ? { kind: "character", id: seeded.subjects[0]! } : subject,
    row === "T-d" ? { collection: seeded.collection, look: seeded.looks[1]! } : lookA, shared ? a.scene : null, noGame);
  await settle(page, b, noGame);
  if (!noGame) {
    await act(page, { kind: "preview.setBody", enabled: false });
    await act(page, { kind: "motion.setIdle", enabled: false });
    if (row === "T-c" || otherV) { await act(page, { kind: "character.useDefault", bodyGender: "male" }); await settle(page, b, false);
      await page.waitFor(`${G}.sample().key?.endsWith('|male')`, 900_000); }
    if (row === "T-d") { await act(page, { kind: "layer.edit", command: { kind: "add" } }); await settle(page, b, false); }
  }
  await show(page, a, noGame);
  let target = b, steps: [number, string, boolean?][] = [[0, b.tab]];
  let c: Tab | undefined;
  if (row === "T-e" || row === "T-f") {
    c = await makeTab(page, subject, lookA, null, noGame);
    if (row === "T-e") {
      await settle(page, c, noGame); await show(page, a, noGame);
      if (!otherV) await show(page, b, noGame);
      const cold = otherV ? b : c;
      target = cold; steps = [[0, cold.tab]];
      if (!noGame) {
        const residents = await page.evaluate(`${G}.sample().residents`) as Resident[];
        if (residents.some(r => r.scene === cold.scene)) throw Error("T-e setup failed: the cold tab is still resident, so this is not a cold switch");
      }
    } else {
      await show(page, a, noGame);
      // Both intermediates must be cold, so a 100 ms visit cannot immediately show a prepared runtime.
      // Close/reopen is the real disposal path; it retains scene IDs but drops the runtime.
      for (const tab of [b, c]) {
        await act(page, { kind: "tabs.close", tab: tab.tab });
        const closed = await page.evaluate(`${P}.tabs.snapshot().closed.at(-1)`) as { id?: string; tab: { id: string } };
        await act(page, { kind: "tabs.reopen", closed: closed.id ?? closed.tab.id });
        await page.evaluate(`${G}.click(${JSON.stringify(a.tab)})`);
      }
      await settle(page, a, noGame);
      if (!noGame) {
        const residents = await page.evaluate(`${G}.sample().residents`) as Resident[];
        if (residents.some(r => r.scene === b.scene || r.scene === c!.scene)) throw Error("T-f setup failed: an intermediate scene is still resident");
      }
      target = a; steps = [[0, a.tab], [90, b.tab], [180, c.tab], [270, a.tab]];
    }
  }
  if (row === "T-h") { target = { ...a, unchanged: true }; steps = [[0, b.tab, true]]; }
  // One-second tail is mandatory for T-g and a late-result check is mandatory for T-f even in quick mode.
  const tail = row === "T-f" ? 5000 : 1000;
  const repetitions = quick || !["T-a", "T-b", "T-c", "T-d", "T-e", "T-g"].includes(row) ? 1 : row === "T-e" ? 3 : 5;
  const runs: { result: ReturnType<typeof analyse>; raw: Run }[] = [];
  for (let i = 0; i < repetitions; i++) {
    if (i) await show(page, a, noGame);
    // T-e again from cold: A, then another tab shown leaves the target past the warm budget, so its runtime is disposed and the next click builds it afresh.
    if (i && row === "T-e") await show(page, otherV ? c! : b, noGame);
    const raw = await page.evaluate(`${G}.run(${JSON.stringify(steps)},${JSON.stringify(target)},${noGame},${tail},${noGame ? 15_000 : 900_000},${row === "T-f"})`) as Run;
    let closure: Closure | undefined;
    if (baseline) {
      await page.wait(5000);
      closure = { before: baseline.page, after: await page.evaluate(`${G}.memory()`) as Memory,
        osBefore: baseline.os, osAfter: await chromeMemory(profile), scene: b.scene };
    }
    runs.push({ result: analyse(row, raw, noGame, closure), raw });
  }
  return { row, setup: { a, b, c, baseline }, runs, pass: runs.every(r => r.result.pass), realDataPass: runs.every(r => r.result.realDataPass) };
}

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const value = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; if (!v || v.startsWith("--")) throw Error(`Missing ${name} value`); args.splice(i, 2); return v; };
  const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const cache = value("--cache") ?? "both", filter = value("--rows"), port = Number(value("--port") ?? 4571);
  const quick = flag("--quick"), noGame = flag("--no-game");
  if (args.length || !["warm", "fresh", "both"].includes(cache) || !Number.isInteger(port) || port < 1024 || port > 65535 || [4317, 4331].includes(port)) throw Error("Usage: measure-tabs.ts [--cache warm|fresh|both] [--rows T-a,T-g] [--port 4571] [--quick] [--no-game]");
  const rows = filter ? filter.split(",") as Row[] : [...ROWS];
  if (!rows.length || rows.some(r => !ROWS.includes(r)) || new Set(rows).size !== rows.length) throw Error("--rows needs unique T-a to T-h IDs");
  if (noGame && rows.some(r => r !== "T-a" && r !== "T-g")) throw Error("--no-game is a shell-only T-a/T-g smoke");
  // Refuse an occupied port before launching anything; never claim an existing server as ours.
  const reservation = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }); reservation.stop(true);
  const id = new Date().toISOString().replace(/[:.]/g, "-"), out = resolve(import.meta.dir, "generated/g4", id);
  const data = join(out, "host"); mkdirSync(data, { recursive: true });
  const settings = join(localSettingsDirectory(), "settings.json");
  if (!noGame) { if (!existsSync(settings)) throw Error("No host settings found; use --no-game for a smoke only"); copyFileSync(settings, join(data, "settings.json")); }
  const guard = resolve(repo, "tools/memory_guard.py");
  const log = Bun.file(join(out, "host.log"));
  const server = Bun.spawn([python, guard, "--limit", "5", "--", process.execPath, "server.ts"], { cwd: root,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off",
      XFS_PREVIEW_CORE_CACHE: join(data, "preview-cache"), XFS_RESOLVER_CACHE: join(data, "resolver-cache"), XFS_CHOICE_PREVIEW_CACHE: join(data, "choice-previews") },
    stdout: log, stderr: log, windowsHide: true });
  const report: { date: string; noGame: boolean; quick: boolean; cache: string; rows: Row[]; runs: unknown[]; error?: string } = { date: new Date().toISOString(), noGame, quick, cache, rows, runs: [] };
  const table = ["# G4 tab-switch measurements", "", "Offline browser evidence. First presentation is bounded by the following rAF, as in G3.",
    ...(noGame ? ["Shell-only smoke: real-data G4 remains pending."] : []), "", "| Cache | Row | Trial | Click → presented ms | Links / programs, first frame | Rasters | Tasks ≥50 ms | Progress ms | Gate |", "|---|---|---|---|---|---|---|---|---|"];
  const save = () => { writeFileSync(join(out, "results.json"), JSON.stringify(report, null, 2)); writeFileSync(join(out, "results.md"), table.join("\n") + "\n"); };
  let browser: ReturnType<typeof Bun.spawn> | undefined;
  try {
    let healthy = false;
    for (let i = 0; i < 240; i++) {
      if (server.exitCode !== null) throw Error(`Isolated server exited (${server.exitCode}); inspect host.log`);
      try { healthy = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { /* starting */ }
      if (healthy) break; await Bun.sleep(250);
    }
    if (!healthy) throw Error("Isolated server did not become healthy");
    for (const mode of cache === "both" ? ["warm", "fresh"] : [cache]) for (const row of rows) {
      const profile = join(out, `chrome-${mode}-${row}`);
      // Warm means a full priming session followed by a restart of the same Chrome profile. Fresh uses a never-created profile.
      if (existsSync(profile)) throw Error("A fresh profile path unexpectedly exists");
      const runBrowser = async (prime: boolean) => {
        const output = join(out, `${mode}-${row}-${prime ? "prime" : "measure"}.json`);
        browser = Bun.spawn([python, guard, "--limit", noGame ? "3" : "5", "--", process.execPath, import.meta.path,
          "--worker", String(port), profile, row, String(noGame), String(quick || prime), output], { cwd: repo, stdout: "inherit", stderr: "inherit", windowsHide: true });
        // A dead CDP connection must not hold the host indefinitely. Killing the guard closes its job and owned Chrome tree.
        const timeout = setTimeout(() => browser?.kill(), noGame ? 90_000 : 1_800_000);
        let code: number;
        try { code = await browser.exited; } finally { clearTimeout(timeout); browser = undefined; }
        if (code !== 0) {
          const detail = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : { error: "Chrome worker deadline or guard termination before a result (CDP may not have connected)" };
          report.runs.push({ cache: mode, row, phase: prime ? "prime" : "measure", pass: false, realDataPass: false, ...detail });
          table.push(`| ${mode} | ${row} | ${prime ? "prime" : "measure"} | missing | missing | missing | missing | missing | FAIL (worker ${code}) |`);
          throw Error(`Chrome worker exited ${code}; ${output}`);
        }
        return JSON.parse(readFileSync(output, "utf8")) as Awaited<ReturnType<typeof measure>>;
      };
      if (mode === "warm") await runBrowser(true);
      const result = await runBrowser(false);
      report.runs.push({ cache: mode, ...result });
      result.runs.forEach((r, i) => { const a = r.result; table.push(`| ${mode} | ${row} | ${i + 1} | ${a.clickToFirstPresentedMs ?? "missing"} | ${a.firstFrameLinks} / ${a.firstFramePrograms} | ${a.rasterRequests} | ${a.longTasks50} | ${a.progressWithinMs ?? "—"} | ${a.pass ? "PASS" : "FAIL"}${noGame ? " (smoke only)" : ""} |`); });
      console.log(mode, row, result.pass ? "PASS" : "FAIL", JSON.stringify(result.runs.map(r => r.result.failures)));
      save();
    }
    if (report.runs.some(r => !(r as { pass: boolean }).pass)) process.exitCode = 1;
  } catch (e) { report.error = String(e); process.exitCode = 1; throw e; }
  finally { save(); browser?.kill(); server.kill(); await server.exited; console.log(`G4 evidence: ${out}`); }
}
if (import.meta.main) {
  if (process.argv[2] === "--worker") {
    const [port, profile, row, noGame, quick, output] = process.argv.slice(3) as [string, string, Row, string, string, string];
    const generated = resolve(import.meta.dir, "generated/g4") + sep;
    if (!port || !profile || !output || !Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535 || [4317, 4331].includes(Number(port)) ||
      !ROWS.includes(row) || !["true", "false"].includes(noGame) || !["true", "false"].includes(quick) ||
      !resolve(profile).startsWith(generated) || !resolve(output).startsWith(generated) || noGame === "true" && row !== "T-a" && row !== "T-g")
      throw Error("The internal worker requires an isolated G4 profile/output, an allowed row and a non-Studio port");
    let page: Session | undefined;
    try {
      console.log(`G4 Chrome ${row}: launching headless (${noGame === "true" ? "shell smoke" : "real data"})`);
      page = await launch(`http://127.0.0.1:${port}/?verify=1`, { profile, width: 1280, height: 800, init: GL_PROBE + TAB_PROBE,
        args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", "--disable-extensions", "--disable-background-networking"] });
      console.log(`G4 Chrome ${row}: preparing fixtures`);
      const result = await measure(page, row, noGame === "true", quick === "true", profile);
      writeFileSync(output, JSON.stringify(result, null, 2));
    } catch (e) { writeFileSync(output, JSON.stringify({ error: String(e), console: page?.console }, null, 2)); throw e; }
    finally { await page?.close(); }
  } else await main();
}
