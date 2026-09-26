/**
 * The Check runner both hosts share: one fresh Bun worker per Check, so a stalled compiler never blocks the
 * host, with a deadline and cancellation that publish no result. The worker entry (`tools/package_check_worker.ts`,
 * a composition root) runs `checkProducts` with the composed exporters.
 */
import type { PackageCheckResult } from "../api/export";

/** What a worker checks: the collection (knobs removed), what each prerequisite last left, and the snapshot's hash. */
export type CheckRequest = { readonly collection: unknown; readonly prerequisites: Readonly<Record<string, unknown>>;
  readonly collectionSha256: string };
export type CheckOutcome = { kind: "success"; result: PackageCheckResult } |
  { kind: "failure"; message: string; code: string };

/** Fresh worker per Check prevents a stalled compiler from blocking the host. Never rejects. */
export function runWorkerCheck(request: CheckRequest, workerPath: string, timeoutMs: number, signal?: AbortSignal): Promise<CheckOutcome> {
  return new Promise(resolve => {
    let worker: Worker;
    try { worker = new Worker(workerPath); }
    catch { resolve({ kind: "failure", code: "package_check_worker_unavailable",
      message: "Package Check could not start its worker. Restart XF Studio and try again." }); return; }
    let settled = false;
    const finish = (result: CheckOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      try { worker.terminate(); } catch { /* The worker may have already failed. */ }
      resolve(result);
    };
    const abort = () => finish({ kind: "failure", code: "package_check_cancelled", message: "Package Check was cancelled. No result was published." });
    const timer = setTimeout(() => finish({ kind: "failure", code: "package_check_timeout",
      message: "Package Check took too long and was stopped. Simplify the collection and try again." }), timeoutMs);
    worker.onmessage = (event: MessageEvent<CheckOutcome>) => {
      const value = event.data;
      if (value?.kind === "success" && value.result?.ready === true) finish(value);
      else if (value?.kind === "failure" && typeof value.message === "string" && typeof value.code === "string") finish(value);
      else finish({ kind: "failure", code: "package_check_worker_failed", message: "Package Check returned an invalid worker result. No result was published." });
    };
    worker.onerror = () => finish({ kind: "failure", code: "package_check_worker_failed", message: "Package Check worker failed. No result was published." });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage(request); }
    catch { finish({ kind: "failure", code: "package_check_worker_failed", message: "Package Check could not send the collection to its worker." }); }
  });
}
