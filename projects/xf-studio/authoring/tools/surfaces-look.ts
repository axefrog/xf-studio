/**
 * Captures of the Studio's "honest surfaces" (1.0: only what exists, previews labelled, Help for every stable module) in an isolated
 * `?verify=1` workspace with disposable data and a throwaway Chrome profile: the Modules menu, the Panels flyout, a preview module's
 * panel, the Motion panel's hair physics row and the Help panel at 300 and 480 px panel widths, a tour step and the wide window, in
 * the given scheme. It starts its own authoring server on `port` (never 4317) and stops it when done.
 *
 *   bun tools/surfaces-look.ts <out dir> [port] [light|dark] [prefix]
 *
 * The server inherits this process's environment: point `XFS_PREVIEW_CORE_CACHE` and `XFS_RESOLVER_CACHE` at warm caches.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4491", schemeArg = "dark", prefix = ""] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/surfaces-look.ts <out dir> [port] [light|dark] [prefix]");
const out = resolve(outArg), port = +portArg, scheme = schemeArg;
mkdirSync(out, { recursive: true });
const name = (id: string) => resolve(out, `${prefix}${scheme}-${id}.png`);
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 900, scheme, debugPort: port + 5100 });
const shots: string[] = [];
const rectOf = (selector: string, pad = 8) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
  const r = e.getBoundingClientRect(); const x = Math.max(0, r.x - ${pad}), y = Math.max(0, r.y - ${pad});
  return { x, y, width: Math.min(innerWidth - x, r.width + ${pad * 2}), height: Math.min(innerHeight - y, r.height + ${pad * 2}) }; })()`);
const shoot = async (id: string, selector?: string) => {
  await page.wait(450);
  const clip = selector ? await rectOf(selector) : undefined;
  if (selector && !clip) { console.warn(`No ${selector} for ${id}`); return; }
  await page.screenshot(name(id), clip ?? undefined); shots.push(id);
};
const closeMenus = () => page.key("Escape");
/** Float `panel` in its own window `width` px wide, top-left of the workspace. */
const floatAt = (panel: string, width: number, height = 620) => page.evaluate(`(() => { const dock = window.xfStudioShell.dock;
  dock.reveal(${JSON.stringify(panel)}, false);
  const inWindow = dock.tree.floating.find(w => JSON.stringify(w.node).includes(${JSON.stringify(`"${panel}"`)}));
  if (!inWindow || JSON.stringify(inWindow.node).match(/"panels":\\[[^\\]]*,/)) dock.float(${JSON.stringify(panel)});
  const tree = dock.tree, win = tree.floating.find(w => JSON.stringify(w.node).includes(${JSON.stringify(`"${panel}"`)}));
  dock.update({ ...tree, floating: tree.floating.map(w => w === win ? { ...w, x: 24, y: 24, w: ${width}, h: ${height} } : w) });
  return !!win; })()`);
const floated = (panel: string) => `.floating-window:has([data-panel="${panel}"]), .dock-window:has([data-panel="${panel}"])`;
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 180000);
  await page.wait(1500);
  // The 3D head, when this machine's caches have it (the Motion panel's rows are live then).
  await page.waitFor("window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 90000).catch(() => console.warn("The 3D head didn't load"));
  // The onboarding offer stays out of the way.
  await page.evaluate(`[...document.querySelectorAll(".guidance-callout button")].find(b => /not now|no thanks|close/i.test(b.textContent ?? b.getAttribute("aria-label") ?? ""))?.click()`);
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.wait(800);
  await shoot("wide");
  // A preview panel docked in a busy group, active: its tab keeps the tag while the others condense.
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls", false)`);
  await page.wait(600);
  await shoot("wide-docked-preview", `.dock-group:has([data-panel="expressions.controls"]) .panel-header, .dock-group:has([data-panel="expressions.controls"]) > :first-child`);
  // The menus at full length (a taller window, so nothing scrolls out of the capture).
  await page.viewport(1440, 2100); await page.wait(500);
  await page.evaluate(`document.querySelector(".shell-header .category").click()`);
  await shoot("modules-menu", ".menu-layer .menu");
  await closeMenus();
  await page.evaluate(`document.querySelector(".shell-header [aria-label='Panels']").click()`);
  await shoot("panels-flyout", ".menu-layer .menu");
  await closeMenus();
  await page.viewport(1440, 900); await page.wait(500);
  const floatSelector = await page.evaluate(`(() => { const c = document.querySelector(".floating-window, .dock-window, [data-window]"); return c ? c.className : null; })()`);
  for (const width of [300, 480]) {
    for (const panel of ["expressions.controls", "motion", "help"]) {
      await floatAt(panel, width);
      // Help, searched the way a person finds the page: the search opens the matching topics.
      if (panel === "help") await page.evaluate(`(() => { const s = document.querySelector(".help-search"); if (!s) return;
        s.value = "not in this version"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      if (panel === "motion") await page.evaluate(`[...document.querySelectorAll(".toggle-label")].find(e => e.textContent === "Hair physics")?.scrollIntoView({ block: "center" })`);
      await page.wait(600);
      const rect = await page.evaluate(`(() => { const tab = document.querySelector('[data-panel="${panel}"]'); const g = tab?.closest(".dock-group"); const w = g?.parentElement?.closest("[class*=float], [class*=window]") ?? g;
        if (!w) return null; const r = w.getBoundingClientRect(); return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: Math.min(innerWidth, r.width + 8), height: Math.min(innerHeight, r.height + 8) }; })()`);
      if (rect) { await page.screenshot(name(`${panel.replace(/\W/g, "-")}-${width}`), rect); shots.push(`${panel}-${width}`); }
      await page.evaluate(`window.xfStudioShell.dock.close(${JSON.stringify(panel)})`);
    }
  }
  // The new tour's first step (after), if there is one.
  const started = await page.evaluate(`(() => { const g = window.xfStudioShell.guidance; return g && typeof g.start === "function" ? g.start("your-v-and-view") : false; })()`);
  if (started) {
    await page.wait(900);
    // A step whose panel is a background tab first offers to show it: take the offer, as a person would.
    await page.evaluate(`[...document.querySelectorAll(".guidance-callout .guidance-actions .btn")].find(b => /^Show /.test(b.textContent ?? ""))?.click()`);
    await page.wait(900); await shoot("tour-step");
    await page.evaluate(`[...document.querySelectorAll(".guidance-callout .guidance-actions .btn")].find(b => /^Next/.test(b.textContent ?? ""))?.click()`);
    await page.wait(600);
    await page.evaluate(`[...document.querySelectorAll(".guidance-callout .guidance-actions .btn")].find(b => /^Show /.test(b.textContent ?? ""))?.click()`);
    await page.wait(900); await shoot("tour-step-2");
  }
  writeFileSync(resolve(out, `${prefix}${scheme}-run.json`), JSON.stringify({ date: new Date().toISOString(), scheme, shots, floatSelector, started,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
