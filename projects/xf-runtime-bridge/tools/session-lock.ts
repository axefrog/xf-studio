// Lock held by the session runner while it drives the game, so that the MCP server doesn't talk to the bridge in the middle
// of a scripted session (the bridge takes one client at a time, and a stray call could fail or reorder a session step).
//
// Ownership is a Windows named mutex per runtime folder (0.8.1, RB-124): the kernel lets one process hold it, and frees it
// when that process ends, however it ends, so there is no stale lock to judge and take over. The earlier file-only protocol
// moved a stale file aside before checking it, which could displace a fresh owner while a third runner claimed the free
// name, leaving two runners each believing it had control.
//
// Beside the mutex, the owner writes a small JSON file (<runtime dir>/session-runner.lock) naming itself (PID, the
// process's start time, the script), which the MCP server reads to refuse plainly and say who is running. Only the mutex's
// owner writes or removes that file. A file whose process has gone (a crash) is stale and ignored, and the next owner
// overwrites it. Advisory only: the bridge itself never reads either.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type SessionLock = {
  pid: number;
  script: string;
  started_at: string;
  /** The runner process's creation time (Windows FILETIME, decimal); absent in older lock files. */
  process_started?: string;
};

export const LOCK_FILE = "session-runner.lock";

export const lockPath = (runtimeDir: string) => join(runtimeDir, LOCK_FILE);

// --- process identity (kernel32 through bun:ffi) ---------------------------------------------------

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const ERROR_INVALID_PARAMETER = 87;
const STILL_ACTIVE = 259;

let kernel32: ReturnType<typeof openKernel32> | null | undefined;
function openKernel32() {
  const { u32, u64, i32 } = FFIType;
  return dlopen("kernel32.dll", {
    OpenProcess: { args: [u32, i32, u32], returns: u64 },
    GetProcessTimes: { args: [u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: i32 },
    GetExitCodeProcess: { args: [u64, FFIType.ptr], returns: i32 },
    CloseHandle: { args: [u64], returns: i32 },
    GetLastError: { args: [], returns: u32 },
    CreateMutexW: { args: [FFIType.ptr, i32, FFIType.ptr], returns: u64 },
    WaitForSingleObject: { args: [u64, u32], returns: u32 },
    ReleaseMutex: { args: [u64], returns: i32 },
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

/**
 * The process's creation time as a decimal FILETIME, `null` when no process has this PID (or it has ended), or
 * `"unknown"` when it exists but can't be queried (or this isn't Windows).
 */
export function processStartTime(pid: number): string | null | "unknown" {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const k = k32();
  if (!k) return "unknown";
  const handle = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) return k.GetLastError() === ERROR_INVALID_PARAMETER ? null : "unknown";
  try {
    const times = new BigUint64Array(4); // creation, exit, kernel, user
    const at = (i: number) => ptr(times) + i * 8;
    // A process that has ended can still be opened while anyone holds a handle to it (its parent, for one), so an ended
    // process counts as gone (0.8.1).
    const exit = new Uint32Array(1);
    if (k.GetExitCodeProcess(handle, exit) && exit[0] !== STILL_ACTIVE) return null;
    if (!k.GetProcessTimes(handle, at(0), at(1), at(2), at(3))) return "unknown";
    return times[0].toString();
  } finally {
    k.CloseHandle(handle);
  }
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else; still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Is the process that wrote this lock still running (the same process, not a reused PID)? */
export function lockAlive(lock: SessionLock): boolean {
  if (!Number.isInteger(lock.pid) || lock.pid <= 0) return false;
  const started = processStartTime(lock.pid);
  if (started === null) return false;
  if (started === "unknown") return pidExists(lock.pid);
  return !lock.process_started || lock.process_started === started;
}

function readRaw(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parse(raw: string | null): SessionLock | null {
  if (raw === null) return null;
  try {
    const lock = JSON.parse(raw) as SessionLock;
    return typeof lock?.pid === "number" ? lock : null;
  } catch {
    return null;
  }
}

/** The lock of a session runner that is still running, or null (a stale lock counts as none). */
export function readSessionLock(runtimeDir: string): SessionLock | null {
  const lock = parse(readRaw(lockPath(runtimeDir)));
  return lock && lockAlive(lock) ? lock : null;
}

const WAIT_OBJECT_0 = 0;
const WAIT_ABANDONED = 0x80;

/** The mutex's name for one runtime folder: per user session (Local\), the folder's full path hashed. */
export function lockMutexName(runtimeDir: string): string {
  const key = createHash("sha256").update(resolve(runtimeDir).toLowerCase()).digest("hex").slice(0, 32);
  return `Local\\XFRuntimeBridge.SessionRunner.${key}`;
}

/** Mutexes this process holds, by name: a mutex is re-entrant for its owning thread, so a second take here is refused. */
const held = new Map<string, bigint>();

/**
 * Takes the lock for this process. Returns a release function, or the other runner's lock when one is running (its file,
 * or a placeholder when the holder hasn't written it yet). Never waits.
 */
export function acquireSessionLock(runtimeDir: string, script: string): { release: () => void } | { heldBy: SessionLock } {
  mkdirSync(runtimeDir, { recursive: true });
  const path = lockPath(runtimeDir);
  const holder = (): SessionLock => parse(readRaw(path)) ?? { pid: 0, script: "another session runner", started_at: "" };
  const k = k32();
  if (!k) throw new Error("The session lock needs Windows (the bridge runs only there).");
  const name = lockMutexName(runtimeDir);
  if (held.has(name)) return { heldBy: holder() };
  const handle = k.CreateMutexW(null, 0, Buffer.from(`${name}\0`, "utf16le")) as bigint;
  if (!handle) throw new Error(`The session lock's mutex couldn't be opened (Windows error ${k.GetLastError()}).`);
  const wait = k.WaitForSingleObject(handle, 0);
  // WAIT_ABANDONED: the last owner ended without releasing it (a crash); the mutex is ours now, and its file is stale.
  if (wait !== WAIT_OBJECT_0 && wait !== WAIT_ABANDONED) {
    k.CloseHandle(handle);
    return { heldBy: holder() };
  }
  // A runner from before 0.8.1 holds only the file: honour it while its process lives.
  const before = parse(readRaw(path));
  if (before && before.pid !== process.pid && lockAlive(before)) {
    k.ReleaseMutex(handle);
    k.CloseHandle(handle);
    return { heldBy: before };
  }
  held.set(name, handle);
  const started = processStartTime(process.pid);
  const mine: SessionLock = {
    pid: process.pid,
    script,
    started_at: new Date().toISOString(),
    ...(started && started !== "unknown" ? { process_started: started } : {}),
  };
  writeFileSync(path, JSON.stringify(mine) + "\n");
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off("exit", release);
    rmSync(path, { force: true });
    held.delete(name);
    k.ReleaseMutex(handle);
    k.CloseHandle(handle);
  };
  process.once("exit", release);
  return { release };
}

/** The plain sentence a frontend shows while a session runner holds the lock. */
export function sessionRunningMessage(lock: SessionLock, lockFile?: string): string {
  const since = lock.started_at ? ` since ${lock.started_at.slice(11, 19)} UTC` : "";
  const stale = lockFile ? ` If no session is actually running, delete ${lockFile}.` : "";
  return `A scripted session (${lock.script}, process ${lock.pid}${since}) is driving the game right now. Wait until it finishes or pauses at a question for the player, or stop it with Ctrl+C in its window. Screenshots still work; to stop the bridge now, use bridge_kill (while the session holds the connection it writes the bridge's KILL file instead) or the CET hotkey.${stale}`;
}
