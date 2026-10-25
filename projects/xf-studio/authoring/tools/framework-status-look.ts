/**
 * Coordinator-only UI/UX gate captures of Settings › Game › Mod frameworks (and the Mod package card's pointer to it):
 *
 *   bun tools/framework-status-look.ts <output-folder-on-C> [port=4575]
 *
 * In an isolated `?verify=1` workspace on a disposable-data server (`startServer`: its own settings, caches and ports; it never
 * touches the person's server, draft or settings), one headless Chrome page shows each state of the group through the verification
 * hook `window.xfStudioFrameworkStatus.state(name)` (compose/framework-status-verification.ts: the framework check is answered by
 * specimens, so nothing on the computer is read and no game, MO2 or mod list is touched):
 *
 *   all-ok            every framework current (shown folded under "All frameworks up to date", and open)
 *   too-old           ArchiveXL 1.26.3 (the rows, the sentence, Nexus Mods and GitHub links)
 *   missing           redscript not installed
 *   hidden-duplicate  a second, unused ArchiveXL in the Mod Organizer 2 list (a note under its row)
 *   checking          a check held open until released (the line and the button say so; earlier rows stay)
 *   no-game           no game folder chosen: the group is not shown
 *
 * Each is captured in light and dark at viewport widths 900 and 1,600 px (the group, and for too-old and missing the Mod package
 * card's Game section with its one pointer line). Viewports are masked: no game imagery. Needs a game folder in the throwaway
 * settings (they start as a copy of the real ones); if there is none the tool says so. Put the captures beside the style guide's
 * "Framework status" specimen (`style-guide.html#lib-framework-status`) for the side-by-side the review asks for.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, startServer, type Session } from "./cdp";

const [outArg, portArg] = process.argv.slice(2), port = Number(portArg ?? 4575);
if (!outArg) throw Error("Usage: bun tools/framework-status-look.ts <output-folder-on-C> [port=4575]");
if (!Number.isInteger(port) || port < 1024 || port > 60000 || [port, port + 1000].some(value => [4317, 4331].includes(value)))
  throw Error("Choose a dedicated capture port.");
const out = resolve(outArg);
if (process.platform === "win32" && !/^C:[\\/]/i.test(out)) throw Error("Keep capture work on C.");
mkdirSync(out, { recursive: true });

const WIDTHS = [900, 1600] as const, THEMES = ["light", "dark"] as const, HEIGHT = 1000;
/** What each state looks like once it has settled: the group's tone (or that it is hidden). */
const SETTLED: Record<string, string> = {
  "all-ok": `q('.framework-status')?.dataset.tone === 'ready' && !q('.framework-status').hidden`,
  "too-old": `q('.framework-status')?.dataset.tone === 'attention' && !q('.framework-status').hidden`,
  missing: `q('.framework-status')?.dataset.tone === 'attention' && !q('.framework-status').hidden`,
  "hidden-duplicate": `q('.framework-status')?.dataset.tone === 'ready' && !q('.framework-status').hidden`,
  checking: `q('.framework-status')?.dataset.tone === 'checking' && !q('.framework-status').hidden`,
  "no-game": `q('.framework-status')?.hidden === true`,
};
const manifest: { state: string; theme: string; width: number; file: string; card?: string; line: string | null }[] = [];

/** Fold the rows open or shut (the all-fine state is captured both ways). */
const fold = (page: Session, open: boolean) => page.evaluate(`(() => { const b = document.querySelector('.framework-status .expander');
  if (b && !b.hidden && (b.getAttribute('aria-expanded') === 'true') !== ${open}) b.click(); return true; })()`);
/** A screenshot clip of the element a script expression finds, scrolled into view and clamped to the viewport; null when it isn't there or is hidden. */
const clipOf = (page: Session, find: string) => page.evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => {
  const e = ${find}; if (!e || e.hidden) return null;
  e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), x = Math.max(0, r.left - 8), y = Math.max(0, r.top - 8);
  if (!r.width || !r.height) throw Error('Capture target has no layout (reveal its panel in the active dock layout first).');
  return { x, y, width: Math.min(innerWidth, r.right + 8) - x, height: Math.min(innerHeight, r.bottom + 8) - y }; })()`);
const setTheme = async (page: Session, theme: "light" | "dark") => {
  await page.colorScheme(theme);
  await page.evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.colorScheme='${theme}'`);
};

const { server } = await startServer(port);
let page: Session | undefined;
try {
  page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: HEIGHT, debugPort: port + 1000, scheme: "light" });
  await page.evaluate(`window.q = s => document.querySelector(s)`);
  await page.waitFor("!!window.xfStudioShell && !!window.xfStudioFrameworkStatus && !!document.querySelector('.dock-group')", 120_000);
  await page.evaluate(`document.querySelector('button[title="Skip tour"]')?.click()`);
  await page.evaluate(MASK_VIEWPORTS);
  // Settings opens floating, on Game; the Mod package panel is shown too, for its pointer line.
  await page.evaluate(`window.xfStudioShell.runtime.settings.open('game')`);
  await page.waitFor("!!document.querySelector('.settings-panel .setup-game')", 30_000);
  await page.evaluate(`window.xfStudioShell.dock.reveal('package', false)`);
  await page.wait(500);
  const gameRoot = `!!window.xfStudioPresentation.snapshot().localSetup.view?.fields.gameRoot`;
  // On a machine where the game folder is found rather than saved, accept the found folder in this throwaway workspace
  // (the setup card's "Use this folder"); its settings are a disposable copy, so nothing of the person's changes.
  if (!await page.evaluate<boolean>(gameRoot)) {
    await page.evaluate(`document.querySelector('#preview-card-primary:not([hidden]):not([disabled])')?.click()`);
    await page.waitFor(gameRoot, 30_000).catch(() => {});
  }
  if (!await page.evaluate<boolean>(gameRoot)) throw Error("No game folder was found or saved in the throwaway settings: choose one in this verification workspace first (Settings › Game).");
  // Choosing the folder starts a framework check; the state hooks refuse while one runs, so let it finish first.
  await page.waitFor(`!window.xfStudioPresentation.snapshot().installDetection?.busy`, 60_000);

  const states = await page.evaluate<string[]>(`[...window.xfStudioFrameworkStatus.states]`);
  for (const state of states) {
    await page.evaluate(`window.xfStudioFrameworkStatus.state(${JSON.stringify(state)})`);
    await page.waitFor(SETTLED[state] ?? "true", 30_000);
    // The all-fine state is shown folded, then open.
    for (const open of state === "all-ok" ? [false, true] : [state === "hidden-duplicate" || state === "checking"]) {
      await fold(page, open);
      await page.wait(250);
      for (const width of WIDTHS) {
        await page.viewport(width, HEIGHT);
        // DockView keeps separate layouts either side of 1,100 px. Wait for the debounced resize, then reveal Settings in
        // this layout: opening it once at 1,600 px leaves it in .dock-parking (display:none) when we switch to compact.
        await page.wait(250);
        for (const theme of THEMES) {
          await setTheme(page, theme);
          await page.wait(250);
          const tag = `${state}${state === "all-ok" ? (open ? "-open" : "-folded") : ""}-${theme}-${width}`;
          await page.evaluate(`window.xfStudioShell.dock.reveal('settings', false)`);
          await page.waitFor(`!!q('.settings-panel')?.getBoundingClientRect().width`, 30_000);
          if (state === "no-game") await page.evaluate(`window.xfStudioFrameworkStatus.state('no-game')`);
          await fold(page, open);
          await page.wait(100);
          if (!await page.evaluate<boolean>(SETTLED[state] ?? "true")) throw Error(`State changed before capture: ${tag}`);
          const group = await clipOf(page, state === "no-game" ? "document.querySelector('[data-settings-section=game]')" : "document.querySelector('.framework-status')");
          if (!group) throw Error(`No group to capture for ${tag}.`);
          await page.screenshot(resolve(out, `${tag}.png`), group);
          // The Mod package card's Game section, where it points here (the states that need attention).
          if (state === "too-old" || state === "missing") {
            await page.evaluate(`window.xfStudioShell.dock.reveal('package', false)`);
            await page.wait(100);
          }
          const card = state === "too-old" || state === "missing" ? await clipOf(page, "document.querySelector('.package-progress')?.closest('.panel-content')?.querySelector(\"[data-view-key='section:Game']\")") : null;
          if (card) await page.screenshot(resolve(out, `${tag}-package-card.png`), card);
          manifest.push({ state, theme, width, file: `${tag}.png`, ...(card ? { card: `${tag}-package-card.png` } : {}),
            line: await page.evaluate<string | null>(`(() => { const l = document.querySelector('.framework-status:not([hidden]) .framework-line'); return l ? [...l.children].find(c => !c.hidden)?.textContent?.trim() ?? null : null; })()`) });
        }
      }
    }
    if (state === "checking") await page.evaluate(`window.xfStudioFrameworkStatus.release()`);
  }
  // Matching library specimens for the review: both themes, narrow and wide, alongside the composed states in review.html.
  await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/style-guide.html#lib-framework-status` });
  await page.waitFor(`document.querySelectorAll('#lib-framework-status .framework-status').length > 0`, 30_000);
  await page.viewport(1600, HEIGHT);
  // Isolate the live guide specimen at the document origin: CDP screenshot clips use page coordinates, whereas the guide scrolls.
  await page.evaluate(`(() => { const e = document.querySelector('#lib-framework-status .framework-status');
    const host = e.parentElement; document.body.replaceChildren(host); document.body.style.padding = '16px';
    document.body.style.display = 'block'; document.body.style.height = 'auto'; window.scrollTo(0, 0); })()`);
  for (const width of [260, 420]) for (const theme of THEMES) {
    await setTheme(page, theme);
    await page.evaluate(`(() => { const e = document.querySelector('.framework-status');
      e.parentElement.style.width = '${width}px'; e.parentElement.style.maxWidth = '${width}px';
      e.style.colorScheme = '${theme}'; })()`);
    await page.wait(100);
    const clip = await clipOf(page, "document.querySelector('.framework-status')");
    if (!clip) throw Error('No style-guide specimen to capture.');
    await page.screenshot(resolve(out, `guide-${theme}-${width}.png`), clip);
  }
} finally {
  const errors = page?.console.filter(entry => entry.type === "error" || entry.type === "exception") ?? [];
  await page?.close();
  server.kill(); await server.exited;
  writeFileSync(resolve(out, "console.json"), JSON.stringify(errors, null, 2));
  writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(resolve(out, "review.html"), `<!doctype html><meta charset="utf-8"><title>Mod frameworks review</title><style>body{font:14px system-ui;margin:24px}section{margin-bottom:32px}div{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}img{max-width:100%;border:1px solid #888}</style><h1>Settings › Game › Mod frameworks</h1><section><h2>Library reference · narrow and wide</h2><div>${[260, 420].flatMap(width => THEMES.map(theme => `<figure><figcaption>${theme} · ${width}px</figcaption><img src="guide-${theme}-${width}.png"></figure>`)).join("")}</div></section>${manifest.map(row => `<section><h2>${row.state} · ${row.theme} · ${row.width}px</h2><p>${row.line ?? "(group not shown)"}</p><div><figure><figcaption>Group</figcaption><a href="${row.file}"><img src="${row.file}"></a></figure>${row.card ? `<figure><figcaption>Mod package card</figcaption><a href="${row.card}"><img src="${row.card}"></a></figure>` : ""}</div></section>`).join("")}`);
}
