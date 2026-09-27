/**
 * UI/UX gate captures of the Expression sets panel (research/animation/expression-editor-design.md phase 3 status) in an isolated
 * `?verify=1` workspace: a throwaway Chrome profile against a running server, light and dark, a narrow and a wide window. States: no sets,
 * a set with a deleted member, a Check with an expression left out, a refused Check, a Build, the drawer's entry and each popover, plus the
 * patterns they follow (the Presets list and the Mod package result). Viewports are masked, so the captures hold no game imagery.
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

// ---- The verification library: three saved expressions (one uses a control the rig lacks), two sets ----
type Row = { id: string; name: string; revision: number };
for (const set of await call<Row[]>(`${api}/sets?feature=expressions`)) await call(`${api}/sets/${set.id}?revision=${set.revision}`, { method: "DELETE", headers: { Origin: base } });
for (const preset of await call<Row[]>(`${api}?feature=expressions`)) await call(`${api}/${preset.id}?revision=${preset.revision}`, { method: "DELETE", headers: { Origin: base } });
const save = (name: string, body: unknown) => call<Row>(api, json("POST", { feature: "expressions", name, part: { schema: "xfs/expression-part-1", body } }));
const sly = await save("Sly half smile", { label: "Sly smile", controls: { lips_l_corner_up: 0.45, lips_l_corner_sharp_up: 0.3, eye_l_oculi_squint_outer_lower: 0.35, eye_r_brows_raise_out: 0.2 }, links: {} });
const wide = await save("Wide-eyed", { controls: { eye_l_widen: 0.7, eye_r_widen: 0.7, eye_l_brows_raise_in: 0.5, eye_r_brows_raise_in: 0.5, jaw_mid_open: 0.15 }, links: {} });
const old = await save("Old rig face", { controls: { tongue_imaginary_curl: 0.5, jaw_mid_open: 0.2 }, links: {} });
const gone = "00000000-0000-4000-8000-00000000dead";

const report: Record<string, unknown> = { date: new Date().toISOString(), captures: [] as string[] };
async function openPanel(page: Session) {
  await page.waitFor("window.xfStudioShell && document.querySelector('.dock-group')", 120000);
  await page.evaluate(`(() => { document.querySelector('button[title="Skip tour"]')?.click(); window.xfStudioShell.runtime.modules.set("expressions", true); return true; })()`);
  await page.wait(500);
  await page.evaluate(MASK_VIEWPORTS);
  await page.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Expression sets').click()`);
  await page.waitFor("document.querySelector('.expr-sets')?.offsetParent", 20000);
  await page.wait(800);
}
/** The Expression sets panel's dock group, and anything floating over it (menus, popovers). */
async function panelShot(page: Session, file: string, extra = 0) {
  const rect = await page.evaluate(`(() => { const g = document.querySelector('.expr-sets').closest('.dock-group') ?? document.querySelector('.expr-sets');
    const r = g.getBoundingClientRect(); return { x: Math.max(0, r.left - ${extra}), y: Math.max(0, r.top - ${extra}), width: Math.min(innerWidth, r.width + 2 * ${extra}), height: Math.min(innerHeight - r.top, r.height + ${extra}) }; })()`);
  await page.screenshot(resolve(out, file), rect);
  (report.captures as string[]).push(file);
}
const click = (page: Session, selector: string, text: string) =>
  page.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw Error("no " + ${JSON.stringify(text)}); b.click(); return true; })()`);
const closeFloating = (page: Session) => page.evaluate(`(() => { document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelectorAll('form.popover').forEach(f => f.remove()); return true; })()`).then(() => page.key("Escape"));

for (const scheme of ["dark", "light"] as const) {
  for (const [size, width, height] of [["narrow", 1280, 860], ["wide", 1920, 1080]] as const) {
    // Fresh sets each pass, so every pass shows the same states.
    for (const set of await call<Row[]>(`${api}/sets?feature=expressions`)) await call(`${api}/sets/${set.id}?revision=${set.revision}`, { method: "DELETE", headers: { Origin: base } });
    const page = await launch(`${base}/?verify=1`, { width, height, scheme });
    const tag = `${scheme}-${size}`;
    try {
      await openPanel(page);
      await panelShot(page, `${tag}-01-empty.png`);
      // New set… popover.
      await click(page, ".expr-sets button", "New set");
      await page.wait(400);
      await panelShot(page, `${tag}-02-new-set-popover.png`, 40);
      await closeFloating(page);
      // Sets made through the library (the same requests the panel sends), then the page reads them.
      const moody = await call<Row & { members: string[] }>(`${api}/sets`, json("POST", { feature: "expressions", name: "Moody faces", members: [sly.id, gone, wide.id, old.id] }));
      await call(`${api}/sets`, json("POST", { feature: "expressions", name: "Old faces", members: [old.id] }));
      await page.send("Page.reload"); await openPanel(page);
      await page.evaluate(`[...document.querySelectorAll('.expr-sets ol[aria-label="Your expression sets"] .item-main')].find(b => b.textContent.includes('Moody'))?.click()`);
      await page.wait(500);
      await panelShot(page, `${tag}-03-set.png`);
      // Add… menu, the set's menu, the member's menu, Rename mod popover, delete confirm.
      await click(page, ".expr-sets button", "Add…"); await page.wait(300);
      await panelShot(page, `${tag}-04-add-menu.png`, 60); await closeFloating(page);
      await page.evaluate(`document.querySelector('.expr-sets ol[aria-label="Your expression sets"] .item-row button[aria-label^="More actions"]').click()`); await page.wait(300);
      await panelShot(page, `${tag}-05-set-menu.png`, 60); await closeFloating(page);
      await page.evaluate(`(() => { const row = document.querySelector('.expr-sets ol[aria-label^="Expressions in this set"] .item-row'); const r = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 10 })); return true; })()`); await page.wait(300);
      await panelShot(page, `${tag}-06-member-menu.png`, 60); await closeFloating(page);
      await click(page, ".expr-sets button", "Rename mod"); await page.wait(300);
      await panelShot(page, `${tag}-07-rename-mod-popover.png`, 60); await closeFloating(page);
      // Check: one expression left out (a control the rig lacks), the deleted one reported. The first Check on a route starts reading
      // the game files in the background; Check again until it has them.
      for (let attempt = 0; attempt < 30; attempt++) {
        await click(page, ".expr-sets button", "Check");
        await page.waitFor(`document.querySelector('.expr-sets .result-card') && !document.querySelector('.expr-sets .package-progress:not(.idle)')`, 60000);
        await page.wait(300);
        if (!(await page.evaluate(`document.querySelector('.expr-sets .result-card').innerText.includes('Check again in a moment')`))) break;
        if (attempt === 0) await panelShot(page, `${tag}-08a-check-reading.png`);
        await page.wait(5000);
      }
      await page.evaluate(`document.querySelector('.expr-sets .package-result').scrollIntoView({ block: 'end' })`); await page.wait(300);
      await panelShot(page, `${tag}-08-check.png`);
      // A refused Check: every expression of "Old faces" uses a control the rig lacks.
      await page.evaluate(`[...document.querySelectorAll('.expr-sets ol[aria-label="Your expression sets"] .item-main')].find(b => b.textContent.includes('Old faces')).click()`); await page.wait(400);
      await click(page, ".expr-sets button", "Check"); await page.waitFor(`document.querySelector('.expr-sets .result-card.error')`, 60000); await page.wait(400);
      await page.evaluate(`document.querySelector('.expr-sets .package-result').scrollIntoView({ block: 'end' })`); await page.wait(300);
      await panelShot(page, `${tag}-09-check-refused.png`);
      await page.evaluate(`[...document.querySelectorAll('.expr-sets ol[aria-label="Your expression sets"] .item-main')].find(b => b.textContent.includes('Moody')).click()`); await page.wait(400);
      // Build confirm menu; the Build itself once (dark, wide), about a minute and a half.
      await click(page, ".expr-sets button", "Build mod files"); await page.wait(300);
      await panelShot(page, `${tag}-10-build-confirm.png`, 60);
      if (tag === "dark-wide") {
        await page.evaluate(`[...document.querySelectorAll('[role=menuitem], .menu button')].find(b => b.textContent.includes('Build now')).click()`);
        await page.wait(1500); await panelShot(page, `${tag}-11-building.png`);
        await page.waitFor(`document.querySelector('.expr-sets .result-card')?.textContent.includes('Build result') || document.querySelector('.expr-sets .result-card.error')`, 400000);
        await page.wait(500); await page.evaluate(`document.querySelector('.expr-sets .package-result').scrollIntoView({ block: 'end' })`); await page.wait(300);
        await panelShot(page, `${tag}-12-build.png`);
        report.build = await page.evaluate(`document.querySelector('.expr-sets .result-card').innerText`);
      } else await closeFloating(page);
      // The drawer: Face › More holds "Expression sets…".
      await page.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Expression').click()`); await page.wait(600);
      await page.evaluate(`document.querySelector('.expr-drawer button[aria-label="More face commands"]').click()`); await page.wait(300);
      const menu = await page.evaluate(`(() => { const d = document.querySelector('.expr-drawer').closest('.dock-group'); const r = d.getBoundingClientRect(); return { x: r.left - 60, y: r.top, width: r.width + 120, height: Math.min(innerHeight - r.top, 520) }; })()`);
      await page.screenshot(resolve(out, `${tag}-13-drawer-menu.png`), menu); (report.captures as string[]).push(`${tag}-13-drawer-menu.png`);
      await closeFloating(page);
      // The patterns followed: the Presets list (ItemList) and Mod package (result card).
      for (const [tab, file] of [["Presets", "14-pattern-presets"], ["Mod package", "15-pattern-mod-package"]] as const) {
        await page.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === ${JSON.stringify(tab)})?.click()`); await page.wait(600);
        if (tab === "Mod package") { await click(page, "button", "Check").catch(() => {}); await page.wait(4000); }
        const rect = await page.evaluate(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === ${JSON.stringify(tab)}); const g = t?.closest('.dock-group'); if (!g) return null;
          const r = g.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(innerHeight - r.top, r.height) }; })()`);
        if (rect) { await page.screenshot(resolve(out, `${tag}-${file}.png`), rect); (report.captures as string[]).push(`${tag}-${file}.png`); }
      }
      report[`${tag}-console`] = page.console.filter(entry => entry.type === "exception" || entry.type === "error");
    } finally { await page.close(); }
  }
}

// Side-by-side sheets: each state beside the pattern it follows.
const pairs: [string, string, string][] = [
  ["Sets and members list", "03-set", "14-pattern-presets"],
  ["Check result", "08-check", "15-pattern-mod-package"],
  ["Refused Check", "09-check-refused", "15-pattern-mod-package"],
  ["Build confirm", "10-build-confirm", "15-pattern-mod-package"],
];
const sheet = (tag: string) => `<!doctype html><meta charset=utf-8><title>${tag}</title><style>body{font:13px system-ui;background:#888;margin:12px}section{display:flex;gap:16px;align-items:flex-start;margin-bottom:24px}
figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}img{max-width:760px;border:1px solid #444}</style>` + pairs.map(([title, own, pattern]) =>
  `<h2>${title}</h2><section><figure><figcaption>Expression sets</figcaption><img src="${tag}-${own}.png"></figure><figure><figcaption>Pattern it follows</figcaption><img src="${tag}-${pattern}.png"></figure></section>`).join("");
for (const tag of ["dark-narrow", "dark-wide", "light-narrow", "light-wide"]) writeFileSync(resolve(out, `compare-${tag}.html`), sheet(tag));
const viewer = await launch(`file:///${resolve(out, "compare-dark-wide.html").replaceAll("\\", "/")}`, { width: 1700, height: 1000 });
try {
  for (const tag of ["dark-narrow", "dark-wide", "light-narrow", "light-wide"]) {
    await viewer.send("Page.navigate", { url: `file:///${resolve(out, `compare-${tag}.html`).replaceAll("\\", "/")}` }); await viewer.wait(1200);
    const height = await viewer.evaluate(`document.documentElement.scrollHeight`);
    await viewer.viewport(1700, Math.min(height, 12000)); await viewer.wait(400);
    await viewer.screenshot(resolve(out, `compare-${tag}.png`));
  }
} finally { await viewer.close(); }
writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ captures: (report.captures as string[]).length, build: report.build ? "done" : "none" }));
