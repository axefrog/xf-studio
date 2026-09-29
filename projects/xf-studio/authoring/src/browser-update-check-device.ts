import { UpdateCheckActions } from "./update-check-actions";

/** The page's update-check device: one POST per action to the host's endpoint, which alone talks to GitHub. */
export function createBrowserUpdateCheck(endpoint: string) {
  return new UpdateCheckActions(async (body, signal) => {
    const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
  });
}
