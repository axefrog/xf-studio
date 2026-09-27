/**
 * Captures and costs of choice previews phase 2 (research/character-customization/choice-previews-design.md §7, §10) in an isolated
 * `?verify=1` workspace with a throwaway Chrome profile, against an authoring server already running on its own port (never 4317 or the
 * person's draft). For each scheme and panel width, the Hairstyle row in list and details, grid L with a tile turning on hover and one
 * caught mid-drag, and the details picture mid-drag; then the costs: each turntable strip drawn (worker timings, bytes), the wait from
 * hovering to the strip and to the first turn shown, the page's heap, and a click made while a strip is being drawn against one made idle.
 *
 *   bun tools/choice-layouts-look.ts <out dir under evidence/screenshots> [port] [--schemes light,dark] [--widths 300,480] [--tag after] [--hovers 10] [--skip 0] [--clicks | --clicks-only | --gate | --spin-m]
 *
 * The rows show installed mods' hairstyles, so keep the outputs in the ignored evidence/screenshots tree. It changes the verify workspace's
 * picture layout preferences (its own state), never the person's draft.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, type Session } from "./cdp";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const [outArg, portArg = "4391"] = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!outArg) throw Error("Usage: bun tools/choice-layouts-look.ts <out dir> [port] [--schemes light,dark] [--widths 300,480] [--tag after] [--hovers 10]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg, schemes = flag("schemes", "light,dark").split(",") as ("light" | "dark")[], widths = flag("widths", "300,480").split(",").map(Number);
const tag = flag("tag", "after"), hovers = +flag("hovers", "10"), skip = +flag("skip", "0");
const ROW = `[...document.querySelectorAll(".cc-row")].find(r => r.querySelector(".cc-row-label")?.textContent === "Hairstyle" && !r.hidden)`;

async function shoot(page: Session, file: string, selector: string, pad = 0, maxHeight = 900, scroll = true) {
  const box = await page.evaluate(`(() => { const e = ${selector}; if (!e) return null; ${scroll ? `e.scrollIntoView({ block: "start" });` : ""}
    const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), width: Math.min(r.width + ${2 * pad}, innerWidth), height: Math.min(r.height + ${2 * pad}, ${maxHeight}, innerHeight - Math.max(0, r.y)) }; })()`);
  if (box) await page.screenshot(resolve(out, file), box);
  return !!box;
}
async function segment(page: Session, label: string) {
  await page.evaluate(`(() => { const b = [...${ROW}.querySelectorAll(".cc-choice-tools .segment")].find(e => e.textContent.trim() === ${JSON.stringify(label)}); b?.click(); })()`);
  await page.wait(700);
}
/** The centre of a ready tile's picture (the nth ready one), scrolled into view. */
async function tileCentre(page: Session, nth: number, selector = ".pv-tile[data-state=ready] .pv-frame", scroll = true): Promise<{ x: number; y: number; position: number } | null> {
  return page.evaluate(`(() => { const f = [...${ROW}.querySelectorAll(${JSON.stringify(selector)})][${nth}]; if (!f) return null;
    ${scroll ? `f.scrollIntoView({ block: "center" });` : ""} const r = f.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, position: Number(f.closest(".choice").dataset.position) }; })()`);
}
/** The panel's scrolling view after bringing the row to its top and scrolling `rows` rows further (sticky headings and the details picture show). */
async function scrolledShot(page: Session, file: string, px: number) {
  const box = await page.evaluate(`(() => { const row = ${ROW}; row.scrollIntoView({ block: "start" }); const body = row.closest(".dock-body");
    body.scrollTop += ${px}; const r = body.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, innerHeight - r.y) }; })()`);
  await page.wait(400);
  if (box) await page.screenshot(resolve(out, file), box);
}
const stats = (page: Session) => page.evaluate(`(() => { const s = window.xfsChoicePreviews?.stats; return s && { spun: s.spun, spinStored: s.spinStored,
  spinMs: s.spinMs, spinWaitMs: s.spinWaitMs, spinTimings: s.spinTimings, drawn: s.drawn, stored: s.stored,
  firstTurnMs: [...(window.xfsSpinMeasures ?? [])], heap: performance.memory?.usedJSHeapSize ?? null }; })()`);

const report: Record<string, unknown>[] = [];
for (const scheme of schemes) for (const width of widths) {
  const small = args.includes("--clicks-only");
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: width + 420, height: small ? 760 : 1000, scheme, debugPort: port + 5100 + width % 97,
    args: ["--renderer-process-limit=1", "--disable-features=IsolateOrigins,site-per-process", "--disable-extensions", "--js-flags=--max-old-space-size=1024"] });
  const name = (what: string) => `${tag}-${what}-${scheme}-${width}.png`;
  try {
    await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 120000);
    await page.waitFor(`window.xfStudioPresentation?.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 240000).catch(() => {});
    for (const action of [{ kind: "preview.setBody", enabled: false }, { kind: "motion.setIdle", enabled: false }])
      await page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`).catch(() => undefined);
    await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
    await page.waitFor(`!!(${ROW})`, 240000);
    await page.evaluate(`(() => { const g = document.querySelector(".cc-panel")?.closest(".dock-group, .dock-column, section"); if (g) { g.style.width = "${width}px"; g.style.flex = "none"; } })()`);
    await page.wait(600);
    await page.evaluate(`(() => { const m = ${ROW}.querySelector(".cc-row-main"); if (m.getAttribute("aria-expanded") !== "true") m.click(); })()`);
    await page.waitFor(`${ROW}.querySelectorAll(".pv-tile").length > 0`, 60000);
    await segment(page, "Grid"); await segment(page, "M");
    await page.waitFor(`(() => { const tiles = [...${ROW}.querySelectorAll(".pv-tile")].slice(0, 24); return tiles.length > 0 && tiles.every(t => t.dataset.state !== "waiting"); })()`, 120000).catch(() => {});
    await page.wait(800);
    const before = await stats(page);
    if (args.includes("--spin-m")) {
      // Grid M: one tile turning on hover (strip drawn on first look), then another caught mid-drag.
      await segment(page, "Grid"); await segment(page, "M");
      const hovered = await tileCentre(page, 4);
      if (hovered) {
        await page.mouse("mouseMoved", hovered.x, hovered.y);
        await page.waitFor(`!!document.querySelector(".pv-frame[data-spin] .pv-live:not([hidden])")`, 8000).catch(() => {});
        // Four seconds of live turning: frames, the worker's time per frame (and with the GPU waited for), the main thread's share, long tasks.
        const live = await page.evaluate(`(async () => { const s = window.xfsChoicePreviews.liveStats, f0 = s.frames, m0 = window.xfsLiveMeasures.length, long = [];
          const o = new PerformanceObserver(l => long.push(...l.getEntries().map(e => e.duration))); o.observe({ type: "longtask" });
          const t0 = performance.now(); await new Promise(r => setTimeout(r, 4000)); o.disconnect(); const seconds = (performance.now() - t0) / 1000;
          const med = a => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
          const main = window.xfsLiveMeasures.slice(m0);
          return { fps: (s.frames - f0) / seconds, workerMsMedian: med(s.frameMs.slice(-(s.frames - f0))), gpuMsMedian: med(s.gpuMs), gpuSamples: s.gpuMs.length,
            mainMsMedian: med(main), mainMsPerSecond: main.reduce((a, b) => a + b, 0) / seconds, longTasks: long, startMs: s.startMs }; })()`);
        report.push({ scheme, width, check: "live turn, 4 s", live });
        await shoot(page, name("grid-m-turning"), ROW, 2, 520, false);
      }
      const dragged = await tileCentre(page, 1);
      if (dragged) {
        await page.mouse("mouseMoved", dragged.x, dragged.y);
        await page.wait(900);
        await page.mouse("mousePressed", dragged.x, dragged.y, { button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 6; i++) { await page.mouse("mouseMoved", dragged.x + i * 6, dragged.y, { button: "left", buttons: 1 }); await page.wait(40); }
        await page.waitFor(`!!document.querySelector(".pv-frame[data-spin]")`, 8000).catch(() => {});
        await shoot(page, name("grid-m-dragging"), ROW, 2, 520, false);
        const before = await page.evaluate(`${ROW}.querySelector(".choice[aria-selected=true]")?.dataset.position ?? null`);
        await page.mouse("mouseReleased", dragged.x + 36, dragged.y, { button: "left", buttons: 0, clickCount: 1 });
        await page.wait(300);
        const after = await page.evaluate(`${ROW}.querySelector(".choice[aria-selected=true]")?.dataset.position ?? null`);
        report.push({ scheme, width, check: "grid M drag never chooses", before, after, stats: await stats(page) });
      }
      continue;
    }
    if (args.includes("--gate")) {
      // The gate's recapture: details scrolled a few rows (the picture stays, the headings stick), and list scrolled at the narrow width.
      await segment(page, "Details");
      await scrolledShot(page, name("gate-details-scrolled"), 5 * 70);
      if (width <= 300) { await segment(page, "List"); await scrolledShot(page, name("gate-list-scrolled"), 8 * 34); }
      await segment(page, "Grid");
      continue;
    }
    const clicksOnly = args.includes("--clicks-only");
    if (!clicksOnly) {
    await segment(page, "List");
    await shoot(page, name("list"), ROW, 2);
    await segment(page, "Details");
    await shoot(page, name("details"), ROW, 2);
    // Details: rest on a row just under the large picture, let it turn, then drag the large picture and catch it mid-drag.
    await page.evaluate(`${ROW}.querySelector(".cc-choice-body").scrollIntoView({ block: "start" })`);
    const row = await tileCentre(page, 2, ".choices .pv-tile[data-state=ready] .pv-frame", false);
    if (row) {
      await page.mouse("mouseMoved", row.x, row.y);
      await page.waitFor(`window.xfsChoicePreviews?.row?.("head/hairstyle") !== undefined`, 1000).catch(() => {});
      await page.wait(1600);
      await shoot(page, name("details-turning"), `${ROW}.querySelector(".cc-choice-body")`, 2, 900, false);
      const stage = await page.evaluate(`(() => { const f = ${ROW}.querySelector(".pv-stage .pv-frame"); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number } | null;
      if (stage) {
        await page.mouse("mouseMoved", stage.x, stage.y);
        await page.wait(900);
        await page.mouse("mousePressed", stage.x, stage.y, { button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 8; i++) { await page.mouse("mouseMoved", stage.x + i * 9, stage.y, { button: "left", buttons: 1 }); await page.wait(30); }
        await page.wait(200);
        await shoot(page, name("details-dragging"), `${ROW}.querySelector(".cc-choice-body")`, 2, 900, false);
        await page.mouse("mouseReleased", stage.x + 72, stage.y, { button: "left", buttons: 0, clickCount: 1 });
      }
    }
    // Grid L: hover tiles one after another (each strip drawn on request), catching one turning and one mid-drag.
    await segment(page, "Grid"); await segment(page, "L");
    await shoot(page, name("grid-l"), ROW, 2);
    // Main-thread long tasks while strips are drawn (the worker draws and encodes; the page only receives each strip) against an idle spell.
    await page.evaluate(`(() => { window.__long = []; new PerformanceObserver(list => window.__long.push(...list.getEntries().map(e => [e.startTime, e.duration]))).observe({ type: "longtask" }); window.__hoverAt = performance.now(); })()`);
    for (let n = skip; n < skip + hovers; n++) {
      const tile = await tileCentre(page, n);
      if (!tile) break;
      await page.mouse("mouseMoved", tile.x, tile.y);
      await page.waitFor(`!!window.xfsChoicePreviews?.row?.("head/hairstyle")?.spins?.has?.(${tile.position}) || [...document.querySelectorAll(".pv-frame[data-spin]")].length > 0`, 8000).catch(() => {});
      await page.wait(1300);
      if (n === skip + 1) await shoot(page, name("grid-l-turning"), ROW, 2, 900, false);
    }
    const hoverSpell = await page.evaluate(`performance.now() - window.__hoverAt`) as number;
    await page.mouse("mouseMoved", 2, 2);
    await page.evaluate(`window.__idleAt = performance.now()`);
    await page.wait(Math.min(20000, hoverSpell));
    const longTasks = await page.evaluate(`(() => { const t = window.__long, h = t.filter(([s]) => s >= window.__hoverAt && s < window.__idleAt), i = t.filter(([s]) => s >= window.__idleAt);
      const sum = a => a.reduce((n, [, d]) => n + d, 0); return { hoverMs: window.__idleAt - window.__hoverAt, hover: { count: h.length, totalMs: sum(h), maxMs: Math.max(0, ...h.map(([, d]) => d)) },
        idleMs: performance.now() - window.__idleAt, idle: { count: i.length, totalMs: sum(i), maxMs: Math.max(0, ...i.map(([, d]) => d)) } }; })()`);
    report.push({ scheme, width, check: "main-thread long tasks while strips are drawn", longTasks });
    const tile = await tileCentre(page, 0);
    if (tile) {
      await page.mouse("mouseMoved", tile.x, tile.y);
      await page.wait(300);
      await page.mouse("mousePressed", tile.x, tile.y, { button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) { await page.mouse("mouseMoved", tile.x + i * 8, tile.y, { button: "left", buttons: 1 }); await page.wait(30); }
      await page.wait(200);
      const dragging = await page.evaluate(`!!document.querySelector(".pv-frame[data-spin]")`);
      await shoot(page, name("grid-l-dragging"), ROW, 2, 900, false);
      const selectedBefore = await page.evaluate(`${ROW}.querySelector(".choice[aria-selected=true]")?.dataset.position ?? null`);
      await page.mouse("mouseReleased", tile.x + 48, tile.y, { button: "left", buttons: 0, clickCount: 1 });
      await page.wait(200);
      const selectedAfter = await page.evaluate(`${ROW}.querySelector(".choice[aria-selected=true]")?.dataset.position ?? null`);
      report.push({ scheme, width, check: "drag never chooses", dragging, selectedBefore, selectedAfter });
    }
    } else { await segment(page, "Grid"); await segment(page, "L"); }
    // A click made while a strip is drawn, and one made idle: selection at once either way; the host's answer compared.
    const click = async (nth: number, busy: boolean) => {
      const target = await tileCentre(page, nth, ".choice:not([aria-selected=true]) .pv-tile[data-state=ready] .pv-frame");
      if (!target) return null;
      if (busy) {
        const spin = await tileCentre(page, hovers + 2 + nth);
        if (spin) { await page.mouse("mouseMoved", spin.x, spin.y); await page.waitFor(`window.xfsChoicePreviews?.drawing === true`, 3000).catch(() => {}); }
      }
      const drawing = await page.evaluate(`window.xfsChoicePreviews?.drawing === true`);
      await page.evaluate(`(() => { window.__clickAt = performance.now(); const item = [...${ROW}.querySelectorAll(".choice")].find(c => c.dataset.position === "${target.position}");
        new MutationObserver((_, o) => { if (item.getAttribute("aria-selected") === "true") { window.__selectedAt = performance.now(); o.disconnect(); } }).observe(item, { attributes: true }); })()`);
      await page.mouse("mouseMoved", target.x, target.y);
      await page.mouse("mousePressed", target.x, target.y, { button: "left", buttons: 1, clickCount: 1 });
      await page.mouse("mouseReleased", target.x, target.y, { button: "left", buttons: 0, clickCount: 1 });
      await page.wait(2500);
      return page.evaluate(`(() => { const host = performance.getEntriesByType("resource").filter(e => e.name.includes("/api/preview-character") && !e.name.includes("/creator") && e.startTime > window.__clickAt);
        return { busy: ${busy}, drawingAtClick: ${drawing}, selectedMs: window.__selectedAt ? window.__selectedAt - window.__clickAt : null,
          hostMs: host.length ? host[0].responseEnd - host[0].startTime : null }; })()`);
    };
    // Clicks prepare new V's in the 3D view, which the page's memory budget may not fit beside the captures: only with --clicks.
    const clicks = args.includes("--clicks") || clicksOnly ? [await click(0, true), await click(1, false), await click(2, true), await click(3, false)] : [];
    report.push({ scheme, width, before, after: await stats(page), clicks });
    await segment(page, "M");
  } finally { await page.close(); }
}
// The reference patterns, light and dark side by side (the guide's comparison mode).
for (const scheme of schemes) {
  const page = await launch(`http://127.0.0.1:${port}/style-guide.html`, { width: 1440, height: 1000, scheme, debugPort: port + 5300 });
  try {
    await page.waitFor("document.querySelector('#live-dock .dock')", 30000);
    await page.evaluate(`document.getElementById('compare-themes').click()`);
    await page.wait(500);
    for (const id of ["lib-choice-layouts", "lib-choice-preview"]) {
      await page.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' }); window.scrollBy(0, -64)`);
      await page.wait(400);
      await page.screenshot(resolve(out, `${tag}-guide-${id}-${scheme}.png`));
    }
  } finally { await page.close(); }
}
writeFileSync(resolve(out, `${tag}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
