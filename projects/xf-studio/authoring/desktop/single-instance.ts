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

/** The kernel32 calls the mutex needs (`windowsMutex`); tests pass their own. */
export type MutexApi = {
  /** `CreateMutexW(NULL, FALSE, name)`: a handle, or 0 when it failed. */
  create(name: string): unknown;
  /** `WaitForSingleObject(handle, 0)`. */
  wait(handle: unknown): number;
  close(handle: unknown): void;
};
/** The lock couldn't be checked (kernel32 unavailable, the mutex not created, or the wait failed): this launch must not start. */
export class InstanceLockError extends Error {}

const WAIT_OBJECT_0 = 0, WAIT_ABANDONED = 0x80, WAIT_TIMEOUT = 0x102;

function kernel32(): MutexApi {
  // Loaded only when used, so other platforms and tests that inject a lock never touch kernel32.
  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const library = dlopen("kernel32.dll", {
    CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    WaitForSingleObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  return {
    create: name => { const wide = Buffer.from(`${name}\0`, "utf16le"); return library.symbols.CreateMutexW(null, 0, ptr(wide)); },
    wait: handle => library.symbols.WaitForSingleObject(handle as never, 0),
    close: handle => { library.symbols.CloseHandle(handle as never); },
  };
}

/**
 * The Windows named mutex, owned by the calling thread (the host's main thread) until the process ends. `acquire` answers true when
 * this process owns it now (free, or abandoned by an owner that ended), false when another process owns it (`WAIT_TIMEOUT`), and throws
 * `InstanceLockError` when it couldn't tell: kernel32 couldn't be loaded, the mutex couldn't be created, or the wait failed.
 */
export function windowsMutex(api?: MutexApi): ProcessLock {
  const held: unknown[] = [];
  return {
    acquire(name) {
      let calls: MutexApi;
      try { calls = api ?? kernel32(); } catch (error) { throw new InstanceLockError(`kernel32 couldn't be loaded: ${error}`); }
      const handle = calls.create(name);
      if (!handle) throw new InstanceLockError("The single-instance mutex couldn't be created.");
      const result = calls.wait(handle);
      if (result === WAIT_OBJECT_0 || result === WAIT_ABANDONED) {
        // Kept open for the process's life: closing it would let the mutex go while owned.
        held.push(handle);
        return true;
      }
      calls.close(handle);
      if (result === WAIT_TIMEOUT) return false;
      throw new InstanceLockError(`Waiting on the single-instance mutex failed (${result >>> 0}).`);
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
