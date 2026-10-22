/**
 * Captures of profiles 1e's visible change for the UI review (phase 1f): the header's Undo and Redo and the History panel, which name the
 * editing context ("Changes to <name>"), and "Nothing to undo here yet". Light and dark, at a narrow and a wide window, in an isolated
 * `?verify=1` workspace on a server of its own (its own data folder, so its own library, never the person's), in a headless Chrome.
 *   bun tools/history-captures.ts <data-dir> <out-dir> [port=4393]
 *
 * States, the pointer resting on the header's Undo each time (an unavailable Undo shows its reason): `fresh` (the starter preset, nothing
 * changed), `edited` (a layer added: one step), `no-preset` (the only preset removed: the editor shows no look), `new-preset` (a preset
 * added after that). Writes `<state>-<part>-<scheme>-<width>.png`
 * (part: `header`, `history`) and `texts.json`, the tooltips and accessible names, which a capture can't show (they are the browser's own
 * tooltips).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../../projects/xf-studio/authoring/tools/cdp";

const [dataArg, outArg, portArg] = process.argv.slice(2);
if (!dataArg || !outArg) throw Error("Usage: bun tools/history-captures.ts <data-dir> <out-dir> [port]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4393);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = resolve(import.meta.dir, "..", "..", "..", "projects", "xf-studio", "authoring");

/** The header's and the History panel's Undo and Redo as the page has them now: tooltip, accessible name, reason; the list's name. */
const TEXTS = `(() => {
  const read = button => button && { title: button.title, label: button.getAttribute("aria-label"), reason: button.dataset.reason ?? null };
  const header = [...document.querySelectorAll(".history-controls button")], panel = document.querySelector(".history-panel");
  const named = text => panel && [...panel.querySelectorAll(".list-head button")].find(button => button.textContent.trim() === text);
  return { header: { undo: read(header[0]), redo: read(header[1]) }, history: panel && { undo: read(named("Undo")), redo: read(named("Redo")),
    list: panel.querySelector(".history-list")?.getAttribute("aria-label") ?? null, summary: panel.querySelector(".count")?.textContent ?? null },
    tip: document.querySelector(".reason-tip:not([hidden])")?.textContent ?? null };
})()`;
/** A rectangle around the elements `selectors` name (those present and shown), in page coordinates. */
const clip = async (page: Session, selectors: string[], pad = 6) => await page.evaluate(`(() => {
  const rects = ${JSON.stringify(selectors)}.map(s => document.querySelector(s)).filter(e => e && !e.hidden).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  const x = Math.max(0, Math.min(...rects.map(r => r.left)) - ${pad}), y = Math.max(0, Math.min(...rects.map(r => r.top)) - ${pad});
  const right = Math.min(innerWidth, Math.max(...rects.map(r => r.right)) + ${pad}), bottom = Math.min(innerHeight, Math.max(...rects.map(r => r.bottom)) + ${pad});
  return { x: x + scrollX, y: y + scrollY, width: right - x, height: bottom - y };
})()`) as { x: number; y: number; width: number; height: number };
const press = (page: Session, find: string) => page.evaluate(`(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`);
const byLabel = (label: string) => `[...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)})`;

const texts: Record<string, unknown> = {}, shots: string[] = [];
for (const [width, size] of [["narrow", 420], ["wide", 1440]] as const) {
  // Each width starts from an empty workspace and library.
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  const server = Bun.spawn([process.execPath, "server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off" } });
  try {
    for (let i = 0; i < 240; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* starting */ }
      await Bun.sleep(250);
    }
    const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: size, height: 900, scheme: "light" });
    try {
      await page.waitFor(`!!document.querySelector(".history-controls button") && !!document.querySelector('[data-panel="history"]')`, 60_000);
      await page.wait(3_000);
      // The 3D view's setup card is declined (this workspace's own preference), so it doesn't cover the panels.
      await press(page, byLabel("Not now"));
      await press(page, `document.querySelector('[data-panel="history"]')`);
      const capture = async (state: string) => {
        for (const scheme of ["light", "dark"] as const) {
          await page.colorScheme(scheme);
          await page.evaluate(`(() => { const root = document.documentElement; root.dataset.theme = ${JSON.stringify(scheme)}; root.style.colorScheme = ${JSON.stringify(scheme)}; })()`);
          await page.wait(300);
          // The pointer resting on the header's Undo: unavailable, it shows its reason in the page's reason tip.
          const at = await page.evaluate(`(() => { const r = document.querySelector(".history-controls button").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number];
          await page.mouse("mouseMoved", 1, 1, { button: "none" });
          await page.mouse("mouseMoved", at[0], at[1], { button: "none" });
          await page.wait(400);
          texts[`${state}-${scheme}-${width}`] = await page.evaluate(TEXTS);
          for (const [part, selectors] of [["header", [".history-controls", ".reason-tip:not([hidden])"]], ["history", [".history-panel"]]] as const) {
            if (part === "history") {
              await page.mouse("mouseMoved", 1, 1, { button: "none" });
              await page.wait(200);
            }
            const name = `${state}-${part}-${scheme}-${width}`;
            const area = part === "header" ? await clip(page, [".history-controls", ".reason-tip:not([hidden])"], 40) : await clip(page, [...selectors]);
            if (area.width > 0 && area.height > 0) { await page.screenshot(join(out, `${name}.png`), area); shots.push(name); }
          }
        }
        await page.colorScheme("light");
      };
      await capture("fresh");
      if (!(await press(page, byLabel("Add layer")))) throw Error("No Add layer button.");
      await page.wait(800);
      await capture("edited");
      await press(page, `document.querySelector('[data-panel="presets"]')`);
      await page.wait(300);
      if (!(await press(page, byLabel("More actions for Preset 1")))) throw Error("No preset menu.");
      await page.wait(300);
      if (!(await press(page, `[...document.querySelectorAll("[role=menuitem]")].find(m => m.textContent.trim().startsWith("Remove preset"))`))) throw Error("No Remove preset.");
      await page.wait(800);
      await press(page, `document.querySelector('[data-panel="history"]')`);
      await page.wait(300);
      await capture("no-preset");
      await press(page, `document.querySelector('[data-panel="presets"]')`);
      await page.wait(300);
      if (!(await press(page, byLabel("Add preset")))) throw Error("No Add preset button.");
      await page.wait(800);
      await press(page, `document.querySelector('[data-panel="history"]')`);
      await page.wait(300);
      await capture("new-preset");
    } finally { await page.close(); }
  } finally { server.kill(); await server.exited; }
}
writeFileSync(join(out, "texts.json"), JSON.stringify(texts, null, 1));
rmSync(data, { recursive: true, force: true });
console.log(JSON.stringify({ out, shots }));
process.exit(0);
