import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Microsoft Edge WebView2 Runtime detection, following Microsoft's documented
 * registry check: a runtime is installed when the Evergreen client key holds a
 * `pv` version that is neither empty nor 0.0.0.0, per machine (32- or 64-bit
 * view) or per user. A fixed-version runtime chosen through
 * WEBVIEW2_BROWSER_EXECUTABLE_FOLDER also counts.
 */
const CLIENT = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
export const WEBVIEW2_KEYS = [
  `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${CLIENT}`,
  `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${CLIENT}`,
  `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${CLIENT}`,
] as const;
/** Microsoft's page for the Evergreen WebView2 Runtime installer. */
export const WEBVIEW2_DOWNLOAD_URL = "https://developer.microsoft.com/microsoft-edge/webview2/#download";

export type WebView2Status = { installed: boolean; version: string | null; source: string | null };

/** Parse `reg query <key> /v pv` output; null for a missing or placeholder version. */
export function parseRegVersion(output: string): string | null {
  const match = /^\s*pv\s+REG_SZ\s+(\S+)\s*$/m.exec(output);
  return match && match[1] !== "0.0.0.0" ? match[1] : null;
}

export function detectWebView2(env: Record<string, string | undefined> = process.env,
  query = (key: string) => spawnSync("reg", ["query", key, "/v", "pv"], { encoding: "utf8", windowsHide: true, timeout: 5000 }).stdout ?? ""): WebView2Status {
  const fixed = env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
  if (fixed && existsSync(fixed)) return { installed: true, version: null, source: "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER" };
  for (const key of WEBVIEW2_KEYS) {
    const version = parseRegVersion(query(key));
    if (version) return { installed: true, version, source: key.split("\\")[0] };
  }
  return { installed: false, version: null, source: null };
}
