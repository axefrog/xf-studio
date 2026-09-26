// Advisory lock held by the session runner while it drives the game, so that the MCP server
// doesn't talk to the bridge in the middle of a scripted session (the bridge takes one client at
// a time, and a stray call could fail or reorder a session step).
//
// The lock is a small JSON file beside the bridge's session.json (<runtime dir>/session-runner.lock),
// created exclusively. It names the runner's process by PID and by the process's start time, so a
// PID that Windows has since given to another process doesn't keep the lock alive. A lock whose
// process has gone is stale and is taken over; the takeover moves the stale file aside first and
// checks it moved the file it judged, so two runners starting at once can't both win. Advisory
// only: the bridge itself never reads it.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

let kernel32: ReturnType<typeof openKernel32> | null | undefined;
function openKernel32() {
  const { u32, u64, i32 } = FFIType;
  return dlopen("kernel32.dll", {
    OpenProcess: { args: [u32, i32, u32], returns: u64 },
    GetProcessTimes: { args: [u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: i32 },
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

/**
 * The process's creation time as a decimal FILETIME, `null` when no process has this PID, or
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

/**
 * Puts a moved-aside lock back at `path` only if nothing is there now, atomically (RB-33): a hard link
 * fails when the name exists, where a rename would silently replace a lock a third runner wrote in
 * between. Where hard links aren't possible, an exclusive (`wx`) copy does the same. The aside file is
 * removed either way. Returns whether the lock was put back.
 */
export function putBackLock(aside: string, path: string): boolean {
  let restored = false;
  try {
    linkSync(aside, path);
    restored = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      const raw = readRaw(aside);
      if (raw !== null) {
        try {
          writeFileSync(path, raw, { flag: "wx" });
          restored = true;
        } catch {
          // someone else's lock is there now; theirs wins
        }
      }
    }
  }
  rmSync(aside, { force: true });
  return restored;
}

// Removes a stale lock only if it is still the file that was judged stale (aSeen): the file is
// moved aside atomically, compared, and put back if another runner had replaced it meanwhile, never
// over a lock a third runner has written since.
function takeOverStale(path: string, seen: string): void {
  const aside = `${path}.stale-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    renameSync(path, aside);
  } catch {
    return; // gone already, or someone else is moving it
  }
  if (readRaw(aside) === seen) {
    rmSync(aside, { force: true });
    return;
  }
  // It was another runner's fresh lock: put it back unless a third one has written a new lock.
  putBackLock(aside, path);
}

/**
 * Takes the lock for this process. Returns a release function, or the other runner's lock when
 * one is running. A stale lock (its process has gone) is replaced.
 */
export function acquireSessionLock(runtimeDir: string, script: string): { release: () => void } | { heldBy: SessionLock } {
  mkdirSync(runtimeDir, { recursive: true });
  const path = lockPath(runtimeDir);
  const started = processStartTime(process.pid);
  const mine: SessionLock = {
    pid: process.pid,
    script,
    started_at: new Date().toISOString(),
    ...(started && started !== "unknown" ? { process_started: started } : {}),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(mine) + "\n", { flag: "wx" });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const current = parse(readRaw(path));
        if (current?.pid === process.pid && current.started_at === mine.started_at) rmSync(path, { force: true });
      };
      process.once("exit", release);
      return { release };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raw = readRaw(path);
      const held = parse(raw);
      if (held && held.pid !== process.pid && lockAlive(held)) return { heldBy: held };
      if (raw !== null) takeOverStale(path, raw); // stale, unreadable, or left by this process
    }
  }
  const held = parse(readRaw(path));
  return { heldBy: held ?? { pid: 0, script: "unknown", started_at: "" } };
}

/** The plain sentence a frontend shows while a session runner holds the lock. */
export function sessionRunningMessage(lock: SessionLock, lockFile?: string): string {
  const since = lock.started_at ? ` since ${lock.started_at.slice(11, 19)} UTC` : "";
  const stale = lockFile ? ` If no session is actually running, delete ${lockFile}.` : "";
  return `A scripted session (${lock.script}, process ${lock.pid}${since}) is driving the game right now. Wait until it finishes or pauses at a question for the player, or stop it with Ctrl+C in its window. Screenshots still work; to stop the bridge now, use bridge_kill (while the session holds the connection it writes the bridge's KILL file instead) or the CET hotkey.${stale}`;
}
