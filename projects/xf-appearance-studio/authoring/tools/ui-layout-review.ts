/**
 * Factory-default layout composition review in the isolated `?verify=1` workspace.
 *   bun tools/ui-layout-review.ts [tag] [--evidence <dir>] [--quick]
 * Loads each window size fresh (the default a new user sees, including the front-camera
 * framing computed from the head viewport's aspect), then resizes one session through
 * every size to check proportional scaling. Measures every docked group, the head
 * viewport and the UV canvas. Full screenshots go to evidence/screenshots/ (ignored);
 * `--evidence` also writes asset-free masked copies and the measurements.
 */
import { launch, MASK_VIEWPORTS, saveJson, startServer, UNMASK_VIEWPORTS, type Session } from "./cdp";

const args = process.argv.slice(2);
const evidenceAt = args.indexOf("--evidence");
const evidence = evidenceAt >= 0 ? args[evidenceAt + 1] : undefined;
const tag = args.find((arg, i) => !arg.startsWith("--") && (evidenceAt < 0 || i !== evidenceAt + 1)) ?? "review";
const quick = args.includes("--quick");
const SIZES: [number, number][] = [[1600, 1000], [1100, 800], [900, 900], [640, 900], [1920, 1080], [1366, 768], [1024, 768]];
/** `--quick` iterates on composition: dark theme, fresh loads only. */
const SCHEMES = quick ? ["dark"] as const : ["dark", "light"] as const;
const PORT = 4393;

const METRICS = `(() => {
  const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
  const groups = [...document.querySelectorAll('.dock-surface .dock-group')].map(g => ({ id: g.dataset.group,
    tabs: [...g.querySelectorAll('.dock-tab')].map(t => t.dataset.panel), active: g.querySelector('.dock-tab[aria-selected=true]')?.dataset.panel,
    condensed: g.querySelector('.dock-tabs').classList.contains('condensed'),
    clipped: (s => s.scrollWidth > s.clientWidth + 1)(g.querySelector('.dock-tabs')), ...box(g) }));
  const head = box(document.querySelector('.viewport-panel:not(.uv) .viewport-slot'));
  const uv = box(document.getElementById('device-uv-canvas'));
  const port = window.xfStudioPresentation, camera = port.authoring.previewState().preview?.camera;
  return { window: [innerWidth, innerHeight], sizeClass: window.xfStudioShell.dock.sizeClass, overflowX: document.documentElement.scrollWidth > innerWidth,
    head: head && { ...head, aspect: +(head.w / head.h).toFixed(3) }, uv: uv && { ...uv, mode: port.viewport.snapshot().uv.view?.mode },
    cameraDistance: camera && +Math.hypot(...camera.position.map((v, i) => v - camera.target[i])).toFixed(3), groups };
})()`;
const ready = (page: Session) => page.waitFor(`window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready' && window.xfStudioPresentation.viewport.snapshot().uv.phase === 'ready' && window.xfStudioPresentation.previewReadiness.snapshot().phase === 'ready' && !!window.xfStudioShell`, 120000);

/** Masked evidence is kept for the reviewed sizes' first runs; everything else stays local. */
const EVIDENCE_SIZES = ["1600x1000", "1100x800", "900x900", "640x900"];
async function capture(page: Session, name: string) {
  await page.screenshot(`evidence/screenshots/layout-${tag}-${name}.png`);
  if (!evidence || !name.startsWith("load-") || !EVIDENCE_SIZES.some(size => name.includes(`-${size}-`))) return;
  await page.evaluate(MASK_VIEWPORTS); await page.wait(60);
  await page.screenshot(`${evidence}/${name}.png`);
  await page.evaluate(UNMASK_VIEWPORTS);
}

const { server } = await startServer(PORT);
const results: Record<string, unknown> = {};
const errors: { type: string; text: string }[] = [];
try {
  for (const scheme of SCHEMES) {
    // A fresh browser profile per size: the workspace also persists the camera, so only a
    // first run shows the front framing computed from that size's head viewport.
    for (const [w, h] of SIZES) {
      const page = await launch(`http://127.0.0.1:${PORT}/?verify=1`, { width: w, height: h, scheme, debugPort: 9343 });
      try {
        await ready(page); await page.wait(1200);
        const name = `load-${w}x${h}-${scheme}`;
        results[name] = await page.evaluate(METRICS);
        await capture(page, name);
        errors.push(...page.console.filter(entry => entry.type === "exception" || entry.type === "error" || entry.type === "log:error"));
      } finally { await page.close(); }
    }
    if (quick) continue;
    // One session resized through every size: fractions scale, the size class switches at 1100 px.
    const page = await launch(`http://127.0.0.1:${PORT}/?verify=1`, { width: 1600, height: 1000, scheme, debugPort: 9343 });
    try {
      await ready(page); await page.wait(800);
      for (const [w, h] of [[1100, 800], [900, 900], [640, 900], [1600, 1000]] as [number, number][]) {
        await page.viewport(w, h); await page.wait(900);
        const name = `resize-${w}x${h}-${scheme}`;
        results[name] = await page.evaluate(METRICS);
        await capture(page, name);
      }
      errors.push(...page.console.filter(entry => entry.type === "exception" || entry.type === "error" || entry.type === "log:error"));
    } finally { await page.close(); }
  }
} finally { server.kill(); }

console.log(`console errors: ${errors.length}`, JSON.stringify(errors.slice(0, 5)));
for (const [name, value] of Object.entries(results)) {
  const m = value as any;
  console.log(`${name.padEnd(26)} class=${m.sizeClass} overflowX=${m.overflowX} head=${m.head ? `${m.head.w}x${m.head.h} (${m.head.aspect})` : "hidden"} uv=${m.uv ? `${m.uv.w}x${m.uv.h} ${m.uv.mode}` : "hidden"} cam=${m.cameraDistance}`);
  for (const g of m.groups) console.log(`   ${String(g.id).padEnd(12)} ${String(g.w).padStart(4)}x${String(g.h).padEnd(4)} @${g.x},${g.y} ${g.active}${g.condensed ? " (condensed)" : ""}${g.clipped ? " TABS CLIPPED" : ""} [${g.tabs.join(",")}]`);
}
if (evidence) saveJson(`${evidence}/layout-review.json`, { date: new Date().toISOString().slice(0, 10), url: "?verify=1 (isolated workspace, disposable data and Chrome profiles)", consoleErrors: errors.length, results });
