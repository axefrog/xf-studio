/**
 * The workspace lease's adapters (profiles design §2.3; the policy is `app/workspace/workspace-lease.ts`):
 *
 * - **Localhost:** the browser's Web Lock `xfs.workspace.<workspace>` decides who holds the workspace, and a `BroadcastChannel` of the
 *   same name carries "please release" to the holder. The browser releases the lock only when its holder lets it go or its window
 *   ends, so a hung holder is waited for, never stolen from. Once it holds the lock, the page asks the host for the next lease
 *   generation (`/api/workspace-lease`), which its document writes carry.
 * - **Desktop:** the host holds the lease (`desktop/workspace-lease-host.ts`). The page keeps one streaming request open for its
 *   lifetime; the host grants and asks for release through it, and treats the stream's end as the page's end.
 *
 * The workspace a localhost browser edits is its own (its `localStorage`), so its identity is a random ID kept beside it.
 */
import { ReleaseUnsaved, WorkspaceLease, type LeaseClock, type WorkspaceLeaseAdapter } from "../workspace/workspace-lease";

/** The page clock's timers for the lease. */
export const browserLeaseClock: LeaseClock = {
  after(ms, run, signal) {
    if (signal?.aborted) return;
    const timer = setTimeout(run, ms);
    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  },
};

const IDENTITY_KEY = "xfs.workspace.identity";
/** Set by a window that took the workspace over just before it restarts, so the restarted page waits for its own old lock. */
const RESUME_KEY = "xfs.workspace.takeover";
/** How long a restarted page waits for its previous document's lock to go (not a steal: it is this tab's own). */
const RESUME_WAIT_MS = 4000;
/** How often a waiting window repeats its "please release" (a holder that was still starting may have missed the first). */
const REPEAT_MS = 2000;

/** The browser workspace's identity (`browser-<uuid>`, the `?verify` one apart), made once under a Web Lock so two first tabs agree. */
export async function browserWorkspaceIdentity(storage: Pick<Storage, "getItem" | "setItem">, locks: Pick<LockManager, "request">,
  verification: boolean, newId: () => string = () => crypto.randomUUID()): Promise<string> {
  const key = verification ? `${IDENTITY_KEY}.verification` : IDENTITY_KEY;
  return locks.request(key, async () => {
    const known = storage.getItem(key);
    if (known && /^browser-[0-9a-f-]{36}$/.test(known)) return known;
    const made = `browser-${newId()}`;
    storage.setItem(key, made);
    return made;
  });
}

type Channel = { postMessage(message: unknown): void; addEventListener(type: "message", listener: (event: MessageEvent) => void): void };
type LeaseMessage = { type: "release" | "released"; workspace: string; from: string };

/** Localhost: Web Locks plus a `BroadcastChannel` handshake. */
export function browserWorkspaceLease(options: {
  workspace: string;
  locks: Pick<LockManager, "request">;
  channel: Channel;
  /** The host's next lease generation for this workspace; null (or a throw) when the host couldn't issue one. */
  register(signal: AbortSignal): Promise<number | null>;
  /** The tab's session storage: remembers a takeover across the restart that follows it. */
  session?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  window?: string;
  repeatMs?: number;
  resumeWaitMs?: number;
  /** Waits between attempts to get a generation (default: 250 ms, then 500, 1000, 2000). */
  retryDelays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): WorkspaceLeaseAdapter {
  const name = `xfs.workspace.${options.workspace}`, me = options.window ?? crypto.randomUUID();
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let hold: (() => void) | null = null;
  let asked: () => void = () => {};
  options.channel.addEventListener("message", event => {
    const message = event.data as LeaseMessage | undefined;
    if (message?.type === "release" && message.workspace === options.workspace && message.from !== me && hold) asked();
  });
  /** Holds the lock until `release`: the callback's promise is the lock's lifetime. */
  const held = () => new Promise<void>(resolve => { hold = resolve; });
  /**
   * The host's generation, retried a few times. Without one the page must not write (its writes would carry no fence), so the lock
   * is let go and the caller is refused (fail closed).
   */
  const generation = async (signal: AbortSignal): Promise<number> => {
    for (const wait of [0, ...(options.retryDelays ?? [250, 500, 1000, 2000])]) {
      if (wait) await sleep(wait);
      signal.throwIfAborted();
      try { const issued = await options.register(signal); if (Number.isSafeInteger(issued)) return issued!; } catch { /* Tried again below. */ }
    }
    throw Error("XF Studio's server didn't issue a workspace lease.");
  };
  /** The lock callback: on a generation, hold the lock and answer; otherwise let the lock go at once and refuse. */
  const holdWith = (signal: AbortSignal, resolve: (value: { generation: number }) => void, reject: (error: unknown) => void, restarting = false) =>
    async (lock: Lock | null) => {
      if (!lock) return;
      let issued: number;
      try { issued = await generation(signal); } catch (error) { reject(error); return; }
      if (restarting) options.session?.setItem(RESUME_KEY, options.workspace);
      resolve({ generation: issued });
      return held();
    };
  return {
    acquire(signal) {
      const resumed = options.session?.getItem(RESUME_KEY) === options.workspace;
      if (resumed) options.session?.removeItem(RESUME_KEY);
      return new Promise((resolve, reject) => {
        const granted = holdWith(signal, resolve, reject);
        const request = resumed ? { signal: AbortSignal.timeout(options.resumeWaitMs ?? RESUME_WAIT_MS) } : { ifAvailable: true };
        options.locks.request(name, request, async lock => { if (!lock) { resolve(null); return; } return granted(lock); }).catch(error => {
          // A restarted page whose old lock didn't go in time opens read-only rather than failing.
          if (resumed) resolve(null); else reject(error);
        });
      });
    },
    takeOver(signal) {
      const ask = () => options.channel.postMessage({ type: "release", workspace: options.workspace, from: me } satisfies LeaseMessage);
      ask();
      const repeat = setInterval(ask, options.repeatMs ?? REPEAT_MS);
      // Withdrawn (a failed or abandoned takeover): no more asking; the queued lock request is aborted with the same signal.
      signal.addEventListener("abort", () => clearInterval(repeat), { once: true });
      return new Promise((resolve, reject) => {
        options.locks.request(name, { signal }, async lock => {
          clearInterval(repeat);
          return holdWith(signal, resolve, reject, true)(lock);
        }).catch(error => { clearInterval(repeat); reject(error); });
      });
    },
    onReleaseRequested(listener) { asked = listener; },
    async release() {
      const release = hold;
      hold = null;
      release?.();
      options.channel.postMessage({ type: "released", workspace: options.workspace, from: me } satisfies LeaseMessage);
    },
  };
}

/** The desktop host's lease events, one JSON object per line. */
export type DesktopLeaseEvent = { event: "granted"; generation: number } | { event: "held" } | { event: "release" } | { event: "ping" };

/** Desktop: the host's lease route, with the page's lifetime as one open stream. */
export function desktopWorkspaceLease(options: {
  /** `/api/desktop/workspace/lease`, with `?verify=1` for the verification workspace. */
  endpoint: string;
  send: (url: string, init?: RequestInit) => Promise<Response>;
  /** This page load's ID. */
  page?: string;
  /** Waits for workspace writes still on their way to the host; rejects when the last one didn't land, so nothing is released. */
  settle?: () => Promise<void>;
}): WorkspaceLeaseAdapter & { generation(): number | null } {
  const page = options.page ?? crypto.randomUUID();
  const separator = options.endpoint.includes("?") ? "&" : "?";
  let current: number | null = null, asked: () => void = () => {}, lost: () => void = () => {};
  let first: { resolve(held: boolean): void; reject(error: unknown): void } | null = null;
  let grant: { resolve(generation: number): void; reject(error: unknown): void } | null = null;
  let ended = false, operation: string | null = null;
  const send = (body: Record<string, unknown>) => options.send(options.endpoint, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema: "xfs/desktop-lease-1", page, ...body }) });
  const post = async (body: Record<string, unknown>) => {
    const response = await send(body);
    if (!response.ok) throw Error("The workspace lease request was refused.");
  };
  const handle = (event: DesktopLeaseEvent) => {
    if (event.event === "granted") {
      current = event.generation;
      if (first) { first.resolve(true); first = null; }
      else if (grant) { grant.resolve(event.generation); grant = null; }
    } else if (event.event === "held") { if (first) { first.resolve(false); first = null; } }
    else if (event.event === "release") asked();
  };
  /** The stream ended (the host stopped, or dropped this page): nothing waits on it any more, and this page may not write. */
  const end = () => {
    if (ended) return;
    ended = true; current = null;
    const error = Error("The connection to XF Studio's host ended.");
    first?.reject(error); first = null;
    grant?.reject(error); grant = null;
    lost();
  };
  const listen = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader(), decoder = new TextDecoder();
    let buffered = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let line: number;
        while ((line = buffered.indexOf("\n")) >= 0) {
          const text = buffered.slice(0, line); buffered = buffered.slice(line + 1);
          try { if (text) handle(JSON.parse(text) as DesktopLeaseEvent); } catch { /* A malformed line is skipped. */ }
        }
      }
    } finally { end(); }
  };
  return {
    generation: () => current,
    async acquire() {
      // The stream lives as long as the page: it is never aborted, so its end is the page's end.
      const response = await options.send(`${options.endpoint}${separator}page=${encodeURIComponent(page)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok || !response.body) throw Error("The workspace lease is unavailable.");
      const held = new Promise<boolean>((resolve, reject) => { first = { resolve, reject }; });
      void listen(response.body).catch(() => {});
      return await held ? { generation: current! } : null;
    },
    takeOver(signal) {
      if (ended) return Promise.reject(Error("The connection to XF Studio's host ended."));
      return new Promise((resolve, reject) => {
        let granted = false;
        const id = crypto.randomUUID();
        const request = { resolve: (generation: number) => { granted = true; resolve({ generation }); }, reject };
        grant = request;
        // Withdrawn (abandoned, or failed even when the host may have queued it, its answer lost): the host forgets the request, so
        // a later holder isn't asked on this page's behalf and a later takeover starts clean. Sent whatever became of `grant`.
        signal.addEventListener("abort", () => {
          if (granted) return;
          if (grant === request) grant = null;
          // Names this request only: a later takeover's request, even one that reached the host first, is never removed by it.
          void post({ action: "cancel", request: id }).catch(() => {});
          reject(signal.reason);
        }, { once: true });
        post({ action: "takeover", request: id }).catch(error => { if (grant === request) grant = null; reject(error); });
      });
    },
    onReleaseRequested(listener) { asked = listener; },
    onLost(listener) { lost = listener; },
    async release() {
      // This page's last writes must have landed; otherwise nothing is released.
      try { await options.settle?.(); } catch (error) { throw error instanceof ReleaseUnsaved ? error : new ReleaseUnsaved(String(error)); }
      // Each release is one operation with its own ID: if its answer is lost, `reconcile` settles exactly that operation.
      operation = crypto.randomUUID();
      const response = await send({ action: "release", generation: current, operation });
      if (response.ok) { current = null; return; }
      const { code } = await response.json().catch(() => ({})) as { code?: string };
      // Voided by a status check: it never applied, and this page still holds the lease.
      if (code === "void") throw new ReleaseUnsaved("The release was settled as not applied.");
      throw Error("The release wasn't confirmed.");
    },
    async reconcile() {
      if (ended) throw Error("The connection to XF Studio's host ended.");
      // The host settles the lost release in the same step: applied, or voided so it can't apply later.
      const response = await send({ action: "status", generation: current, operation });
      if (!response.ok) throw Error("XF Studio's host couldn't say who holds the workspace.");
      const { held } = await response.json() as { held?: unknown };
      if (typeof held !== "boolean") throw Error("XF Studio's host couldn't say who holds the workspace.");
      if (!held) current = null;
      return held ? "held" : "released";
    },
  };
}

/**
 * The localhost page's lease, started: the browser workspace's identity, its Web Lock and channel, and the host's generations
 * (`/api/workspace-lease`, the `?verify` one under `/api/verification`). `workspace` is the identity the outbox's keys and every
 * command's fence carry (`document-outbox-device.ts`). Null where the browser has no Web Locks (the window is then the only writer it
 * can know of).
 */
export async function startBrowserWorkspaceLease(options: { verification: boolean; send?: typeof fetch;
  report?: (error: unknown) => void }): Promise<{ lease: WorkspaceLease; workspace: string } | null> {
  if (typeof navigator === "undefined" || !navigator.locks || typeof BroadcastChannel === "undefined") return null;
  const send = options.send ?? fetch;
  const workspace = await browserWorkspaceIdentity(localStorage, navigator.locks, options.verification);
  const path = `${options.verification ? "/api/verification" : "/api"}/workspace-lease`;
  const adapter = browserWorkspaceLease({ workspace, locks: navigator.locks, channel: new BroadcastChannel(`xfs.workspace.${workspace}`),
    session: sessionStorage,
    async register(signal) {
      const response = await send(path, { method: "POST", signal, credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace }) });
      if (!response.ok) return null;
      const { generation } = await response.json() as { generation?: unknown };
      return typeof generation === "number" ? generation : null;
    } });
  const life = new AbortController();
  addEventListener("pagehide", () => life.abort(), { once: true });
  const lease = new WorkspaceLease(adapter, { clock: browserLeaseClock, signal: life.signal, report: options.report });
  await lease.start();
  return { lease, workspace };
}
