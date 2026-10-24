/**
 * Gate G2 harness (README.md §5, §11): switching to a body and a lighting setup the page has never drawn, on real data, in a headless
 * Chrome with a fresh profile (a cold program cache). Offline browser measurements, not game evidence. It replaces the spike harness
 * `experiments/039-view-switch-spike/measure.ts`, whose `?spike=views` hooks left the product with profiles phase 4a.
 *
 *   bun experiments/043-scene-runtimes/measure.ts <port> <out.json> <chrome profile dir>
 *
 * Start the server first, on its own port, with its own data folder, caches and a read-only copy of the local settings
 * (experiments/039-view-switch-spike/README.md "How it was run"); never 4317 or 4331. The profile folder must be new: the run refuses
 * one that exists, so its GPU program cache is cold. Three switches follow the first V (the feminine default V, soft studio light):
 *
 *   A  body: the masculine default V, under the same lighting setup (a body never drawn; the host prepares its core once, then
 *      the page prepares the runtime: `character.useDefault`);
 *   B  lighting: the shown V gets the character-creator setup, never drawn on this page (`preview.setLightingPreset`): it is prepared on the
 *      shown V (the setup before stays drawn) and takes over once ready, so "shown" below means the frame it takes over in;
 *   C  body and lighting together: the feminine default V again under the creator setup (the warm runtime was prepared for soft light).
 *
 * For each it records, from the request to one second after the new V is shown: the main-thread tasks of 50 ms or more (the Long Tasks
 * API), the programs linked and maps uploaded before the show, in the first shown frame and after it, how long the page waited on a
 * program's first use, the stages the preparation went through, and whether the pane showed progress throughout. The record is checked
 * against the gates by `verdict` in the output. `G2_PROFILE=1` also keeps a sampled CPU profile of each switch beside the summary.
 *
 * Gate G3 (README.md §14) adds, on the same page and profile:
 *   G3_ROWS=1    after A, B and C: D, eight warm body switches (the first re-prepares the other body for the shown setup, the rest are
 *                warm: want to first presented frame), E, a warm body's preparation cancelled by a switch back to the shown V, and F, three
 *                body choices 120 ms apart (the last wins), both with the idle off and a hash of the canvas on every frame (a frame drawn
 *                for anything that is not shown shows as a change), and a quiet tail that a late result would show in;
 *   G3_PART=memory  instead of A to F: the memory part. The OS-side memory of this Chrome (the GPU process's private bytes and dedicated
 *                video memory, the page's renderer) and the live GL object counts after every cycle of warm body switches and setup
 *                changes, to show what returns and what plateaus.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "../../projects/xf-studio/authoring/tools/cdp";
import { GL_PROBE } from "../../projects/xf-studio/authoring/tools/gl-probe";
import { FRAME_GAP_MS, preparationGaps } from "../../projects/xf-studio/authoring/tools/frame-gaps";

const [portArg, outArg, profileArg] = process.argv.slice(2);
const port = Number(portArg);
if (!port || port === 4317 || port === 4331 || !outArg || !profileArg) throw Error("Usage: measure.ts <port (not 4317/4331)> <out.json> <new chrome profile dir>");
// G2_WARM=1: a profile that exists is wanted (a second session on the same profile: does the browser's program cache keep what it built?).
const warmProfile = process.env.G2_WARM === "1";
if (existsSync(resolve(profileArg)) !== warmProfile) throw Error(warmProfile ? `G2_WARM=1 needs the profile folder of an earlier run; ${profileArg} doesn't exist.`
  : `The Chrome profile folder ${profileArg} exists: a cold run needs a new one.`);
const started = Date.now();
const out: Record<string, unknown> = { date: new Date().toISOString() };
const save = () => writeFileSync(resolve(outArg), JSON.stringify(out, null, 1));
const log = (key: string, value: unknown) => { out[key] = value; save(); console.log(key, JSON.stringify(value).slice(0, 700)); };

/** The task threshold the budget names (research/backlog/performance.md): a main-thread task this long or longer fails the gate. */
const LONG_TASK_MS = 50;

/**
 * Runs before the page's own scripts, after GL_PROBE: every long task (buffered, so none is missed), every texture upload call with its
 * time, and `run`, which dispatches an action and samples the page each animation frame until its condition holds.
 */
const RECORD = `(() => {
  const g2 = window.__g2 = { long: [], tex: [], lag: [] };
  // A timer that should fire every 10 ms: a late one is the page's thread (or its timers) not free, whatever the animation frames do.
  let lastBeat = performance.now();
  setInterval(() => { const now = performance.now(); if (now - lastBeat > 60) g2.lag.push([lastBeat, now - lastBeat]); lastBeat = now; }, 10);
  new PerformanceObserver(list => { for (const e of list.getEntries()) g2.long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  const proto = WebGL2RenderingContext.prototype;
  for (const method of ["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "compressedTexImage2D", "compressedTexSubImage2D"]) {
    const original = proto[method];
    proto[method] = function(...args) { const t = performance.now(); const result = original.apply(this, args); if (g2.tex.length < 100000) g2.tex.push([t, performance.now() - t]); return result; };
  }
  // Live GL objects by kind (created minus deleted), for the memory part: a runtime that is closed must give its objects back.
  const live = g2.gl = { texture: 0, buffer: 0, framebuffer: 0, renderbuffer: 0, program: 0, vertexArray: 0, sampler: 0, shader: 0 }, alive = new WeakSet();
  for (const [kind, create, remove] of [["texture", "createTexture", "deleteTexture"], ["buffer", "createBuffer", "deleteBuffer"], ["framebuffer", "createFramebuffer", "deleteFramebuffer"],
    ["renderbuffer", "createRenderbuffer", "deleteRenderbuffer"], ["program", "createProgram", "deleteProgram"], ["vertexArray", "createVertexArray", "deleteVertexArray"],
    ["sampler", "createSampler", "deleteSampler"], ["shader", "createShader", "deleteShader"]]) {
    const made = proto[create], removed = proto[remove];
    proto[create] = function(...args) { const object = made.apply(this, args); if (object) { alive.add(object); live[kind]++; } return object; };
    proto[remove] = function(object) { if (object && alive.has(object)) { alive.delete(object); live[kind]--; } return removed.call(this, object); };
  }
  // A hash of the drawing buffer, 32 x 32 samples of it: a frame drawn onto the canvas changes it (the idle is off while it is watched).
  let hashCanvas = null;
  g2.canvasHash = () => {
    const source = document.querySelector("#device-head canvas");
    if (!source || !source.width) return -1;
    hashCanvas ??= Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
    const context = hashCanvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, 32, 32);
    const data = context.getImageData(0, 0, 32, 32).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) { hash ^= data[i]; hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  };
  const strings = [], index = new Map();
  const intern = s => { if (s === null || s === undefined) return -1; let i = index.get(s); if (i === undefined) { i = strings.length; strings.push(s); index.set(s, i); } return i; };
  g2.strings = strings;
  /** One sample of what the page shows: the shown runtime and its frames, the preparation in flight, the pane's words. */
  let watching = false;
  const sample = () => {
    const e = window.xfStudioSceneEvidence?.();
    const shown = e?.residency.residents.find(r => r.state === "shown");
    const prep = e?.residency.preparation;
    const line = document.querySelector(".viewport-detail-status");
    const state = document.querySelector(".viewport-state:not([hidden])");
    const visibleLine = line && !line.hidden ? line.innerText.trim() : null;
    return [performance.now(), intern(shown?.key ?? null), e?.frames.frames ?? -1, intern(prep?.stage ?? null), prep ? Math.round(prep.fraction * 1000) / 1000 : -1,
      intern(prep?.waiting ?? null), intern(visibleLine), intern(state ? state.innerText.trim() : null), intern(window.xfStudioPresentation.viewport.snapshot().head.phase), intern(prep?.detail ?? null), watching ? g2.canvasHash() : -2,
      intern(e ? (e.lighting.staged ? "staged:" : "") + e.lighting.preset : null)];
  };
  /** Dispatch \`action\`, sample every animation frame until \`done(sample)\` (or \`maxMs\`), then \`tailMs\` more. */
  g2.run = async (action, doneSource, minMs, tailMs, maxMs) => {
    // \`seen\`: whether a preparation has been in flight since the request (evidence; a lighting change ends at its takeover, whether or
    // not a preparation ran: a setup already prepared takes over at once).
    const done = new Function("s", "strings", "seen", "return (" + doneSource + ")");
    let seen = false;
    const before = sample(), ticks = [before];
    const t0 = performance.now();
    const answer = window.xfStudioShell.runtime.dispatch(action);
    const dispatchedAt = performance.now();
    let doneAt = null;
    for (;;) {
      await new Promise(r => requestAnimationFrame(r));
      const s = sample(); ticks.push(s);
      const now = s[0];
      if (s[3] >= 0) seen = true;
      if (doneAt === null && now - t0 >= minMs && done(s, strings, seen)) doneAt = now;
      if (doneAt !== null && now - doneAt >= tailMs) break;
      if (now - t0 > maxMs) break;
    }
    return { t0, dispatchedAt, doneAt, timedOut: doneAt === null, dispatch: JSON.stringify(await answer ?? null).slice(0, 300), ticks, strings: strings.slice(), startKey: strings[before[1]] ?? null };
  };
  /**
   * A scripted run (G3's cancel and last-choice rows): dispatch each [atMs, action] at its time from the start, sample every animation frame
   * (with the canvas hash) until \`minMs\`, then until the preparation is over, then \`tailMs\` more, so a result arriving late shows.
   */
  g2.script = async (steps, minMs, tailMs, maxMs) => {
    watching = true;
    const before = sample(), ticks = [before], t0 = performance.now(), sent = [];
    const answers = steps.map(([at, action], i) => new Promise(resolve => setTimeout(() => {
      sent[i] = performance.now();
      Promise.resolve(window.xfStudioShell.runtime.dispatch(action)).then(answer => resolve(JSON.stringify(answer ?? null).slice(0, 200)), error => resolve("error: " + error));
    }, at)));
    let idleAt = null;
    for (;;) {
      await new Promise(r => requestAnimationFrame(r));
      const s = sample(); ticks.push(s);
      const now = s[0];
      const dispatched = sent.filter(Boolean).length === steps.length;
      if (idleAt === null && dispatched && now - t0 >= minMs && s[3] < 0) idleAt = now;
      if (idleAt !== null && now - idleAt >= tailMs) break;
      if (now - t0 > maxMs) break;
    }
    watching = false;
    return { t0, sent, answers: await Promise.all(answers), idleAt, timedOut: idleAt === null, ticks, strings: strings.slice(), startKey: strings[before[1]] ?? null };
  };
  /** The page's own figures: the live GL objects, the JS heap after a collection, and the residents. */
  g2.memory = async () => {
    window.gc?.(); await new Promise(r => setTimeout(r, 50)); window.gc?.();
    const e = window.xfStudioSceneEvidence?.();
    return { gl: { ...g2.gl }, programs: window.xfsGl.programs.length, jsHeapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576 * 10) / 10,
      residents: e?.residency.residents.map(r => r.key + ":" + r.state) ?? [] };
  };
})();`;

const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1280, height: 800, init: GL_PROBE + RECORD,
  profile: resolve(profileArg), args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", "--renderer-process-limit=1", "--disable-extensions",
    "--disable-background-networking", "--disable-features=BackForwardCache,MediaRouter,OptimizationHints,Translate"] });

type Tick = (number | null)[];
type Run = { t0: number; dispatchedAt: number; doneAt: number | null; timedOut: boolean; dispatch: string; ticks: Tick[]; strings: string[]; startKey: string | null };
/** A sample's fields (index 10 is the canvas hash, sampled while a scripted run watches; `display` is the lighting drawn: its preset, `staged:` first while a setup asked for waits beside it). */
const T = { t: 0, key: 1, frames: 2, stage: 3, fraction: 4, waiting: 5, line: 6, pane: 7, phase: 8, detail: 9, display: 11 } as const;
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** What the page held in the GL probe and the long-task list at the end of a run, in the page's clock. */
async function pageRecord() {
  return await page.evaluate(`(() => ({ long: window.__g2.long, tex: window.__g2.tex, lag: window.__g2.lag,
    programs: window.xfsGl.programs.map(p => [p.name + (p.defines.length ? "[" + p.defines.join(",") + "]" : ""), p.linkAt, p.waited, p.usedAt ?? null]),
    uploads: window.xfsGl.uploads.map(u => [u.method, u.at, u.ms, u.w + "x" + u.h + " " + u.kind]) }))()`) as { long: [number, number][]; tex: [number, number][]; lag: [number, number][];
    programs: [string, number, number | null, number | null][]; uploads: [string, number, number, string][] };
}

/** Reduce a run and the page's record to the figures the gates and the README table use. */
function analyse(run: Run, record: Awaited<ReturnType<typeof pageRecord>>, kind: "body" | "lighting") {
  const { ticks, strings } = run;
  const str = (tick: Tick, field: number) => (tick[field]! >= 0 ? strings[tick[field]!]! : null);
  const startKey = run.startKey;
  // The first tick that shows another runtime: the show happened after the tick before it. That tick's frames count the new runtime's. For
  // a lighting change, the first tick whose drawn lighting is another one than before the request: the takeover (after its preparation,
  // or at once for a setup already prepared).
  const startDisplay = str(ticks[0]!, T.display);
  const shownIndex = kind === "body" ? ticks.findIndex(tick => str(tick, T.key) !== null && str(tick, T.key) !== startKey)
    : ticks.findIndex(tick => { const display = str(tick, T.display); return display !== null && display !== startDisplay && !display.startsWith("staged:"); });
  const shownTick = shownIndex > 0 ? ticks[shownIndex]! : null, beforeShown = shownIndex > 0 ? ticks[shownIndex - 1]![T.t]! : null;
  const t0 = run.t0, endAt = (run.doneAt ?? ticks[ticks.length - 1]![T.t]!) + 0;
  const showAt = shownTick ? shownTick[T.t]! : null;
  // Preparation window: from the request to the last tick before the new V shows. The first shown frames: from that tick to the second
  // frame after the show (the first frame is the one drawn with the show; the tick that saw it follows). Lighting runs have no show.
  const prepEnd = beforeShown ?? endAt;
  const firstFramesEnd = shownIndex > 0 ? ticks[Math.min(ticks.length - 1, shownIndex + 1)]![T.t]! : t0;
  const inWindow = (value: number, from: number, to: number) => value >= from && value <= to;
  const longIn = (from: number, to: number) => record.long.filter(([start, duration]) => start + duration >= from && start <= to);
  const longOver = (list: [number, number][]) => list.filter(([, duration]) => duration >= LONG_TASK_MS);
  const programsIn = (from: number, to: number) => record.programs.filter(p => inWindow(p[1], from, to));
  const waitedMax = (list: typeof record.programs) => list.reduce((max, p) => Math.max(max, p[2] ?? 0), 0);
  const texIn = (from: number, to: number) => record.tex.filter(([at]) => inWindow(at, from, to));
  const tailEnd = (run.doneAt ?? endAt) + 1000;
  const prepTasks = longIn(t0, prepEnd), afterTasks = shownTick ? longIn(prepEnd, tailEnd) : [];
  const allTasks = longIn(t0, tailEnd);
  const stageOf = (at: number) => { const tick = [...ticks].reverse().find(tick => tick[T.t]! <= at); return tick ? (str(tick, T.stage) ?? "none") : "none"; };
  const stages: { stage: string; fromMs: number; toMs: number; waiting: string | null }[] = [];
  for (const tick of ticks) {
    const stage = str(tick, T.stage);
    if (!stage) continue;
    const last = stages[stages.length - 1];
    if (last && last.stage === stage) last.toMs = round(tick[T.t]! - t0);
    else stages.push({ stage, fromMs: round(tick[T.t]! - t0), toMs: round(tick[T.t]! - t0), waiting: str(tick, T.waiting) });
  }
  // Progress: from 150 ms in (the pane's own grace) to the show, the share of animation frames on which the pane said something (the
  // quiet line beside the shown V, or its loading state) and the longest stretch with nothing, and how many distinct fractions it saw.
  const progressTicks = ticks.filter(tick => tick[T.t]! >= t0 + 150 && tick[T.t]! <= prepEnd);
  const said = (tick: Tick) => str(tick, T.line) !== null || str(tick, T.pane) !== null;
  let quietFrom: number | null = null, longestQuiet = 0;
  for (const tick of progressTicks) {
    if (said(tick)) quietFrom = null;
    else { quietFrom ??= tick[T.t]!; longestQuiet = Math.max(longestQuiet, tick[T.t]! - quietFrom); }
  }
  const lagIn = (from: number, to: number) => record.lag.filter(([start, duration]) => start + duration >= from && start <= to);
  const gaps = ticks.slice(1).map((tick, i) => tick[T.t]! - ticks[i]![T.t]!);
  // Up to and including the interval that ends at the takeover (tools/frame-gaps.ts).
  const prepGaps = preparationGaps(ticks.map(tick => tick[T.t]!), shownIndex > 0 ? shownIndex : null);
  const linesSeen = [...new Set(ticks.map(tick => str(tick, T.line)).filter(Boolean))], panesSeen = [...new Set(ticks.map(tick => str(tick, T.pane)).filter(Boolean))];
  const fractions = ticks.map(tick => tick[T.fraction]!).filter(fraction => fraction >= 0);
  const prepPrograms = programsIn(t0, prepEnd), firstPrograms = shownTick ? programsIn(beforeShown!, firstFramesEnd) : [], afterPrograms = shownTick ? programsIn(firstFramesEnd, tailEnd) : [];
  const longList = (list: [number, number][]) => list.map(([start, duration]) => ({ atMs: round(start - t0), ms: round(duration), stage: stageOf(start) })).sort((a, b) => b.ms - a.ms).slice(0, 8);
  return {
    kind, startKey, shownKey: shownTick ? str(shownTick, T.key) : null, timedOut: run.timedOut, dispatch: run.dispatch,
    /** Request to the first tick that saw the new V shown, and to the tick after it (the frame it was drawn in, presented). */
    wantToShownMs: shownTick ? round(showAt! - t0) : null, wantToFirstPresentedMs: shownIndex > 0 && shownIndex + 1 < ticks.length ? round(ticks[shownIndex + 1]![T.t]! - t0) : null,
    stages,
    longTasks: { duringPreparation: { count50: longOver(prepTasks).length, maxMs: round(Math.max(0, ...prepTasks.map(([, d]) => d))), list: longList(prepTasks) },
      afterShown1s: { count50: longOver(afterTasks).length, maxMs: round(Math.max(0, ...afterTasks.map(([, d]) => d))), list: longList(afterTasks) },
      total: { count50: longOver(allTasks).length, maxMs: round(Math.max(0, ...allTasks.map(([, d]) => d))), under50AtOrOver30: allTasks.filter(([, d]) => d >= 30 && d < LONG_TASK_MS).length } },
    timerLateMs: { duringPreparationMax: round(Math.max(0, ...lagIn(t0, prepEnd).map(([, d]) => d))), duringPreparationOver100: lagIn(t0, prepEnd).filter(([, d]) => d > 100).length,
      afterShown1sMax: shownTick ? round(Math.max(0, ...lagIn(prepEnd, tailEnd).map(([, d]) => d))) : null },
    frameGapMs: { duringPreparationMax: round(Math.max(0, ...prepGaps)), allMax: round(Math.max(0, ...gaps)), duringPreparationOver100: prepGaps.filter(gap => gap > 100).length },
    programs: { linkedDuringPreparation: prepPrograms.length, firstShownFrame: firstPrograms.length, afterFirstFrameTo1s: afterPrograms.length,
      firstUseWaitMaxMs: { preparation: round(waitedMax(prepPrograms)), firstShownFrame: round(waitedMax(firstPrograms)), after: round(waitedMax(afterPrograms)) },
      firstShownFrameNames: firstPrograms.slice(0, 12).map(p => p[0]), afterNames: afterPrograms.slice(0, 12).map(p => p[0]) },
    textureCalls: { duringPreparation: texIn(t0, prepEnd).length, firstShownFrame: texIn(beforeShown ?? 0, firstFramesEnd).length, afterFirstFrameTo1s: texIn(firstFramesEnd, tailEnd).length,
      slowestUploadMsInFirstShownFrame: round(Math.max(0, ...texIn(beforeShown ?? 0, firstFramesEnd).map(([, ms]) => ms)), 2) },
    programTimeline: programsIn(t0, tailEnd).map(p => [p[0], round(p[1] - t0), p[2] === null ? null : round(p[2], 2)]),
    shownAtMs: shownTick ? round(showAt! - t0) : null, beforeShownAtMs: beforeShown === null ? null : round(beforeShown - t0),
    slowUploads: record.uploads.filter(u => inWindow(u[1], t0, tailEnd) && u[2] >= 5).map(u => ({ atMs: round(u[1] - t0), ms: round(u[2]), size: u[3], stage: stageOf(u[1]) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 12),
    progress: { quietLineOrPaneSeenFrames: progressTicks.filter(said).length, framesFrom150msToShow: progressTicks.length, longestStretchWithNothingMs: round(longestQuiet),
      linesSeen, panesSeen, fractionStart: fractions[0] ?? null, fractionEnd: fractions[fractions.length - 1] ?? null, fractionMonotone: fractions.every((f, i) => i === 0 || f >= fractions[i - 1]! - 1e-9),
      distinctFractions: new Set(fractions).size, coreDetailSeen: [...new Set(ticks.map(tick => str(tick, T.detail)).filter(Boolean))].slice(0, 6) },
  };
}


/**
 * The OS-side memory of this run's Chrome (G3's memory part): every chrome.exe whose command line names the profile folder, by process
 * type with its private bytes, and the GPU process's dedicated and shared video memory from Windows' per-process GPU counters. Read between
 * switches only: starting PowerShell is work that would blur a timing.
 */
function chromeMemory(profile: string) {
  const leaf = resolve(profile).split(/[\/]/).pop()!;
  const script = String.raw`$leaf='${leaf}'
$procs = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$leaf*" })
$rows = @(foreach ($q in $procs) {
  $type = if ($q.CommandLine -match '--type=([a-z\-]+)') { $Matches[1] } else { 'browser' }
  $g = Get-Process -Id $q.ProcessId -ErrorAction SilentlyContinue
  if ($g) { [pscustomobject]@{ pid = $q.ProcessId; type = $type; privateMB = [math]::Round($g.PrivateMemorySize64 / 1MB, 1); workingSetMB = [math]::Round($g.WorkingSet64 / 1MB, 1) } }
})
$ids = @($rows | ForEach-Object { $_.pid })
function Counter($name) { $r = @{}; try { foreach ($s in (Get-Counter "\GPU Process Memory(*)\$name" -ErrorAction Stop).CounterSamples) { if ($s.InstanceName -match 'pid_(\d+)_' -and $ids -contains [int]$Matches[1]) { $r[$Matches[1]] = [math]::Round($s.CookedValue / 1MB, 1) } } } catch {}; $r }
$ded = Counter 'Dedicated Usage'; $sh = Counter 'Shared Usage'
$out = @($rows | ForEach-Object { $_ | Add-Member -NotePropertyName dedicatedGpuMB -NotePropertyValue $ded["$($_.pid)"] -PassThru | Add-Member -NotePropertyName sharedGpuMB -NotePropertyValue $sh["$($_.pid)"] -PassThru })
$adapter = 0; try { $adapter = [math]::Round(((Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples | Measure-Object CookedValue -Sum).Sum / 1MB, 0) } catch {}
[pscustomobject]@{ rows = $out; counters = $ded.Count; adapter = $adapter } | ConvertTo-Json -Compress -Depth 4`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { stdout: "pipe", stderr: "pipe" });
  const text = result.stdout.toString().trim();
  let rows: { pid: number; type: string; privateMB: number; workingSetMB: number; dedicatedGpuMB: number | null; sharedGpuMB: number | null }[] = [];
  let counters = 0, adapter = 0;
  try { const parsed = JSON.parse(text); const list = parsed.rows; rows = Array.isArray(list) ? list : list ? [list] : []; counters = parsed.counters; adapter = parsed.adapter; } catch { return { error: (text + result.stderr.toString()).slice(0, 300) }; }
  const sum = (type: string, field: "privateMB" | "dedicatedGpuMB" | "sharedGpuMB") => round(rows.filter(r => r.type === type).reduce((total, r) => total + (r[field] ?? 0), 0));
  return { gpuProcessPrivateMB: sum("gpu-process", "privateMB"), gpuDedicatedVideoMB: sum("gpu-process", "dedicatedGpuMB"), gpuSharedVideoMB: sum("gpu-process", "sharedGpuMB"),
    rendererPrivateMB: sum("renderer", "privateMB"), browserPrivateMB: sum("browser", "privateMB"), totalPrivateMB: round(rows.reduce((total, r) => total + r.privateMB, 0)), processes: rows.length, gpuCounterInstancesMatched: counters, machineWideAdapterDedicatedMB: adapter };
}
const memories: { label: string; os: ReturnType<typeof chromeMemory>; page: unknown }[] = [];
async function remember(label: string) {
  await page.wait(1500);
  const entry = { label, os: chromeMemory(profileArg), page: await page.evaluate(`window.__g2.memory()`) };
  memories.push(entry);
  log("memory:" + label, entry);
}


type ScriptRun = { t0: number; sent: number[]; answers: string[]; idleAt: number | null; timedOut: boolean; ticks: Tick[]; strings: string[]; startKey: string | null };
/**
 * A scripted run (E, the cancel row, and F, the last-choice row) reduced to the S2 rows it speaks to: which V was shown and when, whether
 * the preparation was running when the cancel came and how soon it was over, the frames the shown runtime drew and the changes to the
 * canvas before anything else was shown (the idle is off, so none is expected), and whether a late result changed what is shown afterwards.
 */
function analyseScript(run: ScriptRun, cancelStep: number | null) {
  const { ticks, strings, t0 } = run;
  const str = (tick: Tick, field: number) => (tick[field]! >= 0 ? strings[tick[field]!]! : null);
  const shown: { key: string; atMs: number }[] = [];
  for (const tick of ticks) { const key = str(tick, T.key); if (key && shown[shown.length - 1]?.key !== key) shown.push({ key, atMs: round(tick[T.t]! - t0) }); }
  const takeover = ticks.findIndex(tick => { const key = str(tick, T.key); return key !== null && key !== run.startKey; });
  const before = takeover < 0 ? ticks : ticks.slice(0, takeover);
  let hashChanges = 0;
  for (let i = 1; i < before.length; i++) if (before[i]![10] !== before[i - 1]![10]) hashChanges++;
  const framesDelta = before[before.length - 1]![T.frames]! - before[0]![T.frames]!;
  const cancelAt = cancelStep === null ? null : run.sent[cancelStep]!;
  const preparingTicks = ticks.filter(tick => str(tick, T.stage) !== null);
  const beforeCancel = cancelAt === null ? [] : ticks.filter(tick => tick[T.t]! < cancelAt);
  const afterCancel = cancelAt === null ? null : ticks.find(tick => tick[T.t]! >= cancelAt && str(tick, T.stage) === null);
  const lateTicks = takeover < 0 ? ticks : ticks.slice(takeover + 1);
  return {
    sentAtMs: run.sent.map(at => round(at - t0)), answers: run.answers, timedOut: run.timedOut, startKey: run.startKey, shown,
    preparation: { firstSeenMs: preparingTicks[0] ? round(preparingTicks[0][T.t]! - t0) : null, lastSeenMs: preparingTicks.length ? round(preparingTicks[preparingTicks.length - 1]![T.t]! - t0) : null,
      stages: [...new Set(preparingTicks.map(tick => str(tick, T.stage)))] },
    cancel: cancelAt === null ? null : { preparingWhenCancelled: beforeCancel.length > 0 && str(beforeCancel[beforeCancel.length - 1]!, T.stage) !== null,
      cancelToPreparationOverMs: afterCancel ? round(afterCancel[T.t]! - cancelAt) : null },
    beforeTakeover: { ticks: before.length, framesDrawnByShown: framesDelta, canvasChanges: hashChanges },
    afterTakeover: { ticks: lateTicks.length, keyChanges: new Set(lateTicks.map(tick => str(tick, T.key))).size > 1 ? "changed" : "stable" },
    finalKey: shown[shown.length - 1]?.key ?? null,
  };
}

type Analysis = ReturnType<typeof analyse>;
/**
 * The gates G2 sets (README.md §5, §11): no task of 50 ms or more during preparation or in the second after the show, no link in the first
 * shown frame, and progress shown and repainting (the pane says something on every frame, and no frame is held back for long).
 */
function verdict(a: Analysis) {
  const failures: string[] = [];
  const what = a.kind === "body" ? "the new V was never shown" : "the new lighting setup never took over";
  if (a.timedOut || a.wantToShownMs === null) failures.push(what);
  if (a.longTasks.duringPreparation.count50 > 0) failures.push(`${a.longTasks.duringPreparation.count50} main-thread task(s) of ${LONG_TASK_MS} ms or more during preparation (max ${a.longTasks.duringPreparation.maxMs} ms)`);
  if (a.programs.firstShownFrame > 0) failures.push(`${a.programs.firstShownFrame} program(s) linked in the first shown frame`);
  if (a.longTasks.afterShown1s.count50 > 0) failures.push(`${a.longTasks.afterShown1s.count50} task(s) of ${LONG_TASK_MS} ms or more in the second after the show (max ${a.longTasks.afterShown1s.maxMs} ms)`);
  if (a.progress.framesFrom150msToShow > 0 && a.progress.longestStretchWithNothingMs > 500) failures.push(`the pane said nothing for ${a.progress.longestStretchWithNothingMs} ms`);
  if (a.frameGapMs.duringPreparationMax > FRAME_GAP_MS) failures.push(`no frame was presented for ${a.frameGapMs.duringPreparationMax} ms during preparation`);
  return { pass: failures.length === 0, failures };
}

try {
  console.log("waiting for the feminine default V");
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 900_000);
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.length > 0 && !e.residency.preparation; })()", 900_000);
  if (warmProfile) {
    // A profile kept from an earlier session keeps its workspace too: start from the same V and setup as a fresh one does.
    await page.evaluate(`(async () => { const runtime = window.xfStudioShell.runtime;
      await runtime.dispatch({ kind: "character.useDefault", bodyGender: "female" }); await runtime.dispatch({ kind: "preview.setLightingPreset", preset: "studio" }); })()`);
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.(); const shown = e?.residency.residents.find(r => r.state === "shown");
      return !!shown && shown.key.endsWith("|female") && !e.residency.preparation && window.xfStudioPresentation.authoring.previewState().lighting.preset === "studio"; })()`, 900_000);
  }
  await page.wait(4000);
  log("environment", await page.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2"); const info = gl.getExtension("WEBGL_debug_renderer_info");
    return { gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown", parallelShaderCompile: gl.getSupportedExtensions().includes("KHR_parallel_shader_compile"),
      userAgent: navigator.userAgent, programsAtStart: window.xfsGl.programs.length, lighting: window.xfStudioPresentation.authoring.previewState().lighting,
      setup: window.xfStudioPresentation.authoring.previewState().lightingSetups.active, residency: window.xfStudioSceneEvidence().residency }; })()`));
  const g3Rows = process.env.G3_ROWS === "1", memoryPart = process.env.G3_PART === "memory";
  if (g3Rows || memoryPart) await remember("start");
  const firstTasks = await pageRecord();
  log("start", { programsLinked: firstTasks.programs.length, longTasksSinceStart: firstTasks.long.map(([s, d]) => [Math.round(s), Math.round(d)]).slice(0, 12),
    firstFrameCpuMs: await page.evaluate(`window.xfStudioSceneEvidence().frames.cpuFrame`) });

  /** A lighting change's end: the setup asked for is drawn (taken over, nothing staged) and no preparation is in flight. */
  const lightingDone = (preset: string) => `s[${T.display}] >= 0 && strings[s[${T.display}]] === ${JSON.stringify(preset)} && s[3] < 0 && s[2] >= 1`;
  const runs: [string, "body" | "lighting", object, string, number, number, number][] = [
    // name, kind, action, done condition (on a sample [t, key, frames, stage, fraction, waiting, line, pane, phase, detail]), minimum ms, tail ms, give-up ms
    ["A.body", "body", { kind: "character.useDefault", bodyGender: "male" },
      `s[1] >= 0 && strings[s[1]].endsWith("|male") && s[3] < 0 && s[2] >= 1`, 300, 1000, 600_000],
    // Ends at the takeover (the creator setup drawn, nothing staged, no preparation), whether or not a preparation ran first.
    ["B.lighting", "lighting", { kind: "preview.setLightingPreset", preset: "creator" }, lightingDone("creator"), 300, 1000, 600_000],
    ["C.bodyAndLighting", "body", { kind: "character.useDefault", bodyGender: "female" },
      `s[1] >= 0 && strings[s[1]].endsWith("|female") && s[3] < 0 && s[2] >= 1`, 300, 1000, 600_000],
  ];
  // The trace's events go to the switch traced now (the page keeps its handlers for good, so they are added once).
  let traceSink: unknown[] | null = null, traceDone: (() => void) | null = null;
  page.on("Tracing.dataCollected", params => { traceSink?.push(...(params as { value: unknown[] }).value); });
  page.on("Tracing.tracingComplete", () => { traceDone?.(); });
  // G2_SWITCHES=<name>[,<name>…]: only those switches (a closer look at one; B and C assume the ones before them ran).
  const only = process.env.G2_SWITCHES?.split(",");
  for (const [name, kind, action, done, minMs, tailMs, maxMs] of runs) {
    if (only && !only.includes(name)) continue;
    // G2_PROFILE=1: a sampled CPU profile of each switch beside the summary (`<out>-<name>.cpuprofile`), to see what a long task did.
    const profiling = process.env.G2_PROFILE === "1";
    if (profiling) { await page.send("Profiler.enable"); await page.send("Profiler.setSamplingInterval", { interval: 500 }); await page.send("Profiler.start"); }
    // G2_TRACE=<switch name>[,<name>…] or `all`: a Chrome trace of those switches (the GPU process's shader compiles and command buffer
    // tasks, the page's tasks).
    const traceNames = (process.env.G2_TRACE ?? "").split(","), tracing = traceNames.includes(name) || traceNames.includes("all"), events: unknown[] = [];
    let traced: Promise<void> | undefined;
    if (tracing) {
      traced = new Promise<void>(complete => { traceDone = complete; });
      traceSink = events;
      // The GPU process's tasks and ANGLE's shader builds by default (each D3DCompile with its HLSL source); G2_TRACE_CATEGORIES adds the
      // page's own (`devtools.timeline,…`), at many times the size.
      await page.send("Tracing.start", { categories: process.env.G2_TRACE_CATEGORIES ?? "gpu.angle,gpu", transferMode: "ReportEvents" });
    }
    const run = await page.evaluate(`window.__g2.run(${JSON.stringify(action)}, ${JSON.stringify(done)}, ${minMs}, ${tailMs}, ${maxMs})`) as Run;
    if (profiling) {
      const { profile } = await page.send<{ profile: unknown }>("Profiler.stop");
      writeFileSync(resolve(outArg).replace(/\.json$/, `-${name}.cpuprofile`), JSON.stringify(profile));
    }
    if (tracing) {
      await page.send("Tracing.end");
      await traced;
      traceSink = null; traceDone = null;
      writeFileSync(resolve(outArg).replace(/\.json$/, `-${name}.trace.json`), JSON.stringify({ t0: run.t0, events }));
    }
    const record = await pageRecord();
    const analysis = analyse(run, record, kind);
    log(name, { ...analysis, verdict: verdict(analysis) });
    // The raw samples stay beside the summary for a closer look (an ignored folder).
    writeFileSync(resolve(outArg).replace(/\.json$/, `-${name}-ticks.json`), JSON.stringify({ strings: run.strings, fields: Object.keys(T), t0: run.t0, ticks: run.ticks.map(tick => tick.map((v, i) => i === 0 ? round(v! - run.t0, 2) : v)) }));
    await page.wait(3000);
    if (g3Rows || memoryPart) await remember("after " + name);
  }
  const bodyAction = (bodyGender: string) => ({ kind: "character.useDefault", bodyGender });
  const bodyDone = (bodyGender: string) => `s[1] >= 0 && strings[s[1]].endsWith("|${bodyGender}") && s[3] < 0 && s[2] >= 1`;
  /** Switch body and wait for it to be shown and the preparation over; the run's analysis. */
  const switchBody = async (bodyGender: string, tailMs = 1000) => {
    const run = await page.evaluate(`window.__g2.run(${JSON.stringify(bodyAction(bodyGender))}, ${JSON.stringify(bodyDone(bodyGender))}, 300, ${tailMs}, 600000)`) as Run;
    return { run, analysis: analyse(run, await pageRecord(), "body") };
  };
  /** Change the lighting preset and wait at least `minMs` and for the preparation to end. */
  const switchLighting = async (preset: string, minMs = 4000) => {
    const run = await page.evaluate(`window.__g2.run(${JSON.stringify({ kind: "preview.setLightingPreset", preset })}, ${JSON.stringify(lightingDone(preset))}, ${minMs}, 500, 600000)`) as Run;
    return { run, analysis: analyse(run, await pageRecord(), "lighting") };
  };
  if (g3Rows) {
    // D. Eight body switches in a row, as the S2 table's warm switch: want to the first presented frame, 100 ms at most for a runtime that
    // is warm and prepared. A switch that had to prepare the other body again for the setup shown is counted apart.
    const bodies = ["male", "female", "male", "female", "male", "female", "male", "female"];
    const warm: Record<string, unknown>[] = [];
    for (const [i, body] of bodies.entries()) {
      const { analysis } = await switchBody(body);
      const prepared = analysis.stages.length > 0;
      warm.push({ i: i + 1, body, preparedAgain: prepared, wantToShownMs: analysis.wantToShownMs, wantToFirstPresentedMs: analysis.wantToFirstPresentedMs, timedOut: analysis.timedOut,
        longTasks50: analysis.longTasks.total.count50, maxTaskMs: analysis.longTasks.total.maxMs, linksInFirstShownFrame: analysis.programs.firstShownFrame, frameGapMaxMs: analysis.frameGapMs.allMax,
        linkNames: analysis.programs.firstShownFrameNames, linkWaitMaxMs: analysis.programs.firstUseWaitMaxMs.firstShownFrame,
        stages: analysis.stages.map(stage => stage.stage), verdict: verdict(analysis) });
      await page.wait(1000);
    }
    const warmOnly = warm.filter(row => !row.preparedAgain);
    const warmMax = Math.max(0, ...warmOnly.map(row => row.wantToFirstPresentedMs as number));
    log("D.warmSwitches", { switches: warm, warmCount: warmOnly.length, warmWantToFirstPresentedMaxMs: warmMax,
      latencyPass: warmOnly.length > 0 && warmOnly.every(row => row.wantToFirstPresentedMs !== null && (row.wantToFirstPresentedMs as number) <= 100),
      noLinkInFirstShownFramePass: warm.every(row => row.linksInFirstShownFrame === 0), switchesWithALink: warm.filter(row => row.linksInFirstShownFrame !== 0).length,
      pass: warmOnly.length > 0 && warmOnly.every(row => row.wantToFirstPresentedMs !== null && (row.wantToFirstPresentedMs as number) <= 100 && (row.verdict as { pass: boolean }).pass) });
    await remember("after D");
    // E and F watch the canvas, so the idle goes off (nothing then draws but a change of what is shown).
    await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "motion.setIdle", enabled: false })`);
    await page.wait(1500);
    // A lost and restored context drops the warm runtime first (D2), so the other body is asked for from nothing: built and prepared, which takes seconds.
    const dropWarm = async () => {
      await page.evaluate(`(async () => { const gl = document.querySelector("#device-head canvas").getContext("webgl2"); const ext = gl.getExtension("WEBGL_lose_context");
        ext.loseContext(); await new Promise(r => setTimeout(r, 300)); ext.restoreContext(); })()`);
      await page.wait(2000);
      await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && !e.residency.preparation && window.xfStudioPresentation.viewport.snapshot().head.phase === 'ready'; })()", 300_000);
      await page.wait(3000);
    };
    await dropWarm();
    const residentsBefore = await page.evaluate(`window.xfStudioSceneEvidence().residency.residents.map(r => r.key + ":" + r.state)`);
    const e = await page.evaluate(`window.__g2.script(${JSON.stringify([[0, bodyAction("male")], [150, bodyAction("female")]])}, 2500, 5000, 600000)`) as ScriptRun;
    const eAnalysis = analyseScript(e, 1);
    const ePass = !eAnalysis.timedOut && !!eAnalysis.cancel?.preparingWhenCancelled && (eAnalysis.cancel.cancelToPreparationOverMs ?? 1e9) <= 100 && eAnalysis.shown.length === 1
      && eAnalysis.beforeTakeover.framesDrawnByShown === 0 && eAnalysis.beforeTakeover.canvasChanges === 0 && eAnalysis.afterTakeover.keyChanges === "stable";
    log("E.cancel", { residentsBefore, ...eAnalysis, pass: ePass });
    writeFileSync(resolve(outArg).replace(/\.json$/, "-E-ticks.json"), JSON.stringify({ strings: e.strings, t0: e.t0, ticks: e.ticks.map(tick => tick.map((v, i) => i === 0 ? round(v! - e.t0, 2) : v)) }));
    await page.wait(1000);
    await dropWarm();
    const f = await page.evaluate(`window.__g2.script(${JSON.stringify([[0, bodyAction("male")], [120, bodyAction("female")], [240, bodyAction("male")]])}, 1000, 5000, 600000)`) as ScriptRun;
    const fAnalysis = analyseScript(f, null);
    const fPass = !fAnalysis.timedOut && fAnalysis.shown.length === 2 && !!fAnalysis.finalKey?.endsWith("|male") && fAnalysis.beforeTakeover.canvasChanges === 0 && fAnalysis.afterTakeover.keyChanges === "stable";
    log("F.lastChoice", { ...fAnalysis, pass: fPass });
    writeFileSync(resolve(outArg).replace(/\.json$/, "-F-ticks.json"), JSON.stringify({ strings: f.strings, t0: f.t0, ticks: f.ticks.map(tick => tick.map((v, i) => i === 0 ? round(v! - f.t0, 2) : v)) }));
    await remember("after F");
  }
  if (memoryPart) {
    // The memory part: what the page and the GPU process hold after cycles of warm body switches and of setup changes. Both bodies are
    // resident (the shown one and one warm): a leak shows as growth from cycle to cycle, the warm one's cost as the step from "start".
    for (let cycle = 1; cycle <= 10; cycle++) {
      await switchBody("male", 500); await switchBody("female", 500);
      if (cycle === 1 || cycle % 3 === 0) await remember(`after ${cycle} body cycle${cycle > 1 ? "s" : ""}`);
    }
    for (let cycle = 1; cycle <= 4; cycle++) {
      await switchLighting("studio"); await switchLighting("creator");
      if (cycle === 1 || cycle === 4) await remember(`after ${cycle} lighting cycle${cycle > 1 ? "s" : ""}`);
    }
    await page.wait(10_000);
    await remember("after 10 s idle");
    // Informational: a lost and restored context drops the warm runtime first (D2); what the GPU process holds afterwards, rebuilt, is the shown one alone.
    try {
      await page.evaluate(`(async () => { const gl = document.querySelector("#device-head canvas").getContext("webgl2"); const ext = gl.getExtension("WEBGL_lose_context");
        ext.loseContext(); await new Promise(r => setTimeout(r, 500)); ext.restoreContext(); })()`);
      await page.wait(3000);
      await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && !e.residency.preparation && window.xfStudioPresentation.viewport.snapshot().head.phase === 'ready'; })()", 300_000);
      await page.wait(3000);
      await remember("after a lost and restored context");
    } catch (error) { log("contextLossError", String(error)); }
  }
  log("memories", memories);
  log("console", page.console.filter(entry => /error|exception/i.test(entry.type)).slice(0, 20));
  log("gpuAtEnd", await page.evaluate(`window.xfStudioSceneEvidence().residency`));
  out.durationS = round((Date.now() - started) / 1000);
  save();
} catch (error) {
  log("error", String((error as Error)?.stack ?? error));
  log("console", page.console.slice(-30));
} finally {
  await page.close();
}
