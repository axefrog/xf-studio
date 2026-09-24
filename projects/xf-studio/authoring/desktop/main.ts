import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createDesktopServer } from "./server";
import type { DesktopVersion } from "./host";

const metadata = JSON.parse(readFileSync(resolve(PATHS.RESOURCES_FOLDER, "version.json"), "utf8"));
if (!/^\d+\.\d+\.\d+/.test(metadata.version) || !["dev", "canary", "stable"].includes(metadata.channel))
  throw Error("Packaged XF Studio version metadata is invalid.");
const version: DesktopVersion = { version: metadata.version, channel: metadata.channel };
const app = createDesktopServer(resolve(PATHS.VIEWS_FOLDER, "studio"), Utils.paths.userData, version);
console.log(`XF desktop loopback ready on 127.0.0.1:${app.port}`);
const window = new BrowserWindow({
  title: "XF Studio",
  url: app.url,
  frame: { width: 1440, height: 900 },
});
console.log("XF desktop WebView2 window created");
Electrobun.events.on("before-quit", () => app.stop());
void window;
