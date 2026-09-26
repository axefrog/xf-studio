import { LocalSetupActions, type FolderPicker } from "./local-setup-actions";

/** The page's settings service over `/api/local-settings`; `pickFolder` is the host's native folder picker, when it has one. */
export function createBrowserLocalSetup(options: { pickFolder?: FolderPicker } = {}) {
  return new LocalSetupActions(async (method, body) => {
    const response = await fetch("/api/local-settings", { method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined });
    return { ok: response.ok, status: response.status, data: await response.json() };
  }, options.pickFolder ?? null);
}

/** The desktop app's native folder picker (`/api/desktop/pick-folder`): the chosen folder, or null when cancelled. */
export const desktopFolderPicker: FolderPicker = async field => {
  const response = await fetch("/api/desktop/pick-folder", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }) });
  const data = await response.json().catch(() => null) as { path?: unknown; error?: unknown } | null;
  if (!response.ok) throw Error(typeof data?.error === "string" ? data.error : "The folder picker couldn't open.");
  return typeof data?.path === "string" && data.path ? data.path : null;
};
