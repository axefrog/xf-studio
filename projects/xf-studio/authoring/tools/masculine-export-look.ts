/**
 * UI/UX gate captures of the Mod package result for the masculine V (male V plan phase 6): in an isolated `?verify=1`
 * workspace on a disposable-data server, one headless Chrome page runs each Check or Build once and captures its card in
 * light and dark with the panel at about 300 and 480 px. Viewports are masked: no game imagery.
 *
 *   bun tools/masculine-export-look.ts <out dir> <plate cache dir> [port]
 *
 * Two servers in turn, both on a scratch plate cache (never the Studio's own):
 * - both bodies: Check before any plate was prepared (the one merged note), Build (the product line "for a feminine and a
 *   masculine V"), Check after it;
 * - feminine only: the same host with `XFS_TEST_MASCULINE_PLATE=plate_source_modded` (an isolated server's stand-in for a head
 *   mod that changes the masculine head): Check and a real Build, each with its warning and Open Settings under the product.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, startServer, type Session } from "./cdp";

const [outArg, cacheArg, portArg = "4495"] = process.argv.slice(2);
if (!outArg || !cacheArg) throw Error("Usage: bun tools/masculine-export-look.ts <out dir> <plate cache dir> [port]");
const out = resolve(outArg), port = Number(portArg), base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const report: Record<string, unknown> = { date: new Date().toISOString() };
const passes = (["light", "dark"] as const).flatMap(scheme => ([300, 480] as const).map(width => ({ scheme, width })));

const sizeGroup = (page: Session, width: number) => page.evaluate(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === "Mod package");
  t?.click(); const g = t?.closest('.dock-group'); if (!g) return false; g.style.width = "${width}px"; g.style.flex = "none"; g.style.maxWidth = "${width}px"; return true; })()`);
async function openPanel(page: Session) {
  await page.waitFor("window.xfStudioShell && document.querySelector('.dock-group')", 120000);
  await page.evaluate(`(() => { document.querySelector('button[title="Skip tour"]')?.click(); return true; })()`);
  await page.wait(500);
  await page.evaluate(MASK_VIEWPORTS);
  await sizeGroup(page, 480);
  // Check is offered once the draft has loaded (until then the button is unavailable and a click does nothing).
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === "Check" && b.offsetParent && !b.getAttribute('aria-disabled'))`, 60000);
  await page.wait(3000);
}
const click = (page: Session, text: string) => page.evaluate(`(() => { const b = [...document.querySelectorAll('button, [role=menuitem]')]
  .find(e => (e.textContent.trim() === ${JSON.stringify(text)} || e.textContent.trim() === ${JSON.stringify(text + "…")}) && e.offsetParent);
  if (!b) throw Error("no " + ${JSON.stringify(text)}); b.click(); return true; })()`);
const idle = `document.querySelector('.package-progress')?.classList.contains('idle')`;

/** Capture the current result card (and its dock group) at every pass, without running it again. */
async function capture(page: Session, name: string) {
  for (const { scheme, width } of passes) {
    await page.colorScheme(scheme);
    await sizeGroup(page, width);
    await page.evaluate(`document.querySelector('.package-result')?.scrollIntoView({ block: 'end' })`);
    await page.wait(600);
    const rects = await page.evaluate(`(() => { const card = document.querySelector('.package-result .result-card'); const g = card?.closest('.dock-group');
      if (!card || !g) return null; const box = e => { const r = e.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: Math.min(innerHeight - Math.max(0, r.top), r.height) }; };
      return { group: box(g), card: box(card) }; })()`);
    if (!rects) throw Error(`No result card for ${name}`);
    const tag = `${name}-${scheme}-${width}`;
    await page.screenshot(resolve(out, `${tag}.png`), rects.group);
    await page.screenshot(resolve(out, `${tag}-card.png`), rects.card);
    report[tag] = await page.evaluate(`(() => { const card = document.querySelector('.package-result .result-card');
      return { text: card.innerText, product: [...card.querySelectorAll('.result-product > p')].map(p => p.textContent),
        notes: [...card.querySelectorAll('.note')].map(n => ({ text: n.textContent, cls: n.className, height: Math.round(n.getBoundingClientRect().height) })),
        buttons: [...card.querySelectorAll('button')].map(b => b.textContent.trim()), scrollsSideways: document.querySelector('.package-result').closest('.dock-group').scrollWidth > document.querySelector('.package-result').closest('.dock-group').clientWidth }; })()`);
  }
}
async function run(page: Session, action: "Check" | "Build", name: string) {
  if (action === "Check") await click(page, "Check");
  else { await click(page, "Build mod files"); await page.wait(400); await click(page, "Build now"); }
  await page.wait(1000);
  try { await page.waitFor(`${idle} && document.querySelector('.package-result .result-card')`, action === "Build" ? 900000 : 120000); }
  catch (error) {
    console.error(await page.evaluate(`JSON.stringify({ results: [...document.querySelectorAll('.package-result')].map(e => e.innerText.slice(0, 200)),
      progress: [...document.querySelectorAll('.package-progress')].map(e => e.className + ' ' + e.innerText), toasts: document.querySelector('.toast, [role=status]')?.innerText })`));
    throw error;
  }
  await page.wait(500);
  await capture(page, name);
}

async function session(env: Record<string, string>, steps: (page: Session) => Promise<void>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const { server } = await startServer(port);
  Object.assign(process.env, saved);
  for (const key of Object.keys(env)) if (!(key in saved)) delete process.env[key];
  try {
    const page = await launch(`${base}/?verify=1`, { width: 1500, height: 1000, scheme: "light" });
    try { await openPanel(page); await steps(page); report[`console-${Object.keys(env).join("-")}`] = page.console.filter(entry => entry.type === "exception" || entry.type === "error"); }
    finally { await page.close(); }
  } finally { server.kill(); await server.exited; }
}

const cache = resolve(cacheArg);
await session({ XFS_PACKAGE_PLATE_CACHE: cache, XFS_PREPARED_BUDGET_GB: "off" }, async page => {
  await run(page, "Check", "1-check-before-build");
  await run(page, "Build", "2-build-both");
  await run(page, "Check", "3-check-after-build");
});
await session({ XFS_PACKAGE_PLATE_CACHE: cache, XFS_PREPARED_BUDGET_GB: "off", XFS_TEST_MASCULINE_PLATE: "plate_source_modded" }, async page => {
  await run(page, "Check", "4-check-feminine-only");
  await run(page, "Build", "5-build-feminine-only");
});
writeFileSync(resolve(out, "run.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(Object.keys(report).length));
