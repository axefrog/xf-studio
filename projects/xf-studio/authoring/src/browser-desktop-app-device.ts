import { hostRequest } from "./browser-host-request";
import { DesktopAppActions } from "./desktop-app";

/** The localhost page's desktop-app device: GET for the status, POST only for the confirmed launch. */
export function createBrowserDesktopApp(endpoint: string) {
  return new DesktopAppActions({
    status: () => hostRequest(endpoint, { cache: "no-store" }),
    launch: body => hostRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
