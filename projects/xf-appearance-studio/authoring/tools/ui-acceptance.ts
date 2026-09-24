/**
 * Isolated acceptance pass for the XF Studio presentation.
 *   bun tools/ui-acceptance.ts [--build]
 * Uses ?verify=1 (separate browser workspace key and /api/verification library), a
 * disposable XFAS_DATA_DIR and a throwaway Chrome profile. Never touches Nathan's draft.
 * Full screenshots go to evidence/screenshots/ (ignored); asset-free masked copies
 * go to evidence/ui-overhaul-2026-09-24/ for review.
 */
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, MASK_VIEWPORTS, MOD, saveJson, startServer, UNMASK_VIEWPORTS, type Session } from "./cdp";

const PORT = 4401, withBuild = process.argv.includes("--build");
const results: { step: string; pass: boolean; detail?: unknown }[] = [];
const record = (step: string, pass: boolean, detail?: unknown) => { results.push({ step, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${step}${detail !== undefined ? ` · ${JSON.stringify(detail).slice(0, 300)}` : ""}`); };
const { server, data } = await startServer(PORT);
const url = `http://127.0.0.1:${PORT}/?verify=1`;
let page: Session = await launch(url, { width: 1600, height: 1000, scheme: "dark", debugPort: 9351 });
const P = "window.xfStudioPresentation", S = "window.xfStudioShell";
const js = <T = any>(expression: string) => page.evaluate<T>(expression);
const rect = (selector: string) => js<{ x: number; y: number; w: number; h: number; cx: number; cy: number } | undefined>(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const click = async (selector: string, button: "left" | "right" = "left") => {
  const r = await rect(selector); if (!r) throw Error(`No element ${selector}`);
  await page.mouse("mouseMoved", r.cx, r.cy, { button: "none", buttons: 0 });
  await page.mouse("mousePressed", r.cx, r.cy, { button }); await page.mouse("mouseReleased", r.cx, r.cy, { button }); await page.wait(120);
};
/** Key-order-insensitive JSON for comparing restored layouts. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const step = async (name: string, run: () => Promise<void>) => {
  try { await run(); } catch (error) { record(name, false, (error as Error).message); }
};
const shots: string[] = [];
async function shot(name: string, masked = true) {
  await page.screenshot(`evidence/screenshots/acceptance-${name}.png`);
  if (masked) { await js(MASK_VIEWPORTS); await page.wait(60); await page.screenshot(`evidence/ui-overhaul-2026-09-24/${name}.png`); await js(UNMASK_VIEWPORTS); shots.push(name); }
}
const ready = () => page.waitFor(`${P}?.viewport.snapshot().head.phase === 'ready' && ${P}.viewport.snapshot().uv.phase === 'ready' && ${P}.previewReadiness.snapshot().phase === 'ready'`, 120000);
/** Screen position of a canonical UV control point in the UV canvas (mirror = right-eye copy). */
const uvPoint = (index: number, mirror = false) => js<{ x: number; y: number }>(`(() => {
  const port = ${P}, view = port.viewport.snapshot().uv.view, layer = port.editor.layer(), p = layer.points[${index}];
  const canvas = document.getElementById('device-uv-canvas'), r = canvas.getBoundingClientRect(), bx = canvas.clientLeft, by = canvas.clientTop;
  const w = r.width - 2 * bx, h = r.height - 2 * by, span = view.span, hh = span / (w / h);
  const u = ${mirror} ? 1 - p.u : p.u;
  return { x: r.left + bx + (u - (view.u - span / 2)) / span * w, y: r.top + by + (p.v - (view.v - hh / 2)) / hh * h };
})()`);

try {
  await ready();
  const bootErrors = page.console.filter(entry => entry.type === "exception" || entry.type === "error");
  record("boot: head, UV and preview reach Ready in the isolated verification workspace", true,
    await js(`({ verification: ${P}.status.snapshot().verification, head: ${P}.viewport.snapshot().head.phase, layers: ${P}.editor.recipe().layers.length, errors: ${bootErrors.length} })`));
  await shot("wide-dark-default");

  await step("presets: add, inline rename (F2), reorder (Alt+↑), duplicate, remove and restore", async () => {
    const before = await js<number>(`${P}.library.summary().draft.presets.length`);
    await click("button:has(> span) >> text=Add preset".replace(" >> text=Add preset", "")).catch(() => {});
    await js(`[...document.querySelectorAll('.list-head button')].find(b => b.textContent.includes('Add preset')).click()`); await page.wait(200);
    const afterAdd = await js<number>(`${P}.library.summary().draft.presets.length`);
    const selected = await js<string>(`${P}.library.summary().draft.selected`);
    await js(`document.querySelector('.item-list[aria-label="Presets in this collection"] .item-row[data-id="${selected}"] .item-main').focus()`);
    await page.key("F2"); await page.wait(100);
    await js(`document.activeElement.select()`); await page.type("Chrome dusk"); await page.key("Enter"); await page.wait(200);
    const renamed = await js<string>(`${P}.library.summary().draft.presets.find(p => p.id === '${selected}').name`);
    await js(`document.querySelector('.item-list[aria-label="Presets in this collection"] .item-row[data-id="${selected}"] .item-main').focus()`);
    await page.key("ArrowUp", { modifiers: MOD.alt }); await page.wait(200);
    const order = await js<string[]>(`${P}.library.summary().draft.presets.map(p => p.id)`);
    await page.key("d", { modifiers: MOD.ctrl, code: "KeyD" }); await page.wait(200);
    const afterCopy = await js<number>(`${P}.library.summary().draft.presets.length`);
    const copyId = await js<string>(`${P}.library.summary().draft.selected`);
    await js(`document.querySelector('.item-list[aria-label="Presets in this collection"] .item-row[data-id="${copyId}"] .item-main').focus()`);
    await page.key("Delete"); await page.wait(250);
    const afterRemove = await js<number>(`${P}.library.summary().draft.presets.length`);
    await js(`[...document.querySelectorAll('.toast button')].find(b => b.textContent === 'Restore').click()`); await page.wait(250);
    const afterRestore = await js<number>(`${P}.library.summary().draft.presets.length`);
    record("presets: add, inline rename (F2), reorder (Alt+↑), duplicate, remove and restore",
      afterAdd === before + 1 && renamed === "Chrome dusk" && order.indexOf(selected) === afterAdd - 2 && afterCopy === afterAdd + 1 && afterRemove === afterAdd && afterRestore === afterCopy,
      { before, afterAdd, renamed, position: order.indexOf(selected), afterCopy, afterRemove, afterRestore });
  });

  await step("layers: add, rename, reorder, hide, duplicate, remove and guarded Undo", async () => {
    const add = async () => { await js(`[...document.querySelectorAll('.list-head button')].find(b => b.textContent.includes('Add layer')).click()`); await page.wait(200); };
    await add(); await add();
    const layers = await js<{ id: string; name: string }[]>(`${P}.editor.recipe().layers.map(l => ({ id: l.id, name: l.name }))`);
    const top = layers.at(-1)!;
    await js(`document.querySelector('.item-list[aria-label="Layers, front first"] .item-row[data-id="${top.id}"] .item-main').focus()`);
    await page.key("F2"); await page.wait(80); await js(`document.activeElement.select()`); await page.type("Glitter veil"); await page.key("Enter"); await page.wait(150);
    await js(`document.querySelector('.item-list[aria-label="Layers, front first"] .item-row[data-id="${top.id}"] .item-main').focus()`);
    await page.key("ArrowDown", { modifiers: MOD.alt }); await page.wait(150);
    const index = await js<number>(`${P}.editor.recipe().layers.findIndex(l => l.id === '${top.id}')`);
    await js(`document.querySelector('.item-list[aria-label="Layers, front first"] .item-row[data-id="${top.id}"] .visibility').click()`); await page.wait(150);
    const hidden = await js<boolean>(`!${P}.editor.recipe().layers.find(l => l.id === '${top.id}').enabled`);
    await js(`document.querySelector('.item-list[aria-label="Layers, front first"] .item-row[data-id="${top.id}"] .visibility').click()`); await page.wait(150);
    const count = await js<number>(`${P}.editor.recipe().layers.length`);
    await js(`document.querySelector('.item-list[aria-label="Layers, front first"] .item-row[data-id="${top.id}"] .item-main').focus()`);
    await page.key("Delete"); await page.wait(200);
    const afterRemove = await js<number>(`${P}.editor.recipe().layers.length`);
    await js(`[...document.querySelectorAll('.toast button')].find(b => b.textContent === 'Undo').click()`); await page.wait(250);
    const restored = await js<boolean>(`${P}.editor.recipe().layers.some(l => l.id === '${top.id}' && l.name === 'Glitter veil')`);
    record("layers: add, rename, reorder, hide, duplicate, remove and guarded Undo",
      layers.length >= 2 && index === layers.length - 2 && hidden && afterRemove === count - 1 && restored, { count, index, hidden, afterRemove, restored });
  });

  await step("inspector: a keyboard burst on a slider is one Undo step; Escape restores the burst's start", async () => {
    await js(`${P}.authoring.dispatch({ kind: 'layer.select', layerId: ${P}.editor.recipe().layers[0].id })`); await page.wait(200);
    await js(`${S}.dock.reveal('finish')`); await page.wait(200);
    const start = await js<number>(`${P}.editor.layer().opacity`);
    const depth = async () => js<number>(`${P}.snapshot().authoring.document.history.length`);
    const d0 = await depth();
    await js(`[...document.querySelectorAll('.control')].find(c => c.textContent.startsWith('Opacity')).querySelector('input').focus()`);
    for (let n = 0; n < 5; n++) { await page.key("ArrowLeft"); await page.wait(30); }
    await page.wait(900);
    const changed = await js<number>(`${P}.editor.layer().opacity`), d1 = await depth();
    await js(`[...document.querySelectorAll('.control')].find(c => c.textContent.startsWith('Opacity')).querySelector('input').focus()`);
    for (let n = 0; n < 3; n++) { await page.key("ArrowLeft"); await page.wait(30); }
    await page.key("Escape"); await page.wait(150);
    const escaped = await js<number>(`${P}.editor.layer().opacity`), d2 = await depth();
    record("inspector: a keyboard burst on a slider is one Undo step; Escape restores the burst's start",
      Math.abs(changed - (start - .05)) < 1e-6 && d1 === d0 + 1 && Math.abs(escaped - changed) < 1e-9 && d2 === d1, { start, changed, escaped, d0, d1, d2 });
    await js(`document.activeElement.blur()`);
  });

  await step("UV: point drag is one Undo; a live Escape mid-drag cancels without an entry", async () => {
    await js(`${S}.dock.reveal('uv')`); await js(`${P}.viewport.uvCommand('fit')`); await page.wait(300);
    const index = await js<number>(`${P}.editor.selected()`);
    const before = await js<{ u: number; v: number }>(`({ ...${P}.editor.layer().points[${index}] })`);
    const d0 = await js<number>(`${P}.snapshot().authoring.document.history.length`);
    const a = await uvPoint(index);
    await page.drag([a.x, a.y], [a.x + 24, a.y + 10], { steps: 10 }); await page.wait(250);
    const moved = await js<{ u: number; v: number }>(`({ ...${P}.editor.layer().points[${index}] })`), d1 = await js<number>(`${P}.snapshot().authoring.document.history.length`);
    const b = await uvPoint(index);
    await page.mouse("mouseMoved", b.x, b.y, { button: "none", buttons: 0 }); await page.mouse("mousePressed", b.x, b.y);
    for (let n = 1; n <= 8; n++) { await page.mouse("mouseMoved", b.x + n * 3, b.y - n * 2); await page.wait(16); }
    const midGesture = await js<boolean>(`!!${P}.authoring.previewState().gesture`);
    await page.key("Escape"); await page.wait(80); await page.mouse("mouseReleased", b.x + 24, b.y - 16); await page.wait(250);
    const after = await js<{ u: number; v: number }>(`({ ...${P}.editor.layer().points[${index}] })`), d2 = await js<number>(`${P}.snapshot().authoring.document.history.length`);
    await page.key("z", { modifiers: MOD.ctrl, code: "KeyZ" }); await page.wait(250);
    const undone = await js<{ u: number; v: number }>(`({ ...${P}.editor.layer().points[${index}] })`);
    record("UV: point drag is one Undo; a live Escape mid-drag cancels without an entry",
      (moved.u !== before.u || moved.v !== before.v) && d1 === d0 + 1 && midGesture && after.u === moved.u && after.v === moved.v && d2 === d1 &&
      Math.abs(undone.u - before.u) < 1e-12 && Math.abs(undone.v - before.v) < 1e-12, { before, moved, after, undone, d0, d1, d2, midGesture });
  });

  await step("context menu: stationary right-click on a UV point opens target commands; right-drag pans without a menu", async () => {
    const index = await js<number>(`${P}.editor.selected()`);
    const p = await uvPoint(index, true);
    await page.mouse("mouseMoved", p.x, p.y, { button: "none", buttons: 0 });
    await page.mouse("mousePressed", p.x, p.y, { button: "right" }); await page.mouse("mouseReleased", p.x, p.y, { button: "right" }); await page.wait(300);
    const menu = await js<{ heading: string; items: { label: string; disabled: boolean; reason: string }[] }>(`(() => { const m = document.querySelector('.menu'); return m && {
      heading: m.querySelector('.menu-heading')?.textContent, items: [...m.querySelectorAll('.menu-item')].map(i => ({ label: i.querySelector('.menu-label').textContent, disabled: i.getAttribute('aria-disabled') === 'true', reason: i.querySelector('.menu-reason')?.textContent ?? '' })) }; })()`);
    await shot("context-menu-uv-point");
    await page.key("Escape"); await page.wait(150);
    const view0 = await js(`JSON.stringify(${P}.viewport.snapshot().uv.view)`);
    const canvas = await rect("#device-uv-canvas");
    await page.drag([canvas!.x + 30, canvas!.y + 20], [canvas!.x + 100, canvas!.y + 50], { button: "right", steps: 10 }); await page.wait(300);
    const menuAfterPan = await js<boolean>(`!!document.querySelector('.menu')`), view1 = await js(`JSON.stringify(${P}.viewport.snapshot().uv.view)`);
    record("context menu: stationary right-click on a UV point opens target commands; right-drag pans without a menu",
      !!menu && /point/i.test(menu.heading) && menu.items.some(item => item.label === "Remove point") && !menuAfterPan && view0 !== view1,
      { heading: menu?.heading, items: menu?.items.slice(0, 8), menuAfterPan, panned: view0 !== view1 });
  });

  await step("context menu: disabled commands show the application's reason", async () => {
    const layerId = await js<string>(`${P}.editor.layer().id`);
    await js(`${P}.authoring.dispatch({ kind: 'layer.edit', command: { kind: 'move', id: '${layerId}', to: ${P}.editor.recipe().layers.length - 1 } })`); await page.wait(150);
    await js(`document.querySelector('.item-list[aria-label="Layers, front first"] .item-row[data-id="${layerId}"] .item-main').focus()`);
    await page.key("F10", { modifiers: MOD.shift }); await page.wait(250);
    const bring = await js<{ disabled: boolean; reason: string }>(`(() => { const i = [...document.querySelectorAll('.menu .menu-item')].find(i => i.textContent.includes('Bring forward')); return i && { disabled: i.getAttribute('aria-disabled') === 'true', reason: i.querySelector('.menu-reason')?.textContent ?? '' }; })()`);
    await shot("context-menu-layer-disabled-reason");
    await page.key("Escape"); await page.wait(100);
    record("context menu: disabled commands show the application's reason (keyboard Shift+F10)", !!bring?.disabled && bring.reason.length > 5, bring);
  });

  await step("head: right-click on a surface point opens point commands; background shows view commands; right-drag pans", async () => {
    const hit = await js<{ x: number; y: number } | null>(`(() => { const r = document.querySelector('[data-group="g-head"] .viewport-slot').getBoundingClientRect();
      const q = (x, y) => { const h = ${P}.viewport.contextAt('head', x, y); return h && h.affordance === 'point' && !h.mirror ? h.context.hit.index : -1; };
      for (let y = Math.round(r.top + r.height * .25); y < r.top + r.height * .55; y += 4) for (let x = Math.round(r.left + r.width * .3); x < r.left + r.width * .7; x += 4) {
        const index = q(x, y); if (index < 0) continue; const hits = [];
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (q(x + dx, y + dy) === index) hits.push([x + dx, y + dy]);
        return { x: Math.round(hits.reduce((s, h) => s + h[0], 0) / hits.length), y: Math.round(hits.reduce((s, h) => s + h[1], 0) / hits.length) }; }
      return null; })()`);
    if (!hit) throw Error("No on-head point handle found by the public contextAt query");
    const rightClick = async (x: number, y: number) => { await page.mouse("mouseMoved", x, y, { button: "none", buttons: 0 });
      await page.mouse("mousePressed", x, y, { button: "right" }); await page.mouse("mouseReleased", x, y, { button: "right" }); await page.wait(250); };
    await rightClick(hit.x, hit.y);
    const pointMenu = await js<string>(`document.querySelector('.menu .menu-heading')?.textContent + ' | ' + [...document.querySelectorAll('.menu .menu-label')].slice(0, 3).map(l => l.textContent).join(', ')`);
    await shot("context-menu-head-point");
    await page.key("Escape"); await page.wait(100);
    const bg = await rect("[data-group='g-head'] .viewport-slot");
    await rightClick(bg!.x + 40, bg!.y + 70);
    const bgMenu = await js<string>(`document.querySelector('.menu .menu-heading')?.textContent + ' | ' + [...document.querySelectorAll('.menu .menu-label')].map(l => l.textContent).join(', ')`);
    await page.key("Escape"); await page.wait(100);
    const cam0 = await js<string>(`JSON.stringify(${P}.viewport.snapshot().head.view)`);
    await page.drag([bg!.x + 40, bg!.y + 70], [bg!.x + 120, bg!.y + 100], { button: "right", steps: 10 }); await page.wait(250);
    const cam1 = await js<string>(`JSON.stringify(${P}.viewport.snapshot().head.view)`), menuAfter = await js<boolean>(`!!document.querySelector('.menu')`);
    record("head: right-click on a surface point opens point commands; background shows view commands; right-drag pans",
      /^Contour point/.test(pointMenu) && /Background/.test(bgMenu) && /Front view/.test(bgMenu) && cam0 !== cam1 && !menuAfter, { pointMenu, bgMenu, panned: cam0 !== cam1, menuAfter });
  });

  await step("performance: UV drag with the Library panel visible keeps frame pacing", async () => {
    await js(`${S}.dock.reveal('library', false)`); await js(`${P}.viewport.uvCommand('fit')`); await page.wait(400);
    const index = await js<number>(`${P}.editor.selected()`), p = await uvPoint(index);
    await js(`window.__frames = []; (function tick(t) { window.__frames.push(t); if (window.__frames.length < 300) requestAnimationFrame(tick); })(performance.now())`);
    await page.drag([p.x, p.y], [p.x + 40, p.y + 12], { steps: 40 });
    await page.key("z", { modifiers: MOD.ctrl, code: "KeyZ" }); await page.wait(200);
    const frames = await js<{ n: number; p50: number; p95: number; max: number }>(`(() => { const f = window.__frames, d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
      return { n: d.length, p50: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * .95)], max: d.at(-1) }; })()`);
    record("performance: UV drag with the Library panel visible keeps frame pacing (p95 ≤ 34 ms)", frames.p95 <= 34, frames);
  });

  await step("native text menus stay available in text fields; suppressed on other surfaces", async () => {
    await js(`window.__cm = []; window.addEventListener('contextmenu', e => setTimeout(() => window.__cm.push({ target: e.target.tagName + '.' + e.target.className, prevented: e.defaultPrevented })), true)`);
    await js(`${S}.dock.reveal('presets', false)`); await page.wait(150);
    await click(".title-field", "right"); await page.key("Escape");
    await click(".dock-tabbar-fill", "right"); await page.key("Escape"); await page.wait(100);
    const events = await js<{ target: string; prevented: boolean }[]>(`window.__cm`);
    record("native text menus stay available in text fields; suppressed on other surfaces",
      events.length >= 2 && !events[0].prevented && events[1].prevented, events);
  });

  await step("quality: 2K shows Updating then Ready with no stale claim", async () => {
    await js(`${P}.authoring.dispatch({ kind: 'quality.set', size: 2048 })`);
    const phases: string[] = [];
    for (let n = 0; n < 80; n++) { phases.push(await js<string>(`${P}.previewReadiness.snapshot().phase + ':' + ${P}.previewReadiness.snapshot().size`)); if (phases.at(-1) === "ready:2048" && n > 1) break; await page.wait(120); }
    record("quality: 2K shows Updating then Ready with no stale claim", phases.includes("updating:2048") && phases.at(-1) === "ready:2048", [...new Set(phases)]);
    await js(`${P}.authoring.dispatch({ kind: 'quality.set', size: 1024 })`); await ready();
  });

  await step("files: export recipe, collection and mask; re-import the recipe as a preset and the collection with confirm and Undo import", async () => {
    const dir = join(tmpdir(), `xfs-ui-downloads-${Date.now()}`);
    await page.downloadTo(dir);
    await js(`${S}.dock.reveal('library')`); await page.wait(250);
    const clickButton = async (label: string) => {
      const r = await js<{ x: number; y: number } | null>(`(() => { const b = [...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && b.offsetParent);
        if (!b) return null; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page.wait(120);
      if (!r) throw Error(`No visible button ${label}`);
      await page.mouse("mouseMoved", r.x, r.y, { button: "none", buttons: 0 }); await page.mouse("mousePressed", r.x, r.y); await page.mouse("mouseReleased", r.x, r.y);
    };
    const waitFile = async (name: string) => { for (let n = 0; n < 100; n++) { if (existsSync(join(dir, name))) { await page.wait(200); return join(dir, name); } await page.wait(100); } throw Error(`No download ${name}`); };
    await clickButton("Export preset recipe");
    const recipePath = await waitFile("xfs.recipe.json");
    const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
    await clickButton("Export collection");
    const collectionPath = await waitFile("xfs.collection.json");
    const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
    const layerId = await js<string>(`${P}.editor.layer().id`);
    await clickButton("Export layer mask");
    const maskPath = await waitFile(`xfs-${layerId}-alpha.png`);
    const png = readFileSync(maskPath), size = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
    const presetsBefore = await js<number>(`${P}.library.summary().draft.presets.length`);
    await page.chooseFiles([recipePath]);
    await clickButton("Import recipe as preset…"); await page.wait(800);
    const presetsAfter = await js<string[]>(`${P}.library.summary().draft.presets.map(p => p.name)`);
    const draftBefore = await js<string>(`${P}.library.summary().draft.name`);
    await js(`${P}.authoring.dispatch({ kind: 'collection.rename', name: 'Renamed before import' })`); await page.wait(150);
    await page.chooseFiles([collectionPath]);
    await clickButton("Import collection…"); await page.wait(400);
    const confirm = await js<string | null>(`document.querySelector('.menu .menu-heading')?.textContent ?? null`);
    if (confirm) { await js(`[...document.querySelectorAll('.menu .menu-item')].find(i => i.textContent.includes('Continue')).click()`); }
    await page.wait(900);
    const imported = await js<{ name: string; presets: number }>(`({ name: ${P}.library.summary().draft.name, presets: ${P}.library.summary().draft.presets.length })`);
    await js(`[...document.querySelectorAll('.toast button')].find(b => b.textContent === 'Undo import')?.click()`); await page.wait(700);
    const restored = await js<string>(`${P}.library.summary().draft.name`);
    record("files: export recipe, collection and mask; re-import the recipe as a preset and the collection with confirm and Undo import",
      /^xfs\/recipe-/.test(recipe.schema) && collection.presets?.length === presetsBefore && size.w === 2048 && size.h === 2048 &&
      presetsAfter.length === presetsBefore + 1 && presetsAfter.includes("xfs.recipe") && imported.name === collection.name && imported.presets === collection.presets.length &&
      restored === "Renamed before import",
      { recipeSchema: recipe.schema, collectionPresets: collection.presets?.length, mask: size, presetsAfter, confirm, draftBefore, imported, restored });
    await js(`${P}.authoring.dispatch({ kind: 'collection.rename', name: ${JSON.stringify("Makeup collection")} })`);
  });

  await step("library: Ctrl+S saves a revision; an external newer revision produces a conflict with recovery actions", async () => {
    await page.key("s", { modifiers: MOD.ctrl, code: "KeyS" });
    await page.waitFor(`${P}.library.summary().draft.revision >= 2 && !${P}.library.summary().busy`, 20000);
    const revision = await js<number>(`${P}.library.summary().draft.revision`);
    const id = await js<string>(`${P}.library.summary().draft.id`);
    // Another window saves a newer revision of the same collection.
    const response = await js<{ ok: boolean; status: number }>(`(async () => {
      const stored = await (await fetch('/api/verification/collections/${id}')).json();
      stored.collection.name = 'Saved elsewhere';
      const r = await fetch('/api/verification/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: stored.collection, revision: stored.revision }) });
      return { ok: r.ok, status: r.status };
    })()`);
    await js(`${P}.authoring.dispatch({ kind: 'layer.setOpacity', layerId: ${P}.editor.layer().id, opacity: .61 })`);
    await js(`${S}.runtime.request({ kind: 'refresh' }, { quietSuccess: true })`); await page.wait(400);
    const chip = await js<string>(`document.querySelector('.crumbs .chip').textContent`);
    await page.key("s", { modifiers: MOD.ctrl, code: "KeyS" }); await page.wait(600);
    const toast = await js<{ text: string; actions: string[] }>(`(() => { const t = [...document.querySelectorAll('.toast.error')].at(-1); return t && { text: t.textContent, actions: [...t.querySelectorAll('.toast-actions button')].map(b => b.textContent) }; })()`);
    const kept = await js<number>(`${P}.editor.layer().opacity`);
    await shot("library-conflict");
    record("library: Ctrl+S saves a revision; an external newer revision produces a conflict with recovery actions",
      revision >= 2 && response.ok && /Newer r/i.test(chip) && !!toast && toast.actions.includes("Refresh library") && toast.actions.includes("Save as copy") && kept === .61,
      { revision, external: response, chip, toast, kept });
    await js(`[...document.querySelectorAll('.toast button')].forEach(b => { if (b.getAttribute('aria-label') === 'Dismiss notification') b.click(); })`);
  });

  await step("library: open a saved revision, then recover the previous draft", async () => {
    await js(`${S}.dock.reveal('library')`); await page.wait(200);
    const draftName = await js<string>(`${P}.library.summary().draft.name`);
    await js(`${S}.runtime.request({ kind: 'open', id: ${P}.library.summary().draft.id })`); await page.wait(600);
    const opened = await js<string>(`${P}.library.summary().draft.name`);
    await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('Recover previous draft')).click()`); await page.wait(600);
    const conflictDraftKept = await js<boolean>(`${P}.library.summary().draft.name !== 'Saved elsewhere'`); void conflictDraftKept;
    const recovered = await js<{ name: string; opacity: number }>(`({ name: ${P}.library.summary().draft.name, opacity: ${P}.editor.layer()?.opacity })`);
    record("library: open a saved revision, then recover the previous draft",
      opened === "Saved elsewhere" && recovered.name === draftName && recovered.opacity === .61, { draftName, opened, recovered });
  });

  await step("package: Check omits the preview-study layer, shows Current, turns Stale after an edit", async () => {
    await js(`(() => { const port = ${P}, layer = port.editor.recipe().layers.find(l => l.name === 'Glitter veil') ?? port.editor.layer();
      port.authoring.dispatch({ kind: 'layer.setFinish', layerId: layer.id, finish: 'glitter' }); })()`);
    await js(`${S}.dock.reveal('package')`); await page.wait(200);
    await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('Check mod export')).click()`);
    await page.waitFor(`${P}.files.snapshot().package && !${P}.library.summary().busy`, 60000);
    const card = await js<{ fresh: string; text: string }>(`({ fresh: document.querySelector('.result-card')?.dataset.freshness, text: document.querySelector('.package-result')?.textContent })`);
    await shot("package-check-current");
    await js(`${P}.authoring.dispatch({ kind: 'layer.setOpacity', layerId: ${P}.editor.layer().id, opacity: .58 })`);
    // The Mod package panel repaints at most every 400 ms (it re-validates the whole draft).
    const stale = await page.waitFor(`document.querySelector('.result-card')?.dataset.freshness === 'stale' && 'stale'`, 3000).catch(() => "current");
    record("package: Check omits the preview-study layer, shows Current, turns Stale after an edit",
      card.fresh === "current" && /Glitter veil/.test(card.text) && /Omitted/i.test(card.text) && stale === "stale", { fresh: card.fresh, stale, excerpt: card.text.slice(0, 240) });
    await shot("package-check-stale");
  });

  if (withBuild) await step("package: Build (optional) reports a verified local candidate or an honest failure", async () => {
    await js(`${S}.runtime.request({ kind: 'package', action: 'build' })`);
    await page.waitFor(`!${P}.library.summary().busy`, 600000);
    const last = await js(`${P}.files.snapshot().last`), pkg = await js(`${P}.files.snapshot().package?.kind`);
    record("package: Build (optional) reports a verified local candidate or an honest failure", !!last, { last, pkg });
  });

  await step("review fixes: Mod package repaints beside a visible Library; a bare slider click opens no transaction", async () => {
    await js(`${S}.dock.reveal('library', false)`); await js(`${S}.dock.float('package')`); await page.wait(400);
    const bothVisible = await js<boolean>(`${S}.dock.isVisible('library') && ${S}.dock.isVisible('package')`);
    await js(`${P}.authoring.dispatch({ kind: 'layer.setOpacity', layerId: ${P}.editor.layer().id, opacity: .57 })`);
    const stale = await page.waitFor(`document.querySelector('.dock-window .result-card')?.dataset.freshness === 'stale' && 'stale'`, 3000).catch(() => "not repainted");
    await js(`[...document.querySelectorAll('.dock-window .btn')].find(b => b.textContent.includes('Check mod export')).click()`);
    const fresh = await page.waitFor(`!${P}.library.summary().busy && document.querySelector('.dock-window .result-card')?.dataset.freshness === 'current' && 'current'`, 60000).catch(() => "not repainted");
    await js(`${S}.dock.reveal('finish')`); await page.wait(250);
    const thumb = await js<{ x: number; y: number }>(`(() => { const input = [...document.querySelectorAll('.control')].find(c => c.textContent.startsWith('Opacity')).querySelector('input');
      const r = input.getBoundingClientRect(), f = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
      return { x: r.left + 6 + f * (r.width - 12), y: r.top + r.height / 2 }; })()`);
    const depth0 = await js<number>(`${P}.snapshot().authoring.document.history.length`);
    await page.mouse("mouseMoved", thumb.x, thumb.y, { button: "none", buttons: 0 }); await page.mouse("mousePressed", thumb.x, thumb.y); await page.mouse("mouseReleased", thumb.x, thumb.y);
    await page.wait(200);
    const control = await js(`${P}.authoring.previewState().control ?? null`), depth1 = await js<number>(`${P}.snapshot().authoring.document.history.length`);
    await js(`document.activeElement.blur()`);
    record("review fixes: Mod package repaints beside a visible Library; a bare slider click opens no transaction",
      bothVisible && stale === "stale" && fresh === "current" && control === null && depth1 === depth0, { bothVisible, stale, fresh, control, depth0, depth1 });
    await js(`${S}.dock.reset()`); await page.wait(300);
  });

  await step("dock: a large panel overlapping another group floats until the CURSOR reaches a guide", async () => {
    await js(`${S}.dock.float('character')`); await page.wait(300);
    await js(`(() => { const d = ${S}.dock, w = d.tree.floating.at(-1); d.update(Object.assign(structuredClone(d.tree), { floating: d.tree.floating.map(x => x.id === w.id ? { ...x, x: 380, y: 120, w: 760, h: 520 } : x) })); })()`);
    await page.wait(300);
    const win = await rect(".dock-window:has(#dock-tab-character)");
    const fill = await rect(".dock-window:has(#dock-tab-character) .dock-tabbar-fill");
    const target = await rect("[data-group='g-finish']");
    // Grab the far left of the bar and move so the big window covers g-finish while the cursor stays over the head stage (no guide there).
    const start = { x: fill!.x + 12, y: fill!.cy };
    const cursor = { x: target!.x - 120, y: target!.y + 40 };
    await page.mouse("mouseMoved", start.x, start.y, { button: "none", buttons: 0 }); await page.mouse("mousePressed", start.x, start.y);
    for (let n = 1; n <= 14; n++) { await page.mouse("mouseMoved", start.x + (cursor.x - start.x) * n / 14, start.y + (cursor.y - start.y) * n / 14); await page.wait(16); }
    await page.wait(120);
    const during = await js<{ label: string; overlap: boolean }>(`(() => { const w = document.querySelector('.dock-window:has(#dock-tab-character)').getBoundingClientRect(), g = document.querySelector("[data-group='g-finish']").getBoundingClientRect();
      return { label: document.querySelector('.dock-preview')?.dataset.label ?? '', overlap: w.right > g.left && w.left < g.right && w.bottom > g.top && w.top < g.bottom }; })()`);
    await shot("dock-large-overlap-no-snap");
    await page.mouse("mouseReleased", cursor.x, cursor.y); await page.wait(300);
    const floating = await js<boolean>(`${S}.dock.tree.floating.some(w => JSON.stringify(w.node).includes('character'))`);
    // Now put the cursor on g-finish's compass centre: it joins as a tab.
    const bar = await rect(".dock-window:has(#dock-tab-character) .dock-tabbar-fill");
    const g = await rect("[data-group='g-finish']");
    await page.mouse("mouseMoved", bar!.x + 12, bar!.cy, { button: "none", buttons: 0 }); await page.mouse("mousePressed", bar!.x + 12, bar!.cy);
    for (let n = 1; n <= 14; n++) { await page.mouse("mouseMoved", bar!.x + 12 + (g!.cx - bar!.x - 12) * n / 14, bar!.cy + (g!.cy - bar!.cy) * n / 14); await page.wait(16); }
    await page.wait(120);
    const label = await js<string>(`document.querySelector('.dock-preview')?.dataset.label ?? ''`);
    await shot("dock-cursor-on-centre-guide");
    await page.mouse("mouseReleased", g!.cx, g!.cy); await page.wait(300);
    const merged = await js<string[]>(`${S}.dock.tree.floating.length === 0 || true ? [...document.querySelectorAll("[data-group='g-finish'] .dock-tab")].map(t => t.dataset.panel) : []`);
    record("dock: a large panel overlapping another group floats until the CURSOR reaches a guide",
      during.overlap && during.label === "" && floating && label === "Add as tab" && merged.includes("character"), { during, floating, label, merged, window: win });
  });

  await step("dock: floating panels magnetize by cursor band into a composite; keyboard menu docks it back", async () => {
    await js(`${S}.dock.float('motion')`); await page.wait(200); await js(`${S}.dock.float('lighting')`); await page.wait(300);
    const motion = await rect(".dock-window:has(#dock-tab-motion)"), bar = await rect(".dock-window:has(#dock-tab-lighting) .dock-tabbar-fill");
    await page.drag([bar!.x + 14, bar!.cy], [motion!.x + motion!.w + 6, motion!.cy], { steps: 16 }); await page.wait(300);
    const composite = await js<{ kind: string; w: number }>(`(() => { const w = ${S}.dock.tree.floating.find(w => JSON.stringify(w.node).includes('motion')); return w && { kind: w.node.kind, w: w.w }; })()`);
    await shot("dock-magnetic-composite");
    // Keyboard alternative: focus the Motion tab, Shift+F10, "Add as tab to" → first group.
    await js(`document.getElementById('dock-tab-motion').focus()`); await page.key("F10", { modifiers: MOD.shift }); await page.wait(250);
    const items = await js<string[]>(`[...document.querySelectorAll('.menu .menu-item .menu-label')].map(l => l.textContent)`);
    const index = items.indexOf("Add as tab to");
    for (let n = 0; n < index; n++) { await page.key("ArrowDown"); await page.wait(20); }
    await page.key("ArrowRight"); await page.wait(200); await page.key("Enter"); await page.wait(300);
    const docked = await js<boolean>(`!${S}.dock.tree.floating.some(w => JSON.stringify(w.node).includes('"motion"'))`);
    record("dock: floating panels magnetize by cursor band into a composite; keyboard menu docks it back",
      composite?.kind === "split" && docked, { composite, docked, menu: items });
  });

  await step("F6 cycles focus through header, groups and status bar", async () => {
    await js(`document.querySelector('.brand-mark') && document.querySelector('.category').focus()`);
    const seen: string[] = [];
    for (let n = 0; n < 5; n++) { await page.key("F6"); await page.wait(60); seen.push(await js<string>(`(document.activeElement.closest('.dock-group')?.getAttribute('aria-label') ?? document.activeElement.closest('header,footer')?.className ?? document.activeElement.tagName)`)); }
    record("F6 cycles focus through header, groups and status bar", new Set(seen).size >= 4, seen);
  });

  await step("theme: explicit Light persists; System follows the OS", async () => {
    await js(`${S}.commands().find(c => c.id === 'theme.light').run()`); await page.wait(250);
    await shot("wide-light-after-edits");
    const light = await js<string>(`document.documentElement.dataset.theme`);
    await page.colorScheme("dark");
    record("theme: explicit Light overrides a dark OS preference", light === "light" && await js<string>(`document.documentElement.dataset.theme`) === "light", { light });
  });

  // Reload restores layout, theme, preset/layer selection, UV view and camera.
  const before = await js(`({ layout: ${S}.dock.tree, preset: ${P}.library.summary().draft.selected, layer: ${P}.editor.layer()?.id,
    uv: JSON.stringify(${P}.viewport.snapshot().uv.view), fov: ${P}.authoring.previewState().preview.camera.fov, theme: ${P}.preferences.snapshot().theme, names: ${P}.library.summary().draft.presets.map(p => p.name) })`);
  await js(`${P}.authoring.dispatch({ kind: 'camera.setFov', degrees: 42 }); ${P}.authoring.dispatch({ kind: 'camera.endFovGesture' })`);
  await page.wait(600);
  await page.send("Page.reload"); await ready(); await page.wait(800);
  await step("reload restores layout, theme, selection, preset names, UV view and FOV", async () => {
    const after = await js(`({ layout: ${S}.dock.tree, preset: ${P}.library.summary().draft.selected, layer: ${P}.editor.layer()?.id,
      uv: JSON.stringify(${P}.viewport.snapshot().uv.view), fov: ${P}.authoring.previewState().preview.camera.fov, theme: ${P}.preferences.snapshot().theme, names: ${P}.library.summary().draft.presets.map(p => p.name) })`);
    const diff = Object.keys(before).filter(key => canonical(before[key]) !== canonical(after[key]));
    record("reload restores layout, theme, selection, preset names, UV view and FOV",
      canonical(after.layout) === canonical(before.layout) && after.preset === before.preset && after.layer === before.layer && after.uv === before.uv && Math.round(after.fov) === 42 && after.theme === "light" &&
      JSON.stringify(after.names) === JSON.stringify(before.names), { diff, floating: after.layout.floating.length, before: { ...before, layout: undefined }, after: { ...after, layout: undefined } });
  });
  await shot("wide-light-reloaded");

  await step("recovery: an off-screen saved window is pulled back on reload", async () => {
    await js(`(() => { const d = ${S}.dock; d.float('quality'); const w = d.tree.floating.at(-1); d.update(Object.assign(structuredClone(d.tree), { floating: d.tree.floating.map(x => x.id === w.id ? { ...x, x: 5000, y: 3000 } : x) })); })()`);
    await page.wait(400); await page.send("Page.reload"); await ready(); await page.wait(600);
    const window = await js<{ x: number; y: number }>(`(() => { const w = ${S}.dock.tree.floating.find(w => JSON.stringify(w.node).includes('quality')); return w && { x: w.x, y: w.y }; })()`);
    const visible = await rect(".dock-window:has(#dock-tab-quality) .dock-tabbar");
    record("recovery: an off-screen saved window is pulled back on reload", !!window && window.x < 1600 && window.y < 1000 && !!visible && visible.y < 1000 && visible.x < 1600, { window, visible });
    await js(`${S}.dock.reset()`);
  });

  await step("compact layout at 900 px and theme screenshots", async () => {
    await js(`${S}.commands().find(c => c.id === 'theme.dark').run()`);
    await page.viewport(900, 900); await page.wait(900);
    const compact = await js<string[]>(`[...document.querySelectorAll('.dock-group')].map(g => g.getAttribute('aria-label'))`);
    await shot("compact-dark");
    await js(`${S}.commands().find(c => c.id === 'theme.light').run()`); await page.wait(200);
    await shot("compact-light");
    record("compact layout at 900 px uses its own arrangement", compact.length >= 2 && compact.some(label => /Head/.test(label!) && /UV map/.test(label!)), compact);
    await page.viewport(1600, 1000); await js(`${S}.commands().find(c => c.id === 'theme.system').run()`); await page.wait(600);
    await shot("wide-dark-system");
  });

  // The library-conflict step deliberately provokes one HTTP 409, which the browser logs as a failed resource.
  const expected = (text: string) => /status of 409 \(Conflict\)/.test(text);
  const errors = page.console.filter(entry => (entry.type === "exception" || entry.type === "error" || entry.type === "log:error") && !expected(entry.text));
  record("no application exceptions or unexpected console errors during the pass (one intentional 409 conflict excluded)", errors.length === 0,
    { unexpected: errors.slice(0, 5), expectedConflicts: page.console.filter(entry => expected(entry.text)).length });
} finally {
  saveJson("evidence/ui-overhaul-2026-09-24/acceptance.json", { date: "2026-09-24", url, isolated: { verification: true, dataDir: "disposable temp", chromeProfile: "disposable temp" },
    build: withBuild, results, screenshots: shots.map(name => `${name}.png`) });
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
  await page.close(); server.kill(); void data;
}
