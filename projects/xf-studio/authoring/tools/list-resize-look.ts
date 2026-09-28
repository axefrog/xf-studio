/**
 * Captures of the Size bar (components/size-bar.ts) for design review, in an isolated `?verify=1` workspace with a throwaway Chrome
 * profile and its own authoring server (own port, own data folder; never 4317 or the person's draft). The Expression drawer's Start
 * from list floats beside the Camera & light panel's direction dial (the resize-bar pattern it follows) at a narrow (300 px) and a wide
 * (480 px) width in both themes: before (the bar hidden, as on main), at its default height, the bar hovered, the bar keyboard-focused
 * (reached with Tab) and enlarged by a real pointer drag (7 rows and a bit, snapped to 7); the height after a reload; the Poses tree and
 * the Save Explorer's node tree, at their defaults and shrunk by a real drag; then the style guide's specimen at both widths. It also measures that
 * hovering moves nothing and that a drag moves nothing above the list (`run.json`). The 3D view is masked (MASK_VIEWPORTS); the Start
 * from tree lists installed mods' expression names, so keep outputs in an ignored folder.
 *
 *   bun tools/list-resize-look.ts <out dir> [port]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, startServer } from "./cdp";

const [outArg, portArg = "4499"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/list-resize-look.ts <out dir> [port]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark", debugPort: port + 5000 });
const shots: string[] = [];
const measures: Record<string, unknown> = {};
const t0 = Date.now();
const log = (what: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s: ${what}`);
type Box = { x: number; y: number; width: number; height: number };
const rect = (selector: string) => page.evaluate(`(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`) as Promise<Box | null>;
/** A box in page coordinates (a screenshot's clip), for a page that scrolls itself (the style guide). */
const pageRect = (selector: string) => page.evaluate(`(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect();
  return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: Math.min(r.height, 940) }; })()`) as Promise<Box | null>;
const theme = async (scheme: "light" | "dark") => {
  await page.colorScheme(scheme);
  await page.evaluate(`(() => { const root = document.documentElement; root.dataset.theme = ${JSON.stringify(scheme)}; root.style.colorScheme = ${JSON.stringify(scheme)}; })()`);
  await page.wait(300);
};
const BAR = `document.querySelector(".expr-drawer .size-bar")`;
const TREE = `document.querySelector(".expr-drawer .tree-view")`;
const HEAD = `document.querySelector('.expr-drawer [data-view-key="expressions.start-from"] .section-head')`;
const NEXT = `document.querySelector('.expr-drawer [data-view-key="expressions.transitions"]')`;
const windowOf = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.closest(".dock-window, .dock-group")`;
let dialShown = false;
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  log("page ready");
  await page.evaluate(MASK_VIEWPORTS);
  await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 240000).catch(() => {});
  await page.evaluate(`window.xfStudioPresentation.authoring.dispatch({ kind: "preview.setBody", enabled: false })`).catch(() => {});
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
  await page.waitFor(`document.querySelectorAll(".expr-drawer .tree-row").length > 0`, 300000).catch(() => {});
  log("drawer built");
  // The game's own expressions open too, so the list has more rows than its default six to show when enlarged.
  await page.evaluate(`(() => { const g = [...document.querySelectorAll(".expr-drawer .tree-group")].find(e => /The game/.test(e.textContent)); if (g?.getAttribute("aria-expanded") === "false") g.click(); })()`);
  await page.wait(300);
  // The direction dial: the creator lighting setup, its Main Face light selected.
  dialShown = await page.waitFor("window.xfStudioPresentation.authoring.previewState().lightingSetups", 120000).then(() => true, () => false);
  if (dialShown) {
    await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "preview.selectLightingSetup", setup: "creator" })`).catch(() => undefined);
    await page.evaluate(`window.xfStudioShell.dock.reveal("lighting")`).catch(() => undefined);
    await page.wait(1500);
    await page.evaluate(`(() => { const row = [...document.querySelectorAll(".light-list .item-main")].find(e => /Main Face/.test(e.textContent)) ?? document.querySelector(".light-list .item-main"); row?.click(); })()`);
    await page.wait(800);
    dialShown = !!(await rect(`document.querySelector(".dial-grip")`));
  }
  log(`dial shown: ${dialShown}`);
  for (const scheme of ["dark", "light"] as const) {
    await theme(scheme);
    for (const width of [300, 480]) {
      const tag = `${scheme}-${width}`, drawerX = 1420 - width, dialX = drawerX - width - 30;
      await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: ${drawerX}, y: 30, w: ${width}, h: 900 }, "")`);
      if (dialShown) await page.evaluate(`window.xfStudioShell.dock.moveTo("lighting", { kind: "float", x: ${dialX}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.wait(900);
      // Back to the default height, the drawer at its top, the dial's bar near the same height on screen.
      await page.evaluate(`(() => { ${BAR}?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); document.querySelector(".expr-drawer")?.scrollIntoView({ block: "start" });
        const list = document.querySelector(".expr-drawer .tree-scroll"); if (list) list.scrollTop = 0; })()`);
      await page.evaluate(`document.querySelector(".dial-grip")?.scrollIntoView({ block: "center" })`);
      await page.mouse("mouseMoved", 5, 950, { button: "none", buttons: 0 });
      await page.wait(500);
      const pair: Box = { x: (dialShown ? dialX : drawerX) - 10, y: 20, width: (dialShown ? 2 * width + 30 : width) + 20, height: 920 };
      const shot = async (name: string) => { await page.wait(350); await page.screenshot(resolve(out, `${tag}-${name}.png`), pair); shots.push(`${tag}-${name}`); log(`${tag} ${name}`); };
      // Before: the bar hidden, as on main.
      await page.evaluate(`(() => { const s = document.createElement("style"); s.id = "hide-bar"; s.textContent = ".expr-drawer .size-bar { display: none !important; }"; document.head.append(s); })()`);
      await shot("0-before");
      await page.evaluate(`document.getElementById("hide-bar")?.remove()`);
      await shot("1-default");
      // Hovered: the grip line lights; nothing moves (the next section's top before and after).
      const bar = (await rect(BAR))!, beforeHover = await rect(NEXT);
      await page.mouse("mouseMoved", bar.x + bar.width / 2, bar.y + bar.height / 2, { button: "none", buttons: 0 });
      await shot("2-hover");
      const afterHover = await rect(NEXT);
      measures[`${tag}-hover-shift`] = afterHover && beforeHover ? afterHover.y - beforeHover.y : null;
      await page.mouse("mouseMoved", 5, 950, { button: "none", buttons: 0 });
      // Keyboard focus: Tab from the search field, through the tree, to the bar.
      await page.evaluate(`document.querySelector('.expr-drawer [data-view-key="expressions.start-from"] input')?.focus()`);
      for (let i = 0; i < 4 && !(await page.evaluate(`document.activeElement?.classList.contains("size-bar")`)); i++) await page.key("Tab");
      measures[`${tag}-focus`] = await page.evaluate(`[document.activeElement?.className, document.activeElement?.matches(":focus-visible"), document.activeElement?.getAttribute("aria-valuetext")]`);
      await shot("3-focus");
      // Enlarged by a real drag, 7 rows down; the heading above never moves, the list and what follows move by the same amount.
      // Blurred, and the list back at its top (Tab left focus on the group opened above, scrolled into view).
      await page.evaluate(`(() => { document.activeElement?.blur(); const list = document.querySelector(".expr-drawer .tree-scroll"); if (list) list.scrollTop = 0; })()`);
      const headBefore = await rect(HEAD), treeBefore = await rect(TREE), nextBefore = await rect(NEXT);
      const from: [number, number] = [bar.x + bar.width / 2, bar.y + bar.height / 2], to: [number, number] = [from[0], from[1] + 203];
      let headDuring: Box | null = null;
      await page.drag(from, to, { steps: 12, hold: async (_x, _y, i) => { if (i === 6) headDuring = await rect(HEAD); } });
      await page.mouse("mouseMoved", 5, 950, { button: "none", buttons: 0 });
      const headAfter = await rect(HEAD), treeAfter = await rect(TREE), nextAfter = await rect(NEXT);
      measures[`${tag}-drag`] = { headShiftDuring: headDuring && headBefore ? (headDuring as Box).y - headBefore.y : null, headShift: headAfter && headBefore ? headAfter.y - headBefore.y : null,
        treeTopShift: treeAfter && treeBefore ? treeAfter.y - treeBefore.y : null, treeGrowth: treeAfter && treeBefore ? treeAfter.height - treeBefore.height : null,
        nextShift: nextAfter && nextBefore ? nextAfter.y - nextBefore.y : null,
        remembered: await page.evaluate(`window.xfStudioShell.preferences().sizes ?? null`).catch(() => null), valueText: await page.evaluate(`${BAR}?.getAttribute("aria-valuetext")`) };
      await shot("4-enlarged");
    }
  }
  // After a reload: the enlarged height comes back (the workspace's `sizes` preference), light at 480 px.
  const keptBefore = await page.evaluate(`window.xfStudioShell.preferences().sizes ?? null`);
  const heightBefore = (await rect(TREE))?.height ?? null;
  await page.send("Page.reload", {});
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  await page.evaluate(MASK_VIEWPORTS);
  await theme("light");
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
  await page.waitFor(`document.querySelectorAll(".expr-drawer .tree-row").length > 0`, 300000).catch(() => {});
  await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: 940, y: 30, w: 480, h: 900 }, "")`);
  await page.wait(900);
  await page.evaluate(`(() => { document.querySelector(".expr-drawer")?.scrollIntoView({ block: "start" }); const list = document.querySelector(".expr-drawer .tree-scroll"); if (list) list.scrollTop = 0; })()`);
  await page.wait(400);
  await page.screenshot(resolve(out, "light-480-5-after-reload.png"), { x: 930, y: 20, width: 500, height: 920 });
  shots.push("light-480-5-after-reload");
  measures.reload = { keptBefore, keptAfter: await page.evaluate(`window.xfStudioShell.preferences().sizes ?? null`), heightBefore, heightAfter: (await rect(TREE))?.height ?? null,
    valueText: await page.evaluate(`${BAR}?.getAttribute("aria-valuetext")`) };
  log(`after reload: ${JSON.stringify(measures.reload)}`);
  await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: 60, y: 30, w: 300, h: 300 }, "")`).catch(() => undefined);

  /** Captures of one panel's list with its bar, for each theme and width: the default, and shrunk by a real drag of `rows`. */
  const panelPass = async (name: string, panel: string, content: string, bar: string, list: string, rowPx: number, rows: number) => {
    for (const scheme of ["dark", "light"] as const) {
      await theme(scheme);
      for (const width of [300, 480]) {
        const tag = `${scheme}-${width}`, x = 1420 - width;
        await page.evaluate(`window.xfStudioShell.dock.moveTo(${JSON.stringify(panel)}, { kind: "float", x: ${x}, y: 30, w: ${width}, h: 900 }, "")`);
        await page.wait(900);
        await page.evaluate(`(() => { const b = ${bar}; b?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); document.querySelector(${JSON.stringify(content)})?.scrollIntoView({ block: "start" }); })()`);
        await page.mouse("mouseMoved", 5, 950, { button: "none", buttons: 0 });
        await page.wait(500);
        const clip = { x: x - 10, y: 20, width: width + 20, height: 920 };
        await page.screenshot(resolve(out, `${tag}-${name}-1-default.png`), clip); shots.push(`${tag}-${name}-1-default`);
        const b = await rect(bar), before = await rect(list);
        if (!b || !before) { log(`${name}: no bar`); continue; }
        const from: [number, number] = [b.x + b.width / 2, b.y + b.height / 2];
        await page.drag(from, [from[0], from[1] - rows * rowPx - 6], { steps: 10 });
        await page.mouse("mouseMoved", from[0], from[1] - rows * rowPx, { button: "none", buttons: 0 });
        await page.wait(400);
        await page.screenshot(resolve(out, `${tag}-${name}-2-shrunk-hover.png`), clip); shots.push(`${tag}-${name}-2-shrunk-hover`);
        const after = await rect(list);
        measures[`${tag}-${name}`] = { topShift: after!.y - before.y, heightChange: after!.height - before.height,
          valueText: await page.evaluate(`${bar}?.getAttribute("aria-valuetext")`) };
        await page.mouse("mouseMoved", 5, 950, { button: "none", buttons: 0 });
        log(`${tag} ${name}: ${JSON.stringify(measures[`${tag}-${name}`])}`);
      }
    }
    await page.evaluate(`(() => { const b = ${bar}; b?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
    await page.evaluate(`window.xfStudioShell.dock.moveTo(${JSON.stringify(panel)}, { kind: "float", x: 60, y: 30, w: 300, h: 300 }, "")`).catch(() => undefined);
  };
  // The Poses tree: 20 rows by default; shrunk by 8.
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("poses", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("poses.library")`);
  if (await page.waitFor(`document.querySelectorAll(".poses-panel .tree-item").length > 0`, 240000).then(() => true, () => false))
    await panelPass("poses", "poses.library", ".poses-panel", `document.querySelector(".poses-panel .size-bar")`, `document.querySelector(".poses-panel .tree-view")`, 28, 8);
  else log("poses: the catalogue didn't load");
  // The Save Explorer's node tree: 60 % of the window by default; shrunk by 8 rows.
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("save-explorer", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("save-explorer.explorer")`);
  if (await page.waitFor(`document.querySelectorAll("button.save-row").length > 0`, 60000).then(() => true, () => false)) {
    await page.evaluate(`document.querySelector("button.save-row").click()`);
    if (await page.waitFor(`document.querySelectorAll("li.save-tree-row").length > 0`, 120000).then(() => true, () => false))
      await panelPass("saves", "save-explorer.explorer", ".save-explorer", `document.querySelector(".save-tree-pane .size-bar")`, `document.querySelector(".save-tree")`, 26, 8);
    else log("saves: the save didn't open");
  } else log("saves: no saves listed");
  // The style guide's specimen, at both widths and in both themes.
  await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/style-guide.html` });
  await page.waitFor(`!!document.querySelector("#lib-size-bar .size-bar")`, 60000);
  for (const scheme of ["dark", "light"] as const) {
    await theme(scheme);
    for (const width of [300, 480]) {
      await page.evaluate(`(() => { const a = document.querySelector("#lib-size-bar"); const host = a.querySelector(".size-region")?.closest('[style*="max-width"]');
        if (host) { host.style.maxWidth = "none"; host.style.width = "${width}px"; } a.scrollIntoView({ block: "start" }); })()`);
      await page.wait(500);
      const specimen = await pageRect(`document.querySelector("#lib-size-bar .size-region")?.closest(".specimen, .pane")`);
      if (specimen) { await page.screenshot(resolve(out, `${scheme}-${width}-5-specimen.png`), specimen); shots.push(`${scheme}-${width}-5-specimen`); }
      // The direction dial's specimen beside it, the pattern the bar follows.
      if (width === 300) {
        await page.evaluate(`document.querySelector("#lib-direction-dial")?.scrollIntoView({ block: "start" })`);
        await page.wait(400);
        const dial = await pageRect(`document.querySelector("#lib-direction-dial .direction-dial")?.closest(".specimen, .pane")`);
        if (dial) { await page.screenshot(resolve(out, `${scheme}-6-dial-specimen.png`), dial); shots.push(`${scheme}-6-dial-specimen`); }
      }
    }
  }
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), dialShown, shots, measures,
    console: page.console.filter(m => m.type === "error").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
