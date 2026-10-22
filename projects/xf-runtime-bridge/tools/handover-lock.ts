// 0.8.3 (the review): session.handover and session.resume each take several control-pipe calls, so a resume from one process
// could land between the steps of a handover from another, leaving the session handed over. Each runs whole under this lock:
// a Windows named mutex per runtime folder (any XF tool, any process) plus a queue per folder inside this process (a mutex
// is re-entrant for its owning thread, so two command APIs in one process wouldn't exclude each other through it alone).
// The kernel frees the mutex when a holder ends however it ends (an abandoned mutex counts as taken). Waiting never blocks
// the event loop (a zero-timeout wait, tried again every 20 ms); a wait past waitMs, or an abort, refuses instead.

import { dlopen, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const WAIT_OBJECT_0 = 0;
const WAIT_ABANDONED = 0x80;
const RETRY_MS = 20;

let kernel32: ReturnType<typeof openKernel32> | null | undefined;
function openKernel32() {
  const { u32, u64, i32 } = FFIType;
  return dlopen("kernel32.dll", {
    CreateMutexW: { args: [FFIType.ptr, i32, FFIType.ptr], returns: u64 },
    WaitForSingleObject: { args: [u64, u32], returns: u32 },
    ReleaseMutex: { args: [u64], returns: i32 },
    CloseHandle: { args: [u64], returns: i32 },
    GetLastError: { args: [], returns: u32 },
  }).symbols;
}
function k32() {
  if (kernel32 === undefined) {
    try {
      kernel32 = process.platform === "win32" ? openKernel32() : null;
    } catch {
      kernel32 = null;
    }
  }
  return kernel32;
}

/** The mutex's name for one runtime folder (per user session, the folder's full path hashed). */
export function handoverMutexName(runtimeDir: string): string {
  const key = createHash("sha256").update(resolve(runtimeDir).toLowerCase()).digest("hex").slice(0, 32);
  return `Local\\XFRuntimeBridge.Handover.${key}`;
}

export class HandoverBusyError extends Error {
  plain: { code: string; message: string };
  constructor(code: string, message: string) {
    super(message);
    this.plain = { code, message };
  }
}

/** This process's queue per folder: one whole operation at a time. */
const queues = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs fn while holding the handover lock for runtimeDir (in this process and across processes). */
export async function withHandoverLock<T>(runtimeDir: string, fn: () => Promise<T>, options: { waitMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const name = handoverMutexName(runtimeDir);
  const before = queues.get(name) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => (done = r));
  const tail = before.then(() => mine);
  queues.set(name, tail);
  try {
    await before;
    return await holdMutex(name, fn, options);
  } finally {
    done();
    if (queues.get(name) === tail) queues.delete(name);
  }
}

async function holdMutex<T>(name: string, fn: () => Promise<T>, options: { waitMs?: number; signal?: AbortSignal }): Promise<T> {
  const k = k32();
  if (!k) return fn(); // not Windows: the bridge doesn't run there, and the in-process queue still orders calls
  const handle = k.CreateMutexW(null, 0, Buffer.from(`${name}\0`, "utf16le")) as bigint;
  if (!handle) throw new HandoverBusyError("failed", `The handover lock couldn't be opened (Windows error ${k.GetLastError()}).`);
  let owned = false;
  try {
    const deadline = performance.now() + (options.waitMs ?? 15_000);
    for (;;) {
      if (options.signal?.aborted) throw new HandoverBusyError("interrupted", "Stopped while waiting for another XF tool's handover or resume to finish; nothing was sent.");
      const wait = k.WaitForSingleObject(handle, 0);
      if (wait === WAIT_OBJECT_0 || wait === WAIT_ABANDONED) {
        owned = true;
        break;
      }
      if (performance.now() >= deadline) {
        throw new HandoverBusyError("bridge_busy", "Another XF tool's handover or resume is still running; nothing was sent. Try again in a moment.");
      }
      await sleep(RETRY_MS);
    }
    return await fn();
  } finally {
    if (owned) k.ReleaseMutex(handle);
    k.CloseHandle(handle);
  }
}
