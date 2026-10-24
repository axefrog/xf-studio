/**
 * P2-vi's UI captures for the design review (README §3 row U6, §14 "Verification hooks"): the empty state with choices, in its three
 * routes (Show which V? / Show which look? / Open a 3D view) with 0, 1 and 8 candidates, the searchable Choose… list with 8 candidates
 * (unfiltered, filtered, and a filter with no match), the read-only state (every choice unavailable, with its reason), the panel after
 * choosing (it fills at once), and the first-run check (a fresh workspace with the real game folder opens with the default V on
 * screen, not "Show which V?"). Every state is photographed light and dark at a narrow and a wide window, with the style guide's
 * `c-empty` (the U6 entry) and `lib-status` (the EmptyChoices specimens) at the same schemes and widths.
 *
 * States are reached in an isolated `?verify=1` workspace on a server of its own (a throwaway data folder holding a read-only copy of the
 * host's local settings, so the real 3D head prepares; never the person's library), in a headless Chrome with a throwaway profile, through
 * the real code paths and the verification hook `xfStudioTabFixtures.u6(route, count)` / `u6ReadOnly(true)`, never by changing the app.
 *
 *   bun experiments/044-profile-tabs/capture-p2-6.ts <data-dir> <out-dir> [port=4561] [--only <sections>] [--route subject|look|view] [--no-game]
 *
 * Sections (each gets its own server and Chrome, so none inherits another's state):
 *   routes     the three routes with 0, 1 and 8 candidates
 *   picker     Choose… with 8 candidates: unfiltered, filtered, no match; keyboard path and focus return
 *   readonly   every choice unavailable, with its reason (and the refusal when one is pressed anyway)
 *   choose     after choosing: the panel fills at once (timing in the page, then the settled state)
 *   firstrun   a fresh ?verify=1 workspace with the game folder: the default V on screen, and a record of every card shown while loading
 *   firstrun-plain   the same without ?verify=1 (still a throwaway server data folder and Chrome profile)
 *   guide      the style guide's c-empty and lib-status entries
 * `--no-game` starts from empty settings (no 3D head); the captures are meant to be made with the game's files.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../projects/xf-studio/authoring/tools/cdp";
import { localSettingsDirectory } from "../../projects/xf-studio/authoring/src/setup/host/local-settings-store";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const bare = (name: string) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const only = flag("--only"), routeOnly = flag("--route"), noGame = bare("--no-game");
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun experiments/044-profile-tabs/capture-p2-6.ts <data-dir> <out-dir> [port] [--only <sections>] [--route subject|look|view] [--no-game]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4561);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = resolve(import.meta.dir, "..", "..", "projects", "xf-studio", "authoring");
const origin = `http://127.0.0.1:${port}`;
const NARROW = 900, WIDE = 1600, HEIGHT = 900, SIZES = [WIDE, NARROW];
const P = "window.xfStudioPresentation", S = "window.xfStudioShell", F = "window.xfStudioTabFixtures";

const READY = `!!window.xfStudioShell && !!window.xfStudioPresentation && !!document.querySelector(".layout-tabs") && !!document.querySelector(".history-controls button")`;
const READY_PLAIN = `!!document.querySelector(".layout-tabs") && !!document.querySelector(".history-controls button")`;
type Box = { x: number; y: number; width: number; height: number };
type Shot = { name: string; section: string; size: number; shows: string; guide?: string };
const shots: Shot[] = [], texts: Record<string, unknown> = {}, unreached: { state: string; why: string }[] = [], errors: Record<string, string> = {};
type Route = "subject" | "look" | "view";
const ROUTES = (["subject", "look", "view"] as Route[]).filter(route => !routeOnly || route === routeOnly);
const ROUTE_TITLE: Record<Route, string> = { subject: "Show which V?", look: "Show which look?", view: "Open a 3D view" };

const press = (page: Session, find: string) => page.evaluate(`(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`);
const clip = async (page: Session, selectors: string[], pad = 8) => await page.evaluate(`(() => {
  const rects = ${JSON.stringify(selectors)}.flatMap(s => [...document.querySelectorAll(s)]).filter(e => e && !e.hidden && !e.closest("[hidden]")).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.min(...rects.map(r => r.left)) - ${pad}), y = Math.max(0, Math.min(...rects.map(r => r.top)) - ${pad});
  const right = Math.min(innerWidth, Math.max(...rects.map(r => r.right)) + ${pad}), bottom = Math.min(innerHeight, Math.max(...rects.map(r => r.bottom)) + ${pad});
  return { x: x + scrollX, y: y + scrollY, width: right - x, height: bottom - y };
})()`) as Box;
const scheme = async (page: Session, value: "light" | "dark", guide = false) => {
  await page.colorScheme(value);
  await page.evaluate(guide ? `document.querySelector('[data-theme-choice="${value}"]')?.click()`
    : `(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
  await page.wait(300);
};

/** One look at the page as it is now, light and dark: the clip of `selectors` (or the whole window), named `<state>-<scheme>-<size>`. */
async function capture(page: Session, state: string, selectors: string[], shows: string,
  options: { pad?: number; guide?: boolean; section: string; paired?: string; whole?: boolean } = { section: "misc" }) {
  await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 10_000).catch(() => {});
  const size = await page.evaluate(`innerWidth`) as number;
  for (const value of ["light", "dark"] as const) {
    await scheme(page, value, options.guide);
    const area = options.whole ? { x: 0, y: 0, width: size, height: await page.evaluate(`innerHeight`) as number } : await clip(page, selectors, options.pad);
    if (area.width > 0 && area.height > 0) {
      await page.screenshot(join(out, `${state}-${value}-${size}.png`), area);
      if (value === "light") shots.push({ name: `${state}-{light,dark}-${size}`, section: options.section, size, shows, ...(options.paired ? { guide: options.paired } : {}) });
    } else { texts[`missing-${state}-${size}`] = selectors; unreached.push({ state: `${state} at ${size}`, why: `nothing matched ${selectors.join(", ")}` }); }
  }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
  await scheme(page, "light", options.guide);
}
/** The card clip and the whole window, each light and dark. */
async function captureBoth(page: Session, state: string, shows: string, section: string, extra: string[] = []) {
  await capture(page, state, [".empty-choices[data-u6cap]", ...extra], shows, { section, pad: 14, paired: "c-empty" });
  await capture(page, `${state}-window`, [], `${shows} (the whole window)`, { section, whole: true, paired: "c-empty" });
}

const act = (page: Session, action: Record<string, unknown>) => page.evaluate(`(() => { try { const r = ${P}.authoring.dispatch(${JSON.stringify(action)}); return JSON.stringify(r ?? "ok"); } catch (e) { return "refused: " + (e?.message ?? e); } })()`) as Promise<string>;
const headReady = `${P}.viewport.snapshot().head.phase === "ready"`;
const cardVisible = `(() => [...document.querySelectorAll(".empty-choices")].some(e => !e.hidden && e.getClientRects().length))()`;
/** Every visible U6 card: title, line, buttons (visible label, accessible name, availability, tooltip) and the reason line. */
const cards = (page: Session) => page.evaluate(`[...document.querySelectorAll(".empty-choices")].filter(e => !e.hidden && e.getClientRects().length).map(e => ({
  title: e.querySelector(".empty-title")?.textContent, body: e.querySelector(".empty-body")?.textContent,
  reason: [...e.querySelectorAll('[role="status"]')].filter(r => !r.hidden).map(r => r.textContent),
  buttons: [...e.querySelectorAll(".empty-actions button")].map(b => ({ label: b.textContent.trim(), name: b.getAttribute("aria-label"),
    unavailable: b.getAttribute("aria-disabled") === "true" || b.disabled, title: b.title || null })),
  box: (r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }))(e.getBoundingClientRect()) }))`) as Promise<{ title: string; body: string; reason: string[];
  buttons: { label: string; name: string; unavailable: boolean; title: string | null }[]; box: Box }[]>;
/** The presentation port's own view of one panel's choices (names and availability, not the captured actions). */
const portChoices = (page: Session, panel: string) => page.evaluate(`(() => { const s = ${P}.emptyChoices?.snapshot(${JSON.stringify(panel)}); return s ? JSON.stringify({ title: s.title, body: s.body, capability: s.capability ?? null,
  choices: s.choices.map(c => ({ id: c.id, label: c.label, name: c.name, capability: c.capability ?? null })) }) : "null"; })()`).then(v => JSON.parse(v as string));

const studio = async (page: Session, ready = READY) => {
  await page.waitFor(ready, 120_000); await page.wait(1_500);
  await press(page, `[...document.querySelectorAll("#preview-card .setup-card-actions button")].find(b => b.textContent.trim() === "Not now" && !b.closest("[hidden]") && b.getAttribute("aria-disabled") !== "true" && !b.disabled)`);
  await page.wait(300);
};
/** The 3D head prepared from the game's files in this throwaway workspace (about a minute the first time), then a short settle. */
async function head(page: Session, timeout = 240_000) {
  if (noGame) return;
  await page.waitFor(headReady, timeout).catch(() => { unreached.push({ state: "ready head", why: `the head was not ready ${timeout / 1000} s after it was waited for` }); });
  await page.wait(900);
}
/** The window width. A size class this workspace hasn't been in opens with the shown tab's own arrangement for it. */
async function view(page: Session, size: number, wait = 600) {
  await page.viewport(size, HEIGHT); await page.wait(wait + 400);
}
async function server() {
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  // A read-only copy of the host's local settings (the game's folder), so the throwaway workspace can prepare the real head; nothing flows back.
  const real = join(localSettingsDirectory(), "settings.json");
  if (!noGame && existsSync(real)) copyFileSync(real, join(data, "settings.json"));
  const proc = Bun.spawn([process.execPath, "server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off" } });
  console.log(`server pid ${proc.pid}`);
  for (let i = 0; i < 480; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ } await Bun.sleep(250); }
  return proc;
}
let debugOffset = 0;
/** A fresh server and Chrome for one section: `fn` gets the page; whatever it throws is recorded, and both are always stopped. */
async function session(name: string, fn: (page: Session) => Promise<void>,
  options: { size?: number; path?: string; init?: string; raw?: boolean } = {}) {
  const proc = await server();
  const debugPort = port + 5000 + (debugOffset++);
  try {
    const page = await launch(`${origin}/${options.path ?? "?verify=1"}`, { width: options.size ?? WIDE, height: HEIGHT, scheme: "light", debugPort, ...(options.init ? { init: options.init } : {}) });
    try {
      if (!options.raw) await studio(page);
      await fn(page);
      texts[`console-${name}`] = page.console.filter(entry => entry.type === "error" || entry.type === "exception").slice(0, 20);
    } finally { await page.close(); }
  } catch (error) { errors[name] = String((error as Error)?.stack ?? error).slice(0, 2000); console.log(`FAILED ${name}: ${errors[name]}`); }
  finally { proc.kill(); await proc.exited; }
}

type Fixture = { tab: string; view?: string; scene?: string; panel: string; subjects: string[]; collection?: string; looks: string[] };
/**
 * Open a route with `count` candidates through the verification hook, then make sure the card is on screen (revealing its panel if the
 * size class's arrangement keeps it behind another tab, which is recorded).
 */
async function fixture(page: Session, route: Route, count: number, key: string): Promise<Fixture> {
  // Close the earlier fixtures' tabs (all but the first), so heads and scenes from finished states don't pile up in memory.
  const held = await page.evaluate(`${P}.tabs.snapshot().tabs.map(t => t.id)`) as string[];
  for (const tab of held.slice(1)) await act(page, { kind: "tabs.close", tab });
  await page.wait(300);
  const result = JSON.parse(await page.evaluate(`${F}.u6(${JSON.stringify(route)}, ${count}).then(c => JSON.stringify(c))`) as string) as Fixture;
  await page.wait(700);
  if (!await page.evaluate(cardVisible)) {
    await page.evaluate(`(() => { try { ${S}.dock.reveal(${JSON.stringify(result.panel)}); } catch {} })()`); await page.wait(600);
    texts[`${key}-revealed`] = result.panel;
  }
  await page.waitFor(cardVisible, 8_000).catch(() => { unreached.push({ state: key, why: `no U6 card was visible after the ${route} fixture with ${count}` }); });
  // Several panels can show a card at once (a scene without a V has no look either): mark the one this route is about, for the clips.
  await page.evaluate(`(() => { document.querySelectorAll("[data-u6cap]").forEach(e => e.removeAttribute("data-u6cap"));
    const card = [...document.querySelectorAll(".empty-choices")].find(e => !e.hidden && e.getClientRects().length && e.querySelector(".empty-title")?.textContent === ${JSON.stringify(ROUTE_TITLE[route])});
    card?.setAttribute("data-u6cap", ""); })()`);
  // The look route draws a V beside the empty Layers panel: let its head finish, so the shot shows what a person would see.
  if (route === "look" && count > 0) await head(page, 40_000);
  return result;
}
const facts = async (page: Session, key: string, fx: Fixture) => { texts[key] = { cards: await cards(page), port: await portChoices(page, fx.panel), panel: fx.panel }; };

// ---------------------------------------------------------------------------------------------------------------------
// The three routes, 0, 1 and 8 candidates

async function routes(page: Session, which: Route) {
  await head(page);
  for (const size of SIZES) {
    await view(page, size);
    for (const route of [which]) for (const count of [0, 1, 8]) {
      const key = `routes-${route}-${count}-${size}`, fx = await fixture(page, route, count, key);
      await facts(page, key, fx);
      await captureBoth(page, `routes-${route}-${count}`, `U6 "${ROUTE_TITLE[route]}" with ${count} profile ${route === "look" ? "looks" : "Vs"} at ${size}px: ${count === 0 ? "none, so the plain line and the one action that makes one" : count === 1 ? "one candidate" : "eight candidates, six shown then Choose…"}`, "routes");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Choose…

async function picker(page: Session, which: Route) {
  await head(page);
  const pickerOpen = `!!document.querySelector(".empty-choice-picker")`;
  const listFacts = (page2: Session) => page2.evaluate(`(() => { const p = document.querySelector(".empty-choice-picker"); if (!p) return null; const r = p.getBoundingClientRect();
    return { title: p.querySelector(".popover-title")?.textContent, search: p.querySelector("input")?.value ?? null, focused: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
      items: [...p.querySelectorAll(".empty-choices-list button")].map(b => b.textContent.trim()), noMatches: p.querySelector(".empty-choices-list")?.textContent.trim().slice(0, 80) ?? null,
      box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, window: { width: innerWidth, height: innerHeight }, insideWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })()`);
  for (const size of SIZES) {
    await view(page, size);
    for (const route of [which]) {
      const key = `picker-${route}-${size}`, fx = await fixture(page, route, 8, key);
      await facts(page, `${key}-card`, fx);
      const opened = await press(page, `[...document.querySelectorAll(".empty-choices[data-u6cap] .empty-actions button")].find(b => b.textContent.trim() === "Choose…" && b.getClientRects().length)`);
      await page.wait(400);
      if (!opened || !await page.evaluate(pickerOpen)) { unreached.push({ state: key, why: "Choose… was not on the card or did not open the list" }); continue; }
      texts[`${key}-unfiltered`] = await listFacts(page);
      await capture(page, `picker-${route}-unfiltered`, [".empty-choices[data-u6cap]", ".empty-choice-picker"], `U6 Choose… list for ${ROUTE_TITLE[route]} with 8 candidates, unfiltered, at ${size}px`, { section: "picker", pad: 14, paired: "c-empty" });
      await capture(page, `picker-${route}-unfiltered-window`, [], `U6 Choose… list for ${ROUTE_TITLE[route]}, unfiltered, in the whole ${size}px window`, { section: "picker", whole: true, paired: "c-empty" });
      await page.type("5"); await page.wait(400);
      texts[`${key}-filtered`] = await listFacts(page);
      await capture(page, `picker-${route}-filtered`, [".empty-choices[data-u6cap]", ".empty-choice-picker"], `U6 Choose… list for ${ROUTE_TITLE[route]} filtered by "5", at ${size}px`, { section: "picker", pad: 14, paired: "c-empty" });
      await capture(page, `picker-${route}-filtered-window`, [], `U6 Choose… list for ${ROUTE_TITLE[route]} filtered by "5", in the whole ${size}px window`, { section: "picker", whole: true, paired: "c-empty" });
      // Keyboard: Down from the search enters the results, Escape closes the list and returns focus to Choose….
      await page.key("ArrowDown"); await page.wait(200);
      texts[`${key}-after-arrow-down`] = await page.evaluate(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName`);
      if (route === "look") {
        // Back to the search field, then a filter that matches nothing (set directly: this key helper has no Backspace).
        await page.evaluate(`(() => { const i = document.querySelector(".empty-choice-picker input"); i.focus(); i.value = "zzz"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await page.wait(400);
        texts[`${key}-no-match`] = await listFacts(page);
        await capture(page, `picker-${route}-no-match`, [".empty-choices[data-u6cap]", ".empty-choice-picker"], `U6 Choose… list for ${ROUTE_TITLE[route]} with a filter that matches nothing ("zzz"), at ${size}px`, { section: "picker", pad: 14, paired: "c-empty" });
      }
      await page.key("Escape"); await page.wait(300);
      // Escape in the search field with text clears it first; a second Escape closes (the first result of this is recorded as "after-escape").
      const afterFirst = { open: await page.evaluate(pickerOpen), searchLeft: await page.evaluate(`document.querySelector(".empty-choice-picker input")?.value ?? null`) };
      if (afterFirst.open) { await page.key("Escape"); await page.wait(300); texts[`${key}-after-first-escape`] = afterFirst; }
      texts[`${key}-after-escape`] = { open: await page.evaluate(pickerOpen), focus: await page.evaluate(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName`) };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Read-only

async function readonly(page: Session, which: Route) {
  await head(page);
  for (const size of SIZES) {
    await view(page, size);
    for (const route of [which]) {
      const key = `readonly-${route}-${size}`, fx = await fixture(page, route, 8, key);
      await page.evaluate(`${F}.u6ReadOnly(true)`); await page.wait(700);
      await facts(page, key, fx);
      await captureBoth(page, `readonly-${route}`, `U6 read-only "${ROUTE_TITLE[route]}" with 8 candidates at ${size}px: every choice unavailable, with its reason`, "readonly");
      // Pressing anyway does nothing, and the presentation port refuses the captured action too.
      const pressed = await press(page, `[...document.querySelectorAll(".empty-choices[data-u6cap] .empty-actions button")].find(b => b.getClientRects().length)`);
      await page.wait(300);
      const refusal = await page.evaluate(`(async () => { const s = ${P}.emptyChoices.snapshot(${JSON.stringify(fx.panel)}); if (!s?.choices.length) return "no choices";
        try { return JSON.stringify(await ${P}.emptyChoices.execute(s.choices[0].action)); } catch (e) { return "threw: " + (e?.message ?? e); } })()`);
      texts[`${key}-pressed-anyway`] = { pressed, cardStillVisible: await page.evaluate(cardVisible), pickerOpen: await page.evaluate(`!!document.querySelector(".empty-choice-picker")`), executeResult: refusal };
      await page.evaluate(`${F}.u6ReadOnly(false)`); await page.wait(400);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// After choosing

async function choose(page: Session, which: Route) {
  await head(page);
  const cases: { id: string; route: Route; count: number; what: string }[] = [
    { id: "subject-default", route: "subject", count: 0, what: 'no profile Vs: the first choice (a game default V) in "Show which V?"' },
    { id: "subject", route: "subject", count: 8, what: 'the first of eight profile Vs in "Show which V?"' },
    { id: "look", route: "look", count: 8, what: 'the first of eight looks in "Show which look?"' },
    { id: "view", route: "view", count: 8, what: 'the first of eight Vs in "Open a 3D view"' },
  ];
  for (const size of SIZES) {
    await view(page, size);
    for (const item of cases.filter(c => c.route === which)) {
      const key = `choose-${item.id}-${size}`, fx = await fixture(page, item.route, item.count, key);
      await facts(page, `${key}-before`, fx);
      await capture(page, `choose-${item.id}-before`, [".empty-choices[data-u6cap]"], `Before choosing (${item.what}) at ${size}px`, { section: "choose", pad: 14, paired: "c-empty" });
      // Press the first visible, available choice; count the frames until the card is gone, and check the document the same task.
      texts[`${key}-timing`] = await page.evaluate(`(async () => {
        const visible = () => [...document.querySelectorAll(".empty-choices[data-u6cap]")].some(e => !e.hidden && e.getClientRects().length);
        const b = [...document.querySelectorAll(".empty-choices[data-u6cap] .empty-actions button")].find(x => x.getClientRects().length && x.getAttribute("aria-disabled") !== "true" && !x.disabled);
        if (!b) return { pressed: false };
        const label = b.getAttribute("aria-label"), t0 = performance.now(); b.click(); const goneSameTask = !visible();
        let frames = 0; while (visible() && frames < 180) { await new Promise(r => requestAnimationFrame(r)); frames++; }
        return { pressed: true, choice: label, goneSameTask, framesUntilGone: frames, msUntilGone: Math.round(performance.now() - t0), stillVisible: visible() };
      })()`);
      await page.wait(150);
      texts[`${key}-after`] = { cards: await cards(page), tabs: await page.evaluate(`${P}.tabs.snapshot().tabs.map(t => t.name)`), viewTitles: await page.evaluate(`${P}.views.titles().map(t => t.panel + " = " + t.title)`),
        headPhase: await page.evaluate(`${P}.viewport.snapshot().head.phase`) };
      await capture(page, `choose-${item.id}-after`, [], `After choosing (${item.what}) at ${size}px, a moment after the press: the panel has filled`, { section: "choose", whole: true, paired: "c-empty" });
      if (item.route === "subject") {
        await head(page, 90_000);
        texts[`${key}-settled`] = { headPhase: await page.evaluate(`${P}.viewport.snapshot().head.phase`), cardVisible: await page.evaluate(cardVisible) };
        await capture(page, `choose-${item.id}-settled`, [], `After choosing (${item.what}) at ${size}px once its head has drawn`, { section: "choose", whole: true, paired: "c-empty" });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// First run

/** Records every set of visible U6 cards from the first frame on, so a card that flashes while loading is still found. */
const OBSERVER = `(() => { const log = []; window.__u6log = log; const t0 = performance.now(); let last = "";
  const seen = () => [...document.querySelectorAll(".empty-choices")].filter(e => !e.hidden && e.getClientRects().length).map(e => e.querySelector(".empty-title")?.textContent ?? "");
  const check = () => { const now = JSON.stringify(seen()); if (now !== last) { last = now; log.push({ t: Math.round(performance.now() - t0), cards: seen() }); } };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener("DOMContentLoaded", check); })()`;

async function firstRun(page: Session, verify: boolean) {
  const key = verify ? "firstrun" : "firstrun-plain";
  await page.waitFor(verify ? READY : READY_PLAIN, 180_000);
  const now = (when: string) => page.evaluate(`({ when: ${JSON.stringify(when)}, atMs: Math.round(performance.now()),
    cards: [...document.querySelectorAll(".empty-choices")].filter(e => !e.hidden && e.getClientRects().length).map(e => e.querySelector(".empty-title")?.textContent),
    showWhichVOnScreen: /Show which V\\?/.test(document.body.innerText), openA3DViewOnScreen: /Open a 3D view/.test(document.body.innerText),
    canvases: [...document.querySelectorAll("canvas")].filter(c => c.getClientRects().length).map(c => c.width + "x" + c.height),
    setupCard: [...document.querySelectorAll("#preview-card .setup-card-actions button")].filter(b => b.getClientRects().length).map(b => b.textContent.trim()),
    tabs: [...document.querySelectorAll(".layout-tabs .dock-tab, .layout-tabs [role=tab]")].map(t => t.textContent.trim().replace(/\\s+/g, " ")),
    ${verify ? `head: ${P}.viewport.snapshot().head.phase, viewTitles: ${P}.views.titles().map(t => t.panel + " = " + t.title),` : ""}
    status: document.querySelector(".status-bar")?.innerText.replace(/\\s+/g, " ").trim() })`);
  texts[`${key}-at-ready`] = await now("shell ready (before any button is pressed)");
  await capture(page, `${key}-initial`, [], `First run${verify ? "" : " without ?verify=1"}: the window the moment the shell is ready, before anything is pressed (${WIDE}px)`, { section: key, whole: true, paired: "c-empty" });
  if (!noGame) await page.waitFor(verify ? headReady : `[...document.querySelectorAll("canvas")].some(c => c.getClientRects().length && c.width > 400 && c.height > 400)`, 240_000)
    .catch(() => { unreached.push({ state: `${key} ready head`, why: "no head was drawn within 240 s" }); });
  await page.wait(2_000);
  texts[`${key}-head-ready`] = await now("the head is ready");
  for (const size of SIZES) {
    await view(page, size, 900);
    texts[`${key}-ready-${size}`] = await now(`ready at ${size}px`);
    await capture(page, `${key}-ready`, [], `First run${verify ? "" : " without ?verify=1"}: the window once the head is ready, ${size}px wide: the default V on screen`, { section: key, whole: true, paired: "c-empty" });
  }
  texts[`${key}-card-log`] = await page.evaluate(`window.__u6log`);
  if (verify) {
    const panels = await page.evaluate(`${P}.views.titles().map(t => t.panel)`) as string[];
    texts[`${key}-port-choices`] = await Promise.all(panels.map(async panel => ({ panel, choices: await portChoices(page, panel) })));
    texts[`${key}-subject`] = await page.evaluate(`JSON.stringify({ tabs: ${P}.tabs.snapshot() })`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The style guide's matching entries

async function guide(page: Session) {
  await page.send("Page.navigate", { url: `${origin}/style-guide.html` });
  await page.waitFor(`!!document.getElementById("c-empty") && !!document.getElementById("lib-status")`, 60_000);
  await page.waitFor(`!document.querySelector(".live-specimen[data-live] > p.note")`, 60_000).catch(() => { unreached.push({ state: "guide specimens", why: "some live specimens never replaced their placeholder" }); });
  await page.wait(800);
  const ids = [["c-empty", "Empty states (c-empty), with U6: the empty state with choices"], ["lib-status", "Status components (lib-status), with the live EmptyChoices specimens: zero, one, several, overflow and read-only"]] as const;
  texts["guide-state"] = await page.evaluate(`({ title: document.title, liveSpecimens: document.querySelectorAll(".live-specimen[data-live]").length, placeholdersLeft: document.querySelectorAll(".live-specimen[data-live] > p.note").length,
    entries: ${JSON.stringify(ids.map(([id]) => id))}.map(id => { const e = document.getElementById(id); return { id, present: !!e, heading: e?.querySelector("h2, h3")?.textContent.trim() ?? null, mentionsU6: /U6/.test(e?.innerText ?? ""), emptyChoiceSpecimens: e?.querySelectorAll(".empty-choices").length ?? 0 }; }) })`);
  for (const size of SIZES) {
    for (const [id, title] of ids) {
      if (!await page.evaluate(`!!document.getElementById(${JSON.stringify(id)})`)) { unreached.push({ state: `guide ${id}`, why: "the style guide has no element with this id" }); continue; }
      // A window tall enough for the whole entry, so a long entry isn't cut off.
      await page.viewport(size, 1200); await page.wait(500);
      const height = await page.evaluate(`Math.ceil(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().height)`) as number;
      await page.viewport(size, Math.min(6000, Math.max(900, height + 260))); await page.wait(600);
      for (const value of ["light", "dark"] as const) {
        await scheme(page, value, true);
        const rect = await page.evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); scrollTo(0, 0); scrollBy(0, el.getBoundingClientRect().top - 90); const r = el.getBoundingClientRect();
          return { x: Math.round(Math.max(0, r.left + scrollX - 4)), y: Math.round(Math.max(0, r.top + scrollY - 4)), width: Math.round(Math.min(r.width + 8, innerWidth)), height: Math.round(Math.min(r.height + 8, innerHeight)) }; })()`) as Box;
        await page.wait(250);
        await page.screenshot(join(out, `guide-${id}-${value}-${size}.png`), rect);
        if (value === "light") shots.push({ name: `guide-${id}-{light,dark}-${size}`, section: "guide", size, shows: `Style guide: ${title}` });
      }
      await scheme(page, "light", true);
    }
  }
}

if (want("routes")) for (const route of ROUTES) await session(`routes-${route}`, page => routes(page, route));
if (want("picker")) for (const route of ROUTES) await session(`picker-${route}`, page => picker(page, route));
if (want("readonly")) for (const route of ROUTES) await session(`readonly-${route}`, page => readonly(page, route));
if (want("choose")) for (const route of ROUTES) await session(`choose-${route}`, page => choose(page, route));
if (want("firstrun")) await session("firstrun", page => firstRun(page, true), { raw: true, init: OBSERVER });
if (want("firstrun-plain")) await session("firstrun-plain", page => firstRun(page, false), { raw: true, init: OBSERVER, path: "" });
if (want("guide")) await session("guide", guide, { raw: true, path: "style-guide.html" });

/** Each run writes its own pair of files (named by its sections), so sections can be captured in separate runs and merged afterwards. */
const tag = (only ?? "all").replaceAll(",", "+") + (routeOnly ? `-${routeOnly}` : "");
writeFileSync(join(out, `run-${tag}.json`), JSON.stringify({ date: new Date().toISOString(), port, texts, unreached, errors }, null, 2));
writeFileSync(join(out, `shots-${tag}.json`), JSON.stringify(shots, null, 2));
console.log(`Wrote ${shots.length} capture sets (${tag}) to ${out}${Object.keys(errors).length ? `
ERRORS in: ${Object.keys(errors).join(", ")}` : ""}`);
