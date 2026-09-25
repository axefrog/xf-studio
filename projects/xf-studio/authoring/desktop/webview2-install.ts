import type { WebView2Status } from "./webview2";

/**
 * Before the first window: if the WebView2 Runtime is missing, ask once and install it with
 * Microsoft's bundled bootstrapper, so a user goes from setup to a working editor with one
 * consent click. Pure policy; the native dialogs and process launch are injected.
 */
export type WebView2InstallPort = {
  detect(): WebView2Status;
  /** Returns the index of the chosen button. */
  ask(options: { type: "question" | "error"; message: string; detail: string; buttons: string[] }): Promise<number>;
  /** Runs Microsoft's bootstrapper (it shows its own progress) and resolves with its exit code (or null if it could not start or timed out). */
  runBootstrapper(): Promise<number | null>;
  bootstrapperAvailable(): boolean;
  openDownloadPage(): void;
  log(message: string): void;
};

export type WebView2Outcome = { ready: true; status: WebView2Status; installed: boolean } | { ready: false; reason: "declined" | "failed" };

export const WEBVIEW2_PROMPT = {
  message: "XF Studio needs the Microsoft Edge WebView2 Runtime.",
  detail: "It's a free Microsoft component that shows XF Studio's window, and most Windows PCs already have it. " +
    "XF Studio can install it for you now: it downloads from Microsoft and usually takes a minute or two.",
  buttons: ["Install it now", "Not now"],
};
export const WEBVIEW2_FAILED = {
  message: "WebView2 couldn't be installed.",
  detail: "Check your internet connection and open XF Studio again to retry, or install the Evergreen WebView2 Runtime from Microsoft's page.",
  buttons: ["Open the Microsoft download page", "Close"],
};

export async function ensureWebView2(port: WebView2InstallPort): Promise<WebView2Outcome> {
  const initial = port.detect();
  if (initial.installed) return { ready: true, status: initial, installed: false };
  port.log("WebView2 Runtime not detected; asking to install it.");
  if (!port.bootstrapperAvailable()) {
    port.log("The bundled WebView2 bootstrapper is missing.");
    if (await port.ask({ type: "error", ...WEBVIEW2_FAILED }) === 0) port.openDownloadPage();
    return { ready: false, reason: "failed" };
  }
  if (await port.ask({ type: "question", ...WEBVIEW2_PROMPT }) !== 0) {
    port.log("The user chose not to install WebView2 now.");
    return { ready: false, reason: "declined" };
  }
  const code = await port.runBootstrapper();
  const after = port.detect();
  port.log(`WebView2 bootstrapper finished with ${code === null ? "no exit code" : `exit ${code}`}; runtime ${after.installed ? after.version : "still missing"}.`);
  if (after.installed) return { ready: true, status: after, installed: true };
  if (await port.ask({ type: "error", ...WEBVIEW2_FAILED }) === 0) port.openDownloadPage();
  return { ready: false, reason: "failed" };
}
