/**
 * The releases adapter for the update check (`update-check.ts`): lists XF Studio's published releases from GitHub's public API,
 * unauthenticated, and says plainly why when it can't (offline, GitHub's rate limit, anything else). Drafts are left out;
 * pre-releases are kept. No policy here: when to check and what to show is the service's.
 */
import type { CheckFailure, ReleaseInfo, ReleaseList, ReleaseSource } from "./update-check";

export const RELEASES_API = "https://api.github.com/repos/axefrog/xf-studio/releases?per_page=30";
/** A check that takes longer than this gives up as offline. */
export const RELEASES_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

/** The host's HTTP request function, passed in by the host (a simulated one in tests), so this module reads no network itself. */
type Get = (input: string, init: RequestInit) => Promise<Response>;

/** The releases in a GitHub API answer: tags of published releases, drafts left out. */
export function releasesFromGitHub(data: unknown): ReleaseInfo[] | null {
  if (!Array.isArray(data)) return null;
  return data.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const { tag_name: tag, draft, prerelease } = item as Record<string, unknown>;
    if (draft !== false || typeof tag !== "string" || tag.length > 64) return [];
    return [{ version: tag.replace(/^v/, ""), tag, prerelease: prerelease === true }];
  });
}

const failed = (reason: CheckFailure): ReleaseList => ({ ok: false, reason });

export function gitHubReleases(get: Get, options: { url?: string; timeoutMs?: number; userAgent?: string } = {}): ReleaseSource {
  return async signal => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? RELEASES_TIMEOUT_MS);
    let response: Response;
    try {
      response = await get(options.url ?? RELEASES_API, { signal: AbortSignal.any([signal, timeout]), redirect: "follow",
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": options.userAgent ?? "XF-Studio" } });
    } catch {
      return failed(signal.aborted ? "unavailable" : "offline");
    }
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) return failed("rate_limited");
    if (!response.ok) return failed("unavailable");
    try {
      const text = await response.text();
      if (text.length > MAX_BYTES) return failed("unavailable");
      const releases = releasesFromGitHub(JSON.parse(text));
      return releases ? { ok: true, releases } : failed("unavailable");
    } catch {
      return failed(signal.aborted || timeout.aborted ? "offline" : "unavailable");
    }
  };
}

export const SIMULATED_RELEASE_KINDS = ["newer", "current", "offline", "slow"] as const;
export type SimulatedReleaseKind = typeof SIMULATED_RELEASE_KINDS[number];
/** How long the `slow` fixture takes to answer: long enough to look at a check in progress. */
export const SLOW_RELEASES_MS = 6000;
/** Waiting, from the host (this module reads no timers); it ends early when the check is abandoned. */
export type ReleaseWait = (ms: number, signal: AbortSignal) => Promise<void>;

/**
 * A simulated release source for tests and interface reviews (an isolated localhost server with `XFS_UPDATE_CHECK_FIXTURE`):
 * `newer` publishes a version after `installed`, `current` publishes `installed` itself, `offline` never answers, and `slow`
 * answers as `offline` does, but only after `wait` (so a check in progress, and a re-check after it, can be seen).
 */
export function simulatedReleases(kind: SimulatedReleaseKind, installed: string, wait?: ReleaseWait): ReleaseSource {
  return async signal => {
    if (kind === "slow") await wait?.(SLOW_RELEASES_MS, signal);
    if (kind === "offline" || kind === "slow") return failed("offline");
    const tag = kind === "current" ? `v${installed}` : "v0.2.0-beta.1";
    return { ok: true, releases: [{ version: tag.slice(1), tag, prerelease: true }] };
  };
}
