/**
 * The S3 sweep's host process, on the production code (profiles design §8, chunk 1d-i): the real library owner over `<library>` with its
 * pre-migration copies in `<library dir>/backups`, serving the real `/api/profiles/migrate` route. Prints `port <n>` once it listens.
 * `XFS_KILL=<point>` terminates it at that protocol point (inside the transaction: m-collections … m-record; after the commit, before
 * the answer: m-after-commit).
 *   bun harness/s3-migration-host.ts <library.sqlite>
 */
import { createProfilesMigrationHandler } from "../../../projects/xf-studio/authoring/src/app/profiles/host/profiles-migrate";
import { STUDIO_PARTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { hostClock } from "../../../projects/xf-studio/authoring/src/platform/core/clock";
import { LibraryBackups } from "../../../projects/xf-studio/authoring/src/platform/persistence/backups";
import { DocumentStore } from "../../../projects/xf-studio/authoring/src/platform/persistence/document-store";

const [path] = process.argv.slice(2);
if (!path) throw Error("Usage: bun harness/s3-migration-host.ts <library.sqlite>");
const kill = process.env.XFS_KILL ?? "";
const backups = new LibraryBackups(path, Date.now);
const database = openLibraryDatabase(path, { clock: hostClock(), backups, timing: { quietMs: 20, maxMs: 50, retryMaxMs: 200 } });
const handle = createProfilesMigrationHandler({ database, documents: new DocumentStore(database) }, "/api/profiles/migrate",
  { parts: STUDIO_PARTS, backups, point: at => { if (at === kill) process.kill(process.pid, "SIGKILL"); } });
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handle });
console.log(`port ${server.port}`);
