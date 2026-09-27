/**
 * UI/UX gate captures of the Expression sets panel (research/animation/expression-editor-design.md phase 3 status) in an isolated
 * `?verify=1` workspace: a throwaway headless Chrome profile against a running server, light and dark, the panel at about 300 and 480 px.
 * States: no sets (with and without saved expressions), each popover and menu, a set with a deleted member, a loaded (selected) member
 * with keyboard focus, hover, an empty set, Add unavailable, the game files being read, a Check with what was left out, its Details, a
 * stale result, a set with nothing packageable, Check unavailable, the Build confirm, building and built, the drawer's entry, and the
 * patterns they follow (the Presets list and the Mod package result) at the same width. Viewports are masked: no game imagery.
 *
 *   bun tools/expression-sets-look.ts <out dir> [port]      (the server must already run on the port with ?verify=1 storage)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, type Session } from "./cdp";

const [outArg, portArg = "4391"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/expression-sets-look.ts <out dir> [port]");
const out = resolve(outArg), port = Number(portArg), base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const api = `${base}/api/verification/part-presets`;
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });
const call = async <T>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, init); if (!r.ok) throw Error(`${url}: ${await r.text()}`); return r.json() as Promise<T>; };
type Row = { id: string; name: string; revision: number };
const clearLibrary = async () => {
  for (const set of await call<Row[]>(`${api}/sets?feature=expressions`)) await call(`${api}/sets/${set.id}?revision=${set.revision}`, { method: "DELETE", headers: { Origin: base } });
  for (const preset of await call<Row[]>(`${api}?feature=expressions`)) await call(`${api}/${preset.id}?revision=${preset.revision}`, { method: "DELETE", headers: { Origin: base } });
};
const save = (name: string, body: unknown) => call<Row>(api, json("POST", { feature: "expressions", name, part: { schema: "xfs/expression-part-1", body } }));
const gone = "00000000-0000-4000-8000-00000000dead";

const report: Record<string, unknown> = { date: new Date().toISOString(), captures: [] as string[] };
const tabs = (page: Session, title: string) => page.evaluate(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === ${JSON.stringify(title)}); t?.click(); return !!t; })()`);
/** Size the dock group holding a panel to the pass's width, so the panel is seen as a person with that width sees it. */
const sizeGroup = (page: Session, tab: string, width: number) => page.evaluate(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === ${JSON.stringify(tab)});
  const g = t?.closest('.dock-group'); if (!g) return false; g.style.width = "${width}px"; g.style.flex = "none"; g.style.maxWidth = "${width}px"; return true; })()`);
async function openPanel(page: Session, width: number) {
  await page.waitFor("window.xfStudioShell && document.querySelector('.dock-group')", 120000);
  await page.evaluate(`(() => { document.querySelector('button[title="Skip tour"]')?.click(); window.xfStudioShell.runtime.modules.set("expressions", true); return true; })()`);
  await page.wait(500);
  await page.evaluate(MASK_VIEWPORTS);
  await tabs(page, "Expression sets");
  await page.waitFor("document.querySelector('.expr-sets')?.offsetParent", 20000);
  await sizeGroup(page, "Expression sets", width);
  await page.wait(800);
}
/** The dock group of a panel, and anything floating over it (menus, popovers) within `extra` px. */
async function groupShot(page: Session, selector: string, file: string, extra = 0) {
  const rect = await page.evaluate(`(() => { const g = document.querySelector(${JSON.stringify(selector)})?.closest('.dock-group'); if (!g) return null;
    const r = g.getBoundingClientRect(); const x = Math.max(0, r.left - ${extra}); return { x, y: Math.max(0, r.top), width: Math.min(innerWidth - x, r.width + 2 * ${extra}), height: Math.min(innerHeight - r.top, r.height) }; })()`);
  if (!rect) return;
  await page.screenshot(resolve(out, file), rect);
  (report.captures as string[]).push(file);
}
/** The dock group together with the open menu or popover over it, uncropped (padded 12 px). */
async function floatingShot(page: Session, selector: string, file: string) {
  const rect = await page.evaluate(`(() => { const g = document.querySelector(${JSON.stringify(selector)})?.closest('.dock-group'); if (!g) return null;
    const boxes = [g, ...document.querySelectorAll('.menu, form.popover')].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
    const x = Math.max(0, Math.min(...boxes.map(r => r.left)) - 12), y = Math.max(0, Math.min(...boxes.map(r => r.top)) - 12);
    const right = Math.min(innerWidth, Math.max(...boxes.map(r => r.right)) + 12), bottom = Math.min(innerHeight, Math.max(...boxes.map(r => r.bottom)) + 12);
    return { x, y, width: right - x, height: bottom - y }; })()`);
  if (!rect) return;
  await page.screenshot(resolve(out, file), rect);
  (report.captures as string[]).push(file);
}
const click = (page: Session, selector: string, text: string) =>
  page.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw Error("no " + ${JSON.stringify(text)}); b.click(); return true; })()`);
const closeFloating = async (page: Session) => { await page.key("Escape"); await page.evaluate(`document.querySelectorAll('form.popover, .menu').forEach(f => f.remove())`); };
const chooseSet = (page: Session, name: string) => page.evaluate(`[...document.querySelectorAll('.expr-sets ol[aria-label="Your expression sets"] .item-main')].find(b => b.textContent.includes(${JSON.stringify(name)}))?.click()`);
const scrollResult = (page: Session) => page.evaluate(`document.querySelector('.expr-sets .package-result')?.scrollIntoView({ block: 'end' })`);
const reload = async (page: Session, width: number) => { await page.send("Page.reload"); await page.wait(500); await openPanel(page, width); };

const passes = (["dark", "light"] as const).flatMap(scheme => ([300, 480] as const).map(width => ({ scheme, width })));
for (const [index, { scheme, width }] of passes.entries()) {
  const tag = `${scheme}-${width}`, shot = (what: string, extra = 0) => groupShot(page, ".expr-sets", `${tag}-${what}.png`, extra);
  await clearLibrary();
  const page = await launch(`${base}/?verify=1`, { width: 1500, height: 1000, scheme });
  try {
    await openPanel(page, width);
    await shot("01a-empty-nothing-saved");
    const sly = await save("Sly half smile", { label: "Sly smile", controls: { lips_l_corner_up: 0.45, lips_l_corner_sharp_up: 0.3, eye_l_oculi_squint_outer_lower: 0.35, eye_r_brows_raise_out: 0.2 }, links: {} });
    const wide = await save("Wide-eyed", { controls: { eye_l_widen: 0.7, eye_r_widen: 0.7, eye_l_brows_raise_in: 0.5, eye_r_brows_raise_in: 0.5, jaw_mid_open: 0.15 }, links: {} });
    const old = await save("Old rig face", { controls: { tongue_imaginary_curl: 0.5, jaw_mid_open: 0.2 }, links: {} });
    await reload(page, width);
    await shot("01b-empty-with-saved");
    await click(page, ".expr-sets button", "New set"); await page.wait(400);
    await shot("02-new-set-popover", 20); await closeFloating(page);
    await call(`${api}/sets`, json("POST", { feature: "expressions", name: "Moody faces", members: [sly.id, gone, wide.id, old.id] }));
    await call(`${api}/sets`, json("POST", { feature: "expressions", name: "Old faces", members: [old.id] }));
    await call(`${api}/sets`, json("POST", { feature: "expressions", name: "Empty set", members: [] }));
    await call(`${api}/sets`, json("POST", { feature: "expressions", name: "Everything", members: [sly.id, wide.id, old.id] }));
    await call(`${api}/sets`, json("POST", { feature: "expressions", name: "Gone only", members: [gone] }));
    await reload(page, width);
    await chooseSet(page, "Moody"); await page.wait(400);
    await shot("03a-set-with-deleted-member");
    // A member loaded into the Expression panel is selected; Tab reaches its Remove.
    await page.evaluate(`[...document.querySelectorAll('.expr-sets ol[aria-label^="Expressions in this set"] .item-main')][0].click()`); await page.wait(500);
    await page.evaluate(`document.querySelector('.expr-sets ol[aria-label^="Expressions in this set"] .item-row.selected .item-main').focus()`);
    await page.key("Tab"); await page.wait(200);
    await shot("03b-loaded-member-focus");
    const hover = await page.evaluate(`(() => { const r = [...document.querySelectorAll('.expr-sets ol[aria-label^="Expressions in this set"] .item-row')][2].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`) as [number, number];
    await page.mouse("mouseMoved", hover[0], hover[1], { button: "none", buttons: 0 }); await page.wait(200);
    await shot("03c-hover");
    await page.mouse("mouseMoved", 5, 5, { button: "none", buttons: 0 });
    await click(page, ".expr-sets button", "Add…"); await page.wait(300);
    await shot("04a-add-menu", 60); await closeFloating(page);
    await page.evaluate(`document.querySelector('.expr-sets ol[aria-label="Your expression sets"] .item-row.selected button[aria-label^="More actions"]').click()`); await page.wait(300);
    await shot("05a-set-menu", 60); await closeFloating(page);
    await page.evaluate(`(() => { const row = document.querySelector('.expr-sets ol[aria-label="Your expression sets"] .item-row.selected'); const r = row.getBoundingClientRect();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); document.querySelector('.expr-sets ol[aria-label="Your expression sets"] .item-row.selected .item-main').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return true; })()`);
    await page.wait(300);
    await shot("05b-delete-set-confirm", 60); await closeFloating(page);
    await page.evaluate(`(() => { const row = document.querySelector('.expr-sets ol[aria-label^="Expressions in this set"] .item-row'); const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); return true; })()`); await page.wait(300);
    await shot("06-member-menu", 60); await closeFloating(page);
    await page.evaluate(`document.querySelector('.expr-sets .package-mods button').click()`); await page.wait(300);
    await floatingShot(page, ".expr-sets", `${tag}-07a-mod-menu.png`);
    await click(page, "[role=menuitem], .menu button", "Rename"); await page.wait(300);
    await floatingShot(page, ".expr-sets", `${tag}-07b-rename-mod-popover.png`); await closeFloating(page);
    // Check: the first pass reads the game files first (a note says so); then what can be packaged and what was left out.
    for (let attempt = 0; attempt < 40; attempt++) {
      await click(page, ".expr-sets button", "Check");
      await page.waitFor(`document.querySelector('.expr-sets .result-card') && document.querySelector('.expr-sets .package-progress').classList.contains('idle')`, 60000);
      await page.wait(300);
      if (!(await page.evaluate(`document.querySelector('.expr-sets .result-card').innerText.includes('check again in a moment')`))) break;
      if (attempt === 0) { await scrollResult(page); await shot("08a-check-reading-game-files"); }
      await page.wait(4000);
    }
    await scrollResult(page); await page.wait(300);
    await shot("08b-check-left-out");
    await page.evaluate(`document.querySelector('.expr-sets .package-result .expander')?.click()`); await page.wait(300); await scrollResult(page);
    await shot("08c-check-details");
    await click(page, ".expr-sets .segment", "Sharing"); await page.wait(800); await scrollResult(page);
    await shot("08d-stale");
    await click(page, ".expr-sets .segment", "My game"); await page.wait(500);
    await chooseSet(page, "Old faces"); await page.wait(400);
    await click(page, ".expr-sets button", "Check"); await page.waitFor(`document.querySelector('.expr-sets .result-card.stale')`, 60000); await page.wait(300); await scrollResult(page);
    await shot("09a-nothing-packageable");
    await chooseSet(page, "Empty set"); await page.wait(400);
    await shot("09b-empty-set-check-unavailable");
    await chooseSet(page, "Everything"); await page.wait(400);
    await shot("09c-add-unavailable");
    await chooseSet(page, "Gone only"); await page.wait(400);
    await shot("09d-only-deleted");
    await chooseSet(page, "Moody"); await page.wait(400);
    await click(page, ".expr-sets button", "Build mod files"); await page.wait(300);
    await shot("10-build-confirm", 60);
    await click(page, "[role=menuitem], .menu button", "Build now");
    await page.wait(1500); await shot("11-building");
    await page.waitFor(`document.querySelector('.expr-sets .result-card')?.textContent.includes('Build result') || document.querySelector('.expr-sets .result-card.error')`, 400000);
    await page.wait(500); await scrollResult(page); await page.wait(300);
    await shot("12-built");
    report[`${tag}-build`] = await page.evaluate(`document.querySelector('.expr-sets .result-card').innerText`);
    // The drawer: Face › More holds "Export to photo mode…".
    await tabs(page, "Expression"); await sizeGroup(page, "Expression", width); await page.wait(600);
    await page.evaluate(`document.querySelector('.expr-drawer button[aria-label="More face commands"]').click()`); await page.wait(300);
    await groupShot(page, ".expr-drawer", `${tag}-13-drawer-menu.png`, 200);
    await closeFloating(page);
    // The patterns followed, at the same width: the Presets list and the Mod package result.
    await tabs(page, "Presets"); await sizeGroup(page, "Presets", width); await page.wait(500);
    await groupShot(page, "ol[aria-label='Presets in this collection']", `${tag}-14-pattern-presets.png`);
    await tabs(page, "Mod package"); await sizeGroup(page, "Mod package", width); await page.wait(500);
    await click(page, "button", "Check").catch(() => {}); await page.wait(5000);
    await page.evaluate(`document.querySelector('.package-result')?.scrollIntoView({ block: 'end' })`); await page.wait(300);
    await groupShot(page, ".package-result", `${tag}-15-pattern-mod-package.png`);
    report[`${tag}-console`] = page.console.filter(entry => entry.type === "exception" || entry.type === "error");
  } finally { await page.close(); }
  if (index === passes.length - 1) await clearLibrary();
}

// Comparison sheets at matching widths: each state beside the pattern it follows.
const pairs: [string, string, string][] = [
  ["Sets and members (ItemList)", "03a-set-with-deleted-member", "14-pattern-presets"],
  ["Loaded member, keyboard focus", "03b-loaded-member-focus", "14-pattern-presets"],
  ["Check result", "08b-check-left-out", "15-pattern-mod-package"],
  ["Check details", "08c-check-details", "15-pattern-mod-package"],
  ["Stale result", "08d-stale", "15-pattern-mod-package"],
  ["Nothing packageable", "09a-nothing-packageable", "15-pattern-mod-package"],
  ["Build result", "12-built", "15-pattern-mod-package"],
];
const sheet = (tag: string) => `<!doctype html><meta charset=utf-8><title>${tag}</title><style>body{font:13px system-ui;background:#888;margin:12px}section{display:flex;gap:16px;align-items:flex-start;margin-bottom:24px}
figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}img{border:1px solid #444}</style><h1>${tag}</h1>` + pairs.map(([title, own, pattern]) =>
  `<h2>${title}</h2><section><figure><figcaption>Expression sets</figcaption><img src="${tag}-${own}.png"></figure><figure><figcaption>Pattern it follows</figcaption><img src="${tag}-${pattern}.png"></figure></section>`).join("");
const tags = passes.map(pass => `${pass.scheme}-${pass.width}`);
for (const tag of tags) writeFileSync(resolve(out, `compare-${tag}.html`), sheet(tag));
const viewer = await launch("about:blank", { width: 1200, height: 1000 });
try {
  for (const tag of tags) {
    await viewer.send("Page.navigate", { url: `file:///${resolve(out, `compare-${tag}.html`).replaceAll("\\", "/")}` }); await viewer.wait(1200);
    const height = await viewer.evaluate(`document.documentElement.scrollHeight`);
    await viewer.viewport(1200, Math.min(height, 14000)); await viewer.wait(400);
    await viewer.screenshot(resolve(out, `compare-${tag}.png`));
  }
} finally { await viewer.close(); }
writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ captures: (report.captures as string[]).length }));
