/**
 * The update check's host side: what was found, kept in a small file beside the settings, and the endpoint the page asks.
 * `POST {action: "startup"}` is the check at start (the service decides whether it runs), `POST {action: "check"}` the person's
 * own check, `POST {action: "skip", version}` stops announcing a version, and `GET` returns the last answer without asking GitHub.
 * The request's own signal cancels a check the page no longer waits for.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBodyText } from "./request-body";
import { emptyUpdateCheckMemory, parseVersion, UpdateCheckService, type ReleaseSource, type UpdateCheckMemory, type UpdateCheckStore } from "./update-check";

const FILE = "update-check.json";
const SCHEMA = "xfs/update-check-memory-1";

/** What the update check found, in `<settings>/update-check.json`. An unreadable file reads as empty; nothing in it is personal. */
export class UpdateCheckFileStore implements UpdateCheckStore {
  private readonly path: string;
  constructor(private readonly directory: string) { this.path = join(directory, FILE); }
  load(): UpdateCheckMemory {
    try {
      if (!existsSync(this.path)) return emptyUpdateCheckMemory();
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      if (data?.schema !== SCHEMA) return emptyUpdateCheckMemory();
      const latest = data.latest && parseVersion(data.latest.tag) && typeof data.latest.version === "string"
        ? { version: data.latest.version as string, tag: data.latest.tag as string, prerelease: data.latest.prerelease === true } : null;
      return { checkedAt: Number.isSafeInteger(data.checkedAt) ? data.checkedAt : null, latest,
        skipped: typeof data.skipped === "string" && parseVersion(data.skipped) ? data.skipped : null };
    } catch { return emptyUpdateCheckMemory(); }
  }
  save(memory: UpdateCheckMemory) {
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schema: SCHEMA, ...memory }, null, 1));
    renameSync(temporary, this.path);
  }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function createUpdateCheckHandler(service: UpdateCheckService) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ code: "forbidden", error: "Use XF Studio itself to check for updates." }, 403);
    if (request.method === "GET") return json(service.status());
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ code: "forbidden", error: "Use XF Studio itself to check for updates." }, 403);
    let body: Record<string, unknown>;
    try { body = JSON.parse(await readBodyText(request, 1024)); } catch { return json({ code: "invalid", error: "Unknown request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "invalid", error: "Unknown request." }, 400);
    const keys = Object.keys(body).sort().join(",");
    if (body.action === "startup" && keys === "action") return json(await service.startup(request.signal));
    if (body.action === "check" && keys === "action") return json(await service.check(request.signal));
    if (body.action === "skip" && keys === "action,version" && parseVersion(body.version)) return json(service.skip(body.version as string));
    return json({ code: "invalid", error: "Unknown request." }, 400);
  };
}

/**
 * The two endpoints a host serves: `/api/update-check` for the person's settings, and `/api/verification/update-check` for a verification
 * workspace, which keeps what it found in its own settings folder and follows its own copy of the Settings switch (UI-98).
 */
export function updateCheckEndpoints(options: { installed: string; releases: ReleaseSource; now: () => number;
  settings: { directory: string; checkOnStart(): boolean }; verification: { directory: string; checkOnStart(): boolean } }) {
  const service = (place: { directory: string; checkOnStart(): boolean }) => new UpdateCheckService({ installed: options.installed,
    releases: options.releases, now: options.now, store: new UpdateCheckFileStore(place.directory),
    // An unreadable settings file leaves the check at start as it is by default: on.
    automatic: () => { try { return place.checkOnStart(); } catch { return true; } } });
  return { "/api/update-check": createUpdateCheckHandler(service(options.settings)),
    "/api/verification/update-check": createUpdateCheckHandler(service(options.verification)) } as const;
}
