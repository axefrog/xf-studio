/**
 * The Holotable endpoint (`/api/holotable`): forwards one service method per request to the headless Holotable service
 * (projects/xf-holotable/src/service.ts), a child process spoken to as JSON lines over stdio, so nothing listens on a port.
 *
 * - **Nothing starts with the Studio.** The child starts on the first request and stops after `idleMs` without one, or on `dispose()`.
 * - **One child**, shared by every request; a start in progress is joined, not repeated. A child that exits is replaced on the next request.
 * - **Cancellation**: a request whose signal aborts sends the service a `cancel` for it and answers 499.
 * - **Not shipped**: where the service's script is missing (the packaged desktop app), every request answers 404 and nothing is spawned.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const HOLOTABLE_ENDPOINT = "/api/holotable";
const DEFAULT_SCRIPT = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "xf-holotable", "src", "service.ts");
const REQUEST_TIMEOUT_MS = 30_000;

type Reply = { id: number; ok: boolean; result?: unknown; error?: { code: string; message: string } };
type Child = { send(line: string): void; exited: Promise<number>; kill(): void };
/** Starts the service (a test seam; default: `Bun.spawn` of the script with the running Bun). */
export type HolotableSpawner = (script: string, onLine: (line: string) => void) => Child;

export interface HolotableHandlerOptions { script?: string; idleMs?: number; spawn?: HolotableSpawner; env?: Record<string, string | undefined> }

export function createHolotableHandler(options: HolotableHandlerOptions = {}) {
  const script = options.script ?? DEFAULT_SCRIPT, idleMs = options.idleMs ?? 5 * 60_000;
  const spawn = options.spawn ?? defaultSpawner(options.env);
  let child: Child | null = null, nextId = 1, idle: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<number, (reply: Reply) => void>();

  const onLine = (line: string) => {
    let reply: Reply; try { reply = JSON.parse(line); } catch { return; }
    pending.get(reply.id)?.(reply); pending.delete(reply.id);
  };
  const ensure = (): Child => {
    if (child) return child;
    const started = spawn(script, onLine);
    child = started;
    void started.exited.then(() => {
      if (child === started) child = null;
      for (const [id, resolve] of pending) resolve({ id, ok: false, error: { code: "exited", message: "The Holotable service stopped. Try again." } });
      pending.clear();
    });
    return started;
  };
  const touch = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => { if (!pending.size) { child?.kill(); child = null; } }, idleMs); };

  async function call(method: string, params: unknown, signal: AbortSignal): Promise<Reply> {
    const target = ensure(), id = nextId++;
    touch();
    return new Promise<Reply>(resolve => {
      const timer = setTimeout(() => finish({ id, ok: false, error: { code: "timeout", message: "The Holotable service took too long to answer." } }), REQUEST_TIMEOUT_MS);
      const abort = () => { target.send(JSON.stringify({ id: nextId++, method: "cancel", params: { id } })); finish({ id, ok: false, error: { code: "cancelled", message: "Cancelled." } }); };
      function finish(reply: Reply) { clearTimeout(timer); signal.removeEventListener("abort", abort); pending.delete(id); resolve(reply); }
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      pending.set(id, finish);
      target.send(JSON.stringify({ id, method, params }));
    });
  }

  async function handle(request: Request): Promise<Response> {
    if (!existsSync(script)) return Response.json({ ok: false, error: { code: "unavailable", message: "Holotable isn't part of this copy of XF Studio." } }, { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    let body: { method?: unknown; params?: unknown };
    try { body = await request.json() as typeof body; } catch { return Response.json({ ok: false, error: { code: "bad_request", message: "Not JSON" } }, { status: 400 }); }
    if (typeof body.method !== "string" || body.method === "cancel") return Response.json({ ok: false, error: { code: "bad_request", message: "No method" } }, { status: 400 });
    const reply = await call(body.method, body.params ?? {}, request.signal);
    const status = reply.ok ? 200 : reply.error?.code === "cancelled" ? 499 : reply.error?.code === "unknown_run" ? 404 : 502;
    return Response.json({ ok: reply.ok, result: reply.result, error: reply.error }, { status });
  }

  return { handle, dispose() { if (idle) clearTimeout(idle); child?.kill(); child = null; } };
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
    return { send: line => { proc.stdin.write(line + "\n"); proc.stdin.flush(); }, exited: proc.exited, kill: () => proc.kill() };
  };
}
