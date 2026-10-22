/**
 * The S3 sweep's workspace process, on the production code (profiles design §8 steps 1, 3, 4): one page load of the real
 * `ProfilesMigration` over a workspace file (the stand-in for the browser's storage or the desktop host file, written synchronously and
 * atomically), sending through the real transport to the host whose port is in `<port-file>` (re-read each try, so a restarted host is
 * found). Prints `outcome <done|already|stopped>`. `XFS_KILL=<point>` terminates it at w-token, w-sent, w-response or w-done.
 *   bun harness/s3-migration-page.ts <workspace.json> <port-file> <workspace identity>
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { profilesMigrationTransport } from "../../../projects/xf-studio/authoring/src/app/browser/profiles-migration-device";
import { ProfilesMigration } from "../../../projects/xf-studio/authoring/src/app/profiles/profiles-migration";
import { MODEL, readStored, storedText } from "../../../projects/xf-studio/authoring/tests/fixtures/profiles-migration-fixtures";

const [file, portFile, identity] = process.argv.slice(2);
if (!file || !portFile || !identity) throw Error("Usage: bun harness/s3-migration-page.ts <workspace.json> <port-file> <identity>");
const kill = process.env.XFS_KILL ?? "";
const state = () => readStored(readFileSync(file, "utf8"));
const write = (text: string) => { writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); };
const migration = new ProfilesMigration({ workspace: identity, model: MODEL, state,
  record: marks => { const now = state(); now.migration = marks.migration; if (marks.profiles) now.profiles = marks.profiles; else delete now.profiles; write(storedText(now)); return true; },
  send: (request, signal) => {
    const port = readFileSync(portFile, "utf8").trim(), origin = `http://127.0.0.1:${port}`;
    return profilesMigrationTransport(`${origin}/api/profiles/migrate`, (url, init) => fetch(url, { ...init, headers: { ...init!.headers as object, Origin: origin } }))(request, signal);
  },
  wait: ms => Bun.sleep(Math.min(ms, 40)),
  point: at => { if (at === kill) process.kill(process.pid, "SIGKILL"); } });
console.log(`outcome ${await migration.run(new AbortController().signal)}`);
process.exit(0);
