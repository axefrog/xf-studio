/**
 * Captures of every panel that composes a library control changed by a UI component track round (Segmented, disabled sliders, result
 * lists, the ordered list), for a before/after design review, in an isolated `?verify=1` workspace with a throwaway Chrome profile and its
 * own authoring server (own port, own data folder; never 4317 or the person's draft). Each panel floats at 300 and 480 px in both themes;
 * the style guide's specimens of the changed components are captured too. Run it once on the base commit (`before`) and once on the branch
 * (`after`, with `--compare <before dir>` to compose side-by-side sheets). The 3D view is masked (MASK_VIEWPORTS); keep outputs in the
 * ignored local capture tree.
 *
 *   bun tools/ui-library-look.ts <out dir> <before|after> [port] [--compare <before dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, startServer } from "./cdp";

const args = process.argv.slice(2);
const compareAt = args.indexOf("--compare");
const compare = compareAt >= 0 ? resolve(args[compareAt + 1]!) : undefined;
const [outArg, label, portArg = "4484"] = args.filter((_, i) => compareAt < 0 || (i !== compareAt && i !== compareAt + 1));
if (!outArg || (label !== "before" && label !== "after")) throw Error("Usage: bun tools/ui-library-look.ts <out dir> <before|after> [port] [--compare <before dir>]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark", debugPort: port + 5000 });
const shots: string[] = [];
const t0 = Date.now();
const log = (what: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s: ${what}`);
type Box = { x: number; y: number; width: number; height: number };
const box = (selector: string) => page.evaluate(`(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect();
  return { x: Math.max(0, r.x) + scrollX, y: Math.max(0, r.y) + scrollY, width: Math.min(r.width, innerWidth - Math.max(0, r.x)),
    height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`) as Promise<Box | null>;
const snap = async (name: string, selector: string) => {
  const clip = await box(selector);
  if (!clip || clip.width < 2 || clip.height < 2) { console.log(`missing: ${name}`); return; }
  await page.screenshot(resolve(out, `${label}-${name}.png`), clip);
  shots.push(name);
};
const theme = async (scheme: "light" | "dark") => {
  await page.colorScheme(scheme);
  await page.evaluate(`(() => { const root = document.documentElement; root.dataset.theme = ${JSON.stringify(scheme)}; root.style.colorScheme = ${JSON.stringify(scheme)}; })()`);
  await page.wait(300);
};
const dispatch = (action: object) => page.evaluate(`window.xfStudioPresentation.authoring.dispatch(${JSON.stringify(action)})`);
const panelWindow = (id: string) => `document.getElementById("dock-tab-${id}")?.closest(".dock-window, .dock-group")`;
/** A switch's input by its label's words, turned on or off (a click, so it goes through the control as a person's would). */
const setSwitch = (words: string, on: boolean) => page.evaluate(`(() => { const row = [...document.querySelectorAll(".toggle-row")].find(r => r.textContent.includes(${JSON.stringify(words)}));
  const input = row?.querySelector("input"); if (input && input.checked !== ${on}) input.click(); return !!input; })()`);
/** The panels, each with what to set first so its changed controls show. */
const PANELS: { id: string; prepare?: () => Promise<unknown> }[] = [
  { id: "settings" },
  { id: "lighting" },
  { id: "quality" },
  { id: "character", prepare: () => page.evaluate(`(() => { const b = [...document.querySelectorAll("[aria-expanded]")].find(e => /^\\s*Hairstyle/.test(e.textContent ?? "")); if (b?.getAttribute("aria-expanded") === "false") b.click(); return !!b; })()`) },
  // Pigment & edge: Point blend disabled (Smooth point gradients off), and Mottle on for its Segmented choices.
  { id: "edge", prepare: async () => { await setSwitch("Smooth point gradients", false); await setSwitch("Mottle", true); } },
  { id: "layers" },
  // The Expression drawer: Adjust all › Intensity's curve buttons (and, after, Transitions), with a natural sample started so it is live.
  { id: "expressions.controls", prepare: async () => {
    await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
    await page.wait(800);
    await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
    await page.waitFor(`document.querySelectorAll(".expr-drawer .tree-row").length > 0`, 120000).catch(() => {});
    await page.evaluate(`(() => { const row = [...document.querySelectorAll(".expr-drawer .tree-row")].find(r => r.textContent.includes("Warm smile")); row?.click(); })()`);
  } },
].filter(panel => !process.env.PANELS || process.env.PANELS.split(",").includes(panel.id));
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  log("page ready");
  await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 300000).catch(() => {});
  await dispatch({ kind: "preview.setBody", enabled: false }).catch(() => {});
  await page.evaluate(MASK_VIEWPORTS);
  log("preview ready");
  for (const panel of PANELS) {
    // A module's panel is revealed by its prepare, once the module shows (revealing it hidden offers to show it in a notice).
    if (!panel.id.includes(".")) await page.evaluate(`window.xfStudioShell.dock.reveal(${JSON.stringify(panel.id)})`);
    await page.wait(1200);
    await panel.prepare?.();
    await page.wait(800);
    for (const width of [300, 480]) {
      await page.evaluate(`window.xfStudioShell.dock.moveTo(${JSON.stringify(panel.id)}, { kind: "float", x: ${1420 - width}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.wait(700);
      for (const scheme of ["dark", "light"] as const) {
        await theme(scheme);
        await snap(`${panel.id}-${width}-${scheme}`, panelWindow(panel.id));
      }
    }
    log(panel.id);
  }
  // The style guide's specimens of the changed components (its own file, as committed on this checkout).
  if (!process.env.NO_GUIDE) {
  await page.send("Page.navigate", { url: `file:///${resolve(import.meta.dir, "..", "public", "style-guide.html").replaceAll("\\", "/")}` });
  await page.waitFor(`!!document.getElementById("lib-segmented")`, 30000);
  await page.wait(800);
  for (const [id, selector] of [["lib-segmented", `document.querySelector("#lib-segmented .live-specimen")`], ["lib-scrub", `document.querySelector("#lib-scrub .live-specimen")`],
    ["c-result", `document.querySelector("#c-result .specimen, #c-result .live-specimen")`], ["lib-item-list", `document.querySelector("#lib-item-list .live-specimen")`],
    ["lib-slider", `document.querySelector("#lib-slider .live-specimen")`], ["lib-slider-value", `document.querySelector("#lib-slider-value .live-specimen")`]] as const) {
    for (const scheme of ["dark", "light"] as const) {
      await theme(scheme);
      await page.evaluate(`document.getElementById(${JSON.stringify(id)})?.scrollIntoView({ block: "start" })`);
      await page.wait(300);
      await snap(`guide-${id}-${scheme}`, selector);
    }
  }
  }
  writeFileSync(resolve(out, `${label}-run.json`), JSON.stringify({ date: new Date().toISOString(), shots,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  // Compare sheets: before and after side by side, one per capture both runs have.
  if (label === "after" && compare) {
    let sheets = 0;
    for (const name of shots) {
      const before = resolve(compare, `before-${name}.png`), after = resolve(out, `after-${name}.png`);
      if (!existsSync(before)) continue;
      const img = (path: string) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;
      const html = `<html><body style="margin:0;background:#15181c;font:600 14px system-ui;color:#e6e8eb"><div id="s" style="display:inline-flex;gap:16px;padding:12px;align-items:flex-start">
        <figure style="margin:0"><figcaption style="margin-bottom:6px">Before (e1e91c2) · ${name}</figcaption><img src="${img(before)}" style="display:block"></figure>
        <figure style="margin:0"><figcaption style="margin-bottom:6px">After · ${name}</figcaption><img src="${img(after)}" style="display:block"></figure></div></body></html>`;
      const file = resolve(out, `compare-${name}.html`);
      writeFileSync(file, html);
      await page.viewport(2400, 1100);
      await page.send("Page.navigate", { url: `file:///${file.replaceAll("\\", "/")}` });
      await page.wait(600);
      const clip = await box(`document.getElementById("s")`);
      if (clip) { await page.screenshot(resolve(out, `compare-${name}.png`), clip); sheets++; }
    }
    log(`${sheets} compare sheets`);
  }
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
