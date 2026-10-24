/**
 * Design-review captures for polish batch 3 (the polish-2 design-review follow-ups): live app states in an isolated `?verify=1`
 * workspace on a server of its own (its own throwaway data folder, so its own library and settings, never the person's), in a headless
 * Chrome with a throwaway profile, light and dark, at a narrow and a wide window; and the style guide's matching specimens beside them.
 *
 *   bun experiments/polish-3/capture-polish3.ts <data-dir> <out-dir> [port=4391] [--only <sections>]
 *
 * Sections (each gets its own server and Chrome, so none inherits another's state):
 *   header      the library chip short and long, the verification label before the chip, Package's label giving way (640 to 1,600 px)
 *   library     Library's Files help and Recent drafts rows, Help's "Saving and your library" topic and its links
 *   failed      a backup that failed (a write error): the notice, its button order and the recovery export
 *   full        a backup that failed because storage is full: the notice that names the next step
 *   restoring   a slow restore, safe (Try again, Use restored) and unsafe (Try again, Export this window's copy)
 *   kept        a window that kept the workspace after a handover couldn't save
 *   guide-link  the interface guide opened from Help: it closes its own tab; a direct visit says "XF Studio site"
 *   guide       the style guide's specimens for the same entries
 *
 * States are reached through the real code paths, with the page's own storage and transport steered by an init script (the plumbing of
 * `experiments/038-profiles-spikes/tools/polish-2-captures.ts`), never by changing the app. The delayed ("still being backed up") state
 * is only produced by the desktop host's background copy, which the localhost server doesn't have: it is shown by the guide's specimen.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../projects/xf-studio/authoring/tools/cdp";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const only = flag("--only");
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun experiments/polish-3/capture-polish3.ts <data-dir> <out-dir> [port] [--only <sections>]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4391);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = resolve(import.meta.dir, "..", "..", "projects", "xf-studio", "authoring");
const origin = `http://127.0.0.1:${port}`;
const NARROW = 900, WIDE = 1600, TIGHT = 640;

/**
 * The page's storage and transport, steered per tab by sessionStorage:
 *   xfs-capture: "hang" (a library save never answers and never arrives), "lose" (it arrives, its answer never does), "fail" (HTTP 500).
 *   xfs-capture-full: "1" (the outbox's storage is full: QuotaExceededError), "deny" (it can't be written: SecurityError).
 */
const INIT = `(() => {
  const real = window.fetch.bind(window), mode = () => sessionStorage.getItem("xfs-capture") ?? "";
  window.__xfsHeld = [];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url, m = mode();
    if (/\\/documents\\/transact$/.test(url)) {
      if (m === "hang") { window.__xfsHeld.push(String(init?.body ?? "")); return new Promise(() => {}); }
      if (m === "lose") { real(input, init).catch(() => {}); return new Promise(() => {}); }
      if (m === "fail") return Promise.resolve(new Response(JSON.stringify({ error: "Saved documents are unavailable right now." }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }
    return real(input, init);
  };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && String(key).startsWith("xfs.outbox.")) {
      const full = sessionStorage.getItem("xfs-capture-full");
      if (full === "1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      if (full === "deny") throw new DOMException("The storage is not allowed.", "SecurityError");
    }
    return set.call(this, key, value);
  };
})();`;

const READY = `!!document.querySelector(".history-controls button") && !!window.xfStudioShell`;
const byLabel = (label: string) => `[...document.querySelectorAll("button")].find(b => !b.closest("[hidden]") && (b.getAttribute("aria-label") === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}))`;
const press = (page: Session, find: string) => page.evaluate(`(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`);
const setMode = (page: Session, mode: string, full = "") => page.evaluate(`(() => { sessionStorage.setItem("xfs-capture", ${JSON.stringify(mode)});
  sessionStorage.setItem("xfs-capture-full", ${JSON.stringify(full)}); })()`);
const noticeState = (page: Session) => page.evaluate(`(() => { const n = document.querySelector(".workspace-notice"); const s = document.querySelector('.status-bar [data-tone="restoring"]');
  return { notice: n && !n.hidden ? n.querySelector(".workspace-notice-text")?.textContent ?? n.textContent : null, status: s && !s.hidden ? s.textContent : null,
    buttons: n ? [...n.querySelectorAll("button")].filter(b => !b.hidden && !b.closest("[hidden]")).map(b => ({ label: b.textContent.trim(), title: b.title })) : [] }; })()`) as Promise<Record<string, unknown>>;
const addLayer = async (page: Session) => {
  await page.evaluate(`window.xfStudioShell.dock.reveal("layers")`); await page.wait(250);
  if (!(await press(page, byLabel("Add layer")))) throw Error("No Add layer button.");
};
const studio = async (page: Session) => { await page.waitFor(READY, 90_000); await page.wait(1_500); await press(page, byLabel("Not now")); };
const reload = async (page: Session) => { await page.send("Page.reload", { ignoreCache: false }); await page.wait(300); await page.waitFor(READY, 90_000); };
const until = async (page: Session, ready: string, timeout = 30_000) => { const start = Date.now(); await page.waitFor(ready, timeout); return Date.now() - start; };
const clip = async (page: Session, selectors: string[], pad = 6) => await page.evaluate(`(() => {
  const rects = ${JSON.stringify(selectors)}.flatMap(s => [...document.querySelectorAll(s)]).filter(e => e && !e.hidden && !e.closest("[hidden]")).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.min(...rects.map(r => r.left)) - ${pad}), y = Math.max(0, Math.min(...rects.map(r => r.top)) - ${pad});
  const right = Math.min(innerWidth, Math.max(...rects.map(r => r.right)) + ${pad}), bottom = Math.min(innerHeight, Math.max(...rects.map(r => r.bottom)) + ${pad});
  return { x: x + scrollX, y: y + scrollY, width: right - x, height: bottom - y };
})()`) as { x: number; y: number; width: number; height: number };
const scheme = async (page: Session, value: "light" | "dark", guide = false) => {
  await page.colorScheme(value);
  await page.evaluate(guide ? `document.querySelector('[data-theme-choice="${value}"]')?.click()`
    : `(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
  await page.wait(250);
};

type Shot = { name: string; section: string; size: number; shows: string };
const shots: Shot[] = [], texts: Record<string, unknown> = {};

/** One look at the page as it is now, light and dark: the clip of `selectors`, named `<state>-<scheme>-<size>`. */
async function capture(page: Session, state: string, selectors: string[], shows: string,
  options: { hover?: string; pad?: number; guide?: boolean; keepToasts?: boolean; section?: string; before?: string; hoverWait?: number } = {}) {
  if (options.before) { await page.evaluate(options.before); await page.wait(500); }
  if (!options.keepToasts) await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 10_000).catch(() => {});
  const size = await page.evaluate(`innerWidth`) as number;
  for (const value of ["light", "dark"] as const) {
    await scheme(page, value, options.guide);
    if (options.hover) {
      const at = await page.evaluate(`(() => { const e = ${options.hover}; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number] | null;
      if (at) { await page.mouse("mouseMoved", at[0], at[1], { button: "none", buttons: 0 }); await page.wait(options.hoverWait ?? 250); }
    }
    const area = await clip(page, selectors, options.pad);
    if (area.width > 0 && area.height > 0) {
      await page.screenshot(join(out, `${state}-${value}-${size}.png`), area);
      if (value === "light") shots.push({ name: `${state}-{light,dark}-${size}`, section: options.section ?? state.split("-")[0]!, size, shows });
    } else texts[`missing-${state}-${size}`] = selectors;
  }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
  await scheme(page, "light", options.guide);
}
/** `capture` at each window width. */
async function atSizes(page: Session, sizes: number[], height: number, state: string, selectors: string[], shows: string, options: Parameters<typeof capture>[4] = {}) {
  for (const size of sizes) {
    await page.viewport(size, height); await page.wait(500);
    await capture(page, state, selectors, shows, options);
  }
}

async function server() {
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  const proc = Bun.spawn([process.execPath, "server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off" } });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ } await Bun.sleep(250); }
  return proc;
}
let debugOffset = 0;
/** A fresh server and Chrome for one section group: `fn` gets the page; whatever it throws is recorded, and both are always stopped. */
async function session(name: string, size: number, fn: (page: Session, debugPort: number) => Promise<void>) {
  const proc = await server();
  const debugPort = port + 5000 + (debugOffset++);
  try {
    const page = await launch(`${origin}/?verify=1`, { width: size, height: 900, scheme: "light", init: INIT, debugPort });
    try {
      await studio(page);
      await fn(page, debugPort);
      texts[`console-${name}`] = page.console.filter(entry => entry.type === "error" || entry.type === "exception").slice(0, 20);
    } finally { await page.close(); }
  } catch (error) { errors[name] = String((error as Error)?.stack ?? error).slice(0, 2000); }
  finally { proc.kill(); await proc.exited; }
}
const errors: Record<string, string> = {};

/** How much of each header item shows: its text, and whether it is cut short. */
const headerFit = (page: Session) => page.evaluate(`(() => { const q = s => document.querySelector(s);
  const fit = e => e && e.getClientRects().length ? { text: e.textContent.trim(), left: Math.round(e.getBoundingClientRect().left), width: Math.round(e.getBoundingClientRect().width), clipped: e.scrollWidth > e.clientWidth + 1 } : null;
  return { fit: q(".shell-header")?.dataset.fit ?? "", category: fit(q(".shell-header .category span")), collection: fit(q(".shell-header .crumb-collection")), preset: fit(q(".shell-header .crumb-preset")),
    verify: fit(q(".shell-header .verify-flag")), chip: fit(q(".shell-header .chip")),
    actions: [...document.querySelectorAll(".shell-header .header-actions .btn")].filter(b => b.getClientRects().length).map(b => ({ label: b.getAttribute("aria-label") ?? b.textContent.trim(), text: b.textContent.trim(), title: b.title, width: Math.round(b.getBoundingClientRect().width) })) }; })()`);

/** A realistic collection and preset name, so the crumbs have something to keep. */
async function realisticNames(page: Session) {
  await page.evaluate(`(() => { const rt = window.xfStudioShell.runtime; const draft = rt.port.library.summary().draft;
    rt.dispatch({ kind: "collection.rename", name: "Night market set" });
    rt.dispatch({ kind: "preset.edit", command: { kind: "rename", id: draft.selected, name: "Chrome dusk glow" } }); })()`);
  await page.wait(800);
}

async function header(page: Session) {
  await realisticNames(page);
  await palette(page, "default-palette", "The command palette filtered to Export this window's copy in a healthy workspace (nothing to recover)");
  const chipIs = (word: string) => page.waitFor(`[...document.querySelectorAll(".shell-header .chip")].some(c => c.textContent.trim().startsWith(${JSON.stringify(word)}))`, 30_000).catch(() => {});
  const sizes = [TIGHT, NARROW, 1100, 1280, WIDE];
  const state = async (label: string, shows: string) => {
    for (const size of sizes) {
      await page.viewport(size, 900); await page.wait(500);
      texts[`header-${label}-${size}`] = await headerFit(page);
      await capture(page, `header-${label}`, [".shell-header"], shows, { pad: 0 });
    }
  };
  // The chip starts at No version yet (short), the verification label sits before its slot.
  await state("1-no-version", "The header before any version: the verification label, then the library chip (short: No version yet)");
  if (!(await press(page, byLabel("Save version")))) throw Error("No Save version button.");
  await chipIs("Saved"); await page.wait(400);
  await state("2-saved", "The header after Save version: the chip says Saved");
  await addLayer(page); await chipIs("Changed since"); await page.wait(400);
  // Package's tooltip: hover it at the wide width and keep whatever the app shows.
  await page.viewport(WIDE, 900); await page.wait(400);
  texts["header-package-title"] = await page.evaluate(`document.querySelector(".header-package")?.title ?? null`);
  texts["header-package-fits"] = await page.evaluate(`(() => [...document.querySelectorAll(".header-package")].map(b => ({ text: b.textContent.trim(), shown: b.getClientRects().length > 0 })))()`);
  await capture(page, "header-package-hover", [".shell-header .header-package", ".help-bubble:not([hidden])", "[role=tooltip]:not([hidden])"], "Package with the pointer over it (a native title tooltip, if the app draws none, isn't in a screenshot: its text is in run.json)",
    { hover: `document.querySelector(".header-package")`, hoverWait: 1200, pad: 30, section: "header" });
  await state("3-changed", "The header after an edit: the longest chip, Changed since last version, with the verification label before it; Package's label gives way first at narrow widths");
}

/** Help's panel, with the Saving topic open, or scrolled to its links (a window resize may bring another tab forward, so each capture reveals it again). */
const OPEN_SAVING = `(() => { window.xfStudioShell.dock.reveal("help"); const d = [...document.querySelectorAll(".help-topic")].find(t => t.querySelector("summary")?.textContent === "Saving and your library");
  if (d) { d.open = true; d.scrollIntoView({ block: "center" }); } })()`;
const OPEN_LINKS = `(() => { window.xfStudioShell.dock.reveal("help"); document.querySelector(".help-interface-guide")?.scrollIntoView({ block: "center" }); })()`;
async function library(page: Session) {
  // Save as new collection while the starter has no version: the copy is saved, and the starter stays a recent draft with Reopen.
  await page.evaluate(`window.xfStudioShell.dock.reveal("library")`); await page.wait(400);
  await press(page, byLabel("Save as new collection"));
  await page.waitFor(`!!document.querySelector(".toasts .toast")`, 15_000).catch(() => {});
  await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 15_000).catch(() => {});
  await page.evaluate(`window.xfStudioShell.dock.reveal("library")`); await page.wait(600);
  texts["library-rows"] = await page.evaluate(`(() => [...document.querySelectorAll(".record-row")].map(r => ({ name: r.querySelector(".record-name")?.textContent, meta: r.querySelector(".record-meta")?.textContent,
    action: [...r.querySelectorAll("button")].filter(b => !b.hidden).map(b => ({ text: b.textContent.trim(), title: b.title })) })))()`);
  texts["library-hints"] = await page.evaluate(`[...document.querySelectorAll(".panel-content .hint, .panel-content .note, .panel-content .muted, .panel-content [data-hint]")]
    .map(e => e.textContent.trim()).filter(t => /separate copy|Recent drafts|back it up/i.test(t))`);
  texts["library-files-help"] = await page.evaluate(`(() => { const t = document.body.innerText; const i = t.indexOf("separate copy"); return i < 0 ? null : t.slice(Math.max(0, i - 80), i + 200); })()`);
  await atSizes(page, [TIGHT, NARROW, WIDE], 1000, "library-panel", [".dock-group:has(.record-list)"], "Library: Files help (a separate copy, or to share) and Recent drafts rows reading Draft · no version yet with Reopen",
    { before: `window.xfStudioShell.dock.reveal("library")` });
  // The help tips beside the Files and Recent drafts headings.
  const tipOf = (heading: string) => `[...document.querySelectorAll("section.section")].filter(s => s.getClientRects().length && s.textContent.trim().toLowerCase().startsWith(${JSON.stringify(heading.toLowerCase())}))
    .map(s => s.querySelector(".help-tip")).find(Boolean)`;
  for (const [id, heading] of [["files", "Files"], ["drafts", "Recent drafts"]] as const) {
    const before = `(() => { window.xfStudioShell.dock.reveal("library"); document.querySelectorAll("[data-capture-tip]").forEach(e => e.removeAttribute("data-capture-tip")); const t = ${tipOf(heading)}; t?.setAttribute("data-capture-tip", ""); t?.scrollIntoView({ block: "center" }); })()`;
    await page.evaluate(before); await page.wait(400);
    texts[`library-${id}-help`] = await page.evaluate(`${tipOf(heading)}?.dataset.help ?? null`);
    await atSizes(page, [TIGHT, NARROW, WIDE], 1000, `library-${id}-help-tip`, [".help-bubble:not([hidden])", "[data-capture-tip]"],
      `Library: the help tip beside ${heading} (${id === "files" ? "a separate copy, or to share" : "Draft · no version yet"})`, { before, hover: tipOf(heading), hoverWait: 700, pad: 24 });
  }

  await page.evaluate(OPEN_SAVING); await page.wait(500);
  texts["help-saving-topic"] = await page.evaluate(`[...document.querySelectorAll(".help-topic")].find(t => t.querySelector("summary")?.textContent === "Saving and your library")?.querySelector(".help-topic-body")?.textContent`);
  await atSizes(page, [TIGHT, NARROW, WIDE], 1000, "help-saving-topic", [".dock-group:has(.help-topic[open])"], "Help: the Saving and your library topic (separate copy, Recent drafts)", { before: OPEN_SAVING });
  await atSizes(page, [TIGHT, WIDE], 1000, "help-links", [".dock-group:has(.help-links)"], "Help › More help: the Interface guide link", { before: OPEN_LINKS });
}

/** The command palette filtered to the recovery export: whether it lists "Export this window's copy" in the state the page is in. */
async function palette(page: Session, state: string, shows: string) {
  await page.key("k", { modifiers: 2 }); await page.wait(500);
  await page.type("export this window"); await page.wait(500);
  texts[state] = await page.evaluate(`[...document.querySelectorAll(".palette-item")].map(i => ({ text: i.textContent.trim(), disabled: i.getAttribute("aria-disabled") }))`);
  await atSizes(page, [NARROW, WIDE], 900, state, [".palette"], shows, { section: "palette" });
  await page.key("Escape"); await page.wait(300);
}

/** The notice for a backup that failed: `full` "deny" (a write error) or "1" (storage full). */
async function backupFailure(page: Session, state: string, full: string, shows: string, exportCheck: boolean) {
  await setMode(page, "hang", full);
  await addLayer(page);
  await page.wait(800);
  await until(page, `!!document.querySelector(".workspace-notice:not([hidden])")`, 15_000).catch(() => 0);
  texts[`${state}`] = await noticeState(page);
  const copy = `[...document.querySelectorAll(".workspace-notice button")].find(b => b.textContent.trim() === "Export this window's copy")`;
  await atSizes(page, [NARROW, WIDE], 900, state, [".shell-header", ".workspace-notice"], shows);
  await atSizes(page, [NARROW, WIDE], 900, `${state}-export-hover`, [".workspace-notice"], "The same notice with the pointer over Export this window's copy (the tooltip itself is a native one: its text is in run.json)", { hover: copy });
  await palette(page, `${state}-palette`, "The command palette filtered to Export this window's copy while the backup has failed: it is listed");
  if (exportCheck) {
    // The recovery export itself: it writes a file and says so.
    const folder = join(out, "..", "export-check");
    rmSync(folder, { recursive: true, force: true });
    await page.downloadTo(folder);
    await press(page, copy);
    await page.wait(2_000);
    texts[`${state}-export-file`] = existsSync(folder) ? readdirSync(folder).map(name => ({ name, bytes: statSync(join(folder, name)).size })) : [];
    texts[`${state}-export-toast`] = await page.evaluate(`[...document.querySelectorAll(".toasts .toast")].map(t => t.textContent)`);
    rmSync(folder, { recursive: true, force: true });
  }
  await setMode(page, "");
}

async function restoring(page: Session) {
  // Safe: the change never reached the library, so Use restored is offered.
  await setMode(page, "hang");
  await addLayer(page); await page.wait(800);
  await reload(page);
  await until(page, `!!document.querySelector('.status-bar [data-tone="restoring"]:not([hidden])')`, 10_000).catch(() => 0);
  await until(page, `!!document.querySelector(".workspace-notice:not([hidden])")`, 20_000).catch(() => 0);
  texts["restoring-safe"] = await noticeState(page);
  await atSizes(page, [NARROW, WIDE], 900, "restoring-safe", [".shell-header", ".workspace-notice"], "A slow restore where it is safe to keep working: Try again, then Use restored");
  await setMode(page, "");
  await press(page, byLabel("Try again"));
  await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 30_000).catch(() => {});
  await page.wait(1_000);
  // Unsafe: the library took the change but its answer never arrived, so the page can't tell whether to keep working on it.
  await setMode(page, "lose");
  await addLayer(page); await page.wait(2_500);
  await setMode(page, "hang");
  await reload(page);
  await until(page, `!!document.querySelector(".workspace-notice:not([hidden])")`, 20_000).catch(() => 0);
  texts["restoring-unsafe"] = await noticeState(page);
  const copy = `[...document.querySelectorAll(".workspace-notice button")].find(b => b.textContent.trim() === "Export this window's copy")`;
  await atSizes(page, [NARROW, WIDE], 900, "restoring-unsafe", [".shell-header", ".workspace-notice"], "A slow restore where it isn't safe to keep working: Try again, then Export this window's copy");
  await atSizes(page, [NARROW, WIDE], 900, "restoring-unsafe-export-hover", [".workspace-notice"], "The unsafe restore with the pointer over Export this window's copy", { hover: copy });
  await setMode(page, "");
}

/** A second tab's page session (as polish-2-captures.ts). */
async function attach(debugPort: number, targetId: string, width: number): Promise<Session> {
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as { id: string; webSocketDebuggerUrl: string }[];
  const entry = list.find(item => item.id === targetId);
  if (!entry) throw Error("The second tab isn't listed.");
  const socket = new WebSocket(entry.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0;
  const pending = new Map<number, { ok(value: any): void; fail(error: Error): void }>();
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); const found = message.id && pending.get(message.id);
    if (found) { pending.delete(message.id); if (message.error) found.fail(Error(message.error.message)); else found.ok(message.result); } };
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => { const next = ++id; pending.set(next, { ok, fail }); socket.send(JSON.stringify({ id: next, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  const session = {
    send, console: [], on() {}, async chooseFiles() {}, async downloadTo() {},
    async evaluate(expression: string) { const result = await send<any>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; },
    async screenshot(path: string, area?: { x: number; y: number; width: number; height: number }) {
      const result = await send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(area ? { clip: { ...area, scale: 1 } } : {}) });
      writeFileSync(path, Buffer.from(result.data, "base64")); },
    async viewport(w: number, h: number) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async colorScheme(value: "light" | "dark") { await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }); },
    async mouse(type: string, x: number, y: number, options: { button?: string; buttons?: number } = {}) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: options.button ?? "left", buttons: options.buttons ?? 0, clickCount: type === "mouseMoved" ? 0 : 1 }); },
    async drag() {}, async key() {}, async type() {}, wait: (ms: number) => Bun.sleep(ms),
    async waitFor(expression: string, timeout = 30_000) { const start = Date.now();
      while (Date.now() - start < timeout) { try { const value = await session.evaluate(expression); if (value) return value; } catch { /* loading */ } await Bun.sleep(150); }
      throw Error(`Timed out waiting for ${expression}`); },
    async close() { socket.close(); },
  };
  return session as unknown as Session;
}
const targets = async (debugPort: number) => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as { id: string; type: string; url: string }[]).filter(t => t.type === "page");

async function kept(page: Session, debugPort: number) {
  const target = await page.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const second = await attach(debugPort, target.targetId, NARROW);
  try {
    await second.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
    await second.send("Page.navigate", { url: `${origin}/?verify=1` });
    await second.waitFor(READY, 90_000); await second.wait(1_500);
    const front = async (tab: Session) => { await tab.send("Page.bringToFront"); await tab.wait(120); };
    await front(page);
    await setMode(page, "hang");
    await addLayer(page);
    await page.wait(600);
    await front(second);
    await press(second, byLabel("Use it here"));
    for (let i = 0; i < 40; i++) {
      await front(second); const other = await noticeState(second);
      await front(page); const holder = await noticeState(page);
      if (String(other.notice ?? "").startsWith("Waiting") && String(holder.notice ?? "").startsWith("Handing")) break;
    }
    await front(page);
    await setMode(page, "fail");
    await until(page, `document.querySelector(".workspace-notice-text")?.textContent.includes("couldn't be saved")`, 40_000).catch(() => 0);
    texts["kept"] = await noticeState(page);
    const copy = `[...document.querySelectorAll(".workspace-notice button")].find(b => b.textContent.trim() === "Export this window's copy")`;
    await atSizes(page, [NARROW, WIDE], 900, "kept", [".shell-header", ".workspace-notice"], "This window kept the workspace after a handover that couldn't save: Try again, then Export this window's copy");
    await atSizes(page, [NARROW, WIDE], 900, "kept-export-hover", [".workspace-notice"], "The kept notice with the pointer over Export this window's copy", { hover: copy });
  } finally { await second.close(); await page.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {}); }
  await setMode(page, "");
}

/** The interface guide as Help opens it, and as a direct visit shows it. */
async function guideLink(page: Session, debugPort: number) {
  await page.evaluate(`window.xfStudioShell.dock.reveal("help")`); await page.wait(600);
  const before = (await targets(debugPort)).map(t => t.id);
  const studioUrl = await page.evaluate(`location.href`) as string;
  await page.evaluate(`document.querySelector(".help-interface-guide")?.scrollIntoView({ block: "center" })`); await page.wait(200);
  const at = await page.evaluate(`(() => { const r = document.querySelector(".help-interface-guide").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number];
  await page.mouse("mousePressed", at[0], at[1], { button: "left", buttons: 1 }); await page.mouse("mouseReleased", at[0], at[1], { button: "left", buttons: 0 });
  let opened: { id: string; url: string } | undefined;
  for (let i = 0; i < 60 && !opened; i++) { opened = (await targets(debugPort)).find(t => !before.includes(t.id)); if (!opened) await Bun.sleep(250); }
  if (!opened) throw Error("Help's Interface guide opened no tab.");
  texts["guide-link-opened"] = { url: opened.url };
  const tab = await attach(debugPort, opened.id, NARROW);
  try {
    await tab.waitFor(`document.readyState === "complete" && !!document.querySelector(".guide-back")`, 30_000); await tab.wait(800);
    await tab.waitFor(`document.querySelector(".guide-back span")?.textContent === "Back to XF Studio"`, 10_000).catch(() => {});
    texts["guide-link-studio"] = await tab.evaluate(`(() => { const a = document.querySelector(".guide-back"); return { text: a.textContent.trim(), title: a.title, href: a.getAttribute("href"), opener: !!window.opener }; })()`);
    await atSizes(tab, [NARROW, WIDE], 1000, "guide-link-from-studio", [".guide-top"], "The guide as Help opened it: the top bar says Back to XF Studio", { guide: true, pad: 0, section: "guide-link" });
    // Click it: the tab closes, and the verification workspace it came from is untouched.
    const back = await tab.evaluate(`(() => { const r = document.querySelector(".guide-back").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number];
    await tab.mouse("mousePressed", back[0], back[1], { button: "left", buttons: 1 }); await tab.mouse("mouseReleased", back[0], back[1], { button: "left", buttons: 0 });
    let closed = false;
    for (let i = 0; i < 20 && !closed; i++) { await Bun.sleep(250); closed = !(await targets(debugPort)).some(t => t.id === opened!.id); }
    texts["guide-link-click"] = { tabClosed: closed, studioUrlBefore: studioUrl, studioUrlAfter: await page.evaluate(`location.href`), studioStillVerification: await page.evaluate(`location.search.includes("verify=1")`),
      studioTabs: (await targets(debugPort)).map(t => t.url) };
  } finally { await tab.close(); }
  // A direct visit (the published site's link, a bookmark): it names the site and links to it.
  const direct = await page.send<{ targetId: string }>("Target.createTarget", { url: `${origin}/style-guide.html` });
  const visit = await attach(debugPort, direct.targetId, NARROW);
  try {
    await visit.waitFor(`document.readyState === "complete" && !!document.querySelector(".guide-back")`, 30_000); await visit.wait(800);
    texts["guide-link-direct"] = await visit.evaluate(`(() => { const a = document.querySelector(".guide-back"); return { text: a.textContent.trim(), title: a.title, href: a.getAttribute("href") }; })()`);
    await atSizes(visit, [NARROW, WIDE], 1000, "guide-link-direct", [".guide-top"], "The guide opened directly (the site's link): the top bar says XF Studio site", { guide: true, pad: 0, section: "guide-link" });
  } finally { await visit.close(); await page.send("Target.closeTarget", { targetId: direct.targetId }).catch(() => {}); }
  // A copied or bookmarked Studio-opened URL (?from=studio, but nothing opened it): no handshake answers, so it keeps the site link.
  const copied = await page.send<{ targetId: string }>("Target.createTarget", { url: `${origin}/style-guide.html?from=studio` });
  const bookmark = await attach(debugPort, copied.targetId, NARROW);
  try {
    await bookmark.waitFor(`document.readyState === "complete" && !!document.querySelector(".guide-back")`, 30_000); await bookmark.wait(1_500);
    texts["guide-link-bookmark"] = await bookmark.evaluate(`(() => { const a = document.querySelector(".guide-back"); return { text: a.textContent.trim(), title: a.title, href: a.getAttribute("href"), opener: !!window.opener }; })()`);
    await atSizes(bookmark, [NARROW, WIDE], 1000, "guide-link-bookmark", [".guide-top"], "A copied Studio-opened URL (?from=studio) opened by nothing: it still says XF Studio site, and clicking it doesn't close the tab", { guide: true, pad: 0, section: "guide-link" });
    // Its link isn't clicked: it goes to the site's root, which would load a second Studio in this tab.
    texts["guide-link-bookmark-tab"] = { stillListed: (await targets(debugPort)).some(t => t.id === copied.targetId) };
  } finally { await bookmark.close(); await page.send("Target.closeTarget", { targetId: copied.targetId }).catch(() => {}); }
}

/** The style guide's specimens for the same entries, beside the live states. */
async function guide(page: Session) {
  await page.send("Page.navigate", { url: `${origin}/style-guide.html` });
  await page.waitFor(`document.readyState === "complete" && !!document.getElementById("s-header")`, 30_000); await page.wait(800);
  for (const size of [NARROW, WIDE]) {
    await page.viewport(size, 1500); await page.wait(500);
    for (const id of ["s-header", "lib-workspace-notice", "t-unprotected", "t-recovering", "c-chips", "t-saved", "lib-record-list", "r-terms"]) {
      await page.evaluate(`document.getElementById(${JSON.stringify(id)})?.scrollIntoView({ block: "start" })`); await page.wait(300);
      const has = await page.evaluate(`!!document.querySelector("#${id} .specimen")`);
      await capture(page, `guide-${id}`, [has ? `#${id} .specimen` : `#${id}`], `Style guide ${id}: ${has ? "specimen" : "the entry"}`, { guide: true, section: "guide", pad: 10 });
    }
  }
  texts["guide-r-terms"] = await page.evaluate(`[...document.querySelectorAll("#r-terms dt, #r-terms th, #r-terms td")].map(e => e.textContent.trim()).filter(t => /^(Version N|Draft|Backed up)/.test(t) || /Version N|Draft ·/.test(t)).slice(0, 12)`);
  texts["guide-notice-texts"] = await page.evaluate(`[...document.querySelectorAll("#lib-workspace-notice .workspace-notice-text, #t-unprotected .workspace-notice-text, #t-recovering .workspace-notice-text")].map(e => e.textContent.trim())`);
}

const run = Date.now();
if (want("header")) await session("header", WIDE, header);
if (want("library")) await session("library", WIDE, library);
if (want("failed")) await session("failed", WIDE, page => backupFailure(page, "failed-backup", "deny", "A backup that failed (a write error): the sentence says what could happen; Try again, then Export this window's copy", true));
if (want("full")) await session("full", WIDE, page => backupFailure(page, "storage-full", "1", "Storage is full: the notice names the next step (free up some space, then try again) and keeps Try again before Export this window's copy", false));
if (want("restoring")) await session("restoring", WIDE, restoring);
if (want("kept")) await session("kept", WIDE, kept);
if (want("guide-link")) await session("guide-link", WIDE, guideLink);
if (want("guide")) await session("guide", WIDE, guide);

writeFileSync(join(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), seconds: Math.round((Date.now() - run) / 1000), port, shots, texts, errors }, null, 1));
rmSync(data, { recursive: true, force: true });
console.log(JSON.stringify({ out, shots: shots.length, errors }, null, 1));
process.exit(0);
