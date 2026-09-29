import { DesktopAppActions } from "./desktop-app";

/** One request from the page to its own host, answered as status and parsed JSON (null when the body isn't JSON). Shared by the page's host devices. */
export async function hostRequest(endpoint: string, init?: RequestInit) {
  const response = await fetch(endpoint, init);
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
}

/** The localhost page's desktop-app device: GET for the status, POST only for the confirmed launch. */
export function createBrowserDesktopApp(endpoint: string) {
  return new DesktopAppActions({
    status: () => hostRequest(endpoint, { cache: "no-store" }),
    launch: body => hostRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
