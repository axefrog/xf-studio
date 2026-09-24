import { LocalSetupActions } from "./local-setup-actions";

export function createBrowserLocalSetup() {
  return new LocalSetupActions(async (method, body) => {
    const response = await fetch("/api/local-settings", { method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined });
    return { ok: response.ok, status: response.status, data: await response.json() };
  });
}
