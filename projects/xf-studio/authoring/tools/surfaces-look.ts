/**
 * Captures of the Studio's "honest surfaces" (1.0: only what exists, early-access parts tagged, Help for every stable part) in an
 * isolated `?verify=1` workspace with disposable data and a throwaway Chrome profile, in the given scheme:
 * - the wide window, and an early-access tab docked in a busy group at every tab-strip stage the window widths reach;
 * - the Modules menu and the Panels flyout, with research tools off and on (Soon rows beside stage-tagged rows), with keyboard focus
 *   on a tagged entry, and the menus' row heights (a tagged row must be as tall as an untagged one);
 * - keyboard focus on a tagged tab;
 * - the Expression panel (the solver-missing state), Motion (Hair physics, off and, once the hair has loaded, on) and Help (the
 *   limitations page, the tour list and the Camera & light answer), each floated at 300 and 480 px;
 * - every step of the "Your V, camera and settings" tour.
 * It starts its own authoring server on `port` (never 4317) and stops it when done.
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
const measures: Record<string, unknown> = {};
const rectOf = (selector: string, pad = 8) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
  const r = e.getBoundingClientRect(); const x = Math.max(0, r.x - ${pad}), y = Math.max(0, r.y - ${pad});
  return { x, y, width: Math.min(innerWidth - x, r.width + ${pad * 2}), height: Math.min(innerHeight - y, r.height + ${pad * 2}) }; })()`);
const shoot = async (id: string, selector?: string, pad = 8) => {
  await page.wait(450);
  const clip = selector ? await rectOf(selector, pad) : undefined;
  if (selector && !clip) { console.warn(`No ${selector} for ${id}`); return; }
  await page.screenshot(name(id), clip ?? undefined); shots.push(id);
};
const closeMenus = async () => { await page.key("Escape"); await page.wait(200); };
const setResearch = (on: boolean) => page.evaluate(`window.xfStudioShell.runtime.port.preferences.dispatch({ kind: "researchTools.set", enabled: ${on} })`);
/** Each menu row's height, tagged or not: a stage or Soon tag must not make its row taller. */
const rowHeights = () => page.evaluate(`[...document.querySelectorAll(".menu-layer .menu .menu-item")].map(e => ({ label: e.querySelector(".menu-label")?.textContent,
  tagged: !!e.querySelector(".menu-tag"), height: Math.round(e.getBoundingClientRect().height * 10) / 10, hint: !!e.querySelector(".menu-hint, .menu-reason") }))`);
/** Float `panel` in its own window `width` px wide, top-left of the workspace. */
const floatAt = (panel: string, width: number, height = 620) => page.evaluate(`(() => { const dock = window.xfStudioShell.dock;
  dock.reveal(${JSON.stringify(panel)}, false);
  const inWindow = dock.tree.floating.find(w => JSON.stringify(w.node).includes(${JSON.stringify(`"${panel}"`)}));
  if (!inWindow || JSON.stringify(inWindow.node).match(/"panels":\\[[^\\]]*,/)) dock.float(${JSON.stringify(panel)});
  const tree = dock.tree, win = tree.floating.find(w => JSON.stringify(w.node).includes(${JSON.stringify(`"${panel}"`)}));
  dock.update({ ...tree, floating: tree.floating.map(w => w === win ? { ...w, x: 24, y: 24, w: ${width}, h: ${height} } : w) });
  return !!win; })()`);
const windowRect = (panel: string) => page.evaluate(`(() => { const tab = document.querySelector('[data-panel="${panel}"]'); const g = tab?.closest(".dock-group");
  const w = g?.parentElement?.closest("[class*=float], [class*=window]") ?? g; if (!w) return null; const r = w.getBoundingClientRect();
  return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: Math.min(innerWidth, r.width + 8), height: Math.min(innerHeight, r.height + 8) }; })()`);
const searchHelp = (query: string) => page.evaluate(`(() => { const s = document.querySelector(".help-search"); if (!s) return;
  s.value = ${JSON.stringify(query)}; s.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".help-results")?.scrollTo(0, 0); })()`);
/** Press a button of the running tour's card (only a card on screen: the onboarding offer may be in the page, hidden). */
const tourButton = (pattern: string) => page.evaluate(`[...document.querySelectorAll(".guidance-callout .guidance-actions .btn")]
  .find(b => b.offsetParent !== null && !b.closest("[hidden]") && /${pattern}/.test(b.textContent ?? ""))?.click()`);
const EXPRESSION_GROUP = `.dock-group:has([data-panel="expressions.controls"])`;
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 180000);
  // The 3D head, when this machine's caches have it (the Motion panel's rows are live then).
  await page.waitFor("window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 90000).catch(() => console.warn("The 3D head didn't load"));
  await page.evaluate(`[...document.querySelectorAll(".guidance-callout button")].find(b => /not now|no thanks|close/i.test(b.textContent ?? b.getAttribute("aria-label") ?? ""))?.click()`);
  await setResearch(false);
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.wait(800);
  await shoot("wide");

  // An early-access tab docked in a busy group, active, at each stage the window widths reach.
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls", false)`);
  const stages: Record<string, number> = {};
  for (const width of [1100, 1300, 1440, 1700, 2000, 2400, 2800]) {
    await page.viewport(width, 900); await page.wait(700);
    const stage = await page.evaluate(`document.querySelector('${EXPRESSION_GROUP} .tab-strip')?.dataset.stage ?? null`) as string | null;
    const activeIcon = await page.evaluate(`!!document.querySelector('${EXPRESSION_GROUP} .tab-strip.active-icon')`);
    const key = `${stage}${activeIcon ? "-icon-only" : ""}`;
    if (stage && !(key in stages)) { stages[key] = width; await shoot(`tab-${key}`, `${EXPRESSION_GROUP} .panel-header`, 4); }
  }
  measures.tabStages = stages;
  await page.viewport(1440, 900); await page.wait(700);
  // Keyboard focus on the tagged tab (a key first, so the focus ring shows as it does for a keyboard user).
  await page.key("Shift"); await page.evaluate(`document.querySelector('[data-panel="expressions.controls"]')?.focus()`);
  await shoot("tab-focus", `${EXPRESSION_GROUP} .panel-header`, 4);

  // The menus at full length (a taller window, so nothing scrolls out of the capture), research tools off, then on.
  await page.viewport(1440, 2300); await page.wait(500);
  for (const research of [false, true]) {
    await setResearch(research); await page.wait(400);
    const suffix = research ? "-research" : "";
    await page.evaluate(`document.querySelector(".shell-header .category").click()`);
    await shoot(`modules-menu${suffix}`, ".menu-layer .menu");
    measures[`modulesRows${suffix}`] = await rowHeights();
    if (!research) {
      // Keyboard focus on a tagged entry: arrow down to Expressions.
      for (let i = 0; i < 6; i++) {
        const label = await page.evaluate(`document.activeElement?.querySelector?.(".menu-label")?.firstChild?.textContent ?? ""`);
        if (label === "Expressions") break;
        await page.key("ArrowDown"); await page.wait(80);
      }
      await shoot("modules-menu-focus", ".menu-layer .menu");
    }
    await closeMenus();
    await page.evaluate(`document.querySelector(".shell-header [aria-label='Panels']").click()`);
    await shoot(`panels-flyout${suffix}`, ".menu-layer .menu");
    measures[`panelsRows${suffix}`] = await rowHeights();
    await closeMenus();
  }
  await setResearch(false);
  await page.viewport(1440, 900); await page.wait(500);

  for (const width of [300, 480]) {
    for (const panel of ["expressions.controls", "motion", "help"]) {
      await floatAt(panel, width);
      if (panel === "help") await searchHelp("not in this version");
      if (panel === "motion") await page.evaluate(`[...document.querySelectorAll(".toggle-label")].find(e => e.textContent === "Hair physics")?.scrollIntoView({ block: "center" })`);
      await page.wait(600);
      const rect = await windowRect(panel);
      if (rect) { await page.screenshot(name(`${panel.replace(/\W/g, "-")}-${width}`), rect); shots.push(`${panel}-${width}`); }
      if (panel === "help") {
        // The tour list (the new tour among them), then the Camera & light answer.
        await searchHelp(""); await page.wait(400);
        const list = await windowRect(panel);
        if (list) { await page.screenshot(name(`help-tours-${width}`), list); shots.push(`help-tours-${width}`); }
        await searchHelp("camera light"); await page.wait(400);
        const camera = await windowRect(panel);
        if (camera) { await page.screenshot(name(`help-camera-${width}`), camera); shots.push(`help-camera-${width}`); }
        await searchHelp("");
      }
      await page.evaluate(`window.xfStudioShell.dock.close(${JSON.stringify(panel)})`);
    }
  }

  // Hair physics on: the tag beside a switch that is on (once the hair has loaded, if it does on this machine).
  const physicsReady = await page.waitFor(`window.xfStudioShell.runtime.port.authoring.capability({ kind: "motion.setPhysics", enabled: true }).available`, 240000)
    .then(() => true, () => false);
  measures.physicsReady = physicsReady;
  if (physicsReady) {
    await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "motion.setPhysics", enabled: true })`);
    for (const width of [300, 480]) {
      await floatAt("motion", width);
      await page.evaluate(`[...document.querySelectorAll(".toggle-label")].find(e => e.textContent === "Hair physics")?.scrollIntoView({ block: "center" })`);
      await page.wait(800);
      const rect = await windowRect("motion");
      if (rect) { await page.screenshot(name(`motion-physics-on-${width}`), rect); shots.push(`motion-physics-on-${width}`); }
      await page.evaluate(`window.xfStudioShell.dock.close("motion")`);
    }
    await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "motion.setPhysics", enabled: false })`);
  }

  // Every step of the new tour. A step whose panel is a background tab first offers to show it: take the offer, as a person would.
  const started = await page.evaluate(`window.xfStudioShell.guidance.start("your-v-and-view")`);
  if (started) for (let step = 1; step <= 4; step++) {
    await page.wait(900);
    await tourButton("^Show ");
    await page.wait(900);
    await shoot(`tour-step-${step}`);
    await tourButton("^(Next|Finish)");
  }
  writeFileSync(resolve(out, `${prefix}${scheme}-run.json`), JSON.stringify({ date: new Date().toISOString(), scheme, shots, started, measures,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
