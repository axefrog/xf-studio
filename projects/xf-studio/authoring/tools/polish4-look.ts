/**
 * Coordinator-only visual check. Never run against the person's server or draft.
 * From authoring/: bun tools/polish4-look.ts <output-folder-on-C> [port=4564]
 * Owns a fresh server, data folder and Chrome; captures light/dark at 900/1600 px.
 * Writes review.html with app and guide captures side by side. No game settings or assets are copied.
 * The xfStudioPolish4 status hooks are visual specimens; real lease cancellation is covered by adapter tests.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "./cdp";
import { POLISH4_STATES } from "../src/compose/polish4-verification";

const [output, portText] = process.argv.slice(2), port = Number(portText ?? 4564);
if (!output) throw Error("Usage: bun tools/polish4-look.ts <output-folder-on-C> [port=4564]");
if (!Number.isInteger(port) || port < 1024 || port > 60000 || [port, port + 1000, port + 1001].some(candidate => [4317, 4331].includes(candidate))) throw Error("Choose a dedicated capture port.");
const out = resolve(output), root = resolve(import.meta.dir, "..");
if (process.platform === "win32" && !/^C:[\\/]/i.test(out)) throw Error("Keep capture work on C.");
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "polish4-data-")), origin = `http://127.0.0.1:${port}`;
const server = Bun.spawn([process.execPath, "server.ts"], { cwd: root, windowsHide: true, stdout: "ignore", stderr: "inherit",
  env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: data, XFS_MOD_INSTALL: "off" } });
let app: Session | undefined, guide: Session | undefined;
const rows: { name: string; app: string; guide: string }[] = [];
const errors: unknown[] = [];
const hook = "window.xfStudioPolish4", presentation = "window.xfStudioPresentation";
const click = (page: Session, expression: string) => page.evaluate(`(() => { const e = ${expression}; if (!e) throw Error("Missing capture control"); e.click(); return true; })()`);
async function image(page: Session, name: string, theme: "light" | "dark", width: number, guidePage = false) {
  await page.colorScheme(theme);
  await page.evaluate(guidePage ? `document.querySelector('[data-theme-choice="${theme}"]')?.click()` : `document.documentElement.dataset.theme = "${theme}"; document.documentElement.style.colorScheme = "${theme}"`);
  await page.wait(200);
  const file = `${name}-${theme}-${width}.png`;
  await page.screenshot(join(out, file));
  return file;
}
async function capture(name: string, guideId: string, width: number) {
  await guide!.evaluate(`document.getElementById(${JSON.stringify(guideId)})?.scrollIntoView({block:"start"})`);
  if (name === "reset-wide") {
    await click(guide!, `document.querySelector('#lib-menu button')`);
    await guide!.evaluate(`(() => { const e = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-label')?.textContent === "Reset to default"); if (!e) throw Error("Missing guide Reset submenu"); e.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight",bubbles:true})); })()`);
    await guide!.waitFor(`!!document.querySelector('.menu-wide')`);
  }
  for (const theme of ["light", "dark"] as const) {
    const actual = await image(app!, name, theme, width), pattern = await image(guide!, `guide-${guideId}-${name}`, theme, width, true);
    rows.push({ name: `${name} · ${theme} · ${width}`, app: actual, guide: pattern });
  }
  if (name === "reset-wide") { await guide!.key("Escape"); await guide!.key("Escape"); }
}
try {
  let ready = false;
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw Error("Capture server exited before readiness.");
    try { if ((await fetch(`${origin}/health`)).ok) { ready = true; break; } } catch { /* Starting. */ }
    await Bun.sleep(250);
  }
  if (!ready) throw Error("Capture server did not become ready.");
  app = await launch(`${origin}/?verify=1`, { width: 1600, height: 900, debugPort: port + 1000, scheme: "light" });
  await app.waitFor(`!!${hook} && !!document.querySelector(".layout-tabs")`, 120_000);
  guide = await launch(`${origin}/style-guide.html`, { width: 1600, height: 900, debugPort: port + 1001, scheme: "light" });
  await guide.waitFor(`!!document.getElementById("lib-workspace-notice")`);
  await app.evaluate(`${hook}.defaults(); window.xfStudioAddView("Side view")`);
  await app.waitFor(`${presentation}.tabs.defaults().filter(d => d.name === "Evening lighting and makeup arrangement").length === 3`);
  for (const width of [900, 1600]) {
    await app.viewport(width, 900); await guide.viewport(width, 900);
    for (const state of POLISH4_STATES.filter(state => state !== "normal")) {
      await app.evaluate(`${hook}.state(${JSON.stringify(state)}); ${hook}.workspaceFile(false)`);
      await app.wait(250);
      await capture(state, state === "older" ? "t-read-only-window" : state.startsWith("restore-") ? "t-recovering" : "lib-workspace-notice", width);
    }
    await app.evaluate(`${hook}.state("unprotected"); ${hook}.workspaceFile(true)`); await app.wait(250);
    await capture("unprotected-file", "t-unprotected", width);
    await app.evaluate(`${hook}.state("normal"); window.xfStudioShell.runtime.settings.open("appearance")`); await app.wait(500);
    await capture("settings-file", "c-gamesetup", width);
    await app.evaluate(`${hook}.workspaceFile(false)`); await app.wait(250);
    await capture("settings-browser", "c-gamesetup", width);
    // Named + sole unnamed view in both the pane tabs and the Panels menu.
    await click(app, `[...document.querySelectorAll(".shell-header button")].find(e => e.getAttribute("aria-label") === "Panels")`);
    await capture("unnamed-views", "d-summon", width);
    await app.key("Escape");
    // Same-minute defaults with seconds and the later duplicate without them.
    await click(app, `document.querySelector('.layout-tabs > button')`);
    await capture("default-times", "lib-menu-secondary", width);
    await app.key("Escape");
    const tab = await app.evaluate(`(() => { const e = document.querySelector('.layout-tabs [role="tab"][aria-selected="true"]'); if (!e) throw Error("No tab"); const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2})); return true; })()`);
    if (!tab) throw Error("Tab menu did not open");
    await app.evaluate(`(() => { const e = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-label')?.textContent === "Reset to default"); if (!e) throw Error("No Reset submenu"); e.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight",bubbles:true})); })()`);
    await app.waitFor(`!!document.querySelector('.menu-wide')`);
    await capture("reset-wide", "lib-menu", width);
    await app.key("Escape"); await app.key("Escape");
  }
  errors.push(...app.console.filter(entry => entry.type === "error" || entry.type === "exception"));
} finally {
  await app?.close(); await guide?.close(); server.kill(); await server.exited;
  // Only the fresh folder created above is removed; captures and the review remain.
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  writeFileSync(join(out, "review.html"), `<!doctype html><meta charset="utf-8"><title>Polish 4 review</title><style>body{font:14px system-ui;margin:24px}section{margin-bottom:32px}div{display:flex;gap:16px}figure{margin:0;width:50%}img{width:100%;border:1px solid #888}figcaption{margin:8px 0}</style><h1>Polish 4 · app and guide</h1>${rows.map(row => `<section><h2>${row.name}</h2><div><figure><figcaption>App</figcaption><a href="${row.app}"><img src="${row.app}"></a></figure><figure><figcaption>Guide</figcaption><a href="${row.guide}"><img src="${row.guide}"></a></figure></div></section>`).join("")}`);
  writeFileSync(join(out, "console.json"), JSON.stringify(errors, null, 2));
}
console.log(`${rows.length} app/guide pairs: ${join(out, "review.html")}`);
