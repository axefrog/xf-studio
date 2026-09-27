/**
 * Click → pixels for changes on the V, measured in the page (research/backlog/performance.md): a headless Chrome (GPU through ANGLE)
 * opens an already running isolated server's `?verify=1` workspace, dispatches Character panel actions and reads the page's
 * `xfs:character:*` marks (character-timing.ts) and resource timings for each. Offline measurements, not game evidence.
 *
 *   bun tools/measure-character-page.ts [port] [rounds] [save copy]
 *
 * `XFS_MEASURE_PROFILE=<label>` writes a page CPU profile of that change in the first round (`XFS_MEASURE_PROFILE_OUT`, default
 * `page.cpuprofile`; private, keep it out of the repository).
 * `XFS_MEASURE_PREFETCH=<option id>` keeps that row's choices being prepared ahead throughout (a row left open).
 * With a save copy (private: keep it outside the repository), its V is loaded first and measured instead of the default V.
 *
 * Start the server first with its own port, `XFAS_DATA_DIR` and `XFS_SETTINGS_DIR` (never 4317). Each round runs: hairstyle 12,
 * hairstyle 01, a hair colour, makeup on (four rows in one step), hiding and showing the V's own makeup (a viewing setting), reset all, and a burst (three hairstyles dispatched
 * back to back, then reset all). The first round may include the host's own first preparations; later rounds show prepared changes.
 */
import { resolve } from "node:path";
import { launch } from "./cdp";

const [portArg = "4487", roundsArg = "2", save] = process.argv.slice(2);
const port = Number(portArg), rounds = Number(roundsArg);
if (port === 4317) throw Error("Never measure against the person's own server (4317).");

const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 900, debugPort: port + 5000 });
const status = "window.xfStudioPresentation?.snapshot().status?.assets?.characterDetails";
try {
  await page.waitFor(`${status}?.phase === 'ready' && !${status}.updating`, 600_000);
  await page.wait(1500);
  const prefetch = process.env.XFS_MEASURE_PREFETCH;
  if (prefetch) {
    // A Character panel row kept open: the page asks about its choices about every second, so the host prepares them ahead.
    await page.evaluate(`setInterval(() => window.xfStudioPresentation.authoring.characterPrefetch(${JSON.stringify(prefetch)},
      Array.from({ length: 24 }, (_, i) => i), null), 1000)`);
  }
  if (save) {
    await page.chooseFiles([resolve(save)]);
    // A file chooser only opens with user activation; mark this evaluation as a user gesture.
    await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`,
      awaitPromise: true, userGesture: true });
    await page.waitFor(`${status}?.source === 'save' && ${status}?.phase === 'ready' && !${status}.updating`, 600_000);
    await page.wait(3000);
    console.log(JSON.stringify({ loaded: "save", slots: await page.evaluate(`${status}.slots.map(s => s.slot + ":" + s.state)`) }));
  }

  /**
   * A viewing change (the V's own makeup shown or hidden) prepares nothing: the time to the second animation frame after it, by which
   * the scene has drawn it.
   */
  const measureView = (actions: object[]) => page.evaluate(`(async () => {
    const a = window.xfStudioPresentation.authoring;
    const t0 = performance.now();
    for (const action of ${JSON.stringify(actions)}) a.dispatch(action);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { total: Math.round(performance.now() - t0), marks: [], view: true };
  })()`);
  /** Dispatch actions (several: back to back, a burst) and wait until the V shows the last with a drawn frame. */
  const measure = (label: string, actions: object[]) => page.evaluate(`(async () => {
    const stages = ["ask", "answer", "record", "loaded", "placed", "frame"];
    for (const s of stages) performance.clearMarks("xfs:character:" + s);
    performance.clearResourceTimings();
    const a = window.xfStudioPresentation.authoring;
    const long = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) long.push(e); });
    try { observer.observe({ type: "longtask" }); } catch {}
    const t0 = performance.now();
    for (const action of ${JSON.stringify(actions)}) a.dispatch(action);
    const statusNow = () => ${status};
    const deadline = t0 + 120000;
    let settled = null;
    while (performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 5));
      const s = statusNow();
      const frames = performance.getEntriesByName("xfs:character:frame");
      const placed = performance.getEntriesByName("xfs:character:placed");
      if (s?.phase === "ready" && !s.updating && frames.length && frames.at(-1).startTime > (placed.at(-1)?.startTime ?? 0)) { settled = frames.at(-1).startTime; break; }
      if (s?.updateError || s?.phase === "failed") { settled = -1; break; }
    }
    observer.disconnect();
    const marks = performance.getEntriesByType("mark").filter(m => m.name.startsWith("xfs:character:"))
      .map(m => [m.name.slice(14), Math.round(m.startTime - t0), m.detail ?? null]);
    const resources = performance.getEntriesByType("resource").filter(r => r.name.includes("/api/preview-character") || r.name.includes("/assets/character/"));
    const assets = resources.filter(r => r.name.includes("/assets/character/"));
    return { total: settled === null ? null : settled < 0 ? "failed: " + (statusNow()?.updateError ?? statusNow()?.message) : Math.round(settled - t0), marks,
      longTasks: long.filter(e => e.startTime >= t0).map(e => [Math.round(e.startTime - t0), Math.round(e.duration)]),
      host: resources.filter(r => !r.name.includes("/assets/character/") || r.name.endsWith(".json"))
        .map(r => (r.name.includes("/assets/") ? "record" : new URL(r.name).pathname.split("/").pop() + (r.name.includes("?key=") ? "?poll" : "") + ":" + r.initiatorType) + "@" + Math.round(r.startTime - t0) + "+" + Math.round(r.duration)),
      assets: assets.length, assetBytes: assets.reduce((n, r) => n + (r.decodedBodySize || 0), 0) };
  })()`);

  const choice = async (option: string, index: number) => page.evaluate(`(async () => {
    const a = window.xfStudioPresentation.authoring;
    for (let i = 0; i < 50; i++) { const c = a.characterChoices(${JSON.stringify(option)}, { offset: 0, limit: 40 }, ""); if (!c.loading) return c.choices[${index}]; await new Promise(r => setTimeout(r, 100)); }
    return null;
  })()`) as Promise<{ key: string; activates?: string[] } | null>;
  const set = (option: string, c: { key: string; activates?: string[] }) =>
    ({ kind: "character.setOption", part: "head", option: option.split("/")[1], choice: c.key, ...(c.activates ? { activates: c.activates } : {}) });

  const h12 = (await choice("head/hairstyle", 11))!, h01 = (await choice("head/hairstyle", 0))!, h05 = (await choice("head/hairstyle", 4))!,
    h07 = (await choice("head/hairstyle", 6))!, colour = (await choice("head/hair_color1", 3))!;
  const makeup = await Promise.all(["head/makeupEyes", "head/makeupLips", "head/makeupCheeks", "head/makeupPimples"].map(async id => [id, (await choice(id, 1))!] as const));
  const lipsType = (await choice("head/makeupLips_type", 1))!;
  const makeupOn = { kind: "character.setOptions", label: "Makeup on", changes: [set("head/makeupLips_type", lipsType), ...makeup.map(([id, c]) => set(id, c))]
    .map(({ kind: _, ...change }) => change) };

  const results: Record<string, unknown>[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (const [label, actions] of [
      ["hairstyle 12", [set("head/hairstyle", h12)]],
      ["hairstyle 01", [set("head/hairstyle", h01)]],
      ["hair colour", [set("head/hair_color1", colour)]],
      ["makeup on", [makeupOn]],
      ["hide own makeup (viewing)", [{ kind: "character.setOwnMakeup", shown: false }]],
      ["show own makeup (viewing)", [{ kind: "character.setOwnMakeup", shown: true }]],
      ["reset all", [{ kind: "character.resetAll" }]],
      ["burst 05→07→12", [set("head/hairstyle", h05), set("head/hairstyle", h07), set("head/hairstyle", h12)]],
      ["reset all after burst", [{ kind: "character.resetAll" }]],
    ] as [string, object[]][]) {
      const profile = process.env.XFS_MEASURE_PROFILE === label && round === 1;
      if (profile) { await page.send("Profiler.enable"); await page.send("Profiler.setSamplingInterval", { interval: 200 }); await page.send("Profiler.start"); }
      const result = await (label.endsWith("(viewing)") ? measureView(actions) : measure(label, actions)) as Record<string, unknown>;
      if (profile) {
        const { profile: data } = await page.send<{ profile: unknown }>("Profiler.stop");
        const out = resolve(process.env.XFS_MEASURE_PROFILE_OUT ?? "page.cpuprofile");
        await Bun.write(out, JSON.stringify(data));
        console.log(JSON.stringify({ profiled: label, out }));
      }
      results.push({ round, label, ...result });
      console.log(JSON.stringify({ round, label, ...result }));
      await page.wait(800);
    }
  }
} finally {
  await page.close();
}
