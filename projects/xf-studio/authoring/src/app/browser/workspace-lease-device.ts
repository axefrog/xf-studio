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
import { WorkspaceLease, type LeaseClock, type WorkspaceLeaseAdapter } from "../workspace/workspace-lease";
import { leasedDocuments } from "../workspace/leased-documents";
import type { DocumentStorePort, WorkspaceFence } from "../../platform/api/document-store";

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
  /** The host's next lease generation for this workspace; null when the host couldn't issue one (writes then go unfenced). */
  register(signal: AbortSignal): Promise<number | null>;
  /** The tab's session storage: remembers a takeover across the restart that follows it. */
  session?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  window?: string;
  repeatMs?: number;
  resumeWaitMs?: number;
}): WorkspaceLeaseAdapter {
  const name = `xfs.workspace.${options.workspace}`, me = options.window ?? crypto.randomUUID();
  let hold: (() => void) | null = null;
  let asked: () => void = () => {};
  options.channel.addEventListener("message", event => {
    const message = event.data as LeaseMessage | undefined;
    if (message?.type === "release" && message.workspace === options.workspace && message.from !== me && hold) asked();
  });
  /** Holds the lock until `release`: the callback's promise is the lock's lifetime. */
  const held = () => new Promise<void>(resolve => { hold = resolve; });
  const generation = async (signal: AbortSignal) => { try { return await options.register(signal); } catch { return null; } };
  return {
    acquire(signal) {
      const resumed = options.session?.getItem(RESUME_KEY) === options.workspace;
      if (resumed) options.session?.removeItem(RESUME_KEY);
      return new Promise((resolve, reject) => {
        const granted = async (lock: Lock | null) => {
          if (!lock) { resolve(null); return; }
          resolve({ generation: await generation(signal) });
          return held();
        };
        const request = resumed ? { signal: AbortSignal.timeout(options.resumeWaitMs ?? RESUME_WAIT_MS) } : { ifAvailable: true };
        options.locks.request(name, request, granted).catch(error => {
          // A restarted page whose old lock didn't go in time opens read-only rather than failing.
          if (resumed) resolve(null); else reject(error);
        });
      });
    },
    takeOver(signal) {
      const ask = () => options.channel.postMessage({ type: "release", workspace: options.workspace, from: me } satisfies LeaseMessage);
      ask();
      const repeat = setInterval(ask, options.repeatMs ?? REPEAT_MS);
      return new Promise((resolve, reject) => {
        options.locks.request(name, { signal }, async lock => {
          clearInterval(repeat);
          if (!lock) return;
          const issued = await generation(signal);
          options.session?.setItem(RESUME_KEY, options.workspace);
          resolve({ generation: issued });
          return held();
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
  /** Waits for workspace writes still on their way to the host, so the last one lands before the lease is released. */
  settle?: () => Promise<void>;
}): WorkspaceLeaseAdapter & { generation(): number | null } {
  const page = options.page ?? crypto.randomUUID();
  const separator = options.endpoint.includes("?") ? "&" : "?";
  let current: number | null = null, asked: () => void = () => {};
  let first: ((held: boolean) => void) | null = null;
  let grant: ((generation: number) => void) | null = null;
  const post = async (body: Record<string, unknown>) => {
    const response = await options.send(options.endpoint, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema: "xfs/desktop-lease-1", page, ...body }) });
    if (!response.ok) throw Error("The workspace lease request was refused.");
  };
  const handle = (event: DesktopLeaseEvent) => {
    if (event.event === "granted") {
      current = event.generation;
      if (first) { first(true); first = null; }
      else if (grant) { grant(event.generation); grant = null; }
    } else if (event.event === "held") { if (first) { first(false); first = null; } }
    else if (event.event === "release") asked();
  };
  const listen = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader(), decoder = new TextDecoder();
    let buffered = "";
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
  };
  return {
    generation: () => current,
    async acquire() {
      // The stream lives as long as the page: it is never aborted, so its end is the page's end.
      const response = await options.send(`${options.endpoint}${separator}page=${encodeURIComponent(page)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok || !response.body) throw Error("The workspace lease is unavailable.");
      const held = new Promise<boolean>(resolve => { first = resolve; });
      void listen(response.body).catch(() => {});
      return await held ? { generation: current } : null;
    },
    takeOver(signal) {
      return new Promise((resolve, reject) => {
        grant = generation => resolve({ generation });
        signal.addEventListener("abort", () => { grant = null; reject(signal.reason); }, { once: true });
        post({ action: "takeover" }).catch(error => { grant = null; reject(error); });
      });
    },
    onReleaseRequested(listener) { asked = listener; },
    async release() {
      await options.settle?.();
      const generation = current;
      current = null;
      await post({ action: "release", generation });
    },
  };
}

/**
 * The localhost page's lease, started: the browser workspace's identity, its Web Lock and channel, and the host's generations
 * (`/api/workspace-lease`, the `?verify` one under `/api/verification`). `documents` puts the page's document store behind it: each
 * write carries the lease's fence, nothing is sent once released, and the release drains writes in flight first. Null where the
 * browser has no Web Locks (the window is then the only writer it can know of).
 */
export async function startBrowserWorkspaceLease(options: { verification: boolean; send?: typeof fetch;
  report?: (error: unknown) => void }): Promise<{ lease: WorkspaceLease; documents: LeaseDocuments } | null> {
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
  return { lease, documents: leaseDocuments(lease, workspace) };
}

/** The document store's side of a lease: the fence its writes carry, and the gate (with its drain as a release step). */
export type LeaseDocuments = { fence(): WorkspaceFence | null; documents(store: DocumentStorePort): DocumentStorePort };
export function leaseDocuments(lease: WorkspaceLease, workspace: string): LeaseDocuments {
  return {
    fence: () => { const generation = lease.generation(); return generation === null ? null : { workspace, generation }; },
    documents(store) {
      const leased = leasedDocuments(store, lease);
      // Registered before the workspace's own last write, so pending document saves drain first (§2.3 release step 3).
      lease.onRelease(() => leased.drain());
      return leased;
    },
  };
}
