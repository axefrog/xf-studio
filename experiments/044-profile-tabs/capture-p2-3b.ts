/**
 * P2-iii-b's UI captures for the design review (README §11): a tab with two 3D views, one drawn and one not (U7), light and dark, at a
 * narrow and a wide pane, beside the style guide's Setup card and head pane states (c-setup) and Viewport overlays (c-viewport); then Show
 * here, and where the canvas went. In an isolated `?verify=1` workspace with a throwaway headless Chrome, against an authoring server
 * already running on its own port with its own data folder (never 4317 or 4331).
 *
 *   bun experiments/044-profile-tabs/capture-p2-3b.ts <port> <out dir>
 *
 * The second view is added through the verification hook `xfStudioAddView` (it shares the drawn view's scene). `run.json` records, per
 * capture, each 3D view pane's drawn state, accessible name and whether it holds the canvas (`#device-head`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "../../projects/xf-studio/authoring/tools/cdp";

const [portArg, outArg] = process.argv.slice(2);
const port = Number(portArg);
if (!port || port === 4317 || port === 4331 || !outArg) throw Error("Usage: capture-p2-3b.ts <port (not 4317/4331)> <out dir>");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const PANES = `(() => [...document.querySelectorAll(".viewport-panel:not(.uv)")].filter(el => el.isConnected && el.closest(".dock")).map(el => {
  const r = el.getBoundingClientRect();
  return { drawn: el.dataset.drawn ?? null, name: el.getAttribute("aria-label")?.slice(0, 80) ?? null, canvas: !!el.querySelector("#device-head"),
    idle: !(el.querySelector('.viewport-state[data-tone="idle"]')?.hidden ?? true), width: Math.round(r.width), height: Math.round(r.height),
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
}))()`;
const runs: Record<string, unknown> = {};

for (const scheme of ["light", "dark"] as const) {
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: 900, scheme, debugPort: port + 5100 + (scheme === "dark" ? 1 : 0) });
  try {
    await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
    await page.wait(800);
    // The setup card's Not now: the pane then says what it needs itself (its own state is what the review compares).
    await page.evaluate(`[...document.querySelectorAll(".setup-card button")].find(b => /Not now/.test(b.textContent))?.click()`);
    const views = await page.evaluate(`window.xfStudioPresentation.views.snapshot().views.length`);
    if (views < 2) await page.evaluate(`window.xfStudioAddView("Side view")`);
    await page.waitFor(`document.querySelectorAll(".viewport-panel:not(.uv)").length >= 2`, 10000);
    const second = await page.evaluate(`window.xfStudioPresentation.views.snapshot().views.find(v => v.panel !== "head").panel`);
    for (const [size, side] of [["wide", "bottom"], ["narrow", "right"]] as const) {
      await page.evaluate(`(() => { const dock = window.xfStudioShell.dock; dock.reset();
        const group = [...document.querySelectorAll(".dock-group")].find(g => g.querySelector('[data-panel="head"]'))?.dataset.group ?? "g-head";
        dock.moveTo(${JSON.stringify(second)}, { kind: "split", groupId: group, side: "${side}" }, ""); })()`);
      // Draw the main view (a press in its pane), so the side view is the one not drawn.
      await page.evaluate(`window.xfStudioPresentation.focus.view("main")`);
      await page.wait(700);
      const panes = await page.evaluate(PANES) as { rect: { x: number; y: number; w: number; h: number } }[];
      const box = panes.reduce((acc, pane) => ({ x: Math.min(acc.x, pane.rect.x), y: Math.min(acc.y, pane.rect.y),
        r: Math.max(acc.r, pane.rect.x + pane.rect.w), b: Math.max(acc.b, pane.rect.y + pane.rect.h) }), { x: 1e9, y: 1e9, r: 0, b: 0 });
      const clip = { x: box.x, y: Math.max(0, box.y - 34), width: box.r - box.x, height: box.b - box.y + 34 };
      const name = `${scheme}-${size}`;
      await page.screenshot(resolve(out, `${name}-two-views.png`), clip);
      runs[`${name}-two-views`] = { panes };
      // Hover over the pane that isn't drawn (F2: only its background changes).
      const idle = (await page.evaluate(PANES) as { idle: boolean; rect: { x: number; y: number; w: number; h: number } }[]).find(pane => pane.idle);
      if (idle) {
        await page.mouse("mouseMoved", idle.rect.x + idle.rect.w / 2, idle.rect.y + 20, { button: "none", buttons: 0 });
        await page.wait(300);
        await page.screenshot(resolve(out, `${name}-not-drawn-hover.png`), { x: idle.rect.x, y: idle.rect.y, width: idle.rect.w, height: idle.rect.h });
        await page.mouse("mouseMoved", 5, 5, { button: "none", buttons: 0 });
      }
      // Show here: the side view is drawn and the canvas moves to its pane; the main view's pane shows that it isn't drawn.
      await page.evaluate(`[...document.querySelectorAll('.viewport-state[data-tone="idle"]')].find(el => !el.hidden)?.querySelector(".btn")?.click()`);
      await page.wait(900);
      await page.screenshot(resolve(out, `${name}-after-show-here.png`), clip);
      runs[`${name}-after-show-here`] = { panes: await page.evaluate(PANES) };
    }
    await page.screenshot(resolve(out, `${scheme}-workspace.png`));
    // The patterns it extends, from the style guide at the same scheme.
    await page.viewport(1600, 1600);
    await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/style-guide.html` });
    await page.waitFor(`!!document.getElementById("c-setup")`, 30000);
    await page.wait(600);
    for (const id of ["c-setup", "c-viewport"]) {
      const rect = await page.evaluate(`(() => { const el = document.getElementById("${id}"); el.scrollIntoView(); const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(Math.min(r.height, 1600 - r.top)) }; })()`);
      await page.wait(200);
      await page.screenshot(resolve(out, `${scheme}-guide-${id}.png`), rect);
    }
    runs[`${scheme}-console`] = page.console.filter(entry => entry.type === "error" || entry.type === "exception").slice(0, 20);
  } finally { await page.close(); }
}
writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), port, runs }, null, 2));
console.log(`Wrote captures to ${out}`);
