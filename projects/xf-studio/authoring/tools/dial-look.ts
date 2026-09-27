/**
 * Captures of the Camera & light panel's direction dial beside the Character panel, both floating at one width, in an isolated
 * `?verify=1` workspace (disposable data, throwaway Chrome profile) on its own port (never 4317 or the person's draft), with Character
 * creator shown so the other lights' dots are many: the dial at rest, mid-drag (the radius line, the other dots dimmed), and enlarged
 * with its resize bar.
 *
 *   bun tools/dial-look.ts <out dir under evidence/screenshots> [port] [light|dark] [panel width]
 *
 * The server inherits this process's environment (point `XFS_PREVIEW_CORE_CACHE` and `XFS_RESOLVER_CACHE` at warm caches). Keep the
 * outputs in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4394", schemeArg = "dark", widthArg = "300"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/dial-look.ts <out dir> [port] [light|dark] [panel width]");
const out = resolve(outArg), port = +portArg, width = +widthArg, height = 1000;
mkdirSync(out, { recursive: true });
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 2 * width + 80, height: height + 80, scheme: schemeArg, debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const tag = `${schemeArg}-${width}`;
type Box = { x: number; y: number; width: number; height: number };
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 300000);
  await page.waitFor("window.xfStudioPresentation.authoring.previewState().lightingSetups", 60000);
  // The panels are the subject: a head-only V without hair or the idle keeps the capture's memory small.
  for (const action of [{ kind: "preview.setBody", enabled: false }, { kind: "preview.setHair", enabled: false }, { kind: "motion.setIdle", enabled: false }])
    await run(action).catch(() => undefined);
  await page.evaluate(`(() => { const dock = window.xfStudioShell.dock;
    dock.moveTo("character", { kind: "float", x: 20, y: 20, w: ${width}, h: ${height} }, "");
    dock.moveTo("lighting", { kind: "float", x: ${width + 50}, y: 20, w: ${width}, h: ${height} }, ""); })()`);
  await run({ kind: "preview.selectLightingSetup", setup: "creator" });
  await page.wait(1500);
  await page.evaluate(`(() => { const row = [...document.querySelectorAll(".light-list .item-main")].find(e => /Main Face/.test(e.textContent)); row?.click(); })()`);
  const box = () => page.evaluate(`(() => { const r = [...document.querySelectorAll(".dock-floating > *")].map(e => e.getBoundingClientRect());
    if (!r.length) return null; const x = Math.min(...r.map(b => b.left)), y = Math.min(...r.map(b => b.top));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(...r.map(b => b.right)) - x), height: Math.round(Math.max(...r.map(b => b.bottom)) - y) }; })()`) as Promise<Box | null>;
  const shot = async (name: string) => { await page.wait(500); await page.screenshot(resolve(out, `${tag}-${name}.png`), (await box()) ?? undefined); };
  const centre = async () => { await page.evaluate(`document.querySelector(".direction-dial")?.scrollIntoView({ block: "center" })`); await page.wait(400); };
  const handle = () => page.evaluate(`(() => { const r = document.querySelector(".dial-handle").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as Promise<[number, number]>;
  const face = () => page.evaluate(`(() => { const r = document.querySelector(".direction-dial-face").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`) as Promise<Box>;
  await centre();
  await shot("1-rest");
  // Mid-drag: press on the handle and move part-way out along its radius, held while the frame is captured.
  const [hx, hy] = await handle(), f = await face();
  const cx = f.x + f.width * (20 + 50) / 186, cy = f.y + f.height * (9 + 50) / 118;
  await page.mouse("mouseMoved", hx, hy, { button: "none", buttons: 0 });
  await page.mouse("mousePressed", hx, hy);
  await page.mouse("mouseMoved", hx + (hx - cx) * .35 + 6, hy + (hy - cy) * .35);
  await shot("2-mid-drag");
  await page.mouse("mouseReleased", hx + (hx - cx) * .35 + 6, hy + (hy - cy) * .35);
  await run({ kind: "view.undo" }).catch(() => undefined);
  // Enlarged: the resize bar to the largest the panel holds.
  await page.evaluate(`(() => { const grip = document.querySelector(".dial-grip"); grip.focus(); grip.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); })()`);
  await centre();
  await shot("3-enlarged");
  writeFileSync(resolve(out, `${tag}-console.json`), JSON.stringify(page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20), null, 2));
} finally { await page.close(); server.kill(); }
