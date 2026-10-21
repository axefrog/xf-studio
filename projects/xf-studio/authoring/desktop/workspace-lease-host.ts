/**
 * The desktop host's workspace lease (profiles design §2.3): one writer per workspace (the normal one and `?verify` apart).
 *
 * Each page keeps one streaming `GET` open for its lifetime (`app/browser/workspace-lease-device.ts`), and the host speaks to it
 * through that stream, one JSON object per line: `granted` with the lease generation, `held` when another page holds it, and
 * `release` when another page asked for it. The stream's end is the page's end: a holder that ends releases at once, and a hung
 * holder (its stream still open) is waited for. Nothing is ever taken by time.
 *
 * `POST { action: "takeover" }` asks the holder to release and queues the page; `POST { action: "release", generation }` releases
 * and grants the oldest waiting page. Workspace writes carry the holder's generation (`check`), so a late write from a released
 * page is refused. Generations come from the library (`DocumentStore.nextLease`), so document writes are fenced by the same ones.
 */
import { parseFence, WORKSPACE_FENCE_HEADER } from "../src/platform/api/document-store";

export const DESKTOP_LEASE_SCHEMA = "xfs/desktop-lease-1";
/** The workspace ID the desktop's generations are kept under, in the main or the verification library. */
export const DESKTOP_WORKSPACE = "desktop";

type Page = { id: string; send(event: object): void; close(): void };
type Scope = { pages: Map<string, Page>; holder: { page: string; generation: number } | null; waiting: string[] };

const PAGE_ID = /^[0-9a-zA-Z-]{8,64}$/;

export class DesktopWorkspaceLeases {
  private readonly scopes = new Map<boolean, Scope>();
  /**
   * @param issue the next generation for the scope (`DocumentStore.nextLease` on the main or verification library).
   * @param pingMs how often an open stream is written to, so the connection's idle timer never ends a live page.
   */
  constructor(private readonly issue: (verification: boolean) => number, private readonly pingMs = 5000,
    private readonly report: (message: string) => void = () => {}) {}

  private scope(verification: boolean): Scope {
    let scope = this.scopes.get(verification);
    if (!scope) this.scopes.set(verification, scope = { pages: new Map(), holder: null, waiting: [] });
    return scope;
  }
  /** The holder's generation, or null when no page holds the scope (tests and diagnostics). */
  holder(verification: boolean) { const holder = this.scope(verification).holder; return holder ? { ...holder } : null; }
  /**
   * Whether a workspace write fenced with `generation` may land: only the holder's. A write without one (tools, tests and builds
   * from before the lease) is accepted.
   */
  check(verification: boolean, generation: number | null): boolean {
    if (generation === null) return true;
    return this.scope(verification).holder?.generation === generation;
  }

  private grant(verification: boolean, scope: Scope, page: Page) {
    const generation = this.issue(verification);
    scope.holder = { page: page.id, generation };
    scope.waiting = scope.waiting.filter(id => id !== page.id);
    page.send({ event: "granted", generation });
    this.report(`Workspace lease ${generation} granted${verification ? " (verification workspace)" : ""}.`);
  }
  private grantNext(verification: boolean, scope: Scope) {
    while (!scope.holder && scope.waiting.length) {
      const next = scope.pages.get(scope.waiting.shift()!);
      if (next) this.grant(verification, scope, next);
    }
  }
  private ended(verification: boolean, scope: Scope, id: string) {
    if (!scope.pages.delete(id)) return;
    scope.waiting = scope.waiting.filter(item => item !== id);
    if (scope.holder?.page === id) {
      this.report(`The page holding workspace lease ${scope.holder.generation} ended; it is released.`);
      scope.holder = null;
      this.grantNext(verification, scope);
    }
  }

  /** The page's lifetime stream (`GET ?page=<id>`): granted at once when the workspace is free, otherwise told it is held. */
  connect(verification: boolean, id: string, signal: AbortSignal): Response {
    if (!PAGE_ID.test(id)) return Response.json({ error: "That isn't a page." }, { status: 400 });
    const scope = this.scope(verification);
    if (scope.pages.has(id)) return Response.json({ error: "That page is already connected." }, { status: 409 });
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null, timer: ReturnType<typeof setInterval> | undefined;
    const end = () => {
      clearInterval(timer);
      const open = controller;
      controller = null;
      try { open?.close(); } catch { /* Already closed by the client. */ }
      this.ended(verification, scope, id);
    };
    const page: Page = {
      id,
      send: event => {
        if (!controller) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { end(); }
      },
      close: end,
    };
    const body = new ReadableStream<Uint8Array>({
      start: open => {
        controller = open;
        scope.pages.set(id, page);
        if (scope.holder) page.send({ event: "held" }); else this.grant(verification, scope, page);
        timer = setInterval(() => page.send({ event: "ping" }), this.pingMs);
      },
      cancel: end,
    });
    signal.addEventListener("abort", end, { once: true });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }

  /** `POST { schema, page, action: "takeover" | "release", generation? }`. */
  async post(verification: boolean, request: Request): Promise<Response> {
    let body: { schema?: unknown; page?: unknown; action?: unknown; generation?: unknown };
    try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
    if (body?.schema !== DESKTOP_LEASE_SCHEMA || typeof body.page !== "string" || !PAGE_ID.test(body.page))
      return Response.json({ error: "Invalid lease request." }, { status: 400 });
    const scope = this.scope(verification), page = scope.pages.get(body.page);
    if (!page) return Response.json({ error: "That page isn't connected." }, { status: 409 });
    if (body.action === "takeover") {
      if (scope.holder?.page === page.id) return new Response(null, { status: 204 });
      if (!scope.waiting.includes(page.id)) scope.waiting.push(page.id);
      const holder = scope.holder && scope.pages.get(scope.holder.page);
      if (holder) holder.send({ event: "release" }); else this.grantNext(verification, scope);
      return new Response(null, { status: 202 });
    }
    if (body.action === "release") {
      if (scope.holder?.page !== page.id || scope.holder.generation !== body.generation)
        return Response.json({ error: "That page doesn't hold this workspace." }, { status: 409 });
      this.report(`Workspace lease ${scope.holder.generation} released.`);
      scope.holder = null;
      this.grantNext(verification, scope);
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: "Invalid lease request." }, { status: 400 });
  }

  /**
   * The answer refusing a workspace write (`POST /api/desktop/workspace`) whose lease isn't the holder's, or null to let it through.
   * A late write from a page that released the workspace is refused with `superseded`, never written.
   */
  refuseWrite(request: Request, verification: boolean): Response | null {
    if (request.method !== "POST") return null;
    const fence = parseFence(request.headers.get(WORKSPACE_FENCE_HEADER));
    if (fence === "invalid") return Response.json({ error: "That isn't a workspace lease." }, { status: 400 });
    if (!fence || fence.workspace === DESKTOP_WORKSPACE && this.check(verification, fence.generation)) return null;
    return Response.json({ code: "superseded", error: "This workspace is open in another window, so this change wasn't saved here." }, { status: 409 });
  }

  /** The route: `GET` opens the page's stream, `POST` takes over or releases. */
  request(request: Request, verification: boolean): Promise<Response> | Response {
    const url = new URL(request.url);
    if (request.method === "GET") return this.connect(verification, url.searchParams.get("page") ?? "", request.signal);
    if (request.method === "POST") return this.post(verification, request);
    return new Response("Method not allowed", { status: 405 });
  }

  /** Ends every stream (the host is stopping). */
  close() { for (const scope of this.scopes.values()) for (const page of [...scope.pages.values()]) page.close(); }
}
