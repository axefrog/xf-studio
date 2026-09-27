/**
 * Captures of the Expression drawer (features/expressions/view/drawer.ts) for design review, in an isolated `?verify=1` workspace with
 * a throwaway Chrome profile and its own authoring server (own port, own data folder; never 4317 or the person's draft). The drawer
 * floats at a narrow (300 px) and a wide (480 px) width in both themes: its top (Start from, the Face heading and the first group),
 * the Gaze group (bipolar sliders), the separate state (Symmetric off), and beside the Character panel at the same width. The 3D
 * view is masked (MASK_VIEWPORTS); the Start from tree lists installed mods' expression names, so keep outputs in the ignored
 * evidence tree.
 *
 *   bun tools/expression-drawer-look.ts <out dir under evidence/screenshots> [port]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, startServer } from "./cdp";

const [outArg, portArg = "4471"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/expression-drawer-look.ts <out dir> [port]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark", debugPort: port + 5000 });
const shots: string[] = [];
const t0 = Date.now();
const log = (what: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s: ${what}`);
const box = (selector: string) => page.evaluate(`(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect();
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`);
const snap = async (name: string, selector: string) => {
  const clip = await box(selector);
  if (!clip) { console.log(`missing: ${name}`); return; }
  await page.screenshot(resolve(out, `${name}.png`), clip as never);
  shots.push(name);
};
/** The theme for the next captures: the emulated system scheme and the root's theme attribute, so a stored preference can't win. */
const theme = async (scheme: "light" | "dark") => {
  await page.colorScheme(scheme);
  await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(scheme)}`);
  await page.wait(300);
};
const drawerWindow = `document.querySelector(".expr-drawer")?.closest(".dock-window, .dock-group")`;
const scrollTo = (selector: string) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "start" }); return !!e; })()`);
const clickRow = (text: string) => page.evaluate(`(() => { const row = [...document.querySelectorAll(".expr-drawer .tree-row")].find(r => r.textContent.includes(${JSON.stringify(text)})); row?.click(); return !!row; })()`);
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  log("page ready");
  await page.evaluate(MASK_VIEWPORTS);
  // The body isn't needed for the face (and is masked anyway): turning it off keeps Chrome's memory small.
  await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 240000).catch(() => {});
  await page.evaluate(`window.xfStudioPresentation.authoring.dispatch({ kind: "preview.setBody", enabled: false })`).catch(() => {});
  log("body off");
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
  await page.waitFor(`document.querySelectorAll(".expr-drawer .group-section").length > 0`, 300000);
  await page.waitFor(`document.querySelectorAll(".expr-drawer .tree-row").length > 0`, 120000).catch(() => {});
  log("drawer built");
  // A natural sample, so several controls are set (the set state, counts and resets show).
  await clickRow("Warm smile");
  await page.wait(1500);
  for (const scheme of ["dark", "light"] as const) {
    await theme(scheme);
    for (const width of [300, 480]) {
      const tag = `${scheme}-${width}`;
      await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: ${1420 - width}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.wait(700);
      await scrollTo(".expr-drawer");
      await snap(`${tag}-top`, drawerWindow); log(`${tag} top`);
      // The Gaze group, opened.
      await page.evaluate(`(() => { const g = document.querySelector('.expr-drawer [data-group="eyes"], .expr-drawer [data-group="gaze"]'); const b = g?.querySelector(".expander"); if (b?.getAttribute("aria-expanded") === "false") b.click(); })()`);
      await page.wait(300);
      if (await scrollTo(".expr-drawer [data-axis]")) { await page.wait(300); await snap(`${tag}-gaze`, drawerWindow); }
      // Beside the Character panel at the same width.
      await page.evaluate(`window.xfStudioShell.dock.moveTo("character", { kind: "float", x: ${1400 - 2 * width}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.wait(900);
      await scrollTo(".expr-drawer");
      await page.screenshot(resolve(out, `${tag}-beside-character.png`), { x: 1390 - 2 * width, y: 20, width: 2 * width + 40, height: 920 } as never);
      shots.push(`${tag}-beside-character`);
      await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
    }
  }
  // Symmetric off: every pair separate (the separate layouts), dark, narrow.
  await theme("dark");
  await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: 1120, y: 30, w: 300, h: 900 }, "")`);
  await page.evaluate(`document.querySelector(".expr-symmetric input")?.click()`);
  await page.wait(800);
  if (await scrollTo(".expr-drawer [data-axis]")) { await page.wait(300); await snap("dark-300-gaze-separate", drawerWindow); }
  await scrollTo(".expr-drawer .group-section");
  await snap("dark-300-separate-top", drawerWindow);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), shots,
    console: page.console.filter(m => m.type === "error").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
