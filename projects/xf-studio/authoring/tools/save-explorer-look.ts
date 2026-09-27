/**
 * Captures of the Save Explorer's layout (the reference composition of the layout primitives), in an isolated `?verify=1` workspace
 * with a throwaway Chrome profile, against an authoring server already running on its own port with its own data folder (never 4317
 * or the person's draft). The explorer is read-only; it opens the newest listed save.
 *
 *   bun tools/save-explorer-look.ts <out dir under evidence/screenshots> [port] [light|dark] [width]
 *
 * Saves carry the player's own names and places, so keep the outputs in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./cdp";

const [outArg, portArg = "4391", schemeArg = "dark", widthArg = "1400"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/save-explorer-look.ts <out dir> [port] [light|dark] [width]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg, width = +widthArg;
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width, height: 900, scheme: schemeArg, debugPort: port + 5200 });
const panelRect = `(() => { const e = document.querySelector(".save-explorer")?.closest(".dock-group"); if (!e) return null; const r = e.getBoundingClientRect();
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`;
const measures: Record<string, unknown> = {};
const gapsBetween = `(() => {
  const box = s => { const e = document.querySelector(s); if (!e || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const back = box(".save-explorer-open .page-header-back, .save-explorer-open .list-head"), title = box(".save-title"), meta = box(".save-header .page-header-meta, .save-facts");
  const tree = box(".save-tree"), inspect = box(".save-inspect-pane"), nodeTitle = box(".save-node-title"), facts = box(".save-node dl"), hex = box(".save-hex");
  const gap = (a, b) => a && b ? Math.round(b.top - a.bottom) : null;
  return { backToTitle: gap(back, title), titleToMeta: gap(title, meta), metaToTree: gap(meta, tree), treeToInspector: tree && inspect ? Math.round(inspect.left - tree.right) : null,
    nodeTitleToRows: gap(nodeTitle, facts), aboveHex: hex ? gap([...document.querySelectorAll(".save-node > * > *, .save-node > *")].filter(e => e.getBoundingClientRect().bottom <= hex.top + 1 && !e.contains(document.querySelector(".save-hex"))).map(e => e.getBoundingClientRect()).sort((a, b) => b.bottom - a.bottom)[0] ?? null, hex) : null };
})()`;
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 120000);
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("save-explorer", true)`);
  await page.evaluate(`window.xfStudioShell.dock.reveal("save-explorer.explorer")`);
  await page.wait(500);
  // Give the explorer the whole workspace (its group maximized), so the capture shows its own layout.
  await page.evaluate(`(() => { const g = document.querySelector(".save-explorer")?.closest(".dock-group"); if (g && !g.classList.contains("maximized")) window.xfStudioShell.dock.toggleMaximize(g.dataset.group); })()`);
  await page.waitFor(`document.querySelectorAll("button.save-row").length > 0`, 60000);
  await page.evaluate(`[...document.querySelectorAll("#preview-card button")].find(b => b.textContent === "Not now")?.click()`);
  await page.wait(500);
  const list = await page.evaluate(panelRect);
  if (list) await page.screenshot(resolve(out, "1-list.png"), list);
  await page.evaluate(`document.querySelector("button.save-row").click()`);
  await page.waitFor(`document.querySelectorAll("li.save-tree-row").length > 0`, 120000);
  await page.wait(800);
  // A node with a layout of its own shows its facts, a note and its bytes: the case in the report.
  const row = `[...document.querySelectorAll("li.save-tree-row")]`;
  await page.evaluate(`(() => { const r = ${row}.find(e => e.querySelector(".save-tree-name")?.textContent === "GameSessionDesc"); r?.click(); })()`);
  await page.wait(400);
  await page.evaluate(`(() => { const r = ${row}.find(e => e.querySelector(".save-tree-name")?.textContent === "GameSessionDesc"); r?.click(); })()`);
  await page.wait(400);
  await page.evaluate(`(() => { const r = ${row}.find(e => /SessionConfig/.test(e.querySelector(".save-tree-name")?.textContent ?? ""));
    if (r) r.click(); else [...document.querySelectorAll(".save-node button.link-button")].find(b => /SessionConfig/.test(b.textContent ?? ""))?.click(); })()`);
  await page.wait(800);
  measures.node = await page.evaluate(gapsBetween);
  const open = await page.evaluate(panelRect);
  if (open) await page.screenshot(resolve(out, "2-node.png"), open);
  // A narrow panel: the split view stacks.
  await page.viewport(760, 900); await page.wait(700);
  measures.narrow = await page.evaluate(gapsBetween);
  const narrow = await page.evaluate(panelRect);
  if (narrow) await page.screenshot(resolve(out, "3-narrow.png"), narrow);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), scheme: schemeArg, width, measures,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote captures to ${out}`, JSON.stringify(measures));
} finally { await page.close(); }
