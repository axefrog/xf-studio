/**
 * Alpha confusion-free gate: walk every user-reachable control of the desktop
 * build as a community user (no preview files, no Build setup) and record, for
 * each one, whether it is available or which reason it shows. Asset-free: it
 * runs the real loopback host on a disposable data folder.
 *
 * Run `bun run prepare:static` first. Writes JSON, a Markdown table and a screenshot to the
 * ignored evidence folder and fails if any control is disabled without a
 * visible reason, or shows developer jargon to a community user.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { launch } from "../../tools/cdp";
import { createDesktopServer } from "../server";
import { USER_FACING_JARGON } from "../../src/alpha-availability";

type Entry = { surface: string; control: string; available: boolean; reason: string };
const directory = mkdtempSync(resolve(tmpdir(), "xfs-alpha-inventory-"));
// Ignored output: the committed summary lives in the desktop README.
const evidence = resolve(import.meta.dir, "../../evidence/screenshots/alpha-inventory");
mkdirSync(evidence, { recursive: true });
const server = createDesktopServer(resolve(import.meta.dir, "../static"), resolve(directory, "user-data"),
  { version: "0.1.0-alpha.1", channel: "canary", buildHash: "inventory", metadataStatus: "ready" });
let browser: Awaited<ReturnType<typeof launch>> | undefined;
// Words that belong in docs and manifests, not in front of a community user.
const JARGON = USER_FACING_JARGON;
// Build-setup labels inside the Mod package panel's settings section are being
// reworked by the concurrent plate-input removal and game/MO2 auto-detection
// work; they are reported here but do not fail this gate until that lands.
const PENDING = new Set(["Panel: Mod package|Private plate input folder", "Panel: Mod package|Save local setup",
  "Panel: Mod package|Mod source route"]);
try {
  browser = await launch(server.url + "&verify=1", { width: 1600, height: 1000, debugPort: 9451, scheme: "dark" });
  await browser.waitFor("document.querySelector('#desktop-welcome')?.open && document.querySelector('#studio.studio-ready')");
  const entries: Entry[] = [];
  const collect = async (surface: string, script: string) => {
    const found: Entry[] = await browser!.evaluate(`(${script})()`);
    entries.push(...found.map(item => ({ ...item, surface: item.surface || surface })));
  };
  // First-run welcome, then About and Build setup as a community user sees them.
  await collect("First-run welcome", `() => [...document.querySelectorAll('#desktop-welcome button')].map(b =>
    ({ control: b.textContent.trim(), available: !b.disabled, reason: b.title || '' }))`);
  const welcomeText = await browser.evaluate("document.querySelector('#desktop-welcome').textContent");
  await browser.evaluate("document.querySelector('#desktop-welcome-start').click()");
  await browser.waitFor("!document.querySelector('#desktop-welcome').open");
  await collect("Desktop overlay", `() => [...document.body.children].filter(n => n.tagName === 'BUTTON').map(b =>
    ({ control: b.textContent.trim(), available: !b.disabled, reason: b.title || '' }))`);
  await browser.evaluate("document.querySelector('#desktop-about-open').click()");
  await collect("About", `() => [...document.querySelectorAll('#desktop-about button')].filter(b => !b.closest('[hidden]')).map(b =>
    ({ control: b.textContent.trim(), available: !b.disabled, reason: b.title || '' }))`);
  const aboutText = await browser.evaluate("document.querySelector('#desktop-about').textContent");
  await browser.evaluate("document.querySelector('#desktop-about').close()");
  // Command palette: every command with its capability reason.
  await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))");
  await browser.waitFor("document.querySelector('.palette[open]')");
  await collect("Command palette", `() => { let group = ''; const out = [];
    for (const node of document.querySelectorAll('.palette-list > li')) {
      if (node.classList.contains('palette-group')) { group = node.textContent.trim(); continue; }
      out.push({ control: group + ' › ' + node.querySelector('.menu-label').textContent.trim(),
        available: node.getAttribute('aria-disabled') !== 'true', reason: node.querySelector('.menu-reason')?.textContent.trim() ?? '' });
    } return out; }`);
  await browser.evaluate("document.querySelector('.palette').dispatchEvent(new Event('cancel'))");
  // Every panel: activate each dock tab and record its visible controls.
  const tabs: string[] = await browser.evaluate("[...document.querySelectorAll('.dock-tab')].map(t => t.id)");
  for (const id of tabs) {
    await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    await Bun.sleep(150);
    await collect("", `() => {
      const tab = document.getElementById(${JSON.stringify(id)});
      const body = tab.closest('.dock-group, .dock-window')?.querySelector('.dock-body');
      const title = tab.querySelector('.dock-tab-label').textContent.trim();
      const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest('[hidden]');
      const name = el => (el.getAttribute('aria-label') || el.textContent || el.closest('label')?.textContent || el.name || el.type || '').trim().replace(/\\s+/g, ' ').slice(0, 70);
      const reasonOf = el => el.title || el.closest('.control, .toggle, label')?.querySelector('.note, .control-note')?.textContent?.trim() || '';
      return [...(body?.querySelectorAll('button, input, select, textarea, [role=switch]') ?? [])].filter(visible).map(el =>
        ({ surface: 'Panel: ' + title, control: name(el), available: !el.disabled && el.getAttribute('aria-disabled') !== 'true',
          reason: (el.disabled || el.getAttribute('aria-disabled') === 'true') ? reasonOf(el) : '' }));
    }`);
  }
  await collect("Header", `() => [...document.querySelectorAll('.shell-header button, .status-bar button')].map(b =>
    ({ control: (b.getAttribute('aria-label') || b.textContent).trim(), available: !b.disabled, reason: b.disabled ? b.title : '' }))`);
  // Context menus on the UV map, the head pane and list rows.
  for (const [surface, selector] of [["UV map menu", ".viewport-slot"], ["Layer row menu", ".item-row"]] as const) {
    const opened = await browser.evaluate(`(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(n => n.offsetWidth);
      const target = nodes.at(-1); if (!target) return false; const r = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 2 }));
      return !!document.querySelector('.menu'); })()`);
    if (!opened) continue;
    await collect(surface, `() => [...document.querySelectorAll('.menu [role^=menuitem]')].map(item =>
      ({ control: item.querySelector('.menu-label')?.textContent.trim() ?? item.textContent.trim(),
        available: item.getAttribute('aria-disabled') !== 'true', reason: item.querySelector('.menu-reason')?.textContent.trim() ?? '' }))`);
    await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  }
  const unique = [...new Map(entries.map(item => [`${item.surface}|${item.control}|${item.available}|${item.reason}`, item])).values()];
  const silent = unique.filter(item => !item.available && !item.reason);
  const worded = unique.filter(item => JARGON.test(item.reason) || JARGON.test(item.control));
  const pending = worded.filter(item => PENDING.has(`${item.surface}|${item.control}`));
  const jargon = worded.filter(item => !pending.includes(item));
  if (pending.length) console.warn(`Pending wording owned by concurrent Build-setup work: ${pending.map(item => item.control).join("; ")}`);
  const texts = { welcome: welcomeText, about: aboutText };
  const jargonText = Object.entries(texts).filter(([, text]) => JARGON.test(text)).map(([name]) => name);
  const table = ["| Surface | Control | Community alpha state |", "|---|---|---|",
    ...unique.map(item => `| ${item.surface} | ${item.control.replaceAll("|", "\\|")} | ${item.available ? "Available" : `Unavailable: ${item.reason.replaceAll("|", "\\|")}`} |`)].join("\n");
  writeFileSync(resolve(evidence, "inventory.json"), JSON.stringify({ entries: unique, silent, jargon, pending, jargonText }, null, 2) + "\n");
  writeFileSync(resolve(evidence, "inventory.md"), table + "\n");
  await browser.screenshot(resolve(evidence, "community-uv-only.png"));
  console.log(`${unique.length} controls: ${unique.filter(item => item.available).length} available, ` +
    `${unique.filter(item => !item.available).length} unavailable with a reason, ${silent.length} silent, ${jargon.length + jargonText.length} jargon.`);
  if (silent.length || jargon.length || jargonText.length) {
    console.error(JSON.stringify({ silent, jargon, jargonText }, null, 2));
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  server.stop();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected temporary directory.");
  rmSync(directory, { recursive: true, force: true });
}
