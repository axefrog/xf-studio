/** Attach to a disposable Electrobun WebView2 debugging port for a private acceptance trial. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Pass the disposable WebView2 debugging port.");
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{
  type: string; url: string; webSocketDebuggerUrl: string;
}>;
const page = targets.find(target => target.type === "page" && /^http:\/\/127\.0\.0\.1:\d+\//.test(target.url));
if (!page) throw Error("No local WebView2 page target was exposed.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = reject; });
let id = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
socket.onmessage = event => {
  const message = JSON.parse(String(event.data));
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(Error(message.error.message));
  else request.resolve(message.result);
};
function send(method: string, params: Record<string, unknown> = {}) {
  return new Promise<any>((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
}
async function evaluate(expression: string) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
await send("Runtime.enable");
const dataRoot = await evaluate(`(async () => {
  const response = await fetch('/api/desktop/capabilities');
  return response.ok ? (await response.json()).userDataPath : null;
})()`);
if (typeof dataRoot !== "string" || !/[\\/]dev\.axefrog\.xf-studio-ui-trial-[a-z0-9]+[\\/]/i.test(dataRoot))
  throw Error("Refusing to attach: target is not a disposable XF Studio UI-trial identity.");
if (process.argv[3] === "--close") { await send("Page.close"); socket.close(); console.log("WebView close requested."); process.exit(0); }
if (process.argv[3] === "--screenshot") {
  const path = process.argv[4];
  if (!path) throw Error("Pass a private screenshot path.");
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(screenshot.data, "base64"));
  socket.close();
  console.log("Private WebView screenshot captured.");
  process.exit(0);
}
if (!new URL(page.url).searchParams.has("verify")) {
  const url = new URL(page.url);
  url.searchParams.set("verify", "1");
  await send("Page.navigate", { url: url.href });
  for (let attempts = 0; attempts < 100; attempts++) {
    if (await evaluate("Boolean(document.querySelector('#studio.studio-ready') && window.xfStudioPresentation)")) break;
    await Bun.sleep(150);
  }
}
let expression = process.argv[3];
if (expression?.startsWith("@")) expression = readFileSync(expression.slice(1), "utf8")
  .replaceAll("__PREPARED_PATH__", JSON.stringify(process.env.XFS_TRIAL_PREPARED ?? ""))
  .replaceAll("__SETUP_FIELDS__", JSON.stringify(process.env.XFS_TRIAL_SETTINGS_FILE ?
    JSON.parse(readFileSync(process.env.XFS_TRIAL_SETTINGS_FILE, "utf8")) : {}));
const state = await evaluate(expression ?? `(() => ({
  title: document.title,
  href: location.origin,
  native: Boolean(window.__electrobunWebviewId),
  ready: document.querySelector('#studio')?.className,
  assetMode: document.documentElement.dataset.desktopPreviewAssets,
  intake: Boolean(document.querySelector('#desktop-intake-open')),
  preview: window.xfStudioPresentation?.viewport.snapshot(),
  controls: [...document.querySelectorAll('button')].slice(0, 45).map(x => ({id:x.id, text:x.textContent?.trim().slice(0,60)})),
}))()`);
console.log(JSON.stringify(state, null, 2));
socket.close();
