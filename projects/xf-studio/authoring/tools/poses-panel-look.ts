/**
 * Captures of the Poses panel (features/poses/view/panel.ts) for design review, in an isolated `?verify=1` workspace with a throwaway
 * Chrome profile, against an authoring server that is already running on its own port with its own data folder (never 4317 or the
 * person's draft). The panel floats at a narrow (300 px) and a wide (480 px) width, in the light and dark themes, through its states:
 * the tree as it opens, a group expanded, a favourite starred with Recent, a held pose, search results and the outfit filter's "Show them"
 * state; and beside the Character panel's first open choice row, for consistency. The 3D view is masked (MASK_VIEWPORTS), so no capture
 * holds V or game imagery; the tree shows installed mods' pose and pack names, so keep the outputs in the ignored evidence tree.
 *
 *   bun tools/poses-panel-look.ts <out dir under evidence/screenshots> [port]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS } from "./cdp";

const [outArg, portArg = "4466"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/poses-panel-look.ts <out dir> [port]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark", debugPort: port + 5000 });
const shots: string[] = [];
const snap = async (name: string, selector: string) => {
  const box = await page.evaluate(`(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`);
  if (!box) return;
  await page.screenshot(resolve(out, `${name}.png`), box as never);
  shots.push(name);
};
const poses = `window.xfStudioPresentation.module("poses")`;
const panelWindow = `document.querySelector(".poses-panel")?.closest(".dock-window, .dock-group")`;
const dispatch = (action: object) => page.evaluate(`${poses}.dispatch(${JSON.stringify(action)})`);
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  await page.evaluate(MASK_VIEWPORTS);
  // The body isn't needed for the panel (and is masked anyway): turning it off keeps Chrome's memory small. A pose still plays on the rig.
  await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 240000);
  await page.evaluate(`window.xfStudioPresentation.authoring.dispatch({ kind: "preview.setBody", enabled: false })`);
  // Poses is a module hidden by default: show it, float it, and wait for the catalogue.
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("poses", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("poses.library")`);
  await page.waitFor(`${poses}.snapshot().catalogue.phase === "ready"`, 240000);
  // A clean slate for the verification copy: no favourites or recent from earlier runs, every group closed.
  const prefs = await page.evaluate(`${poses}.snapshot().preferences`) as { favourites: { id: string }[]; open: string[] };
  for (const item of prefs.favourites) await dispatch({ kind: "pose.favourite", id: item.id, on: false });
  for (const group of prefs.open) await dispatch({ kind: "pose.openGroup", group, open: false });
  await page.waitFor(`!!window.xfStudioPresentation.snapshot`, 1000);
  const first = await page.evaluate(`(() => { const t = ${poses}.tree(""); const g = t.groups.find(g => g.kind === "category" && g.rows.some(r => !r.unavailable && !r.badges.length)); return g ? { group: g.id, pose: g.rows.find(r => !r.unavailable && !r.badges.length).id } : null; })()`) as { group: string; pose: string };
  const second = await page.evaluate(`(() => { const t = ${poses}.tree(""); const g = t.groups.find(g => g.kind === "category" && g.rows.some(r => r.badges.length)); return g ? { group: g.id, pose: g.rows.find(r => r.badges.length).id } : null; })()`) as { group: string; pose: string };
  // Poses play once V's motion is prepared; until then a selection is refused.
  await page.waitFor(`${poses}.snapshot().playable.available`, 240000).catch(() => {});
  // The held pose, a favourite and Recent (only then does Recent exist).
  await dispatch({ kind: "pose.select", id: second.pose });
  await dispatch({ kind: "pose.select", id: first.pose });
  await dispatch({ kind: "pose.favourite", id: first.pose, on: true });
  // Clothes with an outfit tag aren't guaranteed on the verification V: "Show them" is captured when it appears.
  for (const scheme of ["dark", "light"] as const) {
    await page.colorScheme(scheme);
    for (const width of [300, 480]) {
      await page.evaluate(`window.xfStudioShell.dock.moveTo("poses.library", { kind: "float", x: ${1420 - width}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.wait(600);
      const tag = `${scheme}-${width}`;
      // Standing still: Stand still pressed, and the status line empty (UI-127); then the pose again.
      await dispatch({ kind: "pose.clear", to: "still" });
      await page.wait(400);
      await snap(`${tag}-still`, panelWindow);
      await dispatch({ kind: "pose.select", id: first.pose });
      await page.wait(600);
      await snap(`${tag}-open`, panelWindow);
      await dispatch({ kind: "pose.openGroup", group: first.group, open: true });
      await page.wait(400);
      await snap(`${tag}-group-expanded-held-favourite`, panelWindow);
      // Hover and focus on a row (the tree's own states).
      // Keyboard focus (so :focus-visible applies): from the search field, Down enters the tree, Down again moves to the next item.
      await page.evaluate(`document.querySelector(".poses-panel input.search-input").focus()`);
      await page.key("ArrowDown"); await page.wait(150); await page.key("ArrowDown"); await page.key("ArrowDown");
      await page.wait(250);
      await snap(`${tag}-row-focus`, panelWindow);
      await page.evaluate(`(() => { const s = document.querySelector(".poses-panel input.search-input"); s.value = "stand"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await page.wait(700);
      await snap(`${tag}-search`, panelWindow);
      await page.evaluate(`(() => { const s = document.querySelector(".poses-panel input.search-input"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await page.wait(400);
      if (await page.evaluate(`!document.querySelector(".poses-outfit")?.hidden`)) {
        await dispatch({ kind: "pose.showFiltered", shown: true }); await page.wait(300);
        await snap(`${tag}-outfit-shown`, panelWindow);
        await dispatch({ kind: "pose.showFiltered", shown: false });
      }
      await dispatch({ kind: "pose.openGroup", group: first.group, open: false });
    }
  }
  // Beside the Character panel: dock Poses back and put the two in the view side by side, Character's first choice row open.
  await page.colorScheme("dark");
  await page.evaluate(`window.xfStudioShell.dock.moveTo("character", { kind: "float", x: 520, y: 40, w: 440, h: 900 }, "")`);
  await page.evaluate(`window.xfStudioShell.dock.moveTo("poses.library", { kind: "float", x: 980, y: 40, w: 440, h: 900 }, "")`);
  await dispatch({ kind: "pose.openGroup", group: first.group, open: true });
  await page.waitFor(`document.querySelectorAll(".cc-row").length > 0`, 240000);
  await page.evaluate(`(() => { const main = document.querySelector(".cc-row:not([hidden]) .cc-row-main"); if (main?.getAttribute("aria-expanded") !== "true") main?.click(); })()`);
  await page.waitFor(`document.querySelectorAll(".cc-choice").length > 0`, 60000).catch(() => {});
  await page.wait(2500);
  await page.screenshot(resolve(out, "side-by-side-character.png"), { x: 510, y: 30, width: 920, height: 920 } as never);
  shots.push("side-by-side-character");
  // Motion › Body while a pose is held: its own pressed button ("Pose: …") and the line under it.
  await page.evaluate(`window.xfStudioShell.dock.moveTo("motion", { kind: "float", x: 60, y: 40, w: 420, h: 520 }, "")`);
  await page.wait(800);
  await snap("motion-body-pose", `document.querySelector('[data-panel-body="motion"], #dock-panel-motion') ?? [...document.querySelectorAll(".dock-window")].find(w => w.textContent.includes("Game idle"))`);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), shots, first, second,
    console: page.console.filter(m => m.type === "error").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); }
