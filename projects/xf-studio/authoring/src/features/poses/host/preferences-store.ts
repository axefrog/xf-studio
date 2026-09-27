import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPosePreferences, parsePosePreferences, type PosePreferences } from "../preferences";

/**
 * The Poses panel's per-user document (`xfs/pose-preferences-1`, ../preferences.ts), one JSON file beside the host's local settings: the
 * per-user settings folder on localhost (its own data folder when isolated), the desktop's user-data folder. A verification workspace
 * (`?verify`) has its own copy in its settings folder, which starts from the person's (read only, through `seed`) and keeps every change
 * to itself, like its local settings (UI-98). Writes are whole documents behind a revision guard, written atomically; an unreadable file
 * reads as the defaults and is replaced on the next write.
 */
export const POSE_PREFERENCES_FILE = "pose-preferences.json";
export const POSE_PREFERENCES_STATE = "xfs/pose-preferences-state-1";
export type PosePreferencesState = { readonly schema: typeof POSE_PREFERENCES_STATE; readonly revision: number; readonly preferences: PosePreferences };

export class PosePreferencesStore {
  private revision = 0;
  private cached: PosePreferences | null = null;
  constructor(private readonly directory: string, private readonly options: { seed?: () => PosePreferences | null } = {}) {}
  private get path() { return join(this.directory, POSE_PREFERENCES_FILE); }
  load(): PosePreferencesState {
    if (!this.cached) {
      let value: unknown = null;
      try { if (existsSync(this.path)) value = JSON.parse(readFileSync(this.path, "utf8")); } catch { value = null; }
      this.cached = value ? parsePosePreferences(value) : this.options.seed?.() ?? defaultPosePreferences();
    }
    return { schema: POSE_PREFERENCES_STATE, revision: this.revision, preferences: this.cached };
  }
  /** Replace the document if `revision` is the current one; otherwise answer the current state with `conflict`. */
  save(revision: number, value: unknown): { ok: true; state: PosePreferencesState } | { ok: false; state: PosePreferencesState } {
    const current = this.load();
    if (revision !== current.revision) return { ok: false, state: current };
    const preferences = parsePosePreferences(value);
    mkdirSync(this.directory, { recursive: true });
    // Written beside the file, then renamed over it, so a crash never leaves half a document.
    const temporary = `${this.path}.${process.pid}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(preferences, null, 1)); renameSync(temporary, this.path); }
    catch (error) { rmSync(temporary, { force: true }); throw error; }
    this.cached = preferences; this.revision++;
    return { ok: true, state: this.load() };
  }
}

const REQUEST_BYTES = 512 * 1024;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/**
 * `GET` → the state; `POST {revision, preferences}` → the saved state, or 409 with the current one when another window saved first. Same
 * origin only, like the other local endpoints; the page names no path.
 */
export function createPosePreferencesHandler(store: PosePreferencesStore) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ code: "forbidden", error: "Use the local studio to keep your poses." }, 403);
    try {
      if (request.method === "GET") return json(store.load());
      if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
      if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
        return json({ code: "forbidden", error: "Use the local studio to keep your poses." }, 403);
      const text = await request.text();
      if (text.length > REQUEST_BYTES) return json({ code: "too_large", error: "The request is too large." }, 413);
      const body = JSON.parse(text) as { revision?: unknown; preferences?: unknown };
      if (!Number.isInteger(body?.revision)) return json({ code: "invalid", error: "Unknown request." }, 400);
      const saved = store.save(body.revision as number, body.preferences);
      return saved.ok ? json(saved.state) : json({ ...saved.state, code: "conflict" }, 409);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ code: "invalid", error: "The request isn't valid JSON." }, 400);
      return json({ code: "failed", error: "XF Studio couldn't keep your pose favourites just now. Try again." }, 503);
    }
  };
}
