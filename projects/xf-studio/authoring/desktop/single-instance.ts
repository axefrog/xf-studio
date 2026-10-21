/**
 * The desktop app runs once per user data folder (profiles design §2.3: two host processes never share `workspace.json`).
 *
 * **Exclusivity is an operating-system lock that lives exactly as long as the process:** a Windows named mutex (`CreateMutexW`, then
 * `WaitForSingleObject` with no wait, through `bun:ffi` on kernel32), named after the data folder. The process that owns it is the one
 * XF Studio for that folder; Windows releases it when that process ends however it ends (a killed or crashed owner leaves it
 * "abandoned", and the next launch owns it). Electrobun 2.0.2 has no single-instance lock of its own.
 *
 * **Bringing the first window forward** is a convenience on top: the owner writes `instance.lock` in the data folder with its loopback
 * port and a random token once its server is up, and a second launch, which never starts, asks it (`POST
 * /api/desktop/instance/activate` with the token, the one route outside the page session) to bring its window forward. That file is
 * never used to decide who runs.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const INSTANCE_LOCK = "instance.lock";
export const INSTANCE_ROUTE = "/api/desktop/instance/activate";
export const INSTANCE_HEADER = "X-XFS-Instance";
type Published = { pid: number; port: number; token: string };

/** A lock held for the rest of this process's life; `acquire` answers whether this process owns it. */
export type ProcessLock = { acquire(name: string): boolean };

/** The Windows named mutex, owned by the calling thread (the host's main thread) until the process ends. */
export function windowsMutex(): ProcessLock {
  // Loaded only when used, so other platforms and tests that inject a lock never touch kernel32.
  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const kernel32 = dlopen("kernel32.dll", {
    CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    WaitForSingleObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  });
  const held: unknown[] = [];
  return {
    acquire(name) {
      const wide = Buffer.from(`${name}\0`, "utf16le");
      const handle = kernel32.symbols.CreateMutexW(null, 0, ptr(wide));
      if (!handle) throw Error("XF Studio couldn't create its single-instance lock.");
      // WAIT_OBJECT_0 (0): owned now. WAIT_ABANDONED (0x80): its owner ended without letting go; owned now. WAIT_TIMEOUT: another owns it.
      const result = kernel32.symbols.WaitForSingleObject(handle, 0);
      const owned = result === 0 || result === 0x80;
      // The handle stays open for the process's life (closing it would let the mutex go away while owned).
      held.push(handle);
      return owned;
    },
  };
}

/** The mutex name for a data folder: one per folder, per Windows session. */
export function instanceName(dataRoot: string) {
  return `Local\\XFStudio-${createHash("sha256").update(resolve(dataRoot).toLowerCase()).digest("hex").slice(0, 40)}`;
}

export type InstancePorts = {
  pid: number;
  lock: ProcessLock;
  /** Asks the instance on `port` to bring its window forward; true once it said it did. */
  activate(port: number, token: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** How long a second launch waits for the owner to publish its port (it does so once its server is up). */
  publishWaitMs?: number;
};
export type InstanceClaim =
  | { readonly first: true; readonly token: string; publish(port: number): void; release(): void }
  | { readonly first: false; readonly activated: boolean };

const readPublished = (path: string): Published | null => {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Published;
    return Number.isSafeInteger(value?.port) && typeof value.token === "string" ? value : null;
  } catch { return null; }
};

/**
 * Claims the data folder for this process, or hands the launch to the instance already running there. A second launch never starts,
 * whether or not the first answered (it may still be installing WebView2, before its server is up).
 */
export async function claimSingleInstance(dataRoot: string, ports: InstancePorts): Promise<InstanceClaim> {
  const path = resolve(dataRoot, INSTANCE_LOCK);
  if (ports.lock.acquire(instanceName(dataRoot))) {
    const token = randomBytes(32).toString("hex");
    return { first: true, token,
      publish: port => {
        const temporary = `${path}.${ports.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify({ pid: ports.pid, port, token } satisfies Published), { mode: 0o600 });
        renameSync(temporary, path);
      },
      release: () => { if (readPublished(path)?.pid === ports.pid) rmSync(path, { force: true }); } };
  }
  const waitMs = ports.publishWaitMs ?? 15_000;
  for (let waited = 0; ; waited += 200) {
    const owner = readPublished(path);
    if (owner && owner.pid !== ports.pid && await ports.activate(owner.port, owner.token).catch(() => false)) return { first: false, activated: true };
    if (waited >= waitMs) return { first: false, activated: false };
    await ports.sleep(200);
  }
}

/** The answer to `POST /api/desktop/instance/activate`: `focus` runs when the token is this instance's. */
export function instanceActivateRequest(request: Request, token: string | undefined, focus: () => void): Response {
  if (request.method !== "POST" || !token || request.headers.get(INSTANCE_HEADER) !== token) return new Response("Forbidden", { status: 403 });
  focus();
  return new Response(null, { status: 204 });
}
