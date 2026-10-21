/**
 * The desktop app runs once per user data folder (profiles design §2.3: two host processes never share `workspace.json`). Electrobun
 * 2.0.2 has no single-instance lock, so the app keeps its own: `instance.lock` in the data folder, created exclusively by the first
 * process, which then publishes its loopback port and a random token there. A second launch finds the lock, asks the first to bring
 * its window forward (`POST /api/desktop/instance/activate` with the token, the one route outside the page session), and quits.
 *
 * A lock whose process is gone, or whose owner never answers once it has had time to publish, is stale: the new process takes it.
 * Pure over its ports (`fs`, `alive`, `activate`, the clock), so the protocol is tested without processes.
 */
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";

export const INSTANCE_LOCK = "instance.lock";
export const INSTANCE_ROUTE = "/api/desktop/instance/activate";
export const INSTANCE_HEADER = "X-XFS-Instance";
type Lock = { pid: number; port?: number; token?: string };

export type InstancePorts = {
  pid: number;
  /** Whether a process with this ID is running. */
  alive(pid: number): boolean;
  /** Asks the instance on `port` to bring its window forward; true once it said it did. */
  activate(port: number, token: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** How long to wait for a running owner to publish its port (it does so once its server is up). */
  publishWaitMs?: number;
};
export type InstanceClaim =
  | { readonly first: true; readonly token: string; publish(port: number): void; release(): void }
  | { readonly first: false };

const read = (path: string): Lock | null => {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Lock;
    return Number.isSafeInteger(value?.pid) ? value : null;
  } catch { return null; }
};

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Claims the data folder for this process, or hands the launch to the instance already running there. */
export async function claimSingleInstance(dataRoot: string, ports: InstancePorts): Promise<InstanceClaim> {
  const path = resolve(dataRoot, INSTANCE_LOCK), token = randomBytes(32).toString("hex");
  const write = (lock: Lock) => {
    const temporary = `${path}.${ports.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(lock), { mode: 0o600 });
    renameSync(temporary, path);
  };
  const first = (): InstanceClaim => ({ first: true, token,
    publish: port => write({ pid: ports.pid, port, token }),
    release: () => { if (read(path)?.pid === ports.pid) rmSync(path, { force: true }); } });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = openSync(path, "wx", 0o600);
      try { writeSync(handle, JSON.stringify({ pid: ports.pid })); } finally { closeSync(handle); }
      return first();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    let owner = read(path);
    if (owner && owner.pid !== ports.pid && ports.alive(owner.pid)) {
      // A running owner publishes its port once its server is up: wait for it, then hand this launch over.
      const waitMs = ports.publishWaitMs ?? 8000;
      for (let waited = 0; owner && ports.alive(owner.pid) && !(owner.port && owner.token) && waited < waitMs; waited += 100) {
        await ports.sleep(100);
        owner = read(path);
      }
      if (owner?.port && owner.token && ports.alive(owner.pid) && await ports.activate(owner.port, owner.token).catch(() => false))
        return { first: false };
    }
    // Stale: its process is gone, or it never answered. Remove it and claim again (another launch may win the race; then it is first).
    rmSync(path, { force: true });
  }
  // Three races lost in a row: run rather than refuse to start.
  write({ pid: ports.pid });
  return first();
}

/** The answer to `POST /api/desktop/instance/activate`: `focus` runs when the token is this instance's. */
export function instanceActivateRequest(request: Request, token: string | undefined, focus: () => void): Response {
  if (request.method !== "POST" || !token || request.headers.get(INSTANCE_HEADER) !== token) return new Response("Forbidden", { status: 403 });
  focus();
  return new Response(null, { status: 204 });
}
