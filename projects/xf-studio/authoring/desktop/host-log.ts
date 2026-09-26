import { hostDiagnosticsAt } from "../src/diagnostics/host-log";

/**
 * The desktop host's view of its structured diagnostics log (docs/diagnostics.md): JSON Lines in the app's data folder
 * (`diagnostics/log.jsonl`, rotated and size-bounded, redacted as written). The packaged app has no console, so startup facts
 * and failures land here, for "Report a problem", "Copy diagnostics" and clean-machine trials. It never records collection
 * content, file bytes, cookies or tokens. The desktop server writes to the same log.
 */
export type HostLog = { path: string; write(message: string): void; failure(message: string, error?: unknown): void };

export function createHostLog(dataRoot: string): HostLog {
  const { log } = hostDiagnosticsAt(dataRoot);
  return {
    path: log.path,
    write(message: string) { log.info("desktop", "event", message); },
    failure(message: string, error?: unknown) { log.failure("desktop", "startup_failed", message, error); },
  };
}
