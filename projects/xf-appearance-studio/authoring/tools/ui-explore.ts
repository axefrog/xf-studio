/** Exploratory state tour with screenshots (ignored folder): bun tools/ui-explore.ts [scheme] */
import { launch, startServer, MOD } from "./cdp";
const scheme = (process.argv[2] ?? "dark") as "dark" | "light";
const out = (name: string) => `evidence/screenshots/explore-${scheme}-${name}.png`;
const port = 4392;
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: 1000, scheme, debugPort: 9342 });
const rect = (selector: string) => page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
try {
  await page.waitFor("window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 90000);
  await page.wait(1500);
  // 1. Layer row context menu
  const row = await rect(".item-list[aria-label='Layers, front first'] .item-row:nth-child(2) .item-main");
  await page.mouse("mousePressed", row.cx, row.cy, { button: "right" }); await page.mouse("mouseReleased", row.cx, row.cy, { button: "right" });
  await page.wait(300); await page.screenshot(out("layer-menu"));
  await page.key("Escape"); await page.wait(200);
  // 2. Command palette
  await page.key("k", { modifiers: MOD.ctrl }); await page.wait(250); await page.type("float"); await page.wait(250);
  await page.screenshot(out("palette")); await page.key("Escape"); await page.wait(200);
  // 3. Mid-drag: drag the Motion tab toward the Head group's centre guide, screenshot while held
  await page.evaluate(`window.xfStudioShell.dock.reveal('motion', false)`); await page.wait(200);
  const tab = await rect("#dock-tab-motion"), head = await rect("[data-group='g-head']");
  await page.mouse("mouseMoved", tab.cx, tab.cy, { button: "none", buttons: 0 });
  await page.mouse("mousePressed", tab.cx, tab.cy, { button: "left" });
  for (let i = 1; i <= 16; i++) { await page.mouse("mouseMoved", tab.cx + (head.cx - 40 - tab.cx) * i / 16, tab.cy + (head.cy - tab.cy) * i / 16, { button: "left" }); await page.wait(16); }
  await page.wait(150); await page.screenshot(out("drag-guides"));
  await page.mouse("mouseMoved", head.cx + 90, head.cy + 160, { button: "left" }); await page.wait(120);
  await page.mouse("mouseReleased", head.cx + 90, head.cy + 160, { button: "left" });
  await page.wait(400); await page.screenshot(out("floated"));
  // 4. Float lighting via keyboard-equivalent command and attach it to motion's right edge by cursor band
  await page.evaluate(`window.xfStudioShell.dock.float('lighting')`); await page.wait(300);
  const lightingTab = await rect("#dock-tab-lighting"), motionWindow = await rect(".dock-window:has(#dock-tab-motion)");
  await page.drag([lightingTab.cx + 60, lightingTab.cy], [motionWindow.x + motionWindow.w + 6, motionWindow.cy], { steps: 18 });
  await page.wait(400); await page.screenshot(out("composite"));
  console.log(JSON.stringify(await page.evaluate(`window.xfStudioShell.dock.tree.floating.map(w => ({ w: w.w, h: w.h, kind: w.node.kind }))`)));
  // 5. Compact layout
  await page.viewport(900, 900); await page.wait(900); await page.screenshot(out("compact"));
  console.log(JSON.stringify(page.console.filter(e => e.type !== "warning").slice(0, 20), null, 1));
} finally { await page.close(); server.kill(); }
