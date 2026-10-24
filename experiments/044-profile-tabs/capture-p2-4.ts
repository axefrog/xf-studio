/**
 * P2-iv's UI captures for the design review (README §12, rows U1-U5, and the header without its Layouts button): the layout tab strip,
 * tab menu, New tab menu, substitution step and the Rename / Save as default popovers, light and dark, at a narrow and a wide window,
 * and the style guide's matching entries at the same schemes and widths. Live states are reached in an isolated `?verify=1` workspace on
 * a server of its own (its own throwaway data folder, never the person's library), in a headless Chrome with a throwaway profile, through
 * the real code paths: the verification hooks of §12 (`xfStudioPresentation`, `xfStudioShell.tabs`, `xfStudioTabFixtures`), never by
 * changing the app.
 *
 *   bun experiments/044-profile-tabs/capture-p2-4.ts <data-dir> <out-dir> [port=4531] [--only <sections>]
 *
 * Sections (each gets its own server and Chrome, so none inherits another's state):
 *   strip      U1: active/inactive, focused, renaming, dragging with its drop marker, the condensing stages and overflow, empty session
 *   menu       U2: the tab menu: normal, Reset to default, own origin with Update, Reopen (with "before reset"), origin gone
 *   new        U3: New tab with grouped defaults, stage tags, one-click and ellipsis rows, Yours with Delete, last used, the Undo notice, a
 *              newer-build default
 *   subst      U4: the substitution step: sharing versus a new scene, a long list with search, a candidate that dropped out
 *   close      closing tabs from the tab menu: the ordinary toast with Undo, and the last tab closed (no warning)
 *   naming     U5: Rename and Save as default popovers, normal and refused
 *   readonly   U1/U2/U3 in a second page of the same browser while the first holds the lease
 *   header     the header without the Layouts button, with the strip beneath it
 *   guide      the style guide's matching entries
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../projects/xf-studio/authoring/tools/cdp";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const only = flag("--only");
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun experiments/044-profile-tabs/capture-p2-4.ts <data-dir> <out-dir> [port] [--only <sections>]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4531);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = resolve(import.meta.dir, "..", "..", "projects", "xf-studio", "authoring");
const origin = `http://127.0.0.1:${port}`;
const NARROW = 900, WIDE = 1600, HEIGHT = 900, SIZES = [WIDE, NARROW];
const P = "window.xfStudioPresentation", T = "window.xfStudioShell.tabs", F = "window.xfStudioTabFixtures";

const READY = `!!window.xfStudioShell && !!window.xfStudioPresentation && !!document.querySelector(".layout-tabs") && !!document.querySelector(".history-controls button")`;
type Box = { x: number; y: number; width: number; height: number };
type Shot = { name: string; section: string; size: number; shows: string; guide?: string };
const shots: Shot[] = [], texts: Record<string, unknown> = {}, unreached: { state: string; why: string }[] = [], errors: Record<string, string> = {};

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
  await page.wait(250);
};

/** One look at the page as it is now, light and dark: the clip of `selectors`, named `<state>-<scheme>-<size>`. */
async function capture(page: Session, state: string, selectors: string[], shows: string,
  options: { pad?: number; guide?: boolean; section?: string; paired?: string; keepToasts?: boolean; whole?: boolean } = {}) {
  if (!options.keepToasts) await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 10_000).catch(() => {});
  const size = await page.evaluate(`innerWidth`) as number;
  for (const value of ["light", "dark"] as const) {
    await scheme(page, value, options.guide);
    const area = options.whole ? { x: 0, y: 0, width: size, height: await page.evaluate(`innerHeight`) as number } : await clip(page, selectors, options.pad);
    if (area.width > 0 && area.height > 0) {
      await page.screenshot(join(out, `${state}-${value}-${size}.png`), area);
      if (value === "light") shots.push({ name: `${state}-{light,dark}-${size}`, section: options.section ?? state.split("-")[0]!, size, shows, ...(options.paired ? { guide: options.paired } : {}) });
    } else texts[`missing-${state}-${size}`] = selectors;
  }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
  await scheme(page, "light", options.guide);
}

const STRIP = [".layout-tabs"];
const MENUS = [".layout-tabs", ".menu-layer .menu", ".popover"];
const menuText = (page: Session) => page.evaluate(`[...document.querySelectorAll(".menu-layer .menu")].map(menu => [...menu.querySelectorAll(".menu-heading, .menu-sep, .menu-item")].map(e =>
  e.classList.contains("menu-sep") ? "---" : e.classList.contains("menu-heading") ? "# " + e.textContent.trim() : (e.getAttribute("aria-disabled") === "true" ? "(unavailable) " : "") + e.textContent.trim().replace(/\\s+/g, " ") + (e.classList.contains("menu-secondary") ? " [secondary]" : "")))`);
const popupText = (page: Session) => page.evaluate(`[...document.querySelectorAll(".popover")].map(p => p.innerText.replace(/\\n+/g, " | "))`);
async function closeAll(page: Session) {
  for (let i = 0; i < 3 && await page.evaluate(`!!document.querySelector(".menu-layer .menu, .popover")`); i++) { await page.key("Escape"); await page.wait(150); }
  // A popover that Escape did not close (see the substitution step's focus note in the index) is cancelled with its Cancel button.
  await press(page, `[...document.querySelectorAll(".popover button")].find(b => b.textContent.trim() === "Cancel")`); await page.wait(150);
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
}
const act = (page: Session, action: Record<string, unknown>) => page.evaluate(`(() => { try { const r = ${P}.authoring.dispatch(${JSON.stringify(action)}); return JSON.stringify(r ?? "ok"); } catch (e) { return "refused: " + (e?.message ?? e); } })()`) as Promise<string>;
type TabInfo = { id: string; name: string; origin?: string };
const tabsOf = (page: Session) => page.evaluate(`${P}.tabs.snapshot()`) as Promise<{ tabs: TabInfo[]; shown: string; closed: { tab: TabInfo; reset?: boolean }[] }>;
const tabNamed = async (page: Session, name: string) => { const found = (await tabsOf(page)).tabs.find(tab => tab.name === name); if (!found) throw Error(`No tab named ${name}.`); return found.id; };
const newTab = async (page: Session, id: string, choice?: unknown) => { const r = await act(page, { kind: "tabs.new", default: id, ...(choice ? { choice } : {}) }); await page.wait(250); return r; };
const menuItem = (label: string) => `[...document.querySelectorAll(".menu-layer .menu-item")].find(e => e.textContent.trim().replace(/\\s+/g, " ").startsWith(${JSON.stringify(label)}))`;
/** Open the submenu of the menu entry labelled `label` (keyboard: focus it, then ArrowRight, as a person would). */
async function openSub(page: Session, label: string) {
  await page.evaluate(`(() => { const e = ${menuItem(label)}; e?.focus(); })()`);
  await page.key("ArrowRight"); await page.wait(350);
}
const studio = async (page: Session) => {
  await page.waitFor(READY, 120_000); await page.wait(1_500);
  await press(page, `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Not now")`);
  await page.wait(300);
};
/** The workspace's factory arrangement in tab 1 (a fresh workspace opens with an empty dock). */
async function factory(page: Session) {
  await page.evaluate(`window.xfStudioShell.dock.reset()`); await page.wait(900);
}
async function server() {
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  const proc = Bun.spawn([process.execPath, "server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off" } });
  console.log(`server pid ${proc.pid}`);
  for (let i = 0; i < 480; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ } await Bun.sleep(250); }
  return proc;
}
let debugOffset = 0;
/** A fresh server and Chrome for one section: `fn` gets the page; whatever it throws is recorded, and both are always stopped. */
async function session(name: string, fn: (page: Session, debugPort: number) => Promise<void>, size = WIDE) {
  const proc = await server();
  const debugPort = port + 5000 + (debugOffset++);
  try {
    const page = await launch(`${origin}/?verify=1`, { width: size, height: HEIGHT, scheme: "light", debugPort });
    try {
      await studio(page);
      await fn(page, debugPort);
      texts[`console-${name}`] = page.console.filter(entry => entry.type === "error" || entry.type === "exception").slice(0, 20);
    } finally { await page.close(); }
  } catch (error) { errors[name] = String((error as Error)?.stack ?? error).slice(0, 2000); console.log(`FAILED ${name}: ${errors[name]}`); }
  finally { proc.kill(); await proc.exited; }
}
/** Run `prepare` (opens the state), capture it, then close it, at each window size. */
async function sized(page: Session, state: string, shows: string, selectors: string[], prepare: () => Promise<void>, options: Parameters<typeof capture>[4] = {}) {
  for (const size of SIZES) {
    await view(page, size, 450);
    await prepare(); await page.wait(250);
    texts[`${state}-${size}`] = { menus: await menuText(page), popups: await popupText(page) };
    await capture(page, state, selectors, shows, options);
    await closeAll(page);
  }
  await view(page, WIDE, 300);
}
const stageOf = (page: Session) => page.evaluate(`(() => { const s = document.querySelector(".layout-tabs .tab-strip"); const tabs = [...document.querySelectorAll(".layout-tabs .dock-tab")];
  return { stage: s?.dataset.stage, shown: tabs.filter(t => !t.hidden).length, of: tabs.length, active: tabs.find(t => t.getAttribute("aria-selected") === "true")?.hidden === false,
    more: !document.querySelector(".layout-tabs .tab-strip-more")?.hidden }; })()`) as Promise<{ stage: string; shown: number; of: number; active: boolean; more: boolean }>;
const tabRect = (page: Session, id: string) => page.evaluate(`(() => { const r = ${T}.strip.tab(${JSON.stringify(id)}).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`) as Promise<[number, number, number, number]>;
/** Set the window width. The dock keeps an arrangement per size class and a fresh workspace has none for a class it hasn't been in, so an empty dock is given the factory one (the strip's captures are about the strip, not that gap). */
async function view(page: Session, size: number, wait = 450) {
  await page.viewport(size, HEIGHT); await page.wait(wait);
  if (await page.evaluate(`!!document.querySelector(".dock-empty") && ${P}.tabs.snapshot().tabs.length > 0`)) { await page.evaluate(`window.xfStudioShell.dock.reset()`); await page.wait(700); }
}
const DEFAULTS = ["eye-makeup/default", "save-explorer/default", "expressions/default", "poses/default"];

// ---------------------------------------------------------------------------------------------------------------------
// U1

async function strip(page: Session) {
  // The empty dock a fresh workspace opens with, once, as found (the arrangement is tab 1's, and a new workspace has none yet).
  await capture(page, "strip-fresh-workspace", [], "A fresh workspace as it opens: one tab (Layout 1) over an empty dock (no saved arrangement yet)", { whole: true });
  await factory(page);
  for (const id of DEFAULTS) await newTab(page, id);
  await act(page, { kind: "tabs.show", tab: await tabNamed(page, "Save Explorer") }); await page.wait(600);
  texts["strip-snapshot"] = (await tabsOf(page)).tabs.map(tab => tab.name);
  for (const size of SIZES) {
    await view(page, size, 500);
    await capture(page, "strip-active-inactive", STRIP, "U1 the strip with five tabs: the active tab (Save Explorer), the inactive ones, each with its origin's icon (Layout 1: the generic layouts icon), and the trailing + (New tab)", { paired: "lib-tab-strip" });
  }
  await view(page, WIDE, 400);

  // Focused: keyboard focus ring on the active tab, then on an inactive one (a key press first, so the ring shows as it does for a keyboard user).
  const poses = await tabNamed(page, "Poses"), active = await tabNamed(page, "Save Explorer");
  for (const size of SIZES) {
    await view(page, size, 400);
    await page.evaluate(`${T}.strip.tab(${JSON.stringify(active)}).focus()`); await page.key("Shift"); await page.wait(200);
    await page.evaluate(`${T}.strip.tab(${JSON.stringify(active)}).focus()`); await page.wait(200);
    await capture(page, "strip-focused-active", STRIP, "U1 keyboard focus on the active tab (roving focus: the one tab stop)", { paired: "lib-tab-strip" });
    // An inactive tab takes focus without being selected (the strip's roving focus is arrow-driven, so this is the focus ring alone).
    await page.evaluate(`${T}.strip.tab(${JSON.stringify(poses)}).focus()`); await page.wait(250);
    texts[`strip-focused-inactive-${size}`] = await page.evaluate(`(() => { const t = ${T}.strip.tab(${JSON.stringify(poses)}); return { focused: document.activeElement === t, visible: t.matches(":focus-visible") }; })()`);
    await capture(page, "strip-focused-inactive", STRIP, "U1 keyboard focus ring on an inactive tab (Poses) while Save Explorer stays the selected one", { paired: "lib-tab-strip" });
    await page.evaluate(`document.activeElement?.blur()`);
  }
  await view(page, WIDE, 300);

  // Renaming: the tab is pressed while its popover is open (U5 composes under it).
  const eye = await tabNamed(page, "Eye makeup");
  await sized(page, "strip-renaming", "U1 renaming: the tab stays pressed (accent underline and fill) while its Rename popover is open", [...STRIP, ".popover"],
    async () => { await page.evaluate(`${T}.rename(${JSON.stringify(eye)})`); await page.wait(300); }, { paired: "lib-tab-strip" });

  // Dragging: more than five pixels along the strip, held between two tabs.
  for (const size of SIZES) {
    await view(page, size, 450);
    const first = await tabRect(page, (await tabsOf(page)).tabs[0]!.id), third = await tabRect(page, (await tabsOf(page)).tabs[2]!.id);
    const y = first[1] + first[3] / 2, from: [number, number] = [first[0] + first[2] / 2, y], to: [number, number] = [third[0] + third[2] - 6, y];
    await page.mouse("mouseMoved", from[0], y, { button: "none", buttons: 0 });
    await page.mouse("mousePressed", from[0], y, { button: "left", buttons: 1 });
    for (let i = 1; i <= 14; i++) { await page.mouse("mouseMoved", from[0] + (to[0] - from[0]) * i / 14, y, { button: "left", buttons: 1 }); await Bun.sleep(16); }
    await page.wait(250);
    texts[`strip-dragging-${size}`] = await page.evaluate(`({ dragging: document.querySelector(".layout-tabs").classList.contains("dragging"),
      draggedTab: (() => { const t = document.querySelector(".layout-tabs .dock-tab.dragging"); if (!t) return null; const s = getComputedStyle(t); return { text: t.textContent.trim(), opacity: s.opacity, filter: s.filter, transform: s.transform }; })(),
      markers: [...document.querySelectorAll(".layout-tabs .dock-tab")].filter(t => t.classList.contains("drop-before") || t.classList.contains("drop-after")).map(t => [t.textContent.trim(), t.className]) })`);
    await capture(page, "strip-dragging", STRIP, "U1 dragging the first tab (Layout 1) right: the drop marker sits between Save Explorer and Expressions; nothing reorders until release", { paired: "lib-tab-strip" });
    // Released outside the strip: cancelled, nothing moves.
    await page.mouse("mouseMoved", from[0], 400, { button: "left", buttons: 1 });
    await page.mouse("mouseReleased", from[0], 400, { button: "left", buttons: 0 });
    await page.wait(250);
  }
  await view(page, WIDE, 300);

  // Overflow: many tabs, narrowing the window through the condensing stages (full, truncated, icons, overflow).
  for (let n = 0; n < 7; n++) await newTab(page, DEFAULTS[n % DEFAULTS.length]!);
  await act(page, { kind: "tabs.show", tab: (await tabsOf(page)).tabs[1]!.id });
  texts["strip-many-snapshot"] = (await tabsOf(page)).tabs.map(tab => tab.name);
  for (const size of SIZES) {
    await view(page, size, 500);
    texts[`strip-many-${size}`] = await stageOf(page);
    await capture(page, "strip-many-tabs", STRIP, `U1 twelve tabs at a ${size}px window (the stage it falls in is in run.json)`, { paired: "lib-tab-strip" });
  }
  // Narrow the window through the stages with twelve tabs (full, truncated, icons), then with twenty (icons, overflow).
  const captured = new Set<string>();
  async function sweep(count: number) {
    const seen = new Map<string, number[]>();
    for (let width = 1700; width >= 380; width -= 10) {
      await page.viewport(width, HEIGHT); await page.wait(160);
      const state = await stageOf(page);
      (seen.get(state.stage) ?? seen.set(state.stage, []).get(state.stage)!).push(width);
    }
    texts[`strip-stages-by-width-${count}-tabs`] = Object.fromEntries([...seen].map(([stage, widths]) => [stage, { from: widths[0], to: widths.at(-1) }]));
    for (const [stage, widths] of seen) {
      if (captured.has(stage)) continue;
      captured.add(stage);
      const picks = [...new Set([widths[0]!, widths.at(-1)!])];
      for (const width of picks) {
        await page.viewport(width, HEIGHT); await page.wait(500);
        const state = await stageOf(page);
        await capture(page, `strip-stage-${stage}-${count}tabs-${width}px`, STRIP, `U1 the condensing stage "${stage}" with ${count} tabs (${picks.length > 1 && width === picks[0] ? "widest" : picks.length > 1 ? "narrowest" : "the only"} window width that gives it: ${width}px; ${state.shown} of ${state.of} tabs shown, active tab ${state.active ? "in" : "out of"} the strip)`, { paired: "lib-tab-strip", section: "strip-stages" });
      }
    }
  }
  await sweep(12);
  for (let n = 0; n < 8; n++) await newTab(page, DEFAULTS[n % DEFAULTS.length]!);
  await act(page, { kind: "tabs.show", tab: (await tabsOf(page)).tabs[1]!.id });
  texts["strip-twenty-tabs"] = (await tabsOf(page)).tabs.length;
  await sweep(20);
  // The overflow menu and the active tab staying in the strip when picked from it.
  await view(page, 520, 500);
  if ((await stageOf(page)).more) {
    await press(page, `document.querySelector(".layout-tabs .tab-strip-more")`); await page.wait(350);
    texts["strip-overflow-menu"] = await menuText(page);
    await capture(page, "strip-overflow-menu-520px", [...STRIP, ".menu-layer .menu"], "U1 the strip's overflow menu (More tabs) listing the tabs that don't fit, at a 520px window", { paired: "lib-tab-strip", section: "strip-stages" });
    const hidden = await page.evaluate(`(() => { const items = [...document.querySelectorAll(".menu-layer .menu-item")]; return items.at(-1)?.textContent.trim() ?? null; })()`);
    await page.evaluate(`(() => { [...document.querySelectorAll(".menu-layer .menu-item")].at(-1)?.click(); })()`); await page.wait(500);
    texts["strip-overflow-picked"] = { picked: hidden, state: await stageOf(page) };
    await capture(page, "strip-overflow-picked-520px", STRIP, `U1 after picking "${hidden}" from the overflow menu: the active tab is in the strip`, { paired: "lib-tab-strip", section: "strip-stages" });
  } else unreached.push({ state: "overflow menu (More tabs)", why: "no tab overflowed at 520px with twelve tabs" });
  await view(page, WIDE, 400);

  // Empty session: close every tab (each closes at once and is undoable); only the labelled New tab remains.
  for (const tab of (await tabsOf(page)).tabs) await act(page, { kind: "tabs.close", tab: tab.id });
  await page.wait(500);
  texts["strip-empty-snapshot"] = (await tabsOf(page)).tabs.map(tab => tab.name);
  for (const size of SIZES) {
    await view(page, size, 450);
    await capture(page, "strip-empty-session", STRIP, "U1 the empty session: no tabs, only New tab with its label", { paired: "lib-tab-strip" });
    await capture(page, "strip-empty-session-window", [], "U1 the whole window in the empty session (strip, empty dock below)", { whole: true, section: "strip" });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// U2

async function tabMenu(page: Session) {
  await factory(page);
  for (const id of DEFAULTS.slice(0, 3)) await newTab(page, id);
  const eye = await tabNamed(page, "Eye makeup");
  const open = (id: string) => async () => { await page.evaluate(`${T}.menu(${JSON.stringify(id)}, ${T}.strip.tab(${JSON.stringify(id)}))`); await page.wait(350); };
  await sized(page, "menu-normal", "U2 the tab menu on a tab made from a feature default: Rename…, Reset to default ▸, Save as default…, Close tab (no Update, no Reopen: nothing to update or reopen yet)", MENUS, open(eye), { paired: "lib-menu-secondary" });
  await sized(page, "menu-reset-submenu", "U2 Reset to default ▸ open: the tab's origin first, a separator, then the others grouped by owner", MENUS,
    async () => { await open(eye)(); await openSub(page, "Reset to default"); }, { paired: "lib-menu-secondary" });

  // Save as default…: the tab's origin becomes the new own default (U5's Save popover, then Update appears).
  await page.evaluate(`${T}.rename(${JSON.stringify(eye)}, ${T}.strip.tab(${JSON.stringify(eye)}), true)`); await page.wait(300);
  await page.evaluate(`(() => { const i = document.querySelector(".popover input"); i.value = "My eye layout"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await press(page, `document.querySelector(".popover button[type=submit]")`); await page.wait(500);
  texts["menu-own-origin"] = (await tabsOf(page)).tabs.map(tab => ({ name: tab.name, origin: tab.origin }));
  await sized(page, "menu-own-origin", "U2 a tab made from an own default: Update “My eye layout” appears after Save as default…", MENUS, open(eye), { paired: "lib-menu-secondary" });

  // Close one tab and reset another: Reopen lists both, newest first, the reset one reading "before reset".
  await act(page, { kind: "tabs.close", tab: await tabNamed(page, "Expressions") }); await page.wait(300);
  const explorer = await tabNamed(page, "Save Explorer");
  const reset = await act(page, { kind: "tabs.reset", tab: explorer, default: "poses/default" }); await page.wait(400);
  texts["menu-reset-result"] = { reset, tabs: (await tabsOf(page)).tabs.map(tab => tab.name), closed: (await tabsOf(page)).closed.map(item => ({ name: item.tab.name, reset: !!item.reset })) };
  await sized(page, "menu-reopen-submenu", "U2 Reopen closed tab ▸ open: newest first, a reset's fragment reading “<name> before reset” (here after closing Expressions, then resetting a tab)", MENUS,
    async () => { await open(eye)(); await openSub(page, "Reopen closed tab"); }, { paired: "lib-menu-secondary" });
  await sized(page, "menu-with-reopen", "U2 the full tab menu: Rename…, Reset to default ▸, Save as default…, Update “My eye layout”, Close tab, Reopen closed tab ▸", MENUS, open(eye), { paired: "lib-menu-secondary" });

  // A long-named own default: its Reset row must not cut the name, and the row's tooltip (native title) carries the full name (item 6).
  const longName = "My very long eye makeup layout for the night market shoot"; // within the 60-character tab-name limit
  texts["menu-long-default-saved"] = await act(page, { kind: "tabs.saveAsDefault", tab: (await tabsOf(page)).tabs.find(tab => tab.id !== eye)!.id, name: longName }); await page.wait(500);
  await sized(page, "menu-reset-long-row", "U2 Reset to default ▸ with a long own-default name (item 6): the row shows the name in full or ends with an ellipsis, and its tooltip carries the whole name (tooltips are native, so the title text is in run.json)", MENUS,
    async () => { await open(eye)(); await openSub(page, "Reset to default");
      texts["menu-reset-long-titles"] = await page.evaluate(`[...document.querySelectorAll(".menu-layer .menu-item")].filter(e => e.textContent.includes("My very long")).map(e => ({ title: e.title, text: e.textContent.trim(), clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, label: (() => { const l = e.querySelector(".menu-label"); return l ? { clientWidth: l.clientWidth, scrollWidth: l.scrollWidth } : null; })() }))`); },
    { paired: "lib-menu-secondary" });

  // Origin gone: the own default is deleted from New tab; the menu's Reset omits it and Update goes.
  await act(page, { kind: "defaults.delete", default: (await tabsOf(page)).tabs.find(tab => tab.id === eye)!.origin }); await page.wait(400);
  await sized(page, "menu-origin-gone", "U2 origin gone: the own default was deleted, so Update is left out and Reset to default lists only the defaults that still exist", MENUS, open(eye), { paired: "lib-menu-secondary" });
  await sized(page, "menu-origin-gone-reset", "U2 Reset to default ▸ with the origin gone: no first entry or separator for the deleted default, only the owner groups", MENUS,
    async () => { await open(eye)(); await openSub(page, "Reset to default"); }, { paired: "lib-menu-secondary" });
}

// ---------------------------------------------------------------------------------------------------------------------
// U3

async function newMenuStates(page: Session) {
  await factory(page);
  const add = `${T}.add`;
  const open = async () => { await page.evaluate(`${T}.newMenu()`); await page.wait(350); };
  await sized(page, "new-fresh", "U3 New tab ▸ in a fresh workspace: defaults grouped by module in module order (Eye makeup, then Save Explorer, Expressions and Poses with their Early access tag), every row one-click and naming its V and look", MENUS, open, { paired: "lib-menu-secondary" });
  // Opened from the + itself: a real click at the button (the menu hangs from it).
  for (const size of SIZES) {
    await view(page, size, 400);
    const at = await page.evaluate(`(() => { const r = ${add}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number];
    await page.mouse("mouseMoved", at[0], at[1], { button: "none", buttons: 0 });
    await page.mouse("mousePressed", at[0], at[1], { button: "left", buttons: 1, clickCount: 1 }); await page.mouse("mouseReleased", at[0], at[1], { button: "left", buttons: 0, clickCount: 1 });
    await page.wait(400);
    await capture(page, "new-from-plus", MENUS, "U3 New tab ▸ opened by clicking +: the menu hangs from the button", { paired: "lib-menu-secondary" });
    await closeAll(page);
  }
  await view(page, WIDE, 300);

  // Own defaults: Yours group, with a trailing Delete on each; two with one name are told apart by their saved time.
  const base = (await tabsOf(page)).tabs[0]!.id;
  await newTab(page, "save-explorer/default"); await newTab(page, "poses/default");
  const saved: string[] = []; let minute = -1;
  for (const [tab, name] of [[await tabNamed(page, "Save Explorer"), "My explorer"], [await tabNamed(page, "Poses"), "My poses"], [await tabNamed(page, "Poses"), "My poses"]] as const) {
    // Saved times show to the minute, so the second "My poses" waits for the minute to roll over: the two rows are then told apart by their time.
    if (name === "My poses" && saved.includes(name)) await page.waitFor(`new Date().getMinutes() !== ${minute}`, 70_000);
    texts[`new-save-${saved.length}`] = await act(page, { kind: "tabs.saveAsDefault", tab, name }); saved.push(name);
    minute = await page.evaluate(`new Date().getMinutes()`) as number; await page.wait(1100);
  }
  void base;
  // The fixtures: two more Vs and ten looks, so Eye makeup now has several candidates (an ellipsis row that opens the substitution step).
  await page.evaluate(`${F}.seed().then(r => { window.__fixture = r; })`); await page.waitFor(`!!window.__fixture`, 30_000); await page.wait(500);
  await sized(page, "new-full", "U3 New tab ▸ with fixtures: an ellipsis row (Eye makeup…, several Vs and looks, opens the substitution step), one-click rows with their Early access tag, and Yours with a trailing Delete on each own default (two of one name told apart by saved time)", MENUS, open, { paired: "lib-menu-secondary" });
  // Last used first and focused: choose Poses, then reopen.
  const lastUsed = await page.evaluate(`${P}.tabs.defaults().filter(view => view.owner.kind === "user" && view.name === "My poses").at(-1).id`) as string;
  await act(page, { kind: "tabs.new", default: lastUsed }); await page.wait(400);
  await sized(page, "new-last-used", "U3 the default used last (the later “My poses”) is first in its group (Yours) and holds focus when the menu opens again", MENUS, async () => {
    await open(); texts["new-last-used-focus"] = await page.evaluate(`document.activeElement?.textContent.trim().replace(/\s+/g, " ")`);
  }, { paired: "lib-menu-secondary" });
  // Focus on a trailing Delete: ArrowRight from an own default's main row.
  await sized(page, "new-delete-focused", "U3 keyboard focus on the trailing Delete of an own default (a separate focusable item, “Delete default My explorer”, reached with ArrowDown from its row)", MENUS, async () => {
    await open();
    await page.evaluate(`(() => { const e = [...document.querySelectorAll(".menu-layer .menu-item")].find(e => e.textContent.trim().startsWith("My explorer")); e?.focus(); })()`);
    await page.key("ArrowDown"); await page.wait(250);
    texts["new-delete-focused-active"] = await page.evaluate(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent`);
  }, { paired: "lib-menu-secondary" });

  // The bin under the pointer (hover; the row also takes focus on pointer enter): the danger colour appears only now (item 14).
  await sized(page, "new-bin-hover", "U3 the bin of an own default under the pointer: quiet at rest (see the other rows), danger-coloured only on hover or focus (item 14)", MENUS, async () => {
    await open();
    const at = await page.evaluate(`(() => { const e = [...document.querySelectorAll(".menu-layer .menu-item.menu-secondary")].find(e => e.getAttribute("aria-label") === "Delete default My explorer"); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number] | null;
    if (at) { await page.mouse("mouseMoved", at[0] - 10, at[1], { button: "none", buttons: 0 }); await page.mouse("mouseMoved", at[0], at[1], { button: "none", buttons: 0 }); await page.wait(300); }
    texts["new-bin-hover-style"] = await page.evaluate(`(() => { const rows = [...document.querySelectorAll(".menu-layer .menu-item.menu-secondary")]; const info = e => ({ name: e.getAttribute("aria-label"), color: getComputedStyle(e).color, focused: document.activeElement === e, hovered: e.matches(":hover") }); return rows.map(info); })()`);
  }, { paired: "lib-menu-secondary", keepToasts: true });

  // Delete: a tombstone with an Undo notice.
  await open();
  await page.evaluate(`(() => { const e = [...document.querySelectorAll(".menu-layer .menu-item.menu-secondary")].find(e => e.getAttribute("aria-label") === "Delete default My explorer"); e?.click(); })()`);
  await page.wait(500);
  texts["new-deleted"] = await page.evaluate(`[...document.querySelectorAll(".toasts > *")].map(t => t.innerText.replace(/\\n+/g, " | "))`);
  for (const size of SIZES) {
    await view(page, size, 400);
    await capture(page, "new-delete-undo-notice", [".toasts", ".layout-tabs"], "U3 after Delete on an own default: the notice names it and says how to get it back (Undo)", { keepToasts: true, paired: "c-toasts" });
  }
  await view(page, WIDE, 300);
  await page.evaluate(`(() => { [...document.querySelectorAll(".toasts button")].find(b => b.textContent.trim() === "Undo")?.click(); })()`); await page.wait(500);

  // A default written by a newer build: listed, unavailable, with the reason.
  await page.evaluate(`${F}.unavailableDefault().then(r => { window.__newer = r; })`); await page.waitFor(`!!window.__newer`, 30_000); await page.wait(500);
  await sized(page, "new-unavailable-default", "U3 a default from a newer Studio (a panel type this build lacks): listed unavailable with its reason, still deletable", MENUS, open, { paired: "lib-menu-secondary" });
}

// ---------------------------------------------------------------------------------------------------------------------
// U4

async function substitution(page: Session) {
  await factory(page);
  await page.evaluate(`${F}.seed().then(r => { window.__fixture = r; })`); await page.waitFor(`!!window.__fixture`, 30_000); await page.wait(500);
  texts["subst-fixture"] = await page.evaluate(`window.__fixture`);
  const form = async (): Promise<void> => {
    await page.evaluate(`${T}.newMenu()`); await page.wait(350);
    await press(page, menuItem("Eye makeup")); await page.wait(450);
  };
  const choose = (radioLabel: string, group?: string) => page.evaluate(`(() => { const scope = ${group ? `[...document.querySelectorAll(".popover [role=radiogroup]")].find(g => (g.getAttribute("aria-label") ?? "").startsWith(${JSON.stringify(group)}))` : "document.querySelector('.popover')"};
    const e = [...(scope?.querySelectorAll("[role=radio], [role=option], label, button") ?? [])].find(e => e.textContent.trim().replace(/\\s+/g, " ").startsWith(${JSON.stringify(radioLabel)})); e?.click(); return !!e; })()`);
  await sized(page, "subst-default", "U4 the substitution step as it opens: Show which V? (every option visible, Leave empty last), Scene (share the existing tab's scene is the default for a V it shows), Cancel and Create", [...STRIP, ".popover"], form, { paired: "lib-choice-popover" });
  // Which V has a tab already? The first tab shows the draft's V: choosing it shows the sharing default and its plain note.
  texts["subst-radios"] = await (async () => { await form(); const r = await page.evaluate(`[...document.querySelectorAll(".popover [role=radiogroup]")].map(g => ({ name: g.getAttribute("aria-label"), options: [...g.querySelectorAll("[role=radio]")].map(o => o.textContent.trim().replace(/\\s+/g, " ") + (o.getAttribute("aria-checked") === "true" ? " (selected)" : "")) }))`); await closeAll(page); return r; })();
  // Sharing: pick the V the first tab already shows (the first option of the V field).
  const firstV = (texts["subst-radios"] as { name: string; options: string[] }[]).find(g => g.name.startsWith("V "))?.options[0]?.replace(/ \(selected\)$/, "") ?? "";
  const area = [...STRIP, ".popover"];
  const typeSearch = (value: string) => page.evaluate(`(() => { const i = document.querySelector('.popover .choice-popover-field[data-slot^="look:"] input'); if (!i) return false; i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sized(page, "subst-sharing", "U4 sharing a scene: the V an existing tab already shows is chosen, Scene defaults to Share the scene of that tab (the look field is not needed), and the note says lighting and look changes then show in both tabs", area,
    async () => { await form(); if (firstV) await choose(firstV, "V "); await page.wait(300); }, { paired: "lib-choice-popover" });
  await sized(page, "subst-new-scene", "U4 a new scene for a V another tab shows: New scene chosen beside Share, and Show which look? appears with the profile's looks grouped by collection (more than eight, so with a search field)", area,
    async () => { await form(); if (firstV) await choose(firstV, "V "); await page.wait(250); await choose("New scene", "Scene"); await page.wait(350); }, { paired: "lib-choice-popover" });
  await sized(page, "subst-search-filtered", "U4 the look search filtered (“look 1”): the list narrows to matches (Capture look 1 and Capture look 10), the group heading stays", area,
    async () => { await form(); await typeSearch("look 1"); await page.wait(350); }, { paired: "lib-choice-popover" });
  await sized(page, "subst-search-no-match", "U4 the look search with no match (“zzz”)", area,
    async () => { await form(); await typeSearch("zzz"); await page.wait(350); }, { paired: "lib-choice-popover" });
  // A V no tab shows yet: nothing to share, so a new scene.
  await sized(page, "subst-other-v", "U4 a V no tab shows yet (Capture V A): there is nothing to share, so Scene is New scene (plain text, one choice) and the look field is shown", area,
    async () => { await form(); await choose("Capture V A", "V "); await page.wait(350); }, { paired: "lib-choice-popover" });
  // Item 2: focus starts on the first field; Escape cancels and returns focus to the invoker (the + button the menu hung from).
  for (const size of SIZES) {
    await view(page, size, 450);
    await form();
    texts[`subst-focus-${size}`] = await page.evaluate(`({ inPopover: !!document.activeElement?.closest(".popover"), active: document.activeElement?.tagName + " role=" + document.activeElement?.getAttribute("role") + " " + (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim().slice(0, 60), visible: !!document.activeElement?.matches(":focus-visible") })`);
    await capture(page, "subst-focus-first-field", area, "U4 the substitution step with focus on its first field (the V choice), item 2", { paired: "lib-choice-popover" });
    await page.key("Escape"); await page.wait(350);
    texts[`subst-escape-${size}`] = { popoverGone: !(await page.evaluate(`!!document.querySelector(".popover")`)), focusOnPlus: await page.evaluate(`document.activeElement === ${T}.add`), tabs: (await tabsOf(page)).tabs.length };
    await capture(page, "subst-escaped-focus-returned", STRIP, "U4 after Escape: the step is gone, no tab was made, focus is back on + (New tab), item 2", { paired: "lib-tab-strip" });
    await closeAll(page);
  }
  await view(page, WIDE, 300);
  // Escape creates nothing, Create makes the tab.
  const before = (await tabsOf(page)).tabs.length;
  await form();
  const focusOnOpen = await page.evaluate(`({ inPopover: !!document.activeElement?.closest(".popover"), active: (document.activeElement?.tagName ?? "") + " " + (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").slice(0, 40) })`);
  await page.key("Escape"); await page.wait(300);
  texts["subst-escape"] = { focusOnOpen, before, after: (await tabsOf(page)).tabs.length, popover: await page.evaluate(`document.querySelector(".popover")?.outerHTML.slice(0, 200) ?? null`), focusReturnedToPlus: await page.evaluate(`document.activeElement === ${T}.add`) };
  await form(); await choose("Capture V B", "V "); await choose("Capture look 2", "Look "); await page.wait(250);
  await press(page, `[...document.querySelectorAll(".popover .btn")].find(b => b.textContent.trim() === "Create")`); await page.wait(700);
  texts["subst-created"] = (await tabsOf(page)).tabs.map(tab => tab.name);
  await capture(page, "subst-after-create", [...STRIP, ".viewport-panel", ".dock"], "U4 after Create (Capture V B, Capture look 2): the new tab is in the strip and selected, its arrangement loaded", { paired: "lib-tab-strip", whole: true });
  // A candidate that dropped out while the form was open: a look removed from its collection, then a V removed from the profile (looks first,
  // so two Vs are still candidates for the second pass and Eye makeup still opens the step instead of creating a tab at once).
  for (const size of SIZES) {
    await view(page, size, 450);
    const index = size === WIDE ? 4 : 5;
    await form(); await choose(`Capture look ${index + 1}`, "Look "); await page.wait(300);
    const look = await page.evaluate(`window.__fixture.looks[${index}]`);
    await page.evaluate(`Promise.resolve(${F}.removeLook(window.__fixture.collection, ${JSON.stringify(look)})).then(r => { window.__removed = JSON.stringify(r); })`); await page.wait(900);
    texts[`subst-dropped-look-${size}`] = { look, result: await page.evaluate(`window.__removed`), popups: await popupText(page) };
    await capture(page, "subst-candidate-dropped-look", area, `U4 a look deleted while the step is open (Capture look ${index + 1}, which was chosen): it drops out of the list, its choice falls back to Leave empty, and the note says so`, { paired: "lib-choice-popover" });
    await closeAll(page);
  }
  for (const size of SIZES) {
    await view(page, size, 450);
    const target = size === WIDE ? 0 : 1, letter = size === WIDE ? "A" : "B";
    await form(); await choose(`Capture V ${letter}`, "V "); await page.wait(300);
    const subject = await page.evaluate(`window.__fixture.subjects[${target}]`);
    await page.evaluate(`Promise.resolve(${F}.removeSubject(${JSON.stringify(subject)})).then(r => { window.__removed = JSON.stringify(r); })`); await page.wait(900);
    texts[`subst-dropped-v-${size}`] = { subject, result: await page.evaluate(`window.__removed`), popups: await popupText(page) };
    await capture(page, "subst-candidate-dropped-v", area, `U4 a V deleted while the step is open (Capture V ${letter}, which was chosen): its choice falls back to Leave empty and the note says a choice is no longer available`, { paired: "lib-choice-popover" });
    await closeAll(page);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Closing tabs (item 15): through the tab menu's Close tab, so the strip's own notice shows, as it does for a person.

async function closing(page: Session) {
  await factory(page);
  await newTab(page, "save-explorer/default");
  const closeVia = async (id: string) => {
    await page.evaluate(`${T}.menu(${JSON.stringify(id)}, ${T}.strip.tab(${JSON.stringify(id)}))`); await page.wait(350);
    await press(page, menuItem("Close tab")); await page.wait(600);
  };
  const notices = () => page.evaluate(`({ toasts: [...document.querySelectorAll(".toasts > *")].map(t => ({ text: t.innerText.replace(/\\n+/g, " | "), class: t.className })),
    status: (() => { const s = document.querySelector(".status-bar"); return s ? { text: s.innerText.replace(/\\n+/g, " | "), warning: !!s.querySelector(".warning, [data-tone=warning], [class*=warn]") } : null; })() })`);
  for (const size of SIZES) {
    await view(page, size, 450);
    const state = (await tabsOf(page)).tabs;
    const extra = state.length < 2 ? (await newTab(page, "poses/default"), (await tabsOf(page)).tabs) : state;
    // Close a tab that is not the last: toast with Undo.
    await closeVia(extra.at(-1)!.id);
    texts[`close-one-${size}`] = await notices();
    await capture(page, "close-tab-toast", [".toasts", ".layout-tabs", ".status-bar"], "Item 15 closing a tab (not the last): an ordinary info toast with Undo, no warning colour anywhere", { keepToasts: true, paired: "c-toasts" });
    await page.evaluate(`(() => { [...document.querySelectorAll(".toasts button")].find(b => b.textContent.trim() === "Undo")?.click(); })()`); await page.wait(600);
    texts[`close-undone-${size}`] = (await tabsOf(page)).tabs.map(tab => tab.name);
    await capture(page, "close-tab-undone", [".toasts", ".layout-tabs"], "Item 15 after Undo: the tab is back in the strip", { keepToasts: true });
  }
  // Close every tab through the menu: the last close is the one that used to leave a warning in the status bar.
  for (const size of SIZES) {
    await view(page, size, 450);
    while ((await tabsOf(page)).tabs.length > 0) await closeVia((await tabsOf(page)).tabs[0]!.id);
    texts[`close-last-${size}`] = await notices();
    await capture(page, "close-last-tab-window", [], "Item 15 closing the last tab: the whole window with the toast (Undo) and the status bar, no warning", { keepToasts: true, whole: true, paired: "c-toasts" });
    await capture(page, "close-last-tab-notices", [".toasts", ".layout-tabs", ".status-bar"], "Item 15 closing the last tab: the toast with Undo, the strip's empty session and the status bar", { keepToasts: true, paired: "c-toasts" });
    await page.evaluate(`(() => { [...document.querySelectorAll(".toasts button")].find(b => b.textContent.trim() === "Undo")?.click(); })()`); await page.wait(600);
    texts[`close-last-undone-${size}`] = (await tabsOf(page)).tabs.map(tab => tab.name);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// U5

async function naming(page: Session) {
  await factory(page);
  await newTab(page, "eye-makeup/default");
  const id = await tabNamed(page, "Eye makeup");
  const el = `${T}.strip.tab(${JSON.stringify(id)})`;
  const field = (value: string) => page.evaluate(`(() => { const i = document.querySelector(".popover input[type=text], .popover input.field"); i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const rename = (save: boolean, value?: string) => async () => {
    await page.evaluate(`${T}.rename(${JSON.stringify(id)}, ${el}${save ? ", true" : ""})`); await page.wait(350);
    if (value !== undefined) { await field(value); await page.wait(250); }
  };
  const area = [...STRIP, ".popover"];
  await sized(page, "naming-rename", "U5 Rename: one name field with the tab's name, Cancel and Rename (the strip's tab stays pressed beneath)", area, rename(false), { paired: "c-popover" });
  await sized(page, "naming-rename-empty", "U5 Rename refused, empty name: Rename is disabled and the reason is in place beneath the field", area, rename(false, ""), { paired: "c-popover" });
  await sized(page, "naming-rename-long", "U5 Rename refused, name of 61 characters (the field's limit is 61 and the application refuses over 60)", area, rename(false, "x".repeat(61)), { paired: "c-popover" });
  await sized(page, "naming-rename-control", "U5 Rename refused, a control character in the name", area, rename(false, "Eye\u0007makeup"), { paired: "c-popover" });
  await sized(page, "naming-rename-valid", "U5 Rename with a new valid name typed: Rename is enabled", area, rename(false, "Night look"), { paired: "c-popover" });
  await sized(page, "naming-save-default", "U5 Save tab as default…: a name defaulting to the tab's name, with the hint that it saves a default of yours and feature defaults stay available", area, rename(true), { paired: "c-popover" });
  await sized(page, "naming-save-default-feature-name", "U5 Save tab as default… with a feature default's name (Eye makeup): saves an own default beside it; the hint says feature defaults stay available", area, rename(true, "Eye makeup"), { paired: "c-popover" });
  await sized(page, "naming-save-default-empty", "U5 Save tab as default… refused, empty name", area, rename(true, ""), { paired: "c-popover" });
  // A second own default of the same name is allowed (P2-ii's decision) - saved, then saved again under the same name.
  await act(page, { kind: "tabs.saveAsDefault", tab: id, name: "Duplicate name" }); await page.wait(300);
  const again = await act(page, { kind: "tabs.saveAsDefault", tab: id, name: "Duplicate name" });
  texts["naming-duplicate"] = again;
}

// ---------------------------------------------------------------------------------------------------------------------
// Read-only: a second page of the same browser while the first holds the lease.

type Mini = { send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>; evaluate<T = any>(expression: string): Promise<T>;
  screenshot(path: string, clip?: Box): Promise<void>; viewport(width: number, height: number): Promise<void>; colorScheme(value: "light" | "dark"): Promise<void>;
  waitFor(expression: string, timeout?: number): Promise<any>; key(key: string): Promise<void>; mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number): Promise<void>;
  wait(ms: number): Promise<void>; console: { type: string; text: string }[]; close(): void };
/** A bare second CDP page in the same Chrome (the same profile, so the same workspace and its lease). */
async function secondPage(page: Session, debugPort: number, url: string): Promise<Mini> {
  await page.send("Target.createTarget", { url: "about:blank" });
  let target: { id: string; webSocketDebuggerUrl: string; url: string } | undefined;
  for (let i = 0; i < 40 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json() as { id: string; type: string; url: string; webSocketDebuggerUrl: string }[];
    const pages = list.filter(item => item.type === "page");
    target = pages.find(item => item.url === "about:blank") ?? undefined; if (!target) await Bun.sleep(150);
  }
  if (!target) throw Error("The second page did not appear.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0; const pending = new Map<number, { ok(v: any): void; fail(e: Error): void }>(); const log: { type: string; text: string }[] = [];
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { const entry = pending.get(message.id)!; pending.delete(message.id); if (message.error) entry.fail(Error(message.error.message)); else entry.ok(message.result); }
    else if (message.method === "Runtime.consoleAPICalled") log.push({ type: message.params.type, text: message.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ") });
    else if (message.method === "Runtime.exceptionThrown") log.push({ type: "exception", text: message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text });
  };
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => { const next = ++id; pending.set(next, { ok, fail }); socket.send(JSON.stringify({ id: next, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  const media = new Map<string, string>();
  const mini: Mini = { send, console: log,
    async evaluate(expression) { const r = await send<any>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; },
    async screenshot(path, area) { const r = await send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(area ? { clip: { ...area, scale: 1 } } : {}) }); writeFileSync(path, Buffer.from(r.data, "base64")); },
    async viewport(width, height) { await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); },
    async colorScheme(value) { media.set("prefers-color-scheme", value); await send("Emulation.setEmulatedMedia", { features: [...media].map(([name, v]) => ({ name, value: v })) }); },
    async waitFor(expression, timeout = 30_000) { const start = Date.now(); while (Date.now() - start < timeout) { try { const v = await mini.evaluate(expression); if (v) return v; } catch { /* loading */ } await Bun.sleep(150); } throw Error(`Timed out waiting for ${expression}`); },
    async key(key) { const vk: Record<string, number> = { Escape: 27, Enter: 13, ArrowRight: 39, ArrowDown: 40 };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: vk[key] ?? 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: vk[key] ?? 0 }); },
    async mouse(type, x, y) { await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 }); },
    wait: ms => Bun.sleep(ms), close() { socket.close(); } };
  await mini.viewport(WIDE, HEIGHT);
  await send("Page.navigate", { url });
  return mini;
}

async function readonly(page: Session, debugPort: number) {
  // The writer prepares its workspace first: three tabs, an own default, a closed tab.
  await factory(page);
  for (const id of DEFAULTS.slice(0, 3)) await newTab(page, id);
  await act(page, { kind: "tabs.saveAsDefault", tab: await tabNamed(page, "Eye makeup"), name: "My eye layout" }); await page.wait(600);
  await act(page, { kind: "tabs.close", tab: await tabNamed(page, "Expressions") }); await page.wait(800);
  await page.wait(1500);
  const reader = await secondPage(page, debugPort, `${origin}/?verify=1`);
  try {
    await reader.waitFor(READY, 120_000); await reader.wait(2500);
    await reader.evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Not now")?.click()`); await reader.wait(300);
    texts["readonly-state"] = await reader.evaluate(`({ tabs: ${P}.tabs.snapshot().tabs.map(t => t.name), banner: document.querySelector(".workspace-notice")?.innerText ?? null,
      add: { disabled: ${T}.add.disabled, ariaDisabled: ${T}.add.getAttribute("aria-disabled"), title: ${T}.add.title, label: ${T}.add.getAttribute("aria-label") } })`);
    const shoot = async (state: string, shows: string, selectors: string[], paired: string) => {
      const size = await reader.evaluate(`innerWidth`) as number;
      for (const value of ["light", "dark"] as const) {
        await reader.colorScheme(value);
        await reader.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`); await reader.wait(250);
        const rects = await reader.evaluate(`(() => { const rs = ${JSON.stringify(selectors)}.flatMap(s => [...document.querySelectorAll(s)]).filter(e => !e.hidden && !e.closest("[hidden]")).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
          if (!rs.length) return null; const x = Math.max(0, Math.min(...rs.map(r => r.left)) - 8), y = Math.max(0, Math.min(...rs.map(r => r.top)) - 8);
          return { x, y, width: Math.min(innerWidth, Math.max(...rs.map(r => r.right)) + 8) - x, height: Math.min(innerHeight, Math.max(...rs.map(r => r.bottom)) + 8) - y }; })()`) as Box | null;
        if (rects) { await reader.screenshot(join(out, `${state}-${value}-${size}.png`), rects); if (value === "light") shots.push({ name: `${state}-{light,dark}-${size}`, section: "readonly", size, shows, guide: paired }); }
      }
      await reader.colorScheme("light");
      await reader.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = "light"; r.style.colorScheme = "light"; })()`);
    };
    const closeReader = async () => { for (let i = 0; i < 3; i++) { await reader.key("Escape"); await reader.wait(120); } };
    const reasons = () => reader.evaluate(`[...document.querySelectorAll(".menu-layer .menu")].map(menu => [...menu.querySelectorAll(".menu-heading, .menu-sep, .menu-item")].map(e => e.classList.contains("menu-sep") ? "---" : e.classList.contains("menu-heading") ? "# " + e.textContent.trim() : (e.getAttribute("aria-disabled") === "true" ? "(unavailable) " : "") + e.textContent.trim().replace(/\\s+/g, " ")))`);
    for (const size of SIZES) {
      await reader.viewport(size, HEIGHT); await reader.wait(500);
      await shoot("readonly-window", "The whole read-only window: the notice that the workspace is open in another window (Use it here), the strip beneath the header, the dock below", ["body"], "lib-tab-strip");
      await shoot("readonly-strip", "U1 read-only window: the strip still shows every tab and switching works (not stored); + shows as unavailable", STRIP, "lib-tab-strip");
      // Switching works: pick another tab.
      const names = await reader.evaluate(`${P}.tabs.snapshot().tabs.map(t => t.name)`) as string[];
      await reader.evaluate(`(() => { const tab = [...document.querySelectorAll(".layout-tabs .dock-tab")].find(t => t.textContent.trim() === ${JSON.stringify(names[1] ?? names[0])}); tab?.click(); })()`); await reader.wait(500);
      texts[`readonly-switched-${size}`] = await reader.evaluate(`${P}.tabs.snapshot().shown`);
      await shoot("readonly-strip-switched", "U1 read-only window after switching tabs: the selection moved; the arrangement is not stored", STRIP, "lib-tab-strip");
      const id = await reader.evaluate(`${P}.tabs.snapshot().tabs[1]?.id ?? ${P}.tabs.snapshot().tabs[0].id`) as string;
      await reader.evaluate(`${T}.menu(${JSON.stringify(id)}, ${T}.strip.tab(${JSON.stringify(id)}))`); await reader.wait(350);
      texts[`readonly-menu-${size}`] = await reasons();
      await shoot("readonly-tab-menu", "U2 the tab menu in a read-only window: entries that apply but can't run show as unavailable with the window's reason; Reset and Close included", [...STRIP, ".menu-layer .menu"], "lib-menu-secondary");
      await openSubReader(reader, "Reset to default"); await reader.wait(300);
      texts[`readonly-reset-${size}`] = await reasons();
      await shoot("readonly-tab-menu-reset", "U2 Reset to default ▸ in a read-only window: every default shows unavailable with the reason", [...STRIP, ".menu-layer .menu"], "lib-menu-secondary");
      await closeReader();
      await reader.evaluate(`${T}.newMenu()`); await reader.wait(350);
      texts[`readonly-new-${size}`] = await reasons();
      await shoot("readonly-new-menu", "U3 New tab ▸ in a read-only window: every default unavailable with the reason", [...STRIP, ".menu-layer .menu"], "lib-menu-secondary");
      await closeReader();
      // Rename: refused in place (an announcement, no popover).
      await reader.evaluate(`${T}.rename(${JSON.stringify(id)})`); await reader.wait(350);
      texts[`readonly-rename-${size}`] = await reader.evaluate(`({ popover: !!document.querySelector(".popover"), status: document.querySelector(".status-bar")?.innerText ?? null, toasts: [...document.querySelectorAll(".toasts > *")].map(t => t.innerText), live: [...document.querySelectorAll("[aria-live]")].map(e => e.textContent.trim()).filter(Boolean) })`);
      await closeReader();
    }
    texts["console-reader"] = reader.console.filter(entry => entry.type === "error" || entry.type === "exception").slice(0, 20);
  } finally { reader.close(); }
}
async function openSubReader(reader: Mini, label: string) {
  await reader.evaluate(`(() => { [...document.querySelectorAll(".menu-layer .menu-item")].find(e => e.textContent.trim().replace(/\\s+/g, " ").startsWith(${JSON.stringify(label)}))?.focus(); })()`);
  await reader.key("ArrowRight");
}

// ---------------------------------------------------------------------------------------------------------------------
// Header

async function header(page: Session) {
  await factory(page);
  for (const id of DEFAULTS.slice(0, 2)) await newTab(page, id);
  for (const size of [640, NARROW, 1100, WIDE]) {
    await view(page, size, 500);
    texts[`header-${size}`] = await page.evaluate(`({ buttons: [...document.querySelectorAll(".shell-header button")].filter(b => b.getClientRects().length).map(b => ({ label: b.getAttribute("aria-label") ?? b.textContent.trim(), title: b.title })),
      layoutsButton: [...document.querySelectorAll(".shell-header button")].some(b => /layouts?\\b/i.test(b.getAttribute("aria-label") ?? "") || /^layouts?$/i.test(b.textContent.trim())) })`);
    await capture(page, "header", [".shell-header", ".layout-tabs"], `The header without the Layouts button, with the layout tab strip beneath it, at a ${size}px window`, { pad: 0, paired: "lib-tab-strip" });
  }
  await view(page, WIDE, 400);
  await capture(page, "workspace", [], "The whole workspace with its factory arrangement under the strip", { whole: true, section: "header" });
}

// ---------------------------------------------------------------------------------------------------------------------
// The style guide's matching entries

async function guide(page: Session) {
  await page.send("Page.navigate", { url: `${origin}/style-guide.html` });
  await page.waitFor(`!!document.getElementById("lib-tab-strip") && !!document.getElementById("c-context")`, 60_000);
  // The specimens are built by the page's module once it has loaded: wait until no placeholder is left.
  await page.waitFor(`!document.querySelector(".live-specimen[data-live] > p.note")`, 60_000).catch(() => { unreached.push({ state: "guide specimens", why: "some live specimens never replaced their placeholder" }); });
  await page.wait(800);
  // Item 3: the guide's own script runs (the live specimens are built) and no entry text swallowed the page; item 10: the tab-strip entry has its layout-tabs specimen.
  texts["guide-script-ran"] = await page.evaluate(`({ title: document.title, liveSpecimens: document.querySelectorAll(".live-specimen[data-live]").length, placeholdersLeft: document.querySelectorAll(".live-specimen[data-live] > p.note").length,
    entries: document.querySelectorAll("[id^=lib-], [id^=c-]").length, rawTitleTags: document.querySelectorAll("body title").length,
    tabStripSpecimen: (() => { const e = document.getElementById("lib-tab-strip"); return e ? { layoutTabsRows: e.querySelectorAll(".layout-tabs").length, tabs: e.querySelectorAll(".dock-tab").length, headings: [...e.querySelectorAll("h2, h3, h4, .specimen-label")].map(x => x.textContent.trim()).slice(0, 12) } : null; })() })`);
  const ids = [["lib-tab-strip", "Tab strip (U1: layout tabs)"], ["c-context", "Context menu"], ["lib-menu-secondary", "Menu row with secondary action (U2 and U3)"],
    ["lib-stage-tag", "Stage tag (the Early access tag in New tab)"], ["lib-choice-popover", "Choice popover (U4)"], ["c-choice-list", "Choice list"],
    ["c-popover", "Value popover (U5 Rename and Save as default)"], ["c-toasts", "Toasts (the Undo notice)"]] as const;
  texts["guide-present"] = await page.evaluate(`${JSON.stringify(ids.map(([id]) => id))}.map(id => [id, !!document.getElementById(id)])`);
  for (const size of SIZES) {
    await page.viewport(size, 1600); await page.wait(700);
    for (const [id, title] of ids) {
      const there = await page.evaluate(`!!document.getElementById(${JSON.stringify(id)})`);
      if (!there) { unreached.push({ state: `guide ${id}`, why: "the style guide has no element with this id" }); continue; }
      for (const value of ["light", "dark"] as const) {
        await scheme(page, value, true);
        // The entry's top sits 90 px below the window's top, clear of the guide's sticky header.
        const rect = await page.evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); scrollBy(0, el.getBoundingClientRect().top - 90); const r = el.getBoundingClientRect();
          return { x: Math.round(Math.max(0, r.left + scrollX - 4)), y: Math.round(Math.max(0, r.top + scrollY - 4)), width: Math.round(Math.min(r.width + 8, innerWidth)), height: Math.round(Math.min(r.height + 8, innerHeight - 90)) }; })()`) as Box;
        await page.wait(200);
        await page.screenshot(join(out, `guide-${id}-${value}-${size}.png`), rect);
        if (value === "light") shots.push({ name: `guide-${id}-{light,dark}-${size}`, section: "guide", size, shows: `Style guide: ${title}` });
      }
      await scheme(page, "light", true);
    }
    // The live choice popover specimen, open (opened after the scheme is set, so the guide's comparison rebuild can't leave a second one).
    for (const value of ["light", "dark"] as const) {
      await scheme(page, value, true);
      await page.evaluate(`(() => { const el = document.getElementById("lib-choice-popover"); scrollBy(0, el.getBoundingClientRect().top - 90); })()`); await page.wait(200);
      await press(page, `[...document.querySelectorAll("#lib-choice-popover button")].find(b => /New tab: Eye makeup/.test(b.textContent))`); await page.wait(500);
      const area = await clip(page, ["#lib-choice-popover .live-specimen", ".popover.choice-popover"], 6);
      await page.screenshot(join(out, `guide-lib-choice-popover-open-${value}-${size}.png`), area);
      if (value === "light") shots.push({ name: `guide-lib-choice-popover-open-{light,dark}-${size}`, section: "guide", size, shows: "Style guide: the Choice popover specimen opened (its live demo: V choice, Scene with a Share default, the sharing note, Cancel and Create)" });
      await page.key("Escape"); await page.wait(250); await press(page, `[...document.querySelectorAll(".popover.choice-popover button")].find(b => b.textContent.trim() === "Cancel")`); await page.wait(200);
    }
    await scheme(page, "light", true);
  }
}

if (want("strip")) await session("strip", strip);
if (want("menu")) await session("menu", tabMenu);
if (want("new")) await session("new", newMenuStates);
if (want("subst")) await session("subst", substitution);
if (want("close")) await session("close", closing);
if (want("naming")) await session("naming", naming);
if (want("readonly")) await session("readonly", readonly);
if (want("header")) await session("header", header);
if (want("guide")) await session("guide", guide);

/** Each run writes its own pair of files (named by its sections), so sections can be captured in separate runs and merged afterwards. */
const tag = (only ?? "all").replaceAll(",", "+");
writeFileSync(join(out, `run-${tag}.json`), JSON.stringify({ date: new Date().toISOString(), port, texts, unreached, errors }, null, 2));
writeFileSync(join(out, `shots-${tag}.json`), JSON.stringify(shots, null, 2));
console.log(`Wrote ${shots.length} capture sets (${tag}) to ${out}${Object.keys(errors).length ? `
ERRORS in: ${Object.keys(errors).join(", ")}` : ""}`);
