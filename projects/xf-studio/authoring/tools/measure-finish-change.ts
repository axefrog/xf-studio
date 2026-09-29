/**
 * Click → pixels for a finish change on eye makeup (PREV-188), measured in the page (research/backlog/performance.md): a headless
 * Chrome (GPU through ANGLE, a fresh profile per scenario, so no program binary is cached) opens an already running isolated server's
 * `?verify=1` workspace, puts the first layer on Matte, then selects a finish (default Colour-shifting) and records every main-thread
 * long task (the long-task observer), the longest gap between animation frames, when the selection shows and when the plate draws it.
 * Offline measurements, not game evidence.
 *
 *   bun tools/measure-finish-change.ts [port] [finish] [hairstyle index]
 *
 * Without a hairstyle index the finish is selected alone; with one, just after that hairstyle is asked for (a hairstyle change loading
 * beside it). `XFS_MEASURE_PROFILE_OUT=<file>` writes a page CPU profile of the change (private, keep it out of the repository). Start the server first with its own port, `XFAS_DATA_DIR` and `XFS_SETTINGS_DIR` (never 4317).
 */
import { resolve } from "node:path";
import { launch } from "./cdp";
import { GL_PROBE, glSummary } from "./gl-probe";

const [portArg = "4491", finish = "iridescent", hairArg] = process.argv.slice(2);
const port = Number(portArg);
if (port === 4317) throw Error("Never measure against the person's own server (4317).");
const P = "window.xfStudioPresentation", EM = `${P}.feature('eye-makeup')`;
const status = `${P}.snapshot().status?.assets?.characterDetails`;

async function scenario(label: string, hairstyle: number | null, profileOut?: string) {
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1100, height: 750, init: GL_PROBE });
  try {
    await page.waitFor(`!!${EM}?.view?.()?.recipe && ${status}?.phase === 'ready' && !${status}.updating && !!window.xfStudioSceneEvidence?.()?.plateBlend`, 600_000);
    await page.evaluate(`(() => { const f = ${EM}, layer = f.view().recipe().layers[0];
      f.dispatch({ kind: 'layer.select', layerId: layer.id }); f.dispatch({ kind: 'layer.setFinish', layerId: layer.id, finish: 'matte' }); })()`);
    await page.wait(4000);
    const hair = hairstyle === null ? null : await page.evaluate(`(async () => {
      const a = ${P}.authoring;
      for (let i = 0; i < 100; i++) { const c = a.characterChoices("head/hairstyle", { offset: 0, limit: 60 }, ""); if (!c.loading) return c.choices[${hairstyle}]; await new Promise(r => setTimeout(r, 100)); }
      return null; })()`) as { key: string; activates?: string[] } | null;
    if (profileOut) { await page.send("Profiler.enable"); await page.send("Profiler.setSamplingInterval", { interval: 200 }); await page.send("Profiler.start"); }
    const result = await page.evaluate(`(async () => {
      const f = ${EM}, layer = f.view().layer();
      const long = [], frames = [];
      const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) long.push(e); });
      observer.observe({ type: "longtask" });
      let running = true;
      const tick = t => { frames.push(t); if (running) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      for (const s of ["ask", "answer", "record", "loaded", "prepared", "placed", "frame"]) performance.clearMarks("xfs:character:" + s);
      const hair = ${JSON.stringify(hair)};
      const t0 = performance.now();
      if (hair) ${P}.authoring.dispatch({ kind: "character.setOption", part: "head", option: "hairstyle", choice: hair.key, ...(hair.activates ? { activates: hair.activates } : {}) });
      const tClick = performance.now();
      f.dispatch({ kind: "layer.setFinish", layerId: layer.id, finish: ${JSON.stringify(finish)} });
      const tDispatched = performance.now();
      const selected = f.view().layer().finish === ${JSON.stringify(finish)} ? tDispatched - tClick : null;
      // Pixels: the first animation frame after the plate is set up for the finish (the plate evidence's route follows the layer).
      let shown = null;
      const evidence = () => window.xfStudioSceneEvidence?.()?.plateBlend;
      const want = ${JSON.stringify(finish)} === "iridescent" ? (e => e?.plate?.fresnel === true) : (e => true);
      const deadline = tClick + 20000;
      while (performance.now() < deadline) {
        await new Promise(r => requestAnimationFrame(r));
        if (shown === null && want(evidence())) { await new Promise(r => requestAnimationFrame(r)); shown = performance.now() - tClick; }
        const s = ${status};
        const hairDone = !hair || (s?.phase === "ready" && !s.updating && performance.getEntriesByName("xfs:character:frame").length);
        if (shown !== null && hairDone && performance.now() - tClick > 3000) break;
      }
      await new Promise(r => setTimeout(r, 500));
      running = false; observer.disconnect();
      let gap = 0, gapAt = 0;
      for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] > gap) { gap = frames[i] - frames[i - 1]; gapAt = frames[i - 1] - tClick; }
      const marks = performance.getEntriesByType("mark").filter(m => m.name.startsWith("xfs:character:")).map(m => [m.name.slice(14), Math.round(m.startTime - tClick)]);
      return { selectedMs: selected === null ? null : +selected.toFixed(1), dispatchMs: +(tDispatched - tClick).toFixed(1), shownMs: shown === null ? null : Math.round(shown),
        longTasks: long.filter(e => e.startTime >= t0 - 1).map(e => [Math.round(e.startTime - tClick), Math.round(e.duration)]),
        maxFrameGap: [Math.round(gap), Math.round(gapAt)], frames: frames.length, hairMarks: marks,
        over50: long.filter(e => e.startTime >= t0 - 1 && e.duration > 50).length, gl: ${glSummary("tClick")} };
    })()`);
    if (profileOut) {
      const { profile } = await page.send<{ profile: unknown }>("Profiler.stop");
      await Bun.write(resolve(profileOut), JSON.stringify(profile));
    }
    console.log(JSON.stringify({ label, finish, ...(result as object) }));
  } finally { await page.close(); }
}

// One scenario per run (one Chrome at a time keeps the run inside a small memory budget).
if (hairArg === undefined) await scenario(`${finish} alone`, null, process.env.XFS_MEASURE_PROFILE_OUT);
else await scenario(`${finish} with hairstyle ${hairArg} loading`, Number(hairArg), process.env.XFS_MEASURE_PROFILE_OUT);
