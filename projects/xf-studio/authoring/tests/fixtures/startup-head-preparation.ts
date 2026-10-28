import { DEFAULT_CHARACTER } from "../../src/character/character-detail-request";

/** Derive the same real files before Chrome starts, so exporter/resolver peaks cannot overlap browser rendering. */
export async function prepareReleaseHead(origin: string, request: typeof fetch = fetch, timeoutMs = 180_000): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  for (const [endpoint, body] of [["/api/preview-core", { action: "prepare" }], ["/api/preview-character", DEFAULT_CHARACTER]] as const) {
    for (;;) {
      signal.throwIfAborted();
      // Repeating the same request joins preparation and renews the character request's existing lease.
      const response = await request(origin + endpoint, { method: "POST", signal,
        headers: { Origin: origin, "Content-Type": "application/json", "X-XFS-Page": "core-release-preparation" }, body: JSON.stringify(body) });
      const state = await response.json() as { phase: string; message?: string };
      if (!response.ok) throw Error(`${endpoint}: HTTP ${response.status} (${state.message ?? state.phase})`);
      if (state.phase === "ready") break;
      if (state.phase !== "preparing") throw Error(`${endpoint}: ${state.phase} (${state.message ?? "not ready"})`);
      await Bun.sleep(250);
    }
  }
}
