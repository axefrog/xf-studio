/**
 * The S3 harness's workspace side (design §8 steps 1, 3 and 4) for one workspace file (the stand-in for localStorage or the
 * desktop host file, written synchronously and atomically):
 *   bun harness/migrator-proc.ts <workspace.json> <port-file>
 * Prints `done <result>` when the workspace holds its session. `XFS_KILL=<point>:1` terminates it at w-token, w-sent,
 * w-response or w-done.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { MigrationResult, MigrationSnapshot } from "../prototype/migration";

const [workspacePath, portFile] = process.argv.slice(2);
const [killPoint] = (process.env.XFS_KILL ?? ":").split(":");
const point = (at: string) => { if (at === killPoint) process.kill(process.pid, "SIGKILL"); };
type Workspace = { legacy: { snapshot: MigrationSnapshot }; migration?: { id: string; token: string; state: "started" | "done" };
  profiles?: { sessions: Record<string, unknown> } };
const read = () => JSON.parse(readFileSync(workspacePath, "utf8")) as Workspace;
const write = (workspace: Workspace) => { writeFileSync(`${workspacePath}.tmp`, JSON.stringify(workspace)); renameSync(`${workspacePath}.tmp`, workspacePath); };

let workspace = read();
if (workspace.migration?.state === "done" && workspace.profiles) { console.log("done already"); process.exit(0); }
// 1. Token, written synchronously before anything else.
if (!workspace.migration) { workspace.migration = { id: "profiles-1", token: crypto.randomUUID(), state: "started" }; write(workspace); }
point("w-token");
// 2. The library transaction (retried while the host is down; the token makes a retry return the stored result).
let result: MigrationResult;
for (;;) {
  try {
    const sent = fetch(`http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}/migrate`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: workspace.migration.token, snapshot: workspace.legacy.snapshot }) });
    point("w-sent");
    const response = await sent;
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    result = await response.json() as MigrationResult;
    break;
  } catch { await Bun.sleep(40); }
}
point("w-response");
// 3. The session from the result, through the ID map, and `done`, in one synchronous write.
workspace = read();
const snapshot = workspace.legacy.snapshot;
const look = snapshot.collection.selected ? result.idMap.looks[snapshot.collection.selected] : undefined;
workspace.profiles = { sessions: { [result.profile]: { schema: "xfs/profile-session-1", tabs: [{ id: "t-1", name: "Layout 1", panels: [] }],
  views: { scenes: { "s-1": { subject: { kind: "character", id: result.character }, look: look ? { collection: result.collection, look } : undefined } } } } } };
workspace.migration = { ...workspace.migration!, state: "done" };
write(workspace);
point("w-done");
console.log(`done ${JSON.stringify(result)}`);
process.exit(0);
