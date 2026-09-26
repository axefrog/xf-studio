import { ModInstallActions, type BuiltMod } from "./mod-install-actions";

/** The page's transport to its host (`/api/mod-install`). */
export function createBrowserModInstall(builds: () => readonly BuiltMod[], endpoint = "/api/mod-install") {
  return new ModInstallActions(async body => {
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) });
    let data: unknown = null;
    try { data = await response.json(); } catch { /* A non-JSON answer is a failure with the plain fallback. */ }
    return { ok: response.ok, status: response.status, data };
  }, builds);
}
