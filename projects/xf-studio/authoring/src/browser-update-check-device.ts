import { hostClock } from "./platform/graph-adapters/host-sources";
import { hostRequest } from "./browser-host-request";
import { UpdateCheckActions } from "./update-check-actions";

/** The page's update-check device: one POST per action to the host's endpoint, which alone talks to GitHub; timers from the page's clock. */
export function createBrowserUpdateCheck(endpoint: string) {
  return new UpdateCheckActions((body, signal) => hostRequest(endpoint, { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), hostClock(requestAnimationFrame, cancelAnimationFrame));
}
