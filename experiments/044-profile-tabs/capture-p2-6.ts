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
 *   bun experiments/044-profile-tabs/capture-p2-6.ts <data-dir> <out-dir> [port=4561] [--only <sections>] [--route subject|look|view] [--count n] [--reuse] [--no-game]
 *
 * Sections (each gets its own server and Chrome, so none inherits another's state):
 *   routes     the three routes with 0, 1 and 8 candidates
 *   picker     Choose… with 8 candidates: unfiltered, filtered, no match; keyboard path and focus return
 *   readonly   every choice unavailable, with its reason (and the refusal when one is pressed anyway)
 *   choose     after choosing: the panel fills at once (timing in the page, then the settled state)
 *   firstrun   a fresh ?verify=1 workspace with the game folder: the default V on screen, and a record of every card shown while loading
 *   firstrun-plain   the same without ?verify=1 (still a throwaway server data folder and Chrome profile)
 *   guide      the style guide's c-empty and lib-status entries
 * Recapture sections for the design fixes and review fixes (commit 3dde8d88), each its own server and Chrome (some take `--count n`):
 *   lookless   a look-less scene (0/1/8 looks): only Presets offers looks; the other panels show the quiet pointer line
 *   link       pressing the pointer's Presets link with Presets closed, collapsed and in a read-only window
 *   headpane   the 3D view's Show which V? in the centred head-pane layout (0/1/8 Vs; overflow Choose…; read-only)
 *   openview   Open a 3D view: the new view shown, drawn and focused in the tab's 3D slot
 *   chain      choose a V for a look-less scene; the look question then appears in Presets alone
 *   recovery   the empty collection: toast, after the toast, after a restart, a conflict waiting, Keep mine's confirmation, Restore
 *   defaulttab a tab made from the Eye makeup default, before its view is clicked (first-run workspace and a many-candidate profile)
 *   starter    Create a look's starting layer (an existing empty collection; a profile with no collection)
 *   vless      an explicitly V-less 3D view after a restart (no V made for it), then choosing one
 * `--no-game` starts from empty settings (no 3D head); the captures are meant to be made with the game's files.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../projects/xf-studio/authoring/tools/cdp";
import { localSettingsDirectory } from "../../projects/xf-studio/authoring/src/setup/host/local-settings-store";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const bare = (name: string) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const only = flag("--only"), routeOnly = flag("--route"), countOnly = flag("--count"), noGame = bare("--no-game"), reuse = bare("--reuse");
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun experiments/044-profile-tabs/capture-p2-6.ts <data-dir> <out-dir> [port] [--only <sections>] [--route subject|look|view] [--count n] [--reuse] [--no-game]");
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
  // `--reuse`: a developer's aid while writing a section, using the server already running on this port (and its data) instead of a fresh one.
  if (reuse) return { kill() {}, exited: Promise.resolve(0), pid: 0 } as unknown as ReturnType<typeof Bun.spawn>;
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
    // The look chooser lives in Presets alone (the other panels point to it); the other cards are in the panel the fixture names.
    const owner = route === "look" ? "presets" : result.panel;
    await page.evaluate(`(() => { try { ${S}.dock.reveal(${JSON.stringify(owner)}, false); } catch {} })()`); await page.wait(600);
    texts[`${key}-revealed`] = owner;
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

// ---------------------------------------------------------------------------------------------------------------------
// Recapture after the design fixes (U6 review, 24 October 2026) and the review fixes it left to recapture

/** Marks the dock groups holding these panels (those on screen) so `.dock-group[data-u6grp]` clips them; answers the panels found. */
const markGroups = (page: Session, ids: string[]) => page.evaluate(`(() => {
  document.querySelectorAll("[data-u6grp]").forEach(e => e.removeAttribute("data-u6grp"));
  return ${JSON.stringify(ids)}.filter(id => { const g = ${S}.dock.panel(id)?.element?.closest(".dock-group"); if (!g || !g.getClientRects().length) return false; g.setAttribute("data-u6grp", ""); return true; });
})()`) as Promise<string[]>;
const GROUP = [".dock-group[data-u6grp]"];
const reveal = async (page: Session, id: string, wait = 450) => { await page.evaluate(`(() => { try { ${S}.dock.reveal(${JSON.stringify(id)}, false); } catch {} })()`); await page.wait(wait); };
/** One panel's group, light and dark (revealed first, so a panel behind another tab at this width is shown). */
async function panelShot(page: Session, state: string, id: string, shows: string, section: string, pad = 6) {
  await reveal(page, id);
  if (!(await markGroups(page, [id])).length) { unreached.push({ state, why: `panel ${id} was not on screen` }); return; }
  await capture(page, state, GROUP, shows, { section, pad });
}
/** What each panel shows about a missing target: its choosers (title, buttons) and its quiet pointer lines, as the DOM has them. */
const panelFacts = (page: Session, ids: string[]) => page.evaluate(`JSON.stringify(${JSON.stringify(ids)}.map(id => {
  const el = ${S}.dock.panel(id)?.element, shown = (e) => !!e && e.getClientRects().length > 0 && !e.closest("[hidden]");
  return { id, state: ${S}.dock.panelState(id), visible: ${S}.dock.isVisible(id), collapsed: ${S}.dock.isCollapsed(id),
    choosers: [...(el?.querySelectorAll(".empty-choices") ?? [])].filter(shown).map(e => ({ title: e.querySelector(".empty-title")?.textContent, body: e.querySelector(".empty-body")?.textContent,
      buttons: [...e.querySelectorAll(".empty-actions button")].map(b => b.getAttribute("aria-label") ?? b.textContent.trim()) })),
    pointers: [...(el?.querySelectorAll(".empty-target-pointer") ?? [])].filter(shown).map(e => ({ text: e.textContent, link: e.querySelector("button")?.getAttribute("aria-label") ?? null })),
    ownContent: [...(el?.querySelectorAll(".panel-content > *") ?? [])].filter(e => shown(e) && !e.classList.contains("panel-empty-target")).length };
}))`).then(v => JSON.parse(v as string)) as Promise<{ id: string }[]>;
const focusFacts = (page: Session) => page.evaluate(`(() => { const a = document.activeElement; const g = a?.closest?.(".dock-group");
  return { tag: a?.tagName ?? null, label: a?.getAttribute?.("aria-label") ?? a?.textContent?.trim().slice(0, 40) ?? null, group: g?.dataset.group ?? null,
    groupTabs: g ? [...g.querySelectorAll("[role=tab]")].map(t => t.textContent.trim()) : null,
    inPresets: !!${S}.dock.panel("presets")?.element?.contains(a) }; })()`) as Promise<Record<string, unknown>>;
/** Press the first available button of the card this route is about (a real click on the real control), optionally one whose name contains `label`. */
const pressChoice = (page: Session, label?: string) => page.evaluate(`(() => { const want = ${JSON.stringify(label ?? "")}; const b = [...document.querySelectorAll(".empty-choices[data-u6cap] .empty-actions button")]
  .find(x => x.getClientRects().length && x.getAttribute("aria-disabled") !== "true" && !x.disabled && (!want || (x.getAttribute("aria-label") ?? x.textContent.trim()).includes(want)));
  if (!b) return null; const name = b.getAttribute("aria-label") ?? b.textContent.trim(); b.click(); return name; })()`) as Promise<string | null>;
/** A pointer press (move, press, release) at the middle of the element `find` answers; its label, or null when there is none. */
const realClick = async (page: Session, find: string) => {
  const hit = await page.evaluate(`(() => { const b = ${find}; if (!b) return null; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute("aria-label") ?? b.textContent.trim() }; })()`) as { x: number; y: number; label: string } | null;
  if (!hit) return null;
  await page.mouse("mouseMoved", hit.x, hit.y, { button: "none", buttons: 0 }); await page.mouse("mousePressed", hit.x, hit.y); await page.mouse("mouseReleased", hit.x, hit.y);
  return hit.label;
};
const scrollChooser = (page: Session) => page.evaluate(`document.querySelector(".empty-choices[data-u6cap]")?.scrollIntoView({ block: "nearest" })`);
const scrollTo = (page: Session, id: string, end = false) => page.evaluate(`(() => { const el = ${S}.dock.panel(${JSON.stringify(id)})?.element; for (let n = el; n; n = n.parentElement) n.scrollTop = ${end ? "n.scrollHeight" : "0"}; })()`);

// --- a look-less scene: only Presets offers looks; the others show the quiet pointer ---

async function lookless(page: Session, count: number) {
  await head(page);
  const panels = ["presets", "layers", "uv", "finish"];
  for (const size of SIZES) {
    await view(page, size);
    const key = `lookless-${count}-${size}`, fx = await fixture(page, "look", count, key);
    await page.wait(600);
    texts[key] = { fixture: { tab: fx.tab, scene: fx.scene }, panels: await panelFacts(page, panels), chooserCards: await cards(page) };
    await capture(page, `lookless-${count}-window`, [], `A look-less scene with ${count} profile looks at ${size}px: the whole window (Presets offers the looks, the other panels point to it)`, { section: "lookless", whole: true, paired: "c-empty" });
    for (const id of panels) {
      await reveal(page, id); await scrollTo(page, id);
      if (id === "presets") {
        await panelShot(page, `lookless-${count}-presets-top`, id, `Presets of a look-less scene (${count} looks) at ${size}px as it opens, scrolled to the top`, "lookless");
        await scrollChooser(page); await page.wait(250);
        await panelShot(page, `lookless-${count}-presets-chooser`, id, `Presets of a look-less scene (${count} looks) at ${size}px scrolled to the look chooser`, "lookless");
      } else await panelShot(page, `lookless-${count}-${id}`, id, `${id === "uv" ? "UV map" : id === "finish" ? "Colour & finish" : "Layers"} of a look-less scene (${count} looks) at ${size}px: the quiet pointer line in place of the editor`, "lookless");
    }
    await reveal(page, "layers");
  }
}

/** Pressing the pointer's "Presets" link with Presets closed, collapsed and in a read-only window: it opens, expands and focuses Presets. */
async function pointerLink(page: Session) {
  await head(page);
  for (const size of SIZES) {
    await view(page, size);
    for (const mode of ["closed", "collapsed", "readonly"] as const) {
      const key = `link-${mode}-${size}`;
      await fixture(page, "look", 8, key);
      await page.evaluate(`${F}.u6ReadOnly(${mode === "readonly"})`); await page.wait(500);
      await reveal(page, "presets");
      if (mode === "collapsed") await page.evaluate(`${S}.dock.toggleCollapse("presets")`); else await page.evaluate(`${S}.dock.close("presets")`);
      await page.wait(600);
      texts[`${key}-before`] = { presets: (await panelFacts(page, ["presets"]))[0], focus: await focusFacts(page), readOnly: mode === "readonly" };
      await capture(page, `link-${mode}-before`, [], `Look-less scene at ${size}px, Presets ${mode === "readonly" ? "closed in a read-only window" : mode}: the pointer in another panel is the way back`, { section: "link", whole: true, paired: "c-empty" });
      const link = await page.evaluate(`(() => { const b = [...document.querySelectorAll(".empty-target-pointer button")].find(x => x.getClientRects().length && !x.closest("[hidden]"));
        if (!b) return null; const where = b.closest(".dock-group")?.dataset.group ?? null; b.click(); return where; })()`);
      await page.wait(700);
      texts[`${key}-after`] = { pressedInGroup: link, presets: (await panelFacts(page, ["presets"]))[0], focus: await focusFacts(page), open: await page.evaluate(`${S}.dock.isOpen("presets")`),
        collapsed: await page.evaluate(`${S}.dock.isCollapsed("presets")`) };
      if (link === null) unreached.push({ state: key, why: "no pointer link was on screen to press" });
      await capture(page, `link-${mode}-after`, [], `After pressing the pointer's Presets link (${mode}) at ${size}px: Presets is open, expanded and focused`, { section: "link", whole: true, paired: "c-empty" });
      await page.evaluate(`${F}.u6ReadOnly(false)`); await page.wait(300);
    }
  }
}

// --- the 3D view's "Show which V?" in the centred head-pane layout ---

async function headPane(page: Session, count: number) {
  await head(page);
  for (const size of SIZES) {
    await view(page, size);
    const key = `headpane-${count}-${size}`, fx = await fixture(page, "subject", count, key);
    await page.wait(500);
    const geometry = () => page.evaluate(`(() => { const card = document.querySelector(".empty-choices[data-u6cap]"), pane = card?.closest(".dock-group");
      if (!card || !pane) return null; const c = card.getBoundingClientRect(), p = pane.getBoundingClientRect();
      return { card: [c.x, c.y, c.width, c.height].map(Math.round), pane: [p.x, p.y, p.width, p.height].map(Math.round),
        centreOffset: [Math.round(c.x + c.width / 2 - (p.x + p.width / 2)), Math.round(c.y + c.height / 2 - (p.y + p.height / 2))], classes: card.className, hasIcon: !!card.querySelector("svg") }; })()`);
    texts[key] = { geometry: await geometry(), cards: await cards(page), port: await portChoices(page, fx.panel) };
    await markGroups(page, [fx.panel]);
    await capture(page, `headpane-${count}`, GROUP, `The 3D view's Show which V? with ${count} profile Vs at ${size}px (the head pane)`, { section: "headpane", pad: 6, paired: "c-empty" });
    await capture(page, `headpane-${count}-window`, [], `The 3D view's Show which V? with ${count} profile Vs, the whole ${size}px window`, { section: "headpane", whole: true, paired: "c-empty" });
    if (count === 8) {
      // Overflow: Choose… opens the searchable list from inside the head pane.
      const opened = await press(page, `[...document.querySelectorAll(".empty-choices[data-u6cap] .empty-actions button")].find(b => b.textContent.trim() === "Choose…" && b.getClientRects().length)`);
      await page.wait(400);
      if (!opened || !await page.evaluate(`!!document.querySelector(".empty-choice-picker")`)) unreached.push({ state: key, why: "Choose… did not open its list in the head pane" });
      else {
        texts[`${key}-picker`] = await page.evaluate(`(() => { const p = document.querySelector(".empty-choice-picker"), r = p.getBoundingClientRect(); return { items: [...p.querySelectorAll(".empty-choices-list button")].length, box: [r.x, r.y, r.width, r.height].map(Math.round), insideWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })()`);
        await capture(page, `headpane-${count}-choose`, [...GROUP, ".empty-choice-picker"], `Show which V? with 8 Vs at ${size}px: Choose… open inside the head pane`, { section: "headpane", pad: 10, paired: "c-empty" });
        await page.key("Escape"); await page.wait(300);
      }
      await page.evaluate(`${F}.u6ReadOnly(true)`); await page.wait(700);
      texts[`${key}-readonly`] = { cards: await cards(page), geometry: await geometry() };
      await markGroups(page, [fx.panel]);
      await capture(page, `headpane-${count}-readonly`, GROUP, `Show which V? with 8 Vs at ${size}px in a read-only window: every choice unavailable, with its reason`, { section: "headpane", pad: 6, paired: "c-empty" });
      await page.evaluate(`${F}.u6ReadOnly(false)`); await page.wait(400);
    }
  }
}

// --- Open a 3D view fills the tab's 3D slot, shown, drawn and focused ---

const viewIds = (page: Session) => page.evaluate(`${P}.views.titles().map(t => t.panel)`) as Promise<string[]>;
async function openView(page: Session, count: number) {
  await head(page);
  for (const size of SIZES) {
    await view(page, size);
    const key = `openview-${count}-${size}`, fx = await fixture(page, "view", count, key);
    const before = await viewIds(page);
    texts[`${key}-before`] = { views: before, cards: await cards(page), tab: fx.tab };
    await capture(page, `openview-${count}-before`, [], `Open a 3D view (${count} profile Vs) at ${size}px before choosing: the tab has no 3D view`, { section: "openview", whole: true, paired: "c-empty" });
    const pressed = await pressChoice(page);
    await page.wait(900);
    const after = await viewIds(page), added = after.filter(id => !before.includes(id));
    const where = (id: string) => page.evaluate(`(() => { const el = ${S}.dock.panel(${JSON.stringify(id)})?.element, g = el?.closest(".dock-group");
      return { panel: ${JSON.stringify(id)}, inDom: !!el?.isConnected, visible: ${S}.dock.isVisible(${JSON.stringify(id)}), state: ${S}.dock.panelState(${JSON.stringify(id)}), group: g?.dataset.group ?? null,
        groupTabs: g ? [...g.querySelectorAll("[role=tab]")].map(t => t.textContent.trim() + (t.getAttribute("aria-selected") === "true" ? " (active)" : "")) : null,
        focusInside: !!el?.contains(document.activeElement), activeElement: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? null,
        canvases: [...(el?.querySelectorAll("canvas") ?? [])].map(c => c.width + "x" + c.height + (c.getClientRects().length ? " shown" : " hidden")),
        card: [...(el?.querySelectorAll(".empty-choices") ?? [])].filter(e => e.getClientRects().length).map(e => e.querySelector(".empty-title")?.textContent) }; })()`);
    texts[`${key}-pressed`] = { pressed, newViews: added, placement: await Promise.all(added.map(where)) };
    if (!added.length) { unreached.push({ state: key, why: `pressing ${pressed} added no view` }); continue; }
    await capture(page, `openview-${count}-after`, [], `Open a 3D view (${count} profile Vs) at ${size}px a moment after pressing ${pressed}: the new view is in the tab's 3D slot`, { section: "openview", whole: true, paired: "c-empty" });
    await head(page, 150_000);
    await markGroups(page, added);
    texts[`${key}-settled`] = { head: await page.evaluate(`${P}.viewport.snapshot().head.phase`), placement: await Promise.all(added.map(where)), cards: await cards(page) };
    await capture(page, `openview-${count}-settled`, [], `Open a 3D view (${count} profile Vs) at ${size}px once the new view has drawn`, { section: "openview", whole: true, paired: "c-empty" });
    await capture(page, `openview-${count}-pane`, GROUP, `The new 3D view's pane at ${size}px once drawn`, { section: "openview", pad: 6 });
  }
}

// --- the chain: choose a V for a scene with no look, and the next question is Presets' alone ---

async function chain(page: Session, count: number) {
  // No wait for the first tab's default V here: this section prepares a second V's head, and two heads at once (a cold server) is the run's heaviest moment.
  await page.wait(1_000);
  const panels = ["presets", "layers", "uv", "finish"];
  for (const size of SIZES) {
    await view(page, size);
    const key = `chain-${count}-${size}`;
    await fixture(page, "subject", count, key);
    await capture(page, `chain-${count}-before`, [], `Show which V? (${count} profile Vs and looks) at ${size}px before choosing`, { section: "chain", whole: true, paired: "c-empty" });
    const pressed = await pressChoice(page);
    await page.wait(1_200);
    texts[`${key}-after`] = { pressed, panels: await panelFacts(page, panels), headCards: await cards(page), headPhase: await page.evaluate(`${P}.viewport.snapshot().head.phase`) };
    await capture(page, `chain-${count}-after`, [], `After choosing ${pressed} at ${size}px: the V is on its way and the look question appears in Presets alone`, { section: "chain", whole: true, paired: "c-empty" });
    for (const id of ["presets", "layers"]) {
      await reveal(page, id); await scrollTo(page, id);
      if (id === "presets") await scrollChooser(page);
      await page.wait(200);
      await panelShot(page, `chain-${count}-${id}`, id, `${id === "presets" ? "Presets" : "Layers"} after choosing a V (${count} looks) at ${size}px`, "chain");
    }
    await head(page, 90_000);
    await capture(page, `chain-${count}-settled`, [], `The same at ${size}px once the V has drawn`, { section: "chain", whole: true, paired: "c-empty" });
  }
}

// --- an empty collection: its toast, after the toast, after a restart, with its recovery and conflict controls ---

const reload = async (page: Session) => {
  await page.send("Page.reload"); await page.wait(1_500); await page.waitFor(READY, 120_000); await page.wait(1_500);
  await press(page, `[...document.querySelectorAll("#preview-card .setup-card-actions button")].find(b => b.textContent.trim() === "Not now" && !b.closest("[hidden]") && b.getAttribute("aria-disabled") !== "true" && !b.disabled)`);
  await page.wait(400);
};
const recoveryFacts = (page: Session) => page.evaluate(`(() => { const shown = e => !!e && e.getClientRects().length > 0 && !e.closest("[hidden]");
  const read = id => { const el = ${S}.dock.panel(id)?.element; return !el ? null : { buttons: [...el.querySelectorAll("button")].filter(shown).map(b => (b.getAttribute("aria-label") ?? b.textContent.trim()).slice(0, 60)).filter(Boolean),
    choosers: [...el.querySelectorAll(".empty-choices")].filter(shown).map(e => e.querySelector(".empty-title")?.textContent), conflicts: [...el.querySelectorAll(".doc-conflict")].filter(shown).map(e => ({ text: e.textContent.trim().slice(0, 200), buttons: [...e.querySelectorAll("button")].filter(shown).map(b => b.textContent.trim()) })),
    emptyCard: [...el.querySelectorAll(".empty:not(.empty-choices)")].filter(shown).map(e => e.textContent.trim().slice(0, 80)) }; };
  const draft = ${P}.library.summary().draft;
  return { presets: read("presets"), library: read("library"), toasts: [...document.querySelectorAll(".toast")].map(t => t.textContent.trim().slice(0, 120)),
    presetCount: draft?.presets.length ?? null, removed: draft?.removed.map(r => r.name) ?? [], conflicts: draft?.conflicts.length ?? null }; })()`);

async function recovery(page: Session) {
  await head(page);
  const stage = async (state: string, shows: string) => {
    for (const size of SIZES) {
      await view(page, size);
      await reveal(page, "presets");
      await capture(page, `recovery-${state}-window`, [], `${shows} (${size}px, the whole window)`, { section: "recovery", whole: true, paired: "c-empty" });
      for (const id of ["presets", "library"]) {
        await reveal(page, id); await scrollTo(page, id);
        texts[`recovery-${state}-${id}-${size}`] = await recoveryFacts(page);
        await panelShot(page, `recovery-${state}-${id}`, id, `${id === "presets" ? "Presets" : "Library"}: ${shows} (${size}px)`, "recovery");
        if (id === "presets") { await scrollTo(page, id, true); await page.wait(250);
          await panelShot(page, `recovery-${state}-presets-end`, id, `Presets scrolled to its end: ${shows} (${size}px)`, "recovery"); }
      }
    }
    await view(page, WIDE);
  };
  // Start: the default workspace's collection with its one preset.
  await stage("start", "The default collection before anything is removed");
  // Remove the last preset the way a person does: its row, then Delete.
  await reveal(page, "presets");
  const removing = await page.evaluate(`(() => { const row = ${S}.dock.panel("presets")?.element?.querySelector(".item-row .item-main"); if (!row) return null; row.focus(); return row.textContent.trim().slice(0, 60); })()`);
  texts["recovery-removing"] = removing;
  await page.key("Delete"); await page.wait(500);
  if (await page.evaluate(`${P}.library.summary().draft?.presets.length`) !== 0) unreached.push({ state: "recovery removal", why: "Delete did not remove the collection's last preset" });
  texts["recovery-toast"] = await recoveryFacts(page);
  await capture(page, "recovery-toast-window", [], "The moment after the last preset was removed: the toast is up (1,600px, the whole window)", { section: "recovery", whole: true, paired: "c-empty" });
  await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 30_000).catch(() => { unreached.push({ state: "recovery toast expiry", why: "the toast was still up after 30 s" }); });
  await page.wait(800);
  await stage("after-toast", "The collection with its last preset removed, after the toast expired");
  // Restart: a reload of the same workspace (the browser storage and the library are kept).
  await reload(page);
  await stage("after-restart", "The same collection after a restart");
  // A conflict: another window renames this collection in the library; this window's next write then conflicts.
  const mine = await page.evaluate(`${P}.library.summary().draft?.id`) as string;
  // The other window's write and this window's rename follow at once (one task), so this window can't have read the other's revision first.
  await reveal(page, "presets");
  texts["recovery-other-window-write"] = await page.evaluate(`(async () => { const ref = { kind: "collection-working", id: ${JSON.stringify(mine)} };
    const read = await (await fetch("/api/verification/documents/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs: [ref] }) })).json();
    const doc = read.documents[ref.kind + "/" + ref.id]; if (!doc) return "missing";
    const answer = await (await fetch("/api/verification/documents/transact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "other-window:" + Date.now(), command: "verification.otherWindow",
      writes: [{ ...ref, base: doc.revision, value: { ...doc.value, name: "Renamed in another window" } }] }) })).json();
    // This window's own edit of the same document: the collection name field, committed as a person does (Enter fires its change).
    const input = ${S}.dock.panel("presets").element.querySelector("input[aria-label='Collection name']");
    input.focus(); input.select(); input.value = "Renamed here"; input.dispatchEvent(new Event("change", { bubbles: true })); input.blur();
    return JSON.stringify(answer); })()`);
  await page.wait(2_500);
  texts["recovery-conflict-raised"] = await recoveryFacts(page);
  await stage("conflict", "The empty collection with a conflict waiting (changed in another window)");
  // Resolve it and bring the preset back.
  await reveal(page, "presets");
  // Restore and Add preset are held back with their reason while the conflict waits (recorded), then Keep mine asks before it discards anything.
  texts["recovery-held-back"] = await page.evaluate(`[...${S}.dock.panel("presets").element.querySelectorAll("button")].filter(b => b.getClientRects().length && /Restore|Add preset/.test(b.getAttribute("aria-label") ?? b.textContent))
    .map(b => ({ name: b.getAttribute("aria-label") ?? b.textContent.trim(), ariaDisabled: b.getAttribute("aria-disabled"), reason: b.title || null }))`);
  // A real pointer press on the button (its confirmation anchors to where it was pressed).
  texts["recovery-resolve"] = await realClick(page, `[...${S}.dock.panel("presets").element.querySelectorAll(".doc-conflict button")].find(x => /mine/i.test(x.textContent))`);
  await page.wait(700);
  const confirm = await page.evaluate(`(() => { const d = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].find(e => e.getClientRects().length); if (!d) return null;
    return { text: d.textContent.trim().replace(/\\s+/g, " ").slice(0, 300), buttons: [...d.querySelectorAll("button")].map(b => b.textContent.trim()) }; })()`);
  texts["recovery-confirm"] = confirm;
  if (confirm) {
    await capture(page, "recovery-conflict-confirm-window", [], "Keep mine asks before it discards the other window's changes (1,600px, the whole window)", { section: "recovery", whole: true });
    await page.evaluate(`(() => { const d = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].find(e => e.getClientRects().length); const bs = [...d.querySelectorAll("button")].filter(b => !/cancel|close/i.test(b.textContent)); bs.at(-1)?.click(); })()`);
  } else unreached.push({ state: "recovery confirm", why: "Keep mine opened no confirmation" });
  await page.wait(1_800);
  texts["recovery-resolved"] = await recoveryFacts(page);
  await reveal(page, "presets");
  const restored = await page.evaluate(`(() => { const b = [...${S}.dock.panel("presets").element.querySelectorAll("button")].find(x => x.textContent.includes("Restore “") && x.getClientRects().length); if (!b) return null; const name = b.textContent.trim(); b.click(); return name; })()`);
  await page.wait(1_500);
  texts["recovery-restored"] = { pressed: restored, facts: await recoveryFacts(page) };
  if (!restored) unreached.push({ state: "recovery restore", why: "no Restore button was on screen" });
  await stage("restored", "After Restore: the preset is back");
}

// --- a tab created from a default, before its view is clicked ---

async function defaultTab(page: Session) {
  await head(page);
  const dialog = () => page.evaluate(`(() => { const d = [...document.querySelectorAll("[role=dialog], .popover, .menu")].find(e => e.getClientRects().length && /New tab/i.test(e.textContent)); if (!d) return null;
    return { text: d.textContent.trim().replace(/\\s+/g, " ").slice(0, 400), buttons: [...d.querySelectorAll("button")].map(b => b.textContent.trim()) }; })()`);
  // "fresh": the workspace as a first run leaves it (one V, one look: nothing to ask, so no dialog). "chosen" / "empty": a profile with
  // several Vs and looks, so the dialog asks, and the first V and look are chosen or both are left empty.
  for (const variant of ["fresh", "chosen", "empty"] as const) {
    for (const size of SIZES) {
      await view(page, size);
      const key = `defaulttab-${variant}-${size}`;
      if (variant !== "fresh") await fixture(page, "subject", 8, key);
      const tabsBefore = await page.evaluate(`${P}.tabs.snapshot().tabs.length`) as number;
      await press(page, `[...document.querySelectorAll(".layout-tabs button")].find(b => b.textContent.trim() === "New tab")`); await page.wait(500);
      await press(page, `[...document.querySelectorAll("[role=menuitem]")].find(b => b.textContent.startsWith("Eye makeup"))`); await page.wait(900);
      texts[`${key}-dialog`] = await dialog();
      // A workspace with one V and one look has nothing to ask: the tab is made at once, with no dialog.
      if (!texts[`${key}-dialog`]) await page.wait(600);
      if (variant === "chosen" && texts[`${key}-dialog`]) {
        // The first V and the first look the dialog offers (a real V and a real look, so every editor has something to show at once).
        texts[`${key}-picked`] = await page.evaluate(`(() => { const d = [...document.querySelectorAll("[role=dialog], .popover, .menu")].find(e => e.getClientRects().length && /New tab/i.test(e.textContent));
          const buttons = [...d.querySelectorAll("button")].filter(b => b.textContent.trim() && !/^(Leave empty|Cancel|Create)$/.test(b.textContent.trim())); const names = buttons.map(b => b.textContent.trim());
          const v = buttons[0], look = buttons.find(b => /Preset|Look/i.test(b.textContent) && b !== v); v?.click(); look?.click(); return { names, v: v?.textContent.trim() ?? null, look: look?.textContent.trim() ?? null }; })()`);
        await page.wait(300);
      }
      await capture(page, `defaulttab-${variant}-dialog`, [], `New tab from the Eye makeup default (${{ fresh: "a first-run workspace, nothing to choose", chosen: "a V and a look chosen in the dialog", empty: "both left empty in the dialog" }[variant]}) at ${size}px: the dialog`, { section: "defaulttab", whole: true });
      await press(page, `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Create" && b.getClientRects().length)`);
      await page.wait(1_500);
      const made = await page.evaluate(`${P}.tabs.snapshot().tabs.length`) as number;
      if (made !== tabsBefore + 1) { unreached.push({ state: key, why: `Create did not add a tab (${tabsBefore} before, ${made} after)` }); continue; }
      const facts = () => page.evaluate(`(() => ({ tabs: ${P}.tabs.snapshot().tabs.map(t => t.name), noViewText: /no 3D view|Open a 3D view/i.test(document.body.innerText), cards: [...document.querySelectorAll(".empty-choices")].filter(e => e.getClientRects().length).map(e => e.querySelector(".empty-title")?.textContent),
        views: ${P}.views.titles().map(t => t.panel + " = " + t.title), headPhase: ${P}.viewport.snapshot().head.phase }))()`);
      texts[`${key}-before-click`] = { facts: await facts(), panels: await panelFacts(page, ["presets", "layers", "uv", "finish"]) };
      await capture(page, `defaulttab-${variant}-before-click`, [], `A tab just made from the Eye makeup default (${{ fresh: "a first-run workspace, nothing to choose", chosen: "a V and a look chosen in the dialog", empty: "both left empty in the dialog" }[variant]}) at ${size}px, before its view is clicked`, { section: "defaulttab", whole: true, paired: "c-empty" });
      // Click the 3D view's pane (an unfocused view being clicked must change nothing), then look again.
      await page.evaluate(`(() => { const p = ${S}.dock.panelList().map(x => x.id).filter(id => id.startsWith("view.")).map(id => ${S}.dock.panel(id)?.element).find(e => e?.getClientRects().length); p?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); p?.click(); })()`);
      await page.wait(800);
      texts[`${key}-after-click`] = await facts();
      await capture(page, `defaulttab-${variant}-after-click`, [], `The same tab after its view was clicked, ${size}px`, { section: "defaulttab", whole: true, paired: "c-empty" });
      await act(page, { kind: "tabs.close", tab: await page.evaluate(`${P}.tabs.snapshot().shown`) as string }); await page.wait(500);
    }
  }
}

// --- Create a look's starter layer ---

async function starter(page: Session, noCollection: boolean) {
  await head(page);
  if (noCollection) {
    // A profile with no collection at all has no control in the Studio to make it (a collection can't be taken off a profile), so the
    // library's own document is written as another window would write it, and the page restarts on it.
    texts["starter-profile-write"] = await page.evaluate(`(async () => { const docs = (await (await fetch("/api/verification/documents?kind=profile")).json()).documents; const out = [];
      for (const doc of docs) out.push(await (await fetch("/api/verification/documents/transact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "other-window:" + Date.now() + doc.id, command: "verification.profileWithoutCollections",
        writes: [{ kind: "profile", id: doc.id, base: doc.revision, value: { ...doc.value, collections: [] } }] }) })).json());
      return JSON.stringify(out); })()`);
    await reload(page); await head(page, 90_000);
  }
  const tag = noCollection ? "nocollection" : "emptycollection";
  for (const size of SIZES) {
    await view(page, size);
    const key = `starter-${tag}-${size}`, fx = await fixture(page, "look", 0, key);
    const layers = async () => ({ profileCollections: await page.evaluate(`fetch("/api/verification/documents?kind=profile").then(r => r.json()).then(d => d.documents.map(p => p.value.collections.length))`),
      ...await page.evaluate(`(() => { const draft = ${P}.library.summary().draft; return { layerCount: ${P}.library.currentLayerCount?.() ?? null, presets: draft?.presets.map(p => p.name + " (" + p.layers + " layers)") ?? null, collection: draft?.name ?? null }; })()`) });
    texts[`${key}-before`] = { collection: fx.collection ?? null, layers: await layers(), panels: await panelFacts(page, ["presets", "layers"]) };
    await capture(page, `starter-${tag}-before`, [], `Show which look? with no looks (${noCollection ? "the profile has no collection" : "an existing empty collection"}) at ${size}px, before Create a look`, { section: "starter", whole: true, paired: "c-empty" });
    const pressed = await pressChoice(page, "Create a look");
    await page.wait(1_200);
    texts[`${key}-after`] = { pressed, layers: await layers(), panels: await panelFacts(page, ["presets", "layers"]), cards: await cards(page) };
    if (!pressed) unreached.push({ state: key, why: "no Create a look button was on screen" });
    await capture(page, `starter-${tag}-after`, [], `After Create a look (${noCollection ? "no collection" : "an existing empty collection"}) at ${size}px: the look is shown and has its starting layer`, { section: "starter", whole: true, paired: "c-empty" });
    for (const id of ["layers", "presets"]) { await reveal(page, id); await scrollTo(page, id); await panelShot(page, `starter-${tag}-${id}`, id, `${id === "layers" ? "Layers" : "Presets"} after Create a look (${tag}) at ${size}px`, "starter"); }
  }
}

// --- startup: a V-less scene stays V-less after a restart; a fresh workspace still gets its V ---

async function vless(page: Session) {
  await head(page);
  for (const size of SIZES) {
    await view(page, size);
    const key = `vless-${size}`;
    await fixture(page, "subject", 0, key);
    texts[`${key}-before-restart`] = { cards: await cards(page), shown: await page.evaluate(`${P}.tabs.snapshot().shown`) };
    await reload(page);
    // Give any loader that would make a V by itself the time to do it.
    await page.wait(8_000);
    await view(page, size);
    texts[`${key}-after-restart`] = { cards: await cards(page), headPhase: await page.evaluate(`${P}.viewport.snapshot().head.phase`), shown: await page.evaluate(`${P}.tabs.snapshot().shown`) };
    await page.evaluate(`document.querySelectorAll("[data-u6cap]").forEach(e => e.removeAttribute("data-u6cap")); [...document.querySelectorAll(".empty-choices")].find(e => e.getClientRects().length && e.querySelector(".empty-title")?.textContent === "Show which V?")?.setAttribute("data-u6cap", "")`);
    await capture(page, "vless-after-restart", [], `An explicitly V-less 3D view after a restart at ${size}px: still Show which V?, no V made for it`, { section: "vless", whole: true, paired: "c-empty" });
    const pressed = await pressChoice(page, "feminine") ?? await pressChoice(page);
    await page.wait(1_000);
    texts[`${key}-chosen`] = { pressed, cards: await cards(page) };
    await head(page, 120_000);
    texts[`${key}-chosen-settled`] = { cards: await cards(page), headPhase: await page.evaluate(`${P}.viewport.snapshot().head.phase`) };
    await capture(page, "vless-chosen", [], `After choosing a V in the V-less view at ${size}px: the chosen V appears`, { section: "vless", whole: true, paired: "c-empty" });
  }
}

const counts = (all: number[]) => all.filter(count => countOnly === undefined || String(count) === countOnly);
if (want("lookless")) for (const count of counts([0, 1, 8])) await session(`lookless-${count}`, page => lookless(page, count));
if (want("link")) await session("link", pointerLink);
if (want("headpane")) for (const count of counts([0, 1, 8])) await session(`headpane-${count}`, page => headPane(page, count));
if (want("openview")) for (const count of counts([0, 8])) await session(`openview-${count}`, page => openView(page, count));
if (want("chain")) for (const count of counts([8, 0])) await session(`chain-${count}`, page => chain(page, count));
if (want("recovery")) await session("recovery", recovery);
if (want("defaulttab")) await session("defaulttab", defaultTab);
if (want("starter")) { await session("starter-emptycollection", page => starter(page, false)); await session("starter-nocollection", page => starter(page, true)); }
if (want("vless")) await session("vless", vless);

if (want("routes")) for (const route of ROUTES) await session(`routes-${route}`, page => routes(page, route));
if (want("picker")) for (const route of ROUTES) await session(`picker-${route}`, page => picker(page, route));
if (want("readonly")) for (const route of ROUTES) await session(`readonly-${route}`, page => readonly(page, route));
if (want("choose")) for (const route of ROUTES) await session(`choose-${route}`, page => choose(page, route));
if (want("firstrun")) await session("firstrun", page => firstRun(page, true), { raw: true, init: OBSERVER });
if (want("firstrun-plain")) await session("firstrun-plain", page => firstRun(page, false), { raw: true, init: OBSERVER, path: "" });
if (want("guide")) await session("guide", guide, { raw: true, path: "style-guide.html" });

/** Each run writes its own pair of files (named by its sections), so sections can be captured in separate runs and merged afterwards. */
const tag = (only ?? "all").replaceAll(",", "+") + (routeOnly ? `-${routeOnly}` : "") + (countOnly ? `-n${countOnly}` : "");
writeFileSync(join(out, `run-${tag}.json`), JSON.stringify({ date: new Date().toISOString(), port, texts, unreached, errors }, null, 2));
writeFileSync(join(out, `shots-${tag}.json`), JSON.stringify(shots, null, 2));
console.log(`Wrote ${shots.length} capture sets (${tag}) to ${out}${Object.keys(errors).length ? `
ERRORS in: ${Object.keys(errors).join(", ")}` : ""}`);
