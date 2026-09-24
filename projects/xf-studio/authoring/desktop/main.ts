import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createDesktopServer } from "./server";
import { desktopVersionFromMetadata } from "./host";
import { DesktopWorkspaceClose, desktopFlushScript } from "./workspace-close";

let metadata: unknown;
try { metadata = JSON.parse(readFileSync(resolve(PATHS.RESOURCES_FOLDER, "version.json"), "utf8")); }
catch { console.error("Packaged XF Studio version metadata could not be read."); }
const version = desktopVersionFromMetadata(metadata);
if (version.metadataStatus === "unavailable") console.error("Packaged XF Studio version metadata is unavailable or invalid.");
const viewRoot = resolve(PATHS.VIEWS_FOLDER, "studio");
const app = createDesktopServer(viewRoot, Utils.paths.userData, version, resolve(viewRoot, "check-worker.js"),
  resolve(PATHS.RESOURCES_FOLDER, "app", "build-tools"));
console.log(`XF desktop loopback ready on 127.0.0.1:${app.port}`);
const window = new BrowserWindow({
  title: "XF Studio",
  url: app.url,
  frame: { width: 1440, height: 900 },
});
console.log("XF desktop WebView2 window created");
const close = new DesktopWorkspaceClose({
  requestFlush: nonce => window.webview.executeJavascript(desktopFlushScript(nonce)),
  close: () => { window.close(); },
  report: message => window.webview.executeJavascript(`window.xfDesktopWorkspaceError?.(${JSON.stringify(message)})`),
});
app.onWorkspaceCloseAck((nonce, status) => close.acknowledge(nonce, status));
window.on("will-close", event => close.request(event as { response?: { allow: boolean } }));
Electrobun.events.on("before-quit", event => {
  app.beforeQuit(event as { response?: { allow: boolean } });
  if (event.response?.allow !== false) app.stop();
});
void window;
