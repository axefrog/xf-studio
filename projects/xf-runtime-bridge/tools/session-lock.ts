// Advisory lock held by the session runner while it drives the game, so that the MCP server
// doesn't talk to the bridge in the middle of a scripted session (the bridge takes one client at
// a time, and a stray call could fail or reorder a session step).
//
// The lock is a small JSON file beside the bridge's session.json (<runtime dir>/session-runner.lock),
// created exclusively. It names the runner's process; a lock whose process has gone is stale and
// is taken over. Advisory only: the bridge itself never reads it.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SessionLock = { pid: number; script: string; started_at: string };

export const LOCK_FILE = "session-runner.lock";

const lockPath = (runtimeDir: string) => join(runtimeDir, LOCK_FILE);

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else; still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockFile(runtimeDir: string): SessionLock | null {
  try {
    const lock = JSON.parse(readFileSync(lockPath(runtimeDir), "utf8")) as SessionLock;
    return typeof lock?.pid === "number" ? lock : null;
  } catch {
    return null;
  }
}

/** The lock of a session runner that is still running, or null (a stale lock counts as none). */
export function readSessionLock(runtimeDir: string): SessionLock | null {
  const lock = readLockFile(runtimeDir);
  return lock && alive(lock.pid) ? lock : null;
}

/**
 * Takes the lock for this process. Returns a release function, or the other runner's lock when
 * one is running. A stale lock (its process has gone) is replaced.
 */
export function acquireSessionLock(runtimeDir: string, script: string): { release: () => void } | { heldBy: SessionLock } {
  mkdirSync(runtimeDir, { recursive: true });
  const path = lockPath(runtimeDir);
  const mine: SessionLock = { pid: process.pid, script, started_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(mine) + "\n", { flag: "wx" });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (readLockFile(runtimeDir)?.pid === process.pid) rmSync(path, { force: true });
      };
      process.once("exit", release);
      return { release };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = readLockFile(runtimeDir);
      if (held && alive(held.pid) && held.pid !== process.pid) return { heldBy: held };
      rmSync(path, { force: true }); // stale, unreadable, or left by this process
    }
  }
  const held = readLockFile(runtimeDir);
  return { heldBy: held ?? { pid: 0, script: "unknown", started_at: "" } };
}

/** The plain sentence a frontend shows while a session runner holds the lock. */
export function sessionRunningMessage(lock: SessionLock): string {
  const since = lock.started_at ? ` since ${lock.started_at.slice(11, 19)} UTC` : "";
  return `A scripted session (${lock.script}, process ${lock.pid}${since}) is driving the game right now. Wait until it finishes or pauses at a question for the player, or stop it with Ctrl+C in its window. Screenshots still work; to stop the bridge now, use the CET hotkey, bridge_kill or the KILL file.`;
}
