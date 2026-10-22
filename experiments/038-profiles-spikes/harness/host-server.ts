/**
 * The spike's host process: the real library owner (WAL, `synchronous=NORMAL`, the durability flush on a fast schedule) behind
 * a local HTTP transport for `SpikeHost` and the migration. Prints `port <n>` when it listens.
 *   bun harness/host-server.ts <library.sqlite> [commit-log.jsonl]
 * `XFS_KILL=<point>:<n>` terminates the process at a protocol point on the n-th command (S1: before-commit, after-commit;
 * S3: see migration.ts MIGRATION_POINTS), as a crash would.
 */
import { appendFileSync } from "node:fs";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { hostClock } from "../../../projects/xf-studio/authoring/src/platform/core/clock";
import { SpikeHost, refKey, type TransactRequest } from "../prototype/host";
import { migrateProfiles, type MigrationRequest } from "../prototype/migration";

const [path, commitLog] = process.argv.slice(2);
if (!path) throw Error("Usage: bun harness/host-server.ts <library.sqlite> [commit-log.jsonl]");
const [killPoint, killAt] = (process.env.XFS_KILL ?? ":").split(":");
let count = 0;
export const die = () => process.kill(process.pid, "SIGKILL");
const killHere = (point: string) => { if (point === killPoint && count === Number(killAt)) die(); };

const life = new AbortController();
const db = openLibraryDatabase(path, { clock: hostClock(), signal: life.signal, timing: { quietMs: 20, maxMs: 50, retryMaxMs: 200 } });
const host = new SpikeHost(db, { beforeCommit: () => killHere("before-commit") });
host.purgeReceipts();

const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/transact") {
      const body = await request.json() as TransactRequest;
      count++;
      const result = host.transact(body);
      if (result.ok && !result.replayed && commitLog) appendFileSync(commitLog, JSON.stringify({ id: body.id, writes: body.writes.map(write =>
        ({ key: refKey(write), base: write.base, revision: result.revisions[refKey(write)], seqs: (write.value as { seqs?: unknown } | undefined)?.seqs })) }) + "\n");
      killHere("after-commit");
      return Response.json(result);
    }
    if (request.method === "POST" && url.pathname === "/revisions") return Response.json(host.revisions(await request.json()));
    if (request.method === "GET" && url.pathname === "/doc") return Response.json(host.get({ kind: url.searchParams.get("kind")!, id: url.searchParams.get("id")! }));
    if (request.method === "POST" && url.pathname === "/migrate") {
      count++;
      const result = migrateProfiles(db, await request.json() as MigrationRequest, point => killHere(point));
      killHere("m-after-commit");
      return Response.json(result);
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`port ${server.port}`);
process.on("SIGINT", () => { server.stop(); db.close(); process.exit(0); });
