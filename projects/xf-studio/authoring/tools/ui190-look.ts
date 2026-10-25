/**
 * Coordinator captures for UI-190 (research/authoring/code-health.md) and the polish lane's batch-3 leftovers:
 *
 *   bun tools/ui190-look.ts <output-folder-on-C> [port=4611] [--only conflict,history,readonly,guide]
 *
 * It never touches the person's server or draft: a disposable-data server (`startServer`, a read-only copy of the host's settings so the
 * real 3D head prepares), headless Chromes with throwaway profile folders under the output folder, and the isolated `?verify=1`
 * workspace. Run it under the memory guard.
 *
 *   conflict   a V's conflict notice in the Character panel ("Changed in another window"), made for real: two Chrome profiles are two
 *              workspaces on the same library. Both show the same V; window A changes the V's hair colour and the library takes it; window B,
 *              which has not yet taken the new revision (a window learns of another's revision only on its 10 s check), changes the same field.
 *              B's write is then stale, which the outbox turns into a conflict, and B's Character panel shows the notice. Shown as it is, with
 *              Keep mine's confirmation open, with Use other window's open, and after Keep both. The whole run is made at 900 px and 1,600 px
 *              (a conflict is made anew for each width). Nothing waits on a timer: every step waits on the library's revision of the V
 *              (read straight from the server) or on what the page shows; a try in which B's check ran first (no conflict came) is repeated.
 *   history    the History panel of window A after its Character edit: the V's scope with "Change Hair Color" as a step.
 *   readonly   a third tab on window A's profile (so the same workspace, held by A): its Character, Colour & finish (the Opacity slider)
 *              and Settings panels, with what the slider reports (disabled, reason) and whether a click changes it.
 *   guide      the style guide's specimens for the same states (t-conflict, lib-conflict-notice, c-confirm, c-history, t-read-only-window).
 *
 * Every image is the panel only (never the 3D view's own pixels beyond what the pane holds), light and dark, at 900 and 1,600 px. Before each
 * state every menu, popover and floating panel is closed and toasts are dismissed; what remains open is recorded in report.json.
 * Writes <state>-<scheme>-<width>.png, guide-*.png, report.json, console.json and review.html (app captures beside their guide specimens).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, startServer, type Session } from "./cdp";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const only = flag("--only");
const want = (section: string) => !only || only.split(",").includes(section);
const [outArg, portArg] = args;
if (!outArg) throw Error("Usage: bun tools/ui190-look.ts <output-folder-on-C> [port=4611] [--only conflict,history,readonly,guide]");
const out = resolve(outArg), port = Number(portArg ?? 4611);
if ([port, port + 5000, port + 5001].some(p => p === 4317 || p === 4331)) throw Error("That port is the person's own Studio.");
if (process.platform === "win32" && !/^C:[\\/]/i.test(out)) throw Error("Keep capture work on C.");
mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`, profiles = join(out, ".profiles");
rmSync(profiles, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

const P = "window.xfStudioPresentation", S = "window.xfStudioShell";
const WIDTHS = [900, 1600] as const, HEIGHT = 1000;
type Tab = Pick<Session, "send" | "evaluate" | "screenshot" | "viewport" | "colorScheme" | "wait" | "waitFor" | "key" | "close">;
type ClickTab = Tab & { click(x: number, y: number): Promise<void> };
type Shot = { state: string; width: number; shows: string; guide: string[]; check: boolean; open: string[] };
const shots: Shot[] = [], report: Record<string, unknown> = {}, unreached: { state: string; why: string }[] = [];

/** The library's documents of a kind, read from the server (never the page): what a window has acknowledged. */
const library = async (kind: string) => (await (await fetch(`${origin}/api/verification/documents?kind=${kind}`, { headers: { Origin: origin, Accept: "application/json" } })).json() as
  { documents: { id: string; revision: number; value: any }[] }).documents;

const scheme = async (page: Tab, value: "light" | "dark") => {
  await page.colorScheme(value);
  await page.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
  await page.wait(250);
};
/** The union of the elements `finders` (page expressions giving an element or null) as a screenshot clip, in document coordinates. */
const clipOf = (page: Tab, finders: string[], pad = 6) => page.evaluate(`(() => {
  const rects = [${finders.map(f => `(() => { try { return ${f}; } catch { return null; } })()`).join(",")}].filter(e => e && !e.hidden && !e.closest("[hidden]")).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.min(...rects.map(r => r.left)) - ${pad}), y = Math.max(0, Math.min(...rects.map(r => r.top)) - ${pad});
  const right = Math.min(innerWidth, Math.max(...rects.map(r => r.right)) + ${pad}), bottom = Math.min(innerHeight, Math.max(...rects.map(r => r.bottom)) + ${pad});
  return { x: x + scrollX, y: y + scrollY, width: right - x, height: bottom - y };
})()`) as Promise<{ x: number; y: number; width: number; height: number }>;
/** The dock group (pane) holding a panel's content or tab. */
const pane = (inner: string) => `document.querySelector(${JSON.stringify(inner)})?.closest(".dock-group")`;
const PANES = { character: pane(".cc-panel"), history: pane("button.dock-tab[data-panel=history]"), finish: pane("input.slider"), settings: pane(".settings-panel") };
const POPOVER = `document.querySelector(".confirm-popover")`;

/** Every menu, popover and floating panel closed, toasts dismissed, scroll at the top. What is still open over the page is returned. */
async function tidy(page: Tab): Promise<string[]> {
  await page.key("Escape"); await page.key("Escape");
  await page.evaluate(`(() => { for (const id of [...document.querySelectorAll(".dock-floating .dock-tab")].map(t => t.dataset.panel)) ${S}.dock.close(id);
    for (const b of document.querySelectorAll(".toasts button")) b.click();
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest(".confirm-popover")) document.activeElement.blur(); })()`).catch(() => {});
  await page.wait(500);
  return await page.evaluate(`[...document.querySelectorAll(".menu, .popover, .confirm-popover, .dock-floating .dock-group, .toasts > *")].filter(e => e.getClientRects().length).map(e => e.className)`) as string[];
}
const reveal = async (page: Tab, panel: string) => { await page.evaluate(`${S}.dock.reveal(${JSON.stringify(panel)})`); await page.wait(900); };
const resize = async (page: Tab, width: number) => { await page.viewport(width, HEIGHT); await page.wait(900); };

/** One state, light and dark: tidy first (unless `keep`), check `proof`, then the clip of `finders`. */
async function capture(page: Tab, state: string, width: number, finders: string[], shows: string, guide: string[], proof: string, options: { keep?: boolean; pad?: number } = {}) {
  const open = options.keep ? [] : await tidy(page);
  const check = !!await page.evaluate(proof).catch(() => false);
  for (const value of ["light", "dark"] as const) {
    await scheme(page, value);
    const area = await clipOf(page, finders, options.pad);
    if (area.width > 0 && area.height > 0) await page.screenshot(join(out, `${state}-${value}-${width}.png`), area);
    else { unreached.push({ state: `${state}-${width}`, why: `nothing matched ${finders.join(", ")}` }); break; }
  }
  await scheme(page, "light");
  shots.push({ state, width, shows, guide, check, open });
  if (!check) unreached.push({ state: `${state}-${width}`, why: `its proof did not hold: ${proof}` });
}

const press = (page: Tab, find: string) => page.evaluate(`(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`) as Promise<boolean>;
const notice = `document.querySelector(".doc-conflict:not([hidden])")`;
const noticeButton = (label: string) => `[...document.querySelectorAll(".doc-conflict:not([hidden]) button")].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const ready = async (page: Tab) => { await page.waitFor(`!!${S} && !!${P} && !!document.querySelector(".dock-group")`, 120_000); await page.wait(1500); };
const hairRow = `[...document.querySelectorAll(".cc-row")].find(r => r.querySelector(".cc-row-label")?.textContent === "Hair Color" && !r.hidden)`;
/** Expand the Hair Color row, run `fn(choices)` in the page, collapse it, and scroll the panel back to its top. */
async function hair<T>(page: Tab, body: string): Promise<T> {
  await page.waitFor(`!!(${hairRow})`, 300_000);
  await page.evaluate(`(() => { const r = ${hairRow}; if (r.querySelector(".cc-row-main").getAttribute("aria-expanded") !== "true") r.querySelector(".cc-row-main").click(); })()`);
  await page.waitFor(`(${hairRow}).querySelectorAll(".cc-choice").length > 3`, 60_000);
  const value = await page.evaluate(`(() => { const choices = [...(${hairRow}).querySelectorAll(".cc-choice")]; ${body} })()`) as T;
  await page.evaluate(`(() => { const r = ${hairRow}; if (r.querySelector(".cc-row-main").getAttribute("aria-expanded") === "true") r.querySelector(".cc-row-main").click();
    for (let e = document.querySelector(".cc-panel"); e; e = e.parentElement) e.scrollTop = 0; })()`);
  return value;
}
const selectedHair = (page: Tab) => hair<{ index: number; label: string; count: number }>(page,
  `const index = choices.findIndex(c => c.getAttribute("aria-selected") === "true"); return { index, label: choices[index]?.getAttribute("aria-label") ?? "", count: choices.length };`);
const pickHair = (page: Tab, index: number) => hair<string>(page, `choices[${index}].click(); return choices[${index}].getAttribute("aria-label");`);

/** Another Chrome tab of window A's browser (the same profile, so the same workspace), as a page session. */
async function attach(debugPort: number, from: Session, width: number): Promise<ClickTab> {
  const target = await from.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const entry = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as { id: string; webSocketDebuggerUrl: string }[]).find(item => item.id === target.targetId);
  if (!entry) throw Error("The extra tab isn't listed.");
  const socket = new WebSocket(entry.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0;
  const pending = new Map<number, { ok(value: any): void; fail(error: Error): void }>();
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); const waiting = message.id && pending.get(message.id);
    if (waiting) { pending.delete(message.id); if (message.error) waiting.fail(Error(message.error.message)); else waiting.ok(message.result); } };
  const send = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((ok, fail) => { const next = ++id; pending.set(next, { ok, fail }); socket.send(JSON.stringify({ id: next, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  const tab: ClickTab = {
    send,
    async evaluate<T>(expression: string) { const result = await send<any>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value as T; },
    async screenshot(path, area) { const result = await send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(area ? { clip: { ...area, scale: 1 } } : {}) });
      writeFileSync(path, Buffer.from(result.data, "base64")); },
    async viewport(w, h) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async colorScheme(value) { await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }); },
    async key(key) { const code = key === "Escape" ? 27 : 0;
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code }); await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code }); },
    async click(x, y) { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 }); },
    wait: ms => Bun.sleep(ms),
    async waitFor(expression, timeout = 30_000) { const start = Date.now();
      while (Date.now() - start < timeout) { try { const value = await tab.evaluate(expression); if (value) return value; } catch { /* loading */ } await Bun.sleep(150); }
      throw Error(`Timed out waiting for ${expression}`); },
    async close() { try { await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.targetId}`); } catch { /* gone */ } socket.close(); },
  };
  await tab.viewport(width, HEIGHT);
  await send("Page.navigate", { url: `${origin}/?verify=1` });
  return tab;
}

/** Wait until `done()` holds, polling the server and both pages; never a fixed sleep for a result. */
async function until(done: () => Promise<boolean>, timeout = 60_000, step = 120) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await done()) return true; await Bun.sleep(step); }
  return false;
}

/** Chrome's helpers can hold a profile folder for a moment after the browser ends: try again, and never fail a run over it. */
async function removeProfiles() {
  for (let i = 0; i < 20; i++) {
    try { rmSync(profiles, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return; } catch { await Bun.sleep(1000); }
  }
  console.warn(`Could not remove ${profiles}; delete it by hand.`);
}

const { server } = await startServer(port, { settings: "copy" });
let a: Session | undefined, b: Session | undefined, readOnly: ClickTab | undefined;
try {
  if (want("conflict") || want("history") || want("readonly")) {
    // ---- Window A makes a V; window B (another profile, so another workspace) shows the same one. ----
    a = await launch(`${origin}/?verify=1`, { width: WIDTHS[1], height: HEIGHT, scheme: "light", profile: join(profiles, "a"), debugPort: port + 5000 });
    await ready(a);
    await reveal(a, "character");
    if (!await press(a, `[...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith("Default V (feminine)") && !b.closest("[hidden]"))`))
      throw Error("Window A shows no Default V button (a V is already shown?).");
    await a.waitFor(`!!(${hairRow})`, 300_000);
    const made = await library("character");
    if (made.length !== 1) throw Error(`Expected one V in the library, found ${made.length}.`);
    const vId = made[0]!.id;
    report.v = { id: vId, source: made[0]!.value.source, note: "the creator's default feminine V (a V is a character document; its source does not change the conflict)" };
    const revision = async () => (await library("character")).find(item => item.id === vId)?.revision ?? 0;

    if (want("conflict") || want("history")) {
      b = await launch(`${origin}/?verify=1`, { width: WIDTHS[1], height: HEIGHT, scheme: "light", profile: join(profiles, "b"), debugPort: port + 5001 });
      await ready(b);
      await reveal(b, "character");
      await b.waitFor(`!!(${hairRow})`, 300_000);
      // Both show the same V: one character in the library, and the same hair colour selected in each.
      const same = await until(async () => { const [x, y] = [await selectedHair(a!), await selectedHair(b!)]; return x.index >= 0 && x.index === y.index; }, 60_000, 500);
      report.sameVBefore = { same, library: (await library("character")).length };
      if (!same) throw Error("The two windows do not show the same hair colour yet.");

      /**
       * The conflict, for real. Wait until both windows hold the V at the library's revision (same colour selected, nothing waiting), then A
       * changes the hair colour and the library takes it (revision up), and B changes it at once: B's baseline is still the old revision (it learns
       * of another window's by its 10 s check, which skips a document with a waiting change), so its write is stale. Observable end: B's notice.
       * A try where B's check ran in between (B's write was taken: the revision went up twice, no notice) is repeated on the new revisions.
       */
      async function makeConflict(width: number) {
        for (let attempt = 0; attempt < 6; attempt++) {
          await until(async () => { const [x, y] = [await selectedHair(a!), await selectedHair(b!)]; return x.index >= 0 && x.index === y.index; }, 60_000, 500);
          const current = await selectedHair(a!), before = await revision();
          const forA = (current.index + 1 + attempt) % current.count, forB = (current.index + 2 + attempt) % current.count;
          const nameA = await pickHair(a!, forA);
          if (!await until(async () => await revision() > before, 30_000)) throw Error("Window A's change never reached the library.");
          const nameB = await pickHair(b!, forB);
          let outcome = "";
          await until(async () => {
            if (await b!.evaluate(`!!${notice}`)) { outcome = "conflict"; return true; }
            if (await revision() >= before + 2) { outcome = "taken"; return true; }
            return false;
          }, 40_000, 100);
          report[`conflict-${width}-attempt-${attempt}`] = { revisionBefore: before, a: nameA, b: nameB, outcome };
          if (outcome === "conflict") return;
          // B's write was taken without a conflict (its check ran first): wait for A to take B's value, then try again.
        }
        throw Error("No conflict came in six tries.");
      }

      for (const width of WIDTHS) {
        await resize(a, width); await resize(b, width);
        for (const w of [a, b]) { await reveal(w, "character"); }
        if (want("conflict")) {
          await makeConflict(width);
          await b.wait(500);
          report[`texts-${width}`] = await b.evaluate(`[...document.querySelectorAll(".doc-conflict:not([hidden])")].map(n => ({ text: n.querySelector(".doc-conflict-text")?.textContent,
            buttons: [...n.querySelectorAll("button")].filter(x => !x.hidden).map(x => ({ label: x.textContent.trim(), title: x.title, unavailable: x.getAttribute("aria-disabled") })) }))`);
          report[`window-a-${width}`] = { conflictShown: await a.evaluate(`!!${notice}`) };
          const panel = [PANES.character], withPopover = [PANES.character, POPOVER];
          await b.evaluate(`${S}.dock.reveal("character")`);
          await capture(b, "conflict-shown", width, panel, "Character panel, \"Your V\": the notice \"Changed in another window\" with Keep mine, Use other window's and Keep both", ["t-conflict", "lib-conflict-notice"], `!!${notice}`);
          for (const [keep, label, state] of [["mine", "Keep mine", "conflict-keep-mine"], ["theirs", "Use other window's", "conflict-use-other"]] as const) {
            await tidy(b);
            await press(b, noticeButton(label));
            await b.waitFor(`!!${POPOVER}`, 10_000).catch(() => {});
            await b.waitFor(`!!document.activeElement?.closest(".confirm-popover")`, 3_000).catch(() => {});
            report[`${state}-${width}`] = await b.evaluate(`(() => { const p = ${POPOVER}; return p && { message: p.querySelector(".popover-message")?.textContent, focused: document.activeElement?.textContent?.trim() }; })()`);
            await capture(b, state, width, withPopover, `${label}'s confirmation open: names the V and what is discarded, focus on Cancel`, ["c-confirm", "t-conflict"],
              `!!${POPOVER} && !!${notice}`, { keep: true, pad: 8 });
            void keep;
          }
          await tidy(b);
          // Keep both, if a V offers it (the notice's third button is shown only when a copy can be made).
          const both = await b.evaluate(`!!(${noticeButton("Keep both")})`);
          report[`keep-both-offered-${width}`] = both;
          if (both) {
            await press(b, noticeButton("Keep both"));
            await b.waitFor(`!${notice}`, 30_000).catch(() => {});
            await b.wait(800);
            report[`after-keep-both-${width}`] = { vs: (await library("character")).map(item => ({ id: item.id, revision: item.revision, name: item.value.name ?? null })), panelTitle: await b.evaluate(`document.querySelector(".cc-panel")?.innerText?.slice(0, 200)`) };
            await capture(b, "conflict-after-keep-both", width, panel, "Character panel after Keep both: the notice is gone", ["t-conflict"], `!${notice}`);
          } else unreached.push({ state: `conflict-after-keep-both-${width}`, why: "this V does not offer Keep both" });
          // Window A and B hold the same V again (B shows the other window's version): wait for it before the next width.
          await until(async () => { const [x, y] = [await selectedHair(a!), await selectedHair(b!)]; return x.index >= 0 && x.index === y.index; }, 60_000, 500);
        }
        if (want("history") && width === WIDTHS[0]) {
          // Window A's History after its Character edit, at both widths (one step, so the two widths match).
          await resize(a, WIDTHS[0]);
          for (const w of WIDTHS) {
            await resize(a, w);
            await reveal(a, "history");
            await capture(a, "history-after-character-edit", w, [PANES.history], "History panel after a Character edit: the V's scope, \"Change Hair Color\" as the current step", ["c-history"],
              `/Change Hair Color/.test(document.querySelector(".dock-group:has(button.dock-tab[data-panel=history]) .panel-content")?.textContent ?? "")`);
          }
          await reveal(a, "character");
        }
        report[`history-note`] = "taken in the first (900 px) pass at both widths, so each shows one step";
      }
    }
    await b?.close(); b = undefined;

    // ---- A read-only window: a third tab on window A's profile, so the same workspace, which A holds. ----
    if (want("readonly")) {
      // The same panel in the window that holds the workspace, to compare the Opacity slider's look.
      for (const width of WIDTHS) {
        await resize(a, width); await reveal(a, "finish");
        const slider = await a.evaluate(`(() => { const s = document.querySelector("input.slider"); const style = getComputedStyle(s); return { value: s.value, disabled: s.disabled, cursor: style.cursor, opacity: style.opacity }; })()`);
        report[`writable-opacity-slider-${width}`] = slider;
        await capture(a, "writable-colour-finish", width, [PANES.finish], "Reference, the window that holds the workspace: the same Colour & finish panel, Opacity slider available", ["t-read-only-window"], `!!document.querySelector("input.slider")`);
        await reveal(a, "character");
      }
      await resize(a, WIDTHS[1]);
      readOnly = await attach(port + 5000, a, WIDTHS[1]);
      await ready(readOnly);
      await readOnly.waitFor(`document.querySelector(".studio")?.dataset.workspace === "read-only"`, 60_000);
      await reveal(readOnly, "character");
      await readOnly.wait(1500);
      for (const width of WIDTHS) {
        await resize(readOnly, width);
        await reveal(readOnly, "character");
        // The read-only window prepares its own copy of the V; its rows are the state to show.
        const hasHair = !!await readOnly.waitFor(`!!(${hairRow})`, 240_000).catch(() => false);
        await readOnly.wait(1500);
        await capture(readOnly, "readonly-character", width, [PANES.character, `document.querySelector(".workspace-notice:not([hidden])")`], "Read-only window, Character panel: every editing control unavailable, with the window's reason in the notice above",
          ["t-read-only-window"], `document.querySelector(".studio")?.dataset.workspace === "read-only" && [...document.querySelectorAll(".cc-panel button")].some(b => b.getAttribute("aria-disabled") === "true" || b.disabled)`);
        report[`readonly-character-${width}`] = { hairRowShown: hasHair, unavailable: await readOnly.evaluate(`[...document.querySelectorAll(".cc-panel button, .cc-panel input")].filter(e => e.getAttribute("aria-disabled") === "true" || e.disabled).length`),
          enabled: await readOnly.evaluate(`[...document.querySelectorAll(".cc-panel button, .cc-panel input")].filter(e => !(e.getAttribute("aria-disabled") === "true" || e.disabled) && e.getClientRects().length).map(e => (e.getAttribute("aria-label") || e.textContent || e.className).trim().slice(0, 40))`) };
        // How the unavailable controls of the Character panel (and the History panel's Undo/Redo) present themselves, beside what they report.
        const probe = (selector: string) => readOnly!.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.getClientRects().length).slice(0, 12).map(e => { const st = getComputedStyle(e);
          return { label: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 32), ariaDisabled: e.getAttribute("aria-disabled"), disabled: e.disabled, cls: e.className, opacity: st.opacity, color: st.color, cursor: st.cursor, title: (e.title || "").slice(0, 60) }; })`);
        report[`readonly-probe-character-${width}`] = await probe(".cc-panel .cc-history button, .cc-panel .row button");
        report[`readonly-probe-history-${width}`] = await probe(".history-controls button, .history-panel button");
        await reveal(readOnly, "finish");
        const slider = `document.querySelector("input.slider")`;
        const before = await readOnly.evaluate(`(() => { const s = ${slider}; const r = s.getBoundingClientRect(); const style = getComputedStyle(s);
          return { value: s.value, disabled: s.disabled, ariaDisabled: s.getAttribute("aria-disabled"), title: s.title, cursor: style.cursor, opacity: style.opacity, box: [r.x + r.width * .2, r.y + r.height / 2],
            around: s.closest(".control")?.className }; })()`) as { value: string; disabled: boolean; box: [number, number] };
        // A real click near the left end of the track: it must change nothing.
        await readOnly.click(before.box[0], before.box[1]); await readOnly.wait(500);
        const after = await readOnly.evaluate(`${slider}.value`);
        report[`readonly-opacity-slider-${width}`] = { ...before, valueAfterClick: after, changed: after !== before.value };
        await capture(readOnly, "readonly-colour-finish", width, [PANES.finish], "Read-only window, Colour & finish panel: the Opacity slider (its state is in report.json)", ["t-read-only-window"],
          `document.querySelector(".studio")?.dataset.workspace === "read-only" && !!document.querySelector("input.slider")`);
        await reveal(readOnly, "settings");
        await readOnly.wait(800);
        report[`readonly-settings-${width}`] = { unavailable: await readOnly.evaluate(`[...document.querySelectorAll(".settings-panel button, .settings-panel input, .settings-panel select")].filter(e => e.getAttribute("aria-disabled") === "true" || e.disabled).length`),
          enabled: await readOnly.evaluate(`[...document.querySelectorAll(".settings-panel button, .settings-panel input, .settings-panel select")].filter(e => !(e.getAttribute("aria-disabled") === "true" || e.disabled) && e.getClientRects().length).map(e => (e.getAttribute("aria-label") || e.textContent || e.className).trim().slice(0, 40))`) };
        await capture(readOnly, "readonly-settings", width, [PANES.settings], "Read-only window, Settings panel (floating): editing controls unavailable; theme, input preferences, diagnostics and Report a problem stay available",
          ["t-read-only-window"], `document.querySelector(".studio")?.dataset.workspace === "read-only" && !!document.querySelector(".settings-panel")`, { keep: true });
        // The sections further down, where the controls that stay available (theme, input hints, diagnostics, Report a problem) are.
        for (const section of ["appearance", "privacy"]) {
          await readOnly.evaluate(`document.querySelector("[data-settings-section=${section}]")?.scrollIntoView({ block: "start" })`); await readOnly.wait(500);
          await capture(readOnly, `readonly-settings-${section}`, width, [PANES.settings], `Read-only window, Settings panel scrolled to ${section}: what stays available beside what is unavailable`,
            ["t-read-only-window"], `document.querySelector(".studio")?.dataset.workspace === "read-only" && !!document.querySelector("[data-settings-section=${section}]")`, { keep: true });
        }
        await tidy(readOnly);
      }
      report.readOnlyConsole = (readOnly as unknown as { console?: unknown }).console ?? null;
      await readOnly.close(); readOnly = undefined;
    }
  }
} finally {
  await readOnly?.close().catch(() => {});
  const errors = [...(a?.console ?? []), ...(b?.console ?? [])].filter(entry => entry.type === "error" || entry.type === "exception");
  await a?.close().catch(() => {}); await b?.close().catch(() => {});
  server.kill(); await server.exited;
  await removeProfiles();
  writeFileSync(join(out, "console.json"), JSON.stringify(errors, null, 2));
  writeFileSync(join(out, "report.partial.json"), JSON.stringify({ report, unreached, shots }, null, 2));
}

// ---- The style guide's specimens for the same states (the guide is a static page the server serves). ----
const GUIDE_IDS = ["t-conflict", "lib-conflict-notice", "c-confirm", "c-history", "t-read-only-window"];
const guideShots: { id: string; n: number; width: number }[] = [];
if (want("guide")) {
  const guideServer = await startServer(port, { settings: "empty" });
  try {
    for (const width of WIDTHS) {
      const page = await launch(`${origin}/style-guide.html`, { width, height: 3000, scheme: "light", debugPort: port + 5002 });
      try {
        await page.waitFor(`!!document.getElementById("t-conflict")`, 60_000);
        for (const id of GUIDE_IDS) {
          const count = await page.evaluate(`document.querySelectorAll("#${id} .specimen").length`) as number;
          for (let n = 0; n < count; n++) {
            for (const value of ["light", "dark"] as const) {
              await page.colorScheme(value);
              await page.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
              await page.evaluate(`document.querySelectorAll("#${id} .specimen")[${n}].scrollIntoView({ block: "start" }); window.scrollBy(0, -100)`); await page.wait(250);
              const clip = await page.evaluate(`(() => { const r = document.querySelectorAll("#${id} .specimen")[${n}].getBoundingClientRect(); return { x: Math.max(0, r.x) + scrollX, y: Math.max(0, r.y) + scrollY,
                width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, 1600) }; })()`) as { x: number; y: number; width: number; height: number };
              await page.screenshot(join(out, `guide-${id}-${n}-${value}-${width}.png`), clip);
            }
            guideShots.push({ id, n, width });
          }
        }
      } finally { await page.close(); }
    }
  } finally { guideServer.server.kill(); await guideServer.server.exited; }
}

// ---- review.html: each app capture beside its guide specimens. ----
const image = (file: string, caption: string) => `<figure><figcaption>${caption}</figcaption><a href="${file}"><img src="${file}"></a></figure>`;
const body = WIDTHS.map(width => `<h1>${width} px window</h1>${shots.filter(shot => shot.width === width).map(shot => `<section><h2>${shot.state}${shot.check ? "" : " (its proof did not hold)"}</h2><p>${shot.shows}</p>
  <h3>App</h3><div class="row">${(["light", "dark"] as const).map(value => image(`${shot.state}-${value}-${width}.png`, value)).join("")}</div>
  ${shot.guide.length ? `<h3>Guide specimens (${shot.guide.join(", ")})</h3><div class="row">${guideShots.filter(item => item.width === width && shot.guide.includes(item.id)).flatMap(item =>
    (["light", "dark"] as const).map(value => image(`guide-${item.id}-${item.n}-${value}-${width}.png`, `${item.id} #${item.n + 1} · ${value}`))).join("")}</div>` : ""}</section>`).join("")}`).join("");
writeFileSync(join(out, "review.html"), `<!doctype html><meta charset="utf-8"><title>UI-190 review</title><style>body{font:14px system-ui;margin:24px;background:#fff;color:#111}section{margin:0 0 36px;padding-bottom:24px;border-bottom:1px solid #ccc}
.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}img{max-width:760px;border:1px solid #888}h1{margin-top:48px}h3{margin:12px 0 4px;font-size:13px;color:#555}</style>${body}${
  unreached.length ? `<h2>Not reached</h2><pre>${JSON.stringify(unreached, null, 2)}</pre>` : ""}`);
writeFileSync(join(out, "report.json"), JSON.stringify({ report, unreached, shots, guideShots }, null, 2));
rmSync(join(out, "report.partial.json"), { force: true });
await removeProfiles();
console.log(JSON.stringify({ out, shots: shots.length, unreached }, null, 1));
