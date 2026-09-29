/**
 * A hairstyle switch end to end in the page (PREV-189, research/backlog/performance.md): a headless Chrome (GPU through ANGLE, a
 * fresh profile, so no program binary is cached) opens an already running isolated server's `?verify=1` workspace and, for each
 * hairstyle index given, switches to it, resets, and switches to it again. Each change reports the page's `xfs:character:*` marks
 * (ask, answer, record, loaded, placed, frame), the main thread's long tasks, the longest gap between animation frames, and the
 * programs linked and textures uploaded after the click (gl-probe.ts). Offline measurements, not game evidence.
 *
 *   bun tools/measure-hairstyle-switch.ts [port] [index,index,...]
 *
 * An index the host never prepared measures a cold switch (the host log's preparation line breaks it down: reads, WolvenKit,
 * native decodes, layer maps); one prepared by an earlier page measures a warm switch that is new to this page; the repeat
 * measures a part the page shows again. `XFS_MEASURE_HOVER=<ms>` opens the Character row (3 s before the first switch) and rests the
 * pointer on each choice that long before choosing it (`characterPrefetch` with it as the focus), so its parts load ahead (PREV-189). `XFS_MEASURE_PROFILE_OUT=<file>` writes a page
 * CPU profile of the first switch (private, keep it out of the repository). Start the server first with its own port, `XFAS_DATA_DIR` and `XFS_SETTINGS_DIR` (never 4317).
 */
import { resolve } from "node:path";
import { launch } from "./cdp";
import { GL_PROBE, glSummary } from "./gl-probe";

const [portArg = "4491", indexArg = "8"] = process.argv.slice(2);
const port = Number(portArg), indexes = indexArg.split(",").map(Number);
if (port === 4317) throw Error("Never measure against the person's own server (4317).");
const P = "window.xfStudioPresentation";
const status = `${P}.snapshot().status?.assets?.characterDetails`;

const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1100, height: 750, init: GL_PROBE });
try {
  await page.waitFor(`${status}?.phase === 'ready' && !${status}.updating`, 600_000);
  await page.wait(3000);
  const choices = await page.evaluate(`(async () => {
    const a = ${P}.authoring;
    for (let i = 0; i < 100; i++) { const c = a.characterChoices("head/hairstyle", { offset: 0, limit: 80 }, ""); if (!c.loading) return c.choices; await new Promise(r => setTimeout(r, 100)); }
    return null; })()`) as { key: string; activates?: string[] }[];
  const set = (c: { key: string; activates?: string[] }) =>
    ({ kind: "character.setOption", part: "head", option: "hairstyle", choice: c.key, ...(c.activates ? { activates: c.activates } : {}) });
  const measure = (actions: object[]) => page.evaluate(`(async () => {
    for (const s of ["ask", "answer", "record", "loaded", "prepared", "placed", "frame"]) performance.clearMarks("xfs:character:" + s);
    performance.clearResourceTimings();
    const long = [], frames = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) long.push(e); });
    observer.observe({ type: "longtask" });
    let running = true;
    const tick = t => { frames.push(t); if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    for (const action of ${JSON.stringify(actions)}) ${P}.authoring.dispatch(action);
    let settled = null;
    while (performance.now() < t0 + 180000) {
      await new Promise(r => setTimeout(r, 5));
      const s = ${status};
      const framesMarked = performance.getEntriesByName("xfs:character:frame"), placed = performance.getEntriesByName("xfs:character:placed");
      if (s?.phase === "ready" && !s.updating && framesMarked.length && framesMarked.at(-1).startTime > (placed.at(-1)?.startTime ?? 0)) { settled = framesMarked.at(-1).startTime; break; }
      if (s?.updateError || s?.phase === "failed") { settled = -1; break; }
    }
    await new Promise(r => setTimeout(r, 300));
    running = false; observer.disconnect();
    let gap = 0, gapAt = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] > gap) { gap = frames[i] - frames[i - 1]; gapAt = frames[i - 1] - t0; }
    const marks = performance.getEntriesByType("mark").filter(m => m.name.startsWith("xfs:character:")).map(m => [m.name.slice(14), Math.round(m.startTime - t0)]);
    return { total: settled === null ? null : settled < 0 ? "failed" : Math.round(settled - t0), marks,
      longTasks: long.filter(e => e.startTime >= t0 - 1).map(e => [Math.round(e.startTime - t0), Math.round(e.duration)]),
      maxFrameGap: [Math.round(gap), Math.round(gapAt)], gl: ${glSummary("t0")},
      files: performance.getEntriesByType("resource").filter(r => r.name.includes("/assets/character/")).map(r => [r.name.split(".").pop(), Math.round(r.startTime - t0), Math.round(r.duration), Math.round((r.decodedBodySize || 0) / 1024)]) };
  })()`);
  let first = true;
  const hover = Number(process.env.XFS_MEASURE_HOVER ?? 0);
  for (const index of indexes) {
    const choice = choices[index];
    if (!choice) throw Error(`No hairstyle at ${index}.`);
    if (hover > 0) {
      // The row opened a moment before (its choices' states known), then the pointer on the choice: the panel asks about the row's
      // choices with it as the focus (character.ts).
      if (first) {
        await page.evaluate(`${P}.authoring.characterPrefetch("head/hairstyle", Array.from({ length: 80 }, (_, i) => i), null)`);
        for (let i = 0; i < 15; i++) { await page.wait(200); await page.evaluate(`${P}.authoring.characterPrefetch("head/hairstyle", Array.from({ length: 80 }, (_, i) => i), null)`); }
      }
      await page.evaluate(`${P}.authoring.characterPrefetch("head/hairstyle", Array.from({ length: 80 }, (_, i) => i), ${index})`);
      const until = Date.now() + hover;
      while (Date.now() < until) { await page.wait(200); await page.evaluate(`${P}.authoring.characterPrefetch("head/hairstyle", Array.from({ length: 80 }, (_, i) => i), null)`); }
    }
    for (const [label, actions] of [[`hairstyle ${index}`, [set(choice)]], ["reset all", [{ kind: "character.resetAll" }]],
      [`hairstyle ${index} again`, [set(choice)]], ["reset all", [{ kind: "character.resetAll" }]]] as [string, object[]][]) {
      const profile = first && !!process.env.XFS_MEASURE_PROFILE_OUT;
      if (profile) { await page.send("Profiler.enable"); await page.send("Profiler.setSamplingInterval", { interval: 200 }); await page.send("Profiler.start"); }
      const result = await measure(actions) as object;
      if (profile) {
        const { profile: data } = await page.send<{ profile: unknown }>("Profiler.stop");
        await Bun.write(resolve(process.env.XFS_MEASURE_PROFILE_OUT!), JSON.stringify(data));
      }
      first = false;
      console.log(JSON.stringify({ label, choice: choice.key, ...result }));
      await page.wait(1000);
    }
  }
} finally {
  await page.close();
}
