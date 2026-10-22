/**
 * Captures and layout-shift measurements for the second UI review of profiles phase 1 (phase 1g, `local/reviews/ui-review-profiles-p1.md`
 * captures A–D): live app states in an isolated `?verify=1` workspace, on a server of its own (its own throwaway data folder, so its
 * own library and settings, never the person's), in a headless Chrome with a throwaway profile, light and dark, at a narrow and a wide
 * window.
 *
 *   bun tools/ui-review-2-captures.ts <data-dir> <out-dir> [port=4395] [--root <authoring dir>] [--measure-only] [--only <sections>]
 *
 * The V states (a conflict in the Character panel's "Your V", History in a V's context) aren't here: a V needs the 3D view and its
 * prepared details, which need the game and more memory than these runs are given.
 * `--root` serves another checkout of the authoring project (a detached worktree of the commit before the fixes, for the "before"
 * measurements); `--measure-only` takes the measurements without captures, into `measurements-before.json`. Writes `<state>-<scheme>-<width>.png`, `texts.json` (the
 * tooltips and accessible names a capture can't show) and `measurements.json`.
 *
 * States are reached through the real code paths, with the page's own storage and transport steered by an init script, never by
 * changing the app: a library write that never answers (`hang`: the change waits in this browser's outbox, as when the host is slow),
 * one the library takes whose answer is lost (`swallow`), one that fails (`fail`), a storage that refuses the outbox's records (`full`),
 * and a workspace lease the host won't grant (`nolease`). A conflict is another writer's command sent to the library directly, as another
 * workspace's window would. A missing save is a restored change that names a save no library or page holds.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../../projects/xf-studio/authoring/tools/cdp";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const measureOnly = args.includes("--measure-only");
if (measureOnly) args.splice(args.indexOf("--measure-only"), 1);
const rootArg = flag("--root"), only = flag("--only");
/** Whether a section runs (`--only restoring|missing|unprotected|conflict|history|header|lease`; all by default). */
const want = (section: string) => !only || only.split(",").includes(section);
const [dataArg, outArg, portArg] = args;
if (!dataArg || !outArg) throw Error("Usage: bun tools/ui-review-2-captures.ts <data-dir> <out-dir> [port] [--root <authoring dir>] [--measure-only]");
const data = resolve(dataArg), out = resolve(outArg), port = Number(portArg ?? 4395);
if (port === 4317 || port === 4331) throw Error("That port is the person's own Studio.");
mkdirSync(out, { recursive: true });
const root = rootArg ? resolve(rootArg) : resolve(import.meta.dir, "..", "..", "..", "projects", "xf-studio", "authoring");
const origin = `http://127.0.0.1:${port}`;

/** The page's storage and transport, steered per tab by `sessionStorage["xfs-capture"]` (see the file comment). */
const INIT = `(() => {
  const real = window.fetch.bind(window), mode = () => sessionStorage.getItem("xfs-capture") ?? "";
  window.__xfsHeld = [];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url, m = mode();
    if (/\\/documents\\/transact$/.test(url)) {
      if (m === "hang") { window.__xfsHeld.push(String(init?.body ?? "")); return new Promise(() => {}); }
      if (m === "swallow") return real(input, init).then(() => new Promise(() => {}));
      if (m === "fail") return Promise.resolve(new Response(JSON.stringify({ error: "Saved documents are unavailable right now." }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }
    if (/\\/workspace-lease$/.test(url) && m === "nolease") return Promise.resolve(new Response("", { status: 503 }));
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
/** The dock's top edge: the next sibling of the workspace notice, measured in CSS pixels. */
const dockTop = (page: Session) => page.evaluate(`Math.round(document.querySelector("main.workspace").getBoundingClientRect().top * 10) / 10`) as Promise<number>;
const noticeState = (page: Session) => page.evaluate(`(() => { const n = document.querySelector(".workspace-notice"); const s = document.querySelector('.status-bar [data-tone="restoring"]');
  return { notice: n && !n.hidden ? n.querySelector(".workspace-notice-text")?.textContent ?? n.textContent : null, status: s && !s.hidden ? s.textContent : null,
    buttons: n ? [...n.querySelectorAll("button")].filter(b => !b.hidden).map(b => b.textContent.trim()) : [] }; })()`) as Promise<{ notice: string | null; status: string | null; buttons: string[] }>;
/** An edit: Add layer, in the Layers panel (revealed first: a narrow window shows one panel of a group at a time). */
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
const scheme = async (page: Session, value: "light" | "dark") => {
  await page.colorScheme(value);
  await page.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
  await page.wait(250);
};

/** Another writer's command on `ref`, based on the revision this window's waiting change was based on: a stale write for this window. */
async function otherWindowWrites(held: string, change: (write: { kind: string; id: string; base: number; value: any }) => boolean) {
  const request = JSON.parse(held) as { id: string; command: string; writes: { kind: string; id: string; base: number; value: any }[] };
  const writes = request.writes.filter(change);
  if (!writes.length) throw Error(`Nothing to change in ${request.command}.`);
  const response = await fetch(`${origin}/api/verification/documents/transact`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ id: `other-window-${crypto.randomUUID()}`, command: request.command, writes }) });
  const answer = await response.json() as { ok: boolean };
  if (!answer.ok) throw Error(`The other window's write was refused: ${JSON.stringify(answer).slice(0, 300)}`);
}

type Shot = { name: string; state: string; width: string; shows: string };
const shots: Shot[] = [], texts: Record<string, unknown> = {}, measurements: Record<string, unknown> = {};

async function capture(page: Session, state: string, width: string, selectors: string[], shows: string, options: { hover?: string; focus?: string; pad?: number } = {}) {
  if (measureOnly) return;
  // Toasts fade by themselves; a capture waits for them, so none covers what it shows.
  await page.waitFor(`!document.querySelector(".toasts")?.children.length`, 10_000).catch(() => {});
  for (const value of ["light", "dark"] as const) {
    await scheme(page, value);
    if (options.focus) {
      // Keyboard focus: Shift+Tab then Tab from the target, so the browser shows it as keyboard focus.
      await page.evaluate(`(${options.focus})?.focus()`);
      await page.key("Tab", { modifiers: 8 }); await page.key("Tab");
    }
    if (options.hover) {
      const at = await page.evaluate(`(() => { const r = (${options.hover}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) as [number, number];
      await page.mouse("mouseMoved", at[0], at[1], { button: "none", buttons: 0 });
      await page.wait(250);
    }
    const area = await clip(page, selectors, options.pad);
    if (area.width > 0 && area.height > 0) {
      const name = `${state}-${value}-${width}`;
      await page.screenshot(join(out, `${name}.png`), area);
      if (value === "light") shots.push({ name: `${state}-{light,dark}-${width}`, state, width, shows });
    }
  }
  await page.mouse("mouseMoved", 1, 1, { button: "none", buttons: 0 });
  await scheme(page, "light");
}

/** Waits until `ready` holds (polling), answering how long it took. */
async function until(page: Session, ready: string, timeout = 30_000) { const start = Date.now(); await page.waitFor(ready, timeout); return Date.now() - start; }

async function run(width: "narrow" | "wide", size: number) {
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  const server = Bun.spawn([process.execPath, "server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off" } });
  const debugPort = port + 5000 + (width === "wide" ? 1 : 0);
  try {
    for (let i = 0; i < 240; i++) { try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ } await Bun.sleep(250); }
    const page = await launch(`${origin}/?verify=1`, { width: size, height: 900, scheme: "light", init: INIT, debugPort });
    try {
      await studio(page);
      const m: Record<string, unknown> = {};
      measurements[width] = m;
      const notice = [".workspace-notice"], withStatus = [".workspace-notice", ".status-bar"];

      if (want("restoring")) {
        // B: restoring, safe. A change that waits in this browser's outbox, then a reload whose restore the library doesn't answer.
        await setMode(page, "hang");
        await addLayer(page);
        await page.wait(800);
        await reload(page);
        const opened = await dockTop(page);
        await until(page, `!!document.querySelector('.status-bar [data-tone="restoring"]:not([hidden])') || !!document.querySelector(".workspace-notice:not([hidden])")`, 10_000).catch(() => 0);
        const restoringShown = { top: await dockTop(page), ...(await noticeState(page)) };
        m.restoringFirstSeconds = { before: opened, after: restoringShown.top, shift: restoringShown.top - opened, shows: restoringShown };
        await capture(page, "b-restoring-status-bar", width, withStatus, "Restoring's first seconds: the status bar's line, the dock where it was (t-recovering, fix 2)");
        await until(page, `!!document.querySelector(".workspace-notice:not([hidden])") && document.querySelector(".workspace-notice-text").textContent.includes("taking a while")`, 15_000);
        const longTop = await dockTop(page);
        m.restoringLong = { before: restoringShown.top, after: longTop, shift: longTop - restoringShown.top, shows: await noticeState(page) };
        await capture(page, "b-restoring-long-safe", width, notice, "Restoring taking a while, safe to keep working: Use restored and Try again, labelled");
        // Resolved: the library answers, and the band goes.
        await setMode(page, "");
        await press(page, byLabel("Try again"));
        await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 30_000);
        m.restoringResolved = { top: await dockTop(page) };

        // Restoring, not safe: the library took the change, but its answer never came; the reload's restore isn't answered either.
        await setMode(page, "swallow");
        await addLayer(page);
        await page.wait(1_000);
        await setMode(page, "hang");
        await reload(page);
        await until(page, `!!document.querySelector(".workspace-notice:not([hidden])") && document.querySelector(".workspace-notice-text").textContent.includes("taking a while")`, 15_000);
        texts[`restoring-unsafe-${width}`] = await noticeState(page);
        await capture(page, "b-restoring-long-unsafe", width, notice, "Restoring taking a while, not safe: Export collection and Try again");
        await setMode(page, "");
        await press(page, byLabel("Try again"));
        await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 30_000);

      }

      if (want("missing")) {
        // Missing save: a restored change that needs a save no library or page holds.
        await setMode(page, "hang");
        await addLayer(page);
        await page.wait(800);
        const named = await page.evaluate(`(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i);
          if (!key.startsWith("xfs.outbox.")) continue; const record = JSON.parse(localStorage.getItem(key));
          for (const entry of record.entries ?? []) if (entry.state === "queued") { entry.requires = ["saved-v/capture-missing-save"]; n++; }
          localStorage.setItem(key, JSON.stringify(record)); } return n; })()`);
        if (!named) throw Error("No waiting change to make need a save.");
        await setMode(page, "");
        await reload(page);
        await until(page, `!!document.querySelector(".workspace-notice:not([hidden])") && document.querySelector(".workspace-notice-text").textContent.includes("game save")`, 20_000);
        texts[`missing-save-${width}`] = await noticeState(page);
        await capture(page, "b-missing-save", width, notice, "A restored change needs a game save that's no longer on this computer: Import save… and Discard those changes");
        await press(page, byLabel("Discard those changes"));
        await page.wait(400);
        texts[`discard-confirm-${width}`] = await page.evaluate(`(() => { const p = document.querySelector(".confirm-popover"); return p && { title: p.querySelector(".popover-title").textContent,
          message: p.querySelector(".popover-message").textContent, focused: document.activeElement?.textContent, buttons: [...p.querySelectorAll("button")].map(b => b.textContent) }; })()`);
        await capture(page, "a-discard-confirm", width, [".workspace-notice", ".confirm-popover"], "Discard those changes asks first, in place, focus on Cancel (fix 1)");
        await page.evaluate(`document.querySelector(".confirm-popover").requestSubmit()`);
        await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 20_000);

      }

      if (want("unprotected")) {
        // Unprotected: storage refuses the outbox's records during a slider drag. The band waits for the drag to end.
        await page.evaluate(`window.xfStudioShell.dock.reveal("finish")`);
        await page.wait(600);
        const thumb = await page.evaluate(`(() => { const s = [...document.querySelectorAll("input.slider")].find(i => i.closest(".field-row, label, div")?.textContent?.includes("Opacity") && i.getBoundingClientRect().width > 0);
          if (!s) return null; s.scrollIntoView({ block: "center" }); const r = s.getBoundingClientRect(); return [r.x + r.width * (s.value - s.min) / (s.max - s.min), r.y + r.height / 2, r.width]; })()`) as [number, number, number] | null;
        // The record can't be written while the change waits for the library (once the library has it, nothing is left to protect).
        await setMode(page, "hang", true);
        if (thumb) {
          const before = await dockTop(page);
          const during: number[] = [];
          await page.drag([thumb[0], thumb[1]], [thumb[0] - thumb[2] * 0.3, thumb[1]], { steps: 40, hold: async (_x, _y, i) => { if (i % 5 === 0) during.push(await dockTop(page)); } });
          await page.wait(600);
          const after = await dockTop(page);
          m.unprotectedDuringDrag = { before, during: [...new Set(during)], after, shiftDuringDrag: Math.max(...during.map(top => Math.abs(top - before))), shiftAfterDrag: after - before,
            shows: await noticeState(page) };
        } else {
          await addLayer(page);
          await page.wait(800);
          m.unprotectedDuringDrag = "no opacity slider found; an Add layer record failed instead";
        }
        await until(page, `!!document.querySelector(".workspace-notice:not([hidden])")`, 10_000);
        texts[`unprotected-${width}`] = await noticeState(page);
        await capture(page, "b-unprotected", width, notice, "Changes not protected on this computer: Export collection and Try again, labelled (fixes 2 and 3)");
        await setMode(page, "");
        await press(page, byLabel("Try again"));
        await until(page, `!document.querySelector(".workspace-notice:not([hidden])")`, 10_000).catch(() => {});
        m.unprotectedResolved = { top: await dockTop(page) };

      }

      if (measureOnly) return;
      // The change that waited is sent again after its attempt's deadline; a reload sends it at once.
      await reload(page);
      await page.wait(1_500);

      if (want("conflict")) {
        // A: a conflict on a preset. This window adds a layer (its change waits); another window renames the preset meanwhile.
        await page.evaluate(`window.xfStudioShell.dock.reveal("presets")`);
        await page.wait(400);
        await setMode(page, "hang");
        await page.evaluate(`window.__xfsHeld.length = 0`);
        await addLayer(page);
        await page.wait(800);
        const heldLook = await page.evaluate(`window.__xfsHeld.at(-1)`) as string;
        await otherWindowWrites(heldLook, write => { if (!write.kind.includes("look")) return false; write.value = { ...write.value, name: "Smoky glow" }; return true; });
        await setMode(page, "");
        await reload(page);
        await page.evaluate(`window.xfStudioShell.dock.reveal("presets")`);
        await until(page, `!!document.querySelector(".doc-conflict:not([hidden])")`, 30_000);
        await page.wait(400);
        texts[`conflict-preset-${width}`] = await page.evaluate(`[...document.querySelectorAll(".doc-conflict:not([hidden])")].map(n => ({ text: n.querySelector(".doc-conflict-text").textContent,
          buttons: [...n.querySelectorAll("button")].filter(b => !b.hidden).map(b => ({ label: b.textContent, title: b.title, reason: b.dataset.reason ?? null, disabled: b.getAttribute("aria-disabled") })) }))`);
        await capture(page, "a-conflict-preset", width, [".doc-conflicts", ".panel-head"], "Presets: a conflict on a preset, Keep mine focused by keyboard, Use theirs hovered",
          { focus: `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent === "Keep mine")`, hover: `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent === "Use theirs")` });
        await press(page, `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent === "Use theirs")`);
        await page.wait(400);
        texts[`confirm-theirs-${width}`] = await page.evaluate(`(() => { const p = document.querySelector(".confirm-popover"); return p && { message: p.querySelector(".popover-message").textContent, focused: document.activeElement?.textContent }; })()`);
        await capture(page, "a-confirm-use-theirs", width, [".doc-conflicts", ".confirm-popover"], "Use theirs asks first, naming the preset and what goes, focus on Cancel (fix 1)");
        await page.key("Escape");
        await press(page, `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent === "Keep mine")`);
        await page.wait(400);
        await capture(page, "a-confirm-keep-mine", width, [".doc-conflicts", ".confirm-popover"], "Keep mine asks first too: the library keeps no copy of the other window's version");
        await page.evaluate(`document.querySelector(".confirm-popover").requestSubmit()`);
        await until(page, `!document.querySelector(".doc-conflict:not([hidden])")`, 20_000);

        // A: a conflict on the collection: this window renames it; another window renames it too.
        await setMode(page, "hang");
        await page.evaluate(`window.__xfsHeld.length = 0`);
        await page.evaluate(`(() => { const i = document.querySelector('input[aria-label="Collection name"]'); i.focus(); i.value = "Night market set"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); i.blur(); })()`);
        await page.wait(1_000);
        const heldCollection = await page.evaluate(`window.__xfsHeld.find(body => body.includes("Night market set")) ?? window.__xfsHeld.at(-1) ?? ""`) as string;
        if (heldCollection) {
          await otherWindowWrites(heldCollection, write => { if (!write.kind.includes("collection")) return false; write.value = { ...write.value, name: "Night market" }; return true; });
          await setMode(page, "");
          await reload(page);
          await page.evaluate(`window.xfStudioShell.dock.reveal("presets")`);
          await until(page, `!!document.querySelector(".doc-conflict:not([hidden])")`, 30_000).catch(() => {});
          await page.wait(400);
          texts[`conflict-collection-${width}`] = await page.evaluate(`[...document.querySelectorAll(".doc-conflict:not([hidden])")].map(n => n.querySelector(".doc-conflict-text").textContent)`);
          await capture(page, "a-conflict-collection", width, [".doc-conflicts", ".panel-head"], "Presets: a conflict on the collection's name (no Keep both: a collection's name can't be kept as a copy)");
          await press(page, `[...document.querySelectorAll(".doc-conflict button")].find(b => b.textContent === "Use theirs")`);
          await page.wait(300);
          await page.evaluate(`document.querySelector(".confirm-popover")?.requestSubmit()`);
          await page.wait(800);
        } else texts[`conflict-collection-${width}`] = "no collection write was held";

      }

      if (want("history")) {
        // C: History with the final copy, a preset context: the header's Undo tooltip and the History panel.
        await setMode(page, "");
        await addLayer(page);
        await page.wait(600);
        await page.evaluate(`window.xfStudioShell.dock.reveal("history")`);
        await page.wait(400);
        texts[`history-preset-${width}`] = await page.evaluate(`(() => { const h = [...document.querySelectorAll(".history-controls button")]; const p = document.querySelector(".history-panel");
          return { headerUndo: h[0]?.title, headerRedo: h[1]?.title, summary: p?.querySelector(".history-context")?.textContent, summaryTitle: p?.querySelector(".history-context")?.title,
            list: p?.querySelector(".history-list")?.getAttribute("aria-label") }; })()`);
        await capture(page, "c-history-preset", width, [".history-panel"], "History for a preset context: the summary names it (fix 6)");
        await capture(page, "c-header-undo", width, [".shell-header"], "The header: its Undo and Redo name the context in their tooltips (texts.json: a capture can't show a browser tooltip)", { hover: `document.querySelector(".history-controls button")`, pad: 0 });

      }

      if (want("header") && width === "wide") {
        // E: the live header with Save version and the longest chip, "Changed since last version", at three window widths (item 8).
        await setMode(page, "");
        if (!(await press(page, byLabel("Save version")))) throw Error("No Save version button.");
        await page.waitFor(`[...document.querySelectorAll(".shell-header .chip")].some(c => c.textContent.trim() === "Saved")`, 30_000).catch(() => {});
        await addLayer(page);
        await page.waitFor(`[...document.querySelectorAll(".shell-header .chip")].some(c => c.textContent.includes("Changed since"))`, 15_000).catch(() => {});
        for (const header of [1100, 1280, 1440]) {
          await page.viewport(header, 900); await page.wait(500);
          texts[`header-${header}`] = await page.evaluate(`(() => { const q = s => document.querySelector(s); const fits = e => e ? { text: e.textContent.trim(), clipped: e.scrollWidth > e.clientWidth } : null;
            return { category: fits(q(".shell-header .category span")), collection: fits(q(".shell-header .crumb-collection")), preset: fits(q(".shell-header .crumb-preset")),
              chip: q(".shell-header .chip")?.textContent }; })()`);
          await capture(page, `e-header-${header}`, "wide", [".shell-header"], `The live header at ${header} px: Save version and the "Changed since last version" chip`, { pad: 0 });
        }
        await page.viewport(size, 900); await page.wait(300);
      }

      if (want("lease")) {
        // D: lease states, with a second tab on the same workspace.
        const target = await page.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
        const second = await attach(debugPort, target.targetId, size);
        try {
          await second.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
          await second.send("Page.navigate", { url: `${origin}/?verify=1` });
          await second.waitFor(READY, 90_000); await second.wait(1_500);
          await capture(second, "d-read-only", width, [".shell-header", ".workspace-notice"], "A second window: read-only, with Use it here");
          // This window holds a change that never answers, so handing over waits: the other window takes over, then waits. A background
          // tab doesn't paint, so each read brings its tab to the front first.
          const front = async (tab: Session) => { await tab.send("Page.bringToFront"); await tab.wait(120); };
          await front(page);
          await setMode(page, "hang");
          await addLayer(page);
          await page.wait(600);
          await front(second);
          await press(second, byLabel("Use it here"));
          const timeline: unknown[] = [], started = Date.now();
          let taking = false, handing = false;
          for (let i = 0; i < 40; i++) {
            await front(second); const other = await noticeState(second);
            if (!taking && other.notice?.startsWith("Taking over")) { taking = true; await capture(second, "d-taking-over", width, [".workspace-notice"], "Taking over from the other window…"); }
            await front(page); const holder = await noticeState(page);
            if (!handing && holder.notice?.startsWith("Handing")) { handing = true; await capture(page, "d-handing-over", width, [".workspace-notice"], "The holder hands over while its last change drains"); }
            timeline.push({ at: Date.now() - started, holder: holder.notice, other: other.notice });
            if (other.notice?.startsWith("Waiting") && handing) break;
          }
          texts[`lease-timeline-${width}`] = timeline;
          await front(second);
          texts[`waiting-${width}`] = await noticeState(second);
          await capture(second, "d-waiting", width, [".workspace-notice"], "Waiting for the other window to finish saving. Close the other window to continue.");
          // Its last change fails: the holder keeps the workspace and says so, with Try again.
          await front(page);
          await setMode(page, "fail");
          await until(page, `document.querySelector(".workspace-notice-text")?.textContent.includes("couldn't be saved")`, 40_000).catch(() => {});
          texts[`kept-${width}`] = await noticeState(page);
          await capture(page, "d-kept", width, [".workspace-notice"], "Your latest changes couldn't be saved, so this window kept the workspace: Try again");
        } finally { await second.close(); }
        // Lost connection: a window the host won't give a lease.
        await setMode(page, "nolease");
        await reload(page);
        await until(page, `document.querySelector(".workspace-notice-text")?.textContent.includes("lost its connection")`, 20_000).catch(() => {});
        texts[`lost-${width}`] = await noticeState(page);
        await capture(page, "d-lost-connection", width, [".shell-header", ".workspace-notice"], "This window lost its connection to XF Studio");
        await setMode(page, "");

      }

      } finally { await page.close(); }
  } finally { server.kill(); await server.exited; }
}

/** A second tab's page session (Target.createTarget in the same Chrome: same profile, so the same workspace). */
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
    async drag() {}, async key(key: string, options: { modifiers?: number } = {}) {
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, modifiers: options.modifiers ?? 0, windowsVirtualKeyCode: key === "Tab" ? 9 : 0 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers: options.modifiers ?? 0, windowsVirtualKeyCode: key === "Tab" ? 9 : 0 }); },
    async type() {}, wait: (ms: number) => Bun.sleep(ms),
    async waitFor(expression: string, timeout = 30_000) { const start = Date.now();
      while (Date.now() - start < timeout) { try { const value = await session.evaluate(expression); if (value) return value; } catch { /* loading */ } await Bun.sleep(150); }
      throw Error(`Timed out waiting for ${expression}`); },
    async close() { try { await fetch(`http://127.0.0.1:${debugPort}/json/close/${targetId}`); } catch { /* gone */ } socket.close(); },
  };
  return session as unknown as Session & { close(): Promise<void> };
}

// Narrow: below the workspace notice's 720 px rule, with panels about 300 px wide; wide: a desktop window.
for (const [width, size] of [["narrow", 640], ["wide", 1440]] as const) {
  try { await run(width, size); }
  catch (error) { (measurements[width] ??= {}) as object; (measurements as Record<string, any>)[`${width}-error`] = String((error as Error)?.stack ?? error).slice(0, 2000); }
}
writeFileSync(join(out, measureOnly ? "measurements-before.json" : "measurements.json"), JSON.stringify(measurements, null, 1));
if (!measureOnly) { writeFileSync(join(out, "texts.json"), JSON.stringify(texts, null, 1)); writeFileSync(join(out, "shots.json"), JSON.stringify(shots, null, 1)); }
rmSync(data, { recursive: true, force: true });
console.log(JSON.stringify({ out, shots: shots.length, measurements }, null, 1));
process.exit(0);
