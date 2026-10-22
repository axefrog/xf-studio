/**
 * The outbox harness's host process, on the production code (phase 1 chunk 1c): prints `port <n>` once it listens.
 *
 * - `localhost <library.sqlite> [commit-log]`: the real library owner and document store with the real `/api/documents` routes, as the
 *   dev server serves them. `XFS_FLUSH=production` keeps the library's flush timing (the latency run); otherwise it flushes within 50 ms.
 * - `desktop <data-root> [commit-log]`: the real desktop server (`createDesktopServer`: its library, routes, workspace lease and outbox
 *   files). Commands reach it through a local front that logs them; it prints `port <front> <desktop server> <session cookie>`.
 *
 * Every committed command (not a replay) is appended to the commit log with each write's revision and `seqs`, for the silent-overwrite
 * check. `XFS_KILL=<point>:<n>` terminates the process on the n-th command: `before-commit` (inside the transaction, localhost only: a
 * kill there rolls it back) or `after-commit` (committed, answer not sent).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { hostClock } from "../../../projects/xf-studio/authoring/src/platform/core/clock";
import { createDocumentsHandler, DocumentStore } from "../../../projects/xf-studio/authoring/src/platform/persistence/document-store";
import { createDesktopServer } from "../../../projects/xf-studio/authoring/desktop/server";
import type { TransactAnswer, TransactRequest } from "../../../projects/xf-studio/authoring/src/platform/api/document-commands";

const [mode, path, commitLog] = process.argv.slice(2);
if (!mode || !path) throw Error("Usage: bun harness/s1-host.ts <localhost|desktop> <library.sqlite|data-root> [commit-log]");
const [killPoint, killAt] = (process.env.XFS_KILL ?? ":").split(":");
let count = 0;
const killHere = (point: string) => { if (point === killPoint && count === Number(killAt)) process.kill(process.pid, "SIGKILL"); };

/** Logs a committed command's writes, then may die before answering. */
async function answered(request: Request, forward: (request: Request) => Promise<Response>): Promise<Response> {
  const body = await request.text();
  count++;
  const response = await forward(new Request(request.url, { method: "POST", headers: request.headers, body }));
  const text = await response.text();
  if (response.ok && commitLog) {
    const sent = JSON.parse(body) as TransactRequest, answer = JSON.parse(text) as TransactAnswer;
    if (answer.ok && !answer.replayed) appendFileSync(commitLog, JSON.stringify({ id: sent.id, writes: sent.writes.map(write => ({ key: `${write.kind}/${write.id}`,
      base: write.base, revision: answer.revisions[`${write.kind}/${write.id}`], seqs: (write.value as { seqs?: unknown } | undefined)?.seqs })) }) + "\n");
  }
  killHere("after-commit");
  return new Response(text, { status: response.status, headers: response.headers });
}

if (mode === "localhost") {
  const life = new AbortController();
  // The kill harness flushes within 50 ms; the latency run (`XFS_FLUSH=production`) keeps the library's own timing.
  const db = openLibraryDatabase(path, { clock: hostClock(), signal: life.signal,
    ...(process.env.XFS_FLUSH === "production" ? {} : { timing: { quietMs: 20, maxMs: 50, retryMaxMs: 200 } }) });
  const store = new DocumentStore(db, { beforeCommit: () => killHere("before-commit") });
  store.purgeReceipts();
  const handle = createDocumentsHandler(store, "/api/documents");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new URL(request.url).pathname === "/api/documents/transact" && request.method === "POST"
    ? answered(request, handle) : handle(request) });
  console.log(`port ${server.port}`);
} else {
  const staticRoot = join(path, "static");
  mkdirSync(join(staticRoot, "build"), { recursive: true });
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>Studio</title>");
  const app = createDesktopServer(staticRoot, join(path, "data"), { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  const inner = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0]!;
  // The front: every request reaches the desktop server as the WebView's would (its origin, its session cookie).
  const forward = (request: Request) => {
    const url = new URL(request.url), headers = new Headers(request.headers);
    headers.set("Cookie", cookie); headers.set("Origin", inner); headers.delete("host");
    return fetch(inner + url.pathname + url.search, { method: request.method, headers, body: request.body, signal: request.signal, duplex: "half" } as RequestInit);
  };
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new URL(request.url).pathname === "/api/documents/transact" && request.method === "POST"
    ? answered(request, forward) : forward(request) });
  // Commands go through the front (logged, and killed after the commit); everything else, the lease's stream included, goes straight to
  // the desktop server with its session cookie, as the WebView's requests do.
  console.log(`port ${server.port} ${app.port} ${cookie}`);
}
