/**
 * A restart to the player's own V, end to end (research/backlog/performance.md, "Restart, warm caches → own V complete < 2 s"): starts
 * an isolated server on its own port with caches kept in one folder, opens its `?verify=1` workspace in a headless GPU Chrome whose
 * profile is kept too (its GPU program cache and page storage survive, as an installed app's do), and times, from the page's start:
 * first paint, the head scene loaded, the character details' answer, record, parts loaded and placed, and the first frame with the
 * whole V. The host's own lines (its preparation breakdown) are printed with their time after the server was started. Then it stops
 * both and starts again, `runs` times; the first run of an empty folder is the cold one. Offline measurements, not game evidence.
 *
 *   bun tools/measure-warm-restart.ts <folder> [port] [runs]
 *
 * `<folder>` holds everything the server keeps (data, preview, resolver and choice preview caches, the Chrome profile); private, keep it
 * outside the repository. Its `data/settings.json` is copied from the installed settings the first time. `XFS_MEASURE_SERVER_ONLY=1`
 * starts only the server (to time the host's own start and preparation). Never port 4317.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "./cdp";
import { localSettingsDirectory } from "../src/local-settings-store";

const [folderArg, portArg = "4493", runsArg = "3"] = process.argv.slice(2);
if (!folderArg) throw Error("Usage: bun tools/measure-warm-restart.ts <folder> [port] [runs]");
const folder = resolve(folderArg), port = Number(portArg), runs = Number(runsArg);
if (port === 4317) throw Error("Never measure against the person's own server (4317).");
const root = resolve(import.meta.dir, "..");
const data = join(folder, "data");
mkdirSync(data, { recursive: true });
const settings = join(localSettingsDirectory(), "settings.json");
if (!existsSync(join(data, "settings.json")) && existsSync(settings)) copyFileSync(settings, join(data, "settings.json"));

/** Records, in the page, when the head scene and the character details change state (performance.now() times). */
const TIMELINE = `(() => {
  const seen = window.__xfsTimeline = [];
  let last = "";
  const tick = () => {
    try {
      const s = window.xfStudioPresentation?.snapshot().status?.assets;
      const c = s?.characterDetails;
      const now = s ? JSON.stringify({ head: s.loaded, phase: c?.phase ?? null, updating: !!c?.updating, source: c?.source ?? null }) : "";
      if (now !== last) { seen.push([Math.round(performance.now()), now]); last = now; }
    } catch {}
  };
  setInterval(tick, 10);
})();`;

const env = { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off",
  XFS_PREVIEW_CORE_CACHE: join(folder, "preview-cache"), XFS_RESOLVER_CACHE: join(folder, "resolver-cache"),
  XFS_CHOICE_PREVIEW_CACHE: join(folder, "choice-previews"), XFS_PREPARED_BUDGET_GB: "off" };

for (let run = 1; run <= runs; run++) {
  const started = performance.now();
  const lines: string[] = [];
  const server = Bun.spawn(["bun", "server.ts"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of stream) {
      rest += decoder.decode(chunk, { stream: true });
      const parts = rest.split(/\r?\n/); rest = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) lines.push(`${((performance.now() - started) / 1000).toFixed(2)} s  ${line.slice(0, 400)}`);
    }
  };
  void pump(server.stdout as ReadableStream<Uint8Array>); void pump(server.stderr as ReadableStream<Uint8Array>);
  let health = -1;
  for (let i = 0; i < 2400; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { health = performance.now() - started; break; } } catch { /* starting */ }
    await Bun.sleep(25);
  }
  if (health < 0) { server.kill(); throw Error("The server did not start"); }
  const result: Record<string, unknown> = { run, serverHealthMs: Math.round(health) };
  if (process.env.XFS_MEASURE_SERVER_ONLY === "1") {
    await Bun.sleep(15_000);
  } else {
    const pageAsked = performance.now() - started;
    const page = await launch("about:blank", { width: 1400, height: 900, init: TIMELINE, profile: join(folder, "chrome") });
    const profileOut = process.env.XFS_MEASURE_PROFILE_OUT;
    if (profileOut) { await page.send("Profiler.enable"); await page.send("Profiler.setSamplingInterval", { interval: 200 }); await page.send("Profiler.start"); }
    const navigated = performance.now() - started;
    await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/?verify=1` });
    try {
      const status = "window.xfStudioPresentation?.snapshot().status?.assets?.characterDetails";
      // Complete: details ready and not updating, and a frame drawn after the last placement.
      await page.waitFor(`(() => { const s = ${status}; const f = performance.getEntriesByName("xfs:character:frame"), p = performance.getEntriesByName("xfs:character:placed");
        return s?.phase === 'ready' && !s.updating && f.length && f.at(-1).startTime > (p.at(-1)?.startTime ?? 0); })()`, 600_000);
      const page_ = await page.evaluate(`(() => {
        const paint = Object.fromEntries(performance.getEntriesByType("paint").map(e => [e.name, Math.round(e.startTime)]));
        const nav = performance.getEntriesByType("navigation")[0];
        const marks = performance.getEntriesByType("mark").filter(m => m.name.startsWith("xfs:character:")).map(m => m.name.slice(14) + "@" + Math.round(m.startTime));
        const all = performance.getEntriesByType("resource");
        const parts = all.filter(r => r.name.includes("/assets/character/"));
        const resources = all.filter(r => !r.name.includes("/assets/character/"))
          .map(r => [r.name.replace(/^https?:\\/\\/[^/]+/, "").slice(0, 70), Math.round(r.startTime), Math.round(r.responseEnd), r.encodedBodySize]);
        return { paint, domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? -1), load: Math.round(nav?.loadEventEnd ?? -1),
          timeline: window.__xfsTimeline, marks, parts: parts.length ? [parts.length, Math.round(Math.min(...parts.map(r => r.startTime))),
            Math.round(Math.max(...parts.map(r => r.responseEnd))), parts.reduce((n, r) => n + r.encodedBodySize, 0)] : null, firstRequests: resources };
      })()`);
      Object.assign(result, { pageAskedMs: Math.round(pageAsked), navigatedMs: Math.round(navigated) }, page_);
      if (profileOut) { const { profile } = await page.send<{ profile: unknown }>("Profiler.stop"); await Bun.write(`${profileOut}.${run}.cpuprofile`, JSON.stringify(profile)); }
    } finally { await page.close(); }
  }
  server.kill();
  await server.exited;
  const { firstRequests, ...rest } = result as { firstRequests?: unknown[] };
  console.log(JSON.stringify(rest));
  for (const request of firstRequests ?? []) console.log("  " + JSON.stringify(request));
  console.log(lines.slice(0, 80).join("\n"));
  await Bun.sleep(1000);
}
