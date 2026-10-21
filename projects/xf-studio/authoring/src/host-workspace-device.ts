/**
 * The page's device for the host's workspace file. Kept apart from the Studio's workspace session (browser-workspace-device.ts) so
 * the desktop bootstrap loads it without the workspace format.
 */
import { HOST_WORKSPACE_SCHEMA, WORKSPACE_ENDPOINT, WORKSPACE_START_FRESH_ENDPOINT, type HostWorkspaceLoad,
  type HostWorkspaceUnreadable } from "./platform/api/workspace-file";

/**
 * The page's side of the host's workspace file (platform/api/workspace-file.ts), on localhost and on the desktop: the draft is
 * loaded before the Studio builds its services, and `storage` stands in for browser storage. Its workspace key reads and
 * writes the host file; every other key stays in browser storage (`legacy`). Writes go one at a time and the newest draft
 * wins; a write's promise rejects when the host refused it, so autosave can say so.
 *
 * The first time the host has no draft at all, a draft an earlier build kept in browser storage is handed to the host once.
 * The workspace is never written to browser storage again, and that copy is never removed (an older build may still read it).
 */
export type HostWorkspace = {
  readonly storage: Pick<Storage, "getItem"> & { setItem(key: string, value: string): void | Promise<void> };
  /**
   * Waits for the writes on their way; writes the newest draft again if the last write failed, and throws if it fails
   * again. With `headers`, also posts the current draft once with them (the desktop's update flush).
   */
  flush(headers?: Record<string, string>): Promise<void>;
};
export type HostWorkspaceOpening =
  | { readonly ok: true; readonly workspace: HostWorkspace }
  /** The stored draft can't be shown (damaged, or a newer build's): nothing was changed; `startFreshWorkspace` sets it aside. */
  | { readonly ok: false; readonly file: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const SAVE_FAILED = "Your latest changes couldn't be saved. Keep this window open and export your collection from the Library panel.";

/** `key`: the workspace's browser-storage key (`workspace-state.ts` `workspaceKeys`), which now names the host file. */
export async function openHostWorkspace(options: { fetch: Fetch; verification: boolean; key: string;
  legacy: Pick<Storage, "getItem" | "setItem"> | null }): Promise<HostWorkspaceOpening> {
  const key = options.key;
  const endpoint = `${WORKSPACE_ENDPOINT}${options.verification ? "?verify=1" : ""}`;
  const response = await options.fetch(endpoint, { cache: "no-store" });
  if (response.status === 409) {
    let file = "";
    try { file = (await response.json() as Partial<HostWorkspaceUnreadable>).file ?? ""; } catch { /* A plain refusal. */ }
    return { ok: false, file };
  }
  if (!response.ok) throw Error("XF Studio couldn't load its saved workspace.");
  const loaded = await response.json() as HostWorkspaceLoad;
  if (loaded?.schema !== HOST_WORKSPACE_SCHEMA || (loaded.workspace !== null && typeof loaded.workspace !== "string"))
    throw Error("XF Studio's workspace answer is invalid.");
  const legacy = options.legacy;
  const legacyGet = (name: string) => { try { return legacy?.getItem(name) ?? null; } catch { return null; } };

  const post = async (text: string, headers: Record<string, string> = {}) => {
    const answer = await options.fetch(endpoint, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ workspace: text }),
      // A small draft still reaches the host when the page closes; a large one goes before that (the page flushes when hidden).
      keepalive: new TextEncoder().encode(text).length < 60_000 });
    if (!answer.ok) throw Error(SAVE_FAILED);
  };
  let text = loaded.workspace, pending: string | null = null, inFlight: Promise<void> | null = null, failed = false;
  /** Queues `next`; resolves when it (or a newer draft) was stored, rejects when the newest write failed. */
  const save = (next: string): Promise<void> => {
    pending = next;
    if (!inFlight) inFlight = (async () => {
      while (pending !== null) {
        const draft = pending; pending = null;
        try { await post(draft); failed = false; } catch { failed = true; }
      }
      inFlight = null;
    })();
    const run = inFlight;
    return run.then(() => { if (failed) throw Error(SAVE_FAILED); });
  };
  // The first time: an earlier build's browser draft goes to the host before the Studio starts. If the host refuses it, the page
  // still restores it (and keeps it read-only if it can't be shown); the next autosave tries again.
  if (text === null && loaded.adoptBrowserDraft) {
    const browserDraft = legacyGet(key);
    if (browserDraft !== null) { text = browserDraft; await save(browserDraft).catch(() => {}); }
  }
  const storage: HostWorkspace["storage"] = {
    getItem: name => name === key ? text : legacyGet(name),
    setItem(name, value) {
      if (name === key) { text = value; return save(value); }
      // Other keys (page conveniences) stay in browser storage; a full or blocked store is not an error.
      try { legacy?.setItem(name, value); } catch { /* Not needed to keep the work. */ }
    },
  };
  return { ok: true, workspace: { storage, async flush(headers) {
    if (inFlight) await inFlight.catch(() => {});
    if (failed && text !== null) await save(text).catch(() => {});
    if (failed) throw Error(SAVE_FAILED);
    if (headers && text !== null) await post(text, headers);
  } } };
}

/** Sets an unreadable stored draft aside (renamed beside it, never deleted). Returns the name it was kept under, or null. */
export async function startFreshWorkspace(fetch: Fetch, verification: boolean): Promise<string | null> {
  const response = await fetch(`${WORKSPACE_START_FRESH_ENDPOINT}${verification ? "?verify=1" : ""}`, { method: "POST",
    credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw Error("XF Studio couldn't set the old workspace aside. Restart XF Studio and try again.");
  return (await response.json() as { keptAs: string | null }).keptAs;
}
