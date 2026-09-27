import { DesktopAppActions } from "./desktop-app";

/** The localhost page's desktop-app device: GET for the status, POST only for the confirmed launch. */
export function createBrowserDesktopApp(endpoint: string) {
  const call = async (init?: RequestInit) => {
    const response = await fetch(endpoint, init);
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
  };
  return new DesktopAppActions({
    status: () => call({ cache: "no-store" }),
    launch: body => call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
