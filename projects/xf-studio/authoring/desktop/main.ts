import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createDesktopServer } from "./server";
import { desktopVersionFromMetadata } from "./host";

let metadata: unknown;
try { metadata = JSON.parse(readFileSync(resolve(PATHS.RESOURCES_FOLDER, "version.json"), "utf8")); }
catch { console.error("Packaged XF Studio version metadata could not be read."); }
const version = desktopVersionFromMetadata(metadata);
if (version.metadataStatus === "unavailable") console.error("Packaged XF Studio version metadata is unavailable or invalid.");
const viewRoot = resolve(PATHS.VIEWS_FOLDER, "studio");
const app = createDesktopServer(viewRoot, Utils.paths.userData, version, resolve(viewRoot, "check-worker.js"));
console.log(`XF desktop loopback ready on 127.0.0.1:${app.port}`);
const window = new BrowserWindow({
  title: "XF Studio",
  url: app.url,
  frame: { width: 1440, height: 900 },
});
console.log("XF desktop WebView2 window created");
Electrobun.events.on("before-quit", () => app.stop());
void window;
