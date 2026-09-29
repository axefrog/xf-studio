/**
 * UI/UX gate captures of the Mod package panel's Build progress (PIPE-131): in an isolated `?verify=1` workspace on a
 * disposable-data server, one headless Chrome page runs a real Build and, while it is at the convert and verify stages,
 * captures the panel in light and dark with its group at about 300 and 480 px. It also records the progress line's box
 * before, during and after, to show that nothing moves. Viewports are masked: no game imagery. Installs nothing.
 *
 *   bun tools/build-progress-look.ts <out dir> <plate cache dir> [port]
 *
 * The plate cache should be a scratch copy that already holds prepared plates (a warm Build reaches each stage within
 * seconds); never the Studio's own.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, startServer, type Session } from "./cdp";

const [outArg, cacheArg, portArg = "4496"] = process.argv.slice(2);
if (!outArg || !cacheArg) throw Error("Usage: bun tools/build-progress-look.ts <out dir> <plate cache dir> [port]");
const out = resolve(outArg), port = Number(portArg), base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const report: Record<string, unknown> = { date: new Date().toISOString() };
const passes = (["light", "dark"] as const).flatMap(scheme => ([300, 480] as const).map(width => ({ scheme, width })));

const sizeGroup = (page: Session, width: number) => page.evaluate(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === "Mod package");
  t?.click(); const g = t?.closest('.dock-group'); if (!g) return false;
  // A group in a column takes its column's width: size the column too (the nearest ancestor laid out in a row).
  for (let e = g; e?.parentElement && e.parentElement !== document.body; e = e.parentElement)
    if (getComputedStyle(e.parentElement).flexDirection === "row") { if (e !== g) Object.assign(e.style, { width: "${width}px", flex: "none", maxWidth: "${width}px", minWidth: "${width}px" }); break; }
  // Floated (see below), the floating window takes the width too.
  const w = g.parentElement?.closest('[class*="float"]'); if (w) { w.style.width = "${width}px"; w.style.height = "700px"; }
  g.style.width = "${width}px"; g.style.flex = "none"; g.style.maxWidth = "${width}px"; return true; })()`);
const click = (page: Session, text: string) => page.evaluate(`(() => { const b = [...document.querySelectorAll('button, [role=menuitem]')]
  .find(e => (e.textContent.trim() === ${JSON.stringify(text)} || e.textContent.trim() === ${JSON.stringify(text + "…")}) && e.offsetParent);
  if (!b) throw Error("no " + ${JSON.stringify(text)}); b.click(); return true; })()`);
/** The progress line, its bar and what sits below it, as boxes and values. */
const layout = (page: Session) => page.evaluate(`(() => { const p = document.querySelector('.package-progress'), bar = p?.querySelector('[role=progressbar]'),
  text = p?.querySelector('.progress-text'), result = document.querySelector('.package-result'); const box = e => { const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) }; };
  return { idle: p.classList.contains('idle'), progress: box(p), resultTop: result ? box(result).top : null, text: text.textContent,
    textOverflows: text.scrollWidth > text.clientWidth, title: text.title, indeterminate: bar.classList.contains('indeterminate'),
    value: bar.getAttribute('aria-valuenow'), status: document.querySelector('.status-bar .status-message')?.textContent ?? null }; })()`);

async function capture(page: Session, name: string) {
  for (const { scheme, width } of passes) {
    await page.colorScheme(scheme);
    await sizeGroup(page, width);
    await page.wait(400);
    const rects = await page.evaluate(`(() => { const p = document.querySelector('.package-progress'), g = p?.closest('.dock-group');
      if (!p || !g) return null; const box = e => { const r = e.getBoundingClientRect(), x = Math.max(0, r.left), y = Math.max(0, r.top);
        return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y }; };
      const row = p.parentElement; return { group: box(g), row: box(row) }; })()`);
    if (!rects) throw Error(`No progress line for ${name}`);
    const tag = `${name}-${scheme}-${width}`;
    await page.screenshot(resolve(out, `${tag}.png`), rects.group);
    await page.screenshot(resolve(out, `${tag}-row.png`), rects.row);
    report[tag] = await layout(page);
  }
  await page.colorScheme("light");
  await sizeGroup(page, 480);
}

const { server } = await (async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { XFS_PACKAGE_PLATE_CACHE: resolve(cacheArg), XFS_PREPARED_BUDGET_GB: "off" });
  try { return await startServer(port); } finally { for (const key of ["XFS_PACKAGE_PLATE_CACHE", "XFS_PREPARED_BUDGET_GB"]) if (!(key in saved)) delete process.env[key]; }
})();
try {
  const page = await launch(`${base}/?verify=1`, { width: 1500, height: 1000, scheme: "light" });
  try {
    await page.waitFor("window.xfStudioShell && document.querySelector('.dock-group')", 120000);
    await page.evaluate(`(() => { document.querySelector('button[title="Skip tour"]')?.click(); return true; })()`);
    await page.wait(500);
    await page.evaluate(MASK_VIEWPORTS);
    // Floated, so the panel is seen at each pass's width whatever column it docks in (as mod-manager-extras-look.ts does).
    await page.evaluate(`window.xfStudioShell.dock.float("package")`); await page.wait(400);
    await sizeGroup(page, 480);
    await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === "Check" && b.offsetParent && !b.getAttribute('aria-disabled'))`, 60000);
    await page.wait(3000);
    report.before = await layout(page);
    await click(page, "Build mod files"); await page.wait(400); await click(page, "Build now");
    // Every line the Build shows, as it changes (sampled every 100 ms), for the record.
    await page.evaluate(`(() => { window.__lines = []; const t = document.querySelector('.package-progress .progress-text');
      const seen = () => { const v = t.textContent; if (window.__lines.at(-1)?.text !== v) window.__lines.push({ at: Math.round(performance.now()), text: v,
        value: t.parentElement.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), top: Math.round(t.getBoundingClientRect().top) }); };
      window.__watch = setInterval(seen, 100); return true; })()`);
    await page.waitFor(`document.querySelector('.package-progress .progress-text').textContent.startsWith('Step 3 of 5')`, 300000);
    await capture(page, "1-convert");
    await page.waitFor(`document.querySelector('.package-progress .progress-text').textContent.startsWith('Step 5 of 5')`, 300000);
    await capture(page, "2-verify");
    await page.waitFor(`document.querySelector('.package-progress')?.classList.contains('idle') && document.querySelector('.package-result .result-card')`, 600000);
    await page.wait(500);
    report.after = await layout(page);
    report.lines = await page.evaluate(`(() => { clearInterval(window.__watch); return window.__lines; })()`);
    await capture(page, "3-done");
    report.console = page.console.filter(entry => entry.type === "exception" || entry.type === "error");
  } finally { await page.close(); }
} finally { server.kill(); await server.exited; }
writeFileSync(resolve(out, "run.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ lines: report.lines }, null, 1));
