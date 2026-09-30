/**
 * Start-up of an unpacked or installed desktop UI-trial build, end to end, without taking the shared screen or focus
 * (research/backlog/performance.md, "The installed app"; desktop README, "Driving an installed trial").
 *
 *   bun tools/measure-installed-start.ts <app folder> <scratch LocalAppData> <debug port> [runs] [library looks]
 *
 * `<app folder>` holds `bin/launcher.exe` (an unpacked update archive, or an installed trial's `app` folder). Each run starts
 * it through Windows Management Instrumentation, as a process that belongs to no app package and has no right to take the
 * foreground, inside `tools/memory_guard.py --limit 4` run by `pythonw.exe` (no console window anywhere in the chain), with `LOCALAPPDATA` set to the scratch folder (data folder, install
 * receipts and WebView2 profile all live there), `XFS_TRIAL_WINDOW_OFFSCREEN=1` and WebView2's debugging port. It attaches only
 * to a UI-trial identity, then reports, against the launcher's own creation time: the host's log lines, the page's first
 * paint, and the whole V drawn (`xfs:character:frame` after `placed`). With `[library looks]`, it also times the
 * SQLite library through the host's own API, on the last run once the host has been quiet for 15 s: that many saves, 20 listings and a read of each. The window is closed with a
 * posted WM_CLOSE (the close flush runs) and the run waits for every process it started to end. The first run of an empty
 * scratch folder is the cold one. Offline measurements, not game evidence.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { recipeFile } from "../../src/recipe-schema";
import { starterRecipe } from "../../src/features/eye-makeup/region";
import { LocalSettingsStore } from "../../src/local-settings-store";

const [appArg, dataArg, portArg, runsArg = "3", looksArg = "0"] = process.argv.slice(2);
if (!appArg || !dataArg || !portArg) throw Error("Usage: bun tools/measure-installed-start.ts <app folder> <scratch LocalAppData> <debug port> [runs] [library looks]");
const app = resolve(appArg), localAppData = resolve(dataArg), port = Number(portArg), runs = Number(runsArg), looks = Number(looksArg);
if (!Number.isInteger(port) || port < 1024 || port === 4317) throw Error("Pass a free debugging port (never 4317).");
const launcher = join(app, "bin", "launcher.exe");
const version = JSON.parse(readFileSync(join(app, "Resources", "version.json"), "utf8")) as { identifier: string; channel: string; hash?: string };
if (!/^dev\.axefrog\.xf-studio-ui-trial-[a-z0-9]{8,24}$/.test(version.identifier)) throw Error("Only a disposable UI-trial identity is measured.");
const python = join(process.env.LOCALAPPDATA!, "Python", "pythoncore-3.14-64", "python.exe");
const guard = resolve(import.meta.dir, "..", "..", "..", "..", "..", "tools", "memory_guard.py");
const userData = join(localAppData, version.identifier, version.channel);
const settingsGame = process.env.XFS_MEASURE_GAME, settingsWolvenKit = process.env.XFS_MEASURE_WOLVENKIT;
mkdirSync(userData, { recursive: true });
if (settingsGame && !existsSync(join(userData, "settings.json"))) {
  // Fresh settings naming only the game folder and WolvenKit; never a copy of anyone's own settings.
  const store = new LocalSettingsStore(userData);
  const current = store.load().settings;
  store.save({ ...current, gameRoot: settingsGame, launchRoute: "direct", wolvenKitCli: settingsWolvenKit ?? null, updates: { ...current.updates, checkOnStart: false } }, current.revision);
}

const ps = (script: string) => {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (run.status !== 0) throw Error(`PowerShell failed: ${run.stderr}`);
  return run.stdout.trim();
};
/** Every process whose program lives in the app folder: [pid, creation epoch ms, name]. */
const appProcesses = (): Array<[number, number, string]> => {
  const out = ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${app.replaceAll("'", "''")}', 'OrdinalIgnoreCase') } | ForEach-Object { "$($_.ProcessId) $([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()) $($_.Name)" }`);
  return out ? out.split(/\r?\n/).map(line => { const [pid, at, name] = line.trim().split(" "); return [Number(pid), Number(at), name!]; }) : [];
};
const alive = (pid: number) => ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`) === "yes";
/** Post WM_CLOSE to the visible top-level windows of these processes (no activation, no focus change). */
const postClose = (pids: number[]) => ps(`
Add-Type -Namespace XfsMeasure -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
'@
$pids = @(${pids.join(",")}); $n = 0
[XfsMeasure.W]::EnumWindows({ param($h, $l) $p = 0; [void][XfsMeasure.W]::GetWindowThreadProcessId($h, [ref]$p); if ($pids -contains $p -and [XfsMeasure.W]::IsWindowVisible($h)) { [void][XfsMeasure.W]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero); $script:n++ }; $true }, [IntPtr]::Zero) | Out-Null
$n`);

type Cdp = { send(method: string, params?: object): Promise<any>; evaluate(expression: string): Promise<any>; close(): void };
async function attach(): Promise<Cdp> {
  for (let i = 0; ; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
      const page = targets.find(target => target.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\//.test(target.url));
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise<void>((done, fail) => { socket.onopen = () => done(); socket.onerror = fail; });
        let id = 0;
        const pending = new Map<number, { done(value: any): void; fail(error: Error): void }>();
        socket.onmessage = event => {
          const message = JSON.parse(String(event.data));
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.error) request.fail(Error(message.error.message)); else request.done(message.result);
        };
        const send = (method: string, params: object = {}) => new Promise<any>((done, fail) => {
          const next = ++id; pending.set(next, { done, fail }); socket.send(JSON.stringify({ id: next, method, params }));
        });
        const evaluate = async (expression: string) => {
          const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
          return result.result.value;
        };
        const dataRoot = await evaluate("fetch('/api/desktop/capabilities').then(r => r.ok ? r.json() : null).then(c => c?.userDataPath ?? null)");
        if (typeof dataRoot !== "string" || !/[\\/]dev\.axefrog\.xf-studio-ui-trial-[a-z0-9]+[\\/]/i.test(dataRoot))
          throw Error("Refusing to attach: the page is not a disposable UI-trial identity.");
        return { send, evaluate, close: () => socket.close() };
      }
    } catch (error) { if ((error as Error).message.startsWith("Refusing")) throw error; }
    if (i > 1200) throw Error("The WebView's debugging port never listed the Studio page.");
    await Bun.sleep(25);
  }
}

const hostLines = () => {
  const folder = join(userData, "diagnostics");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(name => name.endsWith(".jsonl")).flatMap(name => readFileSync(join(folder, name), "utf8").split("\n"))
    .filter(Boolean).map(line => { try { return JSON.parse(line) as { t?: string; message?: string; area?: string; code?: string }; } catch { return null; } })
    .filter(entry => entry !== null);
};

const recipe = JSON.stringify(recipeFile(starterRecipe()));
for (let run = 1; run <= runs; run++) {
  if (appProcesses().length) throw Error("A process from this app folder is still running; stop before measuring.");
  const logsBefore = hostLines().length;
  // pythonw.exe and launcher.exe are GUI programs and the launcher starts bun.exe with CREATE_NO_WINDOW, so no console
  // window is ever created (a cmd.exe or python.exe here would open one on the shared screen).
  const script = join(localAppData, "..", `measure-run-${port}.py`);
  const guardLog = join(localAppData, "..", `measure-guard-${port}-${run}.log`);
  writeFileSync(script, [
    "import os, runpy, sys",
    `os.environ["LOCALAPPDATA"] = ${JSON.stringify(localAppData)}`,
    'os.environ["XFS_TRIAL_WINDOW_OFFSCREEN"] = "1"',
    `os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=${port}"`,
    `log = open(${JSON.stringify(guardLog)}, "w", encoding="utf-8")`,
    "sys.stdout = sys.stderr = log",
    `sys.argv = [${JSON.stringify(guard)}, "--limit", "4", "--", ${JSON.stringify(launcher)}]`,
    "try:",
    `    runpy.run_path(${JSON.stringify(guard)}, run_name="__main__")`,
    "except SystemExit as exit:",
    '    print(f"exit {exit.code}")',
    "finally:",
    "    log.flush()",
    "",
  ].join("\n"));
  const pythonw = join(dirname(python), "pythonw.exe");
  const created = ps(`(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"${pythonw.replaceAll("'", "''")}" "${script.replaceAll("'", "''")}"' }).ProcessId`);
  const started = Number(created);
  if (!Number.isInteger(started) || started <= 0) throw Error(`WMI did not start the run: ${created}`);
  const page = await attach();
  const processes = appProcesses();
  // Every process descended from the one this run started, by name: a conhost.exe here would be a console window.
  const tree = ps(`$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine; $ids = @(${started}); $names = @(); do { $next = @($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId }); $ids += $next.ProcessId; $names += $next | ForEach-Object { $p = $_.ParentProcessId; "$($_.Name)<$(($all | Where-Object ProcessId -eq $p).Name)" } } while ($next.Count); ($names | Sort-Object -Unique) -join ','`);
  const launched = Math.min(...processes.filter(([, , name]) => name.toLowerCase() === "launcher.exe").map(([, at]) => at));
  await page.evaluate(`(() => { window.__xfsMarks = []; new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.name.startsWith("xfs:character:")) window.__xfsMarks.push([e.name.slice(14), performance.timeOrigin + e.startTime]); }).observe({ type: "mark", buffered: true }); })()`);
  const paint = await page.evaluate(`new Promise(done => { const read = () => { const e = performance.getEntriesByName("first-contentful-paint")[0]; if (e) done({ origin: performance.timeOrigin, fcp: performance.timeOrigin + e.startTime, dcl: performance.timeOrigin + (performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? 0) }); else setTimeout(read, 20); }; read(); })`);
  let vReady: number | null = null;
  const deadline = Date.now() + Number(process.env.XFS_MEASURE_TIMEOUT_MS ?? 240_000);
  while (Date.now() < deadline) {
    const marks = await page.evaluate("window.__xfsMarks") as Array<[string, number]>;
    const placed = marks.filter(([name]) => name === "placed").at(-1)?.[1];
    const frame = marks.filter(([name]) => name === "frame").at(-1)?.[1];
    if (placed && frame && frame > placed) { vReady = frame; break; }
    await Bun.sleep(100);
  }
  const capabilities = await page.evaluate("fetch('/api/desktop/capabilities').then(r => r.json())");
  let library: Record<string, number> | null = null;
  if (looks > 0 && run === runs) {
    // After the V is drawn, let the host's background preparation go quiet first, so the timing is the library's own.
    await Bun.sleep(Number(process.env.XFS_MEASURE_SETTLE_MS ?? 15_000));
    library = await page.evaluate(`(async () => {
    const body = name => JSON.stringify({ name, recipe: ${recipe} });
    const post = { method: "POST", headers: { "Content-Type": "application/json" } };
    const t0 = performance.now(); const ids = [];
    for (let i = 0; i < ${looks}; i++) { const r = await fetch("/api/looks", { ...post, body: body("Timing look " + i) }); if (!r.ok) throw Error("save " + r.status + " " + await r.text()); ids.push((await r.json()).id); }
    const t1 = performance.now();
    let listed = 0; for (let i = 0; i < 20; i++) listed = (await (await fetch("/api/looks")).json()).length;
    const t2 = performance.now();
    for (const id of ids) { const r = await fetch("/api/looks/" + id); if (!r.ok) throw Error("get " + r.status); await r.json(); }
    const t3 = performance.now();
    return { looks: ${looks}, listed, saveMs: Math.round(t1 - t0), list20Ms: Math.round(t2 - t1), readAllMs: Math.round(t3 - t2) };
  })()`);
  }
  page.close();
  const appPids = appProcesses().map(([pid]) => pid);
  const closed = Number(postClose(appPids));
  const closeStart = Date.now();
  while (alive(started) && Date.now() - closeStart < 30_000) await Bun.sleep(200);
  if (alive(started)) { spawnSync("taskkill.exe", ["/T", "/F", "/PID", String(started)], { windowsHide: true }); throw Error("The app did not close within 30 s; stopped the run's own process tree."); }
  const lines = hostLines().slice(logsBefore).map(entry => {
    const at = Date.parse(entry.t ?? "");
    return `${Number.isFinite(at) ? ((at - launched) / 1000).toFixed(3) : "?"} s  ${(entry.area ?? "")} ${(entry.message ?? entry.code ?? "").slice(0, 160)}`;
  });
  console.log(JSON.stringify({ run, build: version.hash, launcherToFirstPaintMs: Math.round(paint.fcp - launched),
    launcherToPageStartMs: Math.round(paint.origin - launched), launcherToDomContentLoadedMs: Math.round(paint.dcl - launched),
    launcherToVDrawnMs: vReady === null ? null : Math.round(vReady - launched), previewAssets: capabilities.previewAssets,
    library: capabilities.library, packageBuild: capabilities.packageBuild, windowsClosed: closed, runProcesses: tree, libraryTiming: library,
    guard: readFileSync(guardLog, "utf8").trim().split(/\r?\n/).filter(line => line.startsWith("memory guard")).at(-1) ?? null }));
  for (const line of lines) console.log("  " + line);
  await Bun.sleep(1500);
}
