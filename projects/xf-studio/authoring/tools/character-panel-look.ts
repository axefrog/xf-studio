/**
 * Captures of the Character panel's colour rows (hair, brow and lash colours, eye colour, skin tone, makeup colours) and of the panel's
 * hierarchy, in an isolated `?verify=1` workspace with a throwaway Chrome profile, against an authoring server that is already running
 * on its own port with its own data folder (never 4317 or the person's draft).
 *
 *   bun tools/character-panel-look.ts <out dir under evidence/screenshots> [port] [light|dark]
 *
 * Only the panel is captured, never the 3D view. The rows show installed mods' names and colours, so keep the outputs in the ignored
 * evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./cdp";

const [outArg, portArg = "4391", schemeArg = "dark"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/character-panel-look.ts <out dir> [port] [light|dark]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
/** Row labels to open and capture (the vanilla creator's English labels). */
const ROWS = ["Hair Color", "Eyebrow Color", "Eyelash color", "Eye Color", "Skin Tone", "Nail Color"];
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1400, scheme: schemeArg, debugPort: port + 5000 });
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 120000);
  await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
  await page.waitFor(`[...document.querySelectorAll(".cc-row-label")].some(e => e.textContent === "Hair Color")`, 240000);
  await page.wait(1500);
  const rect = (selector: string) => page.evaluate(`(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: "start" });
    const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`);
  // The whole panel at its top (hierarchy and headings).
  const panel = await rect(`document.querySelector(".cc-panel")`);
  if (panel) await page.screenshot(resolve(out, "panel-top.png"), panel);
  const captured: string[] = [];
  for (const label of ROWS) {
    const row = `[...document.querySelectorAll(".cc-row")].find(r => r.querySelector(".cc-row-label")?.textContent === ${JSON.stringify(label)} && !r.hidden)`;
    const found = await page.evaluate(`!!(${row})`);
    if (!found) continue;
    await page.evaluate(`(() => { const r = ${row}; const main = r.querySelector(".cc-row-main"); if (main.getAttribute("aria-expanded") !== "true") main.click(); })()`);
    // Choices and their swatches arrive from the host.
    await page.waitFor(`(() => { const r = ${row}; return r.querySelectorAll(".cc-choice").length > 0; })()`, 60000).catch(() => {});
    await page.wait(4000);
    const box = await rect(row);
    if (box) { await page.screenshot(resolve(out, `${slug(label)}.png`), box); captured.push(label); }
    await page.evaluate(`(() => { const r = ${row}; r.querySelector(".cc-row-main").click(); })()`);
    await page.wait(300);
  }
  // Each part of V's heading and its first rows (Body: its switch and the uncensored setting; Clothing: its switch and controls).
  for (const group of ["body", "clothing"]) {
    const box = await rect(`document.querySelector('.cc-group[data-group="${group}"]')`);
    if (box) { await page.screenshot(resolve(out, `group-${group}.png`), { ...box, height: Math.min(box.height, 420) }); captured.push(`group ${group}`); }
  }
  const summary = await page.evaluate(`[...document.querySelectorAll(".cc-section, .cc-group")].map(s => (s.querySelector("h3, h4")?.textContent ?? "") + ": " +
    [...s.querySelectorAll(".cc-row:not([hidden]) .cc-row-label")].length)`);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), scheme: schemeArg, captured, sections: summary,
    console: page.console.filter(m => m.type === "error").slice(0, 20) }, null, 2));
  console.log(`Wrote ${captured.length} row captures to ${out}`);
} finally { await page.close(); }
