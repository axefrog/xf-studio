/**
 * Runs INSIDE Windows Sandbox with the installed app's own bun.exe (the sandbox has no other
 * JavaScript runtime). Drives the real installed XF Studio window through its WebView2
 * remote-debugging port like a first-time user: welcome, UV editor, an edit and Undo, library
 * save and reload, importing the committed fixture collection and running Check, About and
 * Licences. `--relaunch` checks a later launch instead. Screenshots are of the page only.
 *
 *   bun.exe sandbox-drive.ts <results folder> <fixture collection> [--relaunch]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [results, fixture] = process.argv.slice(2);
const relaunch = process.argv.includes("--relaunch");
const report: Record<string, unknown> = { phase: relaunch ? "relaunch" : "first-run", started: new Date().toISOString() };
const save = () => writeFileSync(resolve(results, relaunch ? "drive-relaunch.json" : "drive.json"), JSON.stringify(report, null, 2));

async function page(): Promise<string> {
  for (let i = 0; i < 120; i++) {
    try {
      const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
      const target = targets.find(item => item.type === "page" && item.url.startsWith("http://127.0.0.1:"));
      if (target) return target.webSocketDebuggerUrl;
    } catch { /* WebView2 still starting. */ }
    await Bun.sleep(1000);
  }
  throw Error("No XF Studio page appeared on the debugging port.");
}

const socket = new WebSocket(await page());
await new Promise((ready, fail) => { socket.onopen = ready; socket.onerror = fail; });
let nextId = 0;
const pending = new Map<number, (value: any) => void>();
socket.onmessage = event => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined) pending.get(message.id)?.(message);
};
function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId;
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error(`${method} timed out`)), 30_000);
    pending.set(id, message => { clearTimeout(timer); message.error ? fail(Error(message.error.message)) : done(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value as T;
}
async function waitFor(expression: string, timeoutMs = 30_000): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const value = await evaluate(expression); if (value) return value; } catch { /* Page reloading. */ }
    await Bun.sleep(250);
  }
  throw Error(`Timed out waiting for ${expression}`);
}
async function shot(name: string) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(results, `${name}.png`), Buffer.from(data, "base64"));
}
async function step(name: string, run: () => Promise<unknown>) {
  try { report[name] = { ok: true, value: await run() }; }
  catch (error) { report[name] = { ok: false, error: String((error as Error).message ?? error) }; }
  save();
}
const click = (selector: string) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error("Missing ${selector.replaceAll('"', "'")}"); el.click(); return true; })()`);
const byLabel = (label: string) => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === ${JSON.stringify(label)})`;
// Panels repaint only while visible, so read library state from the Library panel itself.
const libraryLine = "document.querySelector('.state-line')?.textContent ?? ''";

await send("Page.enable");
await send("Runtime.enable");
await waitFor("document.querySelector('#studio.studio-ready')", 60_000);

if (!relaunch) {
  await step("welcome", async () => {
    await waitFor("document.querySelector('#desktop-welcome')?.open");
    await shot("01-welcome");
    const text = await evaluate<string>("document.querySelector('#desktop-welcome').innerText");
    await click("#desktop-welcome-start");
    await waitFor("!document.querySelector('#desktop-welcome').open");
    return text.slice(0, 200);
  });
  await step("uvEditor", async () => {
    const state = await evaluate(`(() => { const c = document.querySelector('#device-uv-canvas');
      return { width: c?.width, height: c?.height, drawnBytes: c ? c.toDataURL().length : 0,
        head: document.querySelector('.viewport-state')?.innerText ?? null }; })()`);
    await shot("02-uv-editor");
    return state;
  });
  await step("editAndUndo", async () => {
    const field = "document.querySelector('input[aria-label=\"Colour hex value\"]')";
    await click("#dock-tab-finish");
    const before = await evaluate<string>(`${field}.value`);
    await evaluate(`(() => { const f = ${field}; f.value = '#123456'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`${field}.value.toLowerCase() === '#123456'`);
    await shot("03-edited");
    await evaluate(`${byLabel("Undo")}.click()`);
    await waitFor(`${field}.value.toLowerCase() === ${JSON.stringify(before.toLowerCase())}`);
    return { before, edited: "#123456", afterUndo: await evaluate(`${field}.value`) };
  });
  await step("saveAndReload", async () => {
    await click("#dock-tab-library");
    const before = await evaluate<string>(libraryLine);
    await evaluate(`${byLabel("Save")}.click()`);
    await waitFor(`/matches library revision/.test(${libraryLine})`);
    const saved = await evaluate<string>(libraryLine);
    await evaluate("location.reload()");
    await Bun.sleep(1500);
    await waitFor("document.querySelector('#studio.studio-ready')", 60_000);
    await click("#dock-tab-library");
    await waitFor(`/matches library revision/.test(${libraryLine})`);
    await shot("04-saved-reloaded");
    return { before, saved, afterReload: await evaluate(libraryLine) };
  });
  await step("importFixtureAndCheck", async () => {
    await click("#dock-tab-library");
    // Stop the native file dialog; the debugger supplies the file to the same input instead.
    await evaluate("document.getElementById('device-collection-picker').click = () => {}");
    await evaluate(`${byLabel("Import collection…")}.click()`);
    await Bun.sleep(500);
    const { root } = await send("DOM.getDocument");
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#device-collection-picker" });
    await send("DOM.setFileInputFiles", { nodeId, files: [fixture] });
    await Bun.sleep(1000);
    await click("#dock-tab-presets");
    // The committed fixture holds four presets (a fresh draft has one).
    await waitFor("document.querySelector('.list-head .count')?.textContent === '4'", 30_000);
    await click("#dock-tab-package");
    await evaluate(`${byLabel("Check mod export")}.click()`);
    await waitFor("document.querySelector('.package-result .result-card')", 60_000);
    await shot("05-check");
    return { presets: 4, library: await evaluate(libraryLine),
      result: await evaluate<string>("document.querySelector('.package-result .result-card').innerText.slice(0, 400)") };
  });
  await step("aboutAndLicences", async () => {
    await click("#desktop-about-open");
    await shot("06-about");
    const about = await evaluate<string>("document.querySelector('#desktop-about').innerText");
    await click("#desktop-licences-open");
    await waitFor("document.querySelector('#desktop-licence-text').textContent.includes('MIT License')");
    await click("[data-licence-doc='THIRD_PARTY_NOTICES.md']");
    await waitFor("document.querySelector('#desktop-licence-text').textContent.includes('JavaScriptCore')");
    await shot("07-licences");
    await evaluate("document.querySelector('#desktop-licences').close()");
    return about.slice(0, 400);
  });
} else {
  await step("relaunch", async () => {
    await Bun.sleep(2000);
    await shot("08-relaunch");
    await click("#dock-tab-presets");
    await Bun.sleep(500);
    const presets = await evaluate("document.querySelector('.list-head .count')?.textContent");
    await click("#dock-tab-library");
    await Bun.sleep(500);
    return { welcomeOpen: await evaluate("!!document.querySelector('#desktop-welcome')?.open"), presets, library: await evaluate(libraryLine) };
  });
}
report.finished = new Date().toISOString();
save();
socket.close();
process.exit(0);
