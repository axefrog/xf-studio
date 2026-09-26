import { spawn } from "node:child_process";
import { constants, setPriority } from "node:os";

/** Process adapter shared by the host's external-tool runners. It interprets nothing about the tool's output. */
export type ProcessStop = "cancelled" | "timeout";
export interface ProcessTreeResult {
  /** Null when the process could not start or was stopped. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stopped: ProcessStop | null;
  /** Spawn failure, e.g. a missing executable. */
  readonly error?: Error;
}
export interface ProcessTreeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly cwd?: string;
  /** Replaces the child environment when given. */
  readonly env?: Record<string, string | undefined>;
  /** Characters of stdout and of stderr to keep (the tail). */
  readonly keep?: number;
  /**
   * Run the process below normal priority (background work). A function is asked when the process starts, not when the work was
   * queued, so a launch that a person's own change now waits on starts at normal priority (PIPE-96).
   */
  readonly lowPriority?: LowPriority;
}
/** Whether background work runs below normal priority: fixed, or decided when each process starts (PIPE-96). */
export type LowPriority = boolean | (() => boolean);
/** A `LowPriority` decided now. */
export const lowPriorityNow = (value: LowPriority | undefined): boolean => typeof value === "function" ? value() : !!value;

/** Stop a child and every process it started: `taskkill /T` on Windows, the process group elsewhere. */
function stopTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) { child.kill(); return; }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
    killer.on("close", code => { if (code !== 0) child.kill(); });
  } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
}

/** Processes started below normal priority that are still running (`raiseLowPriority`). */
const lowPriority = new Set<number>();
/**
 * Raise every running below-normal process to normal priority: foreground work that waits on one (a resource a background batch
 * is extracting) must not wait at background priority.
 */
export function raiseLowPriority(): void {
  for (const pid of lowPriority) { try { setPriority(pid, constants.priority.PRIORITY_NORMAL); } catch { /* Gone meanwhile. */ } }
  lowPriority.clear();
}

/** Run one command to completion; abort or timeout kills the whole process tree. Never rejects. */
export function runProcessTree(command: string, args: readonly string[], options: ProcessTreeOptions): Promise<ProcessTreeResult> {
  const keep = options.keep ?? 128_000;
  return new Promise(done => {
    if (options.signal?.aborted) { done({ exitCode: null, stdout: "", stderr: "", stopped: "cancelled" }); return; }
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, windowsHide: true,
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    if (lowPriorityNow(options.lowPriority) && child.pid) {
      try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); lowPriority.add(child.pid); } catch { /* Advisory. */ }
    }
    let stdout = "", stderr = "", stopped: ProcessStop | null = null, settled = false;
    child.stdout!.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString("utf8")).slice(-keep); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-keep); });
    const stop = (reason: ProcessStop) => {
      if (settled || stopped) return;
      stopped = reason;
      stopTree(child);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    const finish = (exitCode: number | null, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (child.pid) lowPriority.delete(child.pid);
      done({ exitCode: stopped ? null : exitCode, stdout, stderr, stopped, ...(error ? { error } : {}) });
    };
    child.on("error", error => finish(null, error));
    child.on("close", code => finish(code));
  });
}
