/**
 * Captures of saved layouts (research/authoring/view-graph-design.md §4.5; style guide d-layouts and c-popover) for design review, in an
 * isolated `?verify=1` workspace with a throwaway Chrome profile, against an authoring server already running on its own port with its
 * own data and settings folders (never 4317 or the person's draft). Viewports are masked (MASK_VIEWPORTS), so no capture holds V or game
 * imagery.
 *
 *   bun tools/layouts-look.ts <out dir under evidence/screenshots> [port] [light|dark]
 *
 * Scenarios, at a wide (1600 px) and a narrow (1000 px, compact) window: the Layouts menu; the Save layout popover with its options; a
 * switch between two layouts (before and after, each with the menu open on the current layout); the automatic switch's notice when the
 * window becomes compact. Each live capture is also composed side by side with the style-guide pattern it follows (`*-vs-guide.png`).
 * `run.json` records measurements: the header button's label, the active layout, the modules shown and each group's panels.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS } from "./cdp";

const [outArg, portArg = "4471", schemeText = "dark"] = process.argv.slice(2);
const schemeArg = schemeText as "light" | "dark";
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/layouts-look.ts <out dir> [port] [light|dark]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg, base = `http://127.0.0.1:${port}`;
const page = await launch(`${base}/?verify=1`, { width: 1600, height: 900, scheme: schemeArg, debugPort: port + 5200 });
const runs: Record<string, unknown> = {};
const shell = "window.xfStudioShell";
const measure = `(() => { const s = ${shell}, lib = s.layouts.library();
  return { button: document.querySelector('.layouts-btn')?.getAttribute('aria-label'), buttonText: document.querySelector('.layouts-btn span')?.textContent,
    active: lib.layouts.find(l => l.id === lib.active)?.name, layouts: lib.layouts.map(l => l.name), modified: s.layouts.modified(),
    modules: s.runtime.shownModules(), groups: [...document.querySelectorAll('.dock-group')].map(g => [...g.querySelectorAll('.dock-tab')].map(t => t.dataset.panel)) }; })()`;
const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  await page.wait(450);
  await page.screenshot(resolve(out, `${name}.png`), clip);
  runs[name] = await page.evaluate(measure);
};
const openMenu = async () => { await page.evaluate(`document.querySelector('.layouts-btn').click()`); await page.wait(250); };
const closeMenus = async () => { await page.key("Escape"); await page.wait(150); };
const clickMenu = (label: string) => page.evaluate(`[...document.querySelectorAll('.menu-layer .menu-item')].find(e => e.querySelector('.menu-label')?.textContent === ${JSON.stringify(label)})?.click()`);

/** The style guide's specimen for a pattern, captured at its own size. */
async function guideSpecimen(id: string, name: string) {
  const guide = await launch(`${base}/style-guide.html`, { width: 1500, height: 1600, scheme: schemeArg, debugPort: port + 5210 });
  try {
    await guide.waitFor(`document.getElementById(${JSON.stringify(id)})`, 30000);
    await guide.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(schemeArg)}; document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "start" })`);
    await guide.wait(400);
    // The clip is in document coordinates: the scroll offset is added to the element's viewport box.
    const rect = await guide.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: Math.min(r.width, 1500), height: Math.min(r.height, 1600) }; })()`);
    await guide.screenshot(resolve(out, `${name}.png`), rect);
  } finally { await guide.close(); }
}
/** Two captures side by side on one image: the live Studio (left) and the pattern it follows (right). */
async function compose(name: string, left: string, right: string, caption: string) {
  const data = (file: string) => `data:image/png;base64,${readFileSync(resolve(out, `${file}.png`)).toString("base64")}`;
  const board = await launch("about:blank", { width: 2400, height: 1200, scheme: schemeArg, debugPort: port + 5220 });
  try {
    await board.evaluate(`(async () => { document.body.style.cssText = "margin:0;background:${schemeArg === "dark" ? "#101317" : "#eef0f2"};font:14px system-ui;color:${schemeArg === "dark" ? "#dfe3e8" : "#1d2229"}";
      document.body.innerHTML = '<div id="b" style="display:inline-flex;gap:24px;padding:16px;align-items:flex-start"><figure style="margin:0"><img id="l"><figcaption>Live (${caption})</figcaption></figure><figure style="margin:0"><img id="r"><figcaption>Style guide pattern</figcaption></figure></div>';
      document.getElementById("l").src = ${JSON.stringify(data(left))}; document.getElementById("r").src = ${JSON.stringify(data(right))};
      await Promise.all([...document.images].map(i => i.decode())); return true; })()`);
    const rect = await board.evaluate(`(() => { const r = document.getElementById("b").getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    await board.viewport(Math.max(800, rect.width), Math.max(600, rect.height));
    await board.wait(200);
    await board.screenshot(resolve(out, `${name}.png`), rect);
  } finally { await board.close(); }
}
/** The menu's box plus the header, for a tighter capture. */
const menuClip = async () => page.evaluate(`(() => { const m = document.querySelector('.menu-layer .menu, .menu-layer .popover')?.getBoundingClientRect(), b = document.querySelector('.layouts-btn').getBoundingClientRect();
  const x = Math.max(0, Math.min(m?.left ?? b.left, b.left) - 16), right = Math.max(m?.right ?? b.right, b.right) + 16, bottom = (m?.bottom ?? b.bottom) + 16;
  return { x, y: 0, width: Math.min(innerWidth, right) - x, height: Math.min(innerHeight, bottom) }; })()`);

try {
  await page.waitFor(`document.querySelector('.dock-group') && !!${shell}?.layouts`, 120000);
  await page.evaluate(MASK_VIEWPORTS);
  // The 3D preview's setup card names the game folder: hidden, so no capture holds a local path.
  await page.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '.setup-card-title{visibility:hidden} *:has(> .setup-card-title){display:none!important}'; document.head.append(s); return true; })()`);
  await page.evaluate(`${shell}.dock.reset()`);
  // Two layouts: the factory one as "Eye makeup", and "Posing" with Poses shown, eye makeup hidden and History floating.
  await page.evaluate(`(() => { const s = ${shell}; s.layouts.update(); const first = s.layouts.library().layouts[0]; if (first.name !== "Eye makeup") s.runtime.port.preferences.dispatch({ kind: "layouts.rename", id: first.id, name: "Eye makeup", shown: Object.fromEntries(s.runtime.modules.list.map(m => [m.id, s.runtime.shownModules().includes(m.id)])) }); return true; })()`);
  await page.evaluate(`(() => { const s = ${shell}; s.runtime.modules.set("poses", true); s.runtime.modules.set("eye-makeup", false); s.dock.float("history"); s.layouts.saveNamed("Posing", true); return true; })()`);
  await page.evaluate(`(() => { const s = ${shell}; s.layouts.switchTo(s.layouts.library().layouts[0].id); s.dock.toggleCollapse("finish"); return true; })()`);
  await page.wait(600);
  // 1. The menu (wide), on "Eye makeup" with an unsaved change (a collapsed group).
  await shot("1-wide-before-switch");
  await openMenu();
  await shot("2-wide-menu", await menuClip());
  // 2. The Save layout popover.
  await clickMenu("Save as new layout…");
  await page.wait(300);
  await shot("3-wide-save-popover", await menuClip());
  await closeMenus();
  // 3. Switch to Posing: after (Eye makeup's change is kept with it).
  await openMenu();
  await clickMenu("Posing");
  await page.wait(700);
  await shot("4-wide-after-switch");
  await openMenu();
  await shot("5-wide-menu-after-switch", await menuClip());
  await closeMenus();
  // 4. Narrow: a layout chosen for compact windows is switched to when the window narrows; the header shows the icon only.
  await page.evaluate(`(() => { const s = ${shell}; s.layouts.switchTo(s.layouts.library().layouts[0].id); s.layouts.saveNamed("Laptop", true, "compact"); s.layouts.switchTo(s.layouts.library().layouts[0].id); return true; })()`);
  await page.viewport(1000, 800); await page.wait(900);
  await shot("6-narrow-auto-switch");
  await openMenu();
  await shot("7-narrow-menu", await menuClip());
  await closeMenus();
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), scheme: schemeArg, runs,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
} finally { await page.close(); }
// Side by side with the patterns they follow.
await guideSpecimen("d-layouts", "guide-d-layouts");
await guideSpecimen("c-popover", "guide-c-popover");
await compose("2-wide-menu-vs-guide", "2-wide-menu", "guide-d-layouts", `wide, ${schemeArg}`);
await compose("3-wide-save-popover-vs-guide", "3-wide-save-popover", "guide-d-layouts", `wide, ${schemeArg}`);
await compose("7-narrow-menu-vs-guide", "7-narrow-menu", "guide-d-layouts", `narrow, ${schemeArg}`);
console.log(`Wrote captures to ${out}`);
