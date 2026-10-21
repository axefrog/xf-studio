/**
 * The page's device for the host's workspace file (platform/api/workspace-file.ts), on localhost and on the desktop. Kept apart
 * from the Studio's workspace session (browser-workspace-device.ts) so the desktop bootstrap loads it without the workspace format.
 *
 * The host file is the authority. The draft is loaded before the Studio builds its services, and `storage` stands in for browser
 * storage: its workspace key reads and writes the host file, and every other key stays in browser storage. Writes go to the
 * host one at a time, the newest draft winning; a write's promise rejects when the host refused it, so autosave can say so.
 *
 * **Nothing the page captured is lost on reload, close or crash.** Every draft is also written at once, synchronously, to a
 * small journal in browser storage (one per tab, a smaller form for a very large draft), and the journal is cleared when the
 * host acknowledges that draft. The next load hands any journal the host never acknowledged back to the host (`adopt`): its
 * own tab's after a reload, and those of tabs that are gone (closed or crashed; Web Locks tell a live tab from a gone one).
 *
 * **An earlier build's browser draft** (`xfas.workspace.v1`, kept by localhost before the host file) is handed over once per
 * browser: it becomes the host's draft when the host has none, or goes first in the host's recovery queue when it differs, so
 * a second browser's draft is never silently dropped. That key is never removed and never written; a marker beside it records
 * the hand-over.
 */
import { HOST_WORKSPACE_SCHEMA, WORKSPACE_ADOPT_ENDPOINT, WORKSPACE_ENDPOINT, WORKSPACE_JOURNAL_LIMIT, WORKSPACE_REVISION_HEADER,
  WORKSPACE_START_FRESH_ENDPOINT, type HostWorkspaceLoad, type HostWorkspaceUnreadable, type WorkspaceAdopted,
  type WorkspaceAdoption } from "./platform/api/workspace-file";

export type HostWorkspace = {
  /** `compact`: a smaller form of the same draft, for the journal when the draft itself is too large for browser storage. */
  readonly storage: Pick<Storage, "getItem"> & { setItem(key: string, value: string, compact?: () => string): void | Promise<void> };
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
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
/** The part of the Web Locks API this needs (`navigator.locks`). */
export type TabLocks = {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[]; pending?: { name?: string }[] }>;
};
type Journal = { schema: typeof JOURNAL_SCHEMA; tab: string; seq: number; base: string | null; workspace: string };

const SAVE_FAILED = "Your latest changes couldn't be saved. Keep this window open and export your collection from the Library panel.";
const JOURNAL_SCHEMA = "xfs/workspace-journal-1";
/** A keepalive request may carry at most 64 KiB, counting every keepalive request on its way: stay well under. */
const KEEPALIVE_BYTES = 60_000;
const TAB_KEY = "xfs.workspace.tab";
const LOCK_PREFIX = "xfs.workspace.tab.";
const journalPrefix = (verification: boolean) => `xfs.workspace.journal.v1.${verification ? "verification." : ""}`;
/** A short, stable hash of a text (the hand-over marker). */
function textHash(text: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return `${text.length.toString(36)}.${(4294967296 * (2097151 & b) + (a >>> 0)).toString(36)}`;
}

/**
 * Opens the host's workspace. `key`: the workspace's browser-storage key (`workspace-state.ts` `workspaceKeys`); `browser`: the
 * page's browser storage (null when blocked); `session`: the tab's session storage (keeps the tab's identity across a reload);
 * `locks`: the Web Locks API, when there is one.
 */
export async function openHostWorkspace(options: { fetch: Fetch; verification: boolean; key: string; browser: BrowserStorage | null;
  session?: Pick<Storage, "getItem" | "setItem"> | null; locks?: TabLocks | null; random?: () => string }): Promise<HostWorkspaceOpening> {
  const { key, browser, verification } = options;
  const query = verification ? "?verify=1" : "";
  const quiet = <T>(run: () => T, fallback: T): T => { try { return run(); } catch { return fallback; } };
  const newId = options.random ?? (() => crypto.randomUUID());
  // This tab: the same after a reload (session storage), held as a lock while the page lives so other tabs know it is open.
  let tab = quiet(() => options.session?.getItem(TAB_KEY) ?? null, null);
  if (!tab || !/^[0-9a-z-]{1,64}$/i.test(tab)) { tab = newId(); quiet(() => options.session?.setItem(TAB_KEY, tab!), undefined); }
  void options.locks?.request(LOCK_PREFIX + tab, () => new Promise(() => {})).catch(() => {});
  const journalKey = journalPrefix(verification) + tab, markerKey = `${key}.handed-over`;

  const response = await options.fetch(`${WORKSPACE_ENDPOINT}${query}`, { cache: "no-store" });
  const refused = async (answer: Response): Promise<HostWorkspaceOpening> => {
    let file = "";
    try { file = (await answer.json() as Partial<HostWorkspaceUnreadable>).file ?? ""; } catch { /* A plain refusal. */ }
    return { ok: false, file };
  };
  if (response.status === 409) return refused(response);
  if (!response.ok) throw Error("XF Studio couldn't load its saved workspace.");
  const loaded = await response.json() as HostWorkspaceLoad;
  if (loaded?.schema !== HOST_WORKSPACE_SCHEMA || (loaded.workspace !== null && typeof loaded.workspace !== "string"))
    throw Error("XF Studio's workspace answer is invalid.");
  let text = loaded.workspace, revision = loaded.revision;

  /** Hands a kept draft over; true when the host has dealt with it (it may be forgotten). Throws `unreadable` for a 409. */
  const adopt = async (adoption: WorkspaceAdoption): Promise<boolean> => {
    let answer: Response;
    try {
      answer = await options.fetch(`${WORKSPACE_ADOPT_ENDPOINT}${query}`, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(adoption) });
    } catch { return false; }
    if (answer.status === 409) throw answer;
    if (!answer.ok) return false;
    const result = await answer.json() as WorkspaceAdopted;
    text = result.workspace; revision = result.revision;
    return result.outcome !== "kept";
  };
  try {
    // Journals the host never acknowledged: this tab's (a reload), then those of tabs that are gone.
    const prefix = journalPrefix(verification);
    const keys = quiet(() => Array.from({ length: browser?.length ?? 0 }, (_, i) => browser!.key(i)).filter((name): name is string =>
      !!name && name.startsWith(prefix) && !name.slice(prefix.length).includes(".")), [] as string[]);
    let live = new Set<string>();
    if (options.locks) {
      const state = await options.locks.query().catch(() => null);
      live = new Set([...(state?.held ?? []), ...(state?.pending ?? [])].map(lock => lock.name ?? ""));
    }
    const orphans = options.locks ? keys.filter(name => name !== journalKey && !live.has(LOCK_PREFIX + name.slice(prefix.length))) : [];
    for (const name of [journalKey, ...orphans]) {
      const entry = quiet(() => JSON.parse(browser?.getItem(name) ?? "null") as Journal | null, null);
      if (entry?.schema !== JOURNAL_SCHEMA || typeof entry.workspace !== "string") continue;
      if (await adopt({ workspace: entry.workspace, base: entry.base, writer: { tab: entry.tab, seq: entry.seq } })) quiet(() => browser?.removeItem(name), undefined);
    }
    // An earlier build's browser draft, once per browser.
    const browserDraft = quiet(() => browser?.getItem(key) ?? null, null);
    if (browserDraft !== null && quiet(() => browser?.getItem(markerKey) ?? null, null) !== textHash(browserDraft)) {
      if (await adopt({ workspace: browserDraft, base: null })) quiet(() => browser?.setItem(markerKey, textHash(browserDraft)), undefined);
    }
  } catch (error) {
    if (error instanceof Response) return refused(error);
    throw error;
  }

  // Write numbers rise across reloads of the tab too (the host compares them with the tab's earlier writes).
  let seq = Date.now(), pending: { text: string; seq: number } | null = null, inFlight: Promise<void> | null = null, failed = false;
  const post = async (draft: string, at: number, headers: Record<string, string> = {}) => {
    // Serialised once; a small body still reaches the host when the page closes (the journal covers a larger one).
    const body = new TextEncoder().encode(JSON.stringify({ workspace: draft, writer: { tab, seq: at } }));
    const answer = await options.fetch(`${WORKSPACE_ENDPOINT}${query}`, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...headers }, body, keepalive: body.byteLength <= KEEPALIVE_BYTES });
    if (!answer.ok) throw Error(SAVE_FAILED);
    revision = answer.headers.get(WORKSPACE_REVISION_HEADER) ?? revision;
    // The host has the newest draft: the journal has nothing it lacks.
    if (at === seq) quiet(() => browser?.removeItem(journalKey), undefined);
  };
  /** Queues a draft; resolves when it (or a newer one) was stored, rejects when the newest write failed. */
  const save = (draft: string, at: number): Promise<void> => {
    pending = { text: draft, seq: at };
    if (!inFlight) inFlight = (async () => {
      while (pending !== null) {
        const next: { text: string; seq: number } = pending; pending = null;
        try { await post(next.text, next.seq); failed = false; } catch { failed = true; }
      }
      inFlight = null;
    })();
    const run = inFlight;
    return run.then(() => { if (failed) throw Error(SAVE_FAILED); });
  };
  /** The draft in the journal at once, before any request; a draft too large for it goes in its smaller form, or clears it. */
  const journal = (draft: string, at: number, compact?: () => string) => {
    const write = (workspace: string) => {
      const entry: Journal = { schema: JOURNAL_SCHEMA, tab, seq: at, base: revision, workspace };
      browser!.setItem(journalKey, JSON.stringify(entry));
    };
    if (!browser) return;
    try {
      if (draft.length <= WORKSPACE_JOURNAL_LIMIT) { write(draft); return; }
    } catch { /* Browser storage full: try the smaller form. */ }
    try { if (compact) { write(compact()); return; } } catch { /* Neither fits. */ }
    // A journal older than this draft must never come back in its place.
    quiet(() => browser.removeItem(journalKey), undefined);
  };
  const storage: HostWorkspace["storage"] = {
    getItem: name => name === key ? text : quiet(() => browser?.getItem(name) ?? null, null),
    setItem(name, value, compact) {
      if (name === key) {
        text = value;
        const at = ++seq;
        journal(value, at, compact);
        return save(value, at);
      }
      // Other keys (page conveniences) stay in browser storage; a full or blocked store is not an error.
      quiet(() => browser?.setItem(name, value), undefined);
    },
  };
  return { ok: true, workspace: { storage, async flush(headers) {
    if (inFlight) await inFlight.catch(() => {});
    if (failed && text !== null) await save(text, seq).catch(() => {});
    if (failed) throw Error(SAVE_FAILED);
    if (headers && text !== null) await post(text, seq, headers);
  } } };
}

/** Sets an unreadable stored draft aside (renamed beside it, never deleted). Returns the name it was kept under, or null. */
export async function startFreshWorkspace(fetch: Fetch, verification: boolean): Promise<string | null> {
  const response = await fetch(`${WORKSPACE_START_FRESH_ENDPOINT}${verification ? "?verify=1" : ""}`, { method: "POST",
    credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw Error("XF Studio couldn't set the old workspace aside. Restart XF Studio and try again.");
  return (await response.json() as { keptAs: string | null }).keptAs;
}
