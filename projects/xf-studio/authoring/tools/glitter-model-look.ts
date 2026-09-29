/**
 * Captures for the design gate of the Glitter style choice (experiment 032), in one scheme:
 * - the Colour & finish panel on a layer that has just become Glitter, floated at 300 and 480 px, research tools off and on;
 * - a legacy Classic glitter layer with research tools off at 300 px: it keeps its style listed; after switching to Scattered
 *   sparkle Classic is no longer offered; Undo brings it back.
 * It runs an isolated `?verify=1` workspace with disposable data and a throwaway headless Chrome profile, on its own port
 * (never 4317), and stops the server afterwards.
 *
 *   bun tools/glitter-model-look.ts <out dir> [port] [light|dark]
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4327", schemeArg = "dark"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/glitter-model-look.ts <out dir> [port] [light|dark]");
const out = resolve(outArg), port = +portArg, scheme = schemeArg;
mkdirSync(out, { recursive: true });
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 1000, scheme, debugPort: port + 5100 });
const P = "window.xfStudioPresentation";
/** Float `panel` in its own window `width` px wide, top-left of the workspace. */
const floatAt = (panel: string, width: number, height = 900) => page.evaluate(`(() => { const dock = window.xfStudioShell.dock;
  dock.reveal(${JSON.stringify(panel)}, false);
  const inWindow = dock.tree.floating.find(w => JSON.stringify(w.node).includes(${JSON.stringify(`"${panel}"`)}));
  if (!inWindow) dock.float(${JSON.stringify(panel)});
  const tree = dock.tree, win = tree.floating.find(w => JSON.stringify(w.node).includes(${JSON.stringify(`"${panel}"`)}));
  dock.update({ ...tree, floating: tree.floating.map(w => w === win ? { ...w, x: 24, y: 24, w: ${width}, h: ${height} } : w) });
  return !!win; })()`);
const windowRect = (panel: string) => page.evaluate(`(() => { const tab = document.querySelector('[data-panel="${panel}"]'); const g = tab?.closest(".dock-group");
  const w = g?.parentElement?.closest("[class*=float], [class*=window]") ?? g; if (!w) return null; const r = w.getBoundingClientRect();
  return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: Math.min(innerWidth, r.width + 8), height: Math.min(innerHeight, r.height + 8) }; })()`);
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation?.feature?.('eye-makeup')?.view?.()?.recipe", 180000);
  await page.evaluate(`[...document.querySelectorAll(".guidance-callout button")].find(b => /not now|no thanks|close/i.test(b.textContent ?? b.getAttribute("aria-label") ?? ""))?.click()`);
  const EM = `${P}.feature('eye-makeup')`;
  await page.evaluate(`(() => { const f = ${EM}, layer = f.view().recipe().layers[0];
    f.dispatch({ kind: 'layer.select', layerId: layer.id });
    return f.dispatch({ kind: 'layer.setFinish', layerId: layer.id, finish: 'glitter' }); })()`);
  for (const research of [false, true]) {
    await page.evaluate(`window.xfStudioShell.runtime.port.preferences.dispatch({ kind: "researchTools.set", enabled: ${research} })`);
    for (const width of [300, 480]) {
      await floatAt("finish", width); await page.wait(700);
      // Bring the Glitter section into view inside the panel.
      await page.evaluate(`[...document.querySelectorAll('.section-title')].find(e => e.textContent === 'Glitter')?.scrollIntoView({ block: 'start' })`);
      await page.wait(300);
      const clip = await windowRect("finish") as { x: number; y: number; width: number; height: number } | null;
      await page.screenshot(resolve(out, `${scheme}-${width}-research-${research ? "on" : "off"}.png`), clip ?? undefined);
    }
  }
  const model = await page.evaluate(`${EM}.view().layer()?.flakes?.model ?? "classic"`);
  // A legacy Classic glitter layer (as older looks store it), research tools off.
  const shoot = async (id: string) => {
    await floatAt("finish", 300); await page.wait(700);
    await page.evaluate(`[...document.querySelectorAll('.section-title')].find(e => e.textContent === 'Glitter')?.scrollIntoView({ block: 'start' })`);
    await page.wait(300);
    const clip = await windowRect("finish") as { x: number; y: number; width: number; height: number } | null;
    await page.screenshot(resolve(out, `${scheme}-300-legacy-${id}.png`), clip ?? undefined);
  };
  const styles = () => page.evaluate(`[...document.querySelectorAll('.section-title')].find(e => e.textContent === 'Glitter')?.closest('section, .section')
    ?.querySelectorAll('[role=radio], .choice') .length ?? null`);
  const layerId = `${EM}.view().layer().id`;
  await page.evaluate(`${EM}.dispatch({ kind: 'glitter.selectModel', layerId: ${layerId}, model: 'classic' })`);
  await page.evaluate(`window.xfStudioShell.runtime.port.preferences.dispatch({ kind: "researchTools.set", enabled: false })`);
  await shoot("classic");
  const withClassic = await styles();
  await page.evaluate(`${EM}.dispatch({ kind: 'glitter.selectModel', layerId: ${layerId}, model: 'direct' })`);
  await shoot("switched");
  const afterSwitch = await styles();
  const undo = await page.evaluate(`${P}.authoring.dispatch({ kind: 'history.undo' }).ok`);
  await shoot("undo");
  const afterUndo = await page.evaluate(`${EM}.view().layer()?.flakes?.model ?? "classic"`);
  console.log(JSON.stringify({ model, withClassic, afterSwitch, undo, afterUndo, shots: 7, out }));
} finally { await page.close(); server.kill(); }
