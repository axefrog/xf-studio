/**
 * Spike S2 harness (README.md): measures switching the drawn view in a headless Chrome (GPU through ANGLE, off-screen) on an already
 * running isolated server's `?verify=1&spike=views` workspace. Offline measurements, not game evidence.
 *
 *   bun experiments/039-view-switch-spike/measure.ts <port> <out.json> <chrome profile dir>
 *
 * Start the server first with its own port, data, caches and settings copy (README.md "How it was run"); never 4317 or 4331.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "../../projects/xf-studio/authoring/tools/cdp";
import { GL_PROBE } from "../../projects/xf-studio/authoring/tools/gl-probe";

const [portArg, outArg, profileArg] = process.argv.slice(2);
const port = Number(portArg);
if (!port || port === 4317 || port === 4331 || !outArg || !profileArg) throw Error("Usage: measure.ts <port (not 4317/4331)> <out.json> <profile dir>");
const out: Record<string, unknown> = { date: new Date().toISOString() };
const save = () => writeFileSync(resolve(outArg), JSON.stringify(out, null, 1));
const log = (key: string, value: unknown) => { out[key] = value; save(); console.log(key, JSON.stringify(value).slice(0, 600)); };

// Every character request the page asks the host for, in order (the harness reuses the default Vs' requests for resident subjects).
const RECORD = `(() => { const original = window.fetch; window.__spikeRequests = [];
  window.fetch = function(input, init) { try { const url = typeof input === "string" ? input : input.url;
    if (url.includes("/api/preview-character") && init?.method === "POST" && !String(init.headers?.["X-XFS-Page"] ?? "").endsWith("-ahead"))
      window.__spikeRequests.push({ at: performance.now(), body: JSON.parse(init.body) }); } catch {}
    return original.apply(this, arguments); }; })();`;

const page = await launch(`http://127.0.0.1:${port}/?verify=1&spike=views`, { width: 1100, height: 750, init: GL_PROBE + RECORD,
  profile: resolve(profileArg), args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });

/** The headless Chrome's GPU process's dedicated and shared GPU memory (Windows GPU Process Memory counters), in MB. */
async function gpuMemory() {
  const profile = resolve(profileArg).replace(/\//g, "\\").replace(/'/g, "''");
  const script = `$b = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*--user-data-dir=${profile}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1;
    if (!$b) { 'null'; exit }
    $g = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($b.ProcessId)" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' } | Select-Object -First 1;
    if (!$g) { 'null'; exit }
    $s = (Get-Counter -ErrorAction SilentlyContinue "\\GPU Process Memory(pid_$($g.ProcessId)*)\\Dedicated Usage","\\GPU Process Memory(pid_$($g.ProcessId)*)\\Shared Usage").CounterSamples;
    $d = ($s | Where-Object { $_.Path -like '*dedicated*' } | Measure-Object CookedValue -Sum).Sum; $h = ($s | Where-Object { $_.Path -like '*shared*' } | Measure-Object CookedValue -Sum).Sum;
    $w = (Get-Process -Id $g.ProcessId).PrivateMemorySize64;
    '{"dedicatedMB":' + [math]::Round($d/1MB) + ',"sharedMB":' + [math]::Round($h/1MB) + ',"gpuProcessPrivateMB":' + [math]::Round($w/1MB) + '}'`;
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], { stdout: "pipe", stderr: "ignore", windowsHide: true });
  const text = (await new Response(proc.stdout).text()).trim();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}
const S = "window.xfStudioSpike", P = "window.xfStudioPresentation", status = `${P}.snapshot().status?.assets?.characterDetails`;
const memory = async (label: string) => {
  await page.evaluate(`(async () => { if (window.gc) gc(); await new Promise(r => setTimeout(r, 300)); })()`);
  return { label, page: await page.evaluate(`${S}.memory()`), gpu: await gpuMemory() };
};
const ready = (body: string) => `${status}?.phase === 'ready' && !${status}.updating && ${S}.mainBody() === '${body}'`;

/**
 * Time from a switch to its first drawn frame: `act` runs, then each animation frame checks whether the drawing scene's frame count rose;
 * the frame after that rise is when the drawn frame reached the compositor. Long tasks and programs linked inside the window are reported.
 */
const firstFrame = (act: string, drawer: string) => page.evaluate(`(async () => {
  const probe = window.xfsGl, programs0 = probe.programs.length, uploads0 = probe.uploads.length;
  const long = []; const observer = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); });
  observer.observe({ type: "longtask" });
  performance.clearResourceTimings();
  const before = (${drawer})?.frames ?? 0;
  const t0 = performance.now();
  ${act};
  let drawnAt = null;
  for (let i = 0; i < 600 && drawnAt === null; i++) {
    await new Promise(r => requestAnimationFrame(r));
    if (((${drawer})?.frames ?? 0) > before) drawnAt = performance.now();
  }
  await new Promise(r => requestAnimationFrame(r));
  const presented = performance.now();
  await new Promise(r => setTimeout(r, 50));
  observer.disconnect();
  const resources = performance.getEntriesByType("resource").filter(r => r.name.includes("/api/preview-character") || r.name.includes("/assets/character/") || r.name.includes("/preview-core"));
  return { drawnMs: drawnAt === null ? null : Math.round((drawnAt - t0) * 10) / 10, presentedMs: Math.round((presented - t0) * 10) / 10,
    longTasks: long, programsLinked: probe.programs.length - programs0, uploads: probe.uploads.length - uploads0,
    programsTotal: ${S}.memory().renderer?.programs, characterFetches: resources.length };
})()`);

try {
  await page.waitFor(ready("female"), 900_000);
  await page.wait(4000);
  log("start", await memory("feminine default V, one view"));

  // ---------- Gate A: two views of one scene ----------
  const v2 = await page.evaluate(`(() => { const g = ${S}.graph; return g.addView("main", { scene: true }); })()`) as string;
  // The second view: whole body framing and the other lighting preset (another light configuration, so other programs).
  await page.evaluate(`${S}.drawView(${JSON.stringify(v2)})`);
  await page.wait(500);
  for (const action of [{ kind: "camera.body", view: v2 }, { kind: "preview.setLightingPreset", preset: "studio", view: v2 }])
    log(`viewSetup ${action.kind}`, await page.evaluate(`${S}.dispatch(${JSON.stringify(action)})`));
  await page.wait(1500);
  await page.evaluate(`${S}.drawView("main")`);
  await page.wait(1500);
  const viewSwitches: unknown[] = [];
  for (let i = 0; i < 12; i++) {
    const to = i % 2 === 0 ? v2 : "main";
    viewSwitches.push({ to, ...(await firstFrame(`${S}.drawView(${JSON.stringify(to)})`, `${S}.frames("main")`) as object) });
    await page.wait(400);
  }
  log("gateA.viewSwitches", viewSwitches);
  log("gateA.memory", await memory("two views of one scene"));

  // ---------- Gate B, today's path: the head reloads for the other body ----------
  /** Dispatch a character action and sample, every animation frame, which body the drawn head has and what the page says meanwhile. */
  const bodySwitch = (action: object, until: string, extra = "") => page.evaluate(`(async () => {
    const t0 = performance.now(), samples = [];
    const long = []; const observer = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push([Math.round(e.startTime - t0), Math.round(e.duration)]); });
    observer.observe({ type: "longtask" });
    ${P}.authoring.dispatch(${JSON.stringify(action)});
    ${extra}
    let last = "", done = null;
    while (performance.now() - t0 < 600000) {
      await new Promise(r => requestAnimationFrame(r));
      const s = ${status}, head = ${S}.head();
      const now = JSON.stringify([${S}.mainBody(), s?.phase, s?.updating, s?.progress ? s.progress.index + "/" + s.progress.total + " " + s.progress.label : null,
        head ? JSON.stringify(head).slice(0, 160) : null]);
      if (now !== last) { samples.push([Math.round(performance.now() - t0), JSON.parse(now)]); last = now; }
      if (${until}) { done = Math.round(performance.now() - t0); break; }
    }
    observer.disconnect();
    return { doneMs: done, samples: samples.slice(0, 60), longTasks: long.filter(l => l[1] > 100) };
  })()`);
  log("headState", await page.evaluate(`${S}.head()`));
  log("gateB.today.femToMasc.cold", await bodySwitch({ kind: "character.useDefault", bodyGender: "male" }, ready("male")));
  await page.wait(3000);
  log("gateB.today.memory.masc", await memory("masculine default V after reload"));
  log("gateB.today.mascToFem", await bodySwitch({ kind: "character.useDefault", bodyGender: "female" }, ready("female")));
  await page.wait(3000);
  log("gateB.today.femToMasc.warm", await bodySwitch({ kind: "character.useDefault", bodyGender: "male" }, ready("male")));
  await page.wait(3000);
  log("gateB.today.mascToFem.warm", await bodySwitch({ kind: "character.useDefault", bodyGender: "female" }, ready("female")));
  await page.wait(3000);
  // Superseded: masculine asked, then the feminine V again 150 ms later. Does the masculine head still load, and is it ever drawn?
  log("gateB.today.superseded", await bodySwitch({ kind: "character.useDefault", bodyGender: "male" }, ready("female"),
    `await new Promise(r => setTimeout(r, 150)); ${P}.authoring.dispatch({ kind: "character.useDefault", bodyGender: "female" });`));
  await page.wait(3000);
  const requests = await page.evaluate(`window.__spikeRequests.map(r => r.body)`) as { body?: unknown; source: string }[];
  const masc = [...requests].reverse().find(r => JSON.stringify(r).includes('"male"'));
  const fem = [...requests].reverse().find(r => r !== masc && !JSON.stringify(r).includes('"male"'));
  log("requests", { count: requests.length, masc: masc ? JSON.stringify(masc).slice(0, 300) : null, fem: fem ? JSON.stringify(fem).slice(0, 300) : null });
  if (!masc) throw Error("No masculine request was recorded.");

  // ---------- Gate B, prototype: resident subjects on one context ----------
  await page.waitFor(ready("female"), 120_000);
  log("gateB.resident.memory.before", await memory("feminine head only, before residents"));
  const t0 = Date.now();
  log("gateB.resident.open", await page.evaluate(`${S}.open("masc", "male", ${JSON.stringify(masc)})`));
  await page.waitFor(`${S}.status("masc")?.phase === "ready" && !${S}.status("masc").updating && ${S}.status("masc").inflight === 0`, 300_000);
  log("gateB.resident.openReadyMs", Date.now() - t0);
  await page.wait(2000);
  // The first draw of a new resident links its programs (first switch); the rest are warm.
  const residentSwitches: unknown[] = [];
  for (let i = 0; i < 12; i++) {
    const to = i % 2 === 0 ? "masc" : "main";
    residentSwitches.push({ to, ...(await firstFrame(`${S}.show(${JSON.stringify(to)})`, `${S}.frames(${JSON.stringify(to)})`) as object) });
    await page.wait(400);
  }
  log("gateB.resident.switches", residentSwitches);
  log("gateB.resident.memory.two", await memory("feminine + masculine resident"));
  // A third subject on the same body as the shown one (a save V or another character): here the masculine default V with a hairstyle
  // the first doesn't have, opened while the masculine resident is shown, then superseded 150 ms in. Its loader must stop, and its result
  // must never be drawn.
  log("gateB.resident.cancel", await page.evaluate(`(async () => {
    const probe = window.xfsGl;
    await ${S}.open("late", "male", ${JSON.stringify(masc)}, {});
    await new Promise(r => setTimeout(r, 150));
    const status0 = ${S}.status("late");
    const cancelledAt = ${S}.cancel("late"), uploads0 = probe.uploads.length;
    let stoppedAt = null;
    while (performance.now() - cancelledAt < 20000) {
      await new Promise(r => setTimeout(r, 2));
      const s = ${S}.status("late");
      if (s.inflight === 0) { stoppedAt = Math.max(s.settledAt, cancelledAt); break; }
    }
    const lateUploads = probe.uploads.slice(uploads0).map(u => [Math.round(u.at - cancelledAt), Math.round(u.ms), u.w + "x" + u.h]);
    await new Promise(r => setTimeout(r, 3000));
    const after = ${S}.status("late");
    return { atCancel: status0, stopMs: stoppedAt === null ? null : Math.round((stoppedAt - cancelledAt) * 10) / 10,
      uploadsAfterCancel: lateUploads, lateFramesDrawn: after.frames, shown: ${S}.shown(), phaseAfter: after.phase };
  })()`));
  await page.evaluate(`${S}.close("late")`);
  // Superseded while it was being shown: open a resident, show it at once (progress: its status), then show the other one 150 ms later.
  log("gateB.resident.supersededShow", await page.evaluate(`(async () => {
    await ${S}.open("late2", "male", ${JSON.stringify(masc)});
    ${S}.show("late2");
    const t0 = performance.now(), statusAtShow = ${S}.status("late2");
    await new Promise(r => setTimeout(r, 150));
    ${S}.show("main");
    const cancelledAt = ${S}.cancel("late2");
    let stoppedAt = null;
    while (performance.now() - cancelledAt < 20000) {
      await new Promise(r => setTimeout(r, 2));
      const s = ${S}.status("late2"); if (s.inflight === 0) { stoppedAt = Math.max(s.settledAt, cancelledAt); break; }
    }
    const framesAtCancel = ${S}.frames("late2").frames;
    await new Promise(r => setTimeout(r, 3000));
    return { statusAtShow, stopMs: stoppedAt === null ? null : Math.round((stoppedAt - cancelledAt) * 10) / 10,
      framesWhileShown: framesAtCancel, framesAfterSuperseded: ${S}.frames("late2").frames - framesAtCancel, shown: ${S}.shown(), openMs: Math.round(cancelledAt - t0) };
  })()`));
  await page.evaluate(`${S}.close("late2")`);
  await page.evaluate(`${S}.close("masc")`);
  await page.wait(1500);
  log("gateB.resident.memory.closed", await memory("resident closed"));
  log("console", page.console.filter(entry => /error|exception/i.test(entry.type)).slice(0, 20));
} catch (error) {
  log("error", String((error as Error)?.stack ?? error));
  log("console", page.console.slice(-30));
} finally {
  await page.close();
}
