import { PoseActions } from "./pose-actions";
import { POSES_ENDPOINT } from "./pose-endpoint";

/** The browser's pose actions over the host endpoint (same origin; the host's own session checks apply). */
export function createBrowserPoses() {
  return new PoseActions(async request => {
    const response = request.method === "GET" ? await fetch(`${POSES_ENDPOINT}?${new URLSearchParams(request.query)}`)
      : await fetch(POSES_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
  });
}
