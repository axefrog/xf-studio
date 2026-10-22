/**
 * Captures for polish batch 2, the profiles phase 1 UI follow-ups (`local/reviews/ui-review-profiles-p1.md` conditions and items 7–12;
 * ledger UI-187, UI-188 and UI-189): live app states in an isolated `?verify=1` workspace on a server of its own (its own throwaway data
 * folder, so its own library and settings, never the person's), in a headless Chrome with a throwaway profile, light and dark, at a
 * narrow and a wide window; and the style guide's specimens beside them.
 *
 *   bun tools/polish-2-captures.ts <data-dir> <out-dir> [port=4397] [--tag before|after] [--only <sections>] [--root <authoring dir>]
 *
 * Sections: header (1,100, 1,280 and 1,440 px, with and without the verification label, and the narrow window), library (the save toast,
 * the open row, Recent drafts and the palette's Reopen), conflict, restoring, unprotected, lease (kept, read-only fade), help, guide.
 * `--tag` prefixes every file, so "before" and "after" sit side by side. States are reached through the real code paths, with the page's
 * own storage and transport steered by an init script (see ui-review-2-captures.ts, whose plumbing this reuses), never by changing the app.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../../projects/xf-studio/authoring/tools/cdp";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const rootArg = flag("--root"), only = flag("--only"), tag = flag("--tag") ?? "after";
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun tools/polish-2-captures.ts <data-dir> <out-dir> [port] [--tag before|after] [--only <sections>]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4397);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = rootArg ? resolve(rootArg) : resolve(import.meta.dir, "..", "..", "..", "projects", "xf-studio", "authoring");
const origin = `http://127.0.0.1:${port}`;

/** The page's storage and transport, steered per tab by `sessionStorage["xfs-capture"]` (as ui-review-2-captures.ts). */
const INIT = `(() => {
  const real = window.fetch.bind(window), mode = () => sessionStorage.getItem("xfs-capture") ?? "";
  window.__xfsHeld = [];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url, m = mode();
    if (/\\/documents\\/transact$/.test(url)) {
      if (m === "hang") { window.__xfsHeld.push(String(init?.body ?? "")); return new Promise(() => {}); }
      if (m === "fail") return Promise.resolve(new Response(JSON.stringify({ error: "Saved documents are unavailable right now." }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }
    return real(input, init);
  };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && String(key).startsWith("xfs.outbox.") && sessionStorage.getItem("xfs-capture-full") === "1")
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return set.call(this, key, value);
  };
})();`;

const READY = `!!document.querySelector(".history-controls button") && !!window.xfStudioShell`;
const byLabel = (label: string) => `[...document.querySelectorAll("button")].find(b => !b.closest("[hidden]") && (b.getAttribute("aria-label") === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}))`;
const press = (page: Session, find: string) => page.evaluate(`(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`);
const setMode = (page: Session, mode: string, full = false) => page.evaluate(`(() => { sessionStorage.setItem("xfs-capture", ${JSON.stringify(mode)});
  sessionStorage.setItem("xfs-capture-full", ${JSON.stringify(full ? "1" : "0")}); })()`);
const noticeState = (page: Session) => page.evaluate(`(() => { const n = document.querySelector(".workspace-notice"); const s = document.querySelector('.status-bar [data-tone="restoring"]');
  const ready = document.querySelector(".status-bar .status-message");
  return { notice: n && !n.hidden ? n.querySelector(".workspace-notice-text")?.textContent ?? n.textContent : null, status: s && !s.hidden ? s.textContent : null,
    activity: ready && !ready.hidden ? ready.textContent : null,
    buttons: n ? [...n.querySelectorAll("button")].filter(b => !b.hidden && !b.closest("[hidden]")).map(b => b.textContent.trim()) : [] }; })()`) as Promise<Record<string, unknown>>;
const addLayer = async (page: Session) => {
  await page.evaluate(`window.xfStudioShell.dock.reveal("layers")`); await page.wait(250);
  if (!(await press(page, byLabel("Add layer")))) throw Error("No Add layer button.");
};
const studio = async (page: Session) => { await page.waitFor(READY, 90_000); await page.wait(1_500); await press(page, byLabel("Not now")); };
const reload = async (page: Session) => { await page.send("Page.reload", { ignoreCache: false }); await page.wait(300); await page.waitFor(READY, 90_000); };
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
const until = async (page: Session, ready: string, timeout = 30_000) => { const start = Date.now(); await page.waitFor(ready, timeout); return Date.now() - start; };

type Shot = { name: string; section: string; width: string; shows: string };
const shots: Shot[] = [], texts: Record<string, unknown> = {};

async function capture(page: Session, state: string, width: string, selectors: string[], shows: string,
  options: { hover?: string; pad?: number; guide?: boolean; keepToasts?: boolean } = {}) {
  if (!options.keepToasts) await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 10_000).catch(() => {});
  for (const value of ["light", "dark"] as const) {
    await scheme(page, value, options.guide);
    if (options.hover) {
      const at = await page.evaluate(`(() => { const r = (${options.hover}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number];
      await page.mouse("mouseMoved", at[0], at[1], { button: "none", buttons: 0 });
      await page.wait(250);
    }
    const area = await clip(page, selectors, options.pad);
    if (area.width > 0 && area.height > 0) {
      const name = `${tag}-${state}-${value}-${width}`;
      await page.screenshot(join(out, `${name}.png`), area);
      if (value === "light") shots.push({ name: `${tag}-${state}-{light,dark}-${width}`, section: state, width, shows });
    } else texts[`missing-${state}-${width}`] = selectors;
  }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
  await scheme(page, "light", options.guide);
}

/** How much of each header item shows: its text, and whether it is cut short. */
const headerFit = (page: Session) => page.evaluate(`(() => { const q = s => document.querySelector(s);
  const fit = e => e && e.getClientRects().length ? { text: e.textContent.trim(), width: Math.round(e.getBoundingClientRect().width), clipped: e.scrollWidth > e.clientWidth + 1 } : null;
  return { category: fit(q(".shell-header .category span")), collection: fit(q(".shell-header .crumb-collection")), preset: fit(q(".shell-header .crumb-preset")),
    chip: fit(q(".shell-header .chip")), verify: fit(q(".shell-header .verify-flag")),
    actions: [...document.querySelectorAll(".shell-header .header-actions .btn")].filter(b => b.getClientRects().length).map(b => ({ label: b.getAttribute("aria-label") ?? b.textContent.trim(), text: b.textContent.trim(), width: Math.round(b.getBoundingClientRect().width) })) }; })()`);

async function server() {
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  const proc = Bun.spawn([process.execPath, "server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off" } });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ } await Bun.sleep(250); }
  return proc;
}

/** Names that show what the crumbs keep: a realistic collection and preset name. */
async function realisticNames(page: Session) {
  await page.evaluate(`(() => { const rt = window.xfStudioShell.runtime; const draft = rt.port.library.summary().draft;
    rt.dispatch({ kind: "collection.rename", name: "Night market set" });
    rt.dispatch({ kind: "preset.edit", command: { kind: "rename", id: draft.selected, name: "Chrome dusk glow" } }); })()`);
  await page.wait(800);
}

async function header(page: Session) {
  await setMode(page, "");
  await realisticNames(page);
  if (!(await press(page, byLabel("Save version")))) throw Error("No Save version button.");
  await page.waitFor(`[...document.querySelectorAll(".shell-header .chip")].some(c => c.textContent.trim() === "Saved")`, 30_000).catch(() => {});
  await addLayer(page);
  await page.waitFor(`[...document.querySelectorAll(".shell-header .chip")].some(c => c.textContent.includes("Changed since"))`, 15_000).catch(() => {});
  for (const width of [1100, 1280, 1440]) {
    await page.viewport(width, 900); await page.wait(500);
    texts[`header-${width}-flag`] = await headerFit(page);
    await capture(page, `header-${width}-flag`, String(width), [".shell-header"], `The live header at ${width} px with the verification label: Save version and "Changed since last version"`, { pad: 0 });
    await page.evaluate(`document.head.insertAdjacentHTML("beforeend", '<style id="no-flag">.verify-flag { display: none !important; }</style>')`);
    // The label is hidden by a style here, not by the app, so the header is fitted again the way a window resize does.
    await page.viewport(width - 1, 900); await page.wait(150); await page.viewport(width, 900); await page.wait(300);
    texts[`header-${width}-noflag`] = await headerFit(page);
    await capture(page, `header-${width}-noflag`, String(width), [".shell-header"], `The live header at ${width} px as a normal workspace shows it (no verification label)`, { pad: 0 });
    await page.evaluate(`document.getElementById("no-flag")?.remove()`);
  }
}

/** Where the header's things sit: Save version's left edge, the category whole or icon-only, the stages given way, the chip's slot. */
const headerPlaces = (page: Session) => page.evaluate(`(() => { const h = document.querySelector(".shell-header"), save = h.querySelector(".header-save");
  const category = h.querySelector(".category"), name = category.querySelector("span");
  return { saveLeft: Math.round(save.getBoundingClientRect().left * 10) / 10, saveWidth: Math.round(save.getBoundingClientRect().width), fit: h.dataset.fit ?? "",
    category: { width: Math.round(category.getBoundingClientRect().width), name: name.textContent, iconOnly: (h.dataset.fit ?? "").split(" ").includes("category"),
      clipped: name.getBoundingClientRect().width > 2 && name.scrollWidth > name.clientWidth + 1, accessible: category.title },
    chip: h.querySelector(".chip").textContent, slot: Math.round(h.querySelector(".chip-slot").getBoundingClientRect().width),
    collection: h.querySelector(".crumb-collection").getClientRects().length ? Math.round(h.querySelector(".crumb-collection").getBoundingClientRect().width) : 0,
    preset: Math.round(h.querySelector(".crumb-preset").getBoundingClientRect().width) }; })()`) as Promise<Record<string, unknown>>;

/**
 * Round 2 (design fixes 1 and 2): at 1,100, 1,280 and 1,440 px, with and without the verification label, the header before an edit
 * (Saved), after an edit (Changed since last version) and after Save version (Saved), with Save version's left edge in each.
 */
async function headerStates(page: Session) {
  await setMode(page, "");
  await realisticNames(page);
  const chipIs = (word: string) => page.waitFor(`[...document.querySelectorAll(".shell-header .chip")].some(c => c.textContent.trim().startsWith(${JSON.stringify(word)}))`, 30_000).catch(() => {});
  const save = async () => { if (!(await press(page, byLabel("Save version")))) throw Error("No Save version button."); await chipIs("Saved"); await page.wait(400); };
  await save();
  const places: Record<string, unknown> = {};
  for (const width of [1100, 1280, 1440]) for (const flag of [true, false]) {
    await page.viewport(width, 900); await page.wait(300);
    if (!flag) await page.evaluate(`document.head.insertAdjacentHTML("beforeend", '<style id="no-flag">.verify-flag { display: none !important; }</style>')`);
    // A resize fits the header again (the label above is hidden by a style here, not by the app).
    await page.viewport(width - 1, 900); await page.wait(150); await page.viewport(width, 900); await page.wait(400);
    const name = `${width}-${flag ? "flag" : "noflag"}`, row: Record<string, unknown> = {};
    row.beforeEdit = await headerPlaces(page);
    await capture(page, `header-${name}-1-before-edit`, String(width), [".shell-header"], `${width} px${flag ? " with the verification label" : ""}: before an edit (Saved)`, { pad: 0 });
    await addLayer(page); await chipIs("Changed since"); await page.wait(400);
    row.afterEdit = await headerPlaces(page);
    await capture(page, `header-${name}-2-after-edit`, String(width), [".shell-header"], `${width} px${flag ? " with the verification label" : ""}: after an edit (Changed since last version)`, { pad: 0 });
    await save();
    row.afterSave = await headerPlaces(page);
    await capture(page, `header-${name}-3-after-save`, String(width), [".shell-header"], `${width} px${flag ? " with the verification label" : ""}: after Save version (Saved)`, { pad: 0 });
    const lefts = [row.beforeEdit, row.afterEdit, row.afterSave].map(item => (item as { saveLeft: number }).saveLeft);
    row.saveVersionMoved = Math.max(...lefts) - Math.min(...lefts);
    places[name] = row;
    await page.evaluate(`document.getElementById("no-flag")?.remove()`);
  }
  texts["header-states"] = places;
}

async function run(width: "narrow" | "wide", size: number) {
  const proc = await server();
  const debugPort = port + 5000 + (width === "wide" ? 1 : 0);
  try {
    const page = await launch(`${origin}/?verify=1`, { width: size, height: 900, scheme: "light", init: INIT, debugPort });
    try {
      await studio(page);
      if (want("header-states") && width === "wide") { await headerStates(page); await page.viewport(size, 900); await page.wait(300); }
      if (want("header")) {
        if (width === "wide") { await header(page); await page.viewport(size, 900); await page.wait(300); }
        else {
          await realisticNames(page);
          texts[`header-${size}`] = await headerFit(page);
          await capture(page, "header-narrow", width, [".shell-header"], "The header in a narrow window", { pad: 0 });
        }
      }

      if (want("library")) {
        // Save as new collection while the starter has no version: the copy is saved (its toast is the save toast), and the starter stays
        // a recent draft with Reopen.
        await page.evaluate(`window.xfStudioShell.dock.reveal("library")`); await page.wait(400);
        await press(page, byLabel("Save as new collection"));
        await page.waitFor(`!!document.querySelector(".toasts .toast")`, 15_000).catch(() => {});
        await page.wait(300);
        texts[`save-toast-${width}`] = await page.evaluate(`[...document.querySelectorAll(".toasts .toast")].map(t => t.textContent)`);
        await capture(page, "save-toast", width, [".toasts .toast"], "The save toast without the edge-case sentence", { keepToasts: true });
        await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 15_000).catch(() => {});
        await page.evaluate(`window.xfStudioShell.dock.reveal("library")`); await page.wait(600);
        texts[`library-${width}`] = await page.evaluate(`(() => { const rows = [...document.querySelectorAll(".record-row")];
          return rows.map(r => ({ name: r.querySelector(".record-name")?.textContent, meta: r.querySelector(".record-meta")?.textContent,
            action: [...r.querySelectorAll("button")].filter(b => !b.hidden).map(b => ({ text: b.textContent.trim(), title: b.title, disabled: b.getAttribute("aria-disabled") })) })); })()`);
        await capture(page, "library-panel", width, [".panel-content:has(.record-list)"], "Library: the open row has no faded Open; Recent drafts rows say Reopen");
        // The palette's entry for the same action.
        await page.key("k", { modifiers: 2 }); await page.wait(400);
        await page.type("reopen"); await page.wait(400);
        texts[`palette-reopen-${width}`] = await page.evaluate(`[...document.querySelectorAll(".palette-item")].map(i => i.textContent)`);
        await capture(page, "palette-reopen", width, [".palette"], "The command palette: Reopen previous collection");
        await page.key("Escape"); await page.wait(200);
      }

      if (want("restoring")) {
        await setMode(page, "hang");
        await addLayer(page);
        await page.wait(800);
        await reload(page);
        await until(page, `!!document.querySelector('.status-bar [data-tone="restoring"]:not([hidden])')`, 10_000).catch(() => 0);
        texts[`restoring-status-${width}`] = await noticeState(page);
        await capture(page, "restoring-status-bar", width, [".status-bar"], "Restoring's first seconds in the status bar: no \"Ready\" beside it (condition 5)");
        await until(page, `!!document.querySelector(".workspace-notice:not([hidden])")`, 15_000).catch(() => 0);
        texts[`restoring-long-${width}`] = await noticeState(page);
        await capture(page, "restoring-long", width, [".workspace-notice"], "Restoring taking a while: the workspace notice, now a library component");
        await setMode(page, "");
        await press(page, byLabel("Try again"));
        await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 30_000).catch(() => {});
      }

      if (want("unprotected")) {
        await setMode(page, "hang", true);
        await addLayer(page);
        await page.wait(800);
        await until(page, `!!document.querySelector(".workspace-notice:not([hidden])")`, 10_000).catch(() => {});
        texts[`unprotected-${width}`] = await noticeState(page);
        await capture(page, "unprotected", width, [".workspace-notice"], "Changes not protected: the sentence says what could happen");
        await setMode(page, "");
        await press(page, byLabel("Try again"));
        await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 10_000).catch(() => {});
        await reload(page); await page.wait(1_500);
      }

      if (want("conflict")) {
        await page.evaluate(`window.xfStudioShell.dock.reveal("presets")`);
        await page.wait(400);
        await setMode(page, "hang");
        await page.evaluate(`window.__xfsHeld.length = 0`);
        await addLayer(page);
        await page.wait(800);
        const held = await page.evaluate(`window.__xfsHeld.at(-1)`) as string;
        const request = JSON.parse(held) as { command: string; writes: { kind: string; id: string; base: number; value: any }[] };
        const writes = request.writes.filter(write => write.kind.includes("look")).map(write => ({ ...write, value: { ...write.value, name: "Smoky glow" } }));
        const answer = await (await fetch(`${origin}/api/verification/documents/transact`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({ id: `other-window-${crypto.randomUUID()}`, command: request.command, writes }) })).json() as { ok: boolean };
        if (!answer.ok) throw Error("The other window's write was refused.");
        await setMode(page, "");
        await reload(page);
        await page.evaluate(`window.xfStudioShell.dock.reveal("presets")`);
        await until(page, `!!document.querySelector(".doc-conflict:not([hidden])")`, 30_000);
        await page.wait(400);
        texts[`conflict-preset-${width}`] = await page.evaluate(`[...document.querySelectorAll(".doc-conflict:not([hidden])")].map(n => ({ text: n.querySelector(".doc-conflict-text").textContent,
          buttons: [...n.querySelectorAll("button")].filter(b => !b.hidden).map(b => ({ label: b.textContent, title: b.title })) }))`);
        await capture(page, "conflict-preset", width, [".doc-conflicts", ".panel-head"], "A conflict on a preset: \"(its name: …)\" and Use other window's",
          { hover: `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent.startsWith("Use"))` });
        await press(page, `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent.startsWith("Use"))`);
        await page.wait(400);
        texts[`confirm-other-${width}`] = await page.evaluate(`(() => { const p = document.querySelector(".confirm-popover"); return p && { message: p.querySelector(".popover-message").textContent,
          buttons: [...p.querySelectorAll("button")].map(b => b.textContent), focused: document.activeElement?.textContent }; })()`);
        await capture(page, "confirm-use-other", width, [".doc-conflicts", ".confirm-popover"], "Use other window's asks first");
        await page.key("Escape");
        await press(page, `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent === "Keep both")`);
        await until(page, `!document.querySelector(".doc-conflict:not([hidden])")`, 20_000).catch(() => {});
      }

      if (want("lease")) {
        const target = await page.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
        const second = await attach(debugPort, target.targetId, size);
        try {
          await second.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
          await second.send("Page.navigate", { url: `${origin}/?verify=1` });
          await second.waitFor(READY, 90_000); await second.wait(1_500);
          // The read-only fade, on the finish tiles.
          await second.evaluate(`window.xfStudioShell.dock.reveal("finish")`); await second.wait(800);
          texts[`read-only-fade-${width}`] = await second.evaluate(`(() => { const t = document.querySelector('.finish-option[aria-disabled="true"], [aria-disabled="true"].finish-option, .finish-grid [aria-disabled="true"]');
            return t ? { opacity: getComputedStyle(t).opacity, color: getComputedStyle(t).color } : null; })()`);
          await capture(second, "read-only-finish", width, [".panel-content:has(.finish-option)"], "A read-only window: the finish tiles' fade (.7, was .45)");
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
          await until(page, `document.querySelector(".workspace-notice-text")?.textContent.includes("couldn't be saved")`, 40_000).catch(() => {});
          texts[`kept-${width}`] = await noticeState(page);
          await capture(page, "kept", width, [".workspace-notice"], "This window kept the workspace: Try again and Export collection (condition 1)");
        } finally { await second.close(); }
        await setMode(page, "");
      }

      if (want("help")) {
        await page.evaluate(`window.xfStudioShell.dock.reveal("help")`); await page.wait(600);
        await page.evaluate(`document.querySelector(".help-interface-guide")?.scrollIntoView({ block: "center" })`); await page.wait(300);
        texts[`help-${width}`] = await page.evaluate(`(() => { const a = document.querySelector(".help-interface-guide"); return a && { text: a.textContent, href: a.getAttribute("href"), target: a.target, rel: a.rel,
          detail: a.parentElement.querySelector("small")?.textContent }; })()`);
        await capture(page, "help-interface-guide", width, [".help-links"], "Help › More help: the Interface guide link");
      }
    } finally { await page.close(); }
  } finally { proc.kill(); await proc.exited; }
}

/** The style guide's specimens for the same entries, beside the live states. */
async function guide(width: "narrow" | "wide", size: number) {
  const proc = await server();
  try {
    const page = await launch(`${origin}/style-guide.html`, { width: size, height: 1000, scheme: "light", debugPort: port + 5002 });
    try {
      await page.waitFor(`document.readyState === "complete"`, 30_000); await page.wait(800);
      texts[`guide-back-link`] = await page.evaluate(`(() => { const a = document.querySelector(".guide-back"); return a && { text: a.textContent, href: a.getAttribute("href") }; })()`);
      await capture(page, "guide-top", width, [".guide-top"], "The guide's top bar: the link back to XF Studio", { guide: true, pad: 0 });
      for (const id of ["s-header", "lib-workspace-notice", "t-unprotected", "t-recovering", "t-read-only-window", "t-conflict", "c-chips", "t-saved", "lib-record-list", "s-palette"]) {
        await page.evaluate(`document.getElementById(${JSON.stringify(id)})?.scrollIntoView({ block: "start" })`); await page.wait(300);
        await capture(page, `guide-${id}`, width, [`#${id} .specimen`], `Style guide ${id}: specimen`, { guide: true });
      }
    } finally { await page.close(); }
  } finally { proc.kill(); await proc.exited; }
}

/** A second tab's page session (as ui-review-2-captures.ts). */
async function attach(debugPort: number, targetId: string, width: number): Promise<Session & { close(): Promise<void> }> {
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as { id: string; webSocketDebuggerUrl: string }[];
  const entry = list.find(item => item.id === targetId);
  if (!entry) throw Error("The second tab isn't listed.");
  const socket = new WebSocket(entry.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0;
  const pending = new Map<number, { ok(value: any): void; fail(error: Error): void }>();
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); const entry = message.id && pending.get(message.id);
    if (entry) { pending.delete(message.id); if (message.error) entry.fail(Error(message.error.message)); else entry.ok(message.result); } };
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => { const next = ++id; pending.set(next, { ok, fail }); socket.send(JSON.stringify({ id: next, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
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
    async close() { try { await fetch(`http://127.0.0.1:${debugPort}/json/close/${targetId}`); } catch { /* gone */ } socket.close(); },
  };
  return session as unknown as Session & { close(): Promise<void> };
}

const errors: Record<string, string> = {};
for (const [width, size] of [["narrow", 640], ["wide", 1440]] as const) {
  try { await run(width, size); } catch (error) { errors[width] = String((error as Error)?.stack ?? error).slice(0, 2000); }
  if (want("guide")) try { await guide(width, size); } catch (error) { errors[`guide-${width}`] = String((error as Error)?.stack ?? error).slice(0, 2000); }
}
// Runs of single sections add to what earlier runs recorded.
const earlier = (file: string) => existsSync(join(out, file)) ? JSON.parse(readFileSync(join(out, file), "utf8")) : undefined;
const shotsBefore = (earlier(`${tag}-shots.json`) ?? []) as Shot[];
writeFileSync(join(out, `${tag}-texts.json`), JSON.stringify({ ...(earlier(`${tag}-texts.json`) ?? {}), ...texts, errors }, null, 1));
writeFileSync(join(out, `${tag}-shots.json`), JSON.stringify([...shotsBefore.filter(shot => !shots.some(next => next.name === shot.name)), ...shots], null, 1));
rmSync(data, { recursive: true, force: true });
console.log(JSON.stringify({ out, shots: shots.length, errors }, null, 1));
process.exit(0);
