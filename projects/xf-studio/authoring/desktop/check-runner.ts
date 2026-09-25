import type { PackageCheck } from "../src/package-action";
import type { PlateReachInput } from "../src/plate-reach";

export const checkDeadlineMs = 15_000;
export type CheckResult = { kind: "success"; result: PackageCheck } |
  { kind: "invalid"; message: string } |
  { kind: "failure"; message: string; code?: string };

/** Worker request: the collection, and the prepared plate's UV footprint when the host has one. */
export type CheckRequest = { collection: unknown; plate: PlateReachInput | null };
/** Fresh worker per Check prevents a stalled compiler from blocking the desktop host. */
export function runDesktopCheck(collection: unknown, workerPath: string, timeoutMs = checkDeadlineMs,
  signal?: AbortSignal, plate: PlateReachInput | null = null): Promise<CheckResult> {
  return new Promise(resolve => {
    let worker: Worker;
    try { worker = new Worker(workerPath); }
    catch { resolve({ kind: "failure", code: "package_check_worker_unavailable",
      message: "Package Check could not start its worker. Restart XF Studio and try again." }); return; }
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      try { worker.terminate(); } catch { /* The worker may have already failed. */ }
      resolve(result);
    };
    const abort = () => finish({ kind: "failure", code: "package_check_cancelled",
      message: "Package Check was cancelled. No result was published." });
    const timer = setTimeout(() => finish({ kind: "failure", code: "package_check_timeout",
      message: "Package Check took too long and was stopped. Simplify the collection and try again." }), timeoutMs);
    worker.onmessage = (event: MessageEvent<CheckResult>) => {
      const value = event.data;
      if (value?.kind === "success" && value.result?.ready === true) finish(value);
      else if (value?.kind === "invalid" && typeof value.message === "string") finish(value);
      else if (value?.kind === "failure" && typeof value.message === "string") finish(value);
      else finish({ kind: "failure", code: "package_check_worker_failed",
        message: "Package Check returned an invalid worker result. No result was published." });
    };
    worker.onerror = () => finish({ kind: "failure", code: "package_check_worker_failed",
      message: "Package Check worker failed. No result was published." });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage({ collection, plate } satisfies CheckRequest); }
    catch { finish({ kind: "failure", code: "package_check_worker_failed",
      message: "Package Check could not send the collection to its worker." }); }
  });
}
