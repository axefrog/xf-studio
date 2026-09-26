import { readFileSync } from "node:fs";
import type { WebView2Status } from "./webview2";
import { entryLine, type DiagnosticEntry } from "../src/diagnostics/model";
import { redactText } from "../src/diagnostics/redact";

/** How long the host waits for the WebView to request the Studio page before explaining. */
export const BLANK_WINDOW_TIMEOUT_MS = 20_000;
/**
 * Shorter when the documented registry check finds no WebView2 Runtime. The window is still
 * created first, so a runtime found some other way loads normally and no notice appears.
 */
export const MISSING_WEBVIEW2_TIMEOUT_MS = 5_000;

export type BlankWindowNotice = {
  message: string; detail: string; buttons: string[];
  action: "download-webview2" | "copy-diagnostics"; diagnostics: string;
};

/** Plain words and one next step for a window that never loaded, never a silent blank screen. */
export function blankWindowNotice(webView2: WebView2Status, logPath: string,
  readLog = (path: string) => readFileSync(path, "utf8")): BlankWindowNotice {
  let tail = "";
  // The structured log's lines as plain lines; redacted, since the person pastes this into a public report.
  try { tail = readLog(logPath).split("\n").filter(Boolean).slice(-40).map(line => {
    try { return entryLine(JSON.parse(line) as DiagnosticEntry); } catch { return line; }
  }).join("\n"); } catch { /* No log yet. */ }
  const diagnostics = redactText(`XF Studio startup diagnostics\nWebView2: ${webView2.installed ? webView2.version ?? webView2.source : "not detected"}\n` +
    `Log: ${logPath}\n\n${tail}`);
  if (!webView2.installed) return {
    message: "XF Studio needs the Microsoft Edge WebView2 Runtime.",
    detail: "It's a free Microsoft component that shows XF Studio's window, and most Windows 10 and 11 PCs already have it. " +
      "Install the Evergreen WebView2 Runtime from Microsoft, then open XF Studio again.",
    buttons: ["Open the Microsoft download page", "Close"], action: "download-webview2", diagnostics,
  };
  return {
    message: "XF Studio couldn't show its window.",
    detail: `The app started, but its window didn't load within ${BLANK_WINDOW_TIMEOUT_MS / 1000} seconds. ` +
      "Try opening it again. If it keeps happening, copy the diagnostics and include them when you report the problem. " +
      `Details are also saved in ${logPath}.`,
    buttons: ["Copy diagnostics", "Close"], action: "copy-diagnostics", diagnostics,
  };
}
