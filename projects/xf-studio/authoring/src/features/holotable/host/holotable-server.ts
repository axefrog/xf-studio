/**
 * The Holotable endpoint (`/api/holotable`): forwards one service method per request to the headless Holotable service
 * (projects/xf-holotable/src/service.ts), a child process spoken to as JSON lines over stdio, so nothing listens on a port.
 *
 * - **Local studio only.** Like the other endpoints, it answers only on 127.0.0.1 and only same-origin JSON posts, so another site
 *   (or a rebound host name) can't read recordings through it.
 * - **Nothing starts with the Studio.** The child starts on the first request and stops after `idleMs` without one (never while a
 *   request is waiting), or on `dispose()`.
 * - **One child**, shared by every request; each request belongs to the child it was sent to, so an old child's exit only fails its own.
 * - **Cancellation**: a request whose signal aborts sends the service a `cancel` for it and answers 499.
 * - **Not shipped**: where the service's script is missing (the packaged desktop app), every request answers 404 and nothing is spawned.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const HOLOTABLE_ENDPOINT = "/api/holotable";
const DEFAULT_SCRIPT = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "xf-holotable", "src", "service.ts");
const REQUEST_TIMEOUT_MS = 30_000;
const BODY_LIMIT = 64 * 1024;

type Reply = { id: number; ok: boolean; result?: unknown; error?: { code: string; message: string } };
type Child = { send(line: string): void; exited: Promise<number>; kill(): void };
/** Starts the service (a test seam; default: `Bun.spawn` of the script with the running Bun). */
export type HolotableSpawner = (script: string, onLine: (line: string) => void) => Child;

export interface HolotableHandlerOptions { script?: string; idleMs?: number; spawn?: HolotableSpawner; env?: Record<string, string | undefined> }

type Running = { child: Child; pending: Map<number, (reply: Reply) => void> };

export function createHolotableHandler(options: HolotableHandlerOptions = {}) {
  const script = options.script ?? DEFAULT_SCRIPT, idleMs = options.idleMs ?? 5 * 60_000;
  const spawn = options.spawn ?? defaultSpawner(options.env);
  let running: Running | null = null, nextId = 1, idle: ReturnType<typeof setTimeout> | null = null;

  const ensure = (): Running => {
    if (running) return running;
    const pending = new Map<number, (reply: Reply) => void>();
    const child = spawn(script, line => {
      let reply: Reply; try { reply = JSON.parse(line); } catch { return; }
      if (reply && typeof reply.id === "number") pending.get(reply.id)?.(reply);
    });
    const started: Running = { child, pending };
    running = started;
    void child.exited.then(() => {
      if (running === started) running = null;
      for (const [id, finish] of [...pending]) finish({ id, ok: false, error: { code: "exited", message: "The Holotable service stopped. Try again." } });
    });
    return started;
  };
  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { const r = running; if (r && !r.pending.size) { running = null; r.child.kill(); } else if (r) touch(); }, idleMs);
  };

  function call(method: string, params: unknown, signal: AbortSignal): Promise<Reply> {
    const { child, pending } = ensure(), id = nextId++;
    touch();
    return new Promise<Reply>(resolve => {
      const finish = (reply: Reply) => { clearTimeout(timer); signal.removeEventListener("abort", abort); pending.delete(id); resolve(reply); };
      const abort = () => { child.send(JSON.stringify({ id: nextId++, method: "cancel", params: { id } })); finish({ id, ok: false, error: { code: "cancelled", message: "Cancelled." } }); };
      const timer = setTimeout(() => finish({ id, ok: false, error: { code: "timeout", message: "The Holotable service took too long to answer." } }), REQUEST_TIMEOUT_MS);
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      pending.set(id, finish);
      child.send(JSON.stringify({ id, method, params }));
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin !== null && origin !== url.origin)) return Response.json({ ok: false, error: { code: "forbidden", message: "Use the local studio." } }, { status: 403 });
    if (!existsSync(script)) return Response.json({ ok: false, error: { code: "unavailable", message: "Holotable isn't part of this copy of XF Studio." } }, { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return Response.json({ ok: false, error: { code: "bad_request", message: "Send JSON." } }, { status: 415 });
    const text = await request.text();
    if (text.length > BODY_LIMIT) return Response.json({ ok: false, error: { code: "too_large", message: "Request too large." } }, { status: 413 });
    let body: { method?: unknown; params?: unknown };
    try { body = JSON.parse(text) as typeof body; } catch { return Response.json({ ok: false, error: { code: "bad_request", message: "Not JSON" } }, { status: 400 }); }
    if (!body || typeof body.method !== "string" || body.method === "cancel") return Response.json({ ok: false, error: { code: "bad_request", message: "No method" } }, { status: 400 });
    const reply = await call(body.method, body.params ?? {}, request.signal);
    const status = reply.ok ? 200 : reply.error?.code === "cancelled" ? 499 : reply.error?.code === "unknown_run" ? 404 : 502;
    return Response.json({ ok: reply.ok, result: reply.result, error: reply.error }, { status });
  }

  return { handle, dispose() { if (idle) clearTimeout(idle); const r = running; running = null; r?.child.kill(); } };
}

function defaultSpawner(env?: Record<string, string | undefined>): HolotableSpawner {
  return (script, onLine) => {
    const proc = Bun.spawn([process.execPath, script], { stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true, env: env ?? process.env });
    void (async () => {
      const decoder = new TextDecoder(); let buffer = "";
      for await (const chunk of proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) { onLine(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
      }
    })();
    return { send: line => { try { proc.stdin.write(line + "\n"); proc.stdin.flush(); } catch { /* the child is gone; its exit fails the request */ } }, exited: proc.exited, kill: () => proc.kill() };
  };
}
