import { hostClock } from "../../platform/core/clock";
import { formatFence, WORKSPACE_FENCE_HEADER, type WorkspaceFence } from "../../platform/api/document-store";
import type { MigrationAnswer, MigrationRequest, MigrationResult } from "../profiles/profiles-migration-data";
import { migrated, storedProfilesReady, ProfilesMigration, type ProfilesMigrationOutcome } from "../profiles/profiles-migration";
import type { MigrationMark, WorkspaceProfiles } from "../profiles/profile-session";
import type { DocumentModel } from "../workspace/collection-workspace";
import type { WorkspaceState } from "../workspace/workspace-state";

/**
 * The page's transport for the profiles migration (`/api/profiles/migrate`, or `/api/verification/profiles/migrate`; profiles design
 * §8): the request carries the workspace lease, so the host refuses it from a window that released the workspace. A host that doesn't
 * answer (down or restarting) or fails throws, and the migration sends the same token again; a request it refuses as malformed is
 * answered `refused`.
 */
export function profilesMigrationTransport(endpoint: string, send: (url: string, init?: RequestInit) => Promise<Response>,
  fence?: () => WorkspaceFence | null): (request: MigrationRequest, signal: AbortSignal) => Promise<MigrationAnswer> {
  return async (request, signal) => {
    const lease = fence?.();
    const response = await send(endpoint, { method: "POST", signal, body: JSON.stringify(request),
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(lease ? { [WORKSPACE_FENCE_HEADER]: formatFence(lease) } : {}) } });
    const body = await response.json().catch(() => null) as (MigrationResult & { code?: string; error?: string }) | null;
    if (response.status === 409 && body?.code === "superseded") return { ok: false, reason: "superseded" };
    if (response.status === 400 || response.status === 413) return { ok: false, reason: "refused", ...(body?.error ? { message: body.error } : {}) };
    if (!response.ok || !body) throw Error(body?.error ?? "The library couldn't be reached.");
    return { ok: true, result: body };
  };
}

/**
 * Whether the Studio migrates its workspace at start (on since phase 1d-ii's switch-over: the Studio works on the profile services, and the
 * legacy fields are migration input only, frozen as they were).
 */
export const PROFILES_MIGRATION_ENABLED: boolean = true;

/**
 * Runs the profiles migration for this window's workspace (profiles design §8): only in the window holding the workspace, and only for a
 * workspace it may write. `marks` is the workspace's own holder of the mark and sessions (what the workspace stores); `flush` writes the
 * workspace at once and answers whether it is stored. The Studio runs it before it builds anything, since it opens on the session the
 * migration makes (a migrated workspace costs nothing). It ends with `signal`, and starts again with the next page load if it didn't finish.
 */
export function startProfilesMigration(options: {
  initial?: import("../profiles/profiles-migration").ProfilesMigrationDeps["initial"];
  endpoint: string;
  send: (url: string, init?: RequestInit) => Promise<Response>;
  workspace: string;
  fence: () => WorkspaceFence | null;
  model: DocumentModel;
  state: () => WorkspaceState;
  marks: { migration?: MigrationMark; profiles?: WorkspaceProfiles };
  flush: () => boolean;
  signal: AbortSignal;
  report?: (error: unknown) => void;
  /** How long to wait before it begins (default: none). */
  delayMs?: number;
  /** Tests only: run whatever `PROFILES_MIGRATION_ENABLED` says. */
  enabled?: boolean;
}): Promise<ProfilesMigrationOutcome | "disabled"> {
  if (!(options.enabled ?? PROFILES_MIGRATION_ENABLED)) return Promise.resolve("disabled");
  // A migrated workspace costs nothing at start: its stored mark says so, without capturing the workspace.
  if (migrated(options.marks)) return Promise.resolve("already");
  const migration = new ProfilesMigration({ workspace: options.workspace, model: options.model, state: options.state, initial: options.initial,
    record: next => {
      options.marks.migration = next.migration;
      if (next.profiles) options.marks.profiles = next.profiles; else delete options.marks.profiles;
      return options.flush();
    },
    send: profilesMigrationTransport(options.endpoint, options.send, options.fence), report: options.report });
  return new Promise<void>(resolve => {
    const timer = setTimeout(done, options.delayMs ?? 0);
    function done() { clearTimeout(timer); options.signal.removeEventListener("abort", done); resolve(); }
    options.signal.addEventListener("abort", done, { once: true });
  }).then(() => options.signal.aborted ? "stopped" as const : migration.run(options.signal))
    .catch(error => { options.report?.(error); return "stopped" as const; });
}


/**
 * An older workspace opened read-only is replaced only once its holder has stored a readable migrated session.
 * Browser storage events supply the trigger. Desktop reads the existing workspace GET route, only while waiting.
 * Neither observation path writes or clears the notice: the reloaded page opens and validates the stored session normally.
 */
export function watchProfilesMigration(options: {
  storage: Pick<Storage, "getItem">;
  key: string;
  model: DocumentModel;
  readOnly(): boolean;
  reload(): void;
  signal: AbortSignal;
  page?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Desktop only: fetch the host-owned workspace file through its existing read route. */
  readStored?: (signal: AbortSignal) => Promise<string | null>;
  clock?: Pick<import("../../platform/core/clock").Clock, "after">;
}) {
  const life = new AbortController();
  const stop = () => life.abort();
  if (options.signal.aborted) { stop(); return; }
  options.signal.addEventListener("abort", stop, { once: true });
  life.signal.addEventListener("abort", () => options.signal.removeEventListener("abort", stop), { once: true });
  let checked: string | null | undefined;
  const accept = (text: string | null) => {
    if (life.signal.aborted || !options.readOnly() || text === checked) return;
    checked = text;
    if (!storedProfilesReady(text, options.model)) return;
    stop(); options.reload();
  };
  if (options.readStored) {
    const clock = options.clock ?? hostClock();
    const check = async () => {
      if (life.signal.aborted || !options.readOnly()) { stop(); return; }
      try { accept(await options.readStored!(life.signal)); } catch { /* Missing, unreadable or offline: keep the notice. */ }
      if (!life.signal.aborted) clock.after(1000, () => { void check(); }, life.signal);
    };
    void check();
  } else {
    const page = options.page ?? window;
    const check = () => {
      if (!options.readOnly()) { stop(); return; }
      try { accept(options.storage.getItem(options.key)); } catch { /* Storage still unavailable. */ }
    };
    const changed = (event: StorageEvent) => { if (event.key === options.key || event.key === null) check(); };
    page.addEventListener("storage", changed);
    life.signal.addEventListener("abort", () => page.removeEventListener("storage", changed), { once: true });
    check(); // Close the gap between the startup read and subscribing.
  }
}
