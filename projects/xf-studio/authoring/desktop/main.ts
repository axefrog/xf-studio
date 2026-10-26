import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { machineInstallReceiptsRoot } from "../src/setup/host/host-state";
import { createDesktopServer } from "./server";
import { logUnhandledRejections } from "../src/diagnostics/host/host-log";
import { desktopVersionFromMetadata } from "./host";
import { DesktopWorkspaceClose, desktopFlushScript } from "./workspace-close";
import { createHostLog } from "./host-log";
import { detectWebView2, WEBVIEW2_DOWNLOAD_URL } from "./webview2";
import { ensureWebView2 } from "./webview2-install";
import { blankWindowNotice, BLANK_WINDOW_TIMEOUT_MS, installRefreshRequested, MISSING_WEBVIEW2_TIMEOUT_MS, mainWindowPlacement } from "./startup-watchdog";
import { claimSingleInstance, INSTANCE_HEADER, INSTANCE_ROUTE, windowsMutex } from "./single-instance";
import { mkdirSync } from "node:fs";

// The launch Electrobun's setup makes of the app it just installed, during a scripted refresh (tools/refresh-installed.ps1),
// ends here: before the log, the data folder, the instance lock, any window or server.
if (installRefreshRequested(process.env)) {
  Utils.quit(0);
  setTimeout(() => process.exit(0), 3000);
  await new Promise(() => {});
}

// The packaged app has no console: startup facts and failures go to the structured
// diagnostics log in the app's data folder, and the user never faces a silent blank window.
const log = createHostLog(Utils.paths.userData);
let metadata: unknown;
try { metadata = JSON.parse(readFileSync(resolve(PATHS.RESOURCES_FOLDER, "version.json"), "utf8")); }
catch { log.write("Packaged XF Studio version metadata could not be read."); }
const version = desktopVersionFromMetadata(metadata);
log.write(`Starting XF Studio ${version.version} (${version.channel}, build ${version.buildHash}); Windows ${process.platform}/${process.arch}.`);

// One XF Studio per user data folder (profiles design §2.3): a second launch brings the running window forward and quits, so two host
// processes never share the workspace file.
mkdirSync(Utils.paths.userData, { recursive: true });
// Fail closed: a launch that can't check the lock never starts, and says so (the details go to the diagnostics log).
let instance: Awaited<ReturnType<typeof claimSingleInstance>>;
try {
  instance = await claimSingleInstance(Utils.paths.userData, { pid: process.pid, lock: windowsMutex(),
    sleep: ms => new Promise(done => setTimeout(done, ms)),
    activate: async (port, token) => (await fetch(`http://127.0.0.1:${port}${INSTANCE_ROUTE}`, { method: "POST",
      headers: { [INSTANCE_HEADER]: token }, signal: AbortSignal.timeout(3000) })).status === 204 });
} catch (error) {
  await fatal("XF Studio couldn't check whether it's already running, so it didn't start.",
    `This keeps two copies from saving over each other. Restart your computer and open XF Studio again. If this keeps happening, ` +
    `report a problem on XF Studio's GitHub page and include the diagnostics log: ${log.path}.`, error);
  throw error;
}
if (!instance.first) {
  log.write(instance.activated ? "XF Studio is already running; its window was brought forward."
    : "XF Studio is already running (it didn't answer yet, so its window wasn't brought forward); this launch ends.");
  Utils.quit(0);
  await new Promise(() => {});
}
/** Brings the window forward for a second launch; set once the window exists. */
let focusWindow = () => {};

// Before any window: a missing WebView2 Runtime is installed with one consent click using
// Microsoft's bootstrapper packaged with the app, instead of showing an empty window.
const bootstrapper = resolve(PATHS.RESOURCES_FOLDER, "app", "webview2", "MicrosoftEdgeWebview2Setup.exe");
const runtime = await ensureWebView2({
  detect: () => detectWebView2(),
  ask: async options => (await Utils.showMessageBox({ ...options, title: "XF Studio", defaultId: 0,
    cancelId: options.buttons.length - 1 })).response,
  bootstrapperAvailable: () => existsSync(bootstrapper),
  runBootstrapper: async () => {
    try {
      // Not /silent: Microsoft's installer shows its own progress while it downloads.
      const child = Bun.spawn([bootstrapper, "/install"], { stdio: ["ignore", "ignore", "ignore"] });
      const timer = setTimeout(() => child.kill(), 10 * 60_000);
      const code = await child.exited;
      clearTimeout(timer);
      return code;
    } catch (error) { log.write(`WebView2 bootstrapper could not start: ${error}`); return null; }
  },
  openDownloadPage: () => { Utils.openExternal(WEBVIEW2_DOWNLOAD_URL); },
  log: message => log.write(message),
});
if (!runtime.ready) { Utils.quit(runtime.reason === "declined" ? 0 : 1); await new Promise(() => {}); }
const webView2 = runtime.ready ? runtime.status : detectWebView2();
log.write(`WebView2 ${webView2.version ?? "fixed"} via ${webView2.source}${runtime.ready && runtime.installed ? " (installed just now)" : ""}.`);

async function fatal(message: string, detail: string, error?: unknown) {
  log.failure(message, error);
  await Utils.showMessageBox({ type: "error", title: "XF Studio", message, detail, buttons: ["Close"] });
  Utils.quit(1);
}

const viewRoot = resolve(PATHS.VIEWS_FOLDER, "studio");
let app: ReturnType<typeof createDesktopServer>;
try {
  app = createDesktopServer(viewRoot, Utils.paths.userData, version, resolve(viewRoot, "check-worker.js"),
    resolve(PATHS.RESOURCES_FOLDER, "app", "build-tools"), undefined, undefined, undefined,
    { openExternal: url => Utils.openExternal(url), webView2: webView2.version, nativeDecodeWorker: resolve(viewRoot, "native-decode-worker.js"),
      instance: instance.first ? { token: instance.token, focus: () => focusWindow() } : undefined,
      // Install receipts are per user on this computer, shared with localhost (INSTALL-04).
      installReceipts: machineInstallReceiptsRoot(),
      revealPath: path => { Utils.showItemInFolder(path); return true; },
      pickFolder: async start => (await Utils.openFileDialog({ startingFolder: start ?? "~/", canChooseFiles: false, canChooseDirectory: true,
        allowsMultipleSelection: false }))[0] || null });
} catch (error) {
  await fatal("XF Studio couldn't start.", `Your data folder may be unavailable: ${Utils.paths.userData}. ` +
    `Details are in ${log.path}.`, error);
  throw error;
}
log.write(`Loopback server ready on 127.0.0.1:${app.port}.`);
if (instance.first && app.port) instance.publish(app.port);
// A background failure nobody caught goes to the diagnostics log; it never closes the app (PREV-101).
logUnhandledRejections();
const origin = `http://127.0.0.1:${app.port}`;
const placement = mainWindowPlacement(Utils.paths.userData, process.env);
const window = new BrowserWindow({
  title: "XF Studio",
  url: app.url,
  frame: { width: 1440, height: 900, ...placement.position },
  activate: placement.activate,
  // The window only ever shows this app's own loopback page; downloads use its blob: URLs.
  // Electrobun rules: "^" blocks, "*" is a wildcard and the last matching rule wins.
  navigationRules: JSON.stringify(["^*", `${origin}/*`, `blob:${origin}/*`, "about:blank"]),
});
log.write("Window created.");
focusWindow = () => { window.unminimize(); window.activate(); };
const close = new DesktopWorkspaceClose({
  requestFlush: nonce => window.webview.executeJavascript(desktopFlushScript(nonce)),
  close: () => { window.close(); },
  report: message => window.webview.executeJavascript(`window.xfDesktopWorkspaceError?.(${JSON.stringify(message)})`),
  rendererReady: () => app.renderer().bootstrapped,
  confirmCloseWithoutSaving: async () => {
    log.write("Closing: the latest workspace save failed; asking whether to close without saving.");
    const { response } = await Utils.showMessageBox({ type: "warning", title: "XF Studio",
      message: "Your latest changes couldn't be saved.",
      detail: "Keep XF Studio open to try again or export your collection from the Library panel. " +
        "If you close now, changes since the last successful save are lost; your saved library is not affected.",
      buttons: ["Keep XF Studio open", "Close without saving"], defaultId: 0, cancelId: 0 });
    return response === 1;
  },
});
app.onWorkspaceCloseAck((nonce, status) => close.acknowledge(nonce, status));
window.on("will-close", event => close.request(event as { response?: { allow: boolean } }));
Electrobun.events.on("before-quit", event => {
  app.beforeQuit(event as { response?: { allow: boolean } });
  if (event.response?.allow !== false) { app.stop(); if (instance.first) instance.release(); }
});

// Blank-window watchdog: if the WebView never asks for the Studio page, explain
// why in a native message instead of leaving an empty white window.
setTimeout(async () => {
  const renderer = app.renderer();
  if (renderer.pageServed) return;
  const notice = blankWindowNotice(webView2, log.path);
  log.write(`Watchdog: the window did not load the Studio page. ${notice.message}`);
  const { response } = await Utils.showMessageBox({ type: "error", title: "XF Studio", message: notice.message,
    detail: notice.detail, buttons: notice.buttons, defaultId: 0, cancelId: notice.buttons.length - 1 });
  if (notice.action === "download-webview2" && response === 0) Utils.openExternal(WEBVIEW2_DOWNLOAD_URL);
  if (notice.action === "copy-diagnostics" && response === 0) Utils.clipboardWriteText(notice.diagnostics);
  if (!app.renderer().pageServed) Utils.quit(1);
}, webView2.installed ? BLANK_WINDOW_TIMEOUT_MS : MISSING_WEBVIEW2_TIMEOUT_MS);
void window;
