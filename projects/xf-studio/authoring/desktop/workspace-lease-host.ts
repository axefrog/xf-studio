/**
 * The desktop host's workspace lease (profiles design §2.3): one writer per workspace (the normal one and `?verify` apart).
 *
 * Each page keeps one streaming `GET` open for its lifetime (`app/browser/workspace-lease-device.ts`), and the host speaks to it
 * through that stream, one JSON object per line: `granted` with the lease generation, `held` when another page holds it, and
 * `release` when another page asked for it. The stream's end is the page's end: a holder that ends releases at once, and a hung
 * holder (its stream still open) is waited for. Nothing is ever taken by time.
 *
 * `POST { action: "takeover", request }` asks the holder to release and queues that request (`cancel` with the same `request` withdraws
 * it alone); `POST { action: "release", generation, operation }` releases once and grants the oldest waiting request; `status` settles a
 * release whose answer was lost. Workspace writes carry the holder's generation (`check`), so a late write from a released
 * page is refused. Generations come from the library (`DocumentStore.nextLease`), so document writes are fenced by the same ones.
 */
import { parseFence, WORKSPACE_FENCE_HEADER } from "../src/platform/api/document-store";

export const DESKTOP_LEASE_SCHEMA = "xfs/desktop-lease-1";
/** The workspace ID the desktop's generations are kept under, in the main or the verification library. */
export const DESKTOP_WORKSPACE = "desktop";

type Page = { id: string; send(event: object): void; close(): void };
/** A queued takeover: the page, and the request's own ID (a cancellation names it, so it never removes a later request). */
type Waiting = { page: string; request: string };
type Scope = { pages: Map<string, Page>; holder: { page: string; generation: number; request?: string } | null; cancelled: Set<string>; waiting: Waiting[];
  /**
   * Release operations by ID: `done` once applied, `void` once a status check settled it as never applied (it is then refused if it
   * arrives later). Bounded: the oldest are forgotten.
   */
  releases: Map<string, "done" | "void"> };

const PAGE_ID = /^[0-9a-zA-Z-]{8,64}$/;
const OPERATION_ID = /^[0-9a-zA-Z-]{8,64}$/;
const REMEMBERED_RELEASES = 64;

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
    if (!scope) this.scopes.set(verification, scope = { pages: new Map(), holder: null, cancelled: new Set(), waiting: [], releases: new Map() });
    return scope;
  }
  /** The holder's generation, or null when no page holds the scope (tests and diagnostics). */
  holder(verification: boolean) { const holder = this.scope(verification).holder; return holder ? { page: holder.page, generation: holder.generation } : null; }
  /**
   * Whether a workspace write fenced with `generation` may land: only the holder's. A write without one (tools, tests and builds
   * from before the lease) is accepted.
   */
  check(verification: boolean, generation: number | null): boolean {
    if (generation === null) return true;
    return this.scope(verification).holder?.generation === generation;
  }

  private grant(verification: boolean, scope: Scope, page: Page, request?: string) {
    const generation = this.issue(verification);
    scope.holder = { page: page.id, generation, request };
    scope.waiting = scope.waiting.filter(item => item.page !== page.id);
    page.send({ event: "granted", generation, ...(request ? { request } : {}) });
    this.report(`Workspace lease ${generation} granted${verification ? " (verification workspace)" : ""}.`);
  }
  private grantNext(verification: boolean, scope: Scope) {
    while (!scope.holder && scope.waiting.length) {
      const queued = scope.waiting.shift()!, next = scope.pages.get(queued.page);
      if (next) this.grant(verification, scope, next, queued.request);
    }
  }
  private ended(verification: boolean, scope: Scope, id: string) {
    if (!scope.pages.delete(id)) return;
    scope.waiting = scope.waiting.filter(item => item.page !== id);
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

  private settle(scope: Scope, operation: string, outcome: "done" | "void") {
    scope.releases.set(operation, outcome);
    while (scope.releases.size > REMEMBERED_RELEASES) scope.releases.delete(scope.releases.keys().next().value!);
  }

  /**
   * `POST { schema, page, action, ... }`:
   * - `takeover` with `request` (its ID) queues the page and asks the holder to release; `cancel` with `request` withdraws that one
   *   request only.
   * - `release` with `generation` and `operation` (its ID) releases and grants the oldest waiting request, once; a release whose
   *   operation was settled as never applied is refused.
   * - `status` with `generation` and `operation`, after a release whose answer was lost, settles that operation in the same step: done
   *   (`released`), or never applied, in which case it is voided first, so it can't complete later, and the page still holds the lease.
   */
  async post(verification: boolean, request: Request): Promise<Response> {
    let body: { schema?: unknown; page?: unknown; action?: unknown; generation?: unknown; request?: unknown; operation?: unknown };
    try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
    if (body?.schema !== DESKTOP_LEASE_SCHEMA || typeof body.page !== "string" || !PAGE_ID.test(body.page))
      return Response.json({ error: "Invalid lease request." }, { status: 400 });
    const scope = this.scope(verification), page = scope.pages.get(body.page);
    if (!page) return Response.json({ error: "That page isn't connected." }, { status: 409 });
    if (body.action === "takeover" || body.action === "cancel") {
      if (typeof body.request !== "string" || !OPERATION_ID.test(body.request)) return Response.json({ error: "Invalid lease request." }, { status: 400 });
      const id = body.request;
      const key = `${page.id}:${id}`;
      if (body.action === "cancel") {
        scope.cancelled.add(key);
        while (scope.cancelled.size > REMEMBERED_RELEASES) scope.cancelled.delete(scope.cancelled.values().next().value!);
        if (scope.holder?.page === page.id && scope.holder.request === id) {
          scope.holder = null;
          page.send({ event: "held" });
          this.grantNext(verification, scope);
        }
        scope.waiting = scope.waiting.filter(item => !(item.page === page.id && item.request === id));
        return new Response(null, { status: 204 });
      }
      if (scope.cancelled.has(key)) return new Response(null, { status: 204 });
      if (scope.holder?.page === page.id) return new Response(null, { status: 204 });
      if (!scope.waiting.some(item => item.request === id)) scope.waiting.push({ page: page.id, request: id });
      const holder = scope.holder && scope.pages.get(scope.holder.page);
      if (holder) holder.send({ event: "release" }); else this.grantNext(verification, scope);
      return new Response(null, { status: 202 });
    }
    if (body.action === "status" || body.action === "release") {
      if (typeof body.operation !== "string" || !OPERATION_ID.test(body.operation)) return Response.json({ error: "Invalid lease request." }, { status: 400 });
      const operation = body.operation, settled = scope.releases.get(operation);
      const holds = scope.holder?.page === page.id && scope.holder.generation === body.generation;
      if (body.action === "status") {
        // Settled in this one step: applied, or voided now so it can never apply later.
        if (settled === "done") return Response.json({ held: false });
        if (settled === undefined) this.settle(scope, operation, "void");
        return Response.json({ held: holds });
      }
      if (settled === "done") return new Response(null, { status: 204 });
      if (settled === "void") return Response.json({ code: "void", error: "That release was settled as not applied." }, { status: 409 });
      if (!holds) return Response.json({ error: "That page doesn't hold this workspace." }, { status: 409 });
      this.settle(scope, operation, "done");
      this.report(`Workspace lease ${scope.holder!.generation} released.`);
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
