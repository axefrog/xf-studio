/**
 * P2-v's UI captures for the design review (README §3 rows U8 and U9, §13 "Verification hooks"): the Panels menu without modules (open,
 * a panel collapsed, a panel closed, Coming soon folded and unfolded with research tools on, absent with them off), the header without
 * Modules or Layouts and the `tabs.strip` guidance anchor, and feature focus per tab (a Poses tab offers no Surface controls while the 3D
 * view still draws the makeup; an Eye makeup tab offers its tools, Presets and Library). Every state is photographed light and dark at a
 * narrow and a wide window, with the style guide's matching entries (`d-summon`, `s-header`, `d-sizes`) at the same schemes and widths.
 *
 * States are reached in an isolated `?verify=1` workspace on a server of its own (a throwaway data folder holding a read-only copy of the
 * host's local settings, so the real 3D head prepares; never the person's library), in a headless Chrome with a throwaway profile, through
 * the real code paths and the verification hooks (`xfStudioShell`, `xfStudioPresentation`, `xfStudioTabFixtures`), never by changing the app.
 *
 *   bun experiments/044-profile-tabs/capture-p2-5.ts <data-dir> <out-dir> [port=4541] [--only <sections>] [--no-game]
 *
 * Sections (each gets its own server and Chrome, so none inherits another's state):
 *   panels   U8: the Panels menu in an Eye makeup tab (open, collapsed, collapsed and closed, closed), then Coming soon with research on
 *   header   U9: the header and the strip beneath it at both widths, the `tabs.strip` anchor
 *   focus    feature focus: an Eye makeup tab, a Poses tab on the same scene, and back
 *   status   the status bar with a ready head, after a tab switch and after a pane change (no setup refusal)
 *   names    view names in pane tabs, the Panels menu and the not-drawn state (one view, two numbered, a renamed one)
 *   guide    the style guide's matching entries (d-summon with feature groups and Early access tags, s-header, s-status, d-sizes)
 * `--no-game` starts from empty settings (no 3D head); the captures are meant to be made with the game's files.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../projects/xf-studio/authoring/tools/cdp";
import { localSettingsDirectory } from "../../projects/xf-studio/authoring/src/setup/host/local-settings-store";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const bare = (name: string) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const only = flag("--only"), noGame = bare("--no-game");
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun experiments/044-profile-tabs/capture-p2-5.ts <data-dir> <out-dir> [port] [--only <sections>] [--no-game]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4541);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = resolve(import.meta.dir, "..", "..", "projects", "xf-studio", "authoring");
const origin = `http://127.0.0.1:${port}`;
const NARROW = 900, WIDE = 1600, HEIGHT = 900, SIZES = [WIDE, NARROW];
const P = "window.xfStudioPresentation", S = "window.xfStudioShell";

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
  await page.wait(300);
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
    } else { texts[`missing-${state}-${size}`] = selectors; unreached.push({ state: `${state} at ${size}`, why: `nothing matched ${selectors.join(", ")}` }); }
  }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
  await scheme(page, "light", options.guide);
}

const menuText = (page: Session) => page.evaluate(`[...document.querySelectorAll(".menu-layer .menu")].map(menu => [...menu.querySelectorAll(".menu-heading, .menu-sep, .menu-item")].map(e =>
  e.classList.contains("menu-sep") ? "---" : e.classList.contains("menu-heading") ? "# " + e.textContent.trim().replace(/\\s+/g, " ") : (e.getAttribute("aria-disabled") === "true" ? "(unavailable) " : "") + (e.getAttribute("aria-checked") === "true" || e.getAttribute("aria-pressed") === "true" ? "[x] " : "") + e.textContent.trim().replace(/\\s+/g, " ") + (e.title ? " {title: " + e.title + "}" : "")))`);
/** Each open menu's box, and (for the top-level Panels menu) where its top edge sits against the Panels button's bottom edge. */
const menuFit = (page: Session) => page.evaluate(`(() => { const b = document.querySelector('.shell-header button[aria-label="Panels"]')?.getBoundingClientRect();
  return [...document.querySelectorAll(".menu-layer .menu")].map((m, i) => { const r = m.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), windowHeight: innerHeight, windowWidth: innerWidth, scrolls: m.scrollHeight > m.clientHeight + 1,
    ...(i === 0 && b ? { buttonBottom: Math.round(b.bottom), gapUnderButton: Math.round(r.top - b.bottom), topIsUnderButton: r.top >= b.bottom - 0.5 } : {}) }; }); })()`);
async function closeAll(page: Session) {
  for (let i = 0; i < 3 && await page.evaluate(`!!document.querySelector(".menu-layer .menu, .popover")`); i++) { await page.key("Escape"); await page.wait(150); }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
}
const act = (page: Session, action: Record<string, unknown>) => page.evaluate(`(() => { try { const r = ${P}.authoring.dispatch(${JSON.stringify(action)}); return JSON.stringify(r ?? "ok"); } catch (e) { return "refused: " + (e?.message ?? e); } })()`) as Promise<string>;
type TabInfo = { id: string; name: string; origin?: string };
const tabsOf = (page: Session) => page.evaluate(`${P}.tabs.snapshot()`) as Promise<{ tabs: TabInfo[]; shown: string }>;
const tabNamed = async (page: Session, name: string) => { const found = (await tabsOf(page)).tabs.find(tab => tab.name === name); if (!found) throw Error(`No tab named ${name}.`); return found.id; };
const newTab = async (page: Session, id: string) => { const r = await act(page, { kind: "tabs.new", default: id }); await page.wait(700); return r; };
const menuItem = (label: string) => `[...document.querySelectorAll(".menu-layer .menu-item")].find(e => e.textContent.trim().replace(/\\s+/g, " ").startsWith(${JSON.stringify(label)}))`;
/** Open the submenu of the menu entry labelled `label` (keyboard: focus it, then ArrowRight, as a person would). */
async function openSub(page: Session, label: string) {
  await page.evaluate(`(() => { const e = ${menuItem(label)}; e?.focus(); })()`);
  await page.key("ArrowRight"); await page.wait(400);
}
const headReady = `${P}.viewport.snapshot().head.phase === "ready"`;
const studio = async (page: Session) => {
  await page.waitFor(READY, 120_000); await page.wait(1_500);
  await press(page, `[...document.querySelectorAll("#preview-card .setup-card-actions button")].find(b => b.textContent.trim() === "Not now" && !b.closest("[hidden]") && b.getAttribute("aria-disabled") !== "true" && !b.disabled)`);
  await page.wait(300);
};
/** The 3D head prepared from the game's files in this throwaway workspace (about a minute the first time), then a short settle. */
async function head(page: Session) {
  if (noGame) return;
  await page.waitFor(headReady, 240_000);
  await page.wait(1_200);
}
/** The window width. A size class this workspace hasn't been in opens with the shown tab's own arrangement for it. */
async function view(page: Session, size: number, wait = 600) {
  await page.viewport(size, HEIGHT); await page.wait(wait);
  if (!noGame) await page.waitFor(headReady, 60_000).catch(() => { unreached.push({ state: `3D view at ${size}`, why: "the head was not ready 60 s after the resize" }); });
  await page.wait(400);
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
async function session(name: string, fn: (page: Session) => Promise<void>, size = WIDE) {
  const proc = await server();
  const debugPort = port + 5000 + (debugOffset++);
  try {
    const page = await launch(`${origin}/?verify=1`, { width: size, height: HEIGHT, scheme: "light", debugPort });
    try {
      await studio(page);
      await fn(page);
      texts[`console-${name}`] = page.console.filter(entry => entry.type === "error" || entry.type === "exception").slice(0, 20);
    } finally { await page.close(); }
  } catch (error) { errors[name] = String((error as Error)?.stack ?? error).slice(0, 2000); console.log(`FAILED ${name}: ${errors[name]}`); }
  finally { proc.kill(); await proc.exited; }
}
/** Give the 3D view the focus the way a person's pointer would (without editing): the view's tools follow the focused view. */
async function focusView(page: Session) {
  await page.evaluate(`(() => { const p = document.querySelector(".viewport-panel"); p?.focus(); p?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); })()`);
  await page.wait(500);
}
const toolsNow = (page: Session) => page.evaluate(`JSON.stringify({ filter: ${S}.runtime.toolFilter(),
  tools: ${S}.runtime.port.views.tools(undefined, ${S}.runtime.toolFilter()).map(t => ({ id: t.id, label: t.label, shown: t.shown, placement: t.placement, on: t.on })),
  toolbar: [...document.querySelectorAll(".viewport-tools button")].filter(b => !b.hidden).map(b => b.getAttribute("aria-label") || b.title),
  dockTabs: [...document.querySelectorAll(".dock-tab")].filter(t => !t.closest(".layout-tabs")).map(t => t.textContent.trim().replace(/\\s+/g, " ")) })`).then(v => JSON.parse(v as string));

// ---------------------------------------------------------------------------------------------------------------------
// U8: the Panels menu

async function panels(page: Session) {
  await head(page);
  await newTab(page, "eye-makeup/default"); await head(page);
  const dock = `${S}.dock`;
  const openMenu = async () => { await closeAll(page); await press(page, `document.querySelector('.shell-header button[aria-label="Panels"]')`); await page.wait(450); };
  const state = (id: string) => page.evaluate(`${dock}.panelState(${JSON.stringify(id)})`) as Promise<string>;
  const record = async (name: string, size: number) => { texts[`${name}-${size}`] = { menu: await menuText(page), fit: await menuFit(page), states: { layers: await state("layers"), history: await state("history"), uv: await state("uv") } }; };
  const cases: { state: string; shows: string; set?: () => Promise<void>; after?: () => Promise<void> }[] = [
    { state: "panels-open", shows: "U8 the Panels menu in an Eye makeup tab, research tools off: rows grouped by owner (shell panels first, then Eye makeup, Save Explorer, Expressions, Poses), checked for open panels, no module switches, no parked rows, no Coming soon" },
    { state: "panels-collapsed", shows: "U8 one panel group collapsed (the group holding Layers and History): both rows are checked and carry the Collapsed hint; the dock shows the collapsed group",
      set: async () => { await page.evaluate(`${dock}.toggleCollapse("layers")`); await page.wait(500); } },
    { state: "panels-collapsed-and-closed", shows: "U8 one group collapsed and a panel closed in the same tab (UV map): the closed row loses its check, the collapsed rows keep theirs with the Collapsed hint",
      set: async () => { await page.evaluate(`${dock}.close("uv")`); await page.wait(500); } },
    { state: "panels-closed", shows: "U8 a panel closed (Layers) with the group expanded again: the row is unchecked and the dock has no Layers tab",
      set: async () => { await page.evaluate(`${dock}.reveal("history")`); await page.wait(400); await page.evaluate(`${dock}.reveal("uv", false)`); await page.wait(400); await page.evaluate(`${dock}.close("layers")`); await page.wait(500); } },
  ];
  for (const size of SIZES) {
    await view(page, size, 700);
    texts[`panels-dock-at-${size}`] = { empty: await page.evaluate(`!!document.querySelector(".dock-empty")`), tabs: (await toolsNow(page)).dockTabs };
    for (const item of cases) {
      await closeAll(page);
      await item.set?.();
      await openMenu(); await record(item.state, size);
      await capture(page, item.state, [], item.shows, { whole: true, section: "panels", paired: "d-summon" });
      await closeAll(page);
    }
    // Choosing rows: a collapsed or open row, then a closed one, as the menu's contract says (collapsed row expands, open row closes, closed row opens).
    await page.evaluate(`${dock}.reveal("layers")`); await page.wait(400);
    const outcomes: Record<string, string> = { start: await state("layers") };
    await page.evaluate(`${dock}.toggleCollapse("layers")`); await page.wait(400); outcomes.collapsed = await state("layers");
    await openMenu(); await press(page, menuItem("Layers")); await page.wait(500); outcomes.afterChoosingCollapsedRow = await state("layers");
    await openMenu(); await press(page, menuItem("Layers")); await page.wait(500); outcomes.afterChoosingOpenRow = await state("layers");
    await openMenu(); await press(page, menuItem("Layers")); await page.wait(500); outcomes.afterChoosingClosedRow = await state("layers");
    texts[`panels-choosing-${size}`] = outcomes;
    // The same tab's other size class and other tabs are untouched: only this arrangement changed (the strip still shows the same tabs).
    texts[`panels-tabs-${size}`] = (await tabsOf(page)).tabs.map(t => t.name);
    await closeAll(page);
  }
  // Research tools on: Coming soon appears under the last section, folded; opened by keyboard it lists the planned modules and why they are unavailable.
  await act(page, { kind: "tabs.show", tab: await tabNamed(page, "Eye makeup") });
  for (const size of SIZES) {
    await view(page, size, 700);
    await page.evaluate(`(() => { ${S}.runtime.port.preferences.dispatch({ kind: "researchTools.set", enabled: true }); ${S}.runtime.changed(); })()`); await page.wait(700);
    texts[`panels-research-on-${size}`] = await page.evaluate(`${S}.preferences().researchTools`);
    await closeAll(page);
    await press(page, `document.querySelector('.shell-header button[aria-label="Panels"]')`); await page.wait(450);
    await record("panels-research-folded", size);
    await capture(page, "panels-research-coming-soon-folded", [], "U8 research tools on: Coming soon is the last entry, folded (a submenu), set apart by a separator", { whole: true, section: "panels", paired: "d-summon" });
    await openSub(page, "Coming soon");
    await record("panels-research-unfolded", size);
    await capture(page, "panels-research-coming-soon-unfolded", [], "U8 research tools on, Coming soon open (Right arrow): each planned module with its Soon tag, unavailable, with the reason it gives (Coming soon: …)", { whole: true, section: "panels", paired: "d-summon" });
    await closeAll(page);
    // Back off again: the same menu without it.
    await page.evaluate(`(() => { ${S}.runtime.port.preferences.dispatch({ kind: "researchTools.set", enabled: false }); ${S}.runtime.changed(); })()`); await page.wait(700);
    await press(page, `document.querySelector('.shell-header button[aria-label="Panels"]')`); await page.wait(450);
    await record("panels-research-off-again", size);
    await capture(page, "panels-research-off-again", [], "U8 research tools turned off again: Coming soon is gone from the menu (the same entries as the first capture, none about unavailable modules)", { whole: true, section: "panels", paired: "d-summon" });
    await closeAll(page);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// U9: the header

async function header(page: Session) {
  await head(page);
  await newTab(page, "eye-makeup/default"); await head(page);
  await newTab(page, "poses/default"); await head(page);
  await act(page, { kind: "tabs.show", tab: await tabNamed(page, "Eye makeup") }); await page.wait(600);
  for (const size of SIZES) {
    await view(page, size, 700);
    texts[`header-${size}`] = await page.evaluate(`({ buttons: [...document.querySelectorAll(".shell-header button")].filter(b => b.getClientRects().length).map(b => ({ label: b.getAttribute("aria-label") ?? b.textContent.trim(), title: b.title })),
      retired: [...document.querySelectorAll(".shell-header button, .layout-tabs button")].filter(b => /\\b(modules?|layouts?)\\b/i.test((b.getAttribute("aria-label") ?? "") + " " + b.textContent + " " + b.title) && !/layout tab|new tab|close|layout \\d/i.test(b.getAttribute("aria-label") ?? "")).map(b => b.getAttribute("aria-label") ?? b.textContent.trim()),
      crumbs: document.querySelector(".crumbs")?.innerText.replace(/\\n+/g, " > "), hasModulesButton: !!document.querySelector('[aria-label="Modules"]'), hasLayoutsButton: !!document.querySelector('.shell-header [aria-label="Layouts"], .shell-header [aria-label="Saved layouts"]'),
      headerOverflow: (() => { const h = document.querySelector(".shell-header"); return { scrollWidth: h.scrollWidth, clientWidth: h.clientWidth }; })() })`);
    texts[`anchor-tabs-strip-${size}`] = await page.evaluate(`({ state: ${S}.runtime.anchors.state("tabs.strip"), rect: ${S}.runtime.anchors.rect("tabs.strip") ?? null,
      isStrip: ${S}.runtime.anchors.element("tabs.strip")?.classList.contains("layout-tabs") ?? false,
      registered: ${S}.runtime.anchors.registered().filter(id => id.startsWith("header.") || id.startsWith("tabs.")), headerLayoutsAnchor: ${S}.runtime.anchors.element("header.layouts") ?? null })`);
    await capture(page, "header", [".shell-header", ".layout-tabs"], `U9 the header without Modules or Layouts at a ${size}px window, with the layout tab strip beneath it (Eye makeup tab shown)`, { pad: 0, section: "header", paired: "s-header" });
    // The anchor resolved: a marker laid over the element the tabs.strip anchor names, so the spotlight target can be seen (the guidance renders the same box).
    await page.evaluate(`(() => { const r = ${S}.runtime.anchors.rect("tabs.strip"); if (!r) return; const d = document.createElement("div"); d.id = "anchor-marker";
      d.style.cssText = "position:fixed;left:" + r.x + "px;top:" + r.y + "px;width:" + r.w + "px;height:" + r.h + "px;outline:3px solid #ff2d95;outline-offset:1px;pointer-events:none;z-index:99999"; document.body.append(d); })()`);
    await capture(page, "header-anchor-tabs-strip", [".shell-header", ".layout-tabs"], `U9 the box the tabs.strip guidance anchor resolves to, outlined in magenta (marker added by the capture only), at ${size}px`, { pad: 0, section: "header", paired: "s-header" });
    await page.evaluate(`document.getElementById("anchor-marker")?.remove()`);
    await capture(page, "header-window", [], `U9 the whole window at ${size}px for context`, { whole: true, section: "header", paired: "s-header" });
  }
  // The retired control's anchors are gone from the registry and the tour catalogue.
  texts["anchors-catalogue"] = await page.evaluate(`${S}.runtime.anchors.registered()`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Feature focus per tab

async function focus(page: Session) {
  await head(page);
  await newTab(page, "eye-makeup/default"); await head(page);
  const eye = await tabNamed(page, "Eye makeup");
  await newTab(page, "poses/default"); await head(page);
  const poses = await tabNamed(page, "Poses");
  texts["focus-tabs"] = (await tabsOf(page)).tabs.map(tab => tab.name);
  const show = async (id: string, name: string) => { await act(page, { kind: "tabs.show", tab: id }); await page.wait(900); await head(page); await focusView(page); texts[`focus-${name}-${(await page.evaluate("innerWidth"))}`] = await toolsNow(page); };
  for (const size of SIZES) {
    await view(page, size, 700);
    await show(eye, "eye-tab");
    await capture(page, "focus-eye-makeup-tab", [], "Feature focus: an Eye makeup tab: the 3D view's toolbar offers Surface controls (with the camera and idle tools), and the dock has Presets and Library with the editing panels", { whole: true, section: "focus" });
    await capture(page, "focus-eye-makeup-3d-view", [".viewport-panel"], "Feature focus: the Eye makeup tab's 3D view with its toolbar (Surface controls present) and the makeup on V", { section: "focus", pad: 0 });
    await show(poses, "poses-tab");
    await capture(page, "focus-poses-tab", [], "Feature focus: a Poses tab on the same scene: no Surface controls on the 3D view's toolbar (only the tools Poses and the platform offer), and the makeup still drawn on V", { whole: true, section: "focus" });
    await capture(page, "focus-poses-3d-view", [".viewport-panel"], "Feature focus: the Poses tab's 3D view with its toolbar (no Surface controls) and the makeup still drawn", { section: "focus", pad: 0 });
    await show(eye, "eye-tab-again");
    await capture(page, "focus-eye-makeup-tab-again", [], "Feature focus: back in the Eye makeup tab: Surface controls return, the same makeup is drawn and Presets and Library are as left", { whole: true, section: "focus" });
  }
  // Presets and Library are Eye makeup's: a Poses tab doesn't list them in its dock, and the Panels menu in that tab doesn't offer rows that aren't docked.
  for (const [name, id] of [["eye", eye], ["poses", poses]] as const) {
    await act(page, { kind: "tabs.show", tab: id }); await page.wait(900);
    texts[`focus-panels-menu-${name}`] = await page.evaluate(`${S}.panelsMenu().map(i => i.kind + ":" + (i.label ?? "") + (i.checked ? "*" : ""))`);
    texts[`focus-panel-states-${name}`] = await page.evaluate(`Object.fromEntries(["presets", "library", "layers", "uv", "poses.library", "history"].map(id => [id, ${S}.dock.panelState(id)]))`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Design-review fixes (p2-5b): the status bar, and view names

/** What the status bar says now, every tone on it, whether a setup refusal shows anywhere, and the activity log. */
const statusFacts = (page: Session) => page.evaluate(`(() => { const bar = document.querySelector(".status-bar"), message = bar?.querySelector(".status-message");
  return { text: bar?.innerText.replace(/\\s+/g, " ").trim(), messageTone: message?.dataset.tone ?? null, messageColour: message ? getComputedStyle(message).color : null,
    items: [...(bar?.querySelectorAll(".status-item") ?? [])].filter(e => !e.hidden).map(e => ({ tone: e.dataset.tone ?? e.dataset.phase ?? null, text: e.textContent.trim() })),
    refusalInStatusBar: /isn't showing/.test(bar?.innerText ?? ""), refusalAnywhere: /isn't showing/.test(document.body.innerText),
    log: ${S}.runtime.feedback.log.map(e => e.tone + ": " + e.message), head: ${P}.viewport.snapshot().head.phase }; })()`);
/** The 3D view panes that rest (not drawn now): their visible titles and buttons. */
const idlePanes = (page: Session) => page.evaluate(`[...document.querySelectorAll('.viewport-state[data-tone="idle"]')].filter(e => e.getClientRects().length).map(e => ({ title: e.querySelector(".viewport-idle-title")?.textContent, shows: e.querySelector(".viewport-idle-shows")?.textContent, button: e.querySelector("button")?.textContent.trim() }))`) as Promise<{ title: string; shows: string; button: string }[]>;
/** Every 3D view pane's dock tab and the names the Panels menu, the pane titles and the presentation port give them. */
const viewNames = (page: Session) => page.evaluate(`({ dockTabs: [...document.querySelectorAll(".dock-tab")].filter(t => !t.closest(".layout-tabs")).map(t => t.textContent.trim().replace(/\\s+/g, " ")),
  titles: ${P}.views.titles().map(t => t.panel + " = " + t.title),
  panelsMenu: ${S}.panelsMenu().filter(i => /3D view|Close-up|Side/.test(i.label ?? "")).map(i => i.label + (i.checked ? " [x]" : "")),
  idle: [...document.querySelectorAll('.viewport-state[data-tone="idle"]')].map(e => e.querySelector(".viewport-idle-title")?.textContent + " (aria: " + (e.closest("[aria-label]")?.getAttribute("aria-label") ?? e.getAttribute("aria-label") ?? "") + ")") })`);
/** Choose a dock tab by its visible name (as pressing it would). */
const pressPaneTab = (page: Session, name: string) => press(page, `[...document.querySelectorAll(".dock-tab")].filter(t => !t.closest(".layout-tabs")).find(t => t.textContent.trim().replace(/\\s+/g, " ") === ${JSON.stringify(name)})`);
/** Press the resting pane's "Show here" button: the window draws that view now. */
async function showHere(page: Session) {
  const pressed = await press(page, `[...document.querySelectorAll('.viewport-state[data-tone="idle"]')].filter(e => e.getClientRects().length).map(e => e.querySelector("button")).find(Boolean)`);
  await page.wait(600);
  if (!noGame) await page.waitFor(headReady, 90_000).catch(() => { unreached.push({ state: "3D view after Show here", why: "the head was not ready 90 s after Show here" }); });
  await page.wait(700);
  return pressed;
}
const addView = (page: Session, title?: string) => page.evaluate(`JSON.stringify(window.xfStudioAddView(${title ? JSON.stringify(title) : ""}) ?? null)`) as Promise<string>;

async function status(page: Session) {
  await head(page);
  const first = (await tabsOf(page)).shown;
  texts["status-tabs-start"] = (await tabsOf(page)).tabs.map(t => t.name);
  await newTab(page, "eye-makeup/default"); await head(page);
  const second = (await tabsOf(page)).shown;
  texts["status-added-view"] = await addView(page, "Side view"); await page.wait(900); await head(page);
  const snap = async (state: string, shows: string, size: number) => {
    texts[`status-${state}-${size}`] = await statusFacts(page);
    await capture(page, `status-${state}`, [".status-bar"], shows, { pad: 6, section: "status", paired: "s-status" });
    await capture(page, `status-${state}-window`, [], shows + " (the whole window)", { whole: true, section: "status", paired: "s-status" });
  };
  for (const size of SIZES) {
    await view(page, size, 700);
    await act(page, { kind: "tabs.show", tab: second }); await page.wait(900); await head(page);
    await snap("ready-head", `Status bar with a ready head at ${size}px (Ready, no setup refusal, no orange line)`, size);
    await act(page, { kind: "tabs.show", tab: first }); await page.wait(900); await head(page);
    await snap("after-tab-switch", `Status bar after switching to another tab and its head is ready, at ${size}px`, size);
    await act(page, { kind: "tabs.show", tab: second }); await page.wait(900); await head(page);
    await snap("after-switch-back", `Status bar after switching back, at ${size}px`, size);
    const resting = await idlePanes(page);
    texts[`status-idle-before-pane-change-${size}`] = resting;
    if (!resting.length) { await pressPaneTab(page, "Side view"); await page.wait(600); }
    texts[`status-idle-after-opening-${size}`] = await idlePanes(page);
    texts[`status-show-here-${size}`] = await showHere(page);
    await snap("after-pane-change", `Status bar after a pane change (Show here on the resting 3D view pane, which the window now draws), at ${size}px`, size);
    // Another pane change: the first view's pane again.
    const names = (await viewNames(page)).dockTabs.filter((n: string) => /3D view|Side view/.test(n));
    texts[`status-view-tabs-${size}`] = names;
    const other = (await idlePanes(page)).length ? null : names.find((n: string) => n !== names[0]);
    if (other) { await pressPaneTab(page, other); await page.wait(500); await showHere(page); await snap("after-second-pane-change", `Status bar after a second pane change, at ${size}px`, size); }
  }
}

async function names(page: Session) {
  await head(page);
  texts["names-tabs-start"] = (await tabsOf(page)).tabs.map(t => t.name);
  await newTab(page, "eye-makeup/default"); await head(page);
  const one = (await tabsOf(page)).shown;
  await newTab(page, "eye-makeup/default"); await head(page);
  const two = (await tabsOf(page)).shown;
  texts["names-added-two"] = await addView(page); await page.wait(900); await head(page);
  await newTab(page, "eye-makeup/default"); await head(page);
  const renamed = (await tabsOf(page)).shown;
  texts["names-added-renamed"] = await addView(page, "Close-up"); await page.wait(900); await head(page);
  const states: [string, string, string][] = [
    [one, "one-view", "a tab with one 3D view: its pane tab reads \"3D view\""],
    [two, "two-views", "a tab with two 3D views: numbered within the tab (3D view 1, 3D view 2)"],
    [renamed, "renamed-view", "a tab with two 3D views, one renamed Close-up: the renamed view keeps its name, the other is numbered within the tab (3D view 1)"],
  ];
  for (const size of SIZES) {
    await view(page, size, 700);
    for (const [id, key, what] of states) {
      await act(page, { kind: "tabs.show", tab: id }); await page.wait(900); await head(page);
      texts[`names-${key}-${size}`] = await viewNames(page);
      await closeAll(page);
      await capture(page, `names-${key}-pane-tabs`, [], `View names: ${what}, in the pane tabs (the whole window at ${size}px)`, { whole: true, section: "names" });
      await press(page, `document.querySelector('.shell-header button[aria-label="Panels"]')`); await page.wait(450);
      texts[`names-${key}-menu-${size}`] = { menu: await menuText(page), fit: await menuFit(page) };
      await capture(page, `names-${key}-panels-menu`, [], `View names: ${what}, in the Panels menu at ${size}px (its top edge under the Panels button)`, { whole: true, section: "names", paired: "d-summon" });
      await closeAll(page);
      // A resting pane: choose the other view's pane tab in this tab, so its not-drawn state shows its name.
      const titles = (await viewNames(page)).dockTabs.filter((n: string) => /^3D view|^Close-up/.test(n));
      let resting = await idlePanes(page);
      if (!resting.length && titles.length > 1) {
        for (const name of titles) { await pressPaneTab(page, name); await page.wait(500); resting = await idlePanes(page); if (resting.length) break; }
      }
      texts[`names-${key}-resting-${size}`] = resting;
      if (resting.length) await capture(page, `names-${key}-not-drawn`, ['.viewport-state[data-tone="idle"]'], `View names: ${what}: the resting pane's not-drawn state names its view (${resting.map(r => r.title).join(", ")}) at ${size}px`, { section: "names", pad: 16 });
      else if (key !== "one-view") unreached.push({ state: `names ${key} not-drawn at ${size}`, why: "no resting 3D view pane was visible" });
      if (resting.length) await capture(page, `names-${key}-not-drawn-window`, [], `View names: ${what}: the not-drawn state in the whole window at ${size}px`, { whole: true, section: "names" });
    }
  }
  // The tab with one view, drawn from another tab's view: its title when shown as a resting pane in a second window size is covered above.
}

// ---------------------------------------------------------------------------------------------------------------------
// The style guide's matching entries

async function guide(page: Session) {
  await page.send("Page.navigate", { url: `${origin}/style-guide.html` });
  await page.waitFor(`!!document.getElementById("d-summon") && !!document.getElementById("s-header") && !!document.getElementById("d-sizes")`, 60_000);
  await page.waitFor(`!document.querySelector(".live-specimen[data-live] > p.note")`, 60_000).catch(() => { unreached.push({ state: "guide specimens", why: "some live specimens never replaced their placeholder" }); });
  await page.wait(800);
  const ids = [["d-summon", "Summoning panels (U8: the Panels menu), with feature groups and Early access tags"], ["s-status", "Status bar"], ["s-header", "Application header (U9)"], ["d-sizes", "Size classes and default layouts (U9)"]] as const;
  texts["guide-state"] = await page.evaluate(`({ title: document.title, liveSpecimens: document.querySelectorAll(".live-specimen[data-live]").length, placeholdersLeft: document.querySelectorAll(".live-specimen[data-live] > p.note").length,
    entries: ${JSON.stringify(ids.map(([id]) => id))}.map(id => { const e = document.getElementById(id); return { id, present: !!e, heading: e?.querySelector("h2, h3")?.textContent.trim() ?? null, mentionsModules: /\\bModules\\b/.test(e?.innerText ?? ""), mentionsLayoutsButton: /Layouts button|Saved layouts/.test(e?.innerText ?? "") }; }) })`);
  for (const size of SIZES) {
    await page.viewport(size, 1600); await page.wait(700);
    for (const [id, title] of ids) {
      if (!await page.evaluate(`!!document.getElementById(${JSON.stringify(id)})`)) { unreached.push({ state: `guide ${id}`, why: "the style guide has no element with this id" }); continue; }
      for (const value of ["light", "dark"] as const) {
        await scheme(page, value, true);
        const rect = await page.evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); scrollBy(0, el.getBoundingClientRect().top - 90); const r = el.getBoundingClientRect();
          return { x: Math.round(Math.max(0, r.left + scrollX - 4)), y: Math.round(Math.max(0, r.top + scrollY - 4)), width: Math.round(Math.min(r.width + 8, innerWidth)), height: Math.round(Math.min(r.height + 8, innerHeight - 90)) }; })()`) as Box;
        await page.wait(250);
        await page.screenshot(join(out, `guide-${id}-${value}-${size}.png`), rect);
        if (value === "light") shots.push({ name: `guide-${id}-{light,dark}-${size}`, section: "guide", size, shows: `Style guide: ${title}` });
      }
      await scheme(page, "light", true);
    }
  }
}

if (want("panels")) await session("panels", panels);
if (want("header")) await session("header", header);
if (want("focus")) await session("focus", focus);
if (want("status")) await session("status", status);
if (want("names")) await session("names", names);
if (want("guide")) await session("guide", guide);

/** Each run writes its own pair of files (named by its sections), so sections can be captured in separate runs and merged afterwards. */
const tag = (only ?? "all").replaceAll(",", "+");
writeFileSync(join(out, `run-${tag}.json`), JSON.stringify({ date: new Date().toISOString(), port, texts, unreached, errors }, null, 2));
writeFileSync(join(out, `shots-${tag}.json`), JSON.stringify(shots, null, 2));
console.log(`Wrote ${shots.length} capture sets (${tag}) to ${out}${Object.keys(errors).length ? `
ERRORS in: ${Object.keys(errors).join(", ")}` : ""}`);
