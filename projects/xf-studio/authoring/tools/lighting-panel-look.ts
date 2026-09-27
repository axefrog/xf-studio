/**
 * Captures of the Camera & light panel's lighting setups beside the Character panel, both floating at one width, in an isolated
 * `?verify=1` workspace (disposable data, throwaway Chrome profile) on its own port (never 4317 or the person's draft): the panel as it
 * opens (Soft studio), after a change that forks it (an own setup), with the direction dial focused from the keyboard, and with Character
 * creator and a spot light chosen (last: the creator's shadow maps are the heaviest frame).
 *
 *   bun tools/lighting-panel-look.ts <out dir under evidence/screenshots> [port] [light|dark] [panel width]
 *
 * The server inherits this process's environment (point `XFS_PREVIEW_CORE_CACHE` and `XFS_RESOLVER_CACHE` at warm caches). The
 * Character panel shows installed mods' names, so keep the outputs in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4393", schemeArg = "dark", widthArg = "300"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/lighting-panel-look.ts <out dir> [port] [light|dark] [panel width]");
const out = resolve(outArg), port = +portArg, width = +widthArg, height = 1560;
mkdirSync(out, { recursive: true });
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 2 * width + 80, height: height + 80, scheme: schemeArg, debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const tag = `${schemeArg}-${width}`;
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 300000);
  await page.waitFor("window.xfStudioPresentation.authoring.previewState().lightingSetups", 60000);
  // The panels are the subject: a head-only V without hair or the idle keeps the capture's memory small.
  for (const action of [{ kind: "preview.setBody", enabled: false }, { kind: "preview.setHair", enabled: false }, { kind: "motion.setIdle", enabled: false }])
    await run(action).catch(() => undefined);
  // Character on the left, Camera & light on the right, each a floating window of the same width.
  await page.evaluate(`(() => { const dock = window.xfStudioShell.dock;
    dock.moveTo("character", { kind: "float", x: 20, y: 20, w: ${width}, h: ${height} }, "");
    dock.moveTo("lighting", { kind: "float", x: ${width + 50}, y: 20, w: ${width}, h: ${height} }, ""); })()`);
  await page.wait(1500);
  const box = () => page.evaluate(`(() => { const r = [...document.querySelectorAll(".dock-floating > *")].map(e => e.getBoundingClientRect());
    if (!r.length) return null; const x = Math.min(...r.map(b => b.left)), y = Math.min(...r.map(b => b.top));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(...r.map(b => b.right)) - x), height: Math.round(Math.max(...r.map(b => b.bottom)) - y) }; })()`);
  const shot = async (name: string) => { await page.wait(700); await page.screenshot(resolve(out, `${tag}-${name}.png`), (await box()) ?? undefined); };
  // The Light section at the top of the lighting window.
  await page.evaluate(`(() => { const t = [...document.querySelectorAll(".section-title")].find(e => /^light$/i.test(e.textContent.trim()));
    t?.scrollIntoView({ block: "start" }); })()`);
  await shot("1-soft-studio");
  await run({ kind: "preview.setRoomLight", value: 0.6 });
  await run({ kind: "view.endEdit" });
  await shot("2-own-setup");
  // Scrolled to the chosen light's controls, the dial focused from the keyboard.
  await page.evaluate(`(() => { const dial = document.querySelector(".direction-dial-face"); dial?.scrollIntoView({ block: "center" }); dial?.focus(); })()`);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await shot("3-dial-focused");
  await page.evaluate(`(() => { const t = [...document.querySelectorAll(".section-title")].find(e => /^light$/i.test(e.textContent.trim()));
    t?.scrollIntoView({ block: "start" }); })()`);
  await run({ kind: "preview.selectLightingSetup", setup: "creator" });
  await page.waitFor("window.xfStudioPresentation.authoring.previewState().lighting?.lut.phase !== 'loading'", 120000).catch(() => undefined);
  await page.evaluate(`(() => { const row = [...document.querySelectorAll(".light-list .item-main")].find(e => /Main Face/.test(e.textContent)); row?.click(); })()`);
  await shot("4-creator-spot");
  // The Colour grade's help tip, which says where the game's grade comes from (UI-129), shown from the keyboard.
  // Scrolled first: a scroll hides a showing tip.
  await page.evaluate(`document.querySelector('.help-tip[aria-label="About Colour grade"]')?.scrollIntoView({ block: "center" })`);
  await page.wait(500);
  await page.evaluate(`document.querySelector('.help-tip[aria-label="About Colour grade"]')?.focus()`);
  await shot("5-grade-tip");
  writeFileSync(resolve(out, `${tag}-console.json`), JSON.stringify(page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20), null, 2));
} finally { await page.close(); server.kill(); }
