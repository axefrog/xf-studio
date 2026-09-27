/**
 * Captures of the Motion panel in an isolated `?verify=1` workspace (disposable data, throwaway Chrome profile): the panel as it opens,
 * then with an idle chosen (the pressed choice and the loading line), at the given width.
 *
 *   bun tools/motion-panel-look.ts <out dir under evidence/screenshots> [port] [width] [height]
 *
 * The server inherits this process's environment (point `XFS_PREVIEW_CORE_CACHE` and `XFS_RESOLVER_CACHE` at warm caches).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4471", widthArg = "1400", heightArg = "900"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/motion-panel-look.ts <out dir> [port] [width] [height]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: +widthArg, height: +heightArg, scheme: "dark", debugPort: port + 5000 });
// The Motion panel's box, after bringing its tab to the front.
const openMotion = `(() => { const tab = [...document.querySelectorAll(".dock-tab")].find(t => /^motion$/i.test(t.textContent.trim()));
  tab?.click(); return !!tab; })()`;
const panelBox = `(() => { const heading = [...document.querySelectorAll(".panel-content .section-title, .panel-content h3, .panel-content h2")].find(e => /game idle/i.test(e.textContent));
  const panel = heading?.closest(".dock-group") ?? heading?.closest(".panel-content"); if (!panel) return null;
  const r = panel.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`;
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  await page.waitFor("window.xfStudioPresentation.authoring.previewState().motion?.available", 240000);
  // The V's details (her hair) loaded, so the Hair section shows what it will.
  await page.waitFor("(window.xfStudioSceneEvidence()?.characterDetails?.components?.length ?? 0) > 0", 900000).catch(() => undefined);
  await page.wait(2000);
  console.log("motion tab:", await page.evaluate(openMotion));
  await page.wait(800);
  const box = await page.evaluate(panelBox);
  console.log("panel:", JSON.stringify(box));
  const shot = async (name: string) => { await page.wait(600); await page.screenshot(resolve(out, `${name}.png`), box ?? undefined); };
  await shot("motion-still");
  // Choose an idle the page hasn't loaded yet: the pressed choice moves at once and the loading line shows while its clip arrives.
  const loading = await page.evaluate(`(() => { const rt = window.xfStudioShell.runtime, run = action => rt.dispatch(action);
    run({ kind: "motion.setIdleClip", clip: "gender-selection" }); run({ kind: "motion.setIdle", enabled: true });
    return window.xfStudioPresentation.authoring.previewState().motion.idleLoading; })()`);
  console.log("loading right after the choice:", loading);
  await page.screenshot(resolve(out, "motion-choice-loading.png"), box ?? undefined);
  await page.wait(1500);
  await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "motion.setIdleClip", clip: "inventory" })`);
  await shot("motion-inventory");
  console.log(JSON.stringify(page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 10)));
} finally { await page.close(); server.kill(); }
