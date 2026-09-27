import { PoseActions, type PoseTransport } from "./pose-actions";
import { POSE_PREFERENCES_ENDPOINT, POSES_ENDPOINT, VERIFICATION_POSE_PREFERENCES_ENDPOINT } from "./pose-endpoint";

/** The pose catalogue's transport over the host endpoint (same origin; the host's own session checks apply). */
export const browserPoseTransport: PoseTransport = async request => {
  const response = request.method === "GET" ? await fetch(`${POSES_ENDPOINT}?${new URLSearchParams(request.query)}`)
    : await fetch(POSES_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
};

/** The browser's pose actions over the host endpoint. */
export function createBrowserPoses() { return new PoseActions(browserPoseTransport); }

/**
 * The Poses module's host device (features/poses/actions.ts `PoseLibraryDevice`, matched by shape: no module outside the composition
 * reaches a feature): the catalogue transport and the per-user preferences document, a verification workspace's own copy under `?verify`
 * (so a UI test never changes the person's favourites).
 */
export type BrowserPoseLibraryDevice = {
  readonly catalogue: PoseTransport;
  readonly preferences: { load(): Promise<unknown>; save(revision: number, preferences: unknown): Promise<{ ok: boolean; status: number; data: unknown }> };
};
export function createBrowserPoseLibraryDevice(options: { verification: boolean }): BrowserPoseLibraryDevice {
  const endpoint = options.verification ? VERIFICATION_POSE_PREFERENCES_ENDPOINT : POSE_PREFERENCES_ENDPOINT;
  return {
    catalogue: browserPoseTransport,
    preferences: {
      load: async () => { const response = await fetch(endpoint); if (!response.ok) throw Error(`Preferences answered ${response.status}.`); return response.json(); },
      save: async (revision, preferences) => {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, preferences }) });
        return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
      },
    },
  };
}
