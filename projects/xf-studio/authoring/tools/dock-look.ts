/**
 * Captures of the dock's collapsed-group and tab-strip behaviour (the component library's tab strip and panel header), in an isolated
 * `?verify=1` workspace with a throwaway Chrome profile, against an authoring server already running on its own port with its own
 * data folder (never 4317 or the person's draft).
 *
 *   bun tools/dock-look.ts <out dir under evidence/screenshots> [port] [light|dark]
 *
 * Scenarios: the default wide layout; its lower right group collapsed; Help summoned after that; the workspace narrowed until the
 * tab strips run short (truncated labels, icon-only tabs, the overflow menu). Each capture records measurements in `run.json`: whether
 * every header's collapse and menu buttons lie inside their group, whether Help is visible, and each strip's condensing stage.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./cdp";

const [outArg, portArg = "4391", schemeArg = "dark"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/dock-look.ts <out dir> [port] [light|dark]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: 900, scheme: schemeArg, debugPort: port + 5100 });
const measure = `(() => {
  const inside = (el, box) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1; };
  return [...document.querySelectorAll(".dock-group")].map(g => {
    const box = g.getBoundingClientRect(), bar = g.querySelector(".dock-tabbar");
    return { group: g.dataset.group, collapsed: g.classList.contains("collapsed"), fold: g.dataset.fold ?? null,
      width: Math.round(box.width), stage: g.querySelector(".tab-strip")?.dataset.stage ?? (g.querySelector(".dock-tabs.condensed") ? "condensed" : "full"), activeIcon: !!g.querySelector(".tab-strip.active-icon"),
      barOverflows: bar ? bar.scrollWidth > bar.clientWidth + 1 : null,
      collapseInside: inside(g.querySelector(".dock-collapse-btn"), box), menuInside: inside(g.querySelector(".dock-menu-btn"), box),
      overflowInside: inside(g.querySelector(".dock-overflow-btn"), box),
      tabs: [...g.querySelectorAll(".dock-tab")].map(t => ({ panel: t.dataset.panel, hidden: t.hidden || getComputedStyle(t).display === "none",
        label: getComputedStyle(t.querySelector(".dock-tab-label")).display !== "none" })) };
  });
})()`;
const runs: Record<string, unknown> = {};
const shot = async (name: string) => {
  await page.wait(500);
  await page.screenshot(resolve(out, `${name}.png`));
  runs[name] = { groups: await page.evaluate(measure), helpVisible: await page.evaluate(`window.xfStudioShell.dock.isVisible("help")`),
    helpState: await page.evaluate(`window.xfStudioShell.dock.panelState("help")`),
    focus: await page.evaluate(`(() => { const e = document.activeElement; return e ? (e.id || e.className || e.tagName) : null; })()`) };
};
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 120000);
  await page.evaluate(`window.xfStudioShell.dock.reset()`);
  await shot("1-default");
  // The lower group of the right column (Colour & finish and its tabs) collapsed from its own header button.
  await page.evaluate(`window.xfStudioShell.dock.toggleCollapse("finish")`);
  await shot("2-right-lower-collapsed");
  // Help summoned, as the header's Help button does.
  await page.evaluate(`document.querySelector('button[aria-label^="Help"], button[title^="Help"]')?.click() ?? window.xfStudioShell.dock.reveal("help", false)`);
  await shot("3-help-summoned");
  // Narrow workspaces: the strips condense.
  await page.evaluate(`window.xfStudioShell.dock.reset()`);
  for (const width of [1280, 1120]) { await page.viewport(width, 900); await page.wait(600); await shot(`4-width-${width}`); }
  await page.evaluate(`window.xfStudioShell.dock.toggleCollapse("finish")`);
  await shot("5-width-1120-collapsed");
  // A compact workspace: the lower row's left group collapsed folds to a vertical strip.
  await page.viewport(1000, 800); await page.wait(600);
  await page.evaluate(`window.xfStudioShell.dock.reset()`);
  await page.evaluate(`window.xfStudioShell.dock.toggleCollapse("finish")`);
  await shot("6-compact-strip");
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), scheme: schemeArg, runs,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote ${Object.keys(runs).length} captures to ${out}`);
} finally { await page.close(); }
